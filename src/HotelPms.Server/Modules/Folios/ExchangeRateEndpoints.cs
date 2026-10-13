using System.Globalization;
using System.Xml.Linq;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Folios;

public sealed record ExchangeRateDto(string Currency, DateOnly RateDate, decimal Rate, string Source, string? Username, DateTime CreatedAt);
public sealed record ExchangeRatesView(string BaseCurrency, DateOnly BusinessDate, IReadOnlyList<string> Currencies, IReadOnlyList<ExchangeRateDto> Rates,
    bool TcmbAvailable);
public sealed record SaveExchangeRateRequest(decimal Rate);
public sealed record TcmbImportResult(DateOnly RateDate, string BulletinDate, string RateType, IReadOnlyList<ExchangeRateDto> Rates, IReadOnlyList<string> Missing);

/// <summary>
/// Günlük döviz kurları. Kur, 1 birim dövizin tesis para birimi karşılığıdır ve iş gününe kaydedilir.
/// TCMB'den alma isteğe bağlıdır ve yalnız tesis para birimi TRY ise kullanılabilir (TCMB kurları TL karşılığıdır).
/// </summary>
public static class ExchangeRateEndpoints
{
    /// <summary>İş gününde kur yoksa en fazla bu kadar gün önceki kur kullanılır (hafta sonu/bayram); daha eskisi reddedilir.</summary>
    /// <summary>Kullanılabilecek en eski kur (gün). TCMB hafta sonu ve resmî tatillerde kur yayımlamaz; Ramazan/Kurban Bayramı
    /// köprüleriyle 9 güne varan aralar olur. Bu süreyi aşan kurla işlem yapılmaz.</summary>
    public const int MaxRateAgeDays = 10;
    /// <summary>Bu süreden eski kur kullanılırken gece denetiminde uyarı verilir.</summary>
    public const int FreshRateDays = 3;
    const string TcmbUrl = "https://www.tcmb.gov.tr/kurlar/today.xml";
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    public static readonly Dictionary<string, string> TcmbRateTypes = new()
    {
        ["BanknoteBuying"] = "Efektif alış",
        ["BanknoteSelling"] = "Efektif satış",
        ["ForexBuying"] = "Döviz alış",
        ["ForexSelling"] = "Döviz satış",
    };

