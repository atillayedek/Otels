using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Guests;

public sealed record AccountDto(Guid Id, string? Code, string Name, string? TaxOffice, string? TaxNumber, string? Address, string? City,
    string? Country, string? Phone, string? Email, string? ContactName, decimal? CreditLimit, decimal? CommissionRate, bool IsCityLedger,
    string? Notes, bool IsActive, decimal Balance, int Version);

public sealed record SaveAccountRequest(string? Code, string Name, string? TaxOffice, string? TaxNumber, string? Address, string? City,
    string? Country, string? Phone, string? Email, string? ContactName, decimal? CreditLimit, decimal? CommissionRate, bool IsCityLedger,
    string? Notes, bool IsActive, int? Version);

public sealed record RatePlanDto(Guid Id, string Code, string Name, string MealPlan, string? Description, bool IsActive, int Version);
public sealed record SaveRatePlanRequest(string Code, string Name, string MealPlan, string? Description, bool IsActive, int? Version);
public sealed record RatePriceDto(Guid Id, Guid RatePlanId, Guid RoomTypeId, string RoomTypeCode, DateOnly DateFrom, DateOnly DateTo, decimal Price, int? MinStay);
public sealed record SaveRatePriceRequest(Guid RoomTypeId, DateOnly DateFrom, DateOnly DateTo, decimal Price, int? MinStay);

/// <summary>Şirket ve acente cari kartları (aynı yapı, ayrı tablolar) ve fiyat planları.</summary>
public static class AccountEndpoints
{
    public static void Map(WebApplication app)
    {
        MapAccounts(app, "companies", "company", isAgency: false);
        MapAccounts(app, "agencies", "agency", isAgency: true);
        MapRates(app);
    }

