using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Integrations;

namespace HotelPms.Server.Modules.Reservations;

public static class ReservationEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/reservations").WithTags("Reservations");

        g.MapGet("/", async (Db db, string? q, string? status, DateOnly? from, DateOnly? to, string? view, Guid? groupId, int page = 1, int pageSize = 50) =>
        {
            var p = new PageRequest(page, pageSize);
            var term = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
            var bd = await db.ScalarAsync<DateOnly>("SELECT business_date FROM pms.property LIMIT 1");
            // view: arrivals | departures | inhouse | all
            const string where = """
                WHERE (@term::text IS NULL OR r.reservation_number ILIKE @term || '%' OR (g.first_name || ' ' || g.last_name) ILIKE '%' || @term || '%'
                       OR rm.number = @term OR c.name ILIKE '%' || @term || '%' OR a.name ILIKE '%' || @term || '%')
                  AND (@status::text IS NULL OR r.status = @status)
                  AND (@groupId::uuid IS NULL OR r.group_id = @groupId)
                  AND (@from::date IS NULL OR r.departure > @from)
                  AND (@to::date IS NULL OR r.arrival <= @to)
                  AND (@view::text IS NULL OR @view = 'all'
                       OR (@view = 'arrivals' AND r.arrival = @bd AND r.status IN ('tentative','confirmed'))
                       OR (@view = 'departures' AND r.departure <= @bd AND r.status = 'checked_in')
                       OR (@view = 'inhouse' AND r.status = 'checked_in'))
                """;
            const string from_ = """
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id JOIN pms.room_types t ON t.id = r.room_type_id
                LEFT JOIN pms.rooms rm ON rm.id = r.room_id LEFT JOIN pms.companies c ON c.id = r.company_id LEFT JOIN pms.agencies a ON a.id = r.agency_id
                """;
            var prm = new { term, status, from, to, view, groupId, bd, p.Limit, p.Offset };
            var total = await db.ScalarAsync<long>("SELECT count(*) " + from_ + "\n" + where, prm);
            var items = await db.QueryAsync<ReservationListItem>($"""
                SELECT r.id, r.reservation_number, r.status, g.first_name || ' ' || g.last_name AS guest_name, g.is_vip AS guest_is_vip,
                       c.name AS company_name, a.name AS agency_name, t.code AS room_type_code, rm.number AS room_number, r.arrival, r.departure,
                       r.adults, r.children, r.nightly_rate, r.currency::text AS currency, r.source,
                       COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.reservation_id = r.id), 0) AS balance
                {from_} {where}
                ORDER BY CASE WHEN @view = 'departures' THEN r.departure ELSE r.arrival END, rm.number NULLS LAST, r.reservation_number
                LIMIT @Limit OFFSET @Offset
                """, prm);
            return new Paged<ReservationListItem>(items, total, page, p.Limit);
        }).RequirePermission("reservation.view");

        g.MapGet("/{id:guid}", async (Guid id, CommandRunner cmd) =>
            await cmd.ReadAsync(tx => ReservationService.GetAsync(tx, id)) ?? throw PmsException.NotFound("Rezervasyon"))
            .RequirePermission("reservation.view");

        g.MapGet("/{id:guid}/history", (Guid id, Db db) => db.QueryAsync<AuditRow>("""
            SELECT at, username, action, reason FROM pms.audit_log WHERE entity_type = 'reservation' AND entity_id = @id::text ORDER BY at DESC LIMIT 200
            """, new { id })).RequirePermission("reservation.view");

        g.MapGet("/{id:guid}/guests", (Guid id, Db db) => db.QueryAsync<SharerDto>("""
            SELECT g.id, g.first_name || ' ' || g.last_name AS name, rg.is_primary, g.nationality::text AS nationality,
                   (g.identity_number IS NOT NULL) AS has_identity
            FROM pms.reservation_guests rg JOIN pms.guests g ON g.id = rg.guest_id WHERE rg.reservation_id = @id ORDER BY rg.is_primary DESC, g.last_name
            """, new { id })).RequirePermission("reservation.view");

        g.MapPost("/{id:guid}/guests", (Guid id, AddSharerRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.add_guest", new { id, req }, async tx =>
        {
            var status = await tx.ScalarAsync<string?>("SELECT status FROM pms.reservations WHERE id = @id FOR UPDATE", new { id }) ?? throw PmsException.NotFound("Rezervasyon");
            if (status is "cancelled" or "no_show" or "checked_out") throw PmsException.Validation("Bu rezervasyona misafir eklenemez.");
            await tx.ExecAsync("INSERT INTO pms.reservation_guests (reservation_id, guest_id) VALUES (@id, @GuestId) ON CONFLICT DO NOTHING", new { id, req.GuestId });
            if (status == "checked_in")
            {
                var reg = new IntegrationRegistry();
                await tx.ExecAsync("""
                    INSERT INTO pms.identity_reports (reservation_id, guest_id, event, status, updated_by) VALUES (@id, @GuestId, 'check_in', @st, @uid)
                    """, new { id, req.GuestId, st = reg.KbsAvailable ? "queued" : "blocked_configuration", uid = tx.User.Id });
            }
            await tx.AuditAsync("reservation.add_guest", "reservation", id, null, req);
            tx.Publish("reservations", id);
            return new { id };
        }, requireKey: false)).RequirePermission("reservation.edit");

        g.MapDelete("/{id:guid}/guests/{guestId:guid}", (Guid id, Guid guestId, CommandRunner cmd) => cmd.RunAsync("reservation.remove_guest", new { id, guestId }, async tx =>
        {
            var n = await tx.ExecAsync("DELETE FROM pms.reservation_guests WHERE reservation_id = @id AND guest_id = @guestId AND NOT is_primary", new { id, guestId });
            if (n == 0) throw PmsException.Validation("Ana misafir kaldırılamaz.");
            await tx.AuditAsync("reservation.remove_guest", "reservation", id, new { guestId });
            tx.Publish("reservations", id);
            return new { id };
        }, requireKey: false)).RequirePermission("reservation.edit");

        g.MapPost("/", (SaveReservationRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.create", req, async tx =>
            new { id = await ReservationService.CreateAsync(tx, req) })).RequirePermission("reservation.create");

        g.MapPut("/{id:guid}", (Guid id, SaveReservationRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.update", new { id, req }, async tx =>
        {
            await ReservationService.UpdateAsync(tx, id, req);
            return new { id };
        })).RequirePermission("reservation.edit");

        g.MapPost("/{id:guid}/cancel", (Guid id, CancelRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.cancel", new { id, req }, async tx =>
        {
            await ReservationService.CancelAsync(tx, id, req);
            return new { id };
        })).RequirePermission("reservation.cancel");

        g.MapPost("/{id:guid}/no-show", (Guid id, VersionRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.no_show", new { id, req }, async tx =>
        {
            await ReservationService.NoShowAsync(tx, id, req.Version);
            return new { id };
        })).RequirePermission("reservation.cancel");

        g.MapPost("/{id:guid}/assign-room", (Guid id, AssignRoomRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.assign_room", new { id, req }, async tx =>
        {
            await ReservationService.AssignRoomAsync(tx, id, req);
            return new { id };
        })).RequirePermission("room.change");

        g.MapPost("/{id:guid}/check-in", (Guid id, CheckInRequest req, CommandRunner cmd, IntegrationRegistry reg) => cmd.RunAsync("reservation.check_in", new { id, req }, async tx =>
        {
            await ReservationService.CheckInAsync(tx, reg, id, req);
            return new { id };
        })).RequirePermission("checkin.execute");

        g.MapPost("/walk-in", (WalkInRequest req, CommandRunner cmd, IntegrationRegistry reg) => cmd.RunAsync("reservation.walk_in", req, async tx =>
            new { id = await ReservationService.WalkInAsync(tx, reg, req) })).RequirePermission("checkin.execute", "reservation.create");

        g.MapPost("/{id:guid}/check-out", (Guid id, CheckOutRequest req, CommandRunner cmd, IntegrationRegistry reg) => cmd.RunAsync("reservation.check_out", new { id, req }, async tx =>
        {
            await ReservationService.CheckOutAsync(tx, reg, id, req);
            return new { id };
        })).RequirePermission("checkout.execute");

        g.MapPost("/{id:guid}/move", (Guid id, MoveRoomRequest req, CommandRunner cmd, IntegrationRegistry reg) => cmd.RunAsync("reservation.move", new { id, req }, async tx =>
        {
            await ReservationService.MoveRoomAsync(tx, reg, id, req);
            return new { id };
        })).RequirePermission("room.change");

        g.MapPost("/{id:guid}/departure", (Guid id, ChangeStayRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.change_departure", new { id, req }, async tx =>
        {
            await ReservationService.ChangeDepartureAsync(tx, id, req);
            return new { id };
        })).RequirePermission("reservation.edit");

        g.MapGet("/{id:guid}/rates", (Guid id, Db db) => db.QueryAsync<NightRate>(
            "SELECT stay_date AS date, rate FROM pms.reservation_rates WHERE reservation_id = @id ORDER BY stay_date", new { id }))
            .RequirePermission("reservation.view");

        // ---- Müsaitlik ve fiyat
        app.MapGet("/api/v1/availability", async (DateOnly from, DateOnly to, Guid? roomTypeId, Guid? agencyId, CommandRunner cmd) =>
        {
            if (to <= from || to.DayNumber - from.DayNumber > 120) throw PmsException.Validation("Tarih aralığı 1-120 gün olmalıdır.");
            var days = await cmd.ReadAsync(tx => ReservationService.AvailabilityAsync(tx, from, to, roomTypeId, null, agencyId));
            return days.Select(d => d with { Available = d.Total - d.Blocked - d.Sold - d.Held }).ToList();
        }).WithTags("Reservations").RequirePermission("reservation.view");

        app.MapGet("/api/v1/rates/preview", (Guid roomTypeId, Guid? ratePlanId, DateOnly arrival, DateOnly departure, CommandRunner cmd) =>
        {
            Validate.DateRange(arrival, departure);
            return cmd.ReadAsync(tx => ReservationService.ComputeRatesAsync(tx, roomTypeId, ratePlanId, arrival, departure));
        }).WithTags("Reservations").RequirePermission("reservation.view");

        // ---- Room rack
        app.MapGet("/api/v1/rack", async (DateOnly? from, int? days, Db db) =>
        {
            var bd = await db.ScalarAsync<DateOnly>("SELECT business_date FROM pms.property LIMIT 1");
            var start = from ?? bd.AddDays(-1);
            var end = start.AddDays(Math.Clamp(days ?? 14, 1, 62));
            var rooms = await db.QueryAsync<RackRoom>("""
                SELECT r.id, r.number, r.floor, r.room_type_id, t.code AS room_type_code, r.hk_status, r.is_dnd, r.sort_order
                FROM pms.rooms r JOIN pms.room_types t ON t.id = r.room_type_id WHERE r.is_active ORDER BY t.sort_order, r.sort_order, r.number
                """);
            const string barSql = """
                SELECT r.id AS reservation_id, r.reservation_number, r.room_id, r.room_type_id, r.status, g.first_name || ' ' || g.last_name AS guest_name,
                       g.is_vip, r.arrival, r.departure, r.adults, r.children, c.name AS company_name, a.name AS agency_name,
                       COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.reservation_id = r.id), 0) AS balance
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
                LEFT JOIN pms.companies c ON c.id = r.company_id LEFT JOIN pms.agencies a ON a.id = r.agency_id
                WHERE r.arrival < @end AND r.departure > @start
                """;
            var bars = await db.QueryAsync<RackBar>(barSql + " AND r.room_id IS NOT NULL AND r.status IN ('tentative','confirmed','checked_in','checked_out')", new { start, end });
            var unassigned = await db.QueryAsync<RackBar>(barSql + " AND r.room_id IS NULL AND r.status IN ('tentative','confirmed') ORDER BY r.arrival", new { start, end });
            var blocks = await db.QueryAsync<RackBlock>("""
                SELECT id, room_id, kind, date_from, date_to, reason FROM pms.room_blocks WHERE is_active AND date_from < @end AND date_to > @start
                """, new { start, end });
            return new RackResponse(start, end, bd, rooms, bars, blocks, unassigned);
        }).WithTags("Reservations").RequirePermission("reservation.view");

        // ---- Uyandırma
        var w = app.MapGroup("/api/v1/wakeup-calls").WithTags("Reservations");
        w.MapGet("/", (Db db, DateOnly? date) => db.QueryAsync<WakeupDto>("""
            SELECT w.id, w.reservation_id, rm.number AS room_number, g.first_name || ' ' || g.last_name AS guest_name, w.call_at, w.status, w.notes
            FROM pms.wakeup_calls w JOIN pms.reservations r ON r.id = w.reservation_id JOIN pms.guests g ON g.id = r.guest_id
            LEFT JOIN pms.rooms rm ON rm.id = r.room_id
            WHERE (@date::date IS NULL AND w.status = 'pending') OR (w.call_at AT TIME ZONE (SELECT time_zone FROM pms.property LIMIT 1))::date = @date
            ORDER BY w.call_at
            """, new { date })).RequirePermission("reservation.view");
        w.MapPost("/", (CreateWakeupRequest req, CommandRunner cmd) => cmd.RunAsync("wakeup.create", req, async tx =>
        {
            var st = await tx.ScalarAsync<string?>("SELECT status FROM pms.reservations WHERE id = @ReservationId", new { req.ReservationId }) ?? throw PmsException.NotFound("Rezervasyon");
            if (st is not ("checked_in" or "confirmed")) throw PmsException.Validation("Uyandırma yalnız aktif konaklama için girilebilir.");
            if (req.CallAt < DateTime.UtcNow) throw PmsException.Validation("Uyandırma zamanı geçmişte olamaz.");
            var id = await tx.ScalarAsync<Guid>("INSERT INTO pms.wakeup_calls (reservation_id, call_at, notes, created_by) VALUES (@ReservationId, @CallAt, @notes, @uid) RETURNING id",
                new { req.ReservationId, req.CallAt, notes = Validate.Optional(req.Notes, 300), uid = tx.User.Id });
            await tx.AuditAsync("wakeup.create", "reservation", req.ReservationId, null, req);
            tx.Publish("wakeups");
            return new { id };
        }, requireKey: false)).RequirePermission("reservation.edit");
        w.MapPost("/{id:guid}/{action}", (Guid id, string action, CommandRunner cmd) => cmd.RunAsync("wakeup." + action, new { id }, async tx =>
        {
            if (action is not ("done" or "cancelled")) throw PmsException.Validation("Geçersiz işlem.");
            var n = await tx.ExecAsync("UPDATE pms.wakeup_calls SET status = @action, done_at = now(), done_by = @uid WHERE id = @id AND status = 'pending'",
                new { id, action, uid = tx.User.Id });
            if (n == 0) throw PmsException.NotFound("Bekleyen uyandırma");
            await tx.AuditAsync("wakeup." + action, "wakeup", id);
            tx.Publish("wakeups");
            return new { id };
        }, requireKey: false)).RequirePermission("reservation.edit");
    }

    public sealed record AuditRow(DateTime At, string? Username, string Action, string? Reason);
    public sealed record SharerDto(Guid Id, string Name, bool IsPrimary, string? Nationality, bool HasIdentity);
}
