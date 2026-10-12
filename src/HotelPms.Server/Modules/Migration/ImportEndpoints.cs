using System.Text;
using System.Text.Json;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Migration;

public sealed record DbConnectRequest(string Entity, string SourceType, string? Host, int? Port, string? Database, string? Username, string? Password,
    string? Dsn, string? FilePath);
public sealed record InspectResponse(ImportJobDto Job, SourceInspection Inspection, IReadOnlyList<MappingSuggestion> Suggestions, IReadOnlyList<TargetField> Targets);
public sealed record DecisionRequest(string Decision);
public sealed record BulkDecisionRequest(string Decision, int[]? RowNos);
public sealed record ProfileDto(Guid Id, string Name, string SourceType, string Entity, JsonElement Mapping, JsonElement Options, DateTime CreatedAt);
public sealed record SaveProfileRequest(string Name, string SourceType, string Entity, IReadOnlyList<FieldMapping> Mapping, SourceOptions Options);
public sealed record SourceCapability(string Type, string Label, bool Available, string? Note);

public static class ImportEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/imports").WithTags("DataMigration").RequirePermission("migration.manage");

        g.MapGet("/capabilities", () =>
        {
            var drivers = DbSource.OdbcDrivers();
            var access = drivers.Any(d => d.Contains("Access", StringComparison.OrdinalIgnoreCase));
            return new
            {
                entities = MappingCatalog.Entities.Keys,
                sources = new List<SourceCapability>
                {
                    new("csv", "CSV / TXT", true, "; , sekme ve | ayırıcıları; UTF-8, Windows-1254, ISO-8859-9"),
                    new("xlsx", "Excel (XLSX)", true, null),
                    new("xls", "Excel 97-2003 (XLS)", true, null),
                    new("json", "JSON", true, null),
                    new("xml", "XML", true, null),
                    new("postgresql", "PostgreSQL", true, "Salt okunur bağlantı"),
                    new("sqlserver", "Microsoft SQL Server", true, "ApplicationIntent=ReadOnly; yalnız SELECT"),
                    new("mysql", "MySQL / MariaDB", true, "READ ONLY oturum; yalnız SELECT"),
                    new("sqlite", "SQLite dosyası", true, "Mode=ReadOnly"),
                    new("odbc", "ODBC (DSN)", drivers.Count > 0, drivers.Count > 0 ? "Kurulu sürücüler: " + string.Join(", ", drivers.Take(6)) : "Sunucuda ODBC sürücüsü yok"),
                    new("access", "Microsoft Access (.mdb/.accdb)", access, access ? "ODBC Access sürücüsü ile salt okunur" : "Access Database Engine sürücüsü kurulu değil"),
                },
                targets = MappingCatalog.Entities.ToDictionary(e => e.Key, e => e.Value),
            };
        });

        g.MapGet("/", (Db db) => db.QueryAsync<ImportJobDto>(ImportService.JobSelect + " ORDER BY j.created_at DESC LIMIT 200"));

        g.MapGet("/{id:guid}", async (Guid id, Db db) =>
            await db.QuerySingleOrDefaultAsync<ImportJobDto>(ImportService.JobSelect + " WHERE j.id = @id", new { id }) ?? throw PmsException.NotFound("Aktarım işi"));

        g.MapPost("/file", async (HttpRequest request, ImportService svc, RequestContext ctx, Db db) =>
        {
            if (!request.HasFormContentType) throw PmsException.Validation("Dosya yüklemesi multipart/form-data olmalıdır.");
            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? throw PmsException.Validation("Dosya seçilmedi.");
            var entity = form["entity"].ToString();
            await using var stream = file.OpenReadStream();
            var id = await svc.CreateFileJobAsync(stream, file.FileName, entity, ctx.RequireUser().Id, request.HttpContext.RequestAborted);
            return await Inspect(id, new SourceOptions(), svc, db);
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(210L * 1024 * 1024));

        g.MapPost("/database", async (DbConnectRequest req, ImportService svc, RequestContext ctx, Db db, HttpContext http) =>
        {
            var type = req.SourceType == "access" ? "odbc" : req.SourceType;
            if (type is not ("postgresql" or "sqlserver" or "mysql" or "sqlite" or "odbc")) throw PmsException.Validation("Geçersiz kaynak türü.");
            if (type is "sqlite" or "odbc" && req.FilePath is { } fp && (!Path.IsPathFullyQualified(fp) || !File.Exists(fp)))
                throw PmsException.Validation("Dosya sunucuda bulunamadı. Tam yolu girin (dosya sunucu bilgisayarında olmalıdır).");
            var id = await svc.CreateDbJobAsync(new DbSourceConnection(type, req.Host, req.Port, req.Database, req.Username, req.Password, req.Dsn, req.FilePath),
                req.Entity, ctx.RequireUser().Id, http.RequestAborted);
            return await Inspect(id, new SourceOptions(), svc, db);
        });

        g.MapPost("/{id:guid}/inspect", (Guid id, SourceOptions options, ImportService svc, Db db) => Inspect(id, options, svc, db));

        g.MapPost("/{id:guid}/stage", (Guid id, StageRequest req, ImportService svc, RequestContext ctx, HttpContext http) =>
            svc.StageAsync(id, req, ctx.RequireUser().Id, http.RequestAborted));

        g.MapGet("/{id:guid}/rows", async (Guid id, Db db, string? status, int page = 1, int pageSize = 100) =>
        {
            var p = new PageRequest(page, pageSize);
            var total = await db.ScalarAsync<long>("SELECT count(*) FROM pms.import_staging_rows WHERE job_id = @id AND (@status::text IS NULL OR status = @status)", new { id, status });
            var items = await db.QueryAsync<StagingRowDto>("""
                SELECT s.row_no, s.raw, s.mapped, s.status, s.duplicate_of, s.duplicate_score, s.duplicate_reason, s.review_decision, s.target_id,
                       (SELECT string_agg(COALESCE(e.field || ': ', '') || e.reason, ' | ' ORDER BY e.id) FROM pms.import_errors e WHERE e.job_id = s.job_id AND e.row_no = s.row_no) AS errors
                FROM pms.import_staging_rows s WHERE s.job_id = @id AND (@status::text IS NULL OR s.status = @status)
                ORDER BY s.row_no LIMIT @Limit OFFSET @Offset
                """, new { id, status, p.Limit, p.Offset });
            return new Paged<StagingRowDto>(items, total, page, p.Limit);
        });

        g.MapGet("/{id:guid}/errors", (Guid id, Db db) => db.QueryAsync<ImportErrorDto>(
            "SELECT id, row_no, field, value, reason, severity FROM pms.import_errors WHERE job_id = @id ORDER BY row_no NULLS FIRST, id LIMIT 10000", new { id }));

        g.MapGet("/{id:guid}/errors.csv", async (Guid id, Db db) =>
        {
            var errors = await db.QueryAsync<ImportErrorDto>("SELECT id, row_no, field, value, reason, severity FROM pms.import_errors WHERE job_id = @id ORDER BY row_no NULLS FIRST, id", new { id });
            var sb = new StringBuilder("Satır;Alan;Değer;Neden;Önem\n");
            static string E(string? s) => s is null ? "" : s.Contains(';') || s.Contains('"') || s.Contains('\n') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
            foreach (var e in errors) sb.Append($"{e.RowNo};{E(e.Field)};{E(e.Value)};{E(e.Reason)};{(e.Severity == "error" ? "Hata" : "Uyarı")}\n");
            return Results.File([.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())], "text/csv; charset=utf-8", $"aktarim-hatalari-{id.ToString()[..8]}.csv");
        });

        g.MapGet("/{id:guid}/report", async (Guid id, Db db) =>
        {
            await using var c = await db.OpenAsync();
            var job = await c.QuerySingleOrDefaultAsync<ImportJobDto>(ImportService.JobSelect + " WHERE j.id = @id", new { id }) ?? throw PmsException.NotFound("Aktarım işi");
            var byTable = await c.QueryAsync<(string Table, string Action, int Count)>(
                "SELECT entity_table, action, count(*)::int FROM pms.import_records WHERE job_id = @id GROUP BY 1, 2 ORDER BY 1, 2", new { id });
            var byStatus = await c.QueryAsync<(string Status, int Count)>("SELECT status, count(*)::int FROM pms.import_staging_rows WHERE job_id = @id GROUP BY 1", new { id });
            var batches = await c.QueryAsync<(int BatchNo, int FirstRow, int LastRow, string Status)>(
                "SELECT batch_no, first_row, last_row, status FROM pms.import_batches WHERE job_id = @id ORDER BY batch_no", new { id });
            var topErrors = await c.QueryAsync<(string Reason, int Count)>(
                "SELECT reason, count(*)::int FROM pms.import_errors WHERE job_id = @id GROUP BY reason ORDER BY 2 DESC LIMIT 20", new { id });
            return new
            {
                job,
                entities = byTable.Select(x => new { table = x.Table, action = x.Action, count = x.Count }),
                statuses = byStatus.Select(x => new { status = x.Status, count = x.Count }),
                batches = batches.Select(x => new { batchNo = x.BatchNo, firstRow = x.FirstRow, lastRow = x.LastRow, status = x.Status }),
                topErrors = topErrors.Select(x => new { reason = x.Reason, count = x.Count }),
                durationSeconds = job.StartedAt is { } s && job.FinishedAt is { } f ? (f - s).TotalSeconds : (double?)null,
            };
        });

        g.MapPost("/{id:guid}/rows/{rowNo:int}/decision", async (Guid id, int rowNo, DecisionRequest req, ImportService svc, RequestContext ctx) =>
        {
            await svc.SetDecisionAsync(id, rowNo, req.Decision, ctx.RequireUser().Id);
            return Results.NoContent();
        });

        g.MapPost("/{id:guid}/decisions", async (Guid id, BulkDecisionRequest req, Db db, ImportService svc, RequestContext ctx) =>
        {
            var rows = req.RowNos ?? (await db.QueryAsync<int>(
                "SELECT row_no FROM pms.import_staging_rows WHERE job_id = @id AND status = 'needs_review' AND review_decision IS NULL" +
                (req.Decision == "update" ? " AND duplicate_of IS NOT NULL" : ""), new { id })).ToArray();
            foreach (var r in rows) await svc.SetDecisionAsync(id, r, req.Decision, ctx.RequireUser().Id);
            return Results.Ok(new { count = rows.Length });
        });

        g.MapPost("/{id:guid}/execute", async (Guid id, ImportService svc, RequestContext ctx) =>
        {
            await svc.StartExecuteAsync(id, ctx.RequireUser().Id);
            return Results.Accepted($"/api/v1/imports/{id}");
        });

        g.MapPost("/{id:guid}/rollback", (Guid id, ImportService svc, RequestContext ctx) => svc.RollbackAsync(id, ctx.RequireUser().Id));

        g.MapPost("/{id:guid}/purge", async (Guid id, Db db, PmsPaths paths, RequestContext ctx) =>
        {
            await using var c = await db.OpenAsync();
            var status = await c.ExecuteScalarAsync<string?>("SELECT status FROM pms.import_jobs WHERE id = @id", new { id }) ?? throw PmsException.NotFound("Aktarım işi");
            if (status == "importing") throw PmsException.Validation("Çalışan aktarımın verisi temizlenemez.");
            // Ham kaynak satırları kişisel veri içerir; özet sayılar ve hata nedenleri korunur.
            await c.ExecuteAsync("""
                UPDATE pms.import_staging_rows SET raw = '{}'::jsonb, mapped = NULL WHERE job_id = @id;
                UPDATE pms.import_errors SET value = NULL WHERE job_id = @id;
                INSERT INTO pms.audit_log (user_id, username, action, entity_type, entity_id) VALUES (@u, @n, 'import.purge', 'import_job', @id::text);
                """, new { id, u = ctx.User!.Id, n = ctx.User.Username });
            try { Directory.Delete(Path.Combine(paths.ImportsDir, id.ToString("N")), true); } catch (DirectoryNotFoundException) { } catch (IOException) { }
            return Results.NoContent();
        });

        g.MapPost("/{id:guid}/cancel", async (Guid id, Db db, PmsPaths paths) =>
        {
            await using var c = await db.OpenAsync();
            var n = await c.ExecuteAsync("UPDATE pms.import_jobs SET status = 'cancelled', finished_at = now() WHERE id = @id AND status IN ('analyzed','staged','validated')", new { id });
            if (n == 0) throw PmsException.Validation("Bu aşamadaki aktarım iptal edilemez.");
            try { Directory.Delete(Path.Combine(paths.ImportsDir, id.ToString("N")), true); } catch (DirectoryNotFoundException) { } catch (IOException) { }
            return Results.NoContent();
        });

        var p = app.MapGroup("/api/v1/import-profiles").WithTags("DataMigration").RequirePermission("migration.manage");
        p.MapGet("/", (Db db, string? entity) => db.QueryAsync<ProfileDto>(
            "SELECT id, name, source_type, entity, mapping, options, created_at FROM pms.import_mapping_profiles WHERE (@entity::text IS NULL OR entity = @entity) ORDER BY name",
            new { entity }));
        p.MapPost("/", async (SaveProfileRequest req, Db db, RequestContext ctx) =>
        {
            MappingCatalog.Fields(req.Entity);
            var name = Validate.Required(req.Name, "Profil adı", 100);
            await using var c = await db.OpenAsync();
            var id = await c.ExecuteScalarAsync<Guid>("""
                INSERT INTO pms.import_mapping_profiles (name, source_type, entity, mapping, options, created_by)
                VALUES (@name, @SourceType, @Entity, @map::jsonb, @opts::jsonb, @uid)
                ON CONFLICT (lower(name), entity) DO UPDATE SET mapping = EXCLUDED.mapping, options = EXCLUDED.options, source_type = EXCLUDED.source_type, updated_at = now()
                RETURNING id
                """, new { name, req.SourceType, req.Entity, map = JsonSerializer.Serialize(req.Mapping, Json.Options), opts = JsonSerializer.Serialize(req.Options, Json.Options), uid = ctx.User!.Id });
            return Results.Ok(new { id });
        });
        p.MapDelete("/{id:guid}", async (Guid id, Db db) =>
        {
            await using var c = await db.OpenAsync();
            await c.ExecuteAsync("DELETE FROM pms.import_mapping_profiles WHERE id = @id", new { id });
            return Results.NoContent();
        });
    }

    static async Task<InspectResponse> Inspect(Guid id, SourceOptions options, ImportService svc, Db db)
    {
        var (inspection, suggestions) = await svc.InspectAsync(id, options);
        var job = await db.QuerySingleOrDefaultAsync<ImportJobDto>(ImportService.JobSelect + " WHERE j.id = @id", new { id }) ?? throw PmsException.NotFound("Aktarım işi");
        return new InspectResponse(job, inspection, suggestions, MappingCatalog.Fields(job.Entity));
    }
}
