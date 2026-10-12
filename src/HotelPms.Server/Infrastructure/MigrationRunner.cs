using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace HotelPms.Server.Infrastructure;

public sealed record MigrationScript(string Version, string Name, string Sql, string Checksum);

/// <summary>
/// Gömülü SQL migration'larını sırayla ve her biri ayrı transaction içinde uygular.
/// Uygulanmış bir dosyanın içeriği değişmişse çalışmayı durdurur (sessiz şema kayması yok).
/// Veri içeren bir veritabanına yeni migration uygulanmadan önce otomatik yedek alınır.
/// </summary>
public sealed class MigrationRunner
{
    readonly string _ownerConnectionString;
    readonly string _appRole;
    readonly ILogger _log;

    public MigrationRunner(string ownerConnectionString, string appRole, ILogger log)
    {
        _ownerConnectionString = ownerConnectionString;
        _appRole = appRole;
        _log = log;
    }

    public static IReadOnlyList<MigrationScript> LoadScripts()
    {
        var asm = Assembly.GetExecutingAssembly();
        return asm.GetManifestResourceNames()
            .Where(n => n.Contains(".Database.Migrations.") && n.EndsWith(".sql"))
            .Select(n =>
            {
                using var s = asm.GetManifestResourceStream(n)!;
                using var r = new StreamReader(s, Encoding.UTF8);
                var sql = r.ReadToEnd().Replace("\r\n", "\n");
                var file = n[(n.IndexOf(".Database.Migrations.", StringComparison.Ordinal) + ".Database.Migrations.".Length)..];
                var version = file[..file.IndexOf('_')];
                return new MigrationScript(version, file, sql, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql))));
            })
            .OrderBy(m => m.Version, StringComparer.Ordinal)
            .ToList();
    }

    public static string LatestVersion => LoadScripts().Last().Version;

    public async Task<IReadOnlyList<MigrationScript>> PendingAsync(CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(_ownerConnectionString);
        await c.OpenAsync(ct);
        await EnsureTableAsync(c, ct);
        var applied = await AppliedAsync(c, ct);
        var scripts = LoadScripts();
        foreach (var s in scripts)
        {
            if (applied.TryGetValue(s.Version, out var sum) && sum != s.Checksum)
                throw new InvalidOperationException($"Migration {s.Name} uygulandıktan sonra değiştirilmiş. Şema bütünlüğü korunmak için sunucu başlatılmadı.");
        }
        foreach (var v in applied.Keys)
        {
            if (scripts.All(s => s.Version != v))
                throw new InvalidOperationException($"Veritabanı bu sürümden daha yeni bir şemaya sahip ({v}). Uyumsuz sürüm; güncel PMS sürümünü kurun.");
        }
        return scripts.Where(s => !applied.ContainsKey(s.Version)).ToList();
    }

    public async Task<bool> HasBusinessDataAsync(CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(_ownerConnectionString);
        await c.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT to_regclass('pms.property') IS NOT NULL AND EXISTS (SELECT 1 FROM pms.property)", c);
        try { return (bool)(await cmd.ExecuteScalarAsync(ct))!; }
        catch (PostgresException) { return false; }
    }

    /// <param name="beforeApply">Bekleyen migration varsa ve veritabanında veri varsa çağrılır (yedek alma).</param>
    public async Task ApplyAsync(Func<Task>? beforeApply, CancellationToken ct)
    {
        var pending = await PendingAsync(ct);
        if (pending.Count > 0 && beforeApply is not null && await HasBusinessDataAsync(ct))
        {
            _log.LogInformation("Şema güncellemesi öncesi yedek alınıyor ({Count} migration bekliyor)", pending.Count);
            await beforeApply();
        }

        await using var c = new NpgsqlConnection(_ownerConnectionString);
        await c.OpenAsync(ct);
        foreach (var m in pending)
        {
            _log.LogInformation("Migration uygulanıyor: {Name}", m.Name);
            await using var tx = await c.BeginTransactionAsync(ct);
            await using (var lockCmd = new NpgsqlCommand("SELECT pg_advisory_xact_lock(724001)", c, tx))
                await lockCmd.ExecuteNonQueryAsync(ct);
            await using (var cmd = new NpgsqlCommand(m.Sql, c, tx) { CommandTimeout = 0 })
                await cmd.ExecuteNonQueryAsync(ct);
            await using (var ins = new NpgsqlCommand(
                "INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", c, tx))
            {
                ins.Parameters.AddWithValue(m.Version);
                ins.Parameters.AddWithValue(m.Name);
                ins.Parameters.AddWithValue(m.Checksum);
                await ins.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
        }
        await ApplyGrantsAsync(c, ct);
    }

    async Task ApplyGrantsAsync(NpgsqlConnection c, CancellationToken ct)
    {
        // Uygulama rolü: tablo verisi üzerinde DML, şema değiştiremez.
        // audit_log yalnız INSERT/SELECT; folio_lines yalnız INSERT/SELECT (düzeltme ters kayıtla).
        var role = _appRole;
        var sql = $"""
            GRANT USAGE ON SCHEMA pms TO {role};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pms TO {role};
            GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pms TO {role};
            REVOKE UPDATE, DELETE, TRUNCATE ON pms.audit_log FROM {role};
            REVOKE UPDATE, TRUNCATE ON pms.folio_lines FROM {role};
            REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pms.permissions FROM {role};
            REVOKE ALL ON public.schema_migrations FROM {role};
            GRANT SELECT ON public.schema_migrations TO {role};
            REVOKE CREATE ON SCHEMA pms FROM PUBLIC;
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            """;
        await using var cmd = new NpgsqlCommand(sql, c);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    static async Task EnsureTableAsync(NpgsqlConnection c, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS public.schema_migrations (
                version text PRIMARY KEY,
                name text NOT NULL,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """, c);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    static async Task<Dictionary<string, string>> AppliedAsync(NpgsqlConnection c, CancellationToken ct)
    {
        var d = new Dictionary<string, string>();
        await using var cmd = new NpgsqlCommand("SELECT version, checksum FROM public.schema_migrations", c);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) d[r.GetString(0)] = r.GetString(1);
        return d;
    }
}
