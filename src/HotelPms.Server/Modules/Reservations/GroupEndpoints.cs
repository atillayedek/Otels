using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Reservations;

public sealed record GroupListItem(Guid Id, string GroupNumber, string Name, string? CompanyName, string? AgencyName, string? ContactName,
    DateOnly? Arrival, DateOnly? Departure, int Rooms, int InHouse, int Cancelled, decimal Balance, DateTime CreatedAt);
public sealed record GroupDto(Guid Id, string GroupNumber, string Name, Guid? CompanyId, string? CompanyName, Guid? AgencyId, string? AgencyName,
    string? ContactName, string? Notes, DateTime CreatedAt, int Version);
public sealed record SaveGroupRequest(string Name, Guid? CompanyId, Guid? AgencyId, string? ContactName, string? Notes, int? Version);
/// <summary>
/// Gruba oda ekleme: aynı tarih ve oda tipinde <see cref="Count"/> rezervasyon tek işlemde oluşturulur. Her oda başlangıçta
/// grubun sorumlu misafirine (GuestId) yazılır; oda listesi geldikçe rezervasyonun misafiri gerçek kişiyle değiştirilir.
/// </summary>
public sealed record RoomingLine(string FirstName, string LastName, string? Nationality);
public sealed record RoomingListRequest(List<RoomingLine> Lines);
public sealed record AddGroupRoomsRequest(Guid GuestId, Guid RoomTypeId, int Count, DateOnly Arrival, DateOnly Departure, int Adults, int Children,
    Guid? RatePlanId, decimal? NightlyRate, string? MealPlan, string Status, decimal DepositRequired, DateOnly? OptionUntil);

