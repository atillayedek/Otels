using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Integrations;

/// <summary>
/// Entegrasyon adaptör sözleşmesi. Satıcıya özel kod PMS çekirdeğine gömülmez; her sağlayıcı bu arayüzü uygular.
/// Bir adaptör gerçek, doğrulanmış bir sağlayıcı sözleşmesi olmadan "kullanılabilir" bildirilmez.
/// </summary>
public interface IIntegrationAdapter
{
    string Code { get; }
    string Category { get; }
    string DisplayName { get; }
    /// <summary>Gerçek sağlayıcı bağlantısı uygulanmış mı? false ise arayüzde etkinleştirme sunulmaz.</summary>
    bool Implemented { get; }
    string StatusMessage { get; }
}

public sealed record IntegrationCatalogItem(string Code, string Category, string DisplayName, bool Implemented, bool Enabled, string Status);

/// <summary>
/// KBS (EGM / Jandarma): resmi makine API sözleşmesi ve tesis yetkilendirmesi bu kurulumda bulunmadığından
/// adaptör uygulanmamıştır. Endpoint tahmin edilmez; bildirimler blocked_configuration durumunda bekler ve
/// operatör resmi portalda yaptığı bildirimin referansını "manuel bildirildi" olarak kaydedebilir.
/// </summary>
public sealed class KbsAdapter(string code, string name) : IIntegrationAdapter
{
    public string Code { get; } = code;
    public string Category => "kbs";
    public string DisplayName { get; } = name;
    public bool Implemented => false;
    public string StatusMessage => "KBS entegrasyonu yapılandırılmamış.";
}

public sealed class PlannedAdapter(string code, string category, string name) : IIntegrationAdapter
{
    public string Code { get; } = code;
    public string Category { get; } = category;
    public string DisplayName { get; } = name;
    public bool Implemented => false;
    public string StatusMessage => "Bu entegrasyon için yapılandırılmış bir sağlayıcı adaptörü yok.";
}

public sealed class IntegrationRegistry
{
    public IReadOnlyList<IIntegrationAdapter> Adapters { get; } =
    [
        new KbsAdapter("kbs_egm", "KBS - Emniyet Genel Müdürlüğü"),
        new KbsAdapter("kbs_jandarma", "KBS - Jandarma"),
        new PlannedAdapter("door_lock", "door_lock", "Kapı kilit sistemi"),
        new PlannedAdapter("pos", "pos", "POS / Restoran"),
        new PlannedAdapter("pbx", "pbx", "Santral (PBX)"),
        new PlannedAdapter("channel_manager", "channel_manager", "Kanal yöneticisi"),
        new PlannedAdapter("booking_engine", "booking_engine", "Rezervasyon motoru"),
        new PlannedAdapter("e_invoice", "e_document", "e-Fatura / e-Arşiv"),
        new PlannedAdapter("accounting_export", "accounting", "Muhasebe aktarımı"),
        new PlannedAdapter("sms", "messaging", "SMS"),
        new PlannedAdapter("email", "messaging", "E-posta (SMTP)"),
        new PlannedAdapter("payment_terminal", "payment", "Ödeme terminali"),
        new PlannedAdapter("minibar", "minibar", "Minibar"),
        new PlannedAdapter("iptv", "iptv", "IPTV"),
    ];

    public bool KbsAvailable => Adapters.Any(a => a.Category == "kbs" && a.Implemented);
}

public sealed record IdentityReportDto(Guid Id, Guid ReservationId, string ReservationNumber, string? RoomNumber, Guid GuestId, string GuestName,
    string Event, string Status, string? ManualReference, string? ManualReason, DateTime CreatedAt, DateTime UpdatedAt);
public sealed record ManualReportRequest(string Reference, string Reason);

public sealed record KbsFormHead(Guid ReservationId, string ReservationNumber, string? RoomNumber, DateOnly Arrival, DateOnly Departure,
    DateTime? CheckedInAt, string Status, string PropertyName, string? PropertyAddress, string? PropertyCity);
