using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using Dapper;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Wifi;

public sealed record WifiConfig(bool Enabled, string? SharedSecret, string[] AllowedClients, string PasswordMode, bool IncludeSharers, int GraceHours);

/// <summary>Doğrulama sonucu. Reason makine kodu; Message misafirin ekranında gösterilebilecek kısa metin.</summary>
public sealed record WifiAuthResult(bool Accepted, string Reason, string Message, Guid? GuestId = null, Guid? ReservationId = null,
    string? RoomNumber = null, string? GuestName = null, int SessionTimeoutSeconds = 0);

/// <summary>
/// Misafir Wi-Fi girişini doğrular: kullanıcı adı misafirin T.C. kimlik / pasaport numarası, şifre konakladığı oda numarası
/// (veya ayara göre soyadı). Yalnız şu an konaklayan (checked_in) misafir kabul edilir; izin çıkış saatine kadar (artı ek süre) geçerlidir.
/// </summary>
public sealed class WifiService(Db db, ILogger<WifiService> log)
{
    public const int MaxFailures = 5;
    static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(10);
    readonly ConcurrentDictionary<string, Queue<DateTime>> failures = new();
    WifiConfig? cached;
    DateTime cachedAt;

    public void Invalidate() => cached = null;

    public async Task<WifiConfig> ConfigAsync(CancellationToken ct = default)
    {
        if (cached is { } c && DateTime.UtcNow - cachedAt < TimeSpan.FromSeconds(10)) return c;
        var r = await db.QuerySingleOrDefaultAsync<(bool Enabled, string? Secret, string Clients, string Mode, bool Sharers, int Grace)>(
            "SELECT enabled, shared_secret, array_to_string(allowed_clients, ','), password_mode, include_sharers, grace_hours FROM pms.wifi_config WHERE id = 1", ct: ct);
        var row = r == default ? new WifiConfig(false, null, [], "room", true, 2)
            : new WifiConfig(r.Enabled, r.Secret, r.Clients.Split(',', StringSplitOptions.RemoveEmptyEntries), r.Mode, r.Sharers, r.Grace);
        cached = row; cachedAt = DateTime.UtcNow;
        return row;
    }

