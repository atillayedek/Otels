using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Backup;
using HotelPms.Server.Realtime;
using HotelPms.Shared;
using Npgsql;

namespace HotelPms.Server.Modules.Migration;

public sealed record ImportJobDto(Guid Id, long JobNo, string Entity, string Status, string SourceType, string SourceLabel, JsonElement SourceMeta,
    JsonElement Options, JsonElement? Mapping, string DuplicatePolicy, int TotalRows, int ValidRows, int ImportedRows, int UpdatedRows, int SkippedRows,
    int FailedRows, int ReviewRows, int DuplicateRows, Guid? BackupId, DateTime CreatedAt, string? CreatedBy, DateTime? StartedAt, DateTime? FinishedAt,
    DateTime? RolledBackAt, string? Error);

public sealed record StagingRowDto(int RowNo, JsonElement Raw, JsonElement? Mapped, string Status, Guid? DuplicateOf, int? DuplicateScore,
    string? DuplicateReason, string? ReviewDecision, Guid? TargetId, string? Errors);

public sealed record ImportErrorDto(long Id, int? RowNo, string? Field, string? Value, string Reason, string Severity);

public sealed record StageRequest(SourceOptions Source, IReadOnlyList<FieldMapping> Mapping, string DuplicatePolicy);

public sealed record ImportIssue(string? Field, string? Value, string Reason, string Severity);

public sealed record RollbackResult(int Deleted, int Restored, int Blocked, IReadOnlyList<string> BlockedDetails);

/// <summary>Veri Aktarım Merkezi iş akışı. Kaynak → staging → doğrulama → eşleştirme → çakışma → üretim aktarımı.</summary>
public sealed class ImportService(Db db, PmsPaths paths, ServerConfig cfg, BackupService backups, RealtimeHub hub, ILogger<ImportService> log)
{
    // Eski sistem veritabanı parolaları yalnız bellekte ve sınırlı süre tutulur; diske, loglara ve veritabanına yazılmaz.
    readonly ConcurrentDictionary<Guid, (DbSourceConnection Conn, DateTime Expires)> _dbCredentials = new();
    readonly ConcurrentDictionary<Guid, Task> _running = new();
    const int BatchSize = 500;

    public static readonly string[] FileTypes = ["csv", "xlsx", "xls", "json", "xml"];

    public const string JobSelect = """
        SELECT j.id, j.job_no, j.entity, j.status, j.source_type, j.source_label, j.source_meta, j.options, j.mapping, j.duplicate_policy,
               j.total_rows, j.valid_rows, j.imported_rows, j.updated_rows, j.skipped_rows, j.failed_rows, j.review_rows, j.duplicate_rows,
               j.backup_id, j.created_at, u.username AS created_by, j.started_at, j.finished_at, j.rolled_back_at, j.error
        FROM pms.import_jobs j LEFT JOIN pms.users u ON u.id = j.created_by
        """;

    // ------------------------------------------------------------------ Kaynak açma
    public async Task<Guid> CreateFileJobAsync(Stream content, string fileName, string entity, Guid userId, CancellationToken ct)
    {
        MappingCatalog.Fields(entity);
        var ext = Path.GetExtension(fileName).ToLowerInvariant().TrimStart('.');
        if (!FileTypes.Contains(ext)) throw PmsException.Validation("Desteklenen dosya türleri: CSV, XLSX, XLS, JSON, XML.");
        var id = Guid.NewGuid();
        var dir = Path.Combine(paths.ImportsDir, id.ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "source." + ext);
        long size;
        string sha;
        await using (var fs = new FileStream(path, FileMode.CreateNew))
        {
            using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buf = new byte[81920];
            int n;
            size = 0;
            while ((n = await content.ReadAsync(buf, ct)) > 0)
            {
                size += n;
                if (size > cfg.MaxImportBytes) throw PmsException.Validation($"Dosya en fazla {cfg.MaxImportBytes / 1024 / 1024} MB olabilir.");
                hasher.AppendData(buf, 0, n);
                await fs.WriteAsync(buf.AsMemory(0, n), ct);
            }
            sha = Convert.ToHexString(hasher.GetHashAndReset());
        }
        if (size == 0) throw PmsException.Validation("Dosya boş.");
        if (ext is "xlsx" && !HasZipSignature(path)) throw PmsException.Validation("Geçersiz Excel (XLSX) dosyası.");
        var safeName = Path.GetFileName(fileName);
        if (safeName.Length > 150) safeName = safeName[..150];
        await using var c = await db.OpenAsync(ct);
        await c.ExecuteAsync("""
            INSERT INTO pms.import_jobs (id, entity, status, source_type, source_label, source_meta, created_by)
            VALUES (@id, @entity, 'analyzed', @ext, @safeName, @meta::jsonb, @userId)
            """, new { id, entity, ext, safeName, userId, meta = JsonSerializer.Serialize(new { fileName = safeName, sha256 = sha, sizeBytes = size, uploadedAt = DateTime.UtcNow }) });
        await AuditAsync(c, userId, "import.create", id, new { entity, source = safeName, sha256 = sha });
        return id;
    }

