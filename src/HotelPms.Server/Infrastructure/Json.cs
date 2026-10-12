using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace HotelPms.Server.Infrastructure;

public static class Json
{
    public static readonly JsonSerializerOptions Options = Configure(new JsonSerializerOptions(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions o)
    {
        o.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        o.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        o.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All);
        if (!o.Converters.Any(c => c is DecimalStringConverter)) o.Converters.Add(new DecimalStringConverter());
        if (!o.Converters.Any(c => c is NullableDecimalStringConverter)) o.Converters.Add(new NullableDecimalStringConverter());
        return o;
    }
}

/// <summary>
/// Para ve miktar değerleri JSON'da string olarak taşınır ("1250.50"); böylece tarayıcı tarafında
/// IEEE-754 floating-point hassasiyet kaybı oluşmaz. Okurken hem string hem sayı literali kabul edilir
/// (sayı literali decimal olarak, float'a çevrilmeden ayrıştırılır).
/// </summary>
public sealed class DecimalStringConverter : JsonConverter<decimal>
{
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number) return reader.GetDecimal();
        if (reader.TokenType == JsonTokenType.String)
        {
            var s = reader.GetString()!.Trim().Replace(" ", "");
            if (decimal.TryParse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var d))
                return d;
        }
        throw new JsonException("Geçersiz sayısal değer");
    }

    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToString("0.00##", CultureInfo.InvariantCulture));
}

public sealed class NullableDecimalStringConverter : JsonConverter<decimal?>
{
    static readonly DecimalStringConverter Inner = new();

    public override decimal? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.String && string.IsNullOrWhiteSpace(reader.GetString())) return null;
        return Inner.Read(ref reader, typeof(decimal), options);
    }

    public override void Write(Utf8JsonWriter writer, decimal? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else Inner.Write(writer, value.Value, options);
    }
}
