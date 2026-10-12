using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Auth;

public sealed class SessionService(Db db, ILogger<SessionService> log)
{
    public const string CookieName = "pms_session";
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(12);
    public static readonly TimeSpan AbsoluteTimeout = TimeSpan.FromDays(3);
    const int MaxFailedAttempts = 5;
    static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    // Oturum çözümleme önbelleği; yetki değişikliği en geç 15 sn içinde etkili olur, iptal anında temizlenir.
    readonly ConcurrentDictionary<string, (CurrentUser User, DateTime Until)> _cache = new();

    public static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    public sealed record LoginResult(string Token, CurrentUser User, DateTimeOffset ExpiresAt);

    public async Task<LoginResult> LoginAsync(string username, string password, Guid deviceId, string deviceName, string deviceKind,
        string? clientVersion, IPAddress? ip, string? userAgent, CancellationToken ct)
    {
        username = (username ?? "").Trim().ToLowerInvariant();
        await using var c = await db.OpenAsync(ct);

        var recentIpFailures = await c.ExecuteScalarAsync<long>(
            "SELECT count(*) FROM pms.login_attempts WHERE ip = @ip::inet AND NOT success AND at > now() - interval '15 minutes'",
            new { ip = ip?.ToString() });
        if (recentIpFailures >= 20)
            throw new PmsException(429, "rate_limited", "Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.");

        var user = await c.QuerySingleOrDefaultAsync<UserRow>(
            "SELECT id, username, full_name, password_hash, is_active, must_change_password, failed_attempts, locked_until FROM pms.users WHERE lower(username) = @username",
            new { username });

        async Task Fail(string reason)
        {
            await c.ExecuteAsync("INSERT INTO pms.login_attempts (username, ip, success) VALUES (@username, @ip::inet, false)",
                new { username, ip = ip?.ToString() });
            await c.ExecuteAsync("""
                INSERT INTO pms.audit_log (username, device_id, ip, action, entity_type, entity_id, reason)
                VALUES (@username, @deviceId, @ip::inet, 'auth.login_failed', 'user', @uid, @reason)
                """, new { username, deviceId, ip = ip?.ToString(), uid = user?.Id.ToString(), reason });
        }

        if (user is null)
        {
            PasswordHasher.DummyVerify(password ?? "");
            await Fail("unknown_user");
            throw new PmsException(401, "invalid_credentials", "Kullanıcı adı veya parola hatalı.");
        }
        if (user.LockedUntil is { } lu && lu > DateTime.UtcNow)
        {
            await Fail("locked");
            throw new PmsException(423, "locked", "Hesap çok sayıda hatalı deneme nedeniyle geçici olarak kilitlendi. Daha sonra tekrar deneyin.");
        }
        if (!PasswordHasher.Verify(password ?? "", user.PasswordHash))
        {
            var attempts = user.FailedAttempts + 1;
            await c.ExecuteAsync("UPDATE pms.users SET failed_attempts = @attempts, locked_until = @lock WHERE id = @id",
                new { attempts, id = user.Id, @lock = attempts >= MaxFailedAttempts ? DateTime.UtcNow.Add(LockoutDuration) : (DateTime?)null });
            await Fail("bad_password");
            throw new PmsException(401, "invalid_credentials", "Kullanıcı adı veya parola hatalı.");
        }
        if (!user.IsActive)
        {
            await Fail("inactive");
            throw new PmsException(403, "inactive", "Bu kullanıcı hesabı pasif durumda.");
        }

        var device = await c.QuerySingleOrDefaultAsync<(string Status, Guid Id)>(
            "SELECT status, id FROM pms.devices WHERE id = @deviceId", new { deviceId });
        if (device.Status == "revoked")
        {
            await Fail("device_revoked");
            throw new PmsException(403, "device_revoked", "Bu cihazın PMS erişimi yönetici tarafından iptal edildi.");
        }

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = DateTimeOffset.UtcNow.Add(IdleTimeout);
        await using var tx = await c.BeginTransactionAsync(ct);
        await c.ExecuteAsync("""
            INSERT INTO pms.devices (id, name, kind, hostname, last_ip, client_version, last_user_id, last_seen_at)
            VALUES (@deviceId, @deviceName, @deviceKind, @deviceName, @ip::inet, @clientVersion, @uid, now())
            ON CONFLICT (id) DO UPDATE SET last_ip = EXCLUDED.last_ip, client_version = EXCLUDED.client_version,
                last_user_id = EXCLUDED.last_user_id, last_seen_at = now(),
                name = CASE WHEN pms.devices.kind = 'browser' THEN EXCLUDED.name ELSE pms.devices.name END
            """, new { deviceId, deviceName, deviceKind, ip = ip?.ToString(), clientVersion, uid = user.Id }, tx);
        var sessionId = await c.ExecuteScalarAsync<Guid>("""
            INSERT INTO pms.sessions (user_id, token_hash, device_id, ip, user_agent, expires_at)
            VALUES (@uid, @hash, @deviceId, @ip::inet, @ua, @expires) RETURNING id
            """, new { uid = user.Id, hash = HashToken(token), deviceId, ip = ip?.ToString(), ua = Truncate(userAgent, 300), expires = expires.UtcDateTime }, tx);
        await c.ExecuteAsync("UPDATE pms.users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = @id", new { id = user.Id }, tx);
        await c.ExecuteAsync("INSERT INTO pms.login_attempts (username, ip, success) VALUES (@username, @ip::inet, true)", new { username, ip = ip?.ToString() }, tx);
        await c.ExecuteAsync("""
            INSERT INTO pms.audit_log (user_id, username, device_id, hostname, ip, action, entity_type, entity_id)
            VALUES (@uid, @username, @deviceId, @deviceName, @ip::inet, 'auth.login', 'session', @sid)
            """, new { uid = user.Id, username = user.Username, deviceId, deviceName, ip = ip?.ToString(), sid = sessionId.ToString() }, tx);
        await tx.CommitAsync(ct);

        var current = await LoadUserAsync(c, sessionId, user.Id, deviceId, ct);
        log.LogInformation("Oturum açıldı {Username} cihaz {DeviceId}", user.Username, deviceId);
        return new LoginResult(token, current, expires);
    }

