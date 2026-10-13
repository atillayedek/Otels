using System.Text.Json;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Property;

public sealed record PropertyDto(Guid Id, string Name, string? LegalName, string? TaxOffice, string? TaxNumber, string? Address, string? City,
    string Country, string? Phone, string? Email, string TimeZone, string Currency, DateOnly BusinessDate, TimeOnly CheckInTime,
    TimeOnly CheckOutTime, int Version);

public sealed record UpdatePropertyRequest(string Name, string? LegalName, string? TaxOffice, string? TaxNumber, string? Address, string? City,
    string Country, string? Phone, string? Email, string TimeZone, TimeOnly CheckInTime, TimeOnly CheckOutTime, int Version);

public sealed record SettingDto(string Key, JsonElement Value);

public static class PropertyEndpoints
{
    /// <summary>Uygulamanın tanıdığı ayar anahtarları ve varsayılanları (işletme verisi değildir).</summary>
    public static readonly Dictionary<string, object> SettingDefaults = new()
    {
        ["finance.require_cashier_shift"] = true,
        ["frontoffice.allow_checkin_dirty_room"] = false,
        ["frontoffice.checkout_requires_zero_balance"] = true,
        ["night_audit.block_on_open_shifts"] = false,
        ["night_audit.auto_no_show"] = false,
        ["night_audit.cancel_expired_options"] = false,
        ["finance.currencies"] = new[] { "EUR", "USD", "GBP" },
        ["finance.tcmb_rate_type"] = "BanknoteBuying",
        ["tax.accommodation_rate"] = 0m,
        ["tax.accommodation_included"] = true,
        ["guest.require_identity_on_checkin"] = true,
        ["print.default_printers"] = new Dictionary<string, string>(),
        ["markets"] = Array.Empty<string>(),
        ["segments"] = Array.Empty<string>(),
    };

