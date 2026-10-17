using System.Net;
using System.Net.Sockets;
using System.Text;
using Dapper;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Wifi;

/// <summary>
/// Otelin hotspot cihazının sorduğu RADIUS isteklerini yanıtlar. Yalnız Wi-Fi girişi açıkken dinler; yalnız yerel ağdan
/// (ve tanımlıysa izin verilen cihaz IP'lerinden) gelen, ortak anahtarla doğrulanan paketlere yanıt verir.
/// </summary>
public sealed class RadiusServer(WifiService wifi, Db db, ServerConfig config, ILogger<RadiusServer> log) : BackgroundService
{
    public static volatile string Status = "Kapalı";
    public static DateTime? LastRequestAt;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        UdpClient? auth = null, acct = null;
        Task? loopA = null, loopB = null;
        CancellationTokenSource? loopCts = null;
        while (!ct.IsCancellationRequested)
        {
            WifiConfig cfg;
            try { cfg = await wifi.ConfigAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogDebug(ex, "Wi-Fi ayarı okunamadı"); await Delay(ct); continue; }

            var want = cfg.Enabled && !string.IsNullOrEmpty(cfg.SharedSecret);
            if (want && auth is null)
            {
                try
                {
                    auth = Bind(config.RadiusAuthPort);
                    acct = Bind(config.RadiusAcctPort);
                    loopCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    loopA = Loop(auth, isAccounting: false, loopCts.Token);
                    loopB = Loop(acct, isAccounting: true, loopCts.Token);
                    Status = $"Dinliyor: UDP {config.RadiusAuthPort} (giriş), {config.RadiusAcctPort} (oturum kaydı)";
                    log.LogInformation("Wi-Fi RADIUS sunucusu UDP {Auth}/{Acct} üzerinde dinliyor", config.RadiusAuthPort, config.RadiusAcctPort);
                }
                catch (SocketException ex)
                {
                    auth?.Dispose(); acct?.Dispose(); auth = acct = null;
                    Status = $"Port açılamadı (UDP {config.RadiusAuthPort}/{config.RadiusAcctPort}): {ex.Message}. Başka bir RADIUS programı çalışıyor olabilir.";
                    log.LogWarning(ex, "Wi-Fi RADIUS portları açılamadı");
                }
            }
            else if (!want && auth is not null)
            {
                await Stop();
                Status = "Kapalı";
                log.LogInformation("Wi-Fi RADIUS sunucusu durduruldu");
            }
            await Delay(ct);
        }
        await Stop();

