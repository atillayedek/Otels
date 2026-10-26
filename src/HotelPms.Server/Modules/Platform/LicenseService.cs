using System.Text.RegularExpressions;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Platform;

public sealed record LicenseStatus(
    string State, string Message, bool Restricted, string? LicenseId, string? Customer, string? Hotel, string? TaxNumber, int? MaxRooms,
    IReadOnlyList<string> Modules, DateOnly? ExpiresAt, DateOnly? SupportUntil, DateOnly? TrialEndsAt, int? DaysLeft, int ActiveRooms);

public sealed record InstallLicenseRequest(string Content);

/// <summary>
/// Ürün lisansı. Durumlar: trial (deneme), trial_expired, licensed, expired, invalid.
/// Kısıtlı durumda veriye erişim ve günlük kapanış işlemleri sürer; yalnız yeni satış (rezervasyon, giriş, grup, adisyon) ve oda ekleme durur.
/// </summary>
public sealed partial class LicenseService(Db db)
{
    public const int TrialDays = 30;
    LicenseStatus? cached;
    DateTime cachedAt;

    /// <summary>Test derlemesinde (Debug) e2e testlerin kendi anahtarıyla imzaladığı lisanslar için; sürüm derlemesinde yoktur.</summary>
    static string? TestPublicKey =>
#if DEBUG
        Environment.GetEnvironmentVariable("PMS_TEST_LICENSE_PUBKEY");
#else
        null;
#endif

    public static LicensePayload? Verify(string? content, out string? error)
    {
        var p = LicenseFormat.Verify(content, out error);
        if (p is null && TestPublicKey is { Length: > 0 } test) p = LicenseFormat.Verify(content, out error, test);
        return p;
    }

    DateTime noCacheUntil;

    /// <summary>Lisans veya vergi no değişince çağrılır (işlem kesinleşmeden); birkaç saniye boyunca durum önbelleğe alınmaz.</summary>
    public void Invalidate() { cached = null; noCacheUntil = DateTime.UtcNow.AddSeconds(5); }

    public async Task<LicenseStatus> StatusAsync(CancellationToken ct = default)
    {
        if (cached is { } c && DateTime.UtcNow - cachedAt < TimeSpan.FromSeconds(30)) return c;
        await using var conn = await db.OpenAsync(ct);
        var row = await conn.QuerySingleAsync<(DateTime TrialStartedAt, string? Content)>("SELECT trial_started_at, content FROM pms.license_state WHERE id = 1");
        // İlk kurulumdan önce tesis kaydı yoktur (vergi no boş, oda sayısı 0); durum yine hesaplanır.
        var taxNumber = await conn.QueryFirstOrDefaultAsync<string?>("SELECT tax_number FROM pms.property LIMIT 1");
        var rooms = await conn.ExecuteScalarAsync<int>("SELECT count(*)::int FROM pms.rooms WHERE is_active");
        var today = DateOnly.FromDateTime(DateTime.Today);
        var s = Evaluate(row.TrialStartedAt, row.Content, taxNumber, rooms, today);
        if (DateTime.UtcNow >= noCacheUntil) { cached = s; cachedAt = DateTime.UtcNow; }
        return s;
    }

