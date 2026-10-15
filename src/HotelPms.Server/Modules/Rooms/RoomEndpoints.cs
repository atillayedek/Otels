using HotelPms.Server.Modules.Platform;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Rooms;

public sealed record RoomTypeDto(Guid Id, string Code, string Name, string? Description, int MaxAdults, int MaxChildren,
    decimal DefaultRate, int SortOrder, bool IsActive, int RoomCount, int Version);
public sealed record SaveRoomTypeRequest(string Code, string Name, string? Description, int MaxAdults, int MaxChildren,
    decimal DefaultRate, int SortOrder, bool IsActive, int? Version);

public sealed record RoomDto(Guid Id, Guid RoomTypeId, string RoomTypeCode, string Number, string? Floor, string? Description,
    string? Features, string HkStatus, bool IsDnd, string? HkNote, int SortOrder, bool IsActive, int Version);
public sealed record SaveRoomRequest(Guid RoomTypeId, string Number, string? Floor, string? Description, string? Features,
    int SortOrder, bool IsActive, int? Version);

public sealed record RoomStatusDto(Guid Id, string Number, string? Floor, Guid RoomTypeId, string RoomTypeCode, string HkStatus, bool IsDnd,
    string? HkNote, DateTime? HkUpdatedAt, string FoStatus, string? BlockKind, string? BlockReason,
    Guid? InHouseReservationId, string? InHouseGuest, DateOnly? InHouseDeparture, bool IsVip,
    Guid? ArrivalReservationId, string? ArrivalGuest, bool DepartureToday, int OpenTasks, int OpenTickets,
    DateTime? InHouseCheckedInAt, string? InHouseAccount, string? InHouseNote, int? InHousePax, decimal? InHouseBalance, string? InHouseCurrency,
    TimeOnly? ArrivalEta, string? ArrivalAccount, string? ArrivalNote, DateOnly? ArrivalDeparture);

public sealed record HousekeepingUpdateRequest(string HkStatus, bool IsDnd, string? HkNote, int Version);

public sealed record RoomBlockDto(Guid Id, Guid RoomId, string RoomNumber, string Kind, DateOnly DateFrom, DateOnly DateTo, string Reason,
    Guid? TicketId, bool IsActive, DateTime CreatedAt, string? CreatedBy);
public sealed record CreateRoomBlockRequest(Guid RoomId, string Kind, DateOnly DateFrom, DateOnly DateTo, string Reason, Guid? TicketId);

public static class RoomEndpoints
{
    const string RoomTypeSelect = """
        SELECT t.id, t.code, t.name, t.description, t.max_adults, t.max_children, t.default_rate, t.sort_order, t.is_active,
               (SELECT count(*)::int FROM pms.rooms r WHERE r.room_type_id = t.id AND r.is_active) AS room_count, t.version
        FROM pms.room_types t
        """;
    const string RoomSelect = """
        SELECT r.id, r.room_type_id, t.code AS room_type_code, r.number, r.floor, r.description, r.features, r.hk_status, r.is_dnd,
               r.hk_note, r.sort_order, r.is_active, r.version
        FROM pms.rooms r JOIN pms.room_types t ON t.id = r.room_type_id
        """;

    public static void Map(WebApplication app)
    {
        var types = app.MapGroup("/api/v1/room-types").WithTags("Rooms");
        types.MapGet("/", (Db db) => db.QueryAsync<RoomTypeDto>(RoomTypeSelect + " ORDER BY t.sort_order, t.code"));
        types.MapPost("/", (SaveRoomTypeRequest req, CommandRunner cmd) => cmd.RunAsync("room_type.create", req, async tx =>
        {
            var p = RoomTypeParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.room_types (code, name, description, max_adults, max_children, default_rate, sort_order, is_active)
                VALUES (@code, @name, @description, @maxAdults, @maxChildren, @defaultRate, @sortOrder, @isActive) RETURNING id
                """, p);
            await tx.AuditAsync("room_type.create", "room_type", id, null, req);
            tx.Publish("rooms");
            return new { id };
        }, requireKey: false)).RequirePermission("room.manage");
        types.MapPut("/{id:guid}", (Guid id, SaveRoomTypeRequest req, CommandRunner cmd) => cmd.RunAsync("room_type.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<RoomTypeDto>(RoomTypeSelect + " WHERE t.id = @id", new { id }) ?? throw PmsException.NotFound("Oda tipi");
            var p = RoomTypeParams(req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.room_types SET code = @code, name = @name, description = @description, max_adults = @maxAdults, max_children = @maxChildren,
                    default_rate = @defaultRate, sort_order = @sortOrder, is_active = @isActive, updated_at = now(), version = version + 1
                WHERE id = @id AND version = @version
                """, new { p.code, p.name, p.description, p.maxAdults, p.maxChildren, p.defaultRate, p.sortOrder, p.isActive, id, version = req.Version ?? -1 });
            await tx.AuditAsync("room_type.update", "room_type", id, before, req);
            tx.Publish("rooms");
            return new { id };
        }, requireKey: false)).RequirePermission("room.manage");

