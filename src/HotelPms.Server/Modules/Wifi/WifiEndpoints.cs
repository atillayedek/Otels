using System.Net;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Wifi;

public sealed record WifiSettingsRequest(bool Enabled, string[]? AllowedClients, string PasswordMode, bool IncludeSharers, int GraceHours, string? ProviderName = null);
/// <summary>Hotspot firmasının HTTP API ile doğrulama isteği.</summary>
public sealed record WifiVerifyRequest(string? UserName, string? Password, string? Mac, string? Ip);
/// <summary>Hotspot firmasının HTTP API ile oturum bildirimi. Event: start | update | stop.</summary>
public sealed record WifiSessionReport(string? SessionId, string? Event, string? UserName, string? Mac, string? Ip, long? InputBytes, long? OutputBytes, string? Cause);
public sealed record WifiTestRequest(string? UserName, string? Password);
public sealed record WifiAttemptDto(DateTime At, string? NasIp, string? Mac, string? UsernameMasked, bool Accepted, string Reason, string? GuestName, string? RoomNumber);
public sealed record WifiSessionDto(DateTime StartedAt, DateTime? StoppedAt, DateTime UpdatedAt, string? GuestName, string? RoomNumber, string? Mac, string? FramedIp,
    string NasIp, long InputBytes, long OutputBytes, string? TerminateCause);

