using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Guests;

public sealed record GuestDto(Guid Id, string FirstName, string LastName, string? Gender, DateOnly? BirthDate, string? BirthPlace,
    string? FatherName, string? MotherName, string? Nationality, string? IdentityType, string? IdentityNumber, string? IdentityCountry,
    DateOnly? IdentityExpiry, string? Phone, string? Email, string? Address, string? City, string? Country, string? TaxOffice, string? TaxNumber, Guid? CompanyId, string? CompanyName,
    string? Notes, string? Preferences, bool IsVip, string? VipLevel, bool IsBlacklisted, string? BlacklistReason, bool KvkkConsent,
    DateTime? KvkkConsentAt, bool MarketingConsent, DateTime CreatedAt, string? MigrationSource, int Version)
{
    public GuestDto Masked() => this with { IdentityNumber = Validate.Mask(IdentityNumber) };
}

public sealed record GuestListItem(Guid Id, string FirstName, string LastName, string? Nationality, string? IdentityNumber, string? Phone,
    string? Email, bool IsVip, bool IsBlacklisted, int StayCount, DateOnly? LastStay);

public sealed record SaveGuestRequest(string FirstName, string LastName, string? Gender, DateOnly? BirthDate, string? BirthPlace,
    string? FatherName, string? MotherName, string? Nationality, string? IdentityType, string? IdentityNumber, string? IdentityCountry,
    DateOnly? IdentityExpiry, string? Phone, string? Email, string? Address, string? City, string? Country, string? TaxOffice, string? TaxNumber, Guid? CompanyId,
    string? Notes, string? Preferences, bool IsVip, string? VipLevel, bool KvkkConsent, bool MarketingConsent, int? Version);

public sealed record BlacklistRequest(bool IsBlacklisted, string? Reason, int Version);

public sealed record GuestStayDto(Guid Id, string ReservationNumber, string Status, DateOnly Arrival, DateOnly Departure, string? RoomNumber,
    string RoomTypeCode, decimal NightlyRate, string Currency);

public sealed record GuestFolioDto(Guid Id, string FolioNumber, string Status, decimal Balance, decimal TotalCharges, decimal TotalPayments);

public sealed record GuestProfileDto(GuestDto Guest, IReadOnlyList<GuestStayDto> Stays, IReadOnlyList<GuestFolioDto> Folios, decimal TotalRevenue);