    static bool HasZipSignature(string path)
    {
        using var fs = File.OpenRead(path);
        var b = new byte[4];
        return fs.Read(b, 0, 4) == 4 && b[0] == 0x50 && b[1] == 0x4B;
    }

    public async Task<Guid> CreateDbJobAsync(DbSourceConnection conn, string entity, Guid userId, CancellationToken ct)
    {
        MappingCatalog.Fields(entity);
        // Bağlantı testi ve tablo listesi.
        using (var src = new DbSource(conn)) src.ListTables();
        var id = Guid.NewGuid();
        _dbCredentials[id] = (conn, DateTime.UtcNow.AddHours(4));
        var label = conn.SourceType switch
        {
            "sqlite" => Path.GetFileName(conn.FilePath ?? ""),
            "odbc" => conn.Dsn ?? Path.GetFileName(conn.FilePath ?? ""),
            _ => $"{conn.Host}/{conn.Database}",
        };
        await using var c = await db.OpenAsync(ct);
        await c.ExecuteAsync("""
            INSERT INTO pms.import_jobs (id, entity, status, source_type, source_label, source_meta, created_by)
            VALUES (@id, @entity, 'analyzed', @type, @label, @meta::jsonb, @userId)
            """, new
        {
            id, entity, type = conn.SourceType, label, userId,
            // Parola kaydedilmez.
            meta = JsonSerializer.Serialize(new { host = conn.Host, port = conn.Port, database = conn.Database, username = conn.Username, dsn = conn.Dsn,
                file = conn.FilePath is null ? null : Path.GetFileName(conn.FilePath), connectedAt = DateTime.UtcNow, readOnly = true }),
        });
        await AuditAsync(c, userId, "import.create", id, new { entity, source = label, type = conn.SourceType });
        return id;
    }

    async Task<ImportJobDto> JobAsync(Guid id) =>
        await db.QuerySingleOrDefaultAsync<ImportJobDto>(JobSelect + " WHERE j.id = @id", new { id }) ?? throw PmsException.NotFound("Aktarım işi");

    ISourceReader OpenSource(ImportJobDto job)
    {
        if (FileTypes.Contains(job.SourceType))
        {
            var path = Path.Combine(paths.ImportsDir, job.Id.ToString("N"), "source." + job.SourceType);
            if (!File.Exists(path)) throw PmsException.Validation("Kaynak dosya artık mevcut değil. Yeni bir aktarım başlatın.");
            return job.SourceType switch
            {
                "csv" => new CsvSource(path),
                "xlsx" or "xls" => new ExcelSource(path),
                "json" => new JsonSource(path),
                "xml" => new XmlSource(path),
                _ => throw new InvalidOperationException(),
            };
        }
        if (!_dbCredentials.TryGetValue(job.Id, out var cred) || cred.Expires < DateTime.UtcNow)
            throw PmsException.Validation("Eski sistem bağlantı bilgisi güvenlik nedeniyle saklanmaz ve süresi doldu. Bağlantıyı yeniden kurun.");
        return new DbSource(cred.Conn);
    }

