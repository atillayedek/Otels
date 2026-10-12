using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Platform;
using HotelPms.Shared;
using Npgsql;

namespace HotelPms.Server.Modules.Backup;

public sealed record BackupManifest(string Format, Guid Id, string Kind, DateTime CreatedAt, string AppVersion, string SchemaVersion,
    string DatabaseName, string DumpSha256, long DumpBytes, int StorageFiles, string MachineName);

public sealed record BackupDto(Guid Id, string Kind, string FileName, string Directory, long? SizeBytes, string? Sha256, string SchemaVersion,
    string AppVersion, string Status, string? Error, string? SecondaryStatus, DateTime StartedAt, DateTime? FinishedAt, string? Username);

public sealed record BackupFileInfo(string Path, string FileName, long SizeBytes, DateTime ModifiedAt, BackupManifest? Manifest, string? Problem);

/// <summary>
/// .hpbak = ZIP { manifest.json, database.dump (pg_dump custom), config/server.json, storage/** }.
/// Gizli anahtarlar (DPAPI) ve sertifika özel anahtarları pakete konmaz; geri yüklenen makinede yeniden üretilir.
/// </summary>
public sealed class BackupService(PmsPaths paths, ServerConfig config, SecretStore secrets, HealthState health, ILogger<BackupService> log)
{
    public const string Extension = ".hpbak";
    readonly SemaphoreSlim _gate = new(1, 1);

    PostgresTools Pg => new(paths, config, secrets);

    public string PrimaryDirectory => string.IsNullOrWhiteSpace(config.Backup.PrimaryDirectory) ? paths.DefaultBackupDir : config.Backup.PrimaryDirectory!;

    public async Task<Guid> CreateAsync(string kind, Guid? userId, CancellationToken ct)
    {
        if (!await _gate.WaitAsync(TimeSpan.FromMinutes(30), ct)) throw PmsException.Conflict("Başka bir yedekleme işlemi sürüyor.");
        try { return await CreateCoreAsync(kind, userId, ct); }
        finally { _gate.Release(); }
    }