    const string LatestSql = """
        SELECT DISTINCT ON (e.currency) e.currency::text AS currency, e.rate_date, e.rate, e.source, u.username, e.created_at
        FROM pms.exchange_rates e LEFT JOIN pms.users u ON u.id = e.created_by
        WHERE e.rate_date <= @bd
        ORDER BY e.currency, e.rate_date DESC
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/exchange-rates").WithTags("ExchangeRates");

        g.MapGet("/", (CommandRunner cmd) => cmd.ReadAsync(async tx =>
        {
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
            var currencies = await PropertyEndpoints.SettingAsync<string[]>(tx, "finance.currencies");
            var rates = await tx.ListAsync<ExchangeRateDto>(LatestSql, new { bd });
            return new ExchangeRatesView(baseCur, bd, currencies, rates, baseCur == "TRY");
        })).RequireAnyPermission("folio.view", "pos.settle");

        g.MapGet("/history", (Db db, string currency) => db.QueryAsync<ExchangeRateDto>("""
            SELECT e.currency::text AS currency, e.rate_date, e.rate, e.source, u.username, e.created_at
            FROM pms.exchange_rates e LEFT JOIN pms.users u ON u.id = e.created_by
            WHERE e.currency = @currency ORDER BY e.rate_date DESC LIMIT 120
            """, new { currency = currency.ToUpperInvariant() })).RequirePermission("folio.view");

        g.MapPut("/{currency}", (string currency, SaveExchangeRateRequest req, CommandRunner cmd) => cmd.RunAsync("exchange_rate.save", new { currency, req }, async tx =>
        {
            var cur = await ValidateCurrencyAsync(tx, currency);
            if (req.Rate <= 0 || req.Rate > 1_000_000 || decimal.Round(req.Rate, 6) != req.Rate)
                throw PmsException.Validation("Kur pozitif olmalı ve en fazla 6 ondalık içermelidir.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var old = await UpsertAsync(tx, cur, bd, req.Rate, "manual");
            await tx.AuditAsync("exchange_rate.save", "exchange_rate", $"{cur}:{bd:yyyy-MM-dd}", old is null ? null : new { rate = old }, new { rate = req.Rate });
            tx.Publish("exchange_rates");
            return new { currency = cur, rateDate = bd, rate = req.Rate };
        }, requireKey: false)).RequirePermission("exchange_rate.manage");

        g.MapPost("/tcmb", async (CommandRunner cmd, Db db) =>
        {
            // Kur dosyası işlem (transaction) dışında indirilir; veritabanı kilidi ağ beklemesi süresince tutulmaz.
            XDocument doc;
            try
            {
                var xml = await Http.GetStringAsync(TcmbUrl);
                doc = XDocument.Parse(xml);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Xml.XmlException)
            {
                throw new PmsException(502, "tcmb_unreachable",
                    "TCMB kur dosyasına ulaşılamadı. Sunucunun internet bağlantısını kontrol edin veya kurları elle girin.");
            }
            return await cmd.RunAsync("exchange_rate.tcmb", null, async tx =>
            {
                var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
                if (baseCur != "TRY") throw PmsException.Validation("TCMB kurları TL karşılığıdır; tesis para birimi TRY değilken kullanılamaz.");
                var rateType = await PropertyEndpoints.SettingAsync<string>(tx, "finance.tcmb_rate_type");
                if (!TcmbRateTypes.ContainsKey(rateType)) rateType = "BanknoteBuying";
                var currencies = await PropertyEndpoints.SettingAsync<string[]>(tx, "finance.currencies");
                var bd = await PropertyEndpoints.BusinessDateAsync(tx);
                var bulletin = doc.Root?.Attribute("Tarih")?.Value ?? "";
                var saved = new List<ExchangeRateDto>();
                var missing = new List<string>();
                foreach (var cur in currencies)
                {
                    var node = doc.Root?.Elements("Currency").FirstOrDefault(e => (string?)e.Attribute("CurrencyCode") == cur);
                    var raw = node?.Element(rateType)?.Value;
                    var unitRaw = node?.Element("Unit")?.Value;
                    if (string.IsNullOrWhiteSpace(raw) || !decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var value) || value <= 0
                        || !int.TryParse(unitRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var unit) || unit <= 0)
                    {
                        missing.Add(cur);
                        continue;
                    }
                    var rate = decimal.Round(value / unit, 6, MidpointRounding.AwayFromZero);
                    await UpsertAsync(tx, cur, bd, rate, "tcmb");
                    saved.Add(new ExchangeRateDto(cur, bd, rate, "tcmb", tx.User.Username, DateTime.UtcNow));
                }
                if (saved.Count == 0) throw PmsException.Validation("TCMB dosyasında tanımlı dövizlerin hiçbiri için kur bulunamadı.");
                await tx.AuditAsync("exchange_rate.tcmb", "exchange_rate", bd.ToString("yyyy-MM-dd"), null,
                    new { bulletin, rateType, rates = saved.Select(s => new { s.Currency, s.Rate }), missing });
                tx.Publish("exchange_rates");
                return new TcmbImportResult(bd, bulletin, TcmbRateTypes[rateType], saved, missing);
            }, requireKey: false);
        }).RequirePermission("exchange_rate.manage");
    }

    static async Task<string> ValidateCurrencyAsync(Tx tx, string currency)
    {
        var cur = (currency ?? "").Trim().ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(cur, "^[A-Z]{3}$")) throw PmsException.Validation("Para birimi 3 harfli ISO kodu olmalıdır (ör. EUR).");
        if (cur == await PropertyEndpoints.CurrencyAsync(tx)) throw PmsException.Validation("Tesis para birimi için kur girilmez.");
        return cur;
    }

    static Task<decimal?> UpsertAsync(Tx tx, string currency, DateOnly bd, decimal rate, string source) => tx.ScalarAsync<decimal?>("""
        WITH old AS (SELECT rate FROM pms.exchange_rates WHERE currency = @currency AND rate_date = @bd),
        up AS (
            INSERT INTO pms.exchange_rates (currency, rate_date, rate, source, created_by) VALUES (@currency, @bd, @rate, @source, @uid)
            ON CONFLICT (currency, rate_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, created_by = EXCLUDED.created_by, created_at = now()
        )
        SELECT rate FROM old
        """, new { currency, bd, rate, source, uid = tx.User.Id });

    /// <summary>1 birim <paramref name="currency"/> = ? tesis para birimi. Tesis para birimi için 1.</summary>
    public static async Task<decimal> RateAsync(Tx tx, string currency, DateOnly bd)
    {
        if (currency == await PropertyEndpoints.CurrencyAsync(tx)) return 1m;
        var r = await tx.OneOrNullAsync<(DateOnly RateDate, decimal Rate)>(
            "SELECT rate_date, rate FROM pms.exchange_rates WHERE currency = @currency AND rate_date <= @bd ORDER BY rate_date DESC LIMIT 1", new { currency, bd });
        if (r == default)
            throw PmsException.Validation($"{currency} için kur girilmemiş. Ön Kasa → Döviz Kurları ekranından bugünün kurunu girin.");
        if (r.RateDate < bd.AddDays(-MaxRateAgeDays))
            throw PmsException.Validation($"{currency} için son kur {r.RateDate:dd.MM.yyyy} tarihli. Ön Kasa → Döviz Kurları ekranından güncel kuru girin.");
        return r.Rate;
    }

    /// <summary>1 birim <paramref name="from"/> = ? <paramref name="to"/> (tesis para birimi üzerinden çapraz kur).</summary>
    public static async Task<decimal> CrossRateAsync(Tx tx, string from, string to, DateOnly bd)
    {
        var f = await RateAsync(tx, from, bd);
        var t = await RateAsync(tx, to, bd);
        return decimal.Round(f / t, 6, MidpointRounding.AwayFromZero);
    }
}
