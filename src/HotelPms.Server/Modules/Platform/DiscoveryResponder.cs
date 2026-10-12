using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using HotelPms.Shared;

namespace HotelPms.Server.Modules.Platform;

/// <summary>
/// LAN keşfi: istemci UDP broadcast ile "HOTELPMS_DISCOVER_V1" gönderir; sunucu adını, HTTPS portunu, sürümünü ve
/// yerel CA parmak izini döner. Yanıt kişisel veya gizli veri içermez. Yalnız yerel ağ (RFC1918/link-local) isteklerine yanıt verilir.
/// </summary>
public sealed class DiscoveryResponder(ServerConfig config, PmsPaths paths, ILogger<DiscoveryResponder> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        UdpClient udp;
        try
        {
            udp = new UdpClient(AddressFamily.InterNetwork);
            udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            udp.Client.Bind(new IPEndPoint(IPAddress.Any, config.DiscoveryPort));
        }
        catch (SocketException ex)
        {
            log.LogWarning(ex, "Keşif portu {Port} açılamadı; istemciler sunucuya IP ile bağlanabilir.", config.DiscoveryPort);
            return;
        }
        using (udp)
        {
            log.LogInformation("LAN keşif yanıtlayıcısı UDP {Port} üzerinde dinliyor", config.DiscoveryPort);
            while (!ct.IsCancellationRequested)
            {
                UdpReceiveResult r;
                try { r = await udp.ReceiveAsync(ct); }
                catch (OperationCanceledException) { break; }
                catch (SocketException) { continue; }
                if (!IsLocalNetwork(r.RemoteEndPoint.Address)) continue;
                if (Encoding.ASCII.GetString(r.Buffer).Trim() != PmsConstants.DiscoveryRequest) continue;
                string? fp = null;
                try { if (File.Exists(paths.CaCertFile)) fp = new CertificateManager(paths, new SecretStore(paths)).CaFingerprintSha256(); }
                catch (Exception ex) when (ex is IOException or global::System.Security.Cryptography.CryptographicException) { }
                var payload = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    product = PmsConstants.ProductName,
                    name = config.ServerName,
                    hostname = Environment.MachineName,
                    httpsPort = config.HttpsPort,
                    version = PmsConstants.VersionText,
                    addresses = CertificateManager.LocalAddresses().Select(a => a.ToString()),
                    caFingerprint = fp,
                });
                try { await udp.SendAsync(payload, r.RemoteEndPoint, ct); }
                catch (SocketException) { }
            }
        }
    }

    static bool IsLocalNetwork(IPAddress a)
    {
        if (IPAddress.IsLoopback(a)) return true;
        var b = a.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }
}