        async Task Stop()
        {
            loopCts?.Cancel();
            auth?.Dispose(); acct?.Dispose(); auth = acct = null;
            try { if (loopA is not null) await loopA; if (loopB is not null) await loopB; } catch (Exception) { /* kapanış */ }
            loopA = loopB = null;
        }
    }

    static Task Delay(CancellationToken ct) => Task.Delay(TimeSpan.FromSeconds(2), ct).ContinueWith(_ => { }, TaskScheduler.Default);

    static UdpClient Bind(int port)
    {
        var u = new UdpClient(AddressFamily.InterNetwork);
        u.Client.Bind(new IPEndPoint(IPAddress.Any, port));
        return u;
    }

    async Task Loop(UdpClient udp, bool isAccounting, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            UdpReceiveResult r;
            try { r = await udp.ReceiveAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (SocketException) { continue; }
            try
            {
                var reply = await HandleAsync(r.Buffer, r.RemoteEndPoint.Address, isAccounting, ct);
                if (reply is not null) await udp.SendAsync(reply, r.RemoteEndPoint, ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogWarning(ex, "RADIUS isteği işlenemedi ({From})", r.RemoteEndPoint); }
        }
    }

    /// <summary>Tek bir RADIUS paketini işler; yanıt yoksa (sessizce atılan paket) null döner.</summary>
    public async Task<byte[]?> HandleAsync(byte[] raw, IPAddress from, bool isAccounting, CancellationToken ct)
    {
        var cfg = await wifi.ConfigAsync(ct);
        if (!cfg.Enabled || string.IsNullOrEmpty(cfg.SharedSecret)) return null;
        if (from.IsIPv4MappedToIPv6) from = from.MapToIPv4();
        if (!IsLocalNetwork(from)) return null;
        if (cfg.AllowedClients.Length > 0 && !cfg.AllowedClients.Contains(from.ToString())) return null;
        var p = RadiusPacket.Parse(raw);
        if (p is null) return null;
        var secret = Encoding.UTF8.GetBytes(cfg.SharedSecret);
        LastRequestAt = DateTime.UtcNow;
        var nas = p.GetIp(RadiusPacket.AttrNasIp) ?? from.ToString();

        if (!isAccounting && p.Code == RadiusPacket.AccessRequest)
        {
            if (!RadiusPacket.MessageAuthenticatorValid(raw, p, secret)) return null;
            var user = p.GetString(RadiusPacket.AttrUserName);
            var mac = WifiService.Mac(p.GetString(RadiusPacket.AttrCallingStationId));
            string? password = null;
            Func<string, bool>? chap = null;
            if (p.Get(RadiusPacket.AttrUserPassword) is { } enc) password = RadiusPacket.DecryptPap(enc, p.Authenticator, secret);
            else if (p.Get(RadiusPacket.AttrChapPassword) is { } cp)
            {
                var challenge = p.Get(RadiusPacket.AttrChapChallenge) ?? p.Authenticator;
                chap = cand => RadiusPacket.ChapMatches(cp, challenge, cand);
            }
            var key = $"{from}|{mac ?? WifiService.NormalizeUser(user)}";
            var res = password is null && chap is null
                ? new WifiAuthResult(false, "unsupported_method", "Desteklenmeyen giriş yöntemi (PAP veya CHAP kullanın).")
                : await wifi.AuthenticateAsync(user, password, chap, key, ct);
            await wifi.LogAttemptAsync(nas, mac, user, res, ct);
            var attrs = new List<(byte, byte[])> { (RadiusPacket.AttrReplyMessage, RadiusPacket.Str(res.Message)) };
            if (res.Accepted)
            {
                attrs.Add((RadiusPacket.AttrSessionTimeout, RadiusPacket.UInt((uint)res.SessionTimeoutSeconds)));
                attrs.Add((RadiusPacket.AttrClass, Encoding.ASCII.GetBytes($"PMS:{res.ReservationId:N}:{res.GuestId:N}")));
            }
            return RadiusPacket.BuildResponse(res.Accepted ? RadiusPacket.AccessAccept : RadiusPacket.AccessReject, p, secret, attrs, addMessageAuthenticator: true);
        }

        if (isAccounting && p.Code == RadiusPacket.AccountingRequest)
        {
            if (!RadiusPacket.AccountingRequestValid(raw, secret)) return null;
            await RecordAccountingAsync(p, nas, ct);
            return RadiusPacket.BuildResponse(RadiusPacket.AccountingResponse, p, secret, [], addMessageAuthenticator: false);
        }
        return null;
    }

    async Task RecordAccountingAsync(RadiusPacket p, string nas, CancellationToken ct)
    {
        var status = p.GetUInt(RadiusPacket.AttrAcctStatusType);
        if (status is 7 or 8) // Accounting-On / Off: cihaz yeniden başladı; açık oturumlar kapanır
        {
            await using var c = await db.OpenAsync(ct);
            await c.ExecuteAsync(new CommandDefinition(
                "UPDATE pms.wifi_sessions SET stopped_at = now(), updated_at = now(), terminate_cause = 'NAS yeniden başladı' WHERE nas_ip = @nas::inet AND stopped_at IS NULL",
                new { nas }, cancellationToken: ct));
            return;
        }
        if (status is not (1 or 2 or 3)) return;
        var sid = p.GetString(RadiusPacket.AttrAcctSessionId);
        if (string.IsNullOrWhiteSpace(sid)) return;
        Guid? rid = null, gid = null;
        if (p.GetString(RadiusPacket.AttrClass) is { } cls && cls.StartsWith("PMS:"))
        {
            var parts = cls.Split(':');
            if (parts.Length == 3 && Guid.TryParse(parts[1], out var a) && Guid.TryParse(parts[2], out var b)) { rid = a; gid = b; }
        }
        long Octets(byte low, byte giga) => (long)(p.GetUInt(giga) ?? 0) * 4294967296L + (p.GetUInt(low) ?? 0);
        var cause = p.GetUInt(RadiusPacket.AttrAcctTerminateCause) is { } tc ? TerminateCause(tc) : null;
        await wifi.RecordSessionAsync(nas, sid, p.GetString(RadiusPacket.AttrUserName), gid, rid, p.GetString(RadiusPacket.AttrCallingStationId),
            p.GetIp(RadiusPacket.AttrFramedIp), Octets(RadiusPacket.AttrAcctInputOctets, RadiusPacket.AttrAcctInputGigawords),
            Octets(RadiusPacket.AttrAcctOutputOctets, RadiusPacket.AttrAcctOutputGigawords), status == 2, cause, ct);
    }

    static string TerminateCause(uint v) => v switch
    {
        1 => "Kullanıcı çıkış yaptı", 2 => "Bağlantı koptu", 4 => "Boşta kalma süresi", 5 => "Oturum süresi doldu", 6 => "Yönetici kapattı",
        10 => "Cihaz isteği", 11 => "Cihaz yeniden başladı", _ => $"Kod {v}",
    };

    public static bool IsLocalNetwork(IPAddress a)
    {
        if (IPAddress.IsLoopback(a)) return true;
        if (a.AddressFamily != AddressFamily.InterNetwork) return false;
        var b = a.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }
}