public static class WifiEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/wifi").WithTags("Wifi").RequirePermission("settings.manage");

        g.MapGet("/", async (Db db, WifiService wifi, ServerConfig config, PmsPaths paths) =>
        {
            var cfg = await wifi.ConfigAsync();
            var attempts = await db.QueryAsync<WifiAttemptDto>("""
                SELECT a.at, host(a.nas_ip) AS nas_ip, a.mac, a.username_masked, a.accepted, a.reason, g.first_name || ' ' || g.last_name AS guest_name, rm.number AS room_number
                FROM pms.wifi_auth_log a LEFT JOIN pms.guests g ON g.id = a.guest_id
                LEFT JOIN pms.reservations r ON r.id = a.reservation_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                ORDER BY a.id DESC LIMIT 50
                """);
            var sessions = await db.QueryAsync<WifiSessionDto>(SessionSelect + " WHERE s.stopped_at IS NULL AND s.updated_at > now() - interval '1 day' ORDER BY s.started_at DESC LIMIT 200");
            string? fp = null;
            try { if (File.Exists(paths.CaCertFile)) fp = new CertificateManager(paths, new SecretStore(paths)).CaFingerprintSha256(); }
            catch (Exception ex) when (ex is IOException or System.Security.Cryptography.CryptographicException) { }
            return new
            {
                cfg.Enabled, cfg.SharedSecret, cfg.AllowedClients, cfg.PasswordMode, cfg.IncludeSharers, cfg.GraceHours, cfg.ProviderName,
                cfg.ApiKeyHint, cfg.ApiKeyCreatedAt, HttpsPort = config.HttpsPort, CaFingerprint = fp,
                AuthPort = config.RadiusAuthPort, AcctPort = config.RadiusAcctPort, Status = RadiusServer.Status, RadiusServer.LastRequestAt,
                Addresses = CertificateManager.LocalAddresses().Select(a => a.ToString()).ToList(),
                Attempts = attempts, ActiveSessions = sessions,
            };
        });

        g.MapPut("/", (WifiSettingsRequest req, CommandRunner cmd, WifiService wifi) => cmd.RunAsync("wifi.update", req, async tx =>
        {
            if (req.PasswordMode is not ("room" or "last_name")) throw PmsException.Validation("Geçersiz şifre türü.");
            if (req.GraceHours is < 0 or > 24) throw PmsException.Validation("Çıkıştan sonraki ek süre 0 ile 24 saat arasında olmalıdır.");
            var clients = (req.AllowedClients ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToArray();
            if (clients.Length > 20) throw PmsException.Validation("En fazla 20 cihaz adresi girilebilir.");
            foreach (var c in clients)
                if (!IPAddress.TryParse(c, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                    throw PmsException.Validation($"Geçersiz IPv4 adresi: {c}");
            var provider = Validate.Optional(req.ProviderName, 120);
            var before = await tx.OneAsync<string>("SELECT row_to_json(w)::text FROM (SELECT enabled, allowed_clients, password_mode, include_sharers, grace_hours, provider_name FROM pms.wifi_config WHERE id = 1) w");
            await tx.ExecAsync("""
                UPDATE pms.wifi_config SET enabled = @Enabled, allowed_clients = @clients, password_mode = @PasswordMode, include_sharers = @IncludeSharers,
                    grace_hours = @GraceHours, provider_name = @provider, shared_secret = COALESCE(shared_secret, @secret), updated_at = now(), updated_by = @uid
                WHERE id = 1
                """, new { req.Enabled, clients, req.PasswordMode, req.IncludeSharers, req.GraceHours, provider, secret = WifiService.NewSecret(), uid = tx.User.Id });
            await tx.AuditAsync("wifi.update", "wifi", "config", before, new { req.Enabled, clients, req.PasswordMode, req.IncludeSharers, req.GraceHours, provider });
            wifi.Invalidate();
            return new { ok = true };
        }, requireKey: false));

        g.MapPost("/secret", (CommandRunner cmd, WifiService wifi) => cmd.RunAsync("wifi.secret", new { }, async tx =>
        {
            await tx.ExecAsync("UPDATE pms.wifi_config SET shared_secret = @s, updated_at = now(), updated_by = @uid WHERE id = 1", new { s = WifiService.NewSecret(), uid = tx.User.Id });
            await tx.AuditAsync("wifi.secret_rotate", "wifi", "config", null, null, "Ortak anahtar yenilendi");
            wifi.Invalidate();
            return new { ok = true };
        }, requireKey: false));

        // HTTP API anahtarı: yalnız bir kez gösterilir, sunucuda özeti saklanır. Yeni anahtar eskisini geçersiz kılar.
        g.MapPost("/api-key", (CommandRunner cmd, WifiService wifi) => cmd.RunAsync("wifi.api_key", new { }, async tx =>
        {
            var key = WifiService.NewApiKey();
            await tx.ExecAsync("UPDATE pms.wifi_config SET api_key_hash = @h, api_key_hint = @hint, api_key_created_at = now(), updated_at = now(), updated_by = @uid WHERE id = 1",
                new { h = WifiService.HashKey(key), hint = key[..9] + "…", uid = tx.User.Id });
            await tx.AuditAsync("wifi.api_key_create", "wifi", "config", null, null, "Wi-Fi API anahtarı oluşturuldu");
            wifi.Invalidate();
            return new { apiKey = key };
        }, requireKey: false));
        g.MapDelete("/api-key", (CommandRunner cmd, WifiService wifi) => cmd.RunAsync("wifi.api_key_revoke", new { }, async tx =>
        {
            await tx.ExecAsync("UPDATE pms.wifi_config SET api_key_hash = NULL, api_key_hint = NULL, api_key_created_at = NULL, updated_at = now(), updated_by = @uid WHERE id = 1", new { uid = tx.User.Id });
            await tx.AuditAsync("wifi.api_key_revoke", "wifi", "config", null, null, "Wi-Fi API anahtarı iptal edildi");
            wifi.Invalidate();
            return new { ok = true };
        }, requireKey: false));

        // ---- Hotspot firmasının çağırdığı HTTP API (oturum gerekmez; X-PMS-Api-Key başlığı ve yerel ağ şartı)
        var gw = app.MapGroup("/api/v1/wifi-gateway").WithTags("WifiGateway").AllowAnonymousPms();

        gw.MapPost("/verify", async (WifiVerifyRequest req, HttpContext http, WifiService wifi, CancellationToken ct) =>
        {
            var caller = await GatewayCallerAsync(http, wifi, ct);
            var key = $"api|{caller}|{WifiService.Mac(req.Mac) ?? WifiService.NormalizeUser(req.UserName)}";
            var r = await wifi.AuthenticateAsync(req.UserName, req.Password ?? "", null, key, ct);
            await wifi.LogAttemptAsync(caller, req.Mac, req.UserName, r, ct);
            return new
            {
                r.Accepted, r.Reason, r.Message, GuestFirstName = r.GuestName?.Split(' ')[0], r.RoomNumber,
                ValidUntil = r.Accepted ? DateTime.UtcNow.AddSeconds(r.SessionTimeoutSeconds) : (DateTime?)null, SessionSeconds = r.Accepted ? r.SessionTimeoutSeconds : 0,
            };
        });

        gw.MapPost("/sessions", async (WifiSessionReport req, HttpContext http, WifiService wifi, CancellationToken ct) =>
        {
            var caller = await GatewayCallerAsync(http, wifi, ct);
            var sid = (req.SessionId ?? "").Trim();
            if (sid.Length is 0 or > 64) throw PmsException.Validation("sessionId zorunludur (en fazla 64 karakter).");
            if (req.Event is not ("start" or "update" or "stop")) throw PmsException.Validation("event start, update veya stop olmalıdır.");
            if (req.Ip is { Length: > 0 } ip && !IPAddress.TryParse(ip, out _)) throw PmsException.Validation("ip geçerli bir IP adresi olmalıdır.");
            await wifi.RecordSessionAsync(caller, sid, req.UserName, null, null, req.Mac, string.IsNullOrWhiteSpace(req.Ip) ? null : req.Ip.Trim(),
                req.InputBytes ?? 0, req.OutputBytes ?? 0, req.Event == "stop", Validate.Optional(req.Cause, 100), ct);
            return new { ok = true };
        });

        // Resepsiyonun misafirin bilgilerini cihaza gitmeden denemesi: aynı kurallar, kayıt tutulmaz, hatalı deneme sınırına sayılmaz.
        g.MapPost("/test", async (WifiTestRequest req, WifiService wifi) =>
        {
            var r = await wifi.AuthenticateAsync(req.UserName, req.Password ?? "", null, "test|" + Guid.NewGuid(), requireEnabled: false);
            return new { r.Accepted, r.Reason, r.Message, r.GuestName, r.RoomNumber, ValidUntil = r.Accepted ? DateTime.UtcNow.AddSeconds(r.SessionTimeoutSeconds) : (DateTime?)null };
        });
    }

    /// <summary>Hotspot firmasının isteğini denetler: entegrasyon açık, yerel ağ, (tanımlıysa) izinli IP ve geçerli API anahtarı.</summary>
    static async Task<string> GatewayCallerAsync(HttpContext http, WifiService wifi, CancellationToken ct)
    {
        var cfg = await wifi.ConfigAsync(ct);
        var ip = http.Connection.RemoteIpAddress is { } a && a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : http.Connection.RemoteIpAddress;
        if (!cfg.Enabled) throw new PmsException(403, "wifi_disabled", "Wi-Fi entegrasyonu otelde kapalı.");
        if (ip is null || !RadiusServer.IsLocalNetwork(ip)) throw new PmsException(403, "wifi_network", "Wi-Fi entegrasyonu yalnız otelin yerel ağından kullanılabilir.");
        if (cfg.AllowedClients.Length > 0 && !cfg.AllowedClients.Contains(ip.ToString()))
            throw new PmsException(403, "wifi_client", "Bu cihazın IP adresi Wi-Fi entegrasyonunda izinli değil.");
        if (!WifiService.ApiKeyMatches(cfg, http.Request.Headers["X-PMS-Api-Key"].ToString()))
            throw new PmsException(401, "wifi_api_key", "Geçersiz veya eksik API anahtarı (X-PMS-Api-Key).");
        return ip.ToString();
    }

    public const string SessionSelect = """
        SELECT s.started_at, s.stopped_at, s.updated_at, g.first_name || ' ' || g.last_name AS guest_name, s.room_number, s.mac, host(s.framed_ip) AS framed_ip,
               host(s.nas_ip) AS nas_ip, s.input_bytes, s.output_bytes, s.terminate_cause
        FROM pms.wifi_sessions s LEFT JOIN pms.guests g ON g.id = s.guest_id
        """;
}
