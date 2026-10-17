using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Wifi;

/// <summary>
/// Otomatik gönderim: konaklayan misafirlerin Wi-Fi giriş bilgilerini (kimlik no + oda no) Wi-Fi firmasının otel ağındaki adresine bildirir.
/// Her birkaç saniyede güncel konaklayan listesi, en son başarıyla bildirilen durumla karşılaştırılır; giriş, değişiklik ve çıkış
/// olayları HMAC-SHA256 ile imzalı JSON olarak gönderilir. Başarısız gönderim bir sonraki turda yeniden denenir (veri kaybolmaz).
/// Kimlik numarası içerdiği için adres yalnız yerel ağ (RFC1918/loopback) olabilir; internete gönderilmez.
/// </summary>
public sealed class WifiPushService(WifiService wifi, Db db, ILogger<WifiPushService> log) : BackgroundService
{
    public static volatile string Status = "Kapalı";
    public static DateTime? LastSuccessAt;
    DateTime retryAfter = DateTime.MinValue;

    static readonly HttpClient Strict = new() { Timeout = TimeSpan.FromSeconds(10) };
    static readonly HttpClient Insecure = new(new SocketsHttpHandler
    {
        // Yalnız kullanıcı açıkça işaretlediğinde ve yerel ağ adresinde (kendinden imzalı cihaz sertifikası).
        SslOptions = { RemoteCertificateValidationCallback = (_, _, _, _) => true },
    }) { Timeout = TimeSpan.FromSeconds(10) };