    public static string NewSecret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).Replace('+', 'K').Replace('/', 'm').TrimEnd('=');

    public static string NormalizeUser(string? s) => new string((s ?? "").Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();

    /// <summary>Karşılaştırma için: boşluklar atılır, Türkçe büyük harfe çevrilir ve Türkçe harfler ASCII karşılığına indirilir (hotspot klavyesi için).</summary>
    public static string Fold(string? s)
    {
        var u = new string((s ?? "").Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpper(new CultureInfo("tr-TR"));
        return u.Replace('Ç', 'C').Replace('Ğ', 'G').Replace('İ', 'I').Replace('Ö', 'O').Replace('Ş', 'S').Replace('Ü', 'U').Replace('Â', 'A').Replace('Î', 'I').Replace('Û', 'U');
    }

    sealed record Candidate(Guid GuestId, Guid ReservationId, string FirstName, string LastName, string RoomNumber, DateOnly Departure);

    /// <summary>
    /// Kimlik numarasıyla eşleşen konaklayan misafir(ler)i bulur ve şifreyi denetler. password: PAP ile çözülmüş şifre;
    /// chapCheck: CHAP için aday şifreyi doğrulayan işlev (PAP yoksa).
    /// </summary>
    public async Task<WifiAuthResult> AuthenticateAsync(string? userName, string? password, Func<string, bool>? chapCheck, string limiterKey,
        CancellationToken ct = default, bool requireEnabled = true)
    {
        var cfg = await ConfigAsync(ct);
        if (requireEnabled && !cfg.Enabled) return new(false, "disabled", "Wi-Fi girişi kapalı.");
        if (IsLocked(limiterKey)) return new(false, "locked", "Çok fazla hatalı deneme. Lütfen 10 dakika sonra tekrar deneyin veya resepsiyona başvurun.");
        var user = NormalizeUser(userName);
        if (user.Length < 5 || user.Length > 30) return Fail(limiterKey, "bad_username", "Kimlik numarası veya şifre hatalı.");

        await using var c = await db.OpenAsync(ct);
        var rows = (await c.QueryAsync<Candidate>(new CommandDefinition("""
            SELECT g.id AS guest_id, r.id AS reservation_id, g.first_name, g.last_name, rm.number AS room_number, r.departure
            FROM pms.reservations r
            JOIN pms.rooms rm ON rm.id = r.room_id
            JOIN pms.guests g ON g.id = r.guest_id
                 OR (@sharers AND g.id IN (SELECT rg.guest_id FROM pms.reservation_guests rg WHERE rg.reservation_id = r.id))
            WHERE r.status = 'checked_in' AND g.anonymized_at IS NULL
              AND upper(replace(g.identity_number, ' ', '')) = @user
            """, new { user, sharers = cfg.IncludeSharers }, cancellationToken: ct))).ToList();
        if (rows.Count == 0) return Fail(limiterKey, "not_in_house", "Kimlik numarası veya şifre hatalı.");

        Candidate? match = null;
        foreach (var r in rows)
        {
            var expected = cfg.PasswordMode == "last_name" ? r.LastName : r.RoomNumber;
            var ok = password is not null
                ? Fold(password) == Fold(expected)
                : chapCheck is not null && Variants(expected).Any(chapCheck);
            if (ok) { match = r; break; }
        }
        if (match is null) return Fail(limiterKey, "wrong_password", "Kimlik numarası veya şifre hatalı.");

        var timeout = await SessionSecondsAsync(c, match.Departure, cfg.GraceHours, ct);
        failures.TryRemove(limiterKey, out _);
        return new(true, "ok", $"Hoş geldiniz {match.FirstName}", match.GuestId, match.ReservationId, match.RoomNumber, $"{match.FirstName} {match.LastName}", timeout);
    }

    /// <summary>CHAP'te şifre açık gelmediğinden misafirin yazabileceği biçimler denenir (Türkçe harfli, ASCII, büyük/küçük).</summary>
    static IEnumerable<string> Variants(string expected)
    {
        var tr = new CultureInfo("tr-TR");
        var raw = expected.Trim();
        return new[] { raw, raw.ToUpper(tr), raw.ToLower(tr), Fold(raw), Fold(raw).ToLowerInvariant() }.Distinct();
    }

    /// <summary>Çıkış günü otelin çıkış saatine (tesis saat dilimi) ek süre eklenerek kalan saniye; en az 15 dakika, en çok 30 gün.</summary>
    static async Task<int> SessionSecondsAsync(Npgsql.NpgsqlConnection c, DateOnly departure, int graceHours, CancellationToken ct)
    {
        var (tzName, checkOut) = await c.QuerySingleAsync<(string, TimeSpan)>(new CommandDefinition("SELECT time_zone, check_out_time FROM pms.property LIMIT 1", cancellationToken: ct));
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(tzName); } catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { tz = TimeZoneInfo.Local; }
        var localEnd = departure.ToDateTime(TimeOnly.FromTimeSpan(checkOut)).AddHours(graceHours);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localEnd, DateTimeKind.Unspecified), tz);
        var secs = (endUtc - DateTime.UtcNow).TotalSeconds;
        return (int)Math.Clamp(secs, 15 * 60, 30 * 24 * 3600);
    }

    bool IsLocked(string key)
    {
        if (!failures.TryGetValue(key, out var q)) return false;
        lock (q) { while (q.Count > 0 && DateTime.UtcNow - q.Peek() > FailureWindow) q.Dequeue(); return q.Count >= MaxFailures; }
    }

    WifiAuthResult Fail(string key, string reason, string message)
    {
        var q = failures.GetOrAdd(key, _ => new Queue<DateTime>());
        lock (q) { q.Enqueue(DateTime.UtcNow); while (q.Count > MaxFailures) q.Dequeue(); }
        if (failures.Count > 10_000) failures.Clear(); // bellek sınırı
        return new(false, reason, message);
    }

    public async Task LogAttemptAsync(string? nasIp, string? mac, string? userName, WifiAuthResult r, CancellationToken ct = default)
    {
        try
        {
            await using var c = await db.OpenAsync(ct);
            await c.ExecuteAsync(new CommandDefinition("""
                INSERT INTO pms.wifi_auth_log (nas_ip, mac, username_masked, accepted, reason, guest_id, reservation_id)
                VALUES (@nas::inet, @mac, @user, @ok, @reason, @gid, @rid)
                """, new { nas = nasIp, mac = Mac(mac), user = Validate.Mask(NormalizeUser(userName)), ok = r.Accepted, reason = r.Reason, gid = r.GuestId, rid = r.ReservationId },
                cancellationToken: ct));
        }
        catch (Exception ex) when (ex is Npgsql.NpgsqlException or InvalidOperationException) { log.LogWarning(ex, "Wi-Fi giriş denemesi kaydedilemedi"); }
    }

    public static string? Mac(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var hex = new string(s.Where(Uri.IsHexDigit).ToArray()).ToUpperInvariant();
        return hex.Length == 12 ? string.Join(':', Enumerable.Range(0, 6).Select(i => hex.Substring(i * 2, 2))) : s.Trim()[..Math.Min(40, s.Trim().Length)];
    }
}
