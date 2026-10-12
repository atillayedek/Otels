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
    }
}
