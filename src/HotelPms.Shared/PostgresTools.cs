using System.Diagnostics;
using System.Text;
using Npgsql;

namespace HotelPms.Shared;

/// <summary>
/// Gömülü PostgreSQL araçlarını çalıştırır. Parolalar komut satırına değil PGPASSWORD ortam değişkenine verilir;
/// böylece işlem listesinde veya loglarda görünmez.
/// </summary>
public sealed class PostgresTools
{
    readonly PmsPaths _paths;
    readonly ServerConfig _config;
    readonly SecretStore _secrets;

    public PostgresTools(PmsPaths paths, ServerConfig config, SecretStore secrets)
    {
        _paths = paths;
        _config = config;
        _secrets = secrets;
    }

    public string Exe(string name) => Path.Combine(_paths.PgBinDir, OperatingSystem.IsWindows() ? name + ".exe" : name);
    public bool BinariesPresent => File.Exists(Exe("pg_dump")) && File.Exists(Exe("pg_ctl"));

    public string OwnerConnectionString(string? database = null) => new NpgsqlConnectionStringBuilder
    {
        Host = _config.DbHost, Port = _config.DbPort, Database = database ?? _config.DbName,
        Username = _config.DbOwnerUser, Password = _secrets.Get(SecretStore.DbOwnerPassword),
        Timeout = 10, CommandTimeout = 300, ApplicationName = "HotelPMS-Owner",
    }.ConnectionString;

    public string AppConnectionString() => new NpgsqlConnectionStringBuilder
    {
        Host = _config.DbHost, Port = _config.DbPort, Database = _config.DbName,
        Username = _config.DbAppUser, Password = _secrets.Get(SecretStore.DbAppPassword),
        Timeout = 5, CommandTimeout = 60, MaxPoolSize = 100, ApplicationName = "HotelPMS-Server",
        // Bilgisayar uyku/hazırda bekleme sonrası kopmuş bağlantıların havuzda kalıp ilk istekte hata vermemesi için:
        // boşta kalan bağlantılar 60 sn sonra kapatılır, açık bağlantılar 30 sn'de bir yoklanır.
        KeepAlive = 30, TcpKeepAlive = true, ConnectionIdleLifetime = 60, ConnectionPruningInterval = 10,
    }.ConnectionString;

    public string SuperConnectionString(string database = "postgres") => new NpgsqlConnectionStringBuilder
    {
        Host = _config.DbHost, Port = _config.DbPort, Database = database,
        Username = _config.DbSuperUser, Password = _secrets.Get(SecretStore.DbSuperPassword),
        Timeout = 10, ApplicationName = "HotelPMS-Setup",
    }.ConnectionString;

    /// <param name="redirect">pg_ctl start için false olmalı: başlatılan postgres süreci boruları miras alıp açık tutar.</param>
    public async Task<ProcessResult> RunAsync(string tool, IEnumerable<string> args, string? password,
        CancellationToken ct = default, TimeSpan? timeout = null, bool redirect = true)
    {
        if (!redirect && OperatingSystem.IsWindows())
        {
            // ShellExecute ile başlatılan süreç std tutamaçlarını devralmaz; postgres arka planda kalsa da çağıranı kilitlemez.
            var shell = new ProcessStartInfo(Exe(tool)) { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden };
            foreach (var a in args) shell.ArgumentList.Add(a);
            using var sp = Process.Start(shell) ?? throw new InvalidOperationException($"{tool} başlatılamadı");
            await sp.WaitForExitAsync(ct);
            return new ProcessResult(sp.ExitCode, "", "");
        }
        var psi = new ProcessStartInfo(Exe(tool))
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        foreach (var a in args) psi.ArgumentList.Add(a);
        if (password is not null) psi.Environment["PGPASSWORD"] = password;
        psi.Environment["PGCLIENTENCODING"] = "UTF8";
        psi.Environment["LC_MESSAGES"] = "C";
        // Türkçe Windows'ta yerelleştirilmiş saat dilimi adı (CP1254) initdb bootstrap'ını bozar; veritabanı UTC çalışır.
        psi.Environment["TZ"] = "UTC";
        psi.Environment["PGTZ"] = "UTC";

        using var p = Process.Start(psi) ?? throw new InvalidOperationException($"{tool} başlatılamadı");
        var stdout = p.StandardOutput.ReadToEndAsync(ct);
        var stderr = p.StandardError.ReadToEndAsync(ct);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout ?? TimeSpan.FromHours(2));
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException)
        {
            try { p.Kill(true); } catch (InvalidOperationException) { }
            throw;
        }
        return new ProcessResult(p.ExitCode, await stdout, await stderr);
    }

    /// <summary>Özel (custom) formatta tam veritabanı dökümü.</summary>
    public Task<ProcessResult> DumpAsync(string outputFile, CancellationToken ct) =>
        RunAsync("pg_dump", [
            "-h", _config.DbHost, "-p", _config.DbPort.ToString(), "-U", _config.DbOwnerUser,
            "-d", _config.DbName, "-F", "c", "-Z", "6", "--no-password", "-f", outputFile,
        ], _secrets.Get(SecretStore.DbOwnerPassword), ct);

    public Task<ProcessResult> RestoreAsync(string dumpFile, string targetDb, CancellationToken ct) =>
        RunAsync("pg_restore", [
            "-h", _config.DbHost, "-p", _config.DbPort.ToString(), "-U", _config.DbOwnerUser,
            "-d", targetDb, "--no-password", "--no-owner", "--role", _config.DbOwnerUser,
            "--exit-on-error", "--single-transaction", dumpFile,
        ], _secrets.Get(SecretStore.DbOwnerPassword), ct);
}

public sealed record ProcessResult(int ExitCode, string StdOut, string StdErr)
{
    public bool Success => ExitCode == 0;
}
