using System.Data;
using System.Text.Json;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Folios;
using HotelPms.Server.Modules.Integrations;
using HotelPms.Server.Modules.Property;
using HotelPms.Server.Modules.Reservations;

namespace HotelPms.Server.Modules.NightAudit;

public sealed record AuditIssue(string Code, string Severity, string Message, Guid? ReservationId, string? Reference);
public sealed record NightAuditPreview(DateOnly BusinessDate, DateOnly NextBusinessDate, bool AlreadyClosed, IReadOnlyList<AuditIssue> Blockers,
    IReadOnlyList<AuditIssue> Warnings, int RoomChargesToPost, decimal RoomChargeTotal, int InHouse, bool CanRun);
public sealed record RunNightAuditRequest(DateOnly BusinessDate, bool AutoNoShow, bool CancelExpiredOptions = false);
public sealed record NightAuditResult(DateOnly ClosedDate, DateOnly NewBusinessDate, int RoomChargesPosted, decimal RoomChargeTotal, int NoShows,
    IReadOnlyList<AuditIssue> Warnings, int OptionsCancelled = 0, decimal AccommodationTaxTotal = 0);
public sealed record NightAuditHistoryDto(Guid Id, DateOnly BusinessDate, DateTime StartedAt, DateTime CompletedAt, string Username, JsonElement Summary);