    sealed record StateRow(Guid ReservationId, Guid GuestId, string IdentityNumber, string RoomNumber, string Password, DateTime ValidUntil);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await CycleAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex) { Status = "Hata: " + ex.Message; log.LogWarning(ex, "Wi-Fi otomatik gönderim turu başarısız"); }
            try { await Task.Delay(TimeSpan.FromSeconds(3), ct); } catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>Tek tur: farkları bulur ve gönderir. Test ve "şimdi gönder" için de çağrılır.</summary>
    public async Task CycleAsync(CancellationToken ct)
    {
        var cfg = await wifi.ConfigAsync(ct);
        if (!cfg.Enabled || string.IsNullOrWhiteSpace(cfg.WebhookUrl) || string.IsNullOrEmpty(cfg.WebhookSecret)) { Status = "Kapalı"; return; }
        if (DateTime.UtcNow < retryAfter) return;
        Uri url;
        try { url = await ValidateLocalUrlAsync(cfg.WebhookUrl, ct); }
        catch (PmsException ex) { Status = "Adres geçersiz: " + ex.Message; return; }

        var desired = (await wifi.InHouseAsync(ct)).ToDictionary(x => (x.ReservationId, x.GuestId));
        await using var c = await db.OpenAsync(ct);
        var state = (await c.QueryAsync<StateRow>(new CommandDefinition(
            "SELECT reservation_id, guest_id, identity_number, room_number, password, valid_until FROM pms.wifi_push_state", cancellationToken: ct)))
            .ToDictionary(x => (x.ReservationId, x.GuestId));

        var work = new List<(string Event, WifiInHouse? Now, StateRow? Old)>();
        foreach (var (k, now) in desired)
        {
            if (!state.TryGetValue(k, out var old)) work.Add(("checkin", now, null));
            else if (old.IdentityNumber != now.IdentityNumber || old.RoomNumber != now.RoomNumber || old.Password != now.Password
                     || Math.Abs((old.ValidUntil - now.ValidUntil).TotalSeconds) > 1) work.Add(("update", now, old));
        }
        foreach (var (k, old) in state) if (!desired.ContainsKey(k)) work.Add(("checkout", null, old));

        var sent = 0;
        foreach (var w in work.Take(100))
        {
            var payload = w.Now is { } n
                ? new { @event = w.Event, deliveryId = Guid.NewGuid(), sentAt = DateTime.UtcNow, userName = n.IdentityNumber, password = n.Password,
                        roomNumber = n.RoomNumber, guestFirstName = n.FirstName, validUntil = n.ValidUntil, reservationNumber = n.ReservationNumber,
                        previousUserName = w.Old?.IdentityNumber, previousRoomNumber = w.Old?.RoomNumber }
                : new { @event = w.Event, deliveryId = Guid.NewGuid(), sentAt = DateTime.UtcNow, userName = w.Old!.IdentityNumber, password = w.Old.Password,
                        roomNumber = w.Old.RoomNumber, guestFirstName = (string?)null, validUntil = DateTime.UtcNow, reservationNumber = (string?)null,
                        previousUserName = (string?)null, previousRoomNumber = (string?)null };
            var body = JsonSerializer.Serialize(payload);
            var (code, error) = await SendAsync(url, cfg, w.Event, payload.deliveryId, body, ct);
            await c.ExecuteAsync(new CommandDefinition(
                "INSERT INTO pms.wifi_push_log (event, room_number, username_masked, status_code, error) VALUES (@e, @room, @user, @code, @error)",
                new { e = w.Event, room = payload.roomNumber, user = Validate.Mask(payload.userName), code, error }, cancellationToken: ct));
            if (error is not null)
            {
                Status = $"Gönderilemedi ({error}). {DateTime.Now:HH:mm:ss} itibarıyla 30 sn sonra yeniden denenecek.";
                retryAfter = DateTime.UtcNow.AddSeconds(30);
                return;
            }
            if (w.Now is { } x)
                await c.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO pms.wifi_push_state (reservation_id, guest_id, identity_number, room_number, password, valid_until)
                    VALUES (@ReservationId, @GuestId, @IdentityNumber, @RoomNumber, @Password, @ValidUntil)
                    ON CONFLICT (reservation_id, guest_id) DO UPDATE SET identity_number = EXCLUDED.identity_number, room_number = EXCLUDED.room_number,
                        password = EXCLUDED.password, valid_until = EXCLUDED.valid_until, sent_at = now()
                    """, x, cancellationToken: ct));
            else
                await c.ExecuteAsync(new CommandDefinition("DELETE FROM pms.wifi_push_state WHERE reservation_id = @r AND guest_id = @g",
                    new { r = w.Old!.ReservationId, g = w.Old.GuestId }, cancellationToken: ct));
            sent++;
        }
        if (sent > 0) LastSuccessAt = DateTime.UtcNow;
        Status = $"Etkin: {desired.Count} kişi Wi-Fi sistemine bildirili";
    }

    static async Task<(int? Code, string? Error)> SendAsync(Uri url, WifiConfig cfg, string ev, Guid delivery, string body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        var sig = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(cfg.WebhookSecret!), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        req.Headers.Add("X-PMS-Event", ev);
        req.Headers.Add("X-PMS-Delivery", delivery.ToString());
        req.Headers.Add("X-PMS-Signature", "sha256=" + sig);
        try
        {
            using var res = await (cfg.WebhookInsecureTls ? Insecure : Strict).SendAsync(req, ct);
            return res.IsSuccessStatusCode ? ((int)res.StatusCode, null) : ((int)res.StatusCode, $"HTTP {(int)res.StatusCode}");
        }
        catch (HttpRequestException ex) { return (null, ex.Message); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return (null, "Zaman aşımı (10 sn)"); }
    }

    /// <summary>Adres http/https olmalı ve yalnız yerel ağdaki bir adrese çözülmelidir (kimlik numaraları internete gönderilmez).</summary>
    public static async Task<Uri> ValidateLocalUrlAsync(string raw, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps))
            throw PmsException.Validation("Adres http:// veya https:// ile başlayan tam bir adres olmalıdır.");
        IPAddress[] ips;
        if (IPAddress.TryParse(u.Host, out var lit)) ips = [lit];
        else
        {
            try { ips = await Dns.GetHostAddressesAsync(u.Host, ct); }
            catch (SocketException) { throw PmsException.Validation($"{u.Host} adı çözümlenemedi."); }
        }
        if (ips.Length == 0 || !ips.All(a => RadiusServer.IsLocalNetwork(a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a)))
            throw PmsException.Validation("Misafir kimlik numaraları yalnız otelin yerel ağındaki bir adrese gönderilebilir (ör. 192.168.x.x, 10.x.x.x). İnternet adresi kabul edilmez.");
        return u;
    }
}