    public const string PropertySelect = """
        SELECT id, name, legal_name, tax_office, tax_number, address, city, country::text AS country, phone, email, time_zone,
               currency::text AS currency, business_date, check_in_time, check_out_time, version FROM pms.property
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/property").WithTags("Property");

        g.MapGet("/", async (Db db) => await db.QuerySingleOrDefaultAsync<PropertyDto>(PropertySelect + " LIMIT 1")
            ?? throw PmsException.NotFound("Tesis"));

        g.MapPut("/", (UpdatePropertyRequest req, CommandRunner cmd) => cmd.RunAsync("property.update", req, async tx =>
        {
            var before = await tx.OneAsync<PropertyDto>(PropertySelect + " LIMIT 1");
            var tz = Validate.Required(req.TimeZone, "Saat dilimi", 60);
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = @tz)", new { tz }))
                throw PmsException.Validation("Saat dilimi tanınmıyor.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.property SET name = @name, legal_name = @legal, tax_office = @taxOffice, tax_number = @taxNumber, address = @address,
                    city = @city, country = @country, phone = @phone, email = @email, time_zone = @tz, check_in_time = @cin, check_out_time = @cout,
                    updated_at = now(), version = version + 1
                WHERE id = @id AND version = @version
                """, new
            {
                id = before.Id, name = Validate.Required(req.Name, "Otel adı"), legal = Validate.Optional(req.LegalName), taxOffice = Validate.Optional(req.TaxOffice, 100),
                taxNumber = Validate.Optional(req.TaxNumber, 20), address = Validate.Optional(req.Address), city = Validate.Optional(req.City, 100),
                country = Validate.Country(req.Country) ?? "TR", phone = Validate.Optional(req.Phone, 40), email = Validate.Email(req.Email), tz,
                cin = req.CheckInTime, cout = req.CheckOutTime, version = req.Version,
            });
            await tx.AuditAsync("property.update", "property", before.Id, before, req);
            tx.Publish("property");
            return new { id = before.Id };
        }, requireKey: false)).RequirePermission("settings.manage");

        g.MapGet("/settings", async (Db db) =>
        {
            var stored = (await db.QueryAsync<(string Key, string Value)>("SELECT key, value::text FROM pms.settings"))
                .ToDictionary(r => r.Key, r => JsonDocument.Parse(r.Value).RootElement.Clone());
            return SettingDefaults.Select(kv => new SettingDto(kv.Key,
                stored.TryGetValue(kv.Key, out var v) ? v : JsonSerializer.SerializeToElement(kv.Value))).ToList();
        });

        g.MapPut("/settings/{key}", (string key, JsonElement value, CommandRunner cmd) => cmd.RunAsync("settings.update", new { key, value }, async tx =>
        {
            if (!SettingDefaults.TryGetValue(key, out var def)) throw PmsException.Validation("Tanımsız ayar anahtarı.");
            var expectedKind = JsonSerializer.SerializeToElement(def).ValueKind;
            var ok = expectedKind == value.ValueKind || (expectedKind is JsonValueKind.True or JsonValueKind.False && value.ValueKind is JsonValueKind.True or JsonValueKind.False);
            if (!ok) throw PmsException.Validation("Ayar değeri türü geçersiz.");
            await ValidateSettingAsync(tx, key, value);
            var old = await tx.ScalarAsync<string?>("SELECT value::text FROM pms.settings WHERE key = @key", new { key });
            await tx.ExecAsync("""
                INSERT INTO pms.settings (key, value, updated_by) VALUES (@key, @value::jsonb, @uid)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
                """, new { key, value = value.GetRawText(), uid = tx.User.Id });
            await tx.AuditAsync("settings.update", "setting", key, old, value);
            tx.Publish("settings");
            return new { key };
        }, requireKey: false)).RequirePermission("settings.manage");

        g.MapGet("/time-zones", (Db db) => db.QueryAsync<string>(
            "SELECT name FROM pg_timezone_names WHERE name ~ '^(Europe|Asia|Africa|America|Atlantic|Australia|Pacific|Indian)/' ORDER BY name"));
    }

    /// <summary>Türü doğru olsa da anlamca geçersiz ayar değerlerini reddeder.</summary>
    static async Task ValidateSettingAsync(Tx tx, string key, JsonElement value)
    {
        switch (key)
        {
            case "finance.currencies":
                var list = value.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : "").ToList();
                var baseCur = await CurrencyAsync(tx);
                if (list.Count > 12) throw PmsException.Validation("En fazla 12 döviz tanımlanabilir.");
                if (list.Any(c => !global::System.Text.RegularExpressions.Regex.IsMatch(c, "^[A-Z]{3}$")))
                    throw PmsException.Validation("Dövizler 3 harfli büyük ISO kodu olmalıdır (ör. EUR).");
                if (list.Contains(baseCur)) throw PmsException.Validation("Tesis para birimi döviz listesine eklenmez.");
                if (list.Distinct().Count() != list.Count) throw PmsException.Validation("Döviz listesinde tekrar var.");
                break;
            case "finance.tcmb_rate_type":
                if (!Folios.ExchangeRateEndpoints.TcmbRateTypes.ContainsKey(value.GetString() ?? ""))
                    throw PmsException.Validation("Geçersiz TCMB kur türü.");
                break;
            case "tax.accommodation_rate":
                var rate = value.ValueKind == JsonValueKind.Number ? value.GetDecimal() : -1;
                if (rate < 0 || rate > 20 || decimal.Round(rate, 2) != rate)
                    throw PmsException.Validation("Konaklama vergisi oranı 0 ile 20 arasında, en fazla 2 ondalıklı yüzde olmalıdır (kapalı için 0).");
                break;
        }
    }

    public static async Task<DateOnly> BusinessDateAsync(Tx tx, bool forUpdate = false) =>
        await tx.OneAsync<DateOnly>("SELECT business_date FROM pms.property LIMIT 1 " + (forUpdate ? "FOR UPDATE" : "FOR SHARE"));

    public static Task<string> CurrencyAsync(Tx tx) => tx.OneAsync<string>("SELECT currency::text FROM pms.property LIMIT 1");

    public static async Task<T> SettingAsync<T>(Tx tx, string key)
    {
        var raw = await tx.ScalarAsync<string?>("SELECT value::text FROM pms.settings WHERE key = @key", new { key });
        if (raw is not null) return JsonSerializer.Deserialize<T>(raw)!;
        return (T)SettingDefaults[key];
    }
}
