using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Folios;

public sealed record CashMovementDto(Guid Id, Guid ShiftId, string Kind, string Currency, decimal Amount, Guid? GroupId, decimal? ExchangeRate,
    string? Counterpart, string Description, string? Reference, DateTime CreatedAt, string? CreatedBy);
public sealed record CashMovementRequest(string Kind, string? Currency, decimal Amount, string Description, string? Counterpart, string? Reference);
/// <summary>Direction: buy = misafirden döviz alınır, yerel para verilir; sell = yerel para alınır, döviz verilir. Rate boşsa günün kuru.</summary>
public sealed record ExchangeRequest(string Direction, string Currency, decimal ForeignAmount, decimal? Rate, string? Counterpart, string? Note);
public sealed record CashTransferRequest(Guid ToShiftId, string? Currency, decimal Amount, string Description);
public sealed record OpenShiftBrief(Guid Id, long ShiftNo, Guid UserId, string Username, string? FullName, DateTime OpenedAt);

/// <summary>
/// Folyoya bağlı olmayan kasa hareketleri: kasa girişi/çıkışı, döviz bozdurma ve kasalar arası transfer.
/// Hepsi açık vardiyaya yazılır, vardiya kapanışında beklenen nakde (para birimi bazında) eklenir; kayıtlar silinmez.
/// </summary>
public static class CashierMovementEndpoints
{
    internal const string Select = """
        SELECT m.id, m.shift_id, m.kind, m.currency::text AS currency, m.amount, m.group_id, m.exchange_rate, m.counterpart, m.description, m.reference,
               m.created_at, u.username AS created_by
        FROM pms.cashier_movements m LEFT JOIN pms.users u ON u.id = m.created_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/cashier").WithTags("Cashier").RequirePermission("cashier.manage");

        // Transfer için diğer kullanıcıların açık vardiyaları
        g.MapGet("/open-shifts", async (CommandRunner cmd) => await cmd.ReadAsync(tx =>
            tx.ListAsync<OpenShiftBrief>("""
                SELECT s.id, s.shift_no, s.user_id, u.username, u.full_name, s.opened_at FROM pms.cashier_shifts s JOIN pms.users u ON u.id = s.user_id
                WHERE s.status = 'open' AND s.user_id <> @uid ORDER BY u.username
                """, new { uid = tx.User.Id })));

        g.MapPost("/movements", (CashMovementRequest req, CommandRunner cmd) => cmd.RunAsync("cashier.movement", req, async tx =>
        {
            if (req.Kind is not ("cash_in" or "cash_out")) throw PmsException.Validation("Hareket türü kasa girişi veya kasa çıkışı olmalıdır.");
            Validate.Money(req.Amount, "Tutar");
            var shift = await OwnShiftAsync(tx);
            var cur = await CurrencyAsync(tx, req.Currency);
            var amount = req.Kind == "cash_out" ? -req.Amount : req.Amount;
            if (amount < 0) await EnsureCashAsync(tx, shift, cur, -amount);
            var id = await InsertAsync(tx, shift.Id, req.Kind, cur, amount, null, null, Validate.Optional(req.Counterpart, 120, "Kişi / firma"),
                Validate.Required(req.Description, "Açıklama", 300), Validate.Optional(req.Reference, 100, "Belge no"));
            await tx.AuditAsync("cashier." + req.Kind, "cashier_shift", shift.Id, null, new { id, cur, amount, req.Description });
            tx.Publish("cashier");
            return await tx.OneAsync<CashMovementDto>(Select + " WHERE m.id = @id", new { id });
        }));

        g.MapPost("/exchange", (ExchangeRequest req, CommandRunner cmd) => cmd.RunAsync("cashier.exchange", req, async tx =>
        {
            if (req.Direction is not ("buy" or "sell")) throw PmsException.Validation("Yön 'buy' (döviz al) veya 'sell' (döviz sat) olmalıdır.");
            Validate.Money(req.ForeignAmount, "Döviz tutarı");
            var shift = await OwnShiftAsync(tx);
            var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
            var cur = await CurrencyAsync(tx, req.Currency);
            if (cur == baseCur) throw PmsException.Validation($"Bozdurulacak para birimi {baseCur} dışında olmalıdır.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var rate = req.Rate ?? await ExchangeRateEndpoints.RateAsync(tx, cur, bd);
            if (rate <= 0 || decimal.Round(rate, 6) != rate) throw PmsException.Validation("Kur pozitif ve en fazla 6 ondalıklı olmalıdır.");
            var local = decimal.Round(req.ForeignAmount * rate, 2, MidpointRounding.AwayFromZero);
            if (local <= 0) throw PmsException.Validation("Karşılık tutarı sıfırdan büyük olmalıdır.");
            // buy: kasaya döviz girer, yerel para çıkar; sell: tersi
            var (foreignSigned, localSigned) = req.Direction == "buy" ? (req.ForeignAmount, -local) : (-req.ForeignAmount, local);
            if (localSigned < 0) await EnsureCashAsync(tx, shift, baseCur, local);
            else await EnsureCashAsync(tx, shift, cur, req.ForeignAmount);
            var gid = Guid.NewGuid();
            var who = Validate.Optional(req.Counterpart, 120, "Kişi");
            var desc = Validate.Optional(req.Note, 300, "Not") ?? (req.Direction == "buy" ? $"Döviz alış {req.ForeignAmount:N2} {cur}" : $"Döviz satış {req.ForeignAmount:N2} {cur}");
            await InsertAsync(tx, shift.Id, "exchange", cur, foreignSigned, gid, rate, who, desc, null);
            await InsertAsync(tx, shift.Id, "exchange", baseCur, localSigned, gid, rate, who, desc, null);
            await tx.AuditAsync("cashier.exchange", "cashier_shift", shift.Id, null, new { gid, req.Direction, cur, req.ForeignAmount, rate, local });
            tx.Publish("cashier");
            return new { groupId = gid, currency = cur, foreignAmount = req.ForeignAmount, rate, localAmount = local, localCurrency = baseCur };
        }));

        // Kasa transferi: kendi açık vardiyamdan başka bir kullanıcının açık vardiyasına nakit devri (iki satır, aynı grup).
        g.MapPost("/transfer", (CashTransferRequest req, CommandRunner cmd) => cmd.RunAsync("cashier.transfer", req, async tx =>
        {
            Validate.Money(req.Amount, "Tutar");
            var shift = await OwnShiftAsync(tx);
            if (req.ToShiftId == shift.Id) throw PmsException.Validation("Kasa kendisine transfer yapılamaz.");
            var target = await tx.OneOrNullAsync<(Guid Id, string Status, string Username)>("""
                SELECT s.id, s.status, u.username FROM pms.cashier_shifts s JOIN pms.users u ON u.id = s.user_id WHERE s.id = @ToShiftId FOR UPDATE OF s
                """, req);
            if (target == default || target.Status != "open") throw PmsException.Validation("Hedef kasa vardiyası açık değil.");
            var cur = await CurrencyAsync(tx, req.Currency);
            await EnsureCashAsync(tx, shift, cur, req.Amount);
            var desc = Validate.Required(req.Description, "Açıklama", 300);
            var gid = Guid.NewGuid();
            await InsertAsync(tx, shift.Id, "transfer", cur, -req.Amount, gid, null, target.Username, desc, null);
            await InsertAsync(tx, target.Id, "transfer", cur, req.Amount, gid, null, tx.User.Username, desc, null);
            await tx.AuditAsync("cashier.transfer", "cashier_shift", shift.Id, null, new { gid, to = target.Id, cur, req.Amount, desc });
            tx.Publish("cashier");
            return new { groupId = gid };
        }));
    }

    static async Task<ShiftDto> OwnShiftAsync(Tx tx) =>
        await tx.OneOrNullAsync<ShiftDto>(FolioEndpoints.ShiftSelect + " WHERE s.user_id = @uid AND s.status = 'open' FOR UPDATE OF s", new { uid = tx.User.Id })
        ?? throw PmsException.Validation("Açık kasa vardiyanız yok. Önce Ön Kasa → Kasa Vardiyası ekranından kasayı açın.");

    static async Task<string> CurrencyAsync(Tx tx, string? currency)
    {
        var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
        var cur = string.IsNullOrWhiteSpace(currency) ? baseCur : currency.Trim().ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(cur, "^[A-Z]{3}$")) throw PmsException.Validation("Para birimi 3 harfli kod olmalıdır (TRY, EUR, USD...).");
        return cur;
    }

    /// <summary>Kasadan çıkacak tutar o para birimindeki beklenen nakdi aşamaz (eksi kasa oluşmasın).</summary>
    static async Task EnsureCashAsync(Tx tx, ShiftDto shift, string currency, decimal outgoing)
    {
        var report = await FolioEndpoints.ShiftReportAsync(tx, shift);
        var have = report.Cash.FirstOrDefault(c => c.Currency == currency)?.Expected ?? 0;
        if (have < outgoing) throw PmsException.Validation($"Kasada yeterli {currency} yok: beklenen {have:N2}, çıkacak {outgoing:N2}.");
    }

    static Task<Guid> InsertAsync(Tx tx, Guid shiftId, string kind, string currency, decimal amount, Guid? groupId, decimal? rate, string? counterpart,
        string description, string? reference) =>
        tx.ScalarAsync<Guid>("""
            INSERT INTO pms.cashier_movements (shift_id, kind, currency, amount, group_id, exchange_rate, counterpart, description, reference, created_by)
            VALUES (@shiftId, @kind, @currency, @amount, @groupId, @rate, @counterpart, @description, @reference, @uid) RETURNING id
            """, new { shiftId, kind, currency, amount, groupId, rate, counterpart, description, reference, uid = tx.User.Id });
}
