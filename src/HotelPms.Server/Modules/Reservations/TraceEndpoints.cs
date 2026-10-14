using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Reservations;

public sealed record TraceDto(Guid Id, Guid ReservationId, string ReservationNumber, string GuestName, string? RoomNumber, string Department, string Message,
    DateOnly DueDate, string Status, DateTime CreatedAt, string? CreatedBy, DateTime? DoneAt, string? DoneBy, string? DoneNote);
public sealed record CreateTraceRequest(string Department, string Message, DateOnly DueDate);
public sealed record CompleteTraceRequest(string Status, string? Note);

/// <summary>
/// Misafir hatırlatmaları (trace): bir rezervasyona bağlı, belirli günde ilgili bölümün yapması gereken iş
/// (ör. "doğum günü pastası", "havalimanı transferi 07:00", "fatura şirkete kesilecek"). Gün sonunda açık kalanlar uyarı olarak görünür.
/// </summary>
public static class TraceEndpoints
{
    static readonly string[] Departments = ["front_office", "housekeeping", "maintenance", "restaurant", "accounting", "management"];

    const string Select = """
        SELECT t.id, t.reservation_id, r.reservation_number, g.first_name || ' ' || g.last_name AS guest_name, rm.number AS room_number, t.department,
               t.message, t.due_date, t.status, t.created_at, u.username AS created_by, t.done_at, du.username AS done_by, t.done_note
        FROM pms.traces t JOIN pms.reservations r ON r.id = t.reservation_id JOIN pms.guests g ON g.id = r.guest_id
        LEFT JOIN pms.rooms rm ON rm.id = r.room_id LEFT JOIN pms.users u ON u.id = t.created_by LEFT JOIN pms.users du ON du.id = t.done_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/traces").WithTags("Reservations").RequirePermission("trace.manage");

        // Açık hatırlatmalar (bugün ve geçmiş günler) veya bir rezervasyonun tüm hatırlatmaları
        g.MapGet("/", async (CommandRunner cmd, Guid? reservationId, string? department, bool? upcoming) => await cmd.ReadAsync(async tx =>
        {
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            return await tx.ListAsync<TraceDto>(Select + """
                 WHERE (@reservationId::uuid IS NOT NULL AND t.reservation_id = @reservationId)
                    OR (@reservationId::uuid IS NULL AND t.status = 'open' AND (t.due_date <= @bd OR @upcoming)
                        AND (@department::text IS NULL OR t.department = @department))
                ORDER BY t.status = 'open' DESC, t.due_date, t.created_at LIMIT 500
                """, new { reservationId, department = string.IsNullOrWhiteSpace(department) ? null : department, bd, upcoming = upcoming ?? false });
        }));

        app.MapPost("/api/v1/reservations/{id:guid}/traces", (Guid id, CreateTraceRequest req, CommandRunner cmd) => cmd.RunAsync("trace.create", new { id, req }, async tx =>
        {
            var r = await tx.OneOrNullAsync<(string Status, DateOnly Departure)>("SELECT status, departure FROM pms.reservations WHERE id = @id", new { id });
            if (r == default) throw PmsException.NotFound("Rezervasyon");
            if (r.Status is "cancelled" or "no_show" or "checked_out") throw PmsException.Validation("Kapanmış rezervasyona hatırlatma eklenemez.");
            if (!Departments.Contains(req.Department)) throw PmsException.Validation("Geçersiz bölüm.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            if (req.DueDate < bd) throw PmsException.Validation("Hatırlatma tarihi iş gününden önce olamaz.");
            if (req.DueDate > r.Departure) throw PmsException.Validation("Hatırlatma tarihi çıkış tarihinden sonra olamaz.");
            var message = Validate.Required(req.Message, "Hatırlatma", 500);
            var tid = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.traces (reservation_id, department, message, due_date, created_by) VALUES (@id, @Department, @message, @DueDate, @uid) RETURNING id
                """, new { id, req.Department, message, req.DueDate, uid = tx.User.Id });
            await tx.AuditAsync("trace.create", "reservation", id, null, new { tid, req.Department, message, req.DueDate });
            tx.Publish("traces", id);
            return await tx.OneAsync<TraceDto>(Select + " WHERE t.id = @tid", new { tid });
        })).WithTags("Reservations").RequirePermission("trace.manage");

        g.MapPost("/{id:guid}/complete", (Guid id, CompleteTraceRequest req, CommandRunner cmd) => cmd.RunAsync("trace.complete", new { id, req }, async tx =>
        {
            if (req.Status is not ("done" or "cancelled")) throw PmsException.Validation("Durum 'done' veya 'cancelled' olmalıdır.");
            var note = req.Status == "cancelled" ? Validate.Required(req.Note, "İptal gerekçesi", 300) : Validate.Optional(req.Note, 300);
            var rid = await tx.ScalarAsync<Guid?>("""
                UPDATE pms.traces SET status = @Status, done_at = now(), done_by = @uid, done_note = @note WHERE id = @id AND status = 'open' RETURNING reservation_id
                """, new { id, req.Status, note, uid = tx.User.Id }) ?? throw PmsException.Validation("Hatırlatma bulunamadı veya zaten kapatılmış.");
            await tx.AuditAsync("trace." + req.Status, "reservation", rid, null, new { id, note });
            tx.Publish("traces", rid);
            return await tx.OneAsync<TraceDto>(Select + " WHERE t.id = @id", new { id });
        })).RequirePermission("trace.manage");
    }
}
