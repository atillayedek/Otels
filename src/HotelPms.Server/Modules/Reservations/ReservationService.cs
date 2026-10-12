using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Folios;
using HotelPms.Server.Modules.Guests;
using HotelPms.Server.Modules.Integrations;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Reservations;

/// <summary>
/// Rezervasyon ve konaklama iş kuralları. Tüm metotlar çağıranın transaction'ı içinde çalışır.
/// Gece mantığı [arrival, departure): çıkış günü gece tüketmez.
/// </summary>
public static class ReservationService
{
    public const string ActiveStatuses = "('tentative','confirmed','checked_in')";

    public const string ReservationSelect = """
        SELECT r.id, r.reservation_number, r.status, r.guest_id, g.first_name || ' ' || g.last_name AS guest_name, g.is_vip AS guest_is_vip,
               g.is_blacklisted AS guest_is_blacklisted, r.company_id, c.name AS company_name, r.agency_id, a.name AS agency_name,
               r.group_id, gr.name AS group_name, r.room_type_id, t.code AS room_type_code, r.room_id, rm.number AS room_number,
               r.arrival, r.departure, (r.departure - r.arrival)::int AS nights, r.adults, r.children, r.rate_plan_id, rp.code AS rate_plan_code,
               r.nightly_rate, COALESCE((SELECT sum(rate) FROM pms.reservation_rates x WHERE x.reservation_id = r.id), r.nightly_rate * (r.departure - r.arrival)) AS total_rate,
               r.currency::text AS currency, r.meal_plan, r.source, r.market, r.segment, r.is_walk_in, r.eta, r.etd, r.room_charge_window, r.notes,
               r.special_requests, r.deposit_required, r.option_until, r.checked_in_at, r.checked_out_at, r.cancelled_at, r.cancel_reason,
               r.created_at, cu.username AS created_by,
               COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.reservation_id = r.id), 0) AS balance,
               r.version
        FROM pms.reservations r
        JOIN pms.guests g ON g.id = r.guest_id
        JOIN pms.room_types t ON t.id = r.room_type_id
        LEFT JOIN pms.rooms rm ON rm.id = r.room_id
        LEFT JOIN pms.companies c ON c.id = r.company_id
        LEFT JOIN pms.agencies a ON a.id = r.agency_id
        LEFT JOIN pms.reservation_groups gr ON gr.id = r.group_id
        LEFT JOIN pms.rate_plans rp ON rp.id = r.rate_plan_id
        LEFT JOIN pms.users cu ON cu.id = r.created_by
        """;

    public static Task<ReservationDto?> GetAsync(Tx tx, Guid id) =>
        tx.OneOrNullAsync<ReservationDto>(ReservationSelect + " WHERE r.id = @id", new { id });

    public static async Task<ReservationDto> GetForUpdateAsync(Tx tx, Guid id)
    {
        await tx.ExecAsync("SELECT 1 FROM pms.reservations WHERE id = @id FOR UPDATE", new { id });
        return await GetAsync(tx, id) ?? throw PmsException.NotFound("Rezervasyon");
    }

    static void CheckVersion(ReservationDto r, int version)
    {
        if (r.Version != version) throw PmsException.Concurrency();
    }

