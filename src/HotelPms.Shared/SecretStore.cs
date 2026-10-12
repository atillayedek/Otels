using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace HotelPms.Shared;

/// <summary>
/// Veritabanı parolaları ve yönetim anahtarı gibi gizli değerleri Windows DPAPI (LocalMachine) ile şifreli saklar.
/// Dosya kurulumda yalnız SYSTEM, Administrators ve servis hesabına ACL ile açılır.
/// Değerler hiçbir zaman loglanmaz.
/// </summary>
public sealed class SecretStore
{
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("HotelPMS.SecretStore.v1");
    readonly PmsPaths _paths;
    readonly object _lock = new();

    public SecretStore(PmsPaths paths) => _paths = paths;

    public const string DbSuperPassword = "db.super.password";
    public const string DbOwnerPassword = "db.owner.password";
    public const string DbAppPassword = "db.app.password";
    public const string CertPassword = "cert.pfx.password";
    public const string ManageToken = "manage.token";

    public bool Exists => File.Exists(_paths.SecretsFile);

    public Dictionary<string, string> ReadAll()
    {
        lock (_lock)
        {
            if (!File.Exists(_paths.SecretsFile)) return new();
            var cipher = File.ReadAllBytes(_paths.SecretsFile);
            var plain = ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.LocalMachine);
            try { return JsonSerializer.Deserialize<Dictionary<string, string>>(plain) ?? new(); }
            finally { CryptographicOperations.ZeroMemory(plain); }
        }
    }

    public string Get(string key) =>
        ReadAll().TryGetValue(key, out var v) ? v : throw new InvalidOperationException($"Gizli değer bulunamadı: {key}");

    public string? TryGet(string key) => ReadAll().TryGetValue(key, out var v) ? v : null;

    public void Set(string key, string value)
    {
        lock (_lock)
        {
            var all = ReadAll();
            all[key] = value;
            Directory.CreateDirectory(_paths.ConfigDir);
            var plain = JsonSerializer.SerializeToUtf8Bytes(all);
            var cipher = ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine);
            CryptographicOperations.ZeroMemory(plain);
            var tmp = _paths.SecretsFile + ".tmp";
            File.WriteAllBytes(tmp, cipher);
            File.Move(tmp, _paths.SecretsFile, overwrite: true);
        }
    }

    public string GetOrCreate(string key, int bytes = 32)
    {
        var existing = TryGet(key);
        if (existing is not null) return existing;
        var value = GeneratePassword(bytes);
        Set(key, value);
        return value;
    }

    /// <summary>URL ve bağlantı dizesi güvenli rastgele parola (base64url).</summary>
    public static string GeneratePassword(int bytes = 32) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
