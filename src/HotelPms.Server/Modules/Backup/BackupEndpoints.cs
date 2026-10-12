using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Backup;

public sealed record BackupPolicyDto(string Schedule, string Time, DayOfWeek WeeklyDay, int MonthlyDay, string PrimaryDirectory, string? SecondaryDirectory,
    int KeepScheduled, int KeepManual, int KeepSystem);

public static class BackupEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/backups").WithTags("Backup").RequirePermission("backup.manage");

        g.MapGet("/", (Db db) => db.QueryAsync<BackupDto>("""
            SELECT b.id, b.kind, b.file_name, b.directory, b.size_bytes, b.sha256, b.schema_version, b.app_version, b.status, b.error, b.secondary_status,
                   b.started_at, b.finished_at, u.username
            FROM pms.backups b LEFT JOIN pms.users u ON u.id = b.user_id ORDER BY b.started_at DESC LIMIT 200
            """));

        g.MapGet("/files", (BackupService svc) => svc.ListFiles());

        g.MapPost("/", async (BackupService svc, RequestContext ctx, Db db, HttpContext http) =>
        {
            var id = await svc.CreateAsync("manual", ctx.User!.Id, http.RequestAborted);
            await using var c = await db.OpenAsync();
            await Dapper.SqlMapper.ExecuteAsync(c, "INSERT INTO pms.audit_log (user_id, username, device_id, ip, action, entity_type, entity_id) VALUES (@u, @n, @d, @ip::inet, 'backup.create', 'backup', @id)",
                new { u = ctx.User.Id, n = ctx.User.Username, d = ctx.DeviceId, ip = ctx.Ip?.ToString(), id = id.ToString() });
            return Results.Ok(new { id });
        });

        g.MapGet("/policy", (ServerConfig cfg, BackupService svc) => new BackupPolicyDto(cfg.Backup.Schedule, cfg.Backup.Time, cfg.Backup.WeeklyDay,
            cfg.Backup.MonthlyDay, svc.PrimaryDirectory, cfg.Backup.SecondaryDirectory, cfg.Backup.KeepScheduled, cfg.Backup.KeepManual, cfg.Backup.KeepSystem));

        g.MapPut("/policy", async (BackupPolicyDto req, ServerConfig cfg, PmsPaths paths, RequestContext ctx, Db db) =>
        {
            if (req.Schedule is not ("off" or "daily" or "weekly" or "monthly")) throw PmsException.Validation("Geçersiz yedekleme sıklığı.");
            if (!TimeOnly.TryParse(req.Time, out _)) throw PmsException.Validation("Saat SS:dd biçiminde olmalıdır.");
            if (req.MonthlyDay is < 1 or > 28) throw PmsException.Validation("Aylık yedek günü 1-28 arasında olmalıdır.");
            if (req.KeepScheduled is < 1 or > 365 || req.KeepManual is < 1 or > 365 || req.KeepSystem is < 1 or > 365)
                throw PmsException.Validation("Saklanacak yedek sayısı 1-365 arasında olmalıdır.");
            foreach (var d in new[] { req.PrimaryDirectory, req.SecondaryDirectory }.Where(d => !string.IsNullOrWhiteSpace(d)))
                if (!Path.IsPathFullyQualified(d!)) throw PmsException.Validation("Yedek klasörü tam yol olmalıdır (ör. D:\\Yedek veya \\\\NAS\\Yedek).");
            try { Directory.CreateDirectory(req.PrimaryDirectory); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { throw PmsException.Validation("Birincil yedek klasörü oluşturulamıyor veya yazılamıyor."); }
            cfg.Backup = new BackupPolicy
            {
                Schedule = req.Schedule, Time = req.Time, WeeklyDay = req.WeeklyDay, MonthlyDay = req.MonthlyDay,
                PrimaryDirectory = string.Equals(req.PrimaryDirectory, paths.DefaultBackupDir, StringComparison.OrdinalIgnoreCase) ? null : req.PrimaryDirectory,
                SecondaryDirectory = string.IsNullOrWhiteSpace(req.SecondaryDirectory) ? null : req.SecondaryDirectory,
                KeepScheduled = req.KeepScheduled, KeepManual = req.KeepManual, KeepSystem = req.KeepSystem,
            };
            cfg.Save(paths);
            await using var c = await db.OpenAsync();
            await Dapper.SqlMapper.ExecuteAsync(c, "INSERT INTO pms.audit_log (user_id, username, ip, action, entity_type, new_value) VALUES (@u, @n, @ip::inet, 'backup.policy', 'config', @v::jsonb)",
                new { u = ctx.User!.Id, n = ctx.User.Username, ip = ctx.Ip?.ToString(), v = global::System.Text.Json.JsonSerializer.Serialize(req, Json.Options) });
            return Results.NoContent();
        });
    }
}
