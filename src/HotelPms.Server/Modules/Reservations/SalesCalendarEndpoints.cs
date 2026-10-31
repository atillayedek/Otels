using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Reservations;

public sealed record StopSaleDto(Guid Id, Guid? RoomTypeId, string? RoomTypeCode, DateOnly DateFrom, DateOnly DateTo, string Reason, bool IsActive,
    DateTime CreatedAt, string? CreatedBy, DateTime? ClosedAt, string? ClosedBy);
public sealed record CreateStopSaleRequest(Guid? RoomTypeId, DateOnly DateFrom, DateOnly DateTo, string Reason);

public sealed record CalendarNoteDto(Guid Id, string Kind, DateOnly DateFrom, DateOnly DateTo, string Title, string? Note, string Color,
    DateTime CreatedAt, string? CreatedBy, int Version);
public sealed record SaveCalendarNoteRequest(string Kind, DateOnly DateFrom, DateOnly DateTo, string Title, string? Note, string? Color, int? Version);

/// <summary>
/// Satış takvimi: stop sale (oda tipini tarih aralığında satışa kapama), özel günler (bayram, fuar, maç) ve satış notları
/// (o tarihlere rezervasyon alan herkesin görmesi gereken bilgi, ör. "grup bloğu var, tek gece satılmaz").
/// </summary>
public static class SalesCalendarEndpoints
{
    const string StopSelect = """
        SELECT s.id, s.room_type_id, t.code AS room_type_code, s.date_from, s.date_to, s.reason, s.is_active, s.created_at, u.username AS created_by,
               s.closed_at, cu.username AS closed_by
        FROM pms.stop_sales s LEFT JOIN pms.room_types t ON t.id = s.room_type_id
        LEFT JOIN pms.users u ON u.id = s.created_by LEFT JOIN pms.users cu ON cu.id = s.closed_by
        """;
    const string NoteSelect = """
        SELECT n.id, n.kind, n.date_from, n.date_to, n.title, n.note, n.color, n.created_at, u.username AS created_by, n.version
        FROM pms.calendar_notes n LEFT JOIN pms.users u ON u.id = n.created_by
        """;

