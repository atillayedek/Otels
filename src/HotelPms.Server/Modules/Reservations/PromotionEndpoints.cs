using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Reservations;

public sealed record PromotionDto(Guid Id, string Code, string Name, string Kind, decimal? DiscountPct, int? StayNights, int? PayNights, int? MinDaysBefore,
    int MinNights, DateOnly StayFrom, DateOnly StayTo, DateOnly? BookFrom, DateOnly? BookTo, Guid? RoomTypeId, string? RoomTypeCode, Guid? RatePlanId,
    string? RatePlanCode, bool IsActive, int UsedCount, int Version);
public sealed record SavePromotionRequest(string Code, string Name, string Kind, decimal? DiscountPct, int? StayNights, int? PayNights, int? MinDaysBefore,
    int? MinNights, DateOnly StayFrom, DateOnly StayTo, DateOnly? BookFrom, DateOnly? BookTo, Guid? RoomTypeId, Guid? RatePlanId, bool IsActive, int? Version);
public sealed record AppliedPromotion(Guid Id, string Name, decimal Saving);

/// <summary>Aksiyon ve indirimler: tanımlama ve fiyat hesabında uygulanması.</summary>
public static class PromotionEndpoints
{
    const string Select = """
        SELECT p.id, p.code, p.name, p.kind, p.discount_pct, p.stay_nights, p.pay_nights, p.min_days_before, p.min_nights, p.stay_from, p.stay_to,
               p.book_from, p.book_to, p.room_type_id, t.code AS room_type_code, p.rate_plan_id, rp.code AS rate_plan_code, p.is_active,
               (SELECT count(*)::int FROM pms.reservations r WHERE r.promotion_id = p.id AND r.status <> 'cancelled') AS used_count, p.version
        FROM pms.promotions p LEFT JOIN pms.room_types t ON t.id = p.room_type_id LEFT JOIN pms.rate_plans rp ON rp.id = p.rate_plan_id
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/promotions").WithTags("Rates");
        g.MapGet("/", async (CommandRunner cmd) => await cmd.ReadAsync(tx =>
            tx.ListAsync<PromotionDto>(Select + " ORDER BY p.is_active DESC, p.stay_from DESC, p.code"))).RequirePermission("reservation.view");

        g.MapPost("/", (SavePromotionRequest req, CommandRunner cmd) => cmd.RunAsync("promotion.create", req, async tx =>
        {
            var v = Check(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.promotions (code, name, kind, discount_pct, stay_nights, pay_nights, min_days_before, min_nights, stay_from, stay_to,
                    book_from, book_to, room_type_id, rate_plan_id, is_active, created_by)
                VALUES (@Code, @Name, @Kind, @DiscountPct, @StayNights, @PayNights, @MinDaysBefore, @MinNights, @StayFrom, @StayTo,
                    @BookFrom, @BookTo, @RoomTypeId, @RatePlanId, @IsActive, @uid) RETURNING id
                """, new { v.Code, v.Name, v.Kind, v.DiscountPct, v.StayNights, v.PayNights, v.MinDaysBefore, v.MinNights, v.StayFrom, v.StayTo,
                    v.BookFrom, v.BookTo, v.RoomTypeId, v.RatePlanId, v.IsActive, uid = tx.User.Id });
            await tx.AuditAsync("promotion.create", "promotion", id, null, v);
            tx.Publish("rates", id);
            return await tx.OneAsync<PromotionDto>(Select + " WHERE p.id = @id", new { id });
        })).RequirePermission("rate.manage");

        g.MapPut("/{id:guid}", (Guid id, SavePromotionRequest req, CommandRunner cmd) => cmd.RunAsync("promotion.update", new { id, req }, async tx =>
        {
            var v = Check(req);
            var n = await tx.ExecAsync("""
                UPDATE pms.promotions SET code = @Code, name = @Name, kind = @Kind, discount_pct = @DiscountPct, stay_nights = @StayNights, pay_nights = @PayNights,
                    min_days_before = @MinDaysBefore, min_nights = @MinNights, stay_from = @StayFrom, stay_to = @StayTo, book_from = @BookFrom, book_to = @BookTo,
                    room_type_id = @RoomTypeId, rate_plan_id = @RatePlanId, is_active = @IsActive, version = version + 1
                WHERE id = @id AND version = @Version
                """, new { id, v.Code, v.Name, v.Kind, v.DiscountPct, v.StayNights, v.PayNights, v.MinDaysBefore, v.MinNights, v.StayFrom, v.StayTo,
                    v.BookFrom, v.BookTo, v.RoomTypeId, v.RatePlanId, v.IsActive, Version = req.Version ?? -1 });
            if (n == 0) throw PmsException.Concurrency();
            await tx.AuditAsync("promotion.update", "promotion", id, null, v);
            tx.Publish("rates", id);
            return await tx.OneAsync<PromotionDto>(Select + " WHERE p.id = @id", new { id });
        }, requireKey: false)).RequirePermission("rate.manage");
    }

    static SavePromotionRequest Check(SavePromotionRequest r)
    {
        var code = (r.Code ?? "").Trim().ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{2,20}$")) throw PmsException.Validation("Kod 2-20 karakter; harf, rakam, - veya _ olmalıdır.");
        var name = Validate.Required(r.Name, "Ad", 120);
        if (r.StayTo < r.StayFrom) throw PmsException.Validation("Konaklama bitiş tarihi başlangıçtan önce olamaz.");
        if (r.BookFrom is { } bf && r.BookTo is { } bt && bt < bf) throw PmsException.Validation("Satış bitiş tarihi başlangıçtan önce olamaz.");
        var minNights = r.MinNights ?? 1;
        if (minNights is < 1 or > 365) throw PmsException.Validation("En az gece 1-365 arasında olmalıdır.");
        switch (r.Kind)
        {
            case "discount":
            case "early_booking":
                if (r.DiscountPct is not ({ } p and > 0 and < 100)) throw PmsException.Validation("İndirim yüzdesi 0 ile 100 arasında olmalıdır.");
                if (r.Kind == "early_booking" && r.MinDaysBefore is not (>= 1 and <= 730)) throw PmsException.Validation("Erken rezervasyon için en az kaç gün önce alınacağını girin (1-730).");
                return r with { Code = code, Name = name, MinNights = minNights, StayNights = null, PayNights = null, MinDaysBefore = r.Kind == "early_booking" ? r.MinDaysBefore : null };
            case "stay_pay":
                if (r.StayNights is not (>= 2 and <= 60) || r.PayNights is not ({ } pn and >= 1) || pn >= r.StayNights)
                    throw PmsException.Validation("Kal/öde kampanyasında kalınan gece ödenen geceden fazla olmalıdır (ör. 7 kal 6 öde).");
                return r with { Code = code, Name = name, MinNights = Math.Max(minNights, r.StayNights!.Value), DiscountPct = null, MinDaysBefore = null };
            default: throw PmsException.Validation("Kampanya türü indirim, erken rezervasyon veya kal/öde olmalıdır.");
        }
    }

    /// <summary>
    /// Uygun kampanyalardan en çok indirim sağlayanı gecelik fiyatlara uygular. <paramref name="bookedOn"/> rezervasyonun alındığı iş günüdür
    /// (erken rezervasyon ve satış tarihi aralığı buna göre değerlendirilir).
    /// </summary>
    public static async Task<(List<NightRate> Nights, AppliedPromotion? Applied)> ApplyAsync(Tx tx, Guid roomTypeId, Guid? ratePlanId, DateOnly arrival,
        DateOnly departure, List<NightRate> nights, DateOnly bookedOn)
    {
        if (nights.Count == 0) return (nights, null);
        var promos = await tx.ListAsync<PromotionDto>(Select + """
             WHERE p.is_active AND p.stay_from < @departure AND p.stay_to >= @arrival
               AND (p.room_type_id IS NULL OR p.room_type_id = @roomTypeId) AND (p.rate_plan_id IS NULL OR p.rate_plan_id = @ratePlanId)
               AND (p.book_from IS NULL OR p.book_from <= @bookedOn) AND (p.book_to IS NULL OR p.book_to >= @bookedOn)
               AND p.min_nights <= @count
            """, new { roomTypeId, ratePlanId, arrival, departure, bookedOn, count = nights.Count });
        (List<NightRate> Nights, AppliedPromotion? Applied) best = (nights, null);
        foreach (var p in promos)
        {
            if (p.Kind == "early_booking" && arrival.DayNumber - bookedOn.DayNumber < p.MinDaysBefore) continue;
            bool InStay(DateOnly d) => d >= p.StayFrom && d <= p.StayTo;
            List<NightRate> result;
            if (p.Kind == "stay_pay")
            {
                var eligible = nights.Where(n => InStay(n.Date)).OrderBy(n => n.Rate).ThenBy(n => n.Date).ToList();
                var free = eligible.Count / p.StayNights!.Value * (p.StayNights.Value - p.PayNights!.Value);
                if (free == 0) continue;
                var freeDates = eligible.Take(free).Select(n => n.Date).ToHashSet();
                result = nights.Select(n => freeDates.Contains(n.Date) ? n with { Rate = 0 } : n).ToList();
            }
            else
            {
                if (!nights.Any(n => InStay(n.Date))) continue;
                result = nights.Select(n => InStay(n.Date)
                    ? n with { Rate = decimal.Round(n.Rate * (100 - p.DiscountPct!.Value) / 100, 2, MidpointRounding.AwayFromZero) } : n).ToList();
            }
            var saving = nights.Sum(n => n.Rate) - result.Sum(n => n.Rate);
            if (saving > 0 && saving > (best.Applied?.Saving ?? 0)) best = (result, new AppliedPromotion(p.Id, p.Name, saving));
        }
        return best;
    }
}
