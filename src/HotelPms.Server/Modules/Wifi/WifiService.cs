using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using Dapper;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Wifi;

public sealed record WifiConfig(bool Enabled, string? SharedSecret, string[] AllowedClients, string PasswordMode, bool IncludeSharers, int GraceHours,
    string? ApiKeyHash = null, string? ApiKeyHint = null, DateTime? ApiKeyCreatedAt = null, string? ProviderName = null,
    string? WebhookUrl = null, string? WebhookSecret = null, bool WebhookInsecureTls = false);

/// <summary>Şu an konaklayan ve Wi-Fi'ye girebilecek kişi: kullanıcı adı (kimlik no), şifre (oda no veya soyadı) ve iznin bitişi.</summary>
public sealed record WifiInHouse(Guid ReservationId, Guid GuestId, string ReservationNumber, string IdentityNumber, string FirstName, string RoomNumber,
    string Password, DateTime ValidUntil);

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

    DateTime noCacheUntil;

    /// <summary>
    /// Ayar değişince çağrılır. Çağrı veritabanı işlemi kesinleşmeden yapıldığından, birkaç saniye boyunca okunan ayar önbelleğe alınmaz;
    /// böylece arada başka bir servisin okuduğu eski ayar 10 saniye boyunca önbellekte kalmaz.
    /// </summary>
    public void Invalidate() { cached = null; noCacheUntil = DateTime.UtcNow.AddSeconds(5); }

    public async Task<WifiConfig> ConfigAsync(CancellationToken ct = default)
    {
        if (cached is { } c && DateTime.UtcNow - cachedAt < TimeSpan.FromSeconds(10)) return c;
        var r = await db.QuerySingleOrDefaultAsync<CfgRow>("""
            SELECT enabled, shared_secret, array_to_string(allowed_clients, ',') AS allowed_clients, password_mode, include_sharers, grace_hours,
                   api_key_hash, api_key_hint, api_key_created_at, provider_name, webhook_url, webhook_secret, webhook_insecure_tls
            FROM pms.wifi_config WHERE id = 1
            """, ct: ct);
        var row = r is null ? new WifiConfig(false, null, [], "room", true, 2)
            : new WifiConfig(r.Enabled, r.SharedSecret, r.AllowedClients.Split(',', StringSplitOptions.RemoveEmptyEntries), r.PasswordMode, r.IncludeSharers, r.GraceHours,
                r.ApiKeyHash, r.ApiKeyHint, r.ApiKeyCreatedAt, r.ProviderName, r.WebhookUrl, r.WebhookSecret, r.WebhookInsecureTls);
        if (DateTime.UtcNow >= noCacheUntil) { cached = row; cachedAt = DateTime.UtcNow; }
        return row;
    }

    sealed class CfgRow
    {
        public bool Enabled { get; set; }
        public string? SharedSecret { get; set; }
        public string AllowedClients { get; set; } = "";
        public string PasswordMode { get; set; } = "room";
        public bool IncludeSharers { get; set; }
        public int GraceHours { get; set; }
        public string? ApiKeyHash { get; set; }
        public string? ApiKeyHint { get; set; }
        public DateTime? ApiKeyCreatedAt { get; set; }
        public string? ProviderName { get; set; }
        public string? WebhookUrl { get; set; }
        public string? WebhookSecret { get; set; }
        public bool WebhookInsecureTls { get; set; }
    }

    sealed record InHouseRow(Guid ReservationId, Guid GuestId, string ReservationNumber, string IdentityNumber, string FirstName, string LastName, string RoomNumber, DateOnly Departure);

    /// <summary>Konaklayan, kimlik numarası girilmiş (ve ayara göre ek misafirleri de) kişilerin Wi-Fi giriş bilgileri.</summary>
    public async Task<IReadOnlyList<WifiInHouse>> InHouseAsync(CancellationToken ct = default)
    {
        var cfg = await ConfigAsync(ct);
        await using var c = await db.OpenAsync(ct);
        var rows = await c.QueryAsync<InHouseRow>(new CommandDefinition("""
            SELECT r.id AS reservation_id, g.id AS guest_id, r.reservation_number, upper(replace(g.identity_number, ' ', '')) AS identity_number,
                   g.first_name, g.last_name, rm.number AS room_number, r.departure
            FROM pms.reservations r
            JOIN pms.rooms rm ON rm.id = r.room_id
            JOIN pms.guests g ON g.id = r.guest_id
                 OR (@sharers AND g.id IN (SELECT rg.guest_id FROM pms.reservation_guests rg WHERE rg.reservation_id = r.id))
            WHERE r.status = 'checked_in' AND g.anonymized_at IS NULL AND COALESCE(btrim(g.identity_number), '') <> ''
            ORDER BY rm.number
            """, new { sharers = cfg.IncludeSharers }, cancellationToken: ct));
        var end = await EndCalculatorAsync(c, cfg.GraceHours, ct);
        return rows.Select(r => new WifiInHouse(r.ReservationId, r.GuestId, r.ReservationNumber, r.IdentityNumber, r.FirstName, r.RoomNumber,
            cfg.PasswordMode == "last_name" ? r.LastName : r.RoomNumber, end(r.Departure))).ToList();
    }

    /// <summary>Çıkış günü otelin çıkış saatine (tesis saat dilimi) ek süre eklenmiş UTC zamanı hesaplayan işlev.</summary>
    static async Task<Func<DateOnly, DateTime>> EndCalculatorAsync(Npgsql.NpgsqlConnection c, int graceHours, CancellationToken ct)
    {
        var (tzName, checkOut) = await c.QuerySingleAsync<(string, TimeSpan)>(new CommandDefinition("SELECT time_zone, check_out_time FROM pms.property LIMIT 1", cancellationToken: ct));
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(tzName); } catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { tz = TimeZoneInfo.Local; }
        return d => TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(d.ToDateTime(TimeOnly.FromTimeSpan(checkOut)).AddHours(graceHours), DateTimeKind.Unspecified), tz);
    }

    /// <summary>HTTP API anahtarı: "pmsw_" + 40 karakter. Yalnız SHA-256 özeti saklanır.</summary>
    public static string NewApiKey() => "pmsw_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(20)).ToLowerInvariant();
    public static string HashKey(string key) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    public static bool ApiKeyMatches(WifiConfig cfg, string? presented) =>
        cfg.ApiKeyHash is { } h && !string.IsNullOrEmpty(presented) && presented.Length < 200
        && CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(HashKey(presented.Trim())), System.Text.Encoding.ASCII.GetBytes(h));

    /// <summary>
    /// Hotspot cihazının/firmasının bildirdiği oturumu kaydeder (RADIUS accounting veya HTTP API). Aynı cihaz + oturum kimliği tek satırdır;
    /// misafir Class bilgisinden veya kimlik numarasıyla konaklayan misafirden bulunur.
    /// </summary>
    public async Task RecordSessionAsync(string nas, string sessionId, string? userName, Guid? guestId, Guid? reservationId, string? mac, string? framedIp,
        long inputBytes, long outputBytes, bool stopped, string? cause, CancellationToken ct = default)
    {
        await using var c = await db.OpenAsync(ct);
        var user = NormalizeUser(userName);
        if (guestId is null && user.Length >= 5)
        {
            var hit = await c.QueryFirstOrDefaultAsync<(Guid G, Guid R)?>(new CommandDefinition("""
                SELECT g.id, r.id FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
                    OR g.id IN (SELECT rg.guest_id FROM pms.reservation_guests rg WHERE rg.reservation_id = r.id)
                WHERE r.status = 'checked_in' AND upper(replace(g.identity_number, ' ', '')) = @user LIMIT 1
                """, new { user }, cancellationToken: ct));
            if (hit is { } h) { guestId = h.G; reservationId = h.R; }
        }
        await c.ExecuteAsync(new CommandDefinition("""
            INSERT INTO pms.wifi_sessions (nas_ip, acct_session_id, username_masked, guest_id, reservation_id, room_number, mac, framed_ip,
                input_bytes, output_bytes, stopped_at, terminate_cause)
            VALUES (@nas::inet, @sid, @user, @gid, @rid, (SELECT rm.number FROM pms.reservations r JOIN pms.rooms rm ON rm.id = r.room_id WHERE r.id = @rid),
                @mac, @ip::inet, @inb, @outb, CASE WHEN @stop THEN now() END, @cause)
            ON CONFLICT (nas_ip, acct_session_id) DO UPDATE SET updated_at = now(),
                framed_ip = COALESCE(EXCLUDED.framed_ip, pms.wifi_sessions.framed_ip), mac = COALESCE(EXCLUDED.mac, pms.wifi_sessions.mac),
                guest_id = COALESCE(pms.wifi_sessions.guest_id, EXCLUDED.guest_id), reservation_id = COALESCE(pms.wifi_sessions.reservation_id, EXCLUDED.reservation_id),
                room_number = COALESCE(pms.wifi_sessions.room_number, EXCLUDED.room_number),
                input_bytes = GREATEST(pms.wifi_sessions.input_bytes, EXCLUDED.input_bytes), output_bytes = GREATEST(pms.wifi_sessions.output_bytes, EXCLUDED.output_bytes),
                stopped_at = COALESCE(pms.wifi_sessions.stopped_at, EXCLUDED.stopped_at), terminate_cause = COALESCE(EXCLUDED.terminate_cause, pms.wifi_sessions.terminate_cause)
            """, new
        {
            nas, sid = sessionId.Length > 64 ? sessionId[..64] : sessionId, user = Validate.Mask(user.Length == 0 ? null : user), gid = guestId, rid = reservationId,
            mac = Mac(mac), ip = framedIp, inb = Math.Max(0, inputBytes), outb = Math.Max(0, outputBytes), stop = stopped, cause,
        }, cancellationToken: ct));
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
        var endUtc = (await EndCalculatorAsync(c, graceHours, ct))(departure);
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
