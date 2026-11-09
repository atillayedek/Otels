using System.Buffers.Binary;
using System.Security.Cryptography;
using Dapper;
using HotelPms.Server.Infrastructure;
using HotelPms.Shared;

namespace HotelPms.Server.Auth;

/// <summary>
/// Kullanıcıya özel web girişi kodu: RFC 6238 (TOTP) yöntemi, 10 saniyelik adım, 6 hane.
/// Kod yalnız oturum açmış kullanıcının kendi PMS istemcisinde gösterilir; internetten yönetim girişinde parolayla birlikte istenir.
/// Gizli anahtar sunucunun şifreli gizli deposundaki ana anahtarla (AES-GCM) şifrelenmiş olarak veritabanında tutulur.
/// </summary>
public sealed class MfaService(Db db, SecretStore secrets)
{
    public const int PeriodSeconds = 10;
    const string KeyName = "mfa.key";
    static readonly object KeyLock = new();

    byte[] MasterKey()
    {
        lock (KeyLock)
        {
            var k = secrets.TryGet(KeyName);
            if (k is null)
            {
                k = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
                secrets.Set(KeyName, k);
            }
            return Convert.FromBase64String(k);
        }
    }

    byte[] Encrypt(byte[] plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(MasterKey(), 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return [.. nonce, .. tag, .. cipher];
    }

    byte[] Decrypt(byte[] blob)
    {
        var plain = new byte[blob.Length - 28];
        using var aes = new AesGcm(MasterKey(), 16);
        aes.Decrypt(blob.AsSpan(0, 12), blob.AsSpan(28), blob.AsSpan(12, 16), plain);
        return plain;
    }

    async Task<byte[]> SecretAsync(Guid userId, bool create)
    {
        await using var c = await db.OpenAsync();
        var enc = await c.ExecuteScalarAsync<byte[]?>("SELECT secret_enc FROM pms.user_mfa WHERE user_id = @userId", new { userId });
        if (enc is not null) return Decrypt(enc);
        if (!create) throw new PmsException(401, "mfa_not_setup", "Bu hesap için web giriş kodu henüz oluşturulmamış. Kodu PMS'te üst çubuktaki 'Web giriş kodu' alanından görüntüleyin.");
        var secret = RandomNumberGenerator.GetBytes(20);
        await c.ExecuteAsync("INSERT INTO pms.user_mfa (user_id, secret_enc) VALUES (@userId, @enc) ON CONFLICT (user_id) DO NOTHING",
            new { userId, enc = Encrypt(secret) });
        return Decrypt(await c.ExecuteScalarAsync<byte[]>("SELECT secret_enc FROM pms.user_mfa WHERE user_id = @userId", new { userId }));
    }

    public static long Step(DateTimeOffset at) => at.ToUnixTimeSeconds() / PeriodSeconds;

    public static string Code(byte[] secret, long step)
    {
        Span<byte> msg = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(msg, step);
        var hash = HMACSHA1.HashData(secret, msg);
        var o = hash[^1] & 0x0F;
        var bin = ((hash[o] & 0x7F) << 24) | (hash[o + 1] << 16) | (hash[o + 2] << 8) | hash[o + 3];
        return (bin % 1_000_000).ToString("D6");
    }

    /// <summary>Kullanıcının güncel kodu ve kalan saniye (PMS istemcisinde gösterilir). Anahtar ilk istekte oluşturulur.</summary>
    public async Task<(string Code, int Remaining)> CurrentAsync(Guid userId)
    {
        var secret = await SecretAsync(userId, create: true);
        var now = DateTimeOffset.UtcNow;
        try { return (Code(secret, Step(now)), PeriodSeconds - (int)(now.ToUnixTimeSeconds() % PeriodSeconds)); }
        finally { CryptographicOperations.ZeroMemory(secret); }
    }

    /// <summary>
    /// Kodu doğrular: bu adım veya bir önceki adım (yazarken süre dolmuşsa) kabul edilir; aynı veya daha eski adım tekrar kullanılamaz.
    /// </summary>
    public async Task<bool> VerifyAsync(Guid userId, string? code)
    {
        code = new string((code ?? "").Where(char.IsDigit).ToArray());
        if (code.Length != 6) return false;
        byte[] secret;
        try { secret = await SecretAsync(userId, create: false); } catch (PmsException) { return false; }
        try
        {
            var now = Step(DateTimeOffset.UtcNow);
            foreach (var step in new[] { now, now - 1 })
            {
                if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(Code(secret, step)), System.Text.Encoding.ASCII.GetBytes(code))) continue;
                await using var c = await db.OpenAsync();
                var ok = await c.ExecuteAsync("UPDATE pms.user_mfa SET last_step = @step WHERE user_id = @userId AND last_step < @step", new { userId, step });
                return ok == 1;
            }
            return false;
        }
        finally { CryptographicOperations.ZeroMemory(secret); }
    }
}
