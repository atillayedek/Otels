using System.Security.Cryptography;
using System.Text.Json;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Guests;
using HotelPms.Server.Modules.Platform;
using HotelPms.Server.Modules.Property;
using HotelPms.Server.Modules.Reservations;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Online;

// ---- Herkese açık (web sitesi) modelleri: misafirin kişisel bilgisi yalnız kendi gönderdiği kadarıyla döner.
public sealed record OnlinePhotoDto(Guid Id, string Url, string Place, Guid? RoomTypeId, JsonElement Caption, int SortOrder);
public sealed record OnlineRoomDto(Guid RoomTypeId, string Code, JsonElement Title, JsonElement Description, JsonElement Features, int MaxAdults, int MaxChildren,
    IReadOnlyList<OnlinePhotoDto> Photos);
public sealed record OnlineInfoDto(bool Enabled, string HotelName, string? Phone, string? Whatsapp, string? Email, string? Address, string? MapUrl,
    JsonElement About, JsonElement Terms, string CheckinTime, string CheckoutTime, string Currency, DateOnly Today, int MinLeadDays, int MaxAdvanceDays, int MaxNights,
    IReadOnlyList<OnlineRoomDto> Rooms, IReadOnlyList<OnlinePhotoDto> Photos);
public sealed record OnlineOffer(Guid RoomTypeId, string Code, bool Available, int Nights, decimal Total, decimal Average, string Currency, string MealPlan,
    IReadOnlyList<NightRate> NightlyRates);
public sealed record OnlineBookingRequest(Guid RoomTypeId, DateOnly Arrival, DateOnly Departure, int Adults, int Children, string FirstName, string LastName,
    string Email, string Phone, string? Nationality, string? SpecialRequests, bool AcceptTerms, bool KvkkConsent, string? Language = null, string? Website = null);
public sealed record OnlineBookingResult(string Code, string Status, DateOnly Arrival, DateOnly Departure, int Nights, decimal Total, string Currency);
public sealed record OnlineLookupRequest(string Code, string Contact);
public sealed record OnlineBookingView(string Code, string Status, DateOnly Arrival, DateOnly Departure, int Nights, Guid RoomTypeId, JsonElement RoomTitle,
    int Adults, int Children, decimal Total, string Currency, bool CanWithdraw, bool CanRequest);
public sealed record OnlineGuestRequest(string Code, string Contact, string Kind, string Message);

// ---- PMS (yönetim) modelleri
public sealed record OnlineConfigDto(bool IsEnabled, string CodePrefix, Guid? RatePlanId, int MinLeadDays, int MaxAdvanceDays, int MaxNights, string HotelName,
    string? Phone, string? Whatsapp, string? Email, string? Address, string? MapUrl, JsonElement About, JsonElement Terms, TimeOnly CheckinTime,
    TimeOnly CheckoutTime, int Version);
public sealed record OnlineRoomContentDto(Guid RoomTypeId, string Code, string Name, bool IsListed, JsonElement Title, JsonElement Description, JsonElement Features,
    int SortOrder, int Version, int PhotoCount);
public sealed record SaveOnlineRoomRequest(bool IsListed, JsonElement Title, JsonElement Description, JsonElement Features, int SortOrder, int? Version);
public sealed record OnlinePendingDto(Guid Id, string ReservationNumber, string BookingCode, string GuestName, string? Email, string? Phone, string RoomTypeCode,
    DateOnly Arrival, DateOnly Departure, int Adults, int Children, decimal TotalRate, string Currency, DateTime CreatedAt, string? SpecialRequests, int Version);

/// <summary>
/// Online rezervasyon (otel web sitesi). Tek veri kaynağı pms.reservations'tır: web talebi "opsiyonlu" (tentative) rezervasyon olarak
/// açılır (= Onay Bekliyor), resepsiyon PMS'te onaylar veya iptal eder (= Reddedildi). Herkese açık uçlar /api/public/v1 altındadır,
/// oturum gerektirmez; işlemler pasif "online-rezervasyon" sistem hesabıyla yapılır ve hiçbir yetkisi yoktur (overbooking, stop sale aşımı yok).
/// </summary>
public static class OnlineBookingEndpoints
{
    public static readonly Guid SystemUserId = Guid.Parse("00000000-0000-4000-8000-0000000000a1");
    const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karışan karakterler (0/O, 1/I) yok
    static readonly string[] RequestKinds = ["early_checkin", "late_checkout", "extra_bed", "invoice", "special"];
    const long MaxPhotoBytes = 8 * 1024 * 1024;

    static CurrentUser SystemUser(RequestContext ctx) =>
        new(SystemUserId, "online-rezervasyon", "Online Rezervasyon (sistem)", [], new HashSet<string>(), Guid.Empty, null, false);