public static class GuestEndpoints
{
    public const string GuestSelect = """
        SELECT g.id, g.first_name, g.last_name, g.gender, g.birth_date, g.birth_place, g.father_name, g.mother_name, g.nationality::text AS nationality,
               g.identity_type, g.identity_number, g.identity_country::text AS identity_country, g.identity_expiry, g.phone, g.email, g.address, g.city,
               g.country::text AS country, g.tax_office, g.tax_number, g.company_id, c.name AS company_name, g.notes, g.preferences, g.is_vip, g.vip_level, g.is_blacklisted,
               g.blacklist_reason, g.kvkk_consent, g.kvkk_consent_at, g.marketing_consent, g.created_at, g.migration_source, g.version
        FROM pms.guests g LEFT JOIN pms.companies c ON c.id = g.company_id
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/guests").WithTags("Guests").RequirePermission("guest.view");

        g.MapGet("/", async (Db db, RequestContext ctx, string? q, bool? vip, bool? blacklisted, int page = 1, int pageSize = 50) =>
        {
            var p = new PageRequest(page, pageSize);
            var term = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
            var digits = term is null ? null : Validate.NormalizePhone(term);
            const string where = """
                WHERE (@term::text IS NULL
                       OR (g.first_name || ' ' || g.last_name) ILIKE '%' || @term || '%'
                       OR (g.last_name || ' ' || g.first_name) ILIKE '%' || @term || '%'
                       OR g.identity_number = @term OR lower(g.email) = lower(@term)
                       OR (@digits::text IS NOT NULL AND length(@digits) >= 7 AND g.phone_normalized LIKE '%' || @digits || '%'))
                  AND (@vip::bool IS NULL OR g.is_vip = @vip)
                  AND (@bl::bool IS NULL OR g.is_blacklisted = @bl)
                """;
            var prm = new { term, digits, vip, bl = blacklisted, p.Limit, p.Offset };
            var total = await db.ScalarAsync<long>("SELECT count(*) FROM pms.guests g " + where, prm);
            var items = await db.QueryAsync<GuestListItem>($"""
                SELECT g.id, g.first_name, g.last_name, g.nationality::text AS nationality, g.identity_number, g.phone, g.email, g.is_vip, g.is_blacklisted,
                       (SELECT count(*)::int FROM pms.reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in','checked_out')) AS stay_count,
                       (SELECT max(r.arrival) FROM pms.reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in','checked_out')) AS last_stay
                FROM pms.guests g {where}
                ORDER BY g.last_name, g.first_name LIMIT @Limit OFFSET @Offset
                """, prm);
            var canSee = ctx.RequireUser().Has("guest.identity.view");
            return new Paged<GuestListItem>(canSee ? items : items.Select(i => i with { IdentityNumber = Validate.Mask(i.IdentityNumber) }).ToList(), total, page, p.Limit);
        });

        g.MapGet("/{id:guid}", async (Guid id, Db db, RequestContext ctx) =>
        {
            var guest = await db.QuerySingleOrDefaultAsync<GuestDto>(GuestSelect + " WHERE g.id = @id", new { id }) ?? throw PmsException.NotFound("Misafir");
            var user = ctx.RequireUser();
            if (!user.Has("guest.identity.view")) guest = guest.Masked();
            var stays = await db.QueryAsync<GuestStayDto>("""
                SELECT r.id, r.reservation_number, r.status, r.arrival, r.departure, rm.number AS room_number, t.code AS room_type_code, r.nightly_rate, r.currency::text AS currency
                FROM pms.reservations r JOIN pms.room_types t ON t.id = r.room_type_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                WHERE r.guest_id = @id OR r.id IN (SELECT reservation_id FROM pms.reservation_guests WHERE guest_id = @id)
                ORDER BY r.arrival DESC LIMIT 200
                """, new { id });
            IReadOnlyList<GuestFolioDto> folios = [];
            decimal revenue = 0;
            if (user.Has("folio.view"))
            {
                folios = await db.QueryAsync<GuestFolioDto>("""
                    SELECT f.id, f.folio_number, f.status, COALESCE(sum(l.amount), 0) AS balance,
                           COALESCE(sum(l.amount) FILTER (WHERE l.line_type IN ('charge')), 0) AS total_charges,
                           COALESCE(-sum(l.amount) FILTER (WHERE l.line_type IN ('payment','deposit')), 0) AS total_payments
                    FROM pms.folios f LEFT JOIN pms.folio_lines l ON l.folio_id = f.id
                    WHERE f.guest_id = @id GROUP BY f.id ORDER BY f.created_at DESC LIMIT 200
                    """, new { id });
                revenue = folios.Sum(f => f.TotalCharges);
            }
            return new GuestProfileDto(guest, stays, folios, revenue);
        });

        g.MapPost("/", (SaveGuestRequest req, CommandRunner cmd) => cmd.RunAsync("guest.create", req, async tx =>
            new { id = await CreateGuestAsync(tx, req) }, requireKey: false)).RequirePermission("guest.edit");

        g.MapPut("/{id:guid}", (Guid id, SaveGuestRequest req, CommandRunner cmd, RequestContext ctx) => cmd.RunAsync("guest.update", new { id, req }, async tx =>
        {
            var before = await tx.OneOrNullAsync<GuestDto>(GuestSelect + " WHERE g.id = @id", new { id }) ?? throw PmsException.NotFound("Misafir");
            var p = Params(req);
            // Kimlik görme yetkisi olmayan kullanıcı maskeli değeri geri gönderirse gerçek değer korunur.
            if (!ctx.RequireUser().Has("guest.identity.view") && p.IdentityNumber is { } idn && idn.Contains('*'))
                p = p with { IdentityNumber = before.IdentityNumber };
            await tx.ExecVersionedAsync("""
                UPDATE pms.guests SET first_name = @FirstName, last_name = @LastName, gender = @Gender, birth_date = @BirthDate, birth_place = @BirthPlace,
                    father_name = @FatherName, mother_name = @MotherName, nationality = @Nationality, identity_type = @IdentityType,
                    identity_number = @IdentityNumber, identity_country = @IdentityCountry, identity_expiry = @IdentityExpiry, phone = @Phone,
                    phone_normalized = @PhoneNormalized, email = @Email, address = @Address, city = @City, country = @Country, tax_office = @TaxOffice, tax_number = @TaxNumber, company_id = @CompanyId,
                    notes = @Notes, preferences = @Preferences, is_vip = @IsVip, vip_level = @VipLevel,
                    kvkk_consent = @KvkkConsent, kvkk_consent_at = CASE WHEN @KvkkConsent AND NOT kvkk_consent THEN now() WHEN NOT @KvkkConsent THEN NULL ELSE kvkk_consent_at END,
                    marketing_consent = @MarketingConsent, updated_at = now(), version = version + 1
                WHERE id = @Id AND version = @Version
                """, p with { Id = id, Version = req.Version ?? -1 });
            await tx.AuditAsync("guest.update", "guest", id, before.Masked(), p with { IdentityNumber = Validate.Mask(p.IdentityNumber) });
            tx.Publish("guests", id);
            return new { id };
        }, requireKey: false)).RequirePermission("guest.edit");

        g.MapPost("/{id:guid}/blacklist", (Guid id, BlacklistRequest req, CommandRunner cmd) => cmd.RunAsync("guest.blacklist", new { id, req }, async tx =>
        {
            var reason = req.IsBlacklisted ? Validate.Required(req.Reason, "Kara liste gerekçesi", 500) : null;
            await tx.ExecVersionedAsync("""
                UPDATE pms.guests SET is_blacklisted = @bl, blacklist_reason = @reason, updated_at = now(), version = version + 1
                WHERE id = @id AND version = @Version
                """, new { id, bl = req.IsBlacklisted, reason, req.Version });
            await tx.AuditAsync(req.IsBlacklisted ? "guest.blacklist_add" : "guest.blacklist_remove", "guest", id, null, null, reason);
            tx.Publish("guests", id);
            return new { id };
        }, requireKey: false)).RequirePermission("guest.blacklist");
    }

    public static async Task<Guid> CreateGuestAsync(Tx tx, SaveGuestRequest req)
    {
        var p = Params(req);
        var id = await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.guests (first_name, last_name, gender, birth_date, birth_place, father_name, mother_name, nationality, identity_type,
                identity_number, identity_country, identity_expiry, phone, phone_normalized, email, address, city, country, tax_office, tax_number, company_id, notes,
                preferences, is_vip, vip_level, kvkk_consent, kvkk_consent_at, marketing_consent, created_by)
            VALUES (@FirstName, @LastName, @Gender, @BirthDate, @BirthPlace, @FatherName, @MotherName, @Nationality, @IdentityType,
                @IdentityNumber, @IdentityCountry, @IdentityExpiry, @Phone, @PhoneNormalized, @Email, @Address, @City, @Country, @TaxOffice, @TaxNumber, @CompanyId, @Notes,
                @Preferences, @IsVip, @VipLevel, @KvkkConsent, CASE WHEN @KvkkConsent THEN now() END, @MarketingConsent, @Uid)
            RETURNING id
            """, p with { Uid = tx.User.Id });
        await tx.AuditAsync("guest.create", "guest", id, null, p with { IdentityNumber = Validate.Mask(p.IdentityNumber) });
        tx.Publish("guests", id);
        return id;
    }