public static class GroupEndpoints
{
    const string ListSelect = """
        SELECT gr.id, gr.group_number, gr.name, c.name AS company_name, a.name AS agency_name, gr.contact_name,
               min(r.arrival) FILTER (WHERE r.status NOT IN ('cancelled','no_show')) AS arrival,
               max(r.departure) FILTER (WHERE r.status NOT IN ('cancelled','no_show')) AS departure,
               count(r.id) FILTER (WHERE r.status NOT IN ('cancelled','no_show'))::int AS rooms,
               count(r.id) FILTER (WHERE r.status = 'checked_in')::int AS in_house,
               count(r.id) FILTER (WHERE r.status IN ('cancelled','no_show'))::int AS cancelled,
               COALESCE((SELECT sum(l.amount) FROM pms.reservations rr JOIN pms.folios f ON f.reservation_id = rr.id JOIN pms.folio_lines l ON l.folio_id = f.id
                         WHERE rr.group_id = gr.id), 0) AS balance,
               gr.created_at
        FROM pms.reservation_groups gr
        LEFT JOIN pms.companies c ON c.id = gr.company_id LEFT JOIN pms.agencies a ON a.id = gr.agency_id
        LEFT JOIN pms.reservations r ON r.group_id = gr.id
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/groups").WithTags("Reservations");

        g.MapGet("/", (Db db, string? q) => db.QueryAsync<GroupListItem>(ListSelect + """
             WHERE (@q::text IS NULL OR gr.name ILIKE '%' || @q || '%' OR gr.group_number ILIKE @q || '%' OR c.name ILIKE '%' || @q || '%' OR a.name ILIKE '%' || @q || '%')
             GROUP BY gr.id, c.name, a.name ORDER BY gr.created_at DESC LIMIT 500
            """, new { q = string.IsNullOrWhiteSpace(q) ? null : q.Trim() })).RequirePermission("reservation.view");

        g.MapGet("/{id:guid}", async (Guid id, Db db) => await db.QuerySingleOrDefaultAsync<GroupDto>("""
            SELECT gr.id, gr.group_number, gr.name, gr.company_id, c.name AS company_name, gr.agency_id, a.name AS agency_name, gr.contact_name, gr.notes, gr.created_at, gr.version
            FROM pms.reservation_groups gr LEFT JOIN pms.companies c ON c.id = gr.company_id LEFT JOIN pms.agencies a ON a.id = gr.agency_id WHERE gr.id = @id
            """, new { id }) ?? throw PmsException.NotFound("Grup")).RequirePermission("reservation.view");

        g.MapPost("/", (SaveGroupRequest req, CommandRunner cmd) => cmd.RunAsync("group.create", req, async tx =>
        {
            var number = "G" + await tx.ScalarAsync<long>("SELECT nextval('pms.group_number_seq')");
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.reservation_groups (group_number, name, company_id, agency_id, contact_name, notes, created_by)
                VALUES (@number, @name, @CompanyId, @AgencyId, @contact, @notes, @uid) RETURNING id
                """, new
            {
                number, name = Validate.Required(req.Name, "Grup adı", 150), req.CompanyId, req.AgencyId,
                contact = Validate.Optional(req.ContactName, 150), notes = Validate.Optional(req.Notes, 4000), uid = tx.User.Id,
            });
            await tx.AuditAsync("group.create", "reservation_group", id, null, new { number, req.Name });
            tx.Publish("reservations");
            return new { id };
        })).RequirePermission("reservation.create");

        g.MapPut("/{id:guid}", (Guid id, SaveGroupRequest req, CommandRunner cmd) => cmd.RunAsync("group.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<GroupDto>("SELECT id, group_number, name, company_id, NULL AS company_name, agency_id, NULL AS agency_name, contact_name, notes, created_at, version FROM pms.reservation_groups WHERE id = @id", new { id })
                ?? throw PmsException.NotFound("Grup");
            await tx.ExecVersionedAsync("""
                UPDATE pms.reservation_groups SET name = @name, company_id = @CompanyId, agency_id = @AgencyId, contact_name = @contact, notes = @notes, version = version + 1
                WHERE id = @id AND version = @version
                """, new
            {
                id, version = req.Version ?? -1, name = Validate.Required(req.Name, "Grup adı", 150), req.CompanyId, req.AgencyId,
                contact = Validate.Optional(req.ContactName, 150), notes = Validate.Optional(req.Notes, 4000),
            });
            await tx.AuditAsync("group.update", "reservation_group", id, before, req);
            tx.Publish("reservations");
            return new { id };
        }, requireKey: false)).RequirePermission("reservation.edit");

        // Oda ekleme: müsaitlik her oda için ayrı denetlenir; biri bile sığmazsa hiçbiri oluşturulmaz.
        g.MapPost("/{id:guid}/rooms", (Guid id, AddGroupRoomsRequest req, CommandRunner cmd) => cmd.RunAsync("group.add_rooms", new { id, req }, async tx =>
        {
            var grp = await tx.OneOrNullAsync<GroupDto>("SELECT id, group_number, name, company_id, NULL AS company_name, agency_id, NULL AS agency_name, contact_name, notes, created_at, version FROM pms.reservation_groups WHERE id = @id", new { id })
                ?? throw PmsException.NotFound("Grup");
            if (req.Count is < 1 or > 200) throw PmsException.Validation("Oda sayısı 1 ile 200 arasında olmalıdır.");
            var ids = new List<Guid>();
            for (var i = 0; i < req.Count; i++)
            {
                ids.Add(await ReservationService.CreateAsync(tx, new SaveReservationRequest(
                    req.GuestId, null, grp.CompanyId, grp.AgencyId, id, req.RoomTypeId, null, req.Arrival, req.Departure, req.Adults, req.Children,
                    req.RatePlanId, req.NightlyRate, req.MealPlan, req.Status, grp.AgencyId is not null ? "agency" : grp.CompanyId is not null ? "company" : "direct",
                    null, null, null, null, $"Grup: {grp.Name}", null, req.DepositRequired, req.OptionUntil, null)));
            }
            await tx.AuditAsync("group.add_rooms", "reservation_group", id, null, new { req.Count, req.RoomTypeId, req.Arrival, req.Departure });
            return new { ids };
        })).RequirePermission("reservation.create");

        // Oda listesi (rooming list): grup odalarına sırayla gerçek misafir adları yazılır. Yalnız girişi yapılmamış odalar,
        // oda numarası ve rezervasyon sırasına göre doldurulur; her satır yeni misafir kartı açar, eski ana misafir odadan çıkar.
        g.MapPost("/{id:guid}/rooming-list", (Guid id, RoomingListRequest req, CommandRunner cmd) => cmd.RunAsync("group.rooming_list", new { id, req }, async tx =>
        {
            _ = await tx.OneOrNullAsync<Guid?>("SELECT id FROM pms.reservation_groups WHERE id = @id FOR UPDATE", new { id }) ?? throw PmsException.NotFound("Grup");
            var lines = (req.Lines ?? []).Where(l => !string.IsNullOrWhiteSpace(l.FirstName) || !string.IsNullOrWhiteSpace(l.LastName)).ToList();
            if (lines.Count == 0) throw PmsException.Validation("Oda listesinde en az bir misafir adı olmalıdır.");
            var targets = (await tx.ListAsync<(Guid Id, Guid GuestId)>("""
                SELECT r.id, r.guest_id FROM pms.reservations r LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                WHERE r.group_id = @id AND r.status IN ('tentative','confirmed')
                ORDER BY rm.sort_order NULLS LAST, rm.number NULLS LAST, r.reservation_number FOR UPDATE OF r
                """, new { id })).ToList();
            if (lines.Count > targets.Count)
                throw PmsException.Validation($"Listede {lines.Count} misafir var, grupta girişi yapılmamış {targets.Count} oda var. Önce grup odası ekleyin.");
            for (var i = 0; i < lines.Count; i++)
            {
                var l = lines[i];
                var first = Validate.Required(l.FirstName, $"{i + 1}. satır ad", 100);
                var last = Validate.Required(l.LastName, $"{i + 1}. satır soyad", 100);
                var nat = string.IsNullOrWhiteSpace(l.Nationality) ? null : l.Nationality.Trim().ToUpperInvariant();
                if (nat is not null && nat.Length != 2) throw PmsException.Validation($"{i + 1}. satır: uyruk iki harfli ülke kodu olmalıdır (TR, DE…).");
                var guestId = await tx.ScalarAsync<Guid>(
                    "INSERT INTO pms.guests (first_name, last_name, nationality, created_by) VALUES (@first, @last, @nat, @uid) RETURNING id",
                    new { first, last, nat, uid = tx.User.Id });
                await tx.AuditAsync("guest.create", "guest", guestId, null, new { first, last, nat, source = "rooming_list" });
                var (resId, oldGuest) = targets[i];
                await tx.ExecAsync("UPDATE pms.reservations SET guest_id = @guestId, version = version + 1, updated_at = now() WHERE id = @resId", new { guestId, resId });
                await tx.ExecAsync("DELETE FROM pms.reservation_guests WHERE reservation_id = @resId AND guest_id = @oldGuest", new { resId, oldGuest });
                await tx.ExecAsync("""
                    INSERT INTO pms.reservation_guests (reservation_id, guest_id, is_primary) VALUES (@resId, @guestId, true)
                    ON CONFLICT (reservation_id, guest_id) DO UPDATE SET is_primary = true
                    """, new { resId, guestId });
                await tx.AuditAsync("reservation.update", "reservation", resId, new { guestId = oldGuest }, new { guestId, source = "rooming_list" });
                tx.Publish("reservations", resId);
            }
            await tx.AuditAsync("group.rooming_list", "reservation_group", id, null, new { count = lines.Count });
            return new { applied = lines.Count, remaining = targets.Count - lines.Count };
        })).RequirePermission("reservation.create");
    }
}