    // ------------------------------------------------------------------ Fiyat
    public static async Task<RatePreview> ComputeRatesAsync(Tx tx, Guid roomTypeId, Guid? ratePlanId, DateOnly arrival, DateOnly departure)
    {
        var defaultRate = await tx.ScalarAsync<decimal?>("SELECT default_rate FROM pms.room_types WHERE id = @roomTypeId AND is_active", new { roomTypeId })
            ?? throw PmsException.Validation("Oda tipi bulunamadı veya pasif.");
        var nights = new List<NightRate>();
        var source = "room_type_default";
        if (ratePlanId is { } rp)
        {
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.rate_plans WHERE id = @rp AND is_active)", new { rp }))
                throw PmsException.Validation("Fiyat planı bulunamadı veya pasif.");
            var prices = await tx.ListAsync<(DateOnly From, DateOnly To, decimal Price, int? MinStay)>("""
                SELECT date_from, date_to, price, min_stay FROM pms.rate_plan_prices
                WHERE rate_plan_id = @rp AND room_type_id = @roomTypeId AND date_from < @departure AND date_to > @arrival
                """, new { rp, roomTypeId, arrival, departure });
            var stayLen = departure.DayNumber - arrival.DayNumber;
            for (var d = arrival; d < departure; d = d.AddDays(1))
            {
                var p = prices.FirstOrDefault(x => x.From <= d && x.To > d);
                if (p.MinStay is { } ms && stayLen < ms)
                    throw PmsException.Validation($"Seçilen fiyat planı {d:dd.MM.yyyy} için en az {ms} gece konaklama gerektiriyor.");
                nights.Add(new NightRate(d, p == default ? defaultRate : p.Price));
            }
            source = prices.Count > 0 ? "rate_plan" : "room_type_default";
        }
        else
        {
            for (var d = arrival; d < departure; d = d.AddDays(1)) nights.Add(new NightRate(d, defaultRate));
        }
        var total = nights.Sum(n => n.Rate);
        return new RatePreview(nights, total, nights.Count == 0 ? 0 : decimal.Round(total / nights.Count, 2), source);
    }

    static async Task WriteRatesAsync(Tx tx, Guid reservationId, IEnumerable<NightRate> nights)
    {
        await tx.ExecAsync("DELETE FROM pms.reservation_rates WHERE reservation_id = @reservationId", new { reservationId });
        foreach (var n in nights)
            await tx.ExecAsync("INSERT INTO pms.reservation_rates (reservation_id, stay_date, rate) VALUES (@reservationId, @Date, @Rate)",
                new { reservationId, n.Date, n.Rate });
    }

    // ------------------------------------------------------------------ Müsaitlik
    public static Task<List<AvailabilityDay>> AvailabilityAsync(Tx tx, DateOnly from, DateOnly to, Guid? roomTypeId, Guid? excludeReservation = null) =>
        tx.ListAsync<AvailabilityDay>(AvailabilitySql, new { from, to, roomTypeId, exclude = excludeReservation });

    public const string AvailabilitySql = """
        WITH days AS (SELECT d::date AS d FROM generate_series(@from::date, @to::date - 1, interval '1 day') d),
             types AS (SELECT id, code, sort_order FROM pms.room_types WHERE is_active AND (@roomTypeId::uuid IS NULL OR id = @roomTypeId))
        SELECT days.d AS date, t.id AS room_type_id, t.code AS room_type_code,
               (SELECT count(*)::int FROM pms.rooms r WHERE r.room_type_id = t.id AND r.is_active) AS total,
               (SELECT count(*)::int FROM pms.room_blocks b JOIN pms.rooms r ON r.id = b.room_id
                 WHERE r.room_type_id = t.id AND r.is_active AND b.is_active AND b.date_from <= days.d AND b.date_to > days.d) AS blocked,
               (SELECT count(*)::int FROM pms.reservations x WHERE x.room_type_id = t.id AND x.status IN ('tentative','confirmed','checked_in')
                 AND x.arrival <= days.d AND x.departure > days.d AND (@exclude::uuid IS NULL OR x.id <> @exclude)) AS sold,
               0 AS available
        FROM types t CROSS JOIN days
        ORDER BY t.sort_order, t.code, days.d
        """;

    /// <summary>Oda tipi envanterini kilitler ve her gece için müsaitlik olduğunu doğrular (son oda yarışında tek kazanan).</summary>
    static async Task EnsureAvailabilityAsync(Tx tx, Guid roomTypeId, DateOnly arrival, DateOnly departure, Guid? exclude)
    {
        await tx.LockAsync("inventory", roomTypeId);
        var days = await AvailabilityAsync(tx, arrival, departure, roomTypeId, exclude);
        var full = days.Where(d => d.Total - d.Blocked - d.Sold <= 0).Select(d => d.Date).ToList();
        if (full.Count == 0) return;
        if (tx.User.Has("reservation.overbook")) return;
        throw PmsException.Conflict($"Seçilen oda tipinde müsaitlik yok: {string.Join(", ", full.Take(5).Select(d => d.ToString("dd.MM.yyyy")))}{(full.Count > 5 ? " ..." : "")}",
            "no_availability");
    }

    static async Task EnsureRoomUsableAsync(Tx tx, Guid roomId, Guid roomTypeId, DateOnly arrival, DateOnly departure, Guid? exclude, bool allowOtherType)
    {
        var room = await tx.OneOrNullAsync<(Guid RoomTypeId, bool IsActive, string Number)>(
            "SELECT room_type_id, is_active, number FROM pms.rooms WHERE id = @roomId", new { roomId }) ;
        if (room == default) throw PmsException.NotFound("Oda");
        if (!room.IsActive) throw PmsException.Validation($"Oda {room.Number} pasif durumda.");
        if (room.RoomTypeId != roomTypeId && !allowOtherType)
            throw PmsException.Validation($"Oda {room.Number} rezervasyonun oda tipiyle uyuşmuyor.");
        await tx.LockAsync("room", roomId);
        var block = await tx.ScalarAsync<string?>("""
            SELECT reason FROM pms.room_blocks WHERE room_id = @roomId AND is_active AND daterange(date_from, date_to) && daterange(@arrival, @departure) LIMIT 1
            """, new { roomId, arrival, departure });
        if (block is not null) throw PmsException.Conflict($"Oda {room.Number} bu tarihlerde bloke: {block}", "room_blocked");
        var clash = await tx.ScalarAsync<string?>("""
            SELECT reservation_number FROM pms.reservations
            WHERE room_id = @roomId AND status IN ('tentative','confirmed','checked_in') AND daterange(arrival, departure) && daterange(@arrival, @departure)
              AND (@exclude::uuid IS NULL OR id <> @exclude) LIMIT 1
            """, new { roomId, arrival, departure, exclude });
        if (clash is not null) throw PmsException.Conflict($"Oda {room.Number} bu tarihlerde {clash} numaralı rezervasyona atanmış.", "room_conflict");
    }

    // ------------------------------------------------------------------ Oluştur / güncelle
    public static async Task<Guid> CreateAsync(Tx tx, SaveReservationRequest req, bool walkIn = false)
    {
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var currency = await PropertyEndpoints.CurrencyAsync(tx);
        Validate.DateRange(req.Arrival, req.Departure);
        if (req.Arrival < bd) throw PmsException.Validation("Giriş tarihi iş gününden (" + bd.ToString("dd.MM.yyyy") + ") önce olamaz.");
        if (req.Status is not ("tentative" or "confirmed")) throw PmsException.Validation("Rezervasyon durumu 'tentative' veya 'confirmed' olmalıdır.");

        var guestId = req.GuestId ?? (req.NewGuest is { } ng ? await GuestEndpoints.CreateGuestAsync(tx, ng) : throw PmsException.Validation("Misafir seçilmelidir."));
        await EnsureGuestAllowedAsync(tx, guestId);
        await EnsureCapacityAsync(tx, req.RoomTypeId, req.Adults, req.Children);
        await EnsureAvailabilityAsync(tx, req.RoomTypeId, req.Arrival, req.Departure, null);
        if (req.RoomId is { } roomId) await EnsureRoomUsableAsync(tx, roomId, req.RoomTypeId, req.Arrival, req.Departure, null, false);

        var (nights, nightly) = await ResolveRatesAsync(tx, req);
        var number = "R" + await tx.ScalarAsync<long>("SELECT nextval('pms.reservation_number_seq')");
        var id = await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.reservations (reservation_number, status, guest_id, company_id, agency_id, group_id, room_type_id, room_id, arrival, departure,
                adults, children, rate_plan_id, nightly_rate, currency, meal_plan, source, market, segment, is_walk_in, eta, etd, notes, special_requests,
                deposit_required, option_until, created_by)
            VALUES (@number, @status, @guestId, @CompanyId, @AgencyId, @GroupId, @RoomTypeId, @RoomId, @Arrival, @Departure,
                @Adults, @Children, @RatePlanId, @nightly, @currency, @meal, @source, @market, @segment, @walkIn, @Eta, @Etd, @notes, @special,
                @DepositRequired, @OptionUntil, @uid)
            RETURNING id
            """, new
        {
            number, status = req.Status, guestId, req.CompanyId, req.AgencyId, req.GroupId, req.RoomTypeId, req.RoomId, req.Arrival, req.Departure,
            req.Adults, req.Children, req.RatePlanId, nightly, currency, meal = MealPlan(req.MealPlan), source = walkIn ? "walk_in" : Source(req.Source),
            market = Validate.Optional(req.Market, 50), segment = Validate.Optional(req.Segment, 50), walkIn, req.Eta, req.Etd,
            notes = Validate.Optional(req.Notes, 4000), special = Validate.Optional(req.SpecialRequests, 2000),
            DepositRequired = Validate.Money(req.DepositRequired, "Depozito", allowZero: true), req.OptionUntil, uid = tx.User.Id,
        });
        await WriteRatesAsync(tx, id, nights);
        await tx.ExecAsync("INSERT INTO pms.reservation_guests (reservation_id, guest_id, is_primary) VALUES (@id, @guestId, true)", new { id, guestId });
        if (req.RoomId is { } r)
            await tx.ExecAsync("INSERT INTO pms.room_assignments (reservation_id, room_id, kind, by_user) VALUES (@id, @r, 'assign', @uid)", new { id, r, uid = tx.User.Id });
        await FolioService.CreateReservationFolioAsync(tx, id, 1, "guest", guestId, null, null, currency);
        await tx.AuditAsync("reservation.create", "reservation", id, null, new { number, req.Arrival, req.Departure, req.RoomTypeId, req.RoomId, nightly, req.Adults, req.Children });
        tx.Publish("reservations", id);
        tx.Publish("availability");
        if (req.RoomId is not null) tx.Publish("rooms");
        return id;
    }

    public static async Task UpdateAsync(Tx tx, Guid id, SaveReservationRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version ?? -1);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (r.Status is not ("tentative" or "confirmed" or "checked_in")) throw PmsException.Validation("Bu durumdaki rezervasyon düzenlenemez.");
        Validate.DateRange(req.Arrival, req.Departure);
        var inHouse = r.Status == "checked_in";
        if (inHouse)
        {
            if (req.Arrival != r.Arrival) throw PmsException.Validation("Konaklayan misafirin giriş tarihi değiştirilemez.");
            if (req.RoomTypeId != r.RoomTypeId || req.RoomId != r.RoomId) throw PmsException.Validation("Konaklayan misafirin odası 'Oda Değiştir' ile değiştirilir.");
            if (req.Departure <= bd) throw PmsException.Validation("Çıkış tarihi iş gününden sonra olmalıdır; bugün ayrılıyorsa check-out yapın.");
        }
        else if (req.Arrival < bd && req.Arrival != r.Arrival) throw PmsException.Validation("Giriş tarihi iş gününden önce olamaz.");
        if (req.Status is not ("tentative" or "confirmed") && !inHouse) throw PmsException.Validation("Geçersiz durum.");
        if (req.GuestId is { } gid && gid != r.GuestId) await EnsureGuestAllowedAsync(tx, gid);
        await EnsureCapacityAsync(tx, req.RoomTypeId, req.Adults, req.Children);

        var datesChanged = req.Arrival != r.Arrival || req.Departure != r.Departure || req.RoomTypeId != r.RoomTypeId;
        if (datesChanged) await EnsureAvailabilityAsync(tx, req.RoomTypeId, req.Arrival, req.Departure, id);
        if (req.RoomId is { } roomId && (datesChanged || roomId != r.RoomId))
        {
            if (roomId != r.RoomId) tx.Ctx.Require("room.change");
            await EnsureRoomUsableAsync(tx, roomId, req.RoomTypeId, req.Arrival, req.Departure, id, false);
        }

        var rateChanged = datesChanged || req.RatePlanId != r.RatePlanId || (req.NightlyRate is { } nr && nr != r.NightlyRate);
        decimal nightly = r.NightlyRate;
        if (rateChanged)
        {
            var (nights, n) = await ResolveRatesAsync(tx, req);
            nightly = n;
            // Postalanmış gecelerin fiyatı geçmişe dönük değişmez.
            var posted = await tx.ListAsync<DateOnly>("SELECT business_date FROM pms.room_charge_postings WHERE reservation_id = @id", new { id });
            var existing = (await tx.ListAsync<NightRate>("SELECT stay_date AS date, rate FROM pms.reservation_rates WHERE reservation_id = @id", new { id }))
                .ToDictionary(x => x.Date, x => x.Rate);
            await WriteRatesAsync(tx, id, nights.Select(x => posted.Contains(x.Date) && existing.TryGetValue(x.Date, out var old) ? x with { Rate = old } : x));
        }

        await tx.ExecVersionedAsync("""
            UPDATE pms.reservations SET status = @status, guest_id = @guestId, company_id = @CompanyId, agency_id = @AgencyId, group_id = @GroupId,
                room_type_id = @RoomTypeId, room_id = @RoomId, arrival = @Arrival, departure = @Departure, adults = @Adults, children = @Children,
                rate_plan_id = @RatePlanId, nightly_rate = @nightly, meal_plan = @meal, source = @source, market = @market, segment = @segment,
                eta = @Eta, etd = @Etd, notes = @notes, special_requests = @special, deposit_required = @DepositRequired, option_until = @OptionUntil,
                updated_at = now(), version = version + 1
            WHERE id = @id AND version = @version
            """, new
        {
            id, version = r.Version, status = inHouse ? "checked_in" : req.Status, guestId = req.GuestId ?? r.GuestId, req.CompanyId, req.AgencyId, req.GroupId,
            req.RoomTypeId, req.RoomId, req.Arrival, req.Departure, req.Adults, req.Children, req.RatePlanId, nightly, meal = MealPlan(req.MealPlan),
            source = r.IsWalkIn ? "walk_in" : Source(req.Source), market = Validate.Optional(req.Market, 50), segment = Validate.Optional(req.Segment, 50),
            req.Eta, req.Etd, notes = Validate.Optional(req.Notes, 4000), special = Validate.Optional(req.SpecialRequests, 2000),
            DepositRequired = Validate.Money(req.DepositRequired, "Depozito", allowZero: true), req.OptionUntil,
        });
        if (req.GuestId is { } ng && ng != r.GuestId)
        {
            await tx.ExecAsync("UPDATE pms.reservation_guests SET is_primary = false WHERE reservation_id = @id", new { id });
            await tx.ExecAsync("""
                INSERT INTO pms.reservation_guests (reservation_id, guest_id, is_primary) VALUES (@id, @ng, true)
                ON CONFLICT (reservation_id, guest_id) DO UPDATE SET is_primary = true
                """, new { id, ng });
        }
        if (req.RoomId != r.RoomId && req.RoomId is { } assigned)
            await tx.ExecAsync("INSERT INTO pms.room_assignments (reservation_id, room_id, from_room_id, kind, by_user) VALUES (@id, @assigned, @from, 'assign', @uid)",
                new { id, assigned, from = r.RoomId, uid = tx.User.Id });
        await tx.AuditAsync("reservation.update", "reservation", id, r, req);
        tx.Publish("reservations", id);
        tx.Publish("availability");
        tx.Publish("rooms");
    }

    async static Task<(List<NightRate> Nights, decimal Nightly)> ResolveRatesAsync(Tx tx, SaveReservationRequest req)
    {
        var preview = await ComputeRatesAsync(tx, req.RoomTypeId, req.RatePlanId, req.Arrival, req.Departure);
        if (req.NightlyRate is { } manual && preview.Nights.Any(n => n.Rate != manual))
        {
            tx.Ctx.Require("rate.override");
            Validate.Money(manual, "Gecelik fiyat", allowZero: true);
            return (preview.Nights.Select(n => n with { Rate = manual }).ToList(), manual);
        }
        return (preview.Nights.ToList(), preview.Average);
    }

    // ------------------------------------------------------------------ Durum geçişleri
    public static async Task CancelAsync(Tx tx, Guid id, CancelRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version);
        if (r.Status is not ("tentative" or "confirmed")) throw PmsException.Validation("Yalnız gelmemiş (onaylı/opsiyonlu) rezervasyonlar iptal edilebilir.");
        var reason = Validate.Required(req.Reason, "İptal gerekçesi", 500);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        await tx.ExecAsync("""
            UPDATE pms.reservations SET status = 'cancelled', cancelled_at = now(), cancelled_on = @bd, cancelled_by = @uid, cancel_reason = @reason,
                updated_at = now(), version = version + 1
            WHERE id = @id
            """, new { id, uid = tx.User.Id, reason, bd });
        await tx.AuditAsync("reservation.cancel", "reservation", id, new { r.Status }, null, reason);
        tx.Publish("reservations", id);
        tx.Publish("availability");
        tx.Publish("rooms");
    }

    public static async Task NoShowAsync(Tx tx, Guid id, int version, string? reason = null)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, version);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (r.Status is not ("tentative" or "confirmed")) throw PmsException.Validation("Yalnız gelmemiş rezervasyonlar no-show yapılabilir.");
        if (r.Arrival > bd) throw PmsException.Validation("Giriş tarihi gelmemiş rezervasyon no-show yapılamaz.");
        await tx.ExecAsync("""
            UPDATE pms.reservations SET status = 'no_show', no_show_at = now(), no_show_on = @bd, cancel_reason = COALESCE(@reason, cancel_reason), updated_at = now(), version = version + 1
            WHERE id = @id
            """, new { id, reason, bd });
        await tx.AuditAsync("reservation.no_show", "reservation", id, new { r.Status }, null, reason);
        tx.Publish("reservations", id);
        tx.Publish("availability");
        tx.Publish("rooms");
    }

    public static async Task AssignRoomAsync(Tx tx, Guid id, AssignRoomRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version);
        if (r.Status is not ("tentative" or "confirmed")) throw PmsException.Validation("Konaklayan misafir için 'Oda Değiştir' kullanın.");
        if (req.RoomId is { } roomId) await EnsureRoomUsableAsync(tx, roomId, r.RoomTypeId, r.Arrival, r.Departure, id, false);
        await tx.ExecAsync("UPDATE pms.reservations SET room_id = @room, updated_at = now(), version = version + 1 WHERE id = @id", new { id, room = req.RoomId });
        await tx.ExecAsync("""
            INSERT INTO pms.room_assignments (reservation_id, room_id, from_room_id, kind, by_user)
            SELECT @id, COALESCE(@room, @from), @from, CASE WHEN @room IS NULL THEN 'unassign' ELSE 'assign' END, @uid WHERE COALESCE(@room, @from) IS NOT NULL
            """, new { id, room = req.RoomId, from = r.RoomId, uid = tx.User.Id });
        await tx.AuditAsync("reservation.assign_room", "reservation", id, new { r.RoomId }, new { req.RoomId });
        tx.Publish("reservations", id);
        tx.Publish("rooms");
    }

    public static async Task CheckInAsync(Tx tx, IntegrationRegistry registry, Guid id, CheckInRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (r.Status is not ("tentative" or "confirmed")) throw PmsException.Validation("Bu rezervasyon check-in için uygun durumda değil.");
        if (r.GuestIsBlacklisted) throw PmsException.Conflict("Misafir kara listede. Check-in yapılamaz; yöneticinize başvurun.", "blacklisted");
        if (r.Arrival < bd) throw PmsException.Validation("Rezervasyonun giriş tarihi geçmiş. Tarihleri güncelleyin veya no-show işlemi yapın.");

        var arrival = r.Arrival;
        if (r.Arrival > bd)
        {
            if (!req.EarlyCheckIn) throw PmsException.Validation($"Rezervasyonun giriş tarihi {r.Arrival:dd.MM.yyyy}. Erken giriş için 'Erken check-in' seçin.");
            arrival = bd;
            await EnsureAvailabilityAsync(tx, r.RoomTypeId, bd, r.Arrival, id);
        }

        await EnsureRoomUsableAsync(tx, req.RoomId, r.RoomTypeId, arrival, r.Departure, id, tx.User.Has("room.change"));
        var room = await tx.OneAsync<(string Number, string HkStatus, Guid RoomTypeId)>("SELECT number, hk_status, room_type_id FROM pms.rooms WHERE id = @id", new { id = req.RoomId });
        if (room.RoomTypeId != r.RoomTypeId) await EnsureAvailabilityAsync(tx, room.RoomTypeId, arrival, r.Departure, id);
        if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.reservations WHERE room_id = @room AND status = 'checked_in')", new { room = req.RoomId }))
            throw PmsException.Conflict($"Oda {room.Number} şu an dolu.", "room_occupied");
        if (room.HkStatus is "dirty" or "cleaning" && !await PropertyEndpoints.SettingAsync<bool>(tx, "frontoffice.allow_checkin_dirty_room"))
            throw PmsException.Conflict($"Oda {room.Number} temiz değil ({(room.HkStatus == "dirty" ? "kirli" : "temizleniyor")}). Kat hizmetleri onayı bekleniyor.", "room_dirty");

        if (await PropertyEndpoints.SettingAsync<bool>(tx, "guest.require_identity_on_checkin"))
        {
            var missing = await tx.ListAsync<string>("""
                SELECT g.first_name || ' ' || g.last_name FROM pms.reservation_guests rg JOIN pms.guests g ON g.id = rg.guest_id
                WHERE rg.reservation_id = @id AND (g.identity_number IS NULL OR g.nationality IS NULL)
                """, new { id });
            if (missing.Count > 0)
                throw PmsException.Validation($"Kimlik bildirimi için kimlik/pasaport numarası ve uyruk zorunludur: {string.Join(", ", missing)}");
        }

        if (arrival != r.Arrival)
        {
            var (nights, _) = await ResolveRatesAsync(tx, new SaveReservationRequest(r.GuestId, null, r.CompanyId, r.AgencyId, r.GroupId, r.RoomTypeId, req.RoomId,
                arrival, r.Departure, r.Adults, r.Children, r.RatePlanId, null, r.MealPlan, "confirmed", r.Source, r.Market, r.Segment, r.Eta, r.Etd,
                r.Notes, r.SpecialRequests, r.DepositRequired, r.OptionUntil, r.Version));
            var existing = await tx.ListAsync<NightRate>("SELECT stay_date AS date, rate FROM pms.reservation_rates WHERE reservation_id = @id", new { id });
            await WriteRatesAsync(tx, id, nights.Select(n => existing.FirstOrDefault(e => e.Date == n.Date) is { } e && e != default ? e : n));
        }

        var newType = room.RoomTypeId;
        await tx.ExecAsync("""
            UPDATE pms.reservations SET status = 'checked_in', room_id = @room, room_type_id = @newType, arrival = @arrival,
                checked_in_at = now(), checked_in_by = @uid, updated_at = now(), version = version + 1
            WHERE id = @id
            """, new { id, room = req.RoomId, newType, arrival, uid = tx.User.Id });
        await tx.ExecAsync("""
            INSERT INTO pms.room_assignments (reservation_id, room_id, from_room_id, kind, reason, by_user)
            VALUES (@id, @room, @from, CASE WHEN @from IS NULL OR @from <> @room THEN 'assign' ELSE 'assign' END, 'check-in', @uid)
            """, new { id, room = req.RoomId, from = r.RoomId, uid = tx.User.Id });
        if (room.HkStatus == "inspected" || room.HkStatus == "clean")
            await tx.ExecAsync("UPDATE pms.rooms SET is_dnd = false WHERE id = @room", new { room = req.RoomId });
        await KbsService.CreateReportsAsync(tx, registry, id, "check_in");
        await tx.AuditAsync("reservation.check_in", "reservation", id, new { r.Status, r.RoomId, r.Arrival }, new { req.RoomId, arrival, early = arrival != r.Arrival });
        tx.Publish("reservations", id);
        tx.Publish("rooms", req.RoomId);
        tx.Publish("availability");
    }

    public static async Task<Guid> WalkInAsync(Tx tx, IntegrationRegistry registry, WalkInRequest req)
    {
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (req.Reservation.Arrival != bd) throw PmsException.Validation("Walk-in giriş tarihi iş günü olmalıdır.");
        var id = await CreateAsync(tx, req.Reservation with { Status = "confirmed", RoomId = req.RoomId }, walkIn: true);
        var version = await tx.ScalarAsync<int>("SELECT version FROM pms.reservations WHERE id = @id", new { id });
        await CheckInAsync(tx, registry, id, new CheckInRequest(req.RoomId, false, version));
        return id;
    }

    public static async Task CheckOutAsync(Tx tx, IntegrationRegistry registry, Guid id, CheckOutRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version);
        if (r.Status != "checked_in") throw PmsException.Validation("Yalnız konaklayan misafir için check-out yapılabilir.");
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);

        await tx.ExecAsync("SELECT 1 FROM pms.folios WHERE reservation_id = @id FOR UPDATE", new { id });
        var balances = await tx.ListAsync<(string FolioNumber, decimal Balance)>("""
            SELECT f.folio_number, COALESCE(sum(l.amount), 0) FROM pms.folios f LEFT JOIN pms.folio_lines l ON l.folio_id = f.id
            WHERE f.reservation_id = @id GROUP BY f.id, f.folio_number HAVING COALESCE(sum(l.amount), 0) <> 0
            """, new { id });
        if (balances.Count > 0 && await PropertyEndpoints.SettingAsync<bool>(tx, "frontoffice.checkout_requires_zero_balance"))
            throw PmsException.Conflict("Açık bakiye var: " + string.Join(", ", balances.Select(b => $"{b.FolioNumber}: {b.Balance:N2} {r.Currency}")) +
                ". Tahsilat veya aktarım yapın.", "open_balance");

        // Erken çıkış: konaklama bugüne kısaltılır (en az bir gece).
        var departure = r.Departure > bd ? (bd > r.Arrival ? bd : r.Arrival.AddDays(1)) : r.Departure;
        if (departure != r.Departure)
            await tx.ExecAsync("DELETE FROM pms.reservation_rates WHERE reservation_id = @id AND stay_date >= @departure", new { id, departure });

        await tx.ExecAsync("""
            UPDATE pms.reservations SET status = 'checked_out', departure = @departure, checked_out_at = now(), checked_out_by = @uid,
                updated_at = now(), version = version + 1
            WHERE id = @id
            """, new { id, departure, uid = tx.User.Id });
        await tx.ExecAsync("UPDATE pms.folios SET status = 'closed', closed_at = now(), closed_by = @uid, version = version + 1 WHERE reservation_id = @id AND status = 'open'",
            new { id, uid = tx.User.Id });
        await tx.ExecAsync("UPDATE pms.rooms SET hk_status = 'dirty', is_dnd = false, hk_updated_at = now(), hk_updated_by = @uid, version = version + 1 WHERE id = @room",
            new { room = r.RoomId, uid = tx.User.Id });
        await tx.ExecAsync("""
            INSERT INTO pms.hk_tasks (room_id, task_type, business_date, notes, created_by) VALUES (@room, 'departure_clean', @bd, @note, @uid)
            """, new { room = r.RoomId, bd, note = $"Çıkış: {r.ReservationNumber}", uid = tx.User.Id });
        await tx.ExecAsync("UPDATE pms.wakeup_calls SET status = 'cancelled' WHERE reservation_id = @id AND status = 'pending'", new { id });
        await KbsService.CreateReportsAsync(tx, registry, id, "check_out");
        await tx.AuditAsync("reservation.check_out", "reservation", id, new { r.Status, r.Departure }, new { departure, lateCheckOut = req.LateCheckOut });
        tx.Publish("reservations", id);
        tx.Publish("rooms", r.RoomId);
        tx.Publish("housekeeping");
        tx.Publish("availability");
        tx.Publish("folios");
    }

    public static async Task MoveRoomAsync(Tx tx, IntegrationRegistry registry, Guid id, MoveRoomRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version);
        if (r.Status != "checked_in") throw PmsException.Validation("Oda değişimi konaklayan misafir için yapılır; gelecek rezervasyonda oda atamasını kullanın.");
        if (req.RoomId == r.RoomId) throw PmsException.Validation("Yeni oda mevcut odayla aynı.");
        if (req.Kind is not ("move" or "upgrade" or "downgrade")) throw PmsException.Validation("Geçersiz değişim türü.");
        var reason = Validate.Required(req.Reason, "Gerekçe", 300);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var target = await tx.OneOrNullAsync<(Guid RoomTypeId, string Number, string HkStatus)>(
            "SELECT room_type_id, number, hk_status FROM pms.rooms WHERE id = @room", new { room = req.RoomId });
        if (target == default) throw PmsException.NotFound("Oda");
        if (target.RoomTypeId != r.RoomTypeId && req.Kind == "move")
            throw PmsException.Validation("Farklı oda tipine geçiş için 'upgrade' veya 'downgrade' seçin.");
        if (target.RoomTypeId != r.RoomTypeId) await EnsureAvailabilityAsync(tx, target.RoomTypeId, bd, r.Departure, id);
        await EnsureRoomUsableAsync(tx, req.RoomId, target.RoomTypeId, bd, r.Departure, id, true);
        if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.reservations WHERE room_id = @room AND status = 'checked_in')", new { room = req.RoomId }))
            throw PmsException.Conflict($"Oda {target.Number} şu an dolu.", "room_occupied");
        if (target.HkStatus is "dirty" or "cleaning" && !await PropertyEndpoints.SettingAsync<bool>(tx, "frontoffice.allow_checkin_dirty_room"))
            throw PmsException.Conflict($"Oda {target.Number} temiz değil.", "room_dirty");

        if (!req.KeepRate && req.NewNightlyRate is { } nr)
        {
            tx.Ctx.Require("rate.override");
            Validate.Money(nr, "Gecelik fiyat", allowZero: true);
            await tx.ExecAsync("""
                UPDATE pms.reservation_rates SET rate = @nr WHERE reservation_id = @id AND stay_date >= @bd
                  AND stay_date NOT IN (SELECT business_date FROM pms.room_charge_postings WHERE reservation_id = @id)
                """, new { id, nr, bd });
            await tx.ExecAsync("UPDATE pms.reservations SET nightly_rate = @nr WHERE id = @id", new { id, nr });
        }
        await tx.ExecAsync("""
            UPDATE pms.reservations SET room_id = @room, room_type_id = @type, updated_at = now(), version = version + 1 WHERE id = @id
            """, new { id, room = req.RoomId, type = target.RoomTypeId });
        await tx.ExecAsync("UPDATE pms.rooms SET hk_status = 'dirty', hk_updated_at = now(), hk_updated_by = @uid, version = version + 1 WHERE id = @old",
            new { old = r.RoomId, uid = tx.User.Id });
        await tx.ExecAsync("INSERT INTO pms.hk_tasks (room_id, task_type, business_date, notes, created_by) VALUES (@old, 'departure_clean', @bd, @note, @uid)",
            new { old = r.RoomId, bd, note = $"Oda değişimi: {r.ReservationNumber}", uid = tx.User.Id });
        await tx.ExecAsync("""
            INSERT INTO pms.room_assignments (reservation_id, room_id, from_room_id, kind, reason, by_user) VALUES (@id, @room, @old, @kind, @reason, @uid)
            """, new { id, room = req.RoomId, old = r.RoomId, kind = req.Kind, reason, uid = tx.User.Id });
        await KbsService.CreateReportsAsync(tx, registry, id, "room_change");
        await tx.AuditAsync("reservation.move_room", "reservation", id, new { r.RoomId, r.RoomTypeId }, new { req.RoomId, req.Kind, req.KeepRate, req.NewNightlyRate }, reason);
        tx.Publish("reservations", id);
        tx.Publish("rooms");
        tx.Publish("availability");
    }

    /// <summary>Konaklama uzatma veya kısaltma.</summary>
    public static async Task ChangeDepartureAsync(Tx tx, Guid id, ChangeStayRequest req)
    {
        var r = await GetForUpdateAsync(tx, id);
        CheckVersion(r, req.Version);
        if (r.Status is not ("tentative" or "confirmed" or "checked_in")) throw PmsException.Validation("Bu rezervasyonun çıkış tarihi değiştirilemez.");
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (req.Departure <= r.Arrival) throw PmsException.Validation("Çıkış tarihi giriş tarihinden sonra olmalıdır.");
        if (r.Status == "checked_in" && req.Departure <= bd) throw PmsException.Validation("Bugün ayrılan misafir için check-out yapın.");
        if (req.Departure == r.Departure) return;
        Validate.DateRange(r.Arrival, req.Departure);
        if (req.Departure > r.Departure)
        {
            await EnsureAvailabilityAsync(tx, r.RoomTypeId, r.Departure, req.Departure, id);
            if (r.RoomId is { } room) await EnsureRoomUsableAsync(tx, room, r.RoomTypeId, r.Departure, req.Departure, id, true);
            var extra = await ComputeRatesAsync(tx, r.RoomTypeId, r.RatePlanId, r.Departure, req.Departure);
            var lastRate = await tx.ScalarAsync<decimal?>("SELECT rate FROM pms.reservation_rates WHERE reservation_id = @id ORDER BY stay_date DESC LIMIT 1", new { id });
            // Uzatmada mevcut anlaşmalı fiyat korunur (fiyat planı yoksa).
            foreach (var n in extra.Nights)
                await tx.ExecAsync("INSERT INTO pms.reservation_rates (reservation_id, stay_date, rate) VALUES (@id, @Date, @rate) ON CONFLICT DO NOTHING",
                    new { id, n.Date, rate = r.RatePlanId is null && lastRate is { } lr ? lr : n.Rate });
        }
        else
        {
            if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.room_charge_postings WHERE reservation_id = @id AND business_date >= @d)", new { id, d = req.Departure }))
                throw PmsException.Validation("Ücreti postalanmış geceler kısaltılamaz.");
            await tx.ExecAsync("DELETE FROM pms.reservation_rates WHERE reservation_id = @id AND stay_date >= @d", new { id, d = req.Departure });
        }
        await tx.ExecAsync("UPDATE pms.reservations SET departure = @d, updated_at = now(), version = version + 1 WHERE id = @id", new { id, d = req.Departure });
        await tx.AuditAsync(req.Departure > r.Departure ? "reservation.extend" : "reservation.shorten", "reservation", id, new { r.Departure }, new { req.Departure });
        tx.Publish("reservations", id);
        tx.Publish("availability");
        tx.Publish("rooms");
    }

    // ------------------------------------------------------------------ Yardımcılar
    static async Task EnsureGuestAllowedAsync(Tx tx, Guid guestId)
    {
        var g = await tx.OneOrNullAsync<(bool IsBlacklisted, string Name)>(
            "SELECT is_blacklisted, first_name || ' ' || last_name FROM pms.guests WHERE id = @guestId", new { guestId });
        if (g == default) throw PmsException.NotFound("Misafir");
        if (g.IsBlacklisted && !tx.User.Has("guest.blacklist"))
            throw PmsException.Conflict($"{g.Name} kara listede. Rezervasyon için yetkili onayı gerekir.", "blacklisted");
    }

    static async Task EnsureCapacityAsync(Tx tx, Guid roomTypeId, int adults, int children)
    {
        var cap = await tx.OneOrNullAsync<(int MaxAdults, int MaxChildren, string Code)>(
            "SELECT max_adults, max_children, code FROM pms.room_types WHERE id = @roomTypeId AND is_active", new { roomTypeId });
        if (cap == default) throw PmsException.Validation("Oda tipi bulunamadı veya pasif.");
        if (adults < 1) throw PmsException.Validation("En az bir yetişkin olmalıdır.");
        if (children < 0) throw PmsException.Validation("Çocuk sayısı negatif olamaz.");
        if (adults > cap.MaxAdults || children > cap.MaxChildren)
            throw PmsException.Validation($"{cap.Code} kapasitesi: en fazla {cap.MaxAdults} yetişkin, {cap.MaxChildren} çocuk.");
    }

    static string MealPlan(string? m) => m is null or "" ? "RO" : m is "RO" or "BB" or "HB" or "FB" or "AI" or "UAI" ? m : throw PmsException.Validation("Geçersiz pansiyon tipi.");

    static string Source(string? s) => s is null or "" ? "direct"
        : s is "direct" or "phone" or "email" or "web" or "agency" or "company" or "ota" or "other" ? s : throw PmsException.Validation("Geçersiz rezervasyon kaynağı.");
}
