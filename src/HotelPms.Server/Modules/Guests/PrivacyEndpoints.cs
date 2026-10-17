using ClosedXML.Excel;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Documents;
using HotelPms.Server.Modules.Property;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Guests;

public sealed record AnonymizeRequest(string Reason);
public sealed record PurgeRequest(string Reason);
public sealed record RetentionCandidate(Guid Id, string Name, string? Nationality, DateOnly? LastStay, DateTime CreatedAt);
public sealed record RetentionPreview(int Years, DateOnly Cutoff, int Count, IReadOnlyList<RetentionCandidate> Sample);

/// <summary>
/// KVKK (6698) kapsamındaki işlemler: ilgili kişinin başvurusu üzerine kişisel veri dökümü, anonimleştirme ve saklama süresi dolan
/// misafir kayıtlarının toplu anonimleştirilmesi (imha). Anonimleştirme geri alınamaz; konaklama, folyo ve muhasebe kayıtları yasal
/// saklama için kalır ancak kişiyle ilişkilendirilemez. Denetim kayıtları değiştirilemez olduğundan anonimleştirilmez.
/// </summary>
public static class PrivacyEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1").WithTags("Privacy").RequirePermission("guest.privacy");

        // ---- Kişisel veri dökümü (ilgili kişi başvurusu, KVKK m.11): Excel
        g.MapGet("/guests/{id:guid}/privacy/export", async (Guid id, CommandRunner cmd, HttpContext http) =>
        {
            var bytes = await cmd.WriteAsync(async tx =>
            {
                var guest = await tx.OneOrNullAsync<GuestDto>(GuestEndpoints.GuestSelect + " WHERE g.id = @id", new { id }) ?? throw PmsException.NotFound("Misafir");
                var anonymized = await tx.ScalarAsync<DateTime?>("SELECT anonymized_at FROM pms.guests WHERE id = @id", new { id });
                var stays = await tx.ListAsync<(string No, string Status, DateOnly Arrival, DateOnly Departure, string? Room, string RoomType, bool Primary)>("""
                    SELECT r.reservation_number, r.status, r.arrival, r.departure, rm.number, rt.code, (r.guest_id = @id)
                    FROM pms.reservations r JOIN pms.room_types rt ON rt.id = r.room_type_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                    WHERE r.guest_id = @id OR EXISTS (SELECT 1 FROM pms.reservation_guests x WHERE x.reservation_id = r.id AND x.guest_id = @id)
                    ORDER BY r.arrival DESC
                    """, new { id });
                var lines = await tx.ListAsync<(string Folio, DateOnly Date, string Type, string Description, decimal Amount, string Currency)>("""
                    SELECT f.folio_number, l.business_date, l.line_type, l.description, l.amount, l.currency
                    FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id
                    WHERE f.guest_id = @id OR f.reservation_id IN (SELECT r.id FROM pms.reservations r WHERE r.guest_id = @id)
                    ORDER BY f.folio_number, l.posted_at
                    """, new { id });
                var docs = await tx.ListAsync<(string Name, string Category, long Size, DateTime At)>(
                    "SELECT original_name, category, size_bytes, uploaded_at FROM pms.documents WHERE entity_type = 'guest' AND entity_id = @id AND deleted_at IS NULL ORDER BY uploaded_at", new { id });
                var reports = await tx.ListAsync<(string No, string Event, string Status, DateTime At)>("""
                    SELECT r.reservation_number, i.event, i.status, i.created_at FROM pms.identity_reports i JOIN pms.reservations r ON r.id = i.reservation_id
                    WHERE i.guest_id = @id ORDER BY i.created_at
                    """, new { id });
                var audit = await tx.ListAsync<(DateTime At, string? User, string Action, string? Reason)>(
                    "SELECT at, username, action, reason FROM pms.audit_log WHERE entity_type = 'guest' AND entity_id = @sid ORDER BY id", new { sid = id.ToString() });
                var wifi = await tx.ListAsync<(DateTime Start, DateTime? Stop, string? Room, string? Mac, string? Ip)>(
                    "SELECT started_at, stopped_at, room_number, mac, host(framed_ip) FROM pms.wifi_sessions WHERE guest_id = @id ORDER BY started_at", new { id });
                var property = await tx.OneAsync<(string Name, string? Legal)>("SELECT name, legal_name FROM pms.property LIMIT 1");

                using var wb = new XLWorkbook();
                var ws = wb.Worksheets.Add("Kişisel veriler");
                var rows = new (string, object?)[]
                {
                    ("Veri sorumlusu", property.Legal ?? property.Name), ("Döküm tarihi", DateTime.Now.ToString("dd.MM.yyyy HH:mm")),
                    ("Ad", guest.FirstName), ("Soyad", guest.LastName), ("Cinsiyet", guest.Gender), ("Doğum tarihi", guest.BirthDate?.ToString("dd.MM.yyyy")),
                    ("Doğum yeri", guest.BirthPlace), ("Baba adı", guest.FatherName), ("Anne adı", guest.MotherName), ("Uyruk", guest.Nationality),
                    ("Kimlik türü", guest.IdentityType), ("Kimlik no", guest.IdentityNumber), ("Kimlik ülkesi", guest.IdentityCountry),
                    ("Kimlik geçerlilik", guest.IdentityExpiry?.ToString("dd.MM.yyyy")), ("Telefon", guest.Phone), ("E-posta", guest.Email),
                    ("Adres", guest.Address), ("Şehir", guest.City), ("Ülke", guest.Country), ("Vergi dairesi", guest.TaxOffice), ("Vergi no", guest.TaxNumber),
                    ("Hitap", guest.Title), ("Medeni hal", guest.MaritalStatus switch { "single" => "Bekâr", "married" => "Evli", "divorced" => "Boşanmış", "widowed" => "Dul", _ => null }),
                    ("Dil", guest.Language), ("İkinci telefon", guest.Phone2), ("Belge seri no", guest.IdentitySerial), ("Belgenin verildiği yer", guest.IdentityIssuePlace),
                    ("Belge veriliş tarihi", guest.IdentityIssueDate?.ToString("dd.MM.yyyy")), ("İlçe", guest.District), ("Posta kodu", guest.PostalCode),
                    ("Araç plakası", guest.VehiclePlate), ("Resepsiyon uyarısı", guest.AlertNote),
                    ("Şirket", guest.CompanyName), ("Notlar", guest.Notes), ("Tercihler", guest.Preferences), ("VIP", guest.IsVip ? "Evet" : "Hayır"),
                    ("Kara liste", guest.IsBlacklisted ? $"Evet ({guest.BlacklistReason})" : "Hayır"),
                    ("KVKK aydınlatma / açık rıza", guest.KvkkConsent ? $"Evet ({guest.KvkkConsentAt?.ToLocalTime():dd.MM.yyyy HH:mm})" : "Hayır"),
                    ("Ticari ileti izni", guest.MarketingConsent ? "Evet" : "Hayır"), ("Kayıt tarihi", guest.CreatedAt.ToLocalTime().ToString("dd.MM.yyyy HH:mm")),
                    ("Anonimleştirme", anonymized is { } a ? a.ToLocalTime().ToString("dd.MM.yyyy HH:mm") : "—"),
                };
                ws.Cell(1, 1).Value = "Alan"; ws.Cell(1, 2).Value = "Değer";
                for (var i = 0; i < rows.Length; i++) { ws.Cell(i + 2, 1).Value = rows[i].Item1; ws.Cell(i + 2, 2).Value = rows[i].Item2?.ToString() ?? ""; }
                Sheet(wb, "Konaklamalar", ["Rezervasyon", "Durum", "Giriş", "Çıkış", "Oda", "Oda tipi", "Ana misafir"],
                    stays.Select(s => new object?[] { s.No, s.Status, s.Arrival.ToString("dd.MM.yyyy"), s.Departure.ToString("dd.MM.yyyy"), s.Room, s.RoomType, s.Primary ? "Evet" : "Ek misafir" }));
                Sheet(wb, "Folyo hareketleri", ["Folyo", "Tarih", "Tür", "Açıklama", "Tutar", "Para birimi"],
                    lines.Select(l => new object?[] { l.Folio, l.Date.ToString("dd.MM.yyyy"), l.Type, l.Description, l.Amount, l.Currency }));
                Sheet(wb, "Belgeler", ["Dosya", "Kategori", "Boyut (bayt)", "Yükleme"],
                    docs.Select(d => new object?[] { d.Name, d.Category, d.Size, d.At.ToLocalTime().ToString("dd.MM.yyyy HH:mm") }));
                Sheet(wb, "Kimlik bildirimleri", ["Rezervasyon", "Olay", "Durum", "Tarih"],
                    reports.Select(r => new object?[] { r.No, r.Event, r.Status, r.At.ToLocalTime().ToString("dd.MM.yyyy HH:mm") }));
                Sheet(wb, "Wi-Fi oturumları", ["Başlangıç", "Bitiş", "Oda", "Cihaz (MAC)", "İç IP"],
                    wifi.Select(w => new object?[] { w.Start.ToLocalTime().ToString("dd.MM.yyyy HH:mm"), w.Stop?.ToLocalTime().ToString("dd.MM.yyyy HH:mm"), w.Room, w.Mac, w.Ip }));
                Sheet(wb, "İşlem kayıtları", ["Tarih", "Kullanıcı", "İşlem", "Gerekçe"],
                    audit.Select(a => new object?[] { a.At.ToLocalTime().ToString("dd.MM.yyyy HH:mm"), a.User, a.Action, a.Reason }));
                foreach (var s in wb.Worksheets) { s.Row(1).Style.Font.Bold = true; s.Columns().AdjustToContents(8, 80); }
                await tx.AuditAsync("guest.privacy_export", "guest", id, null, null);
                using var ms = new MemoryStream();
                wb.SaveAs(ms);
                return ms.ToArray();
            });
            return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"kisisel-veri-{DateTime.Now:yyyyMMdd}.xlsx");
        });

        // ---- Tek misafirin anonimleştirilmesi (silme talebi, KVKK m.7)
        g.MapPost("/guests/{id:guid}/anonymize", async (Guid id, AnonymizeRequest req, CommandRunner cmd, PmsPaths paths) =>
        {
            var reason = Validate.Required(req.Reason, "Gerekçe", 300);
            var files = await cmd.WriteAsync(async tx =>
            {
                var state = await tx.OneOrNullAsync<(DateTime? AnonymizedAt, string Name)>(
                    "SELECT anonymized_at, first_name || ' ' || last_name FROM pms.guests WHERE id = @id FOR UPDATE", new { id });
                if (state == default) throw PmsException.NotFound("Misafir");
                if (state.AnonymizedAt is not null) throw PmsException.Validation("Misafir zaten anonimleştirilmiş.");
                if (await BlockerAsync(tx, id) is { } blocker) throw PmsException.Validation(blocker);
                var keys = await AnonymizeAsync(tx, id);
                await tx.AuditAsync("guest.anonymize", "guest", id, null, new { documents = keys.Count }, reason);
                tx.Publish("guests", id);
                return keys;
            });
            DeleteFiles(paths, files);
            return Results.Ok(new { id, documentsDeleted = files.Count });
        });

        // ---- Saklama süresi dolan misafirler (imha önizlemesi ve toplu anonimleştirme)
        g.MapGet("/privacy/retention", (CommandRunner cmd) => cmd.ReadAsync(async tx =>
        {
            var (years, cutoff) = await RetentionAsync(tx);
            if (years == 0) return new RetentionPreview(0, cutoff, 0, []);
            var count = await tx.ScalarAsync<int>($"SELECT count(*)::int FROM ({CandidatesSql}) c", new { cutoff });
            var sample = await tx.ListAsync<RetentionCandidate>(CandidatesSql + " ORDER BY last_stay NULLS FIRST, created_at LIMIT 200", new { cutoff });
            return new RetentionPreview(years, cutoff, count, sample);
        }));

        g.MapPost("/privacy/retention/purge", async (PurgeRequest req, CommandRunner cmd, PmsPaths paths) =>
        {
            var reason = Validate.Required(req.Reason, "Gerekçe", 300);
            var (count, files) = await cmd.WriteAsync(async tx =>
            {
                var (years, cutoff) = await RetentionAsync(tx);
                if (years == 0) throw PmsException.Validation("Önce KVKK ayarlarından saklama süresini (yıl) belirleyin.");
                var ids = await tx.ListAsync<Guid>(CandidatesSql + " ORDER BY created_at LIMIT 5000", new { cutoff });
                var keys = new List<Guid>();
                foreach (var gid in ids) keys.AddRange(await AnonymizeAsync(tx, gid));
                await tx.AuditAsync("guest.retention_purge", "guest", null, null, new { years, cutoff, guests = ids.Count, documents = keys.Count }, reason);
                if (ids.Count > 0) tx.Publish("guests");
                return (ids.Count, keys);
            });
            DeleteFiles(paths, files);
            return Results.Ok(new { anonymized = count, documentsDeleted = files.Count });
        });
    }

    /// <summary>Son konaklaması (veya hiç konaklaması yoksa kaydı) saklama süresinden eski, açık işi olmayan misafirler.</summary>
    const string CandidatesSql = """
        SELECT g.id, g.first_name || ' ' || g.last_name AS name, g.nationality::text AS nationality, s.last_stay, g.created_at
        FROM pms.guests g
        LEFT JOIN LATERAL (
            SELECT max(r.departure) AS last_stay FROM pms.reservations r
            WHERE r.guest_id = g.id OR EXISTS (SELECT 1 FROM pms.reservation_guests x WHERE x.reservation_id = r.id AND x.guest_id = g.id)) s ON true
        WHERE g.anonymized_at IS NULL
          AND COALESCE(s.last_stay, g.created_at::date) < @cutoff
          AND NOT EXISTS (SELECT 1 FROM pms.reservations r WHERE (r.guest_id = g.id OR EXISTS (SELECT 1 FROM pms.reservation_guests x WHERE x.reservation_id = r.id AND x.guest_id = g.id))
                          AND r.status IN ('tentative', 'confirmed', 'checked_in'))
          AND NOT EXISTS (SELECT 1 FROM pms.folios f WHERE f.status = 'open'
                          AND (f.guest_id = g.id OR f.reservation_id IN (SELECT r.id FROM pms.reservations r WHERE r.guest_id = g.id)))
        """;

    static async Task<(int Years, DateOnly Cutoff)> RetentionAsync(Tx tx)
    {
        var years = await PropertyEndpoints.SettingAsync<int>(tx, "kvkk.retention_years");
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        return (years, years > 0 ? bd.AddYears(-years) : bd);
    }

    static async Task<string?> BlockerAsync(Tx tx, Guid id)
    {
        var active = await tx.ScalarAsync<string?>("""
            SELECT string_agg(r.reservation_number, ', ') FROM pms.reservations r
            WHERE (r.guest_id = @id OR EXISTS (SELECT 1 FROM pms.reservation_guests x WHERE x.reservation_id = r.id AND x.guest_id = @id))
              AND r.status IN ('tentative', 'confirmed', 'checked_in')
            """, new { id });
        if (active is not null) return $"Misafirin aktif rezervasyonu var ({active}). Konaklama bittikten veya rezervasyon iptal edildikten sonra anonimleştirilebilir.";
        var open = await tx.ScalarAsync<string?>("""
            SELECT string_agg(f.folio_number, ', ') FROM pms.folios f
            WHERE f.status = 'open' AND (f.guest_id = @id OR f.reservation_id IN (SELECT r.id FROM pms.reservations r WHERE r.guest_id = @id))
            """, new { id });
        return open is null ? null : $"Misafirin açık folyosu var ({open}). Folyo kapatıldıktan sonra anonimleştirilebilir.";
    }

    /// <summary>Kimliği belirleyen tüm alanları siler; misafir belgelerini erişimden kaldırır ve dosya anahtarlarını döner (commit sonrası diskten silinir).</summary>
    static async Task<List<Guid>> AnonymizeAsync(Tx tx, Guid id)
    {
        var tag = id.ToString("N")[..6].ToUpperInvariant();
        await tx.ExecAsync("""
            UPDATE pms.guests SET first_name = 'Anonim', last_name = @last, gender = NULL, birth_date = NULL, birth_place = NULL, father_name = NULL, mother_name = NULL,
                identity_type = NULL, identity_number = NULL, identity_country = NULL, identity_expiry = NULL, phone = NULL, phone_normalized = NULL, email = NULL,
                address = NULL, city = NULL, tax_office = NULL, tax_number = NULL, company_id = NULL, notes = NULL, preferences = NULL, is_vip = false, vip_level = NULL,
                is_blacklisted = false, blacklist_reason = NULL, kvkk_consent = false, kvkk_consent_at = NULL, marketing_consent = false,
                title = NULL, marital_status = NULL, language = NULL, phone2 = NULL, identity_serial = NULL, identity_issue_place = NULL,
                identity_issue_date = NULL, district = NULL, postal_code = NULL, vehicle_plate = NULL, alert_note = NULL, room_discount_pct = 0, extra_discount_pct = 0,
                anonymized_at = now(), anonymized_by = @uid, updated_at = now(), version = version + 1
            WHERE id = @id
            """, new { id, last = "Misafir " + tag, uid = tx.User.Id });
        await tx.ExecAsync("UPDATE pms.folios SET name = @name WHERE guest_id = @id AND payer_kind = 'guest'", new { id, name = "Anonim Misafir " + tag });
        var keys = await tx.ListAsync<Guid>("""
            UPDATE pms.documents SET deleted_at = now(), deleted_by = @uid
            WHERE entity_type = 'guest' AND entity_id = @id AND deleted_at IS NULL RETURNING object_key
            """, new { id, uid = tx.User.Id });
        // Daha önce erişimden kaldırılmış belgelerin dosyaları da imha edilir.
        keys.AddRange(await tx.ListAsync<Guid>("SELECT object_key FROM pms.documents WHERE entity_type = 'guest' AND entity_id = @id AND deleted_at IS NOT NULL", new { id }));
        return keys.Distinct().ToList();
    }

    static void DeleteFiles(PmsPaths paths, IEnumerable<Guid> keys)
    {
        foreach (var k in keys)
        {
            try { File.Delete(DocumentEndpoints.ObjectPath(paths, k)); } catch (IOException) { /* dosya kilitliyse bir sonraki imhada yeniden denenir */ }
        }
    }

    static void Sheet(XLWorkbook wb, string name, string[] headers, IEnumerable<object?[]> rows)
    {
        var ws = wb.Worksheets.Add(name);
        for (var i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        var r = 2;
        foreach (var row in rows)
        {
            for (var i = 0; i < row.Length; i++)
                ws.Cell(r, i + 1).Value = row[i] switch { null => "", decimal d => d, long l => l, var o => o.ToString() };
            r++;
        }
    }
}