        var rooms = app.MapGroup("/api/v1/rooms").WithTags("Rooms");
        rooms.MapGet("/", (Db db) => db.QueryAsync<RoomDto>(RoomSelect + " ORDER BY r.sort_order, r.number"));
        rooms.MapPost("/", (SaveRoomRequest req, CommandRunner cmd, LicenseService license) => cmd.RunAsync("room.create", req, async tx =>
        {
            var p = RoomParams(req);
            if (req.IsActive) await license.EnsureRoomCapacityAsync(tx);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.rooms (room_type_id, number, floor, description, features, sort_order, is_active)
                VALUES (@roomTypeId, @number, @floor, @description, @features, @sortOrder, @isActive) RETURNING id
                """, p);
            await tx.AuditAsync("room.create", "room", id, null, req);
            tx.Publish("rooms");
            return new { id };
        }, requireKey: false)).RequirePermission("room.manage");
        rooms.MapPut("/{id:guid}", (Guid id, SaveRoomRequest req, CommandRunner cmd) => cmd.RunAsync("room.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<RoomDto>(RoomSelect + " WHERE r.id = @id", new { id }) ?? throw PmsException.NotFound("Oda");
            if (before.RoomTypeId != req.RoomTypeId && await tx.ScalarAsync<bool>(
                    "SELECT EXISTS (SELECT 1 FROM pms.reservations WHERE room_id = @id AND status IN ('confirmed','tentative','checked_in'))", new { id }))
                throw PmsException.Validation("Aktif veya gelecek rezervasyonu olan odanın tipi değiştirilemez.");
            var p = RoomParams(req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.rooms SET room_type_id = @roomTypeId, number = @number, floor = @floor, description = @description, features = @features,
                    sort_order = @sortOrder, is_active = @isActive, updated_at = now(), version = version + 1
                WHERE id = @id AND version = @version
                """, new { p.roomTypeId, p.number, p.floor, p.description, p.features, p.sortOrder, p.isActive, id, version = req.Version ?? -1 });
            await tx.AuditAsync("room.update", "room", id, before, req);
            tx.Publish("rooms");
            return new { id };
        }, requireKey: false)).RequirePermission("room.manage");

        rooms.MapGet("/status", async (Db db, RequestContext ctx) =>
        {
            var bd = await db.ScalarAsync<DateOnly>("SELECT business_date FROM pms.property LIMIT 1");
            var list = await db.QueryAsync<RoomStatusDto>(StatusSql, new { bd });
            // Folyo bakiyesi yalnız folyo görme yetkisi olanlara (ör. kat hizmetleri görmez).
            return ctx.RequireUser().Has("folio.view") ? list : list.Select(x => x with { InHouseBalance = null }).ToList();
        });

        rooms.MapPost("/{id:guid}/housekeeping", (Guid id, HousekeepingUpdateRequest req, CommandRunner cmd, RequestContext ctx) =>
        {
            if (req.HkStatus == "inspected") ctx.Require("housekeeping.inspect");
            return cmd.RunAsync("room.housekeeping", new { id, req }, async tx =>
            {
                if (req.HkStatus is not ("clean" or "dirty" or "inspected" or "cleaning")) throw PmsException.Validation("Geçersiz temizlik durumu.");
                var before = await tx.OneOrNullAsync<RoomDto>(RoomSelect + " WHERE r.id = @id", new { id }) ?? throw PmsException.NotFound("Oda");
                await tx.ExecVersionedAsync("""
                    UPDATE pms.rooms SET hk_status = @hk, is_dnd = @dnd, hk_note = @note, hk_updated_at = now(), hk_updated_by = @uid, version = version + 1
                    WHERE id = @id AND version = @version
                    """, new { id, hk = req.HkStatus, dnd = req.IsDnd, note = Validate.Optional(req.HkNote, 300), uid = tx.User.Id, version = req.Version });
                if (req.HkStatus is "clean" or "inspected")
                    await tx.ExecAsync("""
                        UPDATE pms.hk_tasks SET status = 'done', completed_at = now(), completed_by = @uid, version = version + 1
                        WHERE room_id = @id AND status IN ('open','in_progress') AND task_type IN ('departure_clean','stayover_clean','deep_clean')
                        """, new { id, uid = tx.User.Id });
                await tx.AuditAsync("room.housekeeping", "room", id, new { before.HkStatus, before.IsDnd, before.HkNote }, req);
                tx.Publish("rooms", id);
                return new { id };
            }, requireKey: false);
        }).RequirePermission("housekeeping.update");

        var blocks = app.MapGroup("/api/v1/room-blocks").WithTags("Rooms");
        blocks.MapGet("/", (Db db, DateOnly? from, DateOnly? to) => db.QueryAsync<RoomBlockDto>("""
            SELECT b.id, b.room_id, r.number AS room_number, b.kind, b.date_from, b.date_to, b.reason, b.ticket_id, b.is_active, b.created_at, u.username AS created_by
            FROM pms.room_blocks b JOIN pms.rooms r ON r.id = b.room_id LEFT JOIN pms.users u ON u.id = b.created_by
            WHERE b.is_active AND (@from::date IS NULL OR b.date_to > @from) AND (@to::date IS NULL OR b.date_from < @to)
            ORDER BY b.date_from, r.number
            """, new { from, to })).RequirePermission("maintenance.view");
        blocks.MapPost("/", (CreateRoomBlockRequest req, CommandRunner cmd) => cmd.RunAsync("room_block.create", req, async tx =>
            new { id = await CreateBlockAsync(tx, req) }, requireKey: false)).RequirePermission("maintenance.manage");
        blocks.MapPost("/{id:guid}/release", (Guid id, CommandRunner cmd) => cmd.RunAsync("room_block.release", new { id }, async tx =>
        {
            var roomId = await tx.ScalarAsync<Guid?>("""
                UPDATE pms.room_blocks SET is_active = false, released_at = now(), released_by = @uid WHERE id = @id AND is_active RETURNING room_id
                """, new { id, uid = tx.User.Id }) ?? throw PmsException.NotFound("Aktif blokaj");
            await tx.AuditAsync("room_block.release", "room_block", id);
            tx.Publish("rooms", roomId);
            tx.Publish("availability");
            return new { id };
        }, requireKey: false)).RequirePermission("maintenance.manage");
    }

    public static async Task<Guid> CreateBlockAsync(Tx tx, CreateRoomBlockRequest req)
    {
        if (req.Kind is not ("out_of_order" or "out_of_service" or "blocked")) throw PmsException.Validation("Geçersiz blokaj türü.");
        Validate.DateRange(req.DateFrom, req.DateTo);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (req.DateTo <= bd) throw PmsException.Validation("Geçmiş tarihler için blokaj oluşturulamaz.");
        await tx.LockAsync("room", req.RoomId);
        // Satılmış geceler veya konaklayan misafir blokajla yerinden edilemez.
        var clash = await tx.ScalarAsync<string?>("""
            SELECT reservation_number FROM pms.reservations
            WHERE room_id = @room AND status IN ('tentative','confirmed','checked_in') AND daterange(arrival, departure) && daterange(@from, @to)
            LIMIT 1
            """, new { room = req.RoomId, from = req.DateFrom, to = req.DateTo });
        if (clash is not null) throw PmsException.Conflict($"Oda bu tarihlerde {clash} numaralı rezervasyona atanmış. Önce rezervasyonu başka odaya taşıyın.");
        var id = await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.room_blocks (room_id, kind, date_from, date_to, reason, ticket_id, created_by)
            VALUES (@RoomId, @Kind, @DateFrom, @DateTo, @reason, @TicketId, @uid) RETURNING id
            """, new { req.RoomId, req.Kind, req.DateFrom, req.DateTo, reason = Validate.Required(req.Reason, "Gerekçe", 300), req.TicketId, uid = tx.User.Id });
        await tx.AuditAsync("room_block.create", "room_block", id, null, req);
        tx.Publish("rooms", req.RoomId);
        tx.Publish("availability");
        return id;
    }

    static RtP RoomTypeParams(SaveRoomTypeRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 12).ToUpperInvariant();
        if (!global::System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,12}$")) throw PmsException.Validation("Kod yalnız harf, rakam, - ve _ içerebilir.");
        if (r.MaxAdults is < 1 or > 30) throw PmsException.Validation("Yetişkin kapasitesi 1-30 arasında olmalıdır.");
        if (r.MaxChildren is < 0 or > 30) throw PmsException.Validation("Çocuk kapasitesi 0-30 arasında olmalıdır.");
        return new RtP(code, Validate.Required(r.Name, "Ad", 100), Validate.Optional(r.Description), r.MaxAdults,
            r.MaxChildren, Validate.Money(r.DefaultRate, "Varsayılan fiyat", allowZero: true), r.SortOrder, r.IsActive);
    }

    static RmP RoomParams(SaveRoomRequest r)
    {
        var number = Validate.Required(r.Number, "Oda numarası", 10);
        if (!global::System.Text.RegularExpressions.Regex.IsMatch(number, "^[A-Za-z0-9_-]{1,10}$")) throw PmsException.Validation("Oda numarası yalnız harf, rakam, - ve _ içerebilir.");
        return new RmP(r.RoomTypeId, number, Validate.Optional(r.Floor, 20), Validate.Optional(r.Description),
            Validate.Optional(r.Features), r.SortOrder, r.IsActive);
    }

    sealed record RtP(string code, string name, string? description, int maxAdults, int maxChildren, decimal defaultRate, int sortOrder, bool isActive);
    sealed record RmP(Guid roomTypeId, string number, string? floor, string? description, string? features, int sortOrder, bool isActive);

    public const string StatusSql = """
        SELECT r.id, r.number, r.floor, r.room_type_id, t.code AS room_type_code, r.hk_status, r.is_dnd, r.hk_note, r.hk_updated_at,
               CASE WHEN ih.id IS NOT NULL THEN 'occupied' ELSE 'vacant' END AS fo_status,
               b.kind AS block_kind, b.reason AS block_reason,
               ih.id AS in_house_reservation_id, ihg.first_name || ' ' || ihg.last_name AS in_house_guest, ih.departure AS in_house_departure,
               COALESCE(ihg.is_vip, arg.is_vip, false) AS is_vip,
               ar.id AS arrival_reservation_id, arg.first_name || ' ' || arg.last_name AS arrival_guest,
               (ih.departure IS NOT NULL AND ih.departure <= @bd) AS departure_today,
               (SELECT count(*)::int FROM pms.hk_tasks k WHERE k.room_id = r.id AND k.status IN ('open','in_progress')) AS open_tasks,
               (SELECT count(*)::int FROM pms.maintenance_tickets m WHERE m.room_id = r.id AND m.status IN ('open','in_progress')) AS open_tickets,
               ih.checked_in_at AS in_house_checked_in_at, COALESCE(ihc.name, iha.name) AS in_house_account,
               NULLIF(btrim(concat_ws(' · ', ih.notes, ih.special_requests)), '') AS in_house_note,
               ih.adults + ih.children AS in_house_pax,
               CASE WHEN ih.id IS NOT NULL THEN COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.reservation_id = ih.id), 0) END AS in_house_balance,
               ih.currency::text AS in_house_currency,
               ar.eta AS arrival_eta, COALESCE(arc.name, ara.name) AS arrival_account,
               NULLIF(btrim(concat_ws(' · ', ar.notes, ar.special_requests)), '') AS arrival_note, ar.departure AS arrival_departure
        FROM pms.rooms r
        JOIN pms.room_types t ON t.id = r.room_type_id
        LEFT JOIN pms.reservations ih ON ih.room_id = r.id AND ih.status = 'checked_in'
        LEFT JOIN pms.guests ihg ON ihg.id = ih.guest_id
        LEFT JOIN pms.companies ihc ON ihc.id = ih.company_id
        LEFT JOIN pms.agencies iha ON iha.id = ih.agency_id
        LEFT JOIN LATERAL (SELECT x.id, x.guest_id, x.eta, x.notes, x.special_requests, x.company_id, x.agency_id, x.departure FROM pms.reservations x WHERE x.room_id = r.id AND x.status IN ('confirmed','tentative')
                            AND x.arrival = @bd ORDER BY x.created_at LIMIT 1) ar ON true
        LEFT JOIN pms.guests arg ON arg.id = ar.guest_id
        LEFT JOIN pms.companies arc ON arc.id = ar.company_id
        LEFT JOIN pms.agencies ara ON ara.id = ar.agency_id
        LEFT JOIN LATERAL (SELECT kind, reason FROM pms.room_blocks bb WHERE bb.room_id = r.id AND bb.is_active
                            AND bb.date_from <= @bd AND bb.date_to > @bd LIMIT 1) b ON true
        WHERE r.is_active
        ORDER BY r.sort_order, r.number
        """;
}