    public async Task<(SourceInspection Inspection, IReadOnlyList<MappingSuggestion> Suggestions)> InspectAsync(Guid id, SourceOptions options)
    {
        var job = await JobAsync(id);
        return await Task.Run(() =>
        {
            using var src = OpenSource(job);
            var tables = src.ListTables();
            var o = options.Table is null && tables.Count > 0 ? options with { Table = tables[0].Name } : options;
            var (cols, rows) = src.Read(o, limit: 20);
            var preview = rows.ToList();
            var warnings = new List<string>();
            var moj = preview.Sum(r => r.Count(TurkishEncoding.LooksMojibake)) + cols.Count(TurkishEncoding.LooksMojibake);
            if (moj > 0) warnings.Add($"{moj} hücrede bozuk Türkçe karakter (ör. 'Ã¼') tespit edildi. Dosya kodlamasını değiştirin veya ilgili alanlarda 'Karakter düzelt' dönüşümünü seçin.");
            if (preview.Any(r => r.Any(v => v?.Contains('�') == true)))
                warnings.Add("Okunamayan karakterler var (�). Karakter kodlamasını Windows-1254 veya ISO-8859-9 olarak deneyin.");
            if (preview.Count == 0) warnings.Add("Başlık satırından sonra veri bulunamadı.");
            var inspection = new SourceInspection(tables, o.Table, cols, preview, src.DetectedEncoding, src.DetectedSeparator, warnings, moj);
            return (inspection, MappingCatalog.Suggest(job.Entity, cols));
        });
    }

    // ------------------------------------------------------------------ Staging + doğrulama ("Kontrol Et": üretime yazmaz)
    public async Task<ImportJobDto> StageAsync(Guid id, StageRequest req, Guid userId, CancellationToken ct)
    {
        var job = await JobAsync(id);
        if (job.Status is "importing" or "completed" or "completed_with_errors" or "rolled_back")
            throw PmsException.Validation("Bu aktarım işi artık yeniden hazırlanamaz.");
        if (req.DuplicatePolicy is not ("skip" or "update" or "create" or "review")) throw PmsException.Validation("Geçersiz mükerrer kayıt politikası.");
        var fields = MappingCatalog.Fields(job.Entity);
        foreach (var m in req.Mapping)
            if (fields.All(f => f.Key != m.Target)) throw PmsException.Validation($"Geçersiz hedef alan: {m.Target}");
        foreach (var f in fields.Where(f => f.Required))
        {
            var ok = req.Mapping.Any(m => m.Target == f.Key && (m.Source is not null || m.Constant is not null))
                     || (job.Entity == "guests" && f.Key is "first_name" or "last_name" && req.Mapping.Any(m => m.Target == "full_name" && m.Source is not null));
            if (!ok) throw PmsException.Validation($"Zorunlu alan eşleştirilmedi: {f.Label}");
        }

        await using var c = await db.OpenAsync(ct);
        await c.ExecuteAsync("DELETE FROM pms.import_staging_rows WHERE job_id = @id; DELETE FROM pms.import_errors WHERE job_id = @id;", new { id });

        // 1) Kaynağı staging'e al (ham veri; orijinal değer korunur).
        var total = await Task.Run(async () =>
        {
            using var src = OpenSource(job);
            var (cols, rows) = src.Read(req.Source);
            var missing = req.Mapping.Where(m => m.Source is not null && !cols.Contains(m.Source)).Select(m => m.Source).ToList();
            if (missing.Count > 0) throw PmsException.Validation("Kaynakta bulunmayan sütun: " + string.Join(", ", missing));
            var rowNo = 0;
            var batch = new List<(int, string)>(1000);
            foreach (var r in rows)
            {
                rowNo++;
                var obj = new Dictionary<string, string?>(cols.Count);
                for (var i = 0; i < cols.Count; i++) obj[cols[i]] = r[i];
                batch.Add((rowNo, JsonSerializer.Serialize(obj, Json.Options)));
                if (batch.Count >= 1000) { await InsertStagingAsync(c, id, batch); batch.Clear(); }
            }
            if (batch.Count > 0) await InsertStagingAsync(c, id, batch);
            return rowNo;
        }, ct);

        await c.ExecuteAsync("""
            UPDATE pms.import_jobs SET status = 'staged', options = @opts::jsonb, mapping = @map::jsonb, duplicate_policy = @pol, total_rows = @total, version = version + 1
            WHERE id = @id
            """, new { id, opts = JsonSerializer.Serialize(req.Source, Json.Options), map = JsonSerializer.Serialize(req.Mapping, Json.Options), pol = req.DuplicatePolicy, total });

        // 2) Doğrula, eşleştir, mükerrerleri bul.
        await ValidateAllAsync(c, job.Entity, id, req.Mapping, req.DuplicatePolicy, ct);
        await RefreshCountsAsync(c, id, "validated");
        await AuditAsync(c, userId, "import.validate", id, new { total });
        hub.Broadcast(new RealtimeEvent("imports", id.ToString()));
        return await JobAsync(id);
    }

