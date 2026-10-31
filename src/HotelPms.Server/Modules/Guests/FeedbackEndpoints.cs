using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Guests;

public sealed record FeedbackDto(Guid Id, long FeedbackNo, Guid GuestId, string GuestName, Guid? ReservationId, string? ReservationNumber, string? RoomNumber,
    string Kind, string Department, int? Rating, string Source, string Comment, string Status, string? Resolution,
    DateTime CreatedAt, string? CreatedBy, DateTime? ResolvedAt, string? ResolvedBy);
public sealed record CreateFeedbackRequest(Guid GuestId, Guid? ReservationId, string Kind, string Department, int? Rating, string? Source, string Comment);
public sealed record ResolveFeedbackRequest(string Status, string? Resolution);
public sealed record KeyCardInUseDto(Guid ReservationId, string ReservationNumber, string? RoomNumber, string GuestName, bool IsPrimary, string KeyCardNo,
    DateOnly Departure, bool IsActive);

/// <summary>Misafir yorumları (övgü, şikâyet, öneri) ve çözüm takibi; kullanımdaki oda kartları listesi.</summary>
public static class FeedbackEndpoints
{
    static readonly string[] Kinds = ["compliment", "complaint", "suggestion", "other"];
    static readonly string[] Departments = ["front_office", "housekeeping", "maintenance", "restaurant", "accounting", "management", "other"];
    static readonly string[] Sources = ["in_person", "phone", "email", "survey", "online", "other"];

    const string Select = """
        SELECT f.id, f.feedback_no, f.guest_id, g.first_name || ' ' || g.last_name AS guest_name, f.reservation_id, r.reservation_number, rm.number AS room_number,
               f.kind, f.department, f.rating::int AS rating, f.source, f.comment, f.status, f.resolution, f.created_at, u.username AS created_by, f.resolved_at, ru.username AS resolved_by
        FROM pms.guest_feedback f JOIN pms.guests g ON g.id = f.guest_id
        LEFT JOIN pms.reservations r ON r.id = f.reservation_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
        LEFT JOIN pms.users u ON u.id = f.created_by LEFT JOIN pms.users ru ON ru.id = f.resolved_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/guest-feedback").WithTags("Guests").RequirePermission("feedback.manage");

        g.MapGet("/", async (CommandRunner cmd, string? status, string? kind, Guid? guestId, Guid? reservationId, DateOnly? from, DateOnly? to) => await cmd.ReadAsync(tx =>
            tx.ListAsync<FeedbackDto>(Select + """
                 WHERE (@status::text IS NULL OR f.status = @status) AND (@kind::text IS NULL OR f.kind = @kind)
                   AND (@guestId::uuid IS NULL OR f.guest_id = @guestId) AND (@reservationId::uuid IS NULL OR f.reservation_id = @reservationId)
                   AND (@from::date IS NULL OR f.created_at >= @from::date) AND (@to::date IS NULL OR f.created_at < @to::date + 1)
                ORDER BY f.status = 'open' DESC, f.created_at DESC LIMIT 1000
                """, new { status = Empty(status), kind = Empty(kind), guestId, reservationId, from, to })));

        g.MapPost("/", (CreateFeedbackRequest req, CommandRunner cmd) => cmd.RunAsync("feedback.create", req, async tx =>
        {
            if (!Kinds.Contains(req.Kind)) throw PmsException.Validation("Geçersiz yorum türü.");
            if (!Departments.Contains(req.Department)) throw PmsException.Validation("Geçersiz bölüm.");
            var source = string.IsNullOrEmpty(req.Source) ? "in_person" : req.Source;
            if (!Sources.Contains(source)) throw PmsException.Validation("Geçersiz kaynak.");
            if (req.Rating is { } rt && rt is < 1 or > 5) throw PmsException.Validation("Puan 1 ile 5 arasında olmalıdır.");
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.guests WHERE id = @GuestId)", req)) throw PmsException.NotFound("Misafir");
            if (req.ReservationId is { } rid && !await tx.ScalarAsync<bool>("""
                SELECT EXISTS (SELECT 1 FROM pms.reservations r WHERE r.id = @rid
                  AND (r.guest_id = @GuestId OR EXISTS (SELECT 1 FROM pms.reservation_guests x WHERE x.reservation_id = r.id AND x.guest_id = @GuestId)))
                """, new { rid, req.GuestId }))
                throw PmsException.Validation("Seçilen konaklama bu misafire ait değil.");
            var comment = Validate.Required(req.Comment, "Yorum", 2000);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.guest_feedback (guest_id, reservation_id, kind, department, rating, source, comment, created_by)
                VALUES (@GuestId, @ReservationId, @Kind, @Department, @Rating, @source, @comment, @uid) RETURNING id
                """, new { req.GuestId, req.ReservationId, req.Kind, req.Department, req.Rating, source, comment, uid = tx.User.Id });
            await tx.AuditAsync("feedback.create", "guest", req.GuestId, null, new { id, req.Kind, req.Department, req.Rating });
            tx.Publish("guests", req.GuestId);
            return await tx.OneAsync<FeedbackDto>(Select + " WHERE f.id = @id", new { id });
        }));

        // Çözüldü (açıklama zorunlu) veya kapatıldı (işlem gerekmiyor). Kapanan kayıt yeniden açılmaz; yeni yorum girilir.
        g.MapPost("/{id:guid}/resolve", (Guid id, ResolveFeedbackRequest req, CommandRunner cmd) => cmd.RunAsync("feedback.resolve", new { id, req }, async tx =>
        {
            if (req.Status is not ("resolved" or "closed")) throw PmsException.Validation("Durum 'resolved' veya 'closed' olmalıdır.");
            var resolution = req.Status == "resolved" ? Validate.Required(req.Resolution, "Yapılan işlem", 1000) : Validate.Optional(req.Resolution, 1000, "Açıklama");
            var gid = await tx.ScalarAsync<Guid?>("""
                UPDATE pms.guest_feedback SET status = @Status, resolution = @resolution, resolved_at = now(), resolved_by = @uid
                WHERE id = @id AND status = 'open' RETURNING guest_id
                """, new { id, req.Status, resolution, uid = tx.User.Id }) ?? throw PmsException.Validation("Yorum bulunamadı veya zaten kapatılmış.");
            await tx.AuditAsync("feedback." + req.Status, "guest", gid, null, new { id, resolution });
            tx.Publish("guests", gid);
            return await tx.OneAsync<FeedbackDto>(Select + " WHERE f.id = @id", new { id });
        }, requireKey: false));

        // Kullanımdaki kartlar: konaklayanlara verilmiş oda kartları (kart kilidi yazılımıyla karşılaştırma ve kayıp kart takibi için).
        app.MapGet("/api/v1/key-cards/in-use", async (CommandRunner cmd) => await cmd.ReadAsync(tx =>
            tx.ListAsync<KeyCardInUseDto>("""
                SELECT r.id AS reservation_id, r.reservation_number, rm.number AS room_number, g.first_name || ' ' || g.last_name AS guest_name,
                       rg.is_primary, rg.key_card_no, r.departure, rg.is_active
                FROM pms.reservation_guests rg JOIN pms.reservations r ON r.id = rg.reservation_id JOIN pms.guests g ON g.id = rg.guest_id
                LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                WHERE r.status = 'checked_in' AND rg.key_card_no IS NOT NULL
                ORDER BY rm.sort_order, rm.number, rg.is_primary DESC, g.last_name
                """))).WithTags("Guests").RequirePermission("reservation.view");
    }

    static string? Empty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
