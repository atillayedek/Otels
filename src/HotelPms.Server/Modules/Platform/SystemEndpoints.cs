using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Backup;
using HotelPms.Server.Realtime;
using HotelPms.Shared;
using Npgsql;

namespace HotelPms.Server.Modules.Platform;

public sealed record SystemInfo(string Product, string ServerName, string Hostname, string Version, string MinClientVersion, string ApiVersion,
    bool SetupRequired, string? HotelName, string? CaFingerprintSha256, int HttpsPort, DateTime ServerTimeUtc, string SupportEmail);

public sealed record ManageStatus(string Status, string Hostname, IReadOnlyList<string> Addresses, int HttpsPort, int HttpPort, string Version,
    string? DatabaseVersion, string SchemaVersion, bool DatabaseReady, string? StartupError, TimeSpan Uptime, int ConnectedClients,
    IReadOnlyList<ConnectedClient> Clients, int ActiveSessions, IReadOnlyList<string> LoggedInUsers, long DatabaseSizeBytes, DateTime? LastBackupAt,
    string? LastBackupStatus, long FreeDiskBytes, long TotalDiskBytes, long MemoryBytes, double CpuPercent, IReadOnlyList<HealthCheck> Checks,
    string DataRoot, string BackupDirectory, string? SetupCode, string LogsDirectory, string? License = null, bool LicenseRestricted = false);

public sealed record RestoreRequest(string FilePath, string Confirmation);
public sealed record EmergencyResetRequest(string Username, string NewPassword);

public static class SystemEndpoints
{
    static TimeSpan _lastCpu;
    static DateTime _lastCpuAt;
    static double _cpu;

    public static void Map(WebApplication app)
    {
        var sys = app.MapGroup("/api/v1/system").WithTags("System");

        sys.MapGet("/info", async (Db db, HealthState health, ServerConfig cfg, PmsPaths paths) =>
        {
            bool setup = false;
            string? hotel = null;
            if (health.DatabaseReady)
            {
                try
                {
                    await using var c = await db.OpenAsync();
                    setup = !await c.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.users) AND EXISTS (SELECT 1 FROM pms.property)");
                    hotel = await c.ExecuteScalarAsync<string?>("SELECT name FROM pms.property LIMIT 1");
                }
                catch (NpgsqlException) { }
            }
            string? fp = File.Exists(paths.CaCertFile) ? new CertificateManager(paths, new SecretStore(paths)).CaFingerprintSha256() : null;
            return new SystemInfo(PmsConstants.ProductName, cfg.ServerName, Environment.MachineName, PmsConstants.VersionText,
                PmsConstants.MinClientVersion.ToString(3), "v1", setup, hotel, fp, cfg.HttpsPort, DateTime.UtcNow, PmsConstants.SupportEmail);
        }).AllowAnonymousPms();

        sys.MapGet("/health", (HealthState h) => Results.Json(new
        {
            status = !h.DatabaseReady ? "unavailable" : h.Checks.Any(c => c.Status == "error") ? "degraded" : "healthy",
            database = h.DatabaseReady,
            checks = h.Checks.Select(c => new { c.Name, c.Status }),
        }, Json.Options, statusCode: h.DatabaseReady ? 200 : 503)).AllowAnonymousPms();

        sys.MapGet("/ca.crt", (PmsPaths paths) => File.Exists(paths.CaCertFile)
            ? Results.File(paths.CaCertFile, "application/x-x509-ca-cert", "HotelPMS-Yerel-CA.crt")
            : Results.NotFound()).AllowAnonymousPms();

        sys.MapGet("/printers", () => Printing.PrinterService.InstalledPrinters());