    static async Task InsertStagingAsync(NpgsqlConnection c, Guid id, List<(int RowNo, string Json)> batch) =>
        await c.ExecuteAsync("""
            INSERT INTO pms.import_staging_rows (job_id, row_no, raw)
            SELECT @id, r, j::jsonb FROM unnest(@rows, @jsons) AS t(r, j)
            """, new { id, rows = batch.Select(b => b.RowNo).ToArray(), jsons = batch.Select(b => b.Json).ToArray() });


    async Task ValidateAllAsync(NpgsqlConnection c, string entity, Guid id, IReadOnlyList<FieldMapping> mapping, string policy, CancellationToken ct)
    {
        var lookups = await Lookups.LoadAsync(c, entity);
        var seenKeys = new Dictionary<string, int>();
        var bd = await c.ExecuteScalarAsync<DateTime>("SELECT business_date FROM pms.property LIMIT 1");
        var businessDate = DateOnly.FromDateTime(bd);
        var last = 0;
        while (true)
        {
            var rows = (await c.QueryAsync<(int RowNo, string Raw)>(
                "SELECT row_no, raw::text FROM pms.import_staging_rows WHERE job_id = @id AND row_no > @last ORDER BY row_no LIMIT @n",
                new { id, last, n = BatchSize })).ToList();
            if (rows.Count == 0) break;
            last = rows[^1].RowNo;
            var prepared = new List<(int RowNo, Dictionary<string, string?> Mapped, List<ImportIssue> Issues)>();
            foreach (var row in rows)
            {
                var raw = JsonSerializer.Deserialize<Dictionary<string, string?>>(row.Raw)!;
                var issues = new List<ImportIssue>();
                var mapped = MapRow(entity, raw, mapping, issues);
                Validator.Check(entity, mapped, issues, lookups, businessDate);
                prepared.Add((row.RowNo, mapped, issues));
            }
            var dups = await Duplicates.FindAsync(c, entity, prepared.Select(p => p.Mapped).ToList());

            await using var tx = await c.BeginTransactionAsync(ct);
            for (var i = 0; i < prepared.Count; i++)
            {
                var (rowNo, mapped, issues) = prepared[i];
                var errors = issues.Where(x => x.Severity == "error").ToList();
                string status = errors.Count > 0 ? "invalid" : "valid";
                Guid? dupOf = null;
                int? score = null;
                string? reason = null;
                if (status == "valid")
                {
                    var key = Duplicates.InFileKey(entity, mapped);
                    if (key is not null && seenKeys.TryGetValue(key, out var firstRow))
                    {
                        status = "needs_review";
                        reason = $"Dosya içinde {firstRow}. satırla aynı ({key.Split(':')[0]})";
                        score = 90;
                    }
                    else if (key is not null) seenKeys[key] = rowNo;

                    if (status == "valid" && dups[i] is { } d)
                    {
                        dupOf = d.Id;
                        score = d.Score;
                        reason = d.Reason;
                        // Kesin eşleşme (kimlik/kod) politikaya göre işlenir; kesin olmayan eşleşme her zaman incelemeye düşer.
                        status = d.Score >= 100
                            ? policy switch { "skip" => "skipped", "review" => "needs_review", _ => "valid" }
                            : policy == "create" ? "valid" : "needs_review";
                    }
                }
                await c.ExecuteAsync("""
                    UPDATE pms.import_staging_rows SET mapped = @mapped::jsonb, status = @status, duplicate_of = @dupOf, duplicate_score = @score,
                        duplicate_reason = @reason, review_decision = NULL
                    WHERE job_id = @id AND row_no = @rowNo
                    """, new { id, rowNo, mapped = JsonSerializer.Serialize(mapped, Json.Options), status, dupOf, score, reason }, tx);
                foreach (var e in issues)
                    await c.ExecuteAsync("INSERT INTO pms.import_errors (job_id, row_no, field, value, reason, severity) VALUES (@id, @rowNo, @Field, @Value, @Reason, @Severity)",
                        new { id, rowNo, e.Field, Value = e.Value is { Length: > 200 } v ? v[..200] : e.Value, e.Reason, e.Severity }, tx);
            }
            await tx.CommitAsync(ct);
        }
    }