    async Task<Guid> CreateCoreAsync(string kind, Guid? userId, CancellationToken ct)
    {
        if (!Pg.BinariesPresent) throw new PmsException(500, "pg_tools_missing", "PostgreSQL yedekleme araçları bulunamadı.");
        var id = Guid.NewGuid();
        var dir = PrimaryDirectory;
        Directory.CreateDirectory(dir);
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var fileName = $"{kind.ToUpperInvariant()}_{stamp}_{id.ToString()[..8]}{Extension}";
        var schema = MigrationRunner.LatestVersion;
        await using var conn = new NpgsqlConnection(Pg.OwnerConnectionString());
        await conn.OpenAsync(ct);
        var dbSchema = await conn.ExecuteScalarAsync<string?>("SELECT max(version) FROM public.schema_migrations") ?? schema;
        await conn.ExecuteAsync("""
            INSERT INTO pms.backups (id, kind, file_name, directory, schema_version, app_version, status, user_id)
            VALUES (@id, @kind, @fileName, @dir, @dbSchema, @app, 'running', @userId)
            """, new { id, kind, fileName, dir, dbSchema, app = PmsConstants.VersionText, userId });

        var work = Path.Combine(paths.DataRoot, "tmp", id.ToString("N"));
        Directory.CreateDirectory(work);
        var target = Path.Combine(dir, fileName);
        try
        {
            var dump = Path.Combine(work, "database.dump");
            var r = await Pg.DumpAsync(dump, ct);
            if (!r.Success) throw new InvalidOperationException("pg_dump başarısız: " + r.StdErr);
            var dumpHash = await Sha256Async(dump, ct);
            var storageFiles = Directory.Exists(paths.StorageDir) ? Directory.EnumerateFiles(paths.StorageDir, "*", SearchOption.AllDirectories).ToList() : [];
            var manifest = new BackupManifest("hotelpms-backup-v1", id, kind, DateTime.UtcNow, PmsConstants.VersionText, dbSchema, config.DbName, dumpHash,
                new FileInfo(dump).Length, storageFiles.Count, Environment.MachineName);

            var partial = target + ".partial";
            await using (var fs = new FileStream(partial, FileMode.CreateNew, FileAccess.Write))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                zip.CreateEntryFromFile(dump, "database.dump", CompressionLevel.NoCompression);
                var m = zip.CreateEntry("manifest.json");
                await using (var ms = m.Open()) await JsonSerializer.SerializeAsync(ms, manifest, Json.Options, ct);
                if (File.Exists(paths.ServerConfigFile)) zip.CreateEntryFromFile(paths.ServerConfigFile, "config/server.json");
                foreach (var f in storageFiles)
                    zip.CreateEntryFromFile(f, "storage/" + Path.GetRelativePath(paths.StorageDir, f).Replace('\\', '/'), CompressionLevel.Fastest);
            }
            File.Move(partial, target);
            var size = new FileInfo(target).Length;
            var fileHash = await Sha256Async(target, ct);
            await File.WriteAllTextAsync(target + ".sha256", $"{fileHash}  {fileName}\n", ct);

            string? secondary = null;
            if (!string.IsNullOrWhiteSpace(config.Backup.SecondaryDirectory))
            {
                try
                {
                    Directory.CreateDirectory(config.Backup.SecondaryDirectory!);
                    File.Copy(target, Path.Combine(config.Backup.SecondaryDirectory!, fileName), overwrite: false);
                    File.Copy(target + ".sha256", Path.Combine(config.Backup.SecondaryDirectory!, fileName + ".sha256"), overwrite: true);
                    secondary = "ok";
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // İkincil konum (ör. ağ klasörü) erişilemezse yedek yine de yereldedir; hata raporlanır.
                    secondary = "error: İkincil konuma kopyalanamadı (" + ex.GetType().Name + ")";
                    log.LogError(ex, "Yedek ikincil konuma kopyalanamadı {Dir}", config.Backup.SecondaryDirectory);
                }
            }
            await conn.ExecuteAsync("""
                UPDATE pms.backups SET status = 'completed', size_bytes = @size, sha256 = @fileHash, secondary_status = @secondary, finished_at = now() WHERE id = @id
                """, new { id, size, fileHash, secondary });
            log.LogInformation("Yedek oluşturuldu {Kind} {File} {Size}", kind, fileName, size);
            health.LastBackupAt = DateTime.UtcNow;
            health.LastBackupStatus = "completed";
            ApplyRotation(kind);
            return id;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Yedekleme başarısız {Kind}", kind);
            if (File.Exists(target + ".partial")) File.Delete(target + ".partial");
            await conn.ExecuteAsync("UPDATE pms.backups SET status = 'failed', error = @err, finished_at = now() WHERE id = @id",
                new { id, err = ex is IOException io && io.HResult == unchecked((int)0x80070070) ? "Disk dolu" : "Yedekleme başarısız. Ayrıntı sunucu logunda." });
            if (kind is "manual" or "scheduled") { health.LastBackupStatus = "failed"; }
            throw new PmsException(500, "backup_failed", "Yedekleme başarısız oldu. Ayrıntı sunucu logundadır.");
        }
        finally
        {
            try { Directory.Delete(work, true); } catch (IOException) { }
        }
    }

    /// <summary>Tür başına en eski yedekleri siler (yalnız bu sistemin ürettiği .hpbak dosyaları).</summary>
    void ApplyRotation(string kind)
    {
        var keep = kind switch { "scheduled" => config.Backup.KeepScheduled, "manual" => config.Backup.KeepManual, _ => config.Backup.KeepSystem };
        if (keep <= 0) return;
        foreach (var dir in new[] { PrimaryDirectory, config.Backup.SecondaryDirectory }.Where(d => !string.IsNullOrWhiteSpace(d) && Directory.Exists(d)))
        {
            try
            {
                var files = Directory.GetFiles(dir!, $"{kind.ToUpperInvariant()}_*{Extension}").OrderByDescending(File.GetCreationTimeUtc).Skip(keep);
                foreach (var f in files)
                {
                    File.Delete(f);
                    if (File.Exists(f + ".sha256")) File.Delete(f + ".sha256");
                    log.LogInformation("Rotasyon: eski yedek silindi {File}", Path.GetFileName(f));
                }
            }
            catch (IOException ex) { log.LogWarning(ex, "Yedek rotasyonu uygulanamadı {Dir}", dir); }
        }
    }

    public IReadOnlyList<BackupFileInfo> ListFiles()
    {
        var dirs = new[] { PrimaryDirectory, config.Backup.SecondaryDirectory }.Where(d => !string.IsNullOrWhiteSpace(d) && Directory.Exists(d)).Distinct();
        var list = new List<BackupFileInfo>();
        foreach (var d in dirs)
            foreach (var f in Directory.GetFiles(d!, "*" + Extension))
                list.Add(Inspect(f));
        return list.OrderByDescending(f => f.ModifiedAt).ToList();
    }

    public static BackupFileInfo Inspect(string file)
    {
        var fi = new FileInfo(file);
        try
        {
            using var zip = ZipFile.OpenRead(file);
            var m = zip.GetEntry("manifest.json") ?? throw new InvalidDataException("manifest yok");
            using var s = m.Open();
            var manifest = JsonSerializer.Deserialize<BackupManifest>(s, Json.Options);
            if (zip.GetEntry("database.dump") is null) return new(file, fi.Name, fi.Length, fi.LastWriteTimeUtc, manifest, "Veritabanı dökümü eksik");
            return new(file, fi.Name, fi.Length, fi.LastWriteTimeUtc, manifest, null);
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or JsonException)
        {
            return new(file, fi.Name, fi.Length, fi.LastWriteTimeUtc, null, "Geçerli bir HotelPMS yedeği değil veya dosya bozuk");
        }
    }

    /// <summary>
    /// Geri yükleme: paket doğrulanır, şema uyumluluğu kontrol edilir, mevcut veritabanının acil yedeği alınır,
    /// döküm ayrı bir veritabanına açılır; ancak başarıyla açılırsa canlı veritabanıyla yer değiştirilir.
    /// Eski veritabanı silinmez, yeniden adlandırılarak korunur.
    /// </summary>
    public async Task<string> RestoreAsync(string file, Guid? userId, Func<Task> onBeforeSwap, Func<Task> onAfterSwap, CancellationToken ct)
    {
        if (!await _gate.WaitAsync(TimeSpan.FromMinutes(5), ct)) throw PmsException.Conflict("Başka bir yedekleme/geri yükleme işlemi sürüyor.");
        try
        {
            var info = Inspect(file);
            if (info.Problem is not null || info.Manifest is null) throw PmsException.Validation(info.Problem ?? "Yedek okunamadı.");
            var m = info.Manifest;
            if (m.Format != "hotelpms-backup-v1") throw PmsException.Validation("Yedek biçimi desteklenmiyor.");
            var latest = MigrationRunner.LatestVersion;
            if (string.CompareOrdinal(m.SchemaVersion, latest) > 0)
                throw PmsException.Validation($"Yedek daha yeni bir PMS sürümüne ait (şema {m.SchemaVersion}). Önce PMS'i güncelleyin. Uyumsuz yedek geri yüklenmedi.");

            var work = Path.Combine(paths.DataRoot, "tmp", "restore-" + Guid.NewGuid().ToString("N")[..8]);
            Directory.CreateDirectory(work);
            try
            {
                using (var zip = ZipFile.OpenRead(file))
                {
                    zip.GetEntry("database.dump")!.ExtractToFile(Path.Combine(work, "database.dump"));
                    foreach (var e in zip.Entries.Where(e => e.FullName.StartsWith("storage/") && !string.IsNullOrEmpty(e.Name)))
                    {
                        var dest = Path.GetFullPath(Path.Combine(work, "storage", e.FullName["storage/".Length..]));
                        if (!dest.StartsWith(Path.GetFullPath(Path.Combine(work, "storage")) + Path.DirectorySeparatorChar))
                            throw PmsException.Validation("Yedek paketinde geçersiz dosya yolu.");
                        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                        e.ExtractToFile(dest);
                    }
                }
                var dumpHash = await Sha256Async(Path.Combine(work, "database.dump"), ct);
                if (!string.Equals(dumpHash, m.DumpSha256, StringComparison.OrdinalIgnoreCase))
                    throw PmsException.Validation("Yedek bütünlük kontrolünden geçemedi (SHA-256 uyuşmuyor). Dosya bozuk olabilir.");

                // Mevcut veri kaybolmasın.
                await CreateCoreAsync("pre_restore", userId, ct);

                var tempDb = $"{config.DbName}_restore_{DateTime.Now:yyyyMMddHHmmss}";
                await using (var c = new NpgsqlConnection(Pg.OwnerConnectionString("postgres")))
                {
                    await c.OpenAsync(ct);
                    await c.ExecuteAsync($"CREATE DATABASE {tempDb} OWNER {config.DbOwnerUser} ENCODING 'UTF8' TEMPLATE template0");
                }
                var r = await Pg.RestoreAsync(Path.Combine(work, "database.dump"), tempDb, ct);
                if (!r.Success)
                {
                    await DropDatabaseAsync(tempDb, ct);
                    log.LogError("pg_restore başarısız: {Err}", r.StdErr);
                    throw new PmsException(500, "restore_failed", "Yedek açılamadı; canlı veritabanına dokunulmadı.");
                }

                await onBeforeSwap();
                var oldName = $"{config.DbName}_before_restore_{DateTime.Now:yyyyMMddHHmmss}";
                NpgsqlConnection.ClearAllPools();
                await using (var c = new NpgsqlConnection(Pg.OwnerConnectionString("postgres")))
                {
                    await c.OpenAsync(ct);
                    await c.ExecuteAsync("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", new { db = config.DbName });
                    await c.ExecuteAsync($"ALTER DATABASE {config.DbName} RENAME TO {oldName}");
                    await c.ExecuteAsync($"ALTER DATABASE {tempDb} RENAME TO {config.DbName}");
                    await c.ExecuteAsync($"REVOKE ALL ON DATABASE {config.DbName} FROM PUBLIC");
                    await c.ExecuteAsync($"GRANT CONNECT, TEMPORARY ON DATABASE {config.DbName} TO {config.DbAppUser}");
                    await c.ExecuteAsync($"REVOKE CONNECT ON DATABASE {oldName} FROM PUBLIC, {config.DbAppUser}");
                }

                // Belgeler: mevcut klasör korunur, yedekteki belgelerle değiştirilir.
                var restoredStorage = Path.Combine(work, "storage");
                if (Directory.Exists(paths.StorageDir))
                    Directory.Move(paths.StorageDir, paths.StorageDir + "_before_restore_" + DateTime.Now.ToString("yyyyMMddHHmmss"));
                if (Directory.Exists(restoredStorage)) Directory.Move(restoredStorage, paths.StorageDir);
                else Directory.CreateDirectory(paths.StorageDir);

                await onAfterSwap();
                log.LogWarning("Geri yükleme tamamlandı: {File}. Önceki veritabanı {Old} adıyla korunuyor.", Path.GetFileName(file), oldName);
                return oldName;
            }
            finally
            {
                try { Directory.Delete(work, true); } catch (IOException) { }
            }
        }
        finally { _gate.Release(); }
    }

    async Task DropDatabaseAsync(string db, CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(Pg.OwnerConnectionString("postgres"));
        await c.OpenAsync(ct);
        await c.ExecuteAsync($"DROP DATABASE IF EXISTS {db}");
    }

    static async Task<string> Sha256Async(string file, CancellationToken ct)
    {
        await using var fs = File.OpenRead(file);
        return Convert.ToHexString(await SHA256.HashDataAsync(fs, ct));
    }
}

