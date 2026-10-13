using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Reservations;

public sealed record AllotmentDto(Guid Id, Guid AgencyId, string AgencyName, Guid RoomTypeId, string RoomTypeCode, DateOnly DateFrom, DateOnly DateTo,
    int Rooms, int ReleaseDays, string? Notes, bool IsActive, int UsedRoomNights, int TotalRoomNights, string? CreatedBy, DateTime CreatedAt, int Version);
public sealed record SaveAllotmentRequest(Guid AgencyId, Guid RoomTypeId, DateOnly DateFrom, DateOnly DateTo, int Rooms, int ReleaseDays, string? Notes,
    bool IsActive, int? Version);
public sealed record AllotmentDayDto(DateOnly Date, int Rooms, int Used, int Remaining, DateOnly ReleaseDate, bool Released);

/// <summary>
/// Acente kontenjanı. Kontenjan günlük oda sayısıdır; acentenin o oda tipindeki rezervasyonları kontenjandan düşer.
/// Kullanılmayan kısım, gecenin "release" tarihine kadar (gece − release günü) diğer satışlara kapalıdır.
/// </summary>
public static class AllotmentEndpoints
{
    const string Select = """
        SELECT a.id, a.agency_id, ag.name AS agency_name, a.room_type_id, t.code AS room_type_code, a.date_from, a.date_to, a.rooms, a.release_days, a.notes,
               a.is_active,
               (SELECT COALESCE(sum(LEAST(a.rooms, u.cnt)), 0)::int FROM (
                    SELECT d::date AS d, (SELECT count(*) FROM pms.reservations x WHERE x.agency_id = a.agency_id AND x.room_type_id = a.room_type_id
                        AND x.status IN ('tentative','confirmed','checked_in','checked_out') AND x.arrival <= d::date AND x.departure > d::date) AS cnt
                    FROM generate_series(a.date_from, a.date_to - 1, interval '1 day') d) u) AS used_room_nights,
               (a.rooms * (a.date_to - a.date_from))::int AS total_room_nights,
               u.username AS created_by, a.created_at, a.version
        FROM pms.allotments a JOIN pms.agencies ag ON ag.id = a.agency_id JOIN pms.room_types t ON t.id = a.room_type_id
        LEFT JOIN pms.users u ON u.id = a.created_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/allotments").WithTags("Allotments");

        g.MapGet("/", (Db db, Guid? agencyId, Guid? roomTypeId, bool? activeOnly) => db.QueryAsync<AllotmentDto>(Select + """
             WHERE (@agencyId::uuid IS NULL OR a.agency_id = @agencyId) AND (@roomTypeId::uuid IS NULL OR a.room_type_id = @roomTypeId)
               AND (NOT @activeOnly OR a.is_active)
            ORDER BY a.is_active DESC, a.date_from DESC, ag.name LIMIT 1000
            """, new { agencyId, roomTypeId, activeOnly = activeOnly ?? false })).RequirePermission("reservation.view");

        g.MapGet("/{id:guid}/usage", (Guid id, CommandRunner cmd) => cmd.ReadAsync(async tx =>
        {
            var a = await tx.OneOrNullAsync<AllotmentDto>(Select + " WHERE a.id = @id", new { id }) ?? throw PmsException.NotFound("Kontenjan");
            return await UsageAsync(tx, a.AgencyId, a.RoomTypeId, a.DateFrom, a.DateTo, a.Rooms, a.ReleaseDays);
        })).RequirePermission("reservation.view");

        g.MapPost("/", (SaveAllotmentRequest req, CommandRunner cmd) => cmd.RunAsync("allotment.create", req, async tx =>
        {
            var notes = await ValidateAsync(tx, req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.allotments (agency_id, room_type_id, date_from, date_to, rooms, release_days, notes, is_active, created_by)
                VALUES (@AgencyId, @RoomTypeId, @DateFrom, @DateTo, @Rooms, @ReleaseDays, @notes, @IsActive, @uid) RETURNING id
                """, new { req.AgencyId, req.RoomTypeId, req.DateFrom, req.DateTo, req.Rooms, req.ReleaseDays, notes, req.IsActive, uid = tx.User.Id });
            await tx.AuditAsync("allotment.create", "allotment", id, null, req);
            tx.Publish("availability");
            tx.Publish("allotments");
            return new { id };
        })).RequirePermission("allotment.manage");

        g.MapPut("/{id:guid}", (Guid id, SaveAllotmentRequest req, CommandRunner cmd) => cmd.RunAsync("allotment.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<AllotmentDto>(Select + " WHERE a.id = @id", new { id }) ?? throw PmsException.NotFound("Kontenjan");
            if (before.AgencyId != req.AgencyId) throw PmsException.Validation("Kontenjanın acentesi değiştirilemez; yeni kontenjan tanımlayın.");
            var notes = await ValidateAsync(tx, req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.allotments SET room_type_id = @RoomTypeId, date_from = @DateFrom, date_to = @DateTo, rooms = @Rooms, release_days = @ReleaseDays,
                    notes = @notes, is_active = @IsActive, updated_at = now(), version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, req.RoomTypeId, req.DateFrom, req.DateTo, req.Rooms, req.ReleaseDays, notes, req.IsActive, version = req.Version ?? -1 });
            await tx.AuditAsync("allotment.update", "allotment", id, before, req);
            tx.Publish("availability");
            tx.Publish("allotments");
            return new { id };
        })).RequirePermission("allotment.manage");
    }

    /// <summary>Kontenjanın her gecesi için ayrılan, kullanılan, kalan oda ve release tarihi.</summary>
    static async Task<List<AllotmentDayDto>> UsageAsync(Tx tx, Guid agencyId, Guid roomTypeId, DateOnly from, DateOnly to, int rooms, int releaseDays)
    {
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var used = await tx.ListAsync<(DateOnly D, int Cnt)>("""
            SELECT d::date, (SELECT count(*)::int FROM pms.reservations x WHERE x.agency_id = @agencyId AND x.room_type_id = @roomTypeId
                AND x.status IN ('tentative','confirmed','checked_in','checked_out') AND x.arrival <= d::date AND x.departure > d::date)
            FROM generate_series(@from::date, @to::date - 1, interval '1 day') d ORDER BY 1
            """, new { agencyId, roomTypeId, from, to });
        return used.Select(u =>
        {
            var release = u.D.AddDays(-releaseDays);
            return new AllotmentDayDto(u.D, rooms, u.Cnt, Math.Max(rooms - u.Cnt, 0), release, bd >= release);
        }).ToList();
    }

    static async Task<string?> ValidateAsync(Tx tx, SaveAllotmentRequest req)
    {
        Validate.DateRange(req.DateFrom, req.DateTo);
        if (req.DateTo.DayNumber - req.DateFrom.DayNumber > 400) throw PmsException.Validation("Kontenjan dönemi en fazla 400 gece olabilir.");
        if (req.Rooms is < 1 or > 999) throw PmsException.Validation("Günlük oda sayısı 1-999 arasında olmalıdır.");
        if (req.ReleaseDays is < 0 or > 365) throw PmsException.Validation("Release süresi 0-365 gün olmalıdır.");
        if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.agencies WHERE id = @AgencyId AND is_active)", req))
            throw PmsException.Validation("Acente bulunamadı veya pasif.");
        if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.room_types WHERE id = @RoomTypeId AND is_active)", req))
            throw PmsException.Validation("Oda tipi bulunamadı veya pasif.");
        if (!req.IsActive) return Validate.Optional(req.Notes, 1000);

        // Kontenjan, release süresi dolmamış her gece için boş envanter kadar olabilir (diğer satışlar ve başka acentelerin kontenjanı düşülür).
        await tx.LockAsync("inventory", req.RoomTypeId);
        var days = await ReservationService.AvailabilityAsync(tx, req.DateFrom, req.DateTo, req.RoomTypeId, null, req.AgencyId);
        var usage = await UsageAsync(tx, req.AgencyId, req.RoomTypeId, req.DateFrom, req.DateTo, req.Rooms, req.ReleaseDays);
        var shortDays = days.Join(usage, d => d.Date, u => u.Date, (d, u) => (d, u))
            .Where(x => !x.u.Released && x.d.Total - x.d.Blocked - x.d.Sold - x.d.Held < x.u.Remaining)
            .Select(x => $"{x.d.Date:dd.MM.yyyy} (boş {Math.Max(x.d.Total - x.d.Blocked - x.d.Sold - x.d.Held, 0)})").ToList();
        if (shortDays.Count > 0)
            throw PmsException.Conflict("Kontenjan boş oda sayısını aşıyor: " + string.Join(", ", shortDays.Take(5)) + (shortDays.Count > 5 ? " ..." : ""),
                "allotment_exceeds_inventory");
        return Validate.Optional(req.Notes, 1000);
    }
}