    static Dictionary<string, string?> MapRow(string entity, Dictionary<string, string?> raw, IReadOnlyList<FieldMapping> mapping, List<ImportIssue> issues)
    {
        var fields = MappingCatalog.Fields(entity).ToDictionary(f => f.Key);
        var mapped = new Dictionary<string, string?>();
        foreach (var m in mapping)
        {
            var field = fields[m.Target];
            var source = m.Source is null ? m.Constant : raw.GetValueOrDefault(m.Source);
            if (source is not null && source.Contains('�'))
                issues.Add(new ImportIssue(m.Target, source, "Karakter kodlama sorunu (okunamayan karakter)", "warning"));
            try
            {
                var value = Transform.Apply(source, m.Transform, m.Format, field.Type);
                if (value is not null) mapped[m.Target] = value;
            }
            catch (FormatException ex)
            {
                // Zorunlu alanlarda hata; isteğe bağlı alanda uyarı ve orijinal değer nota eklenir (veri kaybı yok).
                issues.Add(new ImportIssue(m.Target, source, ex.Message, field.Required ? "error" : "warning"));
                if (!field.Required) mapped["__lost_" + m.Target] = source;
            }
        }
        if (entity == "guests" && mapped.TryGetValue("full_name", out var full) && full is not null)
        {
            var (first, lastName) = Transform.SplitName(full);
            mapped.TryAdd("first_name", first);
            mapped.TryAdd("last_name", lastName);
        }
        return mapped;
    }

    public async Task SetDecisionAsync(Guid id, int rowNo, string decision, Guid userId)
    {
        if (decision is not ("skip" or "update" or "create")) throw PmsException.Validation("Geçersiz karar.");
        await using var c = await db.OpenAsync();
        var status = await c.ExecuteScalarAsync<string?>("SELECT status FROM pms.import_staging_rows WHERE job_id = @id AND row_no = @rowNo", new { id, rowNo })
            ?? throw PmsException.NotFound("Satır");
        if (status != "needs_review") throw PmsException.Validation("Yalnız 'İncelenmeli' durumundaki satırlar için karar verilebilir.");
        if (decision == "update" && await c.ExecuteScalarAsync<Guid?>("SELECT duplicate_of FROM pms.import_staging_rows WHERE job_id = @id AND row_no = @rowNo", new { id, rowNo }) is null)
            throw PmsException.Validation("Güncellenecek mevcut kayıt yok (dosya içi tekrar). 'Atla' veya 'Yeni oluştur' seçin.");
        await c.ExecuteAsync("UPDATE pms.import_staging_rows SET review_decision = @decision WHERE job_id = @id AND row_no = @rowNo", new { id, rowNo, decision });
        await AuditAsync(c, userId, "import.review_decision", id, new { rowNo, decision });
    }

    async Task RefreshCountsAsync(NpgsqlConnection c, Guid id, string? status = null, NpgsqlTransaction? tx = null) =>
        await c.ExecuteAsync("""
            UPDATE pms.import_jobs j SET
                valid_rows = s.valid, review_rows = s.review, failed_rows = s.failed, skipped_rows = s.skipped, imported_rows = s.imported,
                updated_rows = s.updated, duplicate_rows = s.dup, status = COALESCE(@status, j.status), version = j.version + 1
            FROM (SELECT count(*) FILTER (WHERE status = 'valid')::int AS valid,
                         count(*) FILTER (WHERE status = 'needs_review' AND review_decision IS NULL)::int AS review,
                         count(*) FILTER (WHERE status IN ('invalid','failed'))::int AS failed,
                         count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
                         count(*) FILTER (WHERE status = 'imported')::int AS imported,
                         count(*) FILTER (WHERE status = 'updated')::int AS updated,
                         count(*) FILTER (WHERE duplicate_of IS NOT NULL OR duplicate_reason IS NOT NULL)::int AS dup
                  FROM pms.import_staging_rows WHERE job_id = @id) s
            WHERE j.id = @id
            """, new { id, status }, tx);