public static class NightAuditEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/night-audit").WithTags("NightAudit").RequirePermission("night_audit.execute");

        // autoNoShow: gelmeyen bugünkü rezervasyonlar engel değil, no-show yapılacak uyarısı olarak gösterilir.
        g.MapGet("/preview", (CommandRunner cmd, bool? autoNoShow, bool? cancelExpiredOptions) =>
            cmd.ReadAsync(tx => PreviewAsync(tx, autoNoShow ?? false, cancelExpiredOptions ?? false)));

        g.MapGet("/history", (Db db) => db.QueryAsync<NightAuditHistoryDto>("""
            SELECT n.id, n.business_date, n.started_at, n.completed_at, u.username, n.summary
            FROM pms.night_audits n JOIN pms.users u ON u.id = n.user_id ORDER BY n.business_date DESC LIMIT 100
            """));

        g.MapPost("/run", (RunNightAuditRequest req, CommandRunner cmd) => cmd.RunAsync("night_audit.run", req, async tx =>
        {
            var started = DateTime.UtcNow;
            // İş günü satırı kilitlenir: aynı anda ikinci gece denetimi veya iş gününe bağlı işlem araya giremez.
            var bd = await PropertyEndpoints.BusinessDateAsync(tx, forUpdate: true);
            if (req.BusinessDate != bd)
                throw PmsException.Conflict($"Kapatılmak istenen tarih ({req.BusinessDate:dd.MM.yyyy}) güncel iş günü ({bd:dd.MM.yyyy}) değil.", "business_date_mismatch");
            if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.night_audits WHERE business_date = @bd)", new { bd }))
                throw PmsException.Conflict("Bu iş günü için gece denetimi zaten tamamlanmış.", "already_closed");

            var noShows = 0;
            if (req.AutoNoShow)
            {
                var pending = await tx.ListAsync<(Guid Id, int Version)>(
                    "SELECT id, version FROM pms.reservations WHERE status IN ('tentative','confirmed') AND arrival <= @bd ORDER BY arrival", new { bd });
                foreach (var p in pending)
                {
                    await ReservationService.NoShowAsync(tx, p.Id, p.Version, "Gece denetimi: otomatik no-show");
                    noShows++;
                }
            }

            // Opsiyon süresi bugün veya daha önce dolmuş, girişi henüz gelmemiş opsiyonlu rezervasyonlar iptal edilir (kapasite serbest kalır).
            var optionsCancelled = 0;
            if (req.CancelExpiredOptions)
            {
                var expired = await tx.ListAsync<(Guid Id, int Version, DateOnly OptionUntil)>(ExpiredOptionsSql, new { bd });
                foreach (var o in expired)
                {
                    await ReservationService.CancelAsync(tx, o.Id, new CancelRequest($"Opsiyon süresi doldu ({o.OptionUntil:dd.MM.yyyy}) — gece denetimi", o.Version));
                    optionsCancelled++;
                }
            }

            var preview = await PreviewAsync(tx, req.AutoNoShow, req.CancelExpiredOptions);
            if (preview.Blockers.Count > 0)
                throw new PmsException(409, "night_audit_blocked", "Gece denetimi tamamlanamaz. Önce engelleri giderin.", preview.Blockers);

            // Oda ücretleri: her in-house konaklama için bu gecenin ücreti bir kez.
            var roomCode = await tx.OneAsync<(Guid Id, decimal VatRate)>("SELECT id, vat_rate FROM pms.transaction_codes WHERE code = 'ROOM'");
            var kv = await AccommodationTaxAsync(tx);
            var currency = await PropertyEndpoints.CurrencyAsync(tx);
            var toPost = await tx.ListAsync<ChargeCandidate>(ChargeCandidatesSql, new { bd });
            decimal total = 0, posted = 0;
            foreach (var c in toPost.Where(c => c.Rate > 0))
            {
                posted += await FolioService.PostRoomChargeAsync(tx, c.ReservationId, c.Window, currency, bd, c.Rate, c.RoomNumber, c.ReservationNumber,
                    roomCode.Id, roomCode.VatRate, kv);
                total += c.Rate;
            }
            var taxTotal = kv is null ? 0 : await tx.ScalarAsync<decimal>(
                "SELECT COALESCE(sum(amount), 0) FROM pms.folio_lines WHERE business_date = @bd AND transaction_code_id = @code AND line_type = 'charge'",
                new { bd, code = kv.CodeId });
            // Ücretsiz (0) gece için de tek kayıt tutulmaz; complimentary istatistiğe yansır.
            var stats = await ComputeStatisticsAsync(tx, bd);
            await tx.ExecAsync("""
                INSERT INTO pms.daily_statistics (business_date, rooms_total, rooms_out_of_order, rooms_available, rooms_sold, complimentary, guests_in_house,
                    arrivals, departures, no_shows, cancellations, room_revenue, other_revenue, payments, occupancy_pct, adr, revpar)
                VALUES (@BusinessDate, @RoomsTotal, @RoomsOutOfOrder, @RoomsAvailable, @RoomsSold, @Complimentary, @GuestsInHouse, @Arrivals, @Departures,
                    @NoShows, @Cancellations, @RoomRevenue, @OtherRevenue, @Payments, @OccupancyPct, @Adr, @Revpar)
                """, stats);

            var next = bd.AddDays(1);
            var summary = new
            {
                roomChargesPosted = toPost.Count(c => c.Rate > 0), roomChargeTotal = total, postedTotal = posted, accommodationTax = taxTotal, noShows,
                optionsCancelled, stats.RoomsSold, stats.OccupancyPct,
                stats.Adr, stats.Revpar, stats.RoomRevenue, stats.OtherRevenue, stats.Payments,
            };
            await tx.ExecAsync("""
                INSERT INTO pms.night_audits (business_date, status, started_at, user_id, summary, warnings)
                VALUES (@bd, 'completed', @started, @uid, @summary::jsonb, @warnings::jsonb)
                """, new
            {
                bd, started, uid = tx.User.Id, summary = JsonSerializer.Serialize(summary, Json.Options),
                warnings = JsonSerializer.Serialize(preview.Warnings, Json.Options),
            });
            await tx.ExecAsync("UPDATE pms.property SET business_date = @next, updated_at = now(), version = version + 1", new { next });
            await tx.AuditAsync("night_audit.completed", "business_date", bd, new { businessDate = bd }, new { businessDate = next, summary });
            tx.Publish("business_date");
            tx.Publish("folios");
            tx.Publish("reservations");
            tx.Publish("availability");
            tx.Publish("rooms");
            return new NightAuditResult(bd, next, summary.roomChargesPosted, total, noShows, preview.Warnings, optionsCancelled, taxTotal);
        }, isolation: IsolationLevel.ReadCommitted));
    }

    /// <summary>Konaklama vergisi açıksa (oran > 0) yapılandırmayı döner.</summary>
    static async Task<FolioService.AccommodationTax?> AccommodationTaxAsync(Tx tx)
    {
        var rate = await PropertyEndpoints.SettingAsync<decimal>(tx, "tax.accommodation_rate");
        if (rate <= 0) return null;
        var code = await tx.ScalarAsync<Guid?>("SELECT id FROM pms.transaction_codes WHERE code = 'KV' AND is_active")
            ?? throw PmsException.Validation("Konaklama vergisi açık ancak 'KV' işlem kodu bulunamadı veya pasif. Yönetim → Finans ekranından kontrol edin.");
        return new(rate, await PropertyEndpoints.SettingAsync<bool>(tx, "tax.accommodation_included"), code);
    }

    const string ExpiredOptionsSql = """
        SELECT id, version, option_until FROM pms.reservations
        WHERE status = 'tentative' AND option_until IS NOT NULL AND option_until <= @bd AND arrival > @bd
        ORDER BY option_until, reservation_number
        """;

    sealed record ChargeCandidate(Guid ReservationId, string ReservationNumber, string RoomNumber, int Window, decimal Rate);

    const string ChargeCandidatesSql = """
        SELECT r.id AS reservation_id, r.reservation_number, rm.number AS room_number, r.room_charge_window AS window,
               COALESCE(rr.rate, r.nightly_rate) AS rate
        FROM pms.reservations r JOIN pms.rooms rm ON rm.id = r.room_id
        LEFT JOIN pms.reservation_rates rr ON rr.reservation_id = r.id AND rr.stay_date = @bd
        WHERE r.status = 'checked_in' AND r.arrival <= @bd AND r.departure > @bd
          AND NOT EXISTS (SELECT 1 FROM pms.room_charge_postings p WHERE p.reservation_id = r.id AND p.business_date = @bd)
        ORDER BY rm.number
        """;

    public static async Task<NightAuditPreview> PreviewAsync(Tx tx, bool autoNoShow, bool cancelExpiredOptions = false)
    {
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var blockers = new List<AuditIssue>();
        var warnings = new List<AuditIssue>();
        var closed = await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.night_audits WHERE business_date = @bd)", new { bd });

        var arrivals = await tx.ListAsync<(Guid Id, string No, string Guest)>("""
            SELECT r.id, r.reservation_number, g.first_name || ' ' || g.last_name FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
            WHERE r.status IN ('tentative','confirmed') AND r.arrival <= @bd ORDER BY r.arrival, r.reservation_number
            """, new { bd });
        foreach (var a in arrivals)
        {
            if (autoNoShow) warnings.Add(new("pending_arrival", "warning", $"{a.No} {a.Guest}: no-show yapılacak", a.Id, a.No));
            else blockers.Add(new("pending_arrival", "blocker", $"Gelmeyen rezervasyon: {a.No} {a.Guest} (check-in, iptal veya no-show yapın)", a.Id, a.No));
        }

        var departures = await tx.ListAsync<(Guid Id, string No, string Guest, string? Room)>("""
            SELECT r.id, r.reservation_number, g.first_name || ' ' || g.last_name, rm.number FROM pms.reservations r
            JOIN pms.guests g ON g.id = r.guest_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
            WHERE r.status = 'checked_in' AND r.departure <= @bd ORDER BY rm.number
            """, new { bd });
        foreach (var d in departures)
            blockers.Add(new("pending_departure", "blocker", $"Çıkışı yapılmamış: Oda {d.Room} {d.No} {d.Guest} (check-out yapın veya konaklamayı uzatın)", d.Id, d.No));

        var shifts = await tx.ListAsync<(long No, string User)>("""
            SELECT s.shift_no, u.username FROM pms.cashier_shifts s JOIN pms.users u ON u.id = s.user_id WHERE s.status = 'open'
            """);
        var blockShifts = await PropertyEndpoints.SettingAsync<bool>(tx, "night_audit.block_on_open_shifts");
        foreach (var s in shifts)
            (blockShifts ? blockers : warnings).Add(new("open_shift", blockShifts ? "blocker" : "warning", $"Açık kasa vardiyası: #{s.No} ({s.User})", null, s.No.ToString()));

        var kbs = await tx.ScalarAsync<long>("""
            SELECT count(*) FROM pms.identity_reports WHERE status IN ('needs_data','blocked_configuration','rejected','outcome_unknown','manual_action_required','retry_scheduled')
            """);
        if (kbs > 0)
        {
            var reg = new IntegrationRegistry();
            // KBS adaptörü yoksa bildirimler resmi portaldan manuel yapılmalıdır; PMS günü kapatmayı engellemez ama uyarır.
            (reg.KbsAvailable ? blockers : warnings).Add(new("kbs_pending", reg.KbsAvailable ? "blocker" : "warning",
                $"{kbs} kimlik bildirimi tamamlanmamış (KBS). Resmi sisteme bildirim yapıp referansı kaydedin.", null, null));
        }

        var unbalanced = await tx.ListAsync<(string No, decimal Balance)>("""
            SELECT f.folio_number, sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id
            JOIN pms.reservations r ON r.id = f.reservation_id WHERE r.status IN ('checked_out','cancelled','no_show')
            GROUP BY f.id HAVING sum(l.amount) <> 0 LIMIT 50
            """);
        foreach (var u in unbalanced)
            warnings.Add(new("unbalanced_folio", "warning", $"Kapanmış konaklamada bakiyeli folyo {u.No}: {u.Balance:N2}", null, u.No));

        var options = await tx.ListAsync<(Guid Id, string No, string Guest, DateOnly OptionUntil)>("""
            SELECT r.id, r.reservation_number, g.first_name || ' ' || g.last_name, r.option_until FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
            WHERE r.status = 'tentative' AND r.option_until IS NOT NULL AND r.option_until <= @bd AND r.arrival > @bd
            ORDER BY r.option_until, r.reservation_number
            """, new { bd });
        foreach (var o in options)
            warnings.Add(new("expired_option", "warning", cancelExpiredOptions
                ? $"{o.No} {o.Guest}: opsiyon süresi doldu ({o.OptionUntil:dd.MM.yyyy}), iptal edilecek"
                : $"{o.No} {o.Guest}: opsiyon süresi doldu ({o.OptionUntil:dd.MM.yyyy}). Onaylayın, süreyi uzatın veya iptal edin.", o.Id, o.No));

        var candidates = await tx.ListAsync<ChargeCandidate>(ChargeCandidatesSql, new { bd });
        var zero = candidates.Count(c => c.Rate == 0);
        if (zero > 0) warnings.Add(new("zero_rate", "warning", $"{zero} konaklamanın bu gece fiyatı 0 (ücretsiz/complimentary).", null, null));
        var inHouse = await tx.ScalarAsync<int>("SELECT count(*)::int FROM pms.reservations WHERE status = 'checked_in'");
        if (closed) blockers.Insert(0, new("already_closed", "blocker", "Bu iş günü zaten kapatılmış.", null, null));

        return new NightAuditPreview(bd, bd.AddDays(1), closed, blockers, warnings, candidates.Count(c => c.Rate > 0), candidates.Sum(c => c.Rate),
            inHouse, blockers.Count == 0);
    }

    public sealed record DailyStats(DateOnly BusinessDate, int RoomsTotal, int RoomsOutOfOrder, int RoomsAvailable, int RoomsSold, int Complimentary,
        int GuestsInHouse, int Arrivals, int Departures, int NoShows, int Cancellations, decimal RoomRevenue, decimal OtherRevenue, decimal Payments,
        decimal OccupancyPct, decimal Adr, decimal Revpar);

    public static async Task<DailyStats> ComputeStatisticsAsync(Tx tx, DateOnly bd)
    {
        var s = await tx.OneAsync<(int Total, int Ooo, int Sold, int Comp, int Guests, int Arr, int Dep, int Ns, int Cx, decimal RoomRev, decimal OtherRev, decimal Pay)>("""
            SELECT (SELECT count(*)::int FROM pms.rooms WHERE is_active),
                   (SELECT count(DISTINCT b.room_id)::int FROM pms.room_blocks b JOIN pms.rooms r ON r.id = b.room_id
                     WHERE r.is_active AND b.is_active AND b.kind = 'out_of_order' AND b.date_from <= @bd AND b.date_to > @bd),
                   (SELECT count(*)::int FROM pms.reservations WHERE status IN ('checked_in','checked_out') AND arrival <= @bd AND departure > @bd),
                   (SELECT count(*)::int FROM pms.reservations r JOIN pms.reservation_rates rr ON rr.reservation_id = r.id AND rr.stay_date = @bd
                     WHERE r.status IN ('checked_in','checked_out') AND rr.rate = 0),
                   (SELECT COALESCE(sum(adults + children), 0)::int FROM pms.reservations WHERE status IN ('checked_in','checked_out') AND arrival <= @bd AND departure > @bd),
                   (SELECT count(*)::int FROM pms.reservations WHERE status IN ('checked_in','checked_out') AND arrival = @bd),
                   (SELECT count(*)::int FROM pms.reservations WHERE status = 'checked_out' AND departure = @bd),
                   (SELECT count(*)::int FROM pms.reservations WHERE status = 'no_show' AND no_show_on = @bd),
                   (SELECT count(*)::int FROM pms.reservations WHERE status = 'cancelled' AND cancelled_on = @bd),
                   (SELECT COALESCE(sum(l.amount), 0) FROM pms.folio_lines l LEFT JOIN pms.transaction_codes tc ON tc.id = l.transaction_code_id
                     WHERE l.business_date = @bd AND l.line_type IN ('charge','void','discount','allowance') AND (l.is_room_charge OR tc.category = 'room')),
                   (SELECT COALESCE(sum(l.amount), 0) FROM pms.folio_lines l LEFT JOIN pms.transaction_codes tc ON tc.id = l.transaction_code_id
                     WHERE l.business_date = @bd AND l.line_type = 'charge' AND NOT l.is_room_charge AND COALESCE(tc.category, '') NOT IN ('room', 'tax')
                       AND NOT EXISTS (SELECT 1 FROM pms.folio_lines o WHERE o.id = l.related_line_id AND o.line_type IN ('payment','deposit'))),
                   (SELECT COALESCE(-sum(l.amount), 0) FROM pms.folio_lines l JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
                     WHERE l.business_date = @bd AND l.line_type IN ('payment','deposit','refund') AND pm.kind NOT IN ('city_ledger','company','agency'))
            """, new { bd });
        var available = Math.Max(s.Total - s.Ooo, 0);
        var occ = available == 0 ? 0 : decimal.Round(s.Sold * 100m / available, 2);
        var paidRooms = s.Sold - s.Comp;
        var adr = paidRooms <= 0 ? 0 : decimal.Round(s.RoomRev / paidRooms, 2);
        var revpar = available == 0 ? 0 : decimal.Round(s.RoomRev / available, 2);
        return new DailyStats(bd, s.Total, s.Ooo, available, s.Sold, s.Comp, s.Guests, s.Arr, s.Dep, s.Ns, s.Cx, s.RoomRev, s.OtherRev, s.Pay, occ, adr, revpar);
    }
}
