using System.Security.Cryptography;
using System.Text;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Setup;

public sealed record SetupStatus(bool SetupRequired, bool HasProperty, bool HasUsers);

public sealed record SetupRequest(
    string SetupCode,
    string HotelName,
    string? LegalName,
    string? TaxOffice,
    string? TaxNumber,
    string? Address,
    string? City,
    string? Phone,
    string? Email,
    string TimeZone,
    string Currency,
    DateOnly BusinessDate,
    string AdminUsername,
    string AdminFullName,
    string AdminPassword);

public static class SetupEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/setup").WithTags("Setup");

        g.MapGet("/status", async (Db db) => await GetStatus(db)).AllowAnonymousPms();

        g.MapPost("/", async (SetupRequest req, Db db, PmsPaths paths, RequestContext ctx, ILoggerFactory lf) =>
        {
            var expected = File.Exists(paths.SetupTokenFile) ? File.ReadAllText(paths.SetupTokenFile).Trim() : null;
            if (expected is null || !CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes((req.SetupCode ?? "").Trim().ToUpperInvariant())))
                throw new PmsException(403, "setup_code", "Kurulum kodu hatalı. Kodu sunucudaki PMS Server Manager ekranından alın.");

            var name = Validate.Required(req.HotelName, "Otel adı");
            var tz = Validate.Required(req.TimeZone, "Saat dilimi", 60);
            var currency = Validate.Required(req.Currency, "Para birimi", 3).ToUpperInvariant();
            if (currency.Length != 3 || !currency.All(char.IsAsciiLetterUpper)) throw PmsException.Validation("Para birimi ISO kodu olmalıdır (ör. TRY).");
            var username = Validate.Required(req.AdminUsername, "Kullanıcı adı", 40).ToLowerInvariant();
            var fullName = Validate.Required(req.AdminFullName, "Ad soyad", 120);
            if (PasswordHasher.PolicyError(req.AdminPassword) is { } pe) throw PmsException.Validation(pe);

            await using var c = await db.OpenAsync();
            await using var tx = await c.BeginTransactionAsync(global::System.Data.IsolationLevel.Serializable);
            if (await c.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.users) OR EXISTS (SELECT 1 FROM pms.property)", transaction: tx))
                throw PmsException.Conflict("Kurulum daha önce tamamlanmış.");
            if (!await c.ExecuteScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = @tz)", new { tz }, tx))
                throw PmsException.Validation("Saat dilimi tanınmıyor (ör. Europe/Istanbul).");

            var propertyId = await c.ExecuteScalarAsync<Guid>("""
                INSERT INTO pms.property (name, legal_name, tax_office, tax_number, address, city, phone, email, time_zone, currency, business_date)
                VALUES (@name, @legal, @taxOffice, @taxNumber, @address, @city, @phone, @email, @tz, @currency, @bd) RETURNING id
                """, new
            {
                name, legal = Validate.Optional(req.LegalName), taxOffice = Validate.Optional(req.TaxOffice), taxNumber = Validate.Optional(req.TaxNumber, 20),
                address = Validate.Optional(req.Address), city = Validate.Optional(req.City, 100), phone = Validate.Optional(req.Phone, 40),
                email = Validate.Email(req.Email), tz, currency, bd = req.BusinessDate,
            }, tx);
            var userId = await c.ExecuteScalarAsync<Guid>("""
                INSERT INTO pms.users (username, full_name, password_hash) VALUES (@username, @fullName, @hash) RETURNING id
                """, new { username, fullName, hash = PasswordHasher.Hash(req.AdminPassword) }, tx);
            await c.ExecuteAsync("INSERT INTO pms.user_roles (user_id, role_code) VALUES (@userId, 'SUPER_ADMIN')", new { userId }, tx);
            await c.ExecuteAsync("""
                INSERT INTO pms.audit_log (user_id, username, ip, action, entity_type, entity_id, new_value)
                VALUES (@userId, @username, @ip::inet, 'setup.completed', 'property', @pid, @val::jsonb)
                """, new
            {
                userId, username, ip = ctx.Ip?.ToString(), pid = propertyId.ToString(),
                val = global::System.Text.Json.JsonSerializer.Serialize(new { name, tz, currency, businessDate = req.BusinessDate }),
            }, tx);
            await tx.CommitAsync();
            File.Delete(paths.SetupTokenFile);
            lf.CreateLogger("Setup").LogInformation("İlk kurulum tamamlandı: {Hotel}, yönetici {Username}", name, username);
            return Results.Ok(new { propertyId, userId });
        }).AllowAnonymousPms();
    }

    public static async Task<SetupStatus> GetStatus(Db db)
    {
        await using var c = await db.OpenAsync();
        var r = await c.QuerySingleAsync<(bool HasProperty, bool HasUsers)>(
            "SELECT EXISTS (SELECT 1 FROM pms.property), EXISTS (SELECT 1 FROM pms.users)");
        return new SetupStatus(!r.HasProperty || !r.HasUsers, r.HasProperty, r.HasUsers);
    }
}