public sealed record KbsFormGuest(Guid GuestId, bool IsPrimary, string FirstName, string LastName, string? Gender, DateOnly? BirthDate, string? BirthPlace,
    string? FatherName, string? MotherName, string? Nationality, string? IdentityType, string? IdentityNumber, string? IdentityCountry,
    DateOnly? IdentityExpiry, Guid? ReportId, string? ReportStatus, string? ManualReference)
{
    public IReadOnlyList<string> Missing { get; init; } = [];
}
public sealed record KbsForm(KbsFormHead Reservation, IReadOnlyList<KbsFormGuest> Guests, bool AutomaticSendingAvailable, bool IdentityVisible)
{
    /// <summary>Formda boş kalan temel alanlar. Hangi alanların zorunlu olduğu resmi KBS ekranına göre değişebilir; burada yalnız boşluk bildirilir.</summary>
    public static IReadOnlyList<string> MissingFields(KbsFormGuest g)
    {
        var m = new List<string>();
        if (string.IsNullOrWhiteSpace(g.Nationality)) m.Add("Uyruk");
        if (string.IsNullOrWhiteSpace(g.IdentityType)) m.Add("Kimlik türü");
        if (string.IsNullOrWhiteSpace(g.IdentityNumber)) m.Add("Kimlik no");
        if (g.BirthDate is null) m.Add("Doğum tarihi");
        if (string.IsNullOrWhiteSpace(g.Gender)) m.Add("Cinsiyet");
        if (g.Nationality is not null and not "TR")
        {
            if (string.IsNullOrWhiteSpace(g.FatherName)) m.Add("Baba adı");
            if (string.IsNullOrWhiteSpace(g.MotherName)) m.Add("Anne adı");
        }
        return m;
    }
}

public static class KbsService
{
    /// <summary>Konaklama olayı için her misafire bildirim kaydı oluşturur (aynı transaction içinde).</summary>
    public static async Task CreateReportsAsync(Tx tx, IntegrationRegistry registry, Guid reservationId, string evt)
    {
        var status = registry.KbsAvailable ? "queued" : "blocked_configuration";
        var guests = await tx.ListAsync<Guid>("SELECT guest_id FROM pms.reservation_guests WHERE reservation_id = @reservationId", new { reservationId });
        foreach (var g in guests)
            await tx.ExecAsync("""
                INSERT INTO pms.identity_reports (reservation_id, guest_id, event, status, updated_by)
                VALUES (@reservationId, @g, @evt, @status, @uid)
                """, new { reservationId, g, evt, status, uid = tx.User.Id });
        tx.Publish("kbs");
    }

