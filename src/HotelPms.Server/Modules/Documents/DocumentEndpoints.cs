using System.Security.Cryptography;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Documents;

public sealed record DocumentDto(Guid Id, string EntityType, Guid EntityId, string Category, string OriginalName, string MimeType, long SizeBytes,
    string Sha256, DateTime UploadedAt, string? UploadedBy);

public static class DocumentEndpoints
{
    static readonly Dictionary<string, (string Mime, byte[][] Magic)> Allowed = new()
    {
        [".pdf"] = ("application/pdf", [[0x25, 0x50, 0x44, 0x46]]),
        [".jpg"] = ("image/jpeg", [[0xFF, 0xD8, 0xFF]]),
        [".jpeg"] = ("image/jpeg", [[0xFF, 0xD8, 0xFF]]),
        [".png"] = ("image/png", [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]),
    };

    static string ViewPermission(string entityType) => entityType switch
    {
        "guest" => "guest.identity.view",
        "reservation" => "reservation.view",
        "company" or "agency" => "company.manage",
        "maintenance" => "maintenance.view",
        "folio" => "folio.view",
        _ => throw PmsException.Validation("Geçersiz belge türü."),
    };

    static string EditPermission(string entityType) => entityType switch
    {
        "guest" => "guest.edit",
        "reservation" => "reservation.edit",
        "company" or "agency" => "company.manage",
        "maintenance" => "maintenance.manage",
        "folio" => "folio.post",
        _ => throw PmsException.Validation("Geçersiz belge türü."),
    };

    public static string ObjectPath(PmsPaths paths, Guid key)
    {
        var k = key.ToString("N");
        // Yol yalnız sunucunun ürettiği UUID'den oluşur; kullanıcı dosya adı diske yazılmaz.
        return Path.Combine(paths.StorageDir, "objects", k[..2], k);
    }

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/documents").WithTags("Documents");

        g.MapGet("/", (string entityType, Guid entityId, Db db, RequestContext ctx) =>
        {
            ctx.Require(ViewPermission(entityType));
            return db.QueryAsync<DocumentDto>("""
                SELECT d.id, d.entity_type, d.entity_id, d.category, d.original_name, d.mime_type, d.size_bytes, d.sha256, d.uploaded_at, u.username AS uploaded_by
                FROM pms.documents d LEFT JOIN pms.users u ON u.id = d.uploaded_by
                WHERE d.entity_type = @entityType AND d.entity_id = @entityId AND d.deleted_at IS NULL ORDER BY d.uploaded_at DESC
                """, new { entityType, entityId });
        });

