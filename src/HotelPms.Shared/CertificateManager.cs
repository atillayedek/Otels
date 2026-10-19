using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace HotelPms.Shared;

/// <summary>
/// Otel içi yerel sertifika otoritesi. Kurulumda bir kez CA üretilir; sunucu sertifikası hostname ve
/// yerel IP adresleri için bu CA ile imzalanır. Özel anahtarlar parola korumalı PFX olarak saklanır,
/// PFX parolası DPAPI SecretStore'dadır. CA'nın yalnız açık sertifikası (.crt) istemcilere dağıtılır.
/// </summary>
public sealed class CertificateManager
{
    readonly PmsPaths _paths;
    readonly SecretStore _secrets;

    public CertificateManager(PmsPaths paths, SecretStore secrets)
    {
        _paths = paths;
        _secrets = secrets;
    }

    public bool HasServerCertificate => File.Exists(_paths.ServerPfxFile) && File.Exists(_paths.CaCertFile);

    /// <summary>Sunucu sertifikası bilgisayarın şu anki IP adreslerini ve adını kapsıyor ve 30 günden uzun geçerli mi.</summary>
    public bool ServerCertificateUpToDate() => File.Exists(_paths.ServerPfxFile) && ServerCertCoversCurrentAddresses(_secrets.Get(SecretStore.CertPassword));

    public X509Certificate2 LoadServerCertificate()
    {
        var pwd = _secrets.Get(SecretStore.CertPassword);
        // Windows SChannel geçici (ephemeral) anahtarla TLS yapamaz; varsayılan anahtar deposu kullanılır.
        return X509CertificateLoader.LoadPkcs12FromFile(_paths.ServerPfxFile, pwd, X509KeyStorageFlags.DefaultKeySet);
    }

    public string CaFingerprintSha256()
    {
        using var ca = X509CertificateLoader.LoadCertificateFromFile(_paths.CaCertFile);
        return Convert.ToHexString(ca.GetCertHash(HashAlgorithmName.SHA256));
    }

    /// <summary>CA yoksa üretir, sunucu sertifikasını (yeniden) üretir. IP adresi değiştiğinde de çağrılır.</summary>
    public void EnsureCertificates(bool forceServerRenew = false)
    {
        Directory.CreateDirectory(_paths.CertsDir);
        var pwd = _secrets.GetOrCreate(SecretStore.CertPassword);
        X509Certificate2 ca;
        if (File.Exists(_paths.CaPfxFile))
        {
            ca = X509CertificateLoader.LoadPkcs12FromFile(_paths.CaPfxFile, pwd,
                X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
        }
        else
        {
            ca = CreateCa();
            File.WriteAllBytes(_paths.CaPfxFile, ca.Export(X509ContentType.Pkcs12, pwd));
            File.WriteAllText(_paths.CaCertFile, ca.ExportCertificatePem());
        }

        using (ca)
        {
            if (!forceServerRenew && File.Exists(_paths.ServerPfxFile) && ServerCertCoversCurrentAddresses(pwd)) return;
            using var server = CreateServerCert(ca);
            var tmp = _paths.ServerPfxFile + ".tmp";
            File.WriteAllBytes(tmp, server.Export(X509ContentType.Pkcs12, pwd));
            File.Move(tmp, _paths.ServerPfxFile, overwrite: true);
        }
    }

    bool ServerCertCoversCurrentAddresses(string pwd)
    {
        try
        {
            using var cert = X509CertificateLoader.LoadPkcs12FromFile(_paths.ServerPfxFile, pwd, X509KeyStorageFlags.EphemeralKeySet);
            if (cert.NotAfter < DateTime.Now.AddDays(30)) return false;
            var ext = cert.Extensions.OfType<X509SubjectAlternativeNameExtension>().FirstOrDefault();
            if (ext is null) return false;
            var ips = ext.EnumerateIPAddresses().Select(i => i.ToString()).ToHashSet();
            var dns = ext.EnumerateDnsNames().Select(d => d.ToLowerInvariant()).ToHashSet();
            return LocalAddresses().All(a => ips.Contains(a.ToString()))
                   && dns.Contains(Environment.MachineName.ToLowerInvariant());
        }
        catch (CryptographicException) { return false; }
    }

    static X509Certificate2 CreateCa()
    {
        using var key = RSA.Create(3072);
        var req = new CertificateRequest($"CN=HotelPMS Local CA ({Environment.MachineName}), O=HotelPMS",
            key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        var now = DateTimeOffset.UtcNow.AddMinutes(-5);
        return req.CreateSelfSigned(now, now.AddYears(15));
    }

    static X509Certificate2 CreateServerCert(X509Certificate2 ca)
    {
        using var key = RSA.Create(2048);
        var host = Environment.MachineName;
        var req = new CertificateRequest($"CN={host}, O=HotelPMS", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName(host);
        san.AddDnsName(host.ToLowerInvariant());
        san.AddDnsName("localhost");
        try
        {
            var fqdn = Dns.GetHostEntry(host).HostName;
            if (!string.Equals(fqdn, host, StringComparison.OrdinalIgnoreCase)) san.AddDnsName(fqdn);
        }
        catch (SocketException) { }
        san.AddIpAddress(IPAddress.Loopback);
        san.AddIpAddress(IPAddress.IPv6Loopback);
        foreach (var ip in LocalAddresses()) san.AddIpAddress(ip);
        req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        req.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            [new Oid("1.3.6.1.5.5.7.3.1")], false));
        req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
        req.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(ca, true, false));
        var now = DateTimeOffset.UtcNow.AddMinutes(-5);
        var serial = RandomNumberGenerator.GetBytes(16);
        serial[0] &= 0x7F;
        // Tarayıcılar 398 günden uzun sunucu sertifikasını reddedebilir.
        using var cert = req.Create(ca, now, now.AddDays(397), serial);
        return cert.CopyWithPrivateKey(key);
    }

    /// <summary>Etkin, loopback olmayan IPv4 adresleri.</summary>
    public static IReadOnlyList<IPAddress> LocalAddresses() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses)
            .Select(a => a.Address)
            .Where(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a))
            .Distinct()
            .ToList();
}