    public static void Map(WebApplication app)
    {
        var integ = app.MapGroup("/api/v1/integrations").WithTags("Integrations");
        integ.MapGet("/", async (IntegrationRegistry reg, Db db) =>
        {
            var enabled = (await db.QueryAsync<(string Code, bool Enabled)>("SELECT code, enabled FROM pms.integrations")).ToDictionary(x => x.Code, x => x.Enabled);
            return reg.Adapters.Select(a => new IntegrationCatalogItem(a.Code, a.Category, a.DisplayName, a.Implemented,
                a.Implemented && enabled.GetValueOrDefault(a.Code), a.StatusMessage)).ToList();
        }).RequirePermission("integration.manage");

        var g = app.MapGroup("/api/v1/kbs").WithTags("Integrations");
        g.MapGet("/status", (IntegrationRegistry reg) => new
        {
            configured = reg.KbsAvailable,
            message = reg.KbsAvailable ? "KBS entegrasyonu etkin." : "KBS entegrasyonu yapılandırılmamış.",
        }).RequirePermission("kbs.manage");

        g.MapGet("/reports", (Db db, string? status) => db.QueryAsync<IdentityReportDto>("""
            SELECT ir.id, ir.reservation_id, r.reservation_number, rm.number AS room_number, ir.guest_id, gu.first_name || ' ' || gu.last_name AS guest_name,
                   ir.event, ir.status, ir.manual_reference, ir.manual_reason, ir.created_at, ir.updated_at
            FROM pms.identity_reports ir JOIN pms.reservations r ON r.id = ir.reservation_id JOIN pms.guests gu ON gu.id = ir.guest_id
            LEFT JOIN pms.rooms rm ON rm.id = r.room_id
            WHERE (@status::text IS NULL AND ir.status NOT IN ('accepted','reported_manually','superseded')) OR ir.status = @status
            ORDER BY ir.created_at DESC LIMIT 1000
            """, new { status })).RequirePermission("kbs.manage");

        g.MapPost("/reports/{id:guid}/manual", (Guid id, ManualReportRequest req, CommandRunner cmd) => cmd.RunAsync("kbs.manual", new { id, req }, async tx =>
        {
            var reference = Validate.Required(req.Reference, "Bildirim referansı", 100);
            var reason = Validate.Required(req.Reason, "Açıklama", 300);
            var n = await tx.ExecAsync("""
                UPDATE pms.identity_reports SET status = 'reported_manually', manual_reference = @reference, manual_reason = @reason,
                    updated_at = now(), updated_by = @uid
                WHERE id = @id AND status IN ('needs_data','blocked_configuration','rejected','outcome_unknown','manual_action_required','retry_scheduled')
                """, new { id, reference, reason, uid = tx.User.Id });
            if (n == 0) throw PmsException.Conflict("Bu bildirim manuel olarak işaretlenebilecek durumda değil.");
            await tx.AuditAsync("kbs.manual", "identity_report", id, null, new { reference }, reason);
            tx.Publish("kbs");
            return new { id };
        })).RequirePermission("kbs.manage");

        // Konaklama bazında bildirim formu: oda, tarihler ve odadaki her misafirin kimlik alanları.
        // Kimlik numarası yalnız guest.identity.view yetkisiyle maskesiz döner; formun açılması denetim kaydına yazılır.
        g.MapGet("/reservations/{id:guid}/form", (Guid id, CommandRunner cmd, RequestContext ctx, IntegrationRegistry reg) => cmd.ReadAsync(async tx =>
        {
            var head = await tx.OneOrNullAsync<KbsFormHead>("""
                SELECT r.id AS reservation_id, r.reservation_number, rm.number AS room_number, r.arrival, r.departure, r.checked_in_at, r.status,
                       p.name AS property_name, p.address AS property_address, p.city AS property_city
                FROM pms.reservations r LEFT JOIN pms.rooms rm ON rm.id = r.room_id CROSS JOIN pms.property p WHERE r.id = @id
                """, new { id }) ?? throw PmsException.NotFound("Rezervasyon");
            var guests = await tx.ListAsync<KbsFormGuest>("""
                SELECT g.id AS guest_id, rg.is_primary, g.first_name, g.last_name, g.gender, g.birth_date, g.birth_place, g.father_name, g.mother_name,
                       g.nationality::text AS nationality, g.identity_type, g.identity_number, g.identity_country::text AS identity_country, g.identity_expiry,
                       ir.id AS report_id, ir.status AS report_status, ir.manual_reference
                FROM pms.reservation_guests rg JOIN pms.guests g ON g.id = rg.guest_id
                LEFT JOIN LATERAL (SELECT x.id, x.status, x.manual_reference FROM pms.identity_reports x
                                   WHERE x.reservation_id = rg.reservation_id AND x.guest_id = rg.guest_id AND x.event = 'check_in'
                                   ORDER BY x.created_at DESC LIMIT 1) ir ON true
                WHERE rg.reservation_id = @id ORDER BY rg.is_primary DESC, g.last_name, g.first_name
                """, new { id });
            var canSee = ctx.RequireUser().Has("guest.identity.view");
            await tx.AuditAsync("kbs.form_view", "reservation", id);
            return new KbsForm(head, guests.Select(x => x with
            {
                IdentityNumber = canSee ? x.IdentityNumber : Validate.Mask(x.IdentityNumber),
                Missing = KbsForm.MissingFields(x),
            }).ToList(), reg.KbsAvailable, canSee);
        })).RequirePermission("kbs.manage");

        // Resmi KBS ekranından yapılan bildirimin referansı, konaklamadaki bekleyen tüm giriş bildirimlerine tek seferde işlenir.
        g.MapPost("/reservations/{id:guid}/manual", (Guid id, ManualReportRequest req, CommandRunner cmd) => cmd.RunAsync("kbs.manual_reservation", new { id, req }, async tx =>
        {
            var reference = Validate.Required(req.Reference, "Bildirim referansı", 100);
            var reason = Validate.Required(req.Reason, "Açıklama", 300);
            var ids = await tx.ListAsync<Guid>("""
                UPDATE pms.identity_reports SET status = 'reported_manually', manual_reference = @reference, manual_reason = @reason,
                    updated_at = now(), updated_by = @uid
                WHERE reservation_id = @id AND event = 'check_in'
                  AND status IN ('needs_data','blocked_configuration','rejected','outcome_unknown','manual_action_required','retry_scheduled')
                RETURNING id
                """, new { id, reference, reason, uid = tx.User.Id });
            if (ids.Count == 0) throw PmsException.Conflict("Bu konaklama için bekleyen kimlik bildirimi yok.");
            await tx.AuditAsync("kbs.manual", "reservation", id, null, new { reference, reports = ids.Count }, reason);
            tx.Publish("kbs");
            return new { count = ids.Count };
        })).RequirePermission("kbs.manage");
    }
}