    public async Task<CurrentUser?> ResolveAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 100) return null;
        if (_cache.TryGetValue(token, out var hit) && hit.Until > DateTime.UtcNow) return hit.User;

        await using var c = await db.OpenAsync(ct);
        var s = await c.QuerySingleOrDefaultAsync<SessionRow>("""
            SELECT s.id, s.user_id, s.device_id, s.created_at, s.expires_at, s.revoked_at, u.is_active,
                   d.status AS device_status
            FROM pms.sessions s
            JOIN pms.users u ON u.id = s.user_id
            LEFT JOIN pms.devices d ON d.id = s.device_id
            WHERE s.token_hash = @hash
            """, new { hash = HashToken(token) });
        if (s is null || s.RevokedAt is not null || !s.IsActive || s.DeviceStatus == "revoked") return null;
        var now = DateTime.UtcNow;
        if (s.ExpiresAt < now || s.CreatedAt.Add(AbsoluteTimeout) < now) return null;

        // Kayan süre: aktivite oldukça uzar (en çok mutlak süreye kadar).
        await c.ExecuteAsync("""
            UPDATE pms.sessions SET last_seen_at = now(), expires_at = LEAST(now() + @idle, created_at + @abs) WHERE id = @id;
            UPDATE pms.devices SET last_seen_at = now() WHERE id = @deviceId;
            """, new { id = s.Id, idle = IdleTimeout, abs = AbsoluteTimeout, deviceId = s.DeviceId });
        var user = await LoadUserAsync(c, s.Id, s.UserId, s.DeviceId, ct);
        _cache[token] = (user, DateTime.UtcNow.AddSeconds(15));
        return user;
    }

    static async Task<CurrentUser> LoadUserAsync(Npgsql.NpgsqlConnection c, Guid sessionId, Guid userId, Guid? deviceId, CancellationToken ct)
    {
        var u = await c.QuerySingleAsync<(string Username, string FullName, bool MustChange)>(
            "SELECT username, full_name, must_change_password FROM pms.users WHERE id = @userId", new { userId });
        var roles = (await c.QueryAsync<string>("SELECT role_code FROM pms.user_roles WHERE user_id = @userId ORDER BY 1", new { userId })).ToList();
        var perms = (await c.QueryAsync<string>("""
            SELECT DISTINCT rp.permission_code FROM pms.user_roles ur
            JOIN pms.role_permissions rp ON rp.role_code = ur.role_code WHERE ur.user_id = @userId
            """, new { userId })).ToHashSet();
        return new CurrentUser(userId, u.Username, u.FullName, roles, perms, sessionId, deviceId, u.MustChange);
    }

    public async Task RevokeAsync(Guid sessionId, string reason, CancellationToken ct)
    {
        await using var c = await db.OpenAsync(ct);
        await c.ExecuteAsync("UPDATE pms.sessions SET revoked_at = now(), revoke_reason = @reason WHERE id = @sessionId AND revoked_at IS NULL",
            new { sessionId, reason });
        InvalidateCache();
    }

    public void InvalidateCache() => _cache.Clear();

    static string? Truncate(string? s, int n) => s is null ? null : s.Length <= n ? s : s[..n];

    sealed record UserRow(Guid Id, string Username, string FullName, string PasswordHash, bool IsActive, bool MustChangePassword,
        int FailedAttempts, DateTime? LockedUntil);

    sealed record SessionRow(Guid Id, Guid UserId, Guid? DeviceId, DateTime CreatedAt, DateTime ExpiresAt, DateTime? RevokedAt,
        bool IsActive, string? DeviceStatus);
}
