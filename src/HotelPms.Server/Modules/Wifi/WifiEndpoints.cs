using System.Net;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Wifi;

public sealed record WifiSettingsRequest(bool Enabled, string[]? AllowedClients, string PasswordMode, bool IncludeSharers, int GraceHours);
public sealed record WifiTestRequest(string? UserName, string? Password);
public sealed record WifiAttemptDto(DateTime At, string? NasIp, string? Mac, string? UsernameMasked, bool Accepted, string Reason, string? GuestName, string? RoomNumber);
public sealed record WifiSessionDto(DateTime StartedAt, DateTime? StoppedAt, DateTime UpdatedAt, string? GuestName, string? RoomNumber, string? Mac, string? FramedIp,
    string NasIp, long InputBytes, long OutputBytes, string? TerminateCause);

public static class WifiEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/wifi").WithTags("Wifi").RequirePermission("settings.manage");

        g.MapGet("/", async (Db db, WifiService wifi, ServerConfig config) =>
        {
            var cfg = await wifi.ConfigAsync();
            var attempts = await db.QueryAsync<WifiAttemptDto>("""
                SELECT a.at, host(a.nas_ip) AS nas_ip, a.mac, a.username_masked, a.accepted, a.reason, g.first_name || ' ' || g.last_name AS guest_name, rm.number AS room_number
                FROM pms.wifi_auth_log a LEFT JOIN pms.guests g ON g.id = a.guest_id
                LEFT JOIN pms.reservations r ON r.id = a.reservation_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
                ORDER BY a.id DESC LIMIT 50
                """);
            var sessions = await db.QueryAsync<WifiSessionDto>(SessionSelect + " WHERE s.stopped_at IS NULL AND s.updated_at > now() - interval '1 day' ORDER BY s.started_at DESC LIMIT 200");
            return new
            {
                cfg.Enabled, cfg.SharedSecret, cfg.AllowedClients, cfg.PasswordMode, cfg.IncludeSharers, cfg.GraceHours,
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
            var before = await tx.OneAsync<string>("SELECT row_to_json(w)::text FROM (SELECT enabled, allowed_clients, password_mode, include_sharers, grace_hours FROM pms.wifi_config WHERE id = 1) w");
            await tx.ExecAsync("""
                UPDATE pms.wifi_config SET enabled = @Enabled, allowed_clients = @clients, password_mode = @PasswordMode, include_sharers = @IncludeSharers,
                    grace_hours = @GraceHours, shared_secret = COALESCE(shared_secret, @secret), updated_at = now(), updated_by = @uid
                WHERE id = 1
                """, new { req.Enabled, clients, req.PasswordMode, req.IncludeSharers, req.GraceHours, secret = WifiService.NewSecret(), uid = tx.User.Id });
            await tx.AuditAsync("wifi.update", "wifi", "config", before, new { req.Enabled, clients, req.PasswordMode, req.IncludeSharers, req.GraceHours });
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

        // Resepsiyonun misafirin bilgilerini cihaza gitmeden denemesi: aynı kurallar, kayıt tutulmaz, hatalı deneme sınırına sayılmaz.
        g.MapPost("/test", async (WifiTestRequest req, WifiService wifi) =>
        {
            var r = await wifi.AuthenticateAsync(req.UserName, req.Password ?? "", null, "test|" + Guid.NewGuid(), requireEnabled: false);
            return new { r.Accepted, r.Reason, r.Message, r.GuestName, r.RoomNumber, ValidUntil = r.Accepted ? DateTime.UtcNow.AddSeconds(r.SessionTimeoutSeconds) : (DateTime?)null };
        });
    }

    public const string SessionSelect = """
        SELECT s.started_at, s.stopped_at, s.updated_at, g.first_name || ' ' || g.last_name AS guest_name, s.room_number, s.mac, host(s.framed_ip) AS framed_ip,
               host(s.nas_ip) AS nas_ip, s.input_bytes, s.output_bytes, s.terminate_cause
        FROM pms.wifi_sessions s LEFT JOIN pms.guests g ON g.id = s.guest_id
        """;
}
