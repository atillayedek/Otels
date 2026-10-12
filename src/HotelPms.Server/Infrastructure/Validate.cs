using System.Globalization;
using System.Text.RegularExpressions;

namespace HotelPms.Server.Infrastructure;

/// <summary>Sunucu taraflı giriş doğrulama. Arayüzdeki doğrulama bunun yerine geçmez.</summary>
public static partial class Validate
{
    public static string Required(string? value, string field, int max = 200)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) throw PmsException.Validation($"{field} zorunludur.");
        if (v.Length > max) throw PmsException.Validation($"{field} en fazla {max} karakter olabilir.");
        return v;
    }

    public static string? Optional(string? value, int max = 500, string field = "Alan")
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (v.Length > max) throw PmsException.Validation($"{field} en fazla {max} karakter olabilir.");
        return v;
    }

    public static decimal Money(decimal value, string field, bool allowZero = false, bool allowNegative = false)
    {
        if (decimal.Round(value, 2) != value) throw PmsException.Validation($"{field} en fazla 2 ondalık basamak içerebilir.");
        if (!allowNegative && value < 0) throw PmsException.Validation($"{field} negatif olamaz.");
        if (!allowZero && value == 0) throw PmsException.Validation($"{field} sıfır olamaz.");
        if (Math.Abs(value) > 9_999_999_999_999m) throw PmsException.Validation($"{field} çok büyük.");
        return value;
    }

    public static void DateRange(DateOnly arrival, DateOnly departure)
    {
        if (departure <= arrival) throw PmsException.Validation("Çıkış tarihi giriş tarihinden sonra olmalıdır.");
        if (departure.DayNumber - arrival.DayNumber > 365) throw PmsException.Validation("Konaklama 365 geceden uzun olamaz.");
    }

    public static string? Email(string? value)
    {
        var v = Optional(value, 200, "E-posta");
        if (v is not null && !EmailRegex().IsMatch(v)) throw PmsException.Validation("E-posta adresi geçersiz.");
        return v?.ToLowerInvariant();
    }

    public static string? Country(string? value, string field = "Ülke")
    {
        var v = Optional(value, 2)?.ToUpperInvariant();
        if (v is not null && !Regex.IsMatch(v, "^[A-Z]{2}$")) throw PmsException.Validation($"{field} ISO 2 harfli kod olmalıdır (ör. TR).");
        return v;
    }

    /// <summary>Telefonu karşılaştırma için normalize eder: yalnız rakamlar, Türkiye için 90 öneki.</summary>
    public static string? NormalizePhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return null;
        if (phone.TrimStart().StartsWith('+')) return digits;
        if (digits.StartsWith("00")) return digits[2..];
        if (digits.Length == 11 && digits.StartsWith('0')) return "90" + digits[1..];
        if (digits.Length == 10 && digits.StartsWith('5')) return "90" + digits;
        return digits;
    }

    /// <summary>T.C. kimlik numarası algoritma kontrolü.</summary>
    public static bool IsValidTckn(string? s)
    {
        if (s is null || s.Length != 11 || !s.All(char.IsDigit) || s[0] == '0') return false;
        var d = s.Select(ch => ch - '0').ToArray();
        var odd = d[0] + d[2] + d[4] + d[6] + d[8];
        var even = d[1] + d[3] + d[5] + d[7];
        if (((odd * 7 - even) % 10 + 10) % 10 != d[9]) return false;
        return d.Take(10).Sum() % 10 == d[10];
    }

    /// <summary>Kimlik numarasını yetkisi olmayan kullanıcılar için maskeler: 123******90</summary>
    public static string? Mask(string? value)
    {
        if (string.IsNullOrEmpty(value)) return value;
        if (value.Length <= 4) return new string('*', value.Length);
        return value[..3] + new string('*', value.Length - 5) + value[^2..];
    }

    public static string TitleCaseTr(string s)
    {
        var tr = CultureInfo.GetCultureInfo("tr-TR");
        return string.Join(' ', s.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.Length == 0 ? w : w[..1].ToUpper(tr) + w[1..].ToLower(tr)));
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailRegex();
}

public sealed record PageRequest(int Page = 1, int PageSize = 50)
{
    public int Limit => Math.Clamp(PageSize, 1, 500);
    public int Offset => (Math.Max(Page, 1) - 1) * Limit;
}

public sealed record Paged<T>(IReadOnlyList<T> Items, long Total, int Page, int PageSize);