    public static LicenseStatus Evaluate(DateTime trialStartedAt, string? content, string? propertyTaxNumber, int activeRooms, DateOnly today)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            var ends = DateOnly.FromDateTime(trialStartedAt.ToLocalTime()).AddDays(TrialDays);
            var left = ends.DayNumber - today.DayNumber;
            return left > 0
                ? new("trial", $"Deneme sürümü: {left} gün kaldı. Lisans için {PmsConstants.SupportEmail} adresine yazın.", false, null, null, null, null, null, [], null, null, ends, left, activeRooms)
                : new("trial_expired", $"Deneme süresi {ends:dd.MM.yyyy} tarihinde doldu. Yeni rezervasyon, giriş ve adisyon için lisans yükleyin; mevcut kayıtlar, çıkış, tahsilat, gece denetimi ve raporlar çalışmaya devam eder.",
                    true, null, null, null, null, null, [], null, null, ends, 0, activeRooms);
        }
        var p = Verify(content, out var error);
        if (p is null) return new("invalid", "Yüklü lisans geçersiz: " + error, true, null, null, null, null, null, [], null, null, null, null, activeRooms);
        var digits = new string((propertyTaxNumber ?? "").Where(char.IsDigit).ToArray());
        if (p.TaxNumber is { Length: > 0 } t && t != digits)
            return new("invalid", $"Lisans {t} vergi numaralı işletme için verilmiş; Yönetim → Tesis Bilgileri'ndeki vergi numarası ({(digits.Length > 0 ? digits : "boş")}) uyuşmuyor.",
                true, p.LicenseId, p.Customer, p.Hotel, p.TaxNumber, p.MaxRooms, p.Modules, p.ExpiresAt, p.SupportUntil, null, null, activeRooms);
        if (p.ExpiresAt is { } e && e < today)
            return new("expired", $"Lisans süresi {e:dd.MM.yyyy} tarihinde doldu. Yenileme için {PmsConstants.SupportEmail} adresine yazın.",
                true, p.LicenseId, p.Customer, p.Hotel, p.TaxNumber, p.MaxRooms, p.Modules, p.ExpiresAt, p.SupportUntil, null, 0, activeRooms);
        int? daysLeft = p.ExpiresAt is { } x ? x.DayNumber - today.DayNumber : null;
        var msg = $"Lisanslı: {LicenseFormat.Describe(p)}";
        if (activeRooms > p.MaxRooms) msg += $" · Aktif oda sayısı ({activeRooms}) lisans sınırını ({p.MaxRooms}) aşıyor; yeni oda eklenemez.";
        return new("licensed", msg, false, p.LicenseId, p.Customer, p.Hotel, p.TaxNumber, p.MaxRooms, p.Modules, p.ExpiresAt, p.SupportUntil, null, daysLeft, activeRooms);
    }

    public static bool ModuleAllowed(LicenseStatus s, string module) => s.State == "trial" || (s.State == "licensed" && s.Modules.Contains(module));

    [GeneratedRegex(@"^/api/v1/(reservations(/walk-in|/[0-9a-fA-F-]{36}/check-in)?|groups(/[0-9a-fA-F-]{36}/rooms)?|pos/checks)/?$")]
    private static partial Regex SalesPath();

    /// <summary>Yazma isteğini lisans durumuna göre denetler (AuthMiddleware çağırır).</summary>
    public async Task EnsureWriteAllowedAsync(PathString path, string method, CancellationToken ct)
    {
        var p = path.Value ?? "";
        string? module = p.StartsWith("/api/v1/pos/") ? LicenseModules.Restaurant
            : p.StartsWith("/api/v1/stock/") || p.StartsWith("/api/v1/purchase-orders") ? LicenseModules.Stock
            : p.StartsWith("/api/v1/accounting/") ? LicenseModules.Accounting : null;
        var salesPath = HttpMethods.IsPost(method) && SalesPath().IsMatch(p);
        if (module is null && !salesPath) return;
        var s = await StatusAsync(ct);
        if (salesPath && s.Restricted) throw new PmsException(403, "license_required", s.Message);
        if (module is not null && !ModuleAllowed(s, module))
            throw new PmsException(403, "license_module", s.Restricted ? s.Message
                : $"{LicenseModules.Names[module]} modülü lisansınızda yok. Modül eklemek için {PmsConstants.SupportEmail} adresine yazın.");
    }

    /// <summary>Yeni oda eklenmeden önce lisansın oda sınırını denetler.</summary>
    public async Task EnsureRoomCapacityAsync(Tx tx)
    {
        Invalidate();
        var s = await StatusAsync();
        if (s.Restricted) throw new PmsException(403, "license_required", s.Message);
        if (s.MaxRooms is { } max && await tx.ScalarAsync<int>("SELECT count(*)::int FROM pms.rooms WHERE is_active") >= max)
            throw new PmsException(403, "license_rooms", $"Lisansınız en fazla {max} oda içindir. Oda sınırını artırmak için {PmsConstants.SupportEmail} adresine yazın.");
    }

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/license").WithTags("License");
        g.MapGet("/", (LicenseService svc, CancellationToken ct) => svc.StatusAsync(ct));
        g.MapPost("/", (InstallLicenseRequest req, CommandRunner cmd, LicenseService svc) => cmd.RunAsync("license.install", new { length = req.Content?.Length }, async tx =>
        {
            var content = (req.Content ?? "").Trim();
            if (content.Length > 10_000) throw PmsException.Validation("Lisans metni çok uzun.");
            var p = Verify(content, out var error) ?? throw PmsException.Validation(error ?? "Lisans geçersiz.");
            var taxNumber = await tx.ScalarAsync<string?>("SELECT tax_number FROM pms.property LIMIT 1");
            var digits = new string((taxNumber ?? "").Where(char.IsDigit).ToArray());
            if (p.TaxNumber is { Length: > 0 } t && t != digits)
                throw PmsException.Validation($"Bu lisans {t} vergi numaralı işletme içindir. Önce Yönetim → Tesis Bilgileri'nde vergi numarasını doğru girin.");
            if (p.ExpiresAt is { } e && e < DateOnly.FromDateTime(DateTime.Today)) throw PmsException.Validation($"Lisans süresi {e:dd.MM.yyyy} tarihinde dolmuş.");
            await tx.ExecAsync("UPDATE pms.license_state SET content = @content, installed_at = now(), installed_by = @uid WHERE id = 1", new { content, uid = tx.User.Id });
            await tx.AuditAsync("license.install", "license", p.LicenseId, null, new { p.LicenseId, p.Customer, p.Hotel, p.MaxRooms, p.Modules, p.ExpiresAt });
            tx.Publish("license");
            svc.Invalidate();
            return new { p.LicenseId };
        }, requireKey: false)).RequirePermission("license.manage");
    }
}