        // ---------------------------------------------------------- Yerel yönetim (Server Manager)
        var m = app.MapGroup("/api/v1/manage").WithTags("Manage").AllowAnonymousPms()
            .AddEndpointFilter(async (ctx, next) =>
            {
                var http = ctx.HttpContext;
                var remote = http.Connection.RemoteIpAddress;
                if (remote is null || !IPAddress.IsLoopback(remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote))
                    return Results.StatusCode(404);
                var expected = http.RequestServices.GetRequiredService<SecretStore>().TryGet(SecretStore.ManageToken);
                var given = http.Request.Headers[PmsConstants.ManageTokenHeader].ToString();
                if (expected is null || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(given)))
                    return Results.StatusCode(401);
                return await next(ctx);
            });

        m.MapGet("/status", async (HealthState h, ServerConfig cfg, PmsPaths paths, RealtimeHub hub, Db db, BackupService backups, LicenseService license) =>
        {
            var sessions = 0;
            IReadOnlyList<string> users = [];
            string schema = MigrationRunner.LatestVersion;
            if (h.DatabaseReady)
            {
                try
                {
                    await using var c = await db.OpenAsync();
                    sessions = await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM pms.sessions WHERE revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - interval '15 minutes'");
                    users = (await c.QueryAsync<string>("""
                        SELECT DISTINCT u.username FROM pms.sessions s JOIN pms.users u ON u.id = s.user_id
                        WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '15 minutes' ORDER BY 1
                        """)).ToList();
                    schema = await c.ExecuteScalarAsync<string>("SELECT max(version) FROM public.schema_migrations") ?? schema;
                }
                catch (NpgsqlException) { }
            }
            LicenseStatus? lic = null;
            if (h.DatabaseReady) try { lic = await license.StatusAsync(); } catch (NpgsqlException) { }
            var proc = Process.GetCurrentProcess();
            UpdateCpu(proc);
            var setupCode = File.Exists(paths.SetupTokenFile) ? File.ReadAllText(paths.SetupTokenFile).Trim() : null;
            return new ManageStatus(h.StartupError is not null ? "error" : h.DatabaseReady ? "running" : "degraded", Environment.MachineName,
                CertificateManager.LocalAddresses().Select(a => a.ToString()).ToList(), cfg.HttpsPort, cfg.HttpPort, PmsConstants.VersionText, h.DatabaseVersion,
                schema, h.DatabaseReady, h.StartupError, DateTime.UtcNow - h.StartedAt, hub.Clients.Count, hub.Clients, sessions, users, h.DatabaseSizeBytes,
                h.LastBackupAt, h.LastBackupStatus, h.FreeDiskBytes, h.TotalDiskBytes, proc.WorkingSet64, _cpu, h.Checks, paths.DataRoot,
                backups.PrimaryDirectory, setupCode, paths.LogsDir, lic?.Message, lic?.Restricted ?? false);
        });

        m.MapGet("/logs", (PmsPaths paths, int? lines) =>
        {
            var file = Directory.Exists(paths.LogsDir)
                ? new DirectoryInfo(paths.LogsDir).GetFiles("server-*.log").OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault()
                : null;
            if (file is null) return Results.Text("");
            using var fs = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs, Encoding.UTF8);
            var all = sr.ReadToEnd().Split('\n');
            return Results.Text(string.Join('\n', all.TakeLast(Math.Clamp(lines ?? 500, 10, 5000))), "text/plain", Encoding.UTF8);
        });

        m.MapGet("/backups", (BackupService svc) => svc.ListFiles());
        m.MapPost("/backup", async (BackupService svc, HttpContext http) => Results.Ok(new { id = await svc.CreateAsync("manual", null, http.RequestAborted) }));

        m.MapPost("/restore", async (RestoreRequest req, BackupService svc, HealthState health, MigrationRunnerFactory migrations, SessionService sessions,
            RealtimeHub hub, HttpContext http, ILoggerFactory lf) =>
        {
            if (req.Confirmation != "GERI YUKLE") throw PmsException.Validation("Onay metni hatalı. 'GERI YUKLE' yazın.");
            if (!File.Exists(req.FilePath)) throw PmsException.Validation("Yedek dosyası bulunamadı.");
            var old = await svc.RestoreAsync(req.FilePath, null,
                onBeforeSwap: () => { Interlocked.Increment(ref health.Generation); health.DatabaseReady = false; hub.Disconnect(_ => true); return Task.CompletedTask; },
                onAfterSwap: async () =>
                {
                    await migrations.Create().ApplyAsync(null, http.RequestAborted);
                    sessions.InvalidateCache();
                    Interlocked.Increment(ref health.Generation);
                    health.DatabaseReady = true;
                }, http.RequestAborted);
            lf.CreateLogger("Restore").LogWarning("Yedek geri yüklendi {File}", Path.GetFileName(req.FilePath));
            return Results.Ok(new { previousDatabase = old });
        });

        m.MapPost("/maintenance/{task}", async (string task, Db db, ServerConfig cfg, SecretStore secrets, PmsPaths paths) =>
        {
            var sql = task switch
            {
                "analyze" => "ANALYZE",
                "vacuum" => "VACUUM (ANALYZE)",
                "cleanup" => """
                    DELETE FROM pms.idempotency_keys WHERE created_at < now() - interval '30 days';
                    DELETE FROM pms.login_attempts WHERE at < now() - interval '90 days';
                    DELETE FROM pms.wifi_auth_log WHERE at < now() - interval '180 days';
                    DELETE FROM pms.wifi_push_log WHERE at < now() - interval '180 days';
                    DELETE FROM pms.sessions WHERE (revoked_at IS NOT NULL OR expires_at < now()) AND created_at < now() - interval '90 days';
                    """,
                _ => throw PmsException.Validation("Geçersiz bakım görevi (analyze, vacuum, cleanup)."),
            };
            var sw = Stopwatch.StartNew();
            await using var c = new NpgsqlConnection(new PostgresTools(paths, cfg, secrets).OwnerConnectionString());
            await c.OpenAsync();
            // CommandType açıkça Text: Dapper tek kelimelik komutu ("ANALYZE") saklı yordam sanıp "CALL ANALYZE()" olarak gönderir.
            await c.ExecuteAsync(new CommandDefinition(sql, commandTimeout: 3600, commandType: System.Data.CommandType.Text));
            return Results.Ok(new { task, elapsedMs = sw.ElapsedMilliseconds });
        });

        m.MapPost("/emergency-password-reset", async (EmergencyResetRequest req, Db db, SessionService sessions) =>
        {
            if (PasswordHasher.PolicyError(req.NewPassword) is { } pe) throw PmsException.Validation(pe);
            await using var c = await db.OpenAsync();
            await using var tx = await c.BeginTransactionAsync();
            var id = await c.ExecuteScalarAsync<Guid?>("""
                UPDATE pms.users SET password_hash = @h, must_change_password = true, failed_attempts = 0, locked_until = NULL, is_active = true, version = version + 1
                WHERE lower(username) = lower(@u) RETURNING id
                """, new { h = PasswordHasher.Hash(req.NewPassword), u = req.Username }, tx) ?? throw PmsException.NotFound("Kullanıcı");
            await c.ExecuteAsync("UPDATE pms.sessions SET revoked_at = now(), revoke_reason = 'emergency_reset' WHERE user_id = @id AND revoked_at IS NULL", new { id }, tx);
            await c.ExecuteAsync("INSERT INTO pms.audit_log (username, hostname, action, entity_type, entity_id, reason) VALUES ('server-manager', @h, 'user.emergency_reset', 'user', @id::text, 'Sunucu üzerinden acil parola sıfırlama')",
                new { h = Environment.MachineName, id }, tx);
            await tx.CommitAsync();
            sessions.InvalidateCache();
            return Results.Ok(new { id });
        });
    }

    static void UpdateCpu(Process p)
    {
        var now = DateTime.UtcNow;
        var cpu = p.TotalProcessorTime;
        if (_lastCpuAt != default)
        {
            var elapsed = (now - _lastCpuAt).TotalMilliseconds;
            if (elapsed > 0) _cpu = Math.Round((cpu - _lastCpu).TotalMilliseconds / elapsed / Environment.ProcessorCount * 100, 1);
        }
        _lastCpu = cpu;
        _lastCpuAt = now;
    }
}

public sealed class MigrationRunnerFactory(PmsPaths paths, ServerConfig cfg, SecretStore secrets, ILogger<MigrationRunner> log)
{
    public MigrationRunner Create() => new(new PostgresTools(paths, cfg, secrets).OwnerConnectionString(), cfg.DbAppUser, log);
}