/// <summary>Zamanlanmış yedek: tesisin yerel saatine göre günlük/haftalık/aylık.</summary>
public sealed class BackupScheduler(BackupService backups, ServerConfig config, HealthState health, Db db, ILogger<BackupScheduler> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), ct);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (health.DatabaseReady && config.Backup.Schedule != "off" && await IsDueAsync(ct))
                    await backups.CreateAsync("scheduled", null, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Zamanlanmış yedek alınamadı"); }
            await Task.Delay(TimeSpan.FromMinutes(1), ct);
        }
    }

    async Task<bool> IsDueAsync(CancellationToken ct)
    {
        var now = DateTime.Now;
        if (!TimeOnly.TryParse(config.Backup.Time, out var at)) at = new TimeOnly(3, 0);
        DateTime periodStart = config.Backup.Schedule switch
        {
            "weekly" => now.Date.AddDays(-(((int)now.DayOfWeek - (int)config.Backup.WeeklyDay + 7) % 7)),
            "monthly" => new DateTime(now.Year, now.Month, Math.Min(config.Backup.MonthlyDay, DateTime.DaysInMonth(now.Year, now.Month))),
            _ => now.Date,
        };
        var due = periodStart.Add(at.ToTimeSpan());
        if (now < due) return false;
        var last = await db.ScalarAsync<DateTime?>("SELECT max(started_at) FROM pms.backups WHERE kind = 'scheduled' AND status = 'completed'", ct: ct);
        return last is null || last.Value.ToLocalTime() < due;
    }
}