    sealed record ConfigRow(bool IsEnabled, string CodePrefix, Guid? RatePlanId, int MinLeadDays, int MaxAdvanceDays, int MaxNights, string HotelName,
        string? Phone, string? Whatsapp, string? Email, string? Address, string? MapUrl, string About, string Terms, TimeOnly CheckinTime, TimeOnly CheckoutTime, int Version);

    const string ConfigSql = """
        SELECT is_enabled, code_prefix, rate_plan_id, min_lead_days, max_advance_days, max_nights, hotel_name, phone, whatsapp, email, address, map_url,
               about::text AS about, terms::text AS terms, checkin_time, checkout_time, version
        FROM pms.online_config WHERE id = 1
        """;

    static JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Map(WebApplication app, PmsPaths paths)
    {
        var photoDir = Path.Combine(paths.StorageDir, "online");
        MapPublic(app, photoDir);
        MapAdmin(app, photoDir);
    }

    // =====================================================================================================================
    // Herkese açık uçlar
    // =====================================================================================================================
    static void MapPublic(WebApplication app, string photoDir)
    {
        var g = app.MapGroup("/api/public/v1").WithTags("Online").AllowAnonymousPms().RequireRateLimiting("online");

        g.MapGet("/info", (CommandRunner cmd) => cmd.ReadAsync(async tx =>
        {
            var c = await tx.OneAsync<ConfigRow>(ConfigSql);
            var photos = await PhotosAsync(tx);
            var rooms = await tx.ListAsync<(Guid Id, string Code, string Title, string Description, string Features, int MaxAdults, int MaxChildren)>("""
                SELECT t.id, t.code, oc.title::text, oc.description::text, oc.features::text, t.max_adults, t.max_children
                FROM pms.online_room_content oc JOIN pms.room_types t ON t.id = oc.room_type_id
                WHERE oc.is_listed AND t.is_active ORDER BY oc.sort_order, t.sort_order, t.code
                """);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            return new OnlineInfoDto(c.IsEnabled, c.HotelName, c.Phone, c.Whatsapp, c.Email, c.Address, c.MapUrl, J(c.About), J(c.Terms),
                c.CheckinTime.ToString("HH:mm"), c.CheckoutTime.ToString("HH:mm"), await PropertyEndpoints.CurrencyAsync(tx), bd, c.MinLeadDays, c.MaxAdvanceDays, c.MaxNights,
                rooms.Select(r => new OnlineRoomDto(r.Id, r.Code, J(r.Title), J(r.Description), J(r.Features), r.MaxAdults, r.MaxChildren,
                    photos.Where(p => p.RoomTypeId == r.Id).ToList())).ToList(),
                photos.Where(p => p.RoomTypeId is null).ToList());
        }));

        g.MapGet("/photos/{file}", (string file) =>
        {
            // Dosya adı kesin biçimde denetlenir: klasör dışına çıkma (path traversal) mümkün değil.
            if (!System.Text.RegularExpressions.Regex.IsMatch(file, "^[0-9a-f]{32}\\.(jpg|png|webp)$")) return Results.NotFound();
            var path = Path.Combine(photoDir, file);
            if (!File.Exists(path)) return Results.NotFound();
            var type = file.EndsWith(".png") ? "image/png" : file.EndsWith(".webp") ? "image/webp" : "image/jpeg";
            return Results.File(path, type, enableRangeProcessing: false, lastModified: File.GetLastWriteTimeUtc(path));
        });

        g.MapGet("/availability", (CommandRunner cmd, DateOnly arrival, DateOnly departure, int adults, int? children) => cmd.ReadAsync(async tx =>
        {
            var c = await tx.OneAsync<ConfigRow>(ConfigSql);
            await CheckStayAsync(tx, c, arrival, departure, adults, children ?? 0);
            var types = await tx.ListAsync<(Guid Id, string Code, int MaxAdults, int MaxChildren)>("""
                SELECT t.id, t.code, t.max_adults, t.max_children FROM pms.online_room_content oc JOIN pms.room_types t ON t.id = oc.room_type_id
                WHERE oc.is_listed AND t.is_active ORDER BY oc.sort_order, t.sort_order, t.code
                """);
            var meal = c.RatePlanId is { } rp ? await tx.ScalarAsync<string>("SELECT meal_plan FROM pms.rate_plans WHERE id = @rp", new { rp }) ?? "RO" : "RO";
            var offers = new List<OnlineOffer>();
            foreach (var t in types.Where(t => adults <= t.MaxAdults && (children ?? 0) <= t.MaxChildren))
            {
                var days = await ReservationService.AvailabilityAsync(tx, arrival, departure, t.Id);
                var free = days.Count > 0 && days.All(d => d.Total - d.Blocked - d.Sold - d.Held > 0) && !await StoppedAsync(tx, t.Id, arrival, departure);
                var rates = await ReservationService.ComputeRatesAsync(tx, t.Id, c.RatePlanId, arrival, departure);
                offers.Add(new OnlineOffer(t.Id, t.Code, free && rates.Total > 0, rates.Nights.Count, rates.Total, rates.Average,
                    rates.Currency ?? await PropertyEndpoints.CurrencyAsync(tx), meal, rates.Nights));
            }
            return offers;
        }));

        g.MapPost("/bookings", async (OnlineBookingRequest req, RequestContext ctx, CommandRunner cmd, LicenseService license, HttpContext http) =>
        {
            // Bot tuzağı: görünmeyen alan doluysa istek sessizce reddedilir (botlara ipucu verilmez).
            if (!string.IsNullOrEmpty(req.Website)) throw PmsException.Validation("Talep alınamadı.");
            await license.EnsureWriteAllowedAsync("/api/v1/reservations", "POST", http.RequestAborted);
            ctx.User = SystemUser(ctx);
            return await cmd.RunAsync("online.booking", req, async tx =>
            {
                var c = await tx.OneAsync<ConfigRow>(ConfigSql);
                if (!c.IsEnabled) throw new PmsException(503, "online_closed", "Online rezervasyon şu an kapalı. Lütfen otelle iletişime geçin.");
                if (!req.AcceptTerms || !req.KvkkConsent) throw PmsException.Validation("Rezervasyon koşullarını ve KVKK aydınlatma metnini onaylamanız gerekiyor.");
                await CheckStayAsync(tx, c, req.Arrival, req.Departure, req.Adults, req.Children);
                var listed = await tx.ScalarAsync<bool>("SELECT is_listed FROM pms.online_room_content WHERE room_type_id = @id", new { id = req.RoomTypeId });
                if (!listed) throw PmsException.Validation("Seçilen oda online satışta değil.");
                var email = Validate.Email(Validate.Required(req.Email, "E-posta", 120)) ?? throw PmsException.Validation("E-posta geçersiz.");
                var phone = Validate.NormalizePhone(Validate.Required(req.Phone, "Telefon", 30));
                if (phone is null || phone.Length is < 10 or > 15) throw PmsException.Validation("Telefon numarası geçersiz.");
                var guest = new SaveGuestRequest(Validate.Required(req.FirstName, "Ad", 60), Validate.Required(req.LastName, "Soyad", 60), null, null, null, null, null,
                    Validate.Country(req.Nationality, "Uyruk"), null, null, null, null, phone, email, null, null, null, null, null, null, null, null, false, null,
                    KvkkConsent: true, MarketingConsent: false, Version: null, Language: req.Language is "tr" or "en" ? req.Language : null);
                var meal = c.RatePlanId is { } rp ? await tx.ScalarAsync<string>("SELECT meal_plan FROM pms.rate_plans WHERE id = @rp", new { rp }) : null;
                var res = new SaveReservationRequest(null, guest, null, null, null, req.RoomTypeId, null, req.Arrival, req.Departure, req.Adults, req.Children,
                    c.RatePlanId, null, meal, "tentative", "web", null, null, null, null, "Online rezervasyon talebi (web sitesi). Onay bekliyor.",
                    Validate.Optional(req.SpecialRequests, 1000), 0, null, null);
                var id = await ReservationService.CreateAsync(tx, res);
                var code = await NewCodeAsync(tx, c.CodePrefix);
                await tx.ExecAsync("UPDATE pms.reservations SET booking_code = @code WHERE id = @id", new { code, id });
                await tx.AuditAsync("online.booking", "reservation", id, null, new { code, req.Arrival, req.Departure, req.RoomTypeId, req.Adults, req.Children });
                tx.Publish("online");
                var r = await tx.OneAsync<(DateOnly Arrival, DateOnly Departure, decimal Total, string Currency)>("""
                    SELECT arrival, departure, COALESCE((SELECT sum(rate) FROM pms.reservation_rates x WHERE x.reservation_id = r.id), 0), currency::text
                    FROM pms.reservations r WHERE id = @id
                    """, new { id });
                return new OnlineBookingResult(code, "pending", r.Arrival, r.Departure, r.Departure.DayNumber - r.Arrival.DayNumber, r.Total, r.Currency);
            });
        }).RequireRateLimiting("online-write");

        g.MapPost("/bookings/lookup", (OnlineLookupRequest req, CommandRunner cmd) => cmd.ReadAsync(async tx => await ViewAsync(tx, await FindAsync(tx, req.Code, req.Contact))))
            .RequireRateLimiting("online-write");

        g.MapPost("/bookings/withdraw", async (OnlineLookupRequest req, RequestContext ctx, CommandRunner cmd) =>
        {
            ctx.User = SystemUser(ctx);
            return await cmd.RunAsync("online.withdraw", req, async tx =>
            {
                var id = await FindAsync(tx, req.Code, req.Contact);
                var r = await tx.OneAsync<(string Status, int Version)>("SELECT status, version FROM pms.reservations WHERE id = @id FOR UPDATE", new { id });
                if (r.Status != "tentative")
                    throw PmsException.Validation("Rezervasyonunuz otel tarafından onaylanmıştır. İptal veya değişiklik işlemleri için lütfen otel ile iletişime geçiniz.");
                await ReservationService.CancelAsync(tx, id, new CancelRequest("Misafir web sitesinden talebini geri çekti.", r.Version));
                tx.Publish("online");
                return await ViewAsync(tx, id);
            }, requireKey: false);
        }).RequireRateLimiting("online-write");

        g.MapPost("/bookings/requests", async (OnlineGuestRequest req, RequestContext ctx, CommandRunner cmd) =>
        {
            ctx.User = SystemUser(ctx);
            return await cmd.RunAsync("online.request", req, async tx =>
            {
                var id = await FindAsync(tx, req.Code, req.Contact);
                if (!RequestKinds.Contains(req.Kind)) throw PmsException.Validation("Geçersiz talep türü.");
                var r = await tx.OneAsync<(string Status, DateOnly Arrival, DateOnly Departure)>("SELECT status, arrival, departure FROM pms.reservations WHERE id = @id", new { id });
                if (r.Status is not ("tentative" or "confirmed" or "checked_in")) throw PmsException.Validation("Bu rezervasyon için talep gönderilemez.");
                var message = Validate.Required(req.Message, "Talep", 500);
                var label = req.Kind switch
                {
                    "early_checkin" => "Erken giriş talebi", "late_checkout" => "Geç çıkış talebi", "extra_bed" => "Ek yatak talebi",
                    "invoice" => "Fatura talebi", _ => "Özel istek",
                };
                var bd = await PropertyEndpoints.BusinessDateAsync(tx);
                var due = req.Kind == "late_checkout" ? r.Departure : r.Arrival < bd ? bd : r.Arrival;
                if (due < bd) due = bd;
                // Talep otomatik onay değildir: ilgili bölümün hatırlatma listesine düşer, resepsiyon değerlendirir.
                await tx.ExecAsync("""
                    INSERT INTO pms.traces (reservation_id, department, message, due_date, created_by) VALUES (@id, @dept, @msg, @due, @uid)
                    """, new { id, dept = req.Kind == "invoice" ? "accounting" : "front_office", msg = $"[Web] {label}: {message}", due, uid = SystemUserId });
                await tx.AuditAsync("online.request", "reservation", id, null, new { req.Kind });
                tx.Publish("traces", id);
                tx.Publish("online");
                return new { received = true };
            }, requireKey: false);
        }).RequireRateLimiting("online-write");
    }

