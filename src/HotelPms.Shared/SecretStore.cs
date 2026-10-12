using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace HotelPms.Shared;

/// <summary>
/// Veritabanı parolaları ve yönetim anahtarı gibi gizli değerleri şifreli saklar.
/// Windows: DPAPI (LocalMachine) + dosya ACL'i (SYSTEM, Administrators).
/// Linux: AES-256-GCM; anahtar dosyası ve şifreli dosya yalnız servis kullanıcısı tarafından okunabilir (0600).
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

    string KeyFile => Path.Combine(_paths.ConfigDir, "secret.key");

    public bool Exists => File.Exists(_paths.SecretsFile);

    public Dictionary<string, string> ReadAll()
    {
        lock (_lock)
        {
            if (!File.Exists(_paths.SecretsFile)) return new();
            var plain = Decrypt(File.ReadAllBytes(_paths.SecretsFile));
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
            var cipher = Encrypt(plain);
            CryptographicOperations.ZeroMemory(plain);
            var tmp = _paths.SecretsFile + ".tmp";
            File.WriteAllBytes(tmp, cipher);
            RestrictToOwner(tmp);
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

    byte[] Encrypt(byte[] plain)
    {
        if (OperatingSystem.IsWindows()) return ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine);
        var key = LinuxKey();
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(key, 16)) aes.Encrypt(nonce, plain, cipher, tag, Entropy);
        CryptographicOperations.ZeroMemory(key);
        return [.. "HPS1"u8, .. nonce, .. tag, .. cipher];
    }

    byte[] Decrypt(byte[] data)
    {
        if (OperatingSystem.IsWindows()) return ProtectedData.Unprotect(data, Entropy, DataProtectionScope.LocalMachine);
        if (data.Length < 32 || !data.AsSpan(0, 4).SequenceEqual("HPS1"u8)) throw new CryptographicException("Gizli değer dosyası biçimi geçersiz.");
        var key = LinuxKey();
        var plain = new byte[data.Length - 32];
        using (var aes = new AesGcm(key, 16)) aes.Decrypt(data.AsSpan(4, 12), data.AsSpan(32), data.AsSpan(16, 16), plain, Entropy);
        CryptographicOperations.ZeroMemory(key);
        return plain;
    }

    byte[] LinuxKey()
    {
        if (!File.Exists(KeyFile))
        {
            Directory.CreateDirectory(_paths.ConfigDir);
            File.WriteAllBytes(KeyFile, RandomNumberGenerator.GetBytes(32));
            RestrictToOwner(KeyFile);
        }
        return File.ReadAllBytes(KeyFile);
    }

    static void RestrictToOwner(string file)
    {
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    /// <summary>URL ve bağlantı dizesi güvenli rastgele parola (base64url).</summary>
    public static string GeneratePassword(int bytes = 32) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
