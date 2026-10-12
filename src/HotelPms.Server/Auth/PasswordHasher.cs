using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace HotelPms.Server.Auth;

/// <summary>Argon2id parola özeti. Biçim: $argon2id$v=19$m=65536,t=3,p=2$&lt;salt&gt;$&lt;hash&gt;</summary>
public static class PasswordHasher
{
    const int MemoryKb = 65536;
    const int Iterations = 3;
    const int Parallelism = 2;
    const int SaltBytes = 16;
    const int HashBytes = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Compute(password, salt, MemoryKb, Iterations, Parallelism, HashBytes);
        return $"$argon2id$v=19$m={MemoryKb},t={Iterations},p={Parallelism}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string encoded)
    {
        var parts = encoded.Split('$');
        if (parts.Length != 6 || parts[1] != "argon2id") return false;
        var prm = parts[3].Split(',').Select(p => p.Split('=')).ToDictionary(p => p[0], p => int.Parse(p[1]));
        var salt = Convert.FromBase64String(parts[4]);
        var expected = Convert.FromBase64String(parts[5]);
        var actual = Compute(password, salt, prm["m"], prm["t"], prm["p"], expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>Doğrulama başarısız olduğunda bile benzer süre harcamak için (kullanıcı adı keşfini zorlaştırır).</summary>
    public static void DummyVerify(string password) =>
        Compute(password, new byte[SaltBytes], MemoryKb, Iterations, Parallelism, HashBytes);

    static byte[] Compute(string password, byte[] salt, int memoryKb, int iterations, int parallelism, int length)
    {
        using var a = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            MemorySize = memoryKb,
            Iterations = iterations,
            DegreeOfParallelism = parallelism,
        };
        return a.GetBytes(length);
    }

    /// <summary>En az 10 karakter, harf ve rakam içermeli.</summary>
    public static string? PolicyError(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 10) return "Parola en az 10 karakter olmalıdır.";
        if (password.Length > 128) return "Parola en fazla 128 karakter olabilir.";
        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit)) return "Parola en az bir harf ve bir rakam içermelidir.";
        return null;
    }
}
