using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace HotelPms.Shared;

/// <summary>Lisansla açılan ek modüller (çekirdek PMS her lisansta vardır).</summary>
public static class LicenseModules
{
    public const string Restaurant = "restaurant";
    public const string Stock = "stock";
    public const string Accounting = "accounting";
    public static readonly IReadOnlyDictionary<string, string> Names = new Dictionary<string, string>
    {
        [Restaurant] = "Restoran / Adisyon", [Stock] = "Stok ve Satın Alma", [Accounting] = "Muhasebe",
    };
}

/// <summary>TSDMR Digital Studio'nun imzaladığı lisans içeriği.</summary>
public sealed record LicensePayload(
    [property: JsonPropertyName("id")] string LicenseId,
    [property: JsonPropertyName("customer")] string Customer,
    [property: JsonPropertyName("hotel")] string Hotel,
    [property: JsonPropertyName("taxNumber")] string? TaxNumber,
    [property: JsonPropertyName("maxRooms")] int MaxRooms,
    [property: JsonPropertyName("modules")] IReadOnlyList<string> Modules,
    [property: JsonPropertyName("issuedAt")] DateOnly IssuedAt,
    [property: JsonPropertyName("expiresAt")] DateOnly? ExpiresAt,
    [property: JsonPropertyName("supportUntil")] DateOnly? SupportUntil,
    [property: JsonPropertyName("version")] int FormatVersion = 1);

/// <summary>
/// Lisans dosyası biçimi: "TSDMR-LISANS-1." + base64url(JSON) + "." + base64url(ECDSA P-256 / SHA-256 imzası).
/// Doğrulama yalnız ürüne gömülü açık anahtarla yapılır; özel anahtar yalnız lisans üretim aracında, satıcıdadır.
/// </summary>
public static class LicenseFormat
{
    public const string Prefix = "TSDMR-LISANS-1.";

    /// <summary>TSDMR Digital Studio lisans imzalama anahtarının açık kısmı (SubjectPublicKeyInfo, base64).</summary>
    public const string PublicKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAECLpcMPkd04Fus4QZZhqH8CQDNUS3my+3uwu3UE7K1y7Cal9dDJYOm+HAvjOEyLFy4Zqc48NkSqvrHU00Foqfsw==";

    static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

    public static string Sign(LicensePayload payload, ECDsa privateKey)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(payload, Json);
        var sig = privateKey.SignData(body, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return Prefix + B64(body) + "." + B64(sig);
    }

    /// <summary>İmzayı ve biçimi doğrular; geçersizse açıklamasıyla birlikte null döner.</summary>
    public static LicensePayload? Verify(string? content, out string? error, string? publicKeyBase64 = null)
    {
        error = null;
        var text = (content ?? "").Trim();
        if (!text.StartsWith(Prefix, StringComparison.Ordinal)) { error = "Lisans metni tanınmadı. Dosyanın tamamını kopyaladığınızdan emin olun."; return null; }
        var parts = text[Prefix.Length..].Split('.');
        if (parts.Length != 2) { error = "Lisans metni eksik veya bozuk."; return null; }
        byte[] body, sig;
        try { body = Unb64(parts[0]); sig = Unb64(parts[1]); }
        catch (FormatException) { error = "Lisans metni bozuk."; return null; }
        using var key = ECDsa.Create();
        key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKeyBase64 ?? PublicKey), out _);
        if (!key.VerifyData(body, sig, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
        { error = "Lisans imzası geçersiz. Lisans TSDMR Digital Studio tarafından verilmemiş veya değiştirilmiş."; return null; }
        try
        {
            var p = JsonSerializer.Deserialize<LicensePayload>(body, Json);
            if (p is null || string.IsNullOrWhiteSpace(p.LicenseId) || p.MaxRooms < 1) { error = "Lisans içeriği geçersiz."; return null; }
            return p;
        }
        catch (JsonException) { error = "Lisans içeriği okunamadı."; return null; }
    }

    static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    static byte[] Unb64(string s)
    {
        var t = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(t.PadRight(t.Length + (4 - t.Length % 4) % 4, '='));
    }

    /// <summary>Yeni imza anahtarı üretir: (özel anahtar PEM, açık anahtar base64).</summary>
    public static (string PrivatePem, string PublicBase64) NewKeyPair()
    {
        using var k = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (k.ExportPkcs8PrivateKeyPem(), Convert.ToBase64String(k.ExportSubjectPublicKeyInfo()));
    }

    public static string Describe(LicensePayload p)
    {
        var sb = new StringBuilder();
        sb.Append($"{p.Hotel} ({p.Customer}) · {p.MaxRooms} oda");
        if (p.Modules.Count > 0) sb.Append(" · ").Append(string.Join(", ", p.Modules.Select(m => LicenseModules.Names.GetValueOrDefault(m, m))));
        sb.Append(p.ExpiresAt is { } e ? $" · bitiş {e:dd.MM.yyyy}" : " · süresiz");
        return sb.ToString();
    }
}