    // ------------------------------------------------------------------ Üretime aktarım
    public async Task StartExecuteAsync(Guid id, Guid userId)
    {
        var job = await JobAsync(id);
        if (job.Status != "validated") throw PmsException.Validation("Aktarım için önce 'Kontrol Et' (doğrulama) adımı tamamlanmalıdır.");
        if (_running.ContainsKey(id)) throw PmsException.Conflict("Bu aktarım zaten çalışıyor.");
        await using (var c = await db.OpenAsync())
        {
            var n = await c.ExecuteAsync("UPDATE pms.import_jobs SET status = 'importing', started_at = now(), error = NULL, version = version + 1 WHERE id = @id AND status = 'validated'", new { id });
            if (n == 0) throw PmsException.Conflict("Aktarım başka bir kullanıcı tarafından başlatıldı.");
        }
        var task = Task.Run(async () =>
        {
            try { await ExecuteAsync(job, userId); }
            catch (Exception ex)
            {
                log.LogError(ex, "Aktarım başarısız {JobId}", id);
                await using var c = await db.OpenAsync();
                await RefreshCountsAsync(c, id, "failed");
                await c.ExecuteAsync("UPDATE pms.import_jobs SET error = @err, finished_at = now() WHERE id = @id",
                    new { id, err = ex is PmsException pe ? pe.Message : "Aktarım yarıda kesildi. Tamamlanan batch'ler kalıcıdır; ayrıntı sunucu logunda." });
            }
            finally
            {
                _running.TryRemove(id, out _);
                hub.Broadcast(new RealtimeEvent("imports", id.ToString()));
            }
        });
        _running[id] = task;
    }

    async Task ExecuteAsync(ImportJobDto job, Guid userId)
    {
        var id = job.Id;
        // Her aktarım öncesi tam PMS yedeği; yedek alınamazsa aktarım başlamaz.
        var backupId = await backups.CreateAsync("pre_import", userId, CancellationToken.None);
        await using var c = await db.OpenAsync();
        await c.ExecuteAsync("UPDATE pms.import_jobs SET backup_id = @backupId WHERE id = @id", new { id, backupId });
        var label = $"{job.SourceType}:{job.SourceLabel}";
        var currency = await c.ExecuteScalarAsync<string>("SELECT currency::text FROM pms.property LIMIT 1") ?? throw PmsException.Validation("Tesis tanımlı değil.");
        var batchNo = await c.ExecuteScalarAsync<int>("SELECT COALESCE(max(batch_no), 0) FROM pms.import_batches WHERE job_id = @id", new { id });
        var last = 0;
        while (true)
        {
            var rows = (await c.QueryAsync<(int RowNo, string Mapped, string Status, Guid? DuplicateOf, string? Decision)>("""
                SELECT row_no, mapped::text, status, duplicate_of, review_decision FROM pms.import_staging_rows
                WHERE job_id = @id AND row_no > @last AND (status = 'valid' OR (status = 'needs_review' AND review_decision IS NOT NULL))
                ORDER BY row_no LIMIT @n
                """, new { id, last, n = BatchSize })).ToList();
            if (rows.Count == 0) break;
            last = rows[^1].RowNo;
            batchNo++;
            await using var tx = await c.BeginTransactionAsync();
            var writer = new EntityWriter(c, tx, id, label, userId, batchNo, currency);
            foreach (var r in rows)
            {
                var mapped = JsonSerializer.Deserialize<Dictionary<string, string?>>(r.Mapped)!;
                var action = r.Status == "needs_review" ? r.Decision! : r.DuplicateOf is not null ? job.DuplicatePolicy switch
                {
                    "update" => "update",
                    _ => "create",
                } : "create";
                await c.ExecuteAsync("SAVEPOINT row_sp", transaction: tx);
                try
                {
                    if (action == "skip")
                    {
                        await c.ExecuteAsync("UPDATE pms.import_staging_rows SET status = 'skipped', batch_no = @batchNo WHERE job_id = @id AND row_no = @RowNo",
                            new { id, batchNo, r.RowNo }, tx);
                    }
                    else
                    {
                        var (targetId, done) = await writer.WriteAsync(job.Entity, r.RowNo, mapped, action == "update" ? r.DuplicateOf : null);
                        await c.ExecuteAsync("UPDATE pms.import_staging_rows SET status = @done, target_id = @targetId, batch_no = @batchNo WHERE job_id = @id AND row_no = @RowNo",
                            new { id, done, targetId, batchNo, r.RowNo }, tx);
                    }
                    await c.ExecuteAsync("RELEASE SAVEPOINT row_sp", transaction: tx);
                }
                catch (Exception ex) when (ex is PostgresException or PmsException or FormatException)
                {
                    await c.ExecuteAsync("ROLLBACK TO SAVEPOINT row_sp", transaction: tx);
                    var reason = ex switch
                    {
                        PmsException p => p.Message,
                        FormatException f => f.Message,
                        PostgresException { SqlState: "23P01" } => "Oda aynı tarihlerde başka bir rezervasyona atanmış.",
                        PostgresException { SqlState: "23505" } => "Benzersiz alan çakışması (kayıt zaten var).",
                        PostgresException { SqlState: "23514" } => "Değer veri kurallarına uymuyor.",
                        PostgresException { SqlState: "23503" } => "İlişkili kayıt bulunamadı.",
                        _ => "Kayıt yazılamadı.",
                    };
                    await c.ExecuteAsync("UPDATE pms.import_staging_rows SET status = 'failed', batch_no = @batchNo WHERE job_id = @id AND row_no = @RowNo",
                        new { id, batchNo, r.RowNo }, tx);
                    await c.ExecuteAsync("INSERT INTO pms.import_errors (job_id, row_no, reason) VALUES (@id, @RowNo, @reason)", new { id, r.RowNo, reason }, tx);
                }
            }
            await c.ExecuteAsync("INSERT INTO pms.import_batches (job_id, batch_no, first_row, last_row, status) VALUES (@id, @batchNo, @first, @last, 'committed')",
                new { id, batchNo, first = rows[0].RowNo, last }, tx);
            await RefreshCountsAsync(c, id, null, tx);
            await tx.CommitAsync();
            hub.Broadcast(new RealtimeEvent("imports", id.ToString()));
        }

        // Aktarım sonrası doğrulama: yalnız satır sayısı değil, oluşturulan kayıtların varlığı ve ilişkileri.
        var verification = await VerifyAsync(c, job.Entity, id);
        await RefreshCountsAsync(c, id);
        var counts = await c.QuerySingleAsync<(int Failed, int Review)>("SELECT failed_rows, review_rows FROM pms.import_jobs WHERE id = @id", new { id });
        var finalStatus = counts.Failed > 0 || counts.Review > 0 || verification.Count > 0 ? "completed_with_errors" : "completed";
        await c.ExecuteAsync("UPDATE pms.import_jobs SET status = @finalStatus, finished_at = now(), error = @err WHERE id = @id",
            new { id, finalStatus, err = verification.Count > 0 ? string.Join(" | ", verification) : null });
        await AuditAsync(c, userId, "import.execute", id, new { finalStatus, verification });
        if (FileTypes.Contains(job.SourceType))
        {
            // Kişisel veri içeren kaynak dosya, aktarım tamamlandıktan sonra saklanmaz (hash ve meta kaydı kalır).
            try { Directory.Delete(Path.Combine(paths.ImportsDir, id.ToString("N")), true); } catch (IOException) { }
        }
        _dbCredentials.TryRemove(id, out _);
    }