    public sealed record GuestParams(string FirstName, string LastName, string? Gender, DateOnly? BirthDate, string? BirthPlace, string? FatherName,
        string? MotherName, string? Nationality, string? IdentityType, string? IdentityNumber, string? IdentityCountry, DateOnly? IdentityExpiry,
        string? Phone, string? PhoneNormalized, string? Email, string? Address, string? City, string? Country, string? TaxOffice, string? TaxNumber, Guid? CompanyId, string? Notes,
        string? Preferences, bool IsVip, string? VipLevel, bool KvkkConsent, bool MarketingConsent)
    {
        public Guid Id { get; init; }
        public int Version { get; init; }
        public Guid? Uid { get; init; }
    }

    public static GuestParams Params(SaveGuestRequest r)
    {
        if (r.Gender is not (null or "" or "male" or "female" or "other")) throw PmsException.Validation("Geçersiz cinsiyet.");
        if (r.IdentityType is not (null or "" or "tckn" or "passport" or "id_card" or "driver_license" or "other")) throw PmsException.Validation("Geçersiz kimlik türü.");
        var idType = string.IsNullOrEmpty(r.IdentityType) ? null : r.IdentityType;
        var idNo = Validate.Optional(r.IdentityNumber, 30)?.Replace(" ", "").ToUpperInvariant();
        if (idType == "tckn" && idNo is not null && !idNo.Contains('*') && !Validate.IsValidTckn(idNo))
            throw PmsException.Validation("T.C. kimlik numarası geçersiz.");
        if (r.BirthDate is { } bd && (bd > DateOnly.FromDateTime(DateTime.Today) || bd.Year < 1900))
            throw PmsException.Validation("Doğum tarihi geçersiz.");
        var phone = Validate.Optional(r.Phone, 40);
        return new GuestParams(
            Validate.Required(r.FirstName, "Ad", 100), Validate.Required(r.LastName, "Soyad", 100),
            string.IsNullOrEmpty(r.Gender) ? null : r.Gender, r.BirthDate, Validate.Optional(r.BirthPlace, 100),
            Validate.Optional(r.FatherName, 100), Validate.Optional(r.MotherName, 100), Validate.Country(r.Nationality, "Uyruk"),
            idType, idNo, Validate.Country(r.IdentityCountry), r.IdentityExpiry, phone, Validate.NormalizePhone(phone),
            Validate.Email(r.Email), Validate.Optional(r.Address), Validate.Optional(r.City, 100), Validate.Country(r.Country),
            Validate.Optional(r.TaxOffice, 100), Validate.Optional(r.TaxNumber, 20), r.CompanyId,
            Validate.Optional(r.Notes, 4000), Validate.Optional(r.Preferences, 2000), r.IsVip, Validate.Optional(r.VipLevel, 20),
            r.KvkkConsent, r.MarketingConsent);
    }
}
