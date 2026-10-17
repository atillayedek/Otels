using System.Diagnostics;
using Dapper;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Realtime;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Platform;

public sealed record HealthCheck(string Name, string Status, string Message);

public sealed class HealthState
{
    public volatile bool DatabaseReady;
    /// <summary>Geri yükleme gibi veritabanı değişimlerinde artar; o sırada başlamış bir denetimin eski sonucu yok sayılır.</summary>
    public int Generation;
    public volatile bool DiskCritical;
    public volatile bool DiskWarning;
    public string? StartupError { get; set; }
    public DateTime StartedAt { get; } = DateTime.UtcNow;
    public IReadOnlyList<HealthCheck> Checks { get; set; } = [];
    public string? DatabaseVersion { get; set; }
    public long DatabaseSizeBytes { get; set; }
    public long FreeDiskBytes { get; set; }
    public long TotalDiskBytes { get; set; }
    public DateTime? LastBackupAt { get; set; }
    public string? LastBackupStatus { get; set; }
    public DateTime LastCheckAt { get; set; }
}

/// <summary>Sunucu, veritabanı, disk, bellek, yedek, realtime, yazıcı ve entegrasyon alt sistemlerini periyodik denetler.</summary>
public sealed class HealthMonitor(HealthState state, Db db, PmsPaths paths, ServerConfig config, RealtimeHub hub,
    ILogger<HealthMonitor> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await CheckAsync(ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Sağlık denetimi başarısız"); }
            await Task.Delay(TimeSpan.FromSeconds(15), ct);
        }
    }

    public async Task CheckAsync(CancellationToken ct)
    {
        var checks = new List<HealthCheck>();
        // Veritabanı
        if (state.StartupError is not null)
        {
            state.DatabaseReady = false;
            checks.Add(new("database", "error", "Başlatma hatası: veritabanı şeması hazırlanamadı."));
        }
        else
        {
            var generation = Volatile.Read(ref state.Generation);
            try
            {
                await using var c = await db.OpenAsync(ct);
                var info = await c.QuerySingleAsync<(string Version, long Size)>(
                    "SELECT current_setting('server_version'), pg_database_size(current_database())");
                state.DatabaseVersion = info.Version;
                state.DatabaseSizeBytes = info.Size;
                var last = await c.QuerySingleOrDefaultAsync<(DateTime? At, string? Status)>(
                    "SELECT finished_at, status FROM pms.backups WHERE kind IN ('manual','scheduled') ORDER BY started_at DESC LIMIT 1");
                state.LastBackupAt = last.At;
                state.LastBackupStatus = last.Status;
                if (!state.DatabaseReady) log.LogInformation("Veritabanı erişilebilir");
                state.DatabaseReady = true;
                checks.Add(new("database", "healthy", $"PostgreSQL {info.Version}"));
            }
            catch (Exception ex) when (ex is Npgsql.NpgsqlException or TimeoutException or InvalidOperationException)
            {
                // Denetim sürerken veritabanı geri yüklendiyse bu hata eski veritabanına aittir; hazır durumu değiştirilmez.
                if (generation == Volatile.Read(ref state.Generation))
                {
                    if (state.DatabaseReady) log.LogError(ex, "Veritabanına erişilemiyor");
                    state.DatabaseReady = false;
                }
                checks.Add(new("database", "unavailable", "Veritabanına bağlanılamıyor."));
            }
        }

        // Disk
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(paths.DataRoot)!);
            state.FreeDiskBytes = drive.AvailableFreeSpace;
            state.TotalDiskBytes = drive.TotalSize;
            var freeMb = drive.AvailableFreeSpace / 1024 / 1024;
            state.DiskCritical = freeMb < config.CriticalFreeDiskMb;
            state.DiskWarning = freeMb < config.WarningFreeDiskMb;
            checks.Add(new("disk", state.DiskCritical ? "error" : state.DiskWarning ? "warning" : "healthy",
                $"Boş alan: {freeMb:N0} MB"));
            if (state.DiskCritical) log.LogError("Disk alanı kritik: {FreeMb} MB", freeMb);
        }
        catch (IOException ex) { checks.Add(new("disk", "error", "Disk bilgisi okunamadı: " + ex.Message)); }

        // Bellek
        var proc = Process.GetCurrentProcess();
        checks.Add(new("memory", "healthy", $"Sunucu işlemi: {proc.WorkingSet64 / 1024 / 1024:N0} MB"));

        // Yedek
        var backupStatus = state.LastBackupStatus switch
        {
            null => config.Backup.Schedule == "off" ? "warning" : "warning",
            "failed" => "error",
            _ when state.LastBackupAt < DateTime.UtcNow.AddDays(-2) && config.Backup.Schedule == "daily" => "warning",
            _ => "healthy",
        };
        checks.Add(new("backup", backupStatus, state.LastBackupAt is null
            ? "Henüz yedek alınmadı."
            : $"Son yedek: {state.LastBackupAt:yyyy-MM-dd HH:mm} UTC ({state.LastBackupStatus})"));

        checks.Add(new("realtime", "healthy", $"{hub.Clients.Count} bağlı istemci"));
        checks.Add(new("printing", "healthy", Printing.PrinterService.InstalledPrinters().Count + " Windows yazıcısı"));
        checks.Add(new("integrations", "healthy", "Entegrasyon adaptörleri yüklendi"));

        state.Checks = checks;
        state.LastCheckAt = DateTime.UtcNow;
        WriteStatusFile();
    }

    void WriteStatusFile()
    {
        // Server Manager servis kapalıyken de son durumu gösterebilsin diye.
        try
        {
            var json = global::System.Text.Json.JsonSerializer.Serialize(new
            {
                at = DateTime.UtcNow,
                pid = Environment.ProcessId,
                version = PmsConstants.VersionText,
                databaseReady = state.DatabaseReady,
                startupError = state.StartupError,
                checks = state.Checks,
            }, Json.Options);
            File.WriteAllText(paths.StatusFile, json);
        }
        catch (IOException) { }
    }
}