    static async Task<List<string>> VerifyAsync(NpgsqlConnection c, string entity, Guid id)
    {
        var problems = new List<string>();
        var recorded = await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM pms.import_records WHERE job_id = @id AND action = 'created'", new { id });
        var staged = await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM pms.import_staging_rows WHERE job_id = @id AND status = 'imported'", new { id });
        if (entity != "reservations" && recorded < staged) problems.Add($"Kayıt sayısı uyuşmuyor (aktarıldı: {staged}, oluşturuldu: {recorded}).");
        var orphan = entity switch
        {
            "reservations" => await c.ExecuteScalarAsync<int>("""
                SELECT count(*)::int FROM pms.reservations r WHERE r.migration_job_id = @id AND (
                    NOT EXISTS (SELECT 1 FROM pms.guests g WHERE g.id = r.guest_id)
                    OR NOT EXISTS (SELECT 1 FROM pms.room_types t WHERE t.id = r.room_type_id)
                    OR NOT EXISTS (SELECT 1 FROM pms.folios f WHERE f.reservation_id = r.id)
                    OR NOT EXISTS (SELECT 1 FROM pms.reservation_guests rg WHERE rg.reservation_id = r.id))
                """, new { id }),
            "rooms" => await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM pms.rooms r WHERE r.migration_job_id = @id AND NOT EXISTS (SELECT 1 FROM pms.room_types t WHERE t.id = r.room_type_id)", new { id }),
            "folio_history" => await c.ExecuteScalarAsync<int>("SELECT count(*)::int FROM pms.folio_lines l WHERE l.migration_job_id = @id AND NOT EXISTS (SELECT 1 FROM pms.folios f WHERE f.id = l.folio_id AND f.reservation_id IS NOT NULL)", new { id }),
            _ => 0,
        };
        if (orphan > 0) problems.Add($"{orphan} kayıtta ilişki bütünlüğü sorunu.");
        return problems;
    }