    static async Task<List<OnlinePhotoDto>> PhotosAsync(Tx tx) =>
        (await tx.ListAsync<(Guid Id, string FileName, string Place, Guid? RoomTypeId, string Caption, int SortOrder)>(
            "SELECT id, file_name, place, room_type_id, caption::text, sort_order FROM pms.online_photos ORDER BY place, sort_order, created_at"))
        .Select(p => new OnlinePhotoDto(p.Id, "/api/public/v1/photos/" + p.FileName, p.Place, p.RoomTypeId, J(p.Caption), p.SortOrder)).ToList();

    static async Task<bool> StoppedAsync(Tx tx, Guid roomTypeId, DateOnly from, DateOnly to) => await tx.ScalarAsync<bool>("""
        SELECT EXISTS (SELECT 1 FROM pms.stop_sales WHERE is_active AND (room_type_id IS NULL OR room_type_id = @roomTypeId) AND date_from < @to AND date_to > @from)
        """, new { roomTypeId, from, to });

    static async Task CheckStayAsync(Tx tx, ConfigRow c, DateOnly arrival, DateOnly departure, int adults, int children)
    {
        if (!c.IsEnabled) throw new PmsException(503, "online_closed", "Online rezervasyon şu an kapalı. Lütfen otelle iletişime geçin.");
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (departure <= arrival) throw PmsException.Validation("Çıkış tarihi giriş tarihinden sonra olmalıdır.");
        if (arrival < bd.AddDays(c.MinLeadDays)) throw PmsException.Validation($"Giriş tarihi en erken {bd.AddDays(c.MinLeadDays):dd.MM.yyyy} olabilir.");
        if (arrival > bd.AddDays(c.MaxAdvanceDays)) throw PmsException.Validation($"En fazla {c.MaxAdvanceDays} gün sonrası için rezervasyon yapılabilir.");
        if (departure.DayNumber - arrival.DayNumber > c.MaxNights) throw PmsException.Validation($"Online rezervasyon en fazla {c.MaxNights} gece içindir.");
        if (adults is < 1 or > 10 || children is < 0 or > 10) throw PmsException.Validation("Kişi sayısı geçersiz.");
    }