    static void MapAccounts(WebApplication app, string table, string entity, bool isAgency)
    {
        var payer = isAgency ? "agency_id" : "company_id";
        var select = $"""
            SELECT a.id, a.code, a.name, a.tax_office, a.tax_number, a.address, a.city, a.country::text AS country, a.phone, a.email, a.contact_name,
                   a.credit_limit, {(isAgency ? "a.commission_rate" : "NULL::numeric")} AS commission_rate, {(isAgency ? "false" : "a.is_city_ledger")} AS is_city_ledger,
                   a.notes, a.is_active,
                   COALESCE((SELECT sum(l.amount) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id
                             WHERE f.{payer} = a.id AND f.reservation_id IS NULL), 0) AS balance, a.version
            FROM pms.{table} a
            """;
        var g = app.MapGroup($"/api/v1/{table}").WithTags("Accounts");

        g.MapGet("/", (Db db, string? q, bool? active) => db.QueryAsync<AccountDto>(select + """
             WHERE (@q::text IS NULL OR a.name ILIKE '%' || @q || '%' OR a.code ILIKE @q || '%' OR a.tax_number = @q)
               AND (@active::bool IS NULL OR a.is_active = @active)
             ORDER BY a.name LIMIT 1000
            """, new { q = string.IsNullOrWhiteSpace(q) ? null : q.Trim(), active })).RequirePermission("reservation.view");

        g.MapGet("/{id:guid}", async (Guid id, Db db) =>
            await db.QuerySingleOrDefaultAsync<AccountDto>(select + " WHERE a.id = @id", new { id }) ?? throw PmsException.NotFound("Cari kart"))
            .RequirePermission("reservation.view");

        g.MapPost("/", (SaveAccountRequest req, CommandRunner cmd) => cmd.RunAsync($"{entity}.create", req, async tx =>
        {
            var p = Params(req, isAgency);
            var id = await tx.ScalarAsync<Guid>($"""
                INSERT INTO pms.{table} (code, name, tax_office, tax_number, address, city, country, phone, email, contact_name, credit_limit,
                    {(isAgency ? "commission_rate" : "is_city_ledger")}, notes, is_active)
                VALUES (@Code, @Name, @TaxOffice, @TaxNumber, @Address, @City, @Country, @Phone, @Email, @ContactName, @CreditLimit,
                    {(isAgency ? "@CommissionRate" : "@IsCityLedger")}, @Notes, @IsActive) RETURNING id
                """, p);
            await tx.AuditAsync($"{entity}.create", entity, id, null, p);
            tx.Publish(table, id);
            return new { id };
        }, requireKey: false)).RequirePermission("company.manage");

        g.MapPut("/{id:guid}", (Guid id, SaveAccountRequest req, CommandRunner cmd) => cmd.RunAsync($"{entity}.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<AccountDto>(select + " WHERE a.id = @id", new { id }) ?? throw PmsException.NotFound("Cari kart");
            var p = Params(req, isAgency) with { Id = id, Version = req.Version ?? -1 };
            await tx.ExecVersionedAsync($"""
                UPDATE pms.{table} SET code = @Code, name = @Name, tax_office = @TaxOffice, tax_number = @TaxNumber, address = @Address, city = @City,
                    country = @Country, phone = @Phone, email = @Email, contact_name = @ContactName, credit_limit = @CreditLimit,
                    {(isAgency ? "commission_rate = @CommissionRate" : "is_city_ledger = @IsCityLedger")}, notes = @Notes, is_active = @IsActive,
                    updated_at = now(), version = version + 1
                WHERE id = @Id AND version = @Version
                """, p);
            await tx.AuditAsync($"{entity}.update", entity, id, before, p);
            tx.Publish(table, id);
            return new { id };
        }, requireKey: false)).RequirePermission("company.manage");
    }

    sealed record AccountParams(string? Code, string Name, string? TaxOffice, string? TaxNumber, string? Address, string? City, string? Country,
        string? Phone, string? Email, string? ContactName, decimal? CreditLimit, decimal? CommissionRate, bool IsCityLedger, string? Notes, bool IsActive)
    {
        public Guid Id { get; init; }
        public int Version { get; init; }
    }

    static AccountParams Params(SaveAccountRequest r, bool isAgency)
    {
        if (r.CreditLimit is { } cl) Validate.Money(cl, "Kredi limiti", allowZero: true);
        if (isAgency && r.CommissionRate is { } cr && (cr < 0 || cr > 100)) throw PmsException.Validation("Komisyon oranı 0-100 arasında olmalıdır.");
        return new AccountParams(Validate.Optional(r.Code, 20)?.ToUpperInvariant(), Validate.Required(r.Name, "Unvan"), Validate.Optional(r.TaxOffice, 100),
            Validate.Optional(r.TaxNumber, 20), Validate.Optional(r.Address), Validate.Optional(r.City, 100), Validate.Country(r.Country),
            Validate.Optional(r.Phone, 40), Validate.Email(r.Email), Validate.Optional(r.ContactName, 100), r.CreditLimit,
            isAgency ? r.CommissionRate : null, !isAgency && r.IsCityLedger, Validate.Optional(r.Notes, 4000), r.IsActive);
    }

    static void MapRates(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/rate-plans").WithTags("Rates");
        g.MapGet("/", (Db db) => db.QueryAsync<RatePlanDto>("SELECT id, code, name, meal_plan, description, is_active, version FROM pms.rate_plans ORDER BY code"))
            .RequirePermission("reservation.view");
        g.MapPost("/", (SaveRatePlanRequest req, CommandRunner cmd) => cmd.RunAsync("rate_plan.create", req, async tx =>
        {
            var p = RateParams(req);
            var id = await tx.ScalarAsync<Guid>("INSERT INTO pms.rate_plans (code, name, meal_plan, description, is_active) VALUES (@code, @name, @meal, @desc, @active) RETURNING id", p);
            await tx.AuditAsync("rate_plan.create", "rate_plan", id, null, req);
            tx.Publish("rates");
            return new { id };
        }, requireKey: false)).RequirePermission("rate.manage");
        g.MapPut("/{id:guid}", (Guid id, SaveRatePlanRequest req, CommandRunner cmd) => cmd.RunAsync("rate_plan.update", new { id, req }, async tx =>
        {
            var p = RateParams(req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.rate_plans SET code = @code, name = @name, meal_plan = @meal, description = @desc, is_active = @active, version = version + 1
                WHERE id = @id AND version = @version
                """, new { p.code, p.name, p.meal, p.desc, p.active, id, version = req.Version ?? -1 });
            await tx.AuditAsync("rate_plan.update", "rate_plan", id, null, req);
            tx.Publish("rates");
            return new { id };
        }, requireKey: false)).RequirePermission("rate.manage");
        g.MapGet("/{id:guid}/prices", (Guid id, Db db) => db.QueryAsync<RatePriceDto>("""
            SELECT p.id, p.rate_plan_id, p.room_type_id, t.code AS room_type_code, p.date_from, p.date_to, p.price, p.min_stay
            FROM pms.rate_plan_prices p JOIN pms.room_types t ON t.id = p.room_type_id WHERE p.rate_plan_id = @id ORDER BY t.sort_order, p.date_from
            """, new { id })).RequirePermission("reservation.view");
        g.MapPost("/{id:guid}/prices", (Guid id, SaveRatePriceRequest req, CommandRunner cmd) => cmd.RunAsync("rate_price.create", new { id, req }, async tx =>
        {
            Validate.DateRange(req.DateFrom, req.DateTo);
            Validate.Money(req.Price, "Fiyat", allowZero: true);
            if (req.MinStay is < 1) throw PmsException.Validation("Minimum konaklama en az 1 gece olmalıdır.");
            var pid = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.rate_plan_prices (rate_plan_id, room_type_id, date_from, date_to, price, min_stay)
                VALUES (@id, @RoomTypeId, @DateFrom, @DateTo, @Price, @MinStay) RETURNING id
                """, new { id, req.RoomTypeId, req.DateFrom, req.DateTo, req.Price, req.MinStay });
            await tx.AuditAsync("rate_price.create", "rate_plan", id, null, req);
            tx.Publish("rates");
            return new { id = pid };
        }, requireKey: false)).RequirePermission("rate.manage");
        g.MapDelete("/{id:guid}/prices/{priceId:guid}", (Guid id, Guid priceId, CommandRunner cmd) => cmd.RunAsync("rate_price.delete", new { id, priceId }, async tx =>
        {
            var before = await tx.OneOrNullAsync<RatePriceDto>("""
                SELECT p.id, p.rate_plan_id, p.room_type_id, t.code AS room_type_code, p.date_from, p.date_to, p.price, p.min_stay
                FROM pms.rate_plan_prices p JOIN pms.room_types t ON t.id = p.room_type_id WHERE p.id = @priceId AND p.rate_plan_id = @id
                """, new { id, priceId }) ?? throw PmsException.NotFound("Fiyat satırı");
            await tx.ExecAsync("DELETE FROM pms.rate_plan_prices WHERE id = @priceId", new { priceId });
            await tx.AuditAsync("rate_price.delete", "rate_plan", id, before);
            tx.Publish("rates");
            return new { id = priceId };
        }, requireKey: false)).RequirePermission("rate.manage");
    }

    sealed record RateP(string code, string name, string meal, string? desc, bool active);

    static RateP RateParams(SaveRatePlanRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 16).ToUpperInvariant();
        if (!global::System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,16}$")) throw PmsException.Validation("Kod yalnız harf, rakam, - ve _ içerebilir.");
        if (r.MealPlan is not ("RO" or "BB" or "HB" or "FB" or "AI" or "UAI")) throw PmsException.Validation("Geçersiz pansiyon tipi.");
        return new RateP(code, Validate.Required(r.Name, "Ad", 100), r.MealPlan, Validate.Optional(r.Description), r.IsActive);
    }
}