        g.MapPost("/", async (HttpRequest request, CommandRunner cmd, RequestContext ctx, PmsPaths paths, ServerConfig cfg) =>
        {
            if (!request.HasFormContentType) throw PmsException.Validation("Dosya yüklemesi multipart/form-data olmalıdır.");
            var form = await request.ReadFormAsync();
            var entityType = form["entityType"].ToString();
            ctx.Require(EditPermission(entityType));
            if (!Guid.TryParse(form["entityId"], out var entityId)) throw PmsException.Validation("Kayıt kimliği geçersiz.");
            var category = Validate.Optional(form["category"], 40) ?? "other";
            var file = form.Files.GetFile("file") ?? throw PmsException.Validation("Dosya seçilmedi.");
            if (file.Length <= 0) throw PmsException.Validation("Dosya boş.");
            if (file.Length > cfg.MaxUploadBytes) throw PmsException.Validation($"Dosya en fazla {cfg.MaxUploadBytes / 1024 / 1024} MB olabilir.");
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!Allowed.TryGetValue(ext, out var spec)) throw PmsException.Validation("Yalnız PDF, JPG ve PNG dosyaları kabul edilir.");
            var original = Path.GetFileName(file.FileName);
            original = new string(original.Where(ch => !char.IsControl(ch) && ch is not ('"' or '\\' or '/')).ToArray());
            if (original.Length > 150) original = original[..150];

            var key = Guid.NewGuid();
            var path = ObjectPath(paths, key);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            string sha;
            await using (var input = file.OpenReadStream())
            {
                var head = new byte[8];
                var read = await input.ReadAsync(head);
                if (!spec.Magic.Any(m => read >= m.Length && head.AsSpan(0, m.Length).SequenceEqual(m)))
                    throw PmsException.Validation("Dosya içeriği uzantısıyla uyuşmuyor.");
                input.Position = 0;
                await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
                using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                var buffer = new byte[81920];
                int n;
                while ((n = await input.ReadAsync(buffer)) > 0)
                {
                    hasher.AppendData(buffer, 0, n);
                    await output.WriteAsync(buffer.AsMemory(0, n));
                }
                sha = Convert.ToHexString(hasher.GetHashAndReset());
            }
            try
            {
                return await cmd.RunAsync("document.upload", new { entityType, entityId, sha }, async tx =>
                {
                    var id = await tx.ScalarAsync<Guid>("""
                        INSERT INTO pms.documents (entity_type, entity_id, category, original_name, mime_type, size_bytes, sha256, object_key, uploaded_by)
                        VALUES (@entityType, @entityId, @category, @original, @mime, @size, @sha, @key, @uid) RETURNING id
                        """, new { entityType, entityId, category, original, mime = spec.Mime, size = file.Length, sha, key, uid = tx.User.Id });
                    await tx.AuditAsync("document.upload", entityType, entityId, null, new { id, original, size = file.Length });
                    tx.Publish("documents", entityId);
                    return new { id };
                }, requireKey: false);
            }
            catch
            {
                File.Delete(path);
                throw;
            }
        });

        g.MapGet("/{id:guid}/content", async (Guid id, Db db, RequestContext ctx, PmsPaths paths, HttpContext http) =>
        {
            var d = await db.QuerySingleOrDefaultAsync<(string EntityType, Guid EntityId, string OriginalName, string MimeType, Guid ObjectKey)>(
                "SELECT entity_type, entity_id, original_name, mime_type, object_key FROM pms.documents WHERE id = @id AND deleted_at IS NULL", new { id });
            if (d == default) throw PmsException.NotFound("Belge");
            ctx.Require(ViewPermission(d.EntityType));
            var path = ObjectPath(paths, d.ObjectKey);
            if (!File.Exists(path)) throw PmsException.NotFound("Belge dosyası");
            await using (var c = await db.OpenAsync())
                await Dapper.SqlMapper.ExecuteAsync(c, "INSERT INTO pms.audit_log (user_id, username, device_id, ip, action, entity_type, entity_id) VALUES (@u, @n, @dev, @ip::inet, 'document.view', 'document', @id)",
                    new { u = ctx.User!.Id, n = ctx.User.Username, dev = ctx.DeviceId, ip = ctx.Ip?.ToString(), id = id.ToString() });
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            http.Response.Headers.CacheControl = "no-store";
            return Results.File(path, d.MimeType, d.OriginalName);
        });

        g.MapDelete("/{id:guid}", (Guid id, CommandRunner cmd, RequestContext ctx) => cmd.RunAsync("document.delete", new { id }, async tx =>
        {
            var d = await tx.OneOrNullAsync<(string EntityType, Guid EntityId)>("SELECT entity_type, entity_id FROM pms.documents WHERE id = @id AND deleted_at IS NULL", new { id });
            if (d == default) throw PmsException.NotFound("Belge");
            ctx.Require(EditPermission(d.EntityType));
            // Dosya diskten silinmez (yedek/denetim için); kayıt erişimden kaldırılır.
            await tx.ExecAsync("UPDATE pms.documents SET deleted_at = now(), deleted_by = @uid WHERE id = @id", new { id, uid = tx.User.Id });
            await tx.AuditAsync("document.delete", d.EntityType, d.EntityId, new { id });
            tx.Publish("documents", d.EntityId);
            return new { id };
        }, requireKey: false));
    }
}