    static async Task<string> NewCodeAsync(Tx tx, string prefix)
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var chars = new char[8];
            for (var i = 0; i < chars.Length; i++) chars[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
            var code = prefix + "-" + new string(chars);
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.reservations WHERE booking_code = @code)", new { code })) return code;
        }
        throw new InvalidOperationException("Takip kodu üretilemedi.");
    }

    /// <summary>
    /// Takip kodu + rezervasyondaki e-posta veya telefon birlikte doğrulanır; yalnız kodu bilen kişi bilgilere erişemez.
    /// Bulunamadı ve eşleşmedi durumları aynı yanıtı verir (kod tahmini için ipucu yok).
    /// </summary>
    static async Task<Guid> FindAsync(Tx tx, string? code, string? contact)
    {
        var notFound = new PmsException(404, "not_found", "Rezervasyon bulunamadı veya bilgiler eşleşmiyor.");
        var c = (code ?? "").Trim().ToUpperInvariant();
        var k = (contact ?? "").Trim();
        if (c.Length is < 11 or > 21 || k.Length is < 5 or > 120) throw notFound;
        var r = await tx.OneOrNullAsync<(Guid Id, string? Email, string? Phone)>("""
            SELECT r.id, g.email, g.phone FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id WHERE r.booking_code = @c
            """, new { c });
        if (r == default) throw notFound;
        var emailOk = r.Email is { } e && k.Contains('@') && string.Equals(e, k, StringComparison.OrdinalIgnoreCase);
        var p = Validate.NormalizePhone(k);
        var phoneOk = !k.Contains('@') && r.Phone is { } ph && p is { Length: >= 10 } && Validate.NormalizePhone(ph) is { } np && np[^10..] == p[^10..];
        if (!emailOk && !phoneOk) throw notFound;
        return r.Id;
    }

    static async Task<OnlineBookingView> ViewAsync(Tx tx, Guid id)
    {
        var r = await tx.OneAsync<(string Code, string Status, string? CancelledFrom, Guid? CancelledBy, DateOnly Arrival, DateOnly Departure, Guid RoomTypeId, string Title,
            int Adults, int Children, decimal Total, string Currency)>("""
            SELECT r.booking_code, r.status, r.cancelled_from, r.cancelled_by, r.arrival, r.departure, r.room_type_id,
                   COALESCE(oc.title, jsonb_build_object('tr', t.name, 'en', t.name))::text, r.adults, r.children,
                   COALESCE((SELECT sum(rate) FROM pms.reservation_rates x WHERE x.reservation_id = r.id), 0), r.currency::text
            FROM pms.reservations r JOIN pms.room_types t ON t.id = r.room_type_id LEFT JOIN pms.online_room_content oc ON oc.room_type_id = r.room_type_id
            WHERE r.id = @id
            """, new { id });
        var status = r.Status switch
        {
            "tentative" => "pending",
            "confirmed" => "approved",
            "cancelled" when r.CancelledBy == SystemUserId => "withdrawn",
            "cancelled" when r.CancelledFrom == "tentative" => "rejected",
            _ => r.Status, // checked_in, checked_out, cancelled, no_show
        };
        return new OnlineBookingView(r.Code, status, r.Arrival, r.Departure, r.Departure.DayNumber - r.Arrival.DayNumber, r.RoomTypeId, J(r.Title), r.Adults, r.Children,
            r.Total, r.Currency, status == "pending", status is "pending" or "approved" or "checked_in");
    }

    // =====================================================================================================================
    // PMS yönetim uçları (oturum + online.manage)
    // =====================================================================================================================
    static void MapAdmin(WebApplication app, string photoDir)
    {
        var g = app.MapGroup("/api/v1/online").WithTags("Online");

        g.MapGet("/config", (CommandRunner cmd) => cmd.ReadAsync(async tx =>
        {
            var c = await tx.OneAsync<ConfigRow>(ConfigSql);
            return new OnlineConfigDto(c.IsEnabled, c.CodePrefix, c.RatePlanId, c.MinLeadDays, c.MaxAdvanceDays, c.MaxNights, c.HotelName, c.Phone, c.Whatsapp, c.Email,
                c.Address, c.MapUrl, J(c.About), J(c.Terms), c.CheckinTime, c.CheckoutTime, c.Version);
        })).RequirePermission("online.manage");

        g.MapPut("/config", (OnlineConfigDto req, CommandRunner cmd) => cmd.RunAsync("online.config", req, async tx =>
        {
            var prefix = (req.CodePrefix ?? "").Trim().ToUpperInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(prefix, "^[A-Z0-9]{2,12}$")) throw PmsException.Validation("Takip kodu ön eki 2-12 harf/rakam olmalıdır (ör. CIHAN).");
            if (req.RatePlanId is { } rp && !await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.rate_plans WHERE id = @rp AND is_active)", new { rp }))
                throw PmsException.Validation("Fiyat planı bulunamadı veya pasif.");
            var whatsapp = req.Whatsapp is { Length: > 0 } w ? new string(w.Where(char.IsDigit).ToArray()) : null;
            if (whatsapp is not null && whatsapp.Length is < 10 or > 15) throw PmsException.Validation("WhatsApp numarası ülke koduyla 10-15 rakam olmalıdır (ör. 905321234567).");
            var map = Validate.Optional(req.MapUrl, 500);
            if (map is not null && !map.StartsWith("https://", StringComparison.Ordinal)) throw PmsException.Validation("Harita bağlantısı https:// ile başlamalıdır.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.online_config SET is_enabled = @IsEnabled, code_prefix = @prefix, rate_plan_id = @RatePlanId, min_lead_days = @MinLeadDays,
                    max_advance_days = @MaxAdvanceDays, max_nights = @MaxNights, hotel_name = @name, phone = @phone, whatsapp = @whatsapp, email = @email,
                    address = @address, map_url = @map, about = @about::jsonb, terms = @terms::jsonb, checkin_time = @CheckinTime, checkout_time = @CheckoutTime,
                    updated_at = now(), updated_by = @uid, version = version + 1
                WHERE id = 1 AND version = @Version
                """, new
            {
                req.IsEnabled, prefix, req.RatePlanId, req.MinLeadDays, req.MaxAdvanceDays, req.MaxNights, name = Validate.Optional(req.HotelName, 120) ?? "",
                phone = Validate.Optional(req.Phone, 40), whatsapp, email = Validate.Email(req.Email), address = Validate.Optional(req.Address, 400), map,
                about = Texts(req.About, 8000), terms = Texts(req.Terms, 20000), req.CheckinTime, req.CheckoutTime, uid = tx.User.Id, req.Version,
            });
            await tx.AuditAsync("online.config", "online", null, null, new { req.IsEnabled, prefix, req.RatePlanId });
            tx.Publish("online");
            return new { ok = true };
        }, requireKey: false)).RequirePermission("online.manage");

        g.MapGet("/rooms", (Db db) => db.QueryAsync<OnlineRoomContentDto>("""
            SELECT t.id AS room_type_id, t.code, t.name, COALESCE(oc.is_listed, false) AS is_listed, COALESCE(oc.title, '{}'::jsonb) AS title,
                   COALESCE(oc.description, '{}'::jsonb) AS description, COALESCE(oc.features, '[]'::jsonb) AS features, COALESCE(oc.sort_order, 0) AS sort_order,
                   COALESCE(oc.version, 0) AS version, (SELECT count(*)::int FROM pms.online_photos p WHERE p.room_type_id = t.id) AS photo_count
            FROM pms.room_types t LEFT JOIN pms.online_room_content oc ON oc.room_type_id = t.id WHERE t.is_active ORDER BY t.sort_order, t.code
            """)).RequirePermission("online.manage");

        g.MapPut("/rooms/{roomTypeId:guid}", (Guid roomTypeId, SaveOnlineRoomRequest req, CommandRunner cmd) => cmd.RunAsync("online.room", new { roomTypeId, req }, async tx =>
        {
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.room_types WHERE id = @roomTypeId)", new { roomTypeId })) throw PmsException.NotFound("Oda tipi");
            if (req.Features.ValueKind != JsonValueKind.Array || req.Features.GetArrayLength() > 30) throw PmsException.Validation("Özellik listesi geçersiz.");
            var exists = await tx.ScalarAsync<int?>("SELECT version FROM pms.online_room_content WHERE room_type_id = @roomTypeId", new { roomTypeId });
            var p = new { roomTypeId, req.IsListed, title = Texts(req.Title, 120), description = Texts(req.Description, 4000), features = req.Features.GetRawText(), req.SortOrder, version = req.Version ?? -1 };
            if (exists is null)
                await tx.ExecAsync("""
                    INSERT INTO pms.online_room_content (room_type_id, is_listed, title, description, features, sort_order)
                    VALUES (@roomTypeId, @IsListed, @title::jsonb, @description::jsonb, @features::jsonb, @SortOrder)
                    """, p);
            else
                await tx.ExecVersionedAsync("""
                    UPDATE pms.online_room_content SET is_listed = @IsListed, title = @title::jsonb, description = @description::jsonb, features = @features::jsonb,
                        sort_order = @SortOrder, updated_at = now(), version = version + 1
                    WHERE room_type_id = @roomTypeId AND version = @version
                    """, p);
            await tx.AuditAsync("online.room", "online", roomTypeId, null, new { req.IsListed });
            tx.Publish("online");
            return new { ok = true };
        }, requireKey: false)).RequirePermission("online.manage");

        g.MapGet("/photos", (CommandRunner cmd) => cmd.ReadAsync(PhotosAsync)).RequirePermission("online.manage");

        g.MapPost("/photos", async (HttpRequest http, CommandRunner cmd) =>
        {
            if (!http.HasFormContentType) throw PmsException.Validation("Fotoğraf dosyası gönderilmedi.");
            var form = await http.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? throw PmsException.Validation("Fotoğraf dosyası gönderilmedi.");
            if (file.Length is 0 or > MaxPhotoBytes) throw PmsException.Validation("Fotoğraf en fazla 8 MB olabilir.");
            var place = form["place"].ToString();
            if (place is not ("hero" or "gallery" or "room" or "logo")) throw PmsException.Validation("Geçersiz fotoğraf yeri.");
            Guid? roomTypeId = Guid.TryParse(form["roomTypeId"], out var rt) ? rt : null;
            if (place == "room" && roomTypeId is null) throw PmsException.Validation("Oda fotoğrafı için oda tipi seçilmelidir.");
            await using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var bytes = ms.ToArray();
            // Türü dosya adına veya tarayıcının söylediğine göre değil, dosyanın ilk baytlarına göre belirlenir; başka her şey reddedilir.
            var (ext, type) = Sniff(bytes) ?? throw PmsException.Validation("Yalnız JPEG, PNG veya WebP fotoğraf yüklenebilir.");
            var (w, h) = Dimensions(bytes, ext);
            var name = Guid.NewGuid().ToString("N") + "." + ext;
            Directory.CreateDirectory(photoDir);
            var path = Path.Combine(photoDir, name);
            await File.WriteAllBytesAsync(path, bytes);
            try
            {
                return await cmd.RunAsync("online.photo", new { name, place, roomTypeId }, async tx =>
                {
                    if (roomTypeId is { } r && !await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.room_types WHERE id = @r)", new { r }))
                        throw PmsException.NotFound("Oda tipi");
                    var caption = form["caption"].ToString();
                    var id = await tx.ScalarAsync<Guid>("""
                        INSERT INTO pms.online_photos (room_type_id, place, file_name, content_type, width, height, caption, sort_order, created_by)
                        VALUES (@roomTypeId, @place, @name, @type, @w, @h, @caption::jsonb,
                                (SELECT COALESCE(max(sort_order), 0) + 1 FROM pms.online_photos WHERE place = @place), @uid)
                        RETURNING id
                        """, new { roomTypeId = place == "room" ? roomTypeId : null, place, name, type, w, h, caption = Texts(Parse(caption), 200), uid = tx.User.Id });
                    await tx.AuditAsync("online.photo", "online", id, null, new { place, roomTypeId, bytes = bytes.Length });
                    tx.Publish("online");
                    return new { id };
                }, requireKey: false);
            }
            catch
            {
                File.Delete(path);
                throw;
            }
        }).RequirePermission("online.manage").DisableAntiforgery();

        g.MapDelete("/photos/{id:guid}", (Guid id, CommandRunner cmd) => cmd.RunAsync("online.photo_delete", new { id }, async tx =>
        {
            var name = await tx.ScalarAsync<string?>("DELETE FROM pms.online_photos WHERE id = @id RETURNING file_name", new { id }) ?? throw PmsException.NotFound("Fotoğraf");
            var path = Path.Combine(photoDir, name);
            if (File.Exists(path)) File.Delete(path);
            await tx.AuditAsync("online.photo_delete", "online", id);
            tx.Publish("online");
            return new { ok = true };
        }, requireKey: false)).RequirePermission("online.manage");

        // PMS ekranında önizleme: istemci sunucu sertifikasını tarayıcı olarak tanımadığı için görsel veri adresi olarak döner.
        g.MapGet("/photos/{id:guid}/data", async (Guid id, Db db) =>
        {
            var p = (await db.QueryAsync<(string FileName, string ContentType)>("SELECT file_name, content_type FROM pms.online_photos WHERE id = @id", new { id })).FirstOrDefault();
            if (p == default) throw PmsException.NotFound("Fotoğraf");
            var path = Path.Combine(photoDir, p.FileName);
            if (!File.Exists(path)) throw PmsException.NotFound("Fotoğraf dosyası");
            return new { dataUrl = $"data:{p.ContentType};base64,{Convert.ToBase64String(await File.ReadAllBytesAsync(path))}" };
        }).RequirePermission("online.manage");

        // Tek tıkla onay / ret (yalnız onay bekleyen web talepleri). Onay: opsiyonlu → onaylı; ret: gerekçeli iptal (web'de "Reddedildi").
        g.MapPost("/pending/{id:guid}/approve", (Guid id, VersionRequest req, CommandRunner cmd) => cmd.RunAsync("online.approve", new { id, req }, async tx =>
        {
            var r = await tx.OneOrNullAsync<(string Status, string? Code)>("SELECT status, booking_code FROM pms.reservations WHERE id = @id FOR UPDATE", new { id });
            if (r == default || r.Code is null) throw PmsException.NotFound("Web talebi");
            if (r.Status != "tentative") throw PmsException.Validation("Talep artık onay beklemiyor.");
            await tx.ExecVersionedAsync("UPDATE pms.reservations SET status = 'confirmed', option_until = NULL, updated_at = now(), version = version + 1 WHERE id = @id AND version = @Version",
                new { id, req.Version });
            await tx.AuditAsync("online.approve", "reservation", id, new { status = "tentative" }, new { status = "confirmed" });
            tx.Publish("reservations", id); tx.Publish("online"); tx.Publish("availability");
            return new { ok = true };
        })).RequirePermission("reservation.edit");

        g.MapPost("/pending/{id:guid}/reject", (Guid id, CancelRequest req, CommandRunner cmd) => cmd.RunAsync("online.reject", new { id, req }, async tx =>
        {
            var code = await tx.ScalarAsync<string?>("SELECT booking_code FROM pms.reservations WHERE id = @id", new { id }) ?? throw PmsException.NotFound("Web talebi");
            await ReservationService.CancelAsync(tx, id, req);
            tx.Publish("online");
            return new { ok = true, code };
        })).RequirePermission("reservation.cancel");

        // Onay bekleyen web talepleri (resepsiyon onaylar: rezervasyonu "onaylı" yapar; reddeder: iptal eder).
        g.MapGet("/pending", (Db db) => db.QueryAsync<OnlinePendingDto>("""
            SELECT r.id, r.reservation_number, r.booking_code, g.first_name || ' ' || g.last_name AS guest_name, g.email, g.phone, t.code AS room_type_code,
                   r.arrival, r.departure, r.adults, r.children,
                   COALESCE((SELECT sum(rate) FROM pms.reservation_rates x WHERE x.reservation_id = r.id), 0) AS total_rate, r.currency::text AS currency, r.created_at, r.special_requests, r.version
            FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id JOIN pms.room_types t ON t.id = r.room_type_id
            WHERE r.booking_code IS NOT NULL AND r.status = 'tentative' ORDER BY r.created_at
            """)).RequirePermission("reservation.view");
    }

    static JsonElement Parse(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return J("{}");
        try { return J(s); } catch (JsonException) { return JsonSerializer.SerializeToElement(new { tr = s }); }
    }

    /// <summary>Çok dilli metin: yalnız {"dil": "metin"} biçimi kabul edilir; dil kodu iki harf, metin uzunluğu sınırlı. HTML yorumlanmaz (site düz metin basar).</summary>
    static string Texts(JsonElement e, int max)
    {
        if (e.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) return "{}";
        if (e.ValueKind != JsonValueKind.Object) throw PmsException.Validation("Metin alanı geçersiz.");
        var d = new Dictionary<string, string>();
        foreach (var p in e.EnumerateObject())
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(p.Name, "^[a-z]{2}$") || p.Value.ValueKind != JsonValueKind.String) throw PmsException.Validation("Metin alanı geçersiz.");
            var v = p.Value.GetString()!.Trim();
            if (v.Length > max) throw PmsException.Validation($"Metin en fazla {max} karakter olabilir.");
            if (v.Length > 0) d[p.Name] = v;
        }
        return JsonSerializer.Serialize(d);
    }

    static (string Ext, string Type)? Sniff(byte[] b)
    {
        if (b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ("jpg", "image/jpeg");
        if (b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return ("png", "image/png");
        if (b.Length > 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return ("webp", "image/webp");
        return null;
    }

    static (int? W, int? H) Dimensions(byte[] b, string ext)
    {
        try
        {
            if (ext == "png") return ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]);
            if (ext == "jpg")
                for (var i = 2; i + 9 < b.Length;)
                {
                    if (b[i] != 0xFF) { i++; continue; }
                    var m = b[i + 1];
                    if (m is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC) return ((b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]);
                    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
                }
        }
        catch (IndexOutOfRangeException) { }
        return (null, null);
    }
}