    public static void Map(WebApplication app)
    {
        // ------------------------------------------------------------ Stop sale
        var s = app.MapGroup("/api/v1/stop-sales").WithTags("Reservations");

        // Bir tarih aralığına değen kayıtlar; aralık verilmezse iş gününden sonraki etkin kapamalar.
        s.MapGet("/", async (CommandRunner cmd, DateOnly? from, DateOnly? to, bool? all) => await cmd.ReadAsync(async tx =>
        {
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var f = from ?? bd;
            var t = to ?? f.AddYears(2);
            if (t <= f) throw PmsException.Validation("Bitiş tarihi başlangıçtan sonra olmalıdır.");
            return await tx.ListAsync<StopSaleDto>(StopSelect + """
                 WHERE s.date_from < @t AND s.date_to > @f AND (s.is_active OR @all)
                ORDER BY s.is_active DESC, s.date_from, t.code NULLS FIRST LIMIT 1000
                """, new { f, t, all = all ?? false });
        })).RequirePermission("reservation.view");

        s.MapPost("/", (CreateStopSaleRequest req, CommandRunner cmd) => cmd.RunAsync("stop_sale.create", req, async tx =>
        {
            if (req.DateTo <= req.DateFrom) throw PmsException.Validation("Bitiş tarihi başlangıçtan sonra olmalıdır (bitiş günü dahil değildir).");
            if (req.DateTo.DayNumber - req.DateFrom.DayNumber > 731) throw PmsException.Validation("Stop sale en fazla 2 yıllık aralık için verilebilir.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            if (req.DateTo <= bd) throw PmsException.Validation("Geçmiş tarihler için stop sale verilemez.");
            if (req.RoomTypeId is { } rt && !await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.room_types WHERE id = @rt AND is_active)", new { rt }))
                throw PmsException.NotFound("Oda tipi");
            var reason = Validate.Required(req.Reason, "Gerekçe", 200);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.stop_sales (room_type_id, date_from, date_to, reason, created_by) VALUES (@RoomTypeId, @DateFrom, @DateTo, @reason, @uid) RETURNING id
                """, new { req.RoomTypeId, req.DateFrom, req.DateTo, reason, uid = tx.User.Id });
            await tx.AuditAsync("stop_sale.create", "stop_sale", id, null, new { req.RoomTypeId, req.DateFrom, req.DateTo, reason });
            tx.Publish("availability", id);
            return await tx.OneAsync<StopSaleDto>(StopSelect + " WHERE s.id = @id", new { id });
        })).RequirePermission("stop_sale.manage");

        // Kapamayı kaldır (satışa aç). Kayıt silinmez; kim, ne zaman açtı izlenir.
        s.MapPost("/{id:guid}/lift", (Guid id, CommandRunner cmd) => cmd.RunAsync("stop_sale.lift", new { id }, async tx =>
        {
            var n = await tx.ExecAsync("UPDATE pms.stop_sales SET is_active = false, closed_at = now(), closed_by = @uid WHERE id = @id AND is_active",
                new { id, uid = tx.User.Id });
            if (n == 0) throw PmsException.Validation("Stop sale bulunamadı veya zaten kaldırılmış.");
            await tx.AuditAsync("stop_sale.lift", "stop_sale", id);
            tx.Publish("availability", id);
            return await tx.OneAsync<StopSaleDto>(StopSelect + " WHERE s.id = @id", new { id });
        }, requireKey: false)).RequirePermission("stop_sale.manage");

        // ------------------------------------------------------------ Özel günler ve satış notları
        var c = app.MapGroup("/api/v1/calendar-notes").WithTags("Reservations");

        c.MapGet("/", async (CommandRunner cmd, DateOnly? from, DateOnly? to, string? kind) => await cmd.ReadAsync(async tx =>
        {
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var f = from ?? bd;
            var t = to ?? f.AddYears(1);
            if (t < f) throw PmsException.Validation("Bitiş tarihi başlangıçtan önce olamaz.");
            if (kind is not (null or "" or "special_day" or "sales_note")) throw PmsException.Validation("Geçersiz not türü.");
            return await tx.ListAsync<CalendarNoteDto>(NoteSelect + """
                 WHERE n.is_active AND n.date_from <= @t AND n.date_to >= @f AND (@kind::text IS NULL OR n.kind = @kind)
                ORDER BY n.date_from, n.kind, n.title LIMIT 1000
                """, new { f, t, kind = string.IsNullOrEmpty(kind) ? null : kind });
        })).RequirePermission("reservation.view");

        c.MapPost("/", (SaveCalendarNoteRequest req, CommandRunner cmd) => cmd.RunAsync("calendar_note.create", req, async tx =>
        {
            var (title, note, color) = ValidateNote(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.calendar_notes (kind, date_from, date_to, title, note, color, created_by) VALUES (@Kind, @DateFrom, @DateTo, @title, @note, @color, @uid) RETURNING id
                """, new { req.Kind, req.DateFrom, req.DateTo, title, note, color, uid = tx.User.Id });
            await tx.AuditAsync("calendar_note.create", "calendar_note", id, null, new { req.Kind, req.DateFrom, req.DateTo, title });
            tx.Publish("availability", id);
            return await tx.OneAsync<CalendarNoteDto>(NoteSelect + " WHERE n.id = @id", new { id });
        })).RequirePermission("calendar.manage");

        c.MapPut("/{id:guid}", (Guid id, SaveCalendarNoteRequest req, CommandRunner cmd) => cmd.RunAsync("calendar_note.update", new { id, req }, async tx =>
        {
            var (title, note, color) = ValidateNote(req);
            var n = await tx.ExecAsync("""
                UPDATE pms.calendar_notes SET kind = @Kind, date_from = @DateFrom, date_to = @DateTo, title = @title, note = @note, color = @color, version = version + 1
                WHERE id = @id AND is_active AND version = @Version
                """, new { id, req.Kind, req.DateFrom, req.DateTo, title, note, color, Version = req.Version ?? -1 });
            if (n == 0) throw PmsException.Concurrency();
            await tx.AuditAsync("calendar_note.update", "calendar_note", id, null, new { req.Kind, req.DateFrom, req.DateTo, title });
            tx.Publish("availability", id);
            return await tx.OneAsync<CalendarNoteDto>(NoteSelect + " WHERE n.id = @id", new { id });
        }, requireKey: false)).RequirePermission("calendar.manage");

        c.MapDelete("/{id:guid}", (Guid id, CommandRunner cmd) => cmd.RunAsync("calendar_note.delete", new { id }, async tx =>
        {
            var n = await tx.ExecAsync("UPDATE pms.calendar_notes SET is_active = false, version = version + 1 WHERE id = @id AND is_active", new { id });
            if (n == 0) throw PmsException.NotFound("Takvim notu");
            await tx.AuditAsync("calendar_note.delete", "calendar_note", id);
            tx.Publish("availability", id);
            return new { id };
        }, requireKey: false)).RequirePermission("calendar.manage");
    }

    static (string Title, string? Note, string Color) ValidateNote(SaveCalendarNoteRequest req)
    {
        if (req.Kind is not ("special_day" or "sales_note")) throw PmsException.Validation("Not türü özel gün veya satış notu olmalıdır.");
        if (req.DateTo < req.DateFrom) throw PmsException.Validation("Bitiş tarihi başlangıçtan önce olamaz.");
        if (req.DateTo.DayNumber - req.DateFrom.DayNumber > 366) throw PmsException.Validation("Takvim notu en fazla bir yıllık aralık kapsayabilir.");
        var color = string.IsNullOrWhiteSpace(req.Color) ? (req.Kind == "special_day" ? "#d97706" : "#2563eb") : req.Color.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$")) throw PmsException.Validation("Renk #RRGGBB biçiminde olmalıdır.");
        return (Validate.Required(req.Title, "Başlık", 120), Validate.Optional(req.Note, 1000, "Not"), color);
    }
}