    // ------------------------------------------------------------------ Geri alma
    public async Task<RollbackResult> RollbackAsync(Guid id, Guid userId)
    {
        var job = await JobAsync(id);
        if (job.Status is not ("completed" or "completed_with_errors" or "failed")) throw PmsException.Validation("Yalnız tamamlanmış aktarımlar geri alınabilir.");
        if (_running.ContainsKey(id)) throw PmsException.Conflict("Aktarım hâlâ çalışıyor.");
        await using var c = await db.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        await c.ExecuteAsync("SELECT set_config('pms.allow_import_rollback', 'on', true)", transaction: tx);
        var records = (await c.QueryAsync<(long Id, string Table, Guid EntityId, string Action, string? Before, int? AfterVersion)>(
            "SELECT id, entity_table, entity_id, action, before_value::text, after_version FROM pms.import_records WHERE job_id = @id ORDER BY id DESC", new { id }, tx)).ToList();
        int deleted = 0, restored = 0;
        var blocked = new List<string>();
        foreach (var r in records)
        {
            var reason = await RollbackGuard.CheckAsync(c, tx, id, r.Table, r.EntityId, r.AfterVersion);
            if (reason is not null)
            {
                blocked.Add($"{r.Table} {r.EntityId}: {reason}");
                continue;
            }
            if (r.Action == "created")
            {
                await RollbackGuard.DeleteAsync(c, tx, r.Table, r.EntityId);
                deleted++;
            }
            else if (r.Before is not null)
            {
                await RollbackGuard.RestoreAsync(c, tx, r.Table, r.EntityId, r.Before);
                restored++;
            }
        }
        await c.ExecuteAsync("""
            UPDATE pms.import_jobs SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = @userId,
                error = CASE WHEN @blocked > 0 THEN @msg ELSE error END, version = version + 1
            WHERE id = @id
            """, new { id, userId, blocked = blocked.Count, msg = $"{blocked.Count} kayıt değiştirildiği/ilişkilendirildiği için geri alınmadı." }, tx);
        await AuditAsync(c, userId, "import.rollback", id, new { deleted, restored, blocked = blocked.Count }, tx);
        await tx.CommitAsync();
        hub.Broadcast(new RealtimeEvent("imports", id.ToString()));
        foreach (var topic in new[] { "guests", "reservations", "rooms", "companies", "agencies", "folios", "availability" })
            hub.Broadcast(new RealtimeEvent(topic, null));
        return new RollbackResult(deleted, restored, blocked.Count, blocked.Take(200).ToList());
    }

    static Task AuditAsync(NpgsqlConnection c, Guid userId, string action, Guid jobId, object data, NpgsqlTransaction? tx = null) =>
        c.ExecuteAsync("""
            INSERT INTO pms.audit_log (user_id, username, action, entity_type, entity_id, new_value)
            VALUES (@userId, (SELECT username FROM pms.users WHERE id = @userId), @action, 'import_job', @jobId::text, @data::jsonb)
            """, new { userId, action, jobId, data = JsonSerializer.Serialize(data, Json.Options) }, tx);
}

/// <summary>Doğrulama sırasında kullanılan referans tabloları (kod → id).</summary>
public sealed class Lookups
{
    public Dictionary<string, Guid> RoomTypes { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, (Guid Id, Guid TypeId)> Rooms { get; } = new(StringComparer.OrdinalIgnoreCase);
    public HashSet<string> PaymentMethods { get; } = new(StringComparer.OrdinalIgnoreCase);

    public static async Task<Lookups> LoadAsync(NpgsqlConnection c, string entity)
    {
        var l = new Lookups();
        foreach (var t in await c.QueryAsync<(string Code, Guid Id)>("SELECT code, id FROM pms.room_types")) l.RoomTypes[t.Code] = t.Id;
        foreach (var r in await c.QueryAsync<(string Number, Guid Id, Guid TypeId)>("SELECT number, id, room_type_id FROM pms.rooms")) l.Rooms[r.Number] = (r.Id, r.TypeId);
        foreach (var p in await c.QueryAsync<(string Code, string Name)>("SELECT code, name FROM pms.payment_methods WHERE is_active")) { l.PaymentMethods.Add(p.Code); l.PaymentMethods.Add(p.Name); }
        return l;
    }
}
