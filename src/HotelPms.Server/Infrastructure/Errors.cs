using System.Diagnostics;
using System.Net.Sockets;
using Microsoft.AspNetCore.Diagnostics;
using Npgsql;

namespace HotelPms.Server.Infrastructure;

/// <summary>Kullanıcıya gösterilebilir iş kuralı hatası. Mesaj Türkçe ve teknik detay içermez.</summary>
public class PmsException(int status, string code, string message, object? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Details { get; } = details;

    public static PmsException NotFound(string what) => new(404, "not_found", $"{what} bulunamadı.");
    public static PmsException Validation(string message, object? details = null) => new(422, "validation", message, details);
    public static PmsException Conflict(string message, string code = "conflict") => new(409, code, message);
    public static PmsException Forbidden(string message = "Bu işlem için yetkiniz yok.") => new(403, "forbidden", message);
    public static PmsException Concurrency() => new(409, "concurrency",
        "Kayıt başka bir kullanıcı tarafından değiştirildi. Ekranı yenileyip tekrar deneyin.");
}

public sealed record ErrorResponse(string Code, string Message, string ErrorId, object? Details = null);

/// <summary>
/// Tüm hataları tek biçime çevirir. Stack trace, SQL veya ham istisna istemciye gönderilmez;
/// istemci "Hata kodu" ile sunucu loguna bağlanabilir.
/// </summary>
public sealed class PmsExceptionHandler(ILogger<PmsExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception ex, CancellationToken ct)
    {
        var errorId = ShortId();
        var (status, code, message, details) = Map(ex);
        if (status >= 500)
            log.LogError(ex, "İşlenmeyen hata {ErrorId} {Method} {Path}", errorId, http.Request.Method, http.Request.Path);
        else
            log.LogInformation("İş kuralı reddi {ErrorId} {Code} {Path}: {Message}", errorId, code, http.Request.Path, message);

        http.Response.StatusCode = status;
        await http.Response.WriteAsJsonAsync(new ErrorResponse(code, message, errorId, details), Json.Options, ct);
        return true;
    }

    public static (int, string, string, object?) Map(Exception ex) => ex switch
    {
        PmsException p => (p.Status, p.Code, p.Message, p.Details),
        BadHttpRequestException b => (400, "bad_request", "İstek biçimi geçersiz.", null),
        System.Text.Json.JsonException => (400, "bad_request", "İstek verisi okunamadı. Alan biçimlerini kontrol edin.", null),
        PostgresException { SqlState: "23P01" } pe when pe.ConstraintName?.Contains("room") == true =>
            (409, "room_conflict", "Oda seçilen tarihlerde başka bir konaklama veya blokaj ile çakışıyor.", null),
        PostgresException { SqlState: "23P01" } pe when pe.ConstraintName == "allotments_no_overlap" =>
            (409, "overlap", "Bu acentenin aynı oda tipi için bu tarihlerle çakışan aktif kontenjanı var.", null),
        PostgresException { SqlState: "23P01" } => (409, "overlap", "Tarih aralığı mevcut bir kayıtla çakışıyor.", null),
        PostgresException { SqlState: "23505" } pe => (409, "duplicate", DuplicateMessage(pe.ConstraintName), null),
        PostgresException { SqlState: "23503" } => (409, "reference", "Kayıt başka kayıtlarla ilişkili veya ilişkili kayıt bulunamadı.", null),
        PostgresException { SqlState: "23514" } => (422, "constraint", "Girilen değerler veri kurallarına uymuyor.", null),
        PostgresException { SqlState: "40001" or "40P01" } => (409, "retry", "İşlem eşzamanlı başka bir işlemle çakıştı. Lütfen tekrar deneyin.", null),
        PostgresException { SqlState: "42501" } => (403, "forbidden", "Bu kayıt değiştirilemez.", null),
        PostgresException { SqlState: "53100" } => (507, "disk_full", "Sunucu diski dolu. Yöneticinize başvurun.", null),
        NpgsqlException { InnerException: SocketException or TimeoutException } or NpgsqlException { IsTransient: true }
            => (503, "db_unavailable", "Veritabanı bağlantısı geçici olarak kullanılamıyor.", null),
        PostgresException { SqlState: var s } when s.StartsWith("57P") || s.StartsWith("08")
            => (503, "db_unavailable", "Veritabanı bağlantısı geçici olarak kullanılamıyor.", null),
        OperationCanceledException => (499, "cancelled", "İstek iptal edildi.", null),
        _ => (500, "internal", "İşlem tamamlanamadı. Hata kodunu sistem yöneticinize iletin.", null),
    };

    static string DuplicateMessage(string? constraint) => constraint switch
    {
        "users_username_uq" => "Bu kullanıcı adı zaten kullanılıyor.",
        "rooms_number_uq" => "Bu oda numarası zaten tanımlı.",
        "room_types_code_uq" => "Bu oda tipi kodu zaten tanımlı.",
        "reservations_inhouse_room_uq" => "Bu odada şu an konaklayan başka bir misafir var.",
        "cashier_shifts_one_open_uq" => "Açık bir kasa vardiyanız zaten var.",
        "night_audits_business_date_key" => "Bu iş günü için gece denetimi zaten tamamlanmış.",
        "folio_lines_single_void_uq" => "Bu satır zaten iptal edilmiş.",
        "room_charge_postings_pkey" => "Bu gece için oda ücreti zaten postalanmış.",
        "warehouses_code_uq" => "Bu depo kodu zaten tanımlı.",
        "stock_items_code_uq" => "Bu stok kodu zaten tanımlı.",
        "stock_items_barcode_uq" => "Bu barkod başka bir stok kartında kayıtlı.",
        "suppliers_tax_number_uq" => "Bu vergi numarasıyla kayıtlı bir tedarikçi zaten var.",
        "pos_outlets_code_uq" => "Bu satış noktası kodu zaten tanımlı.",
        "pos_products_code_uq" => "Bu ürün kodu zaten tanımlı.",
        "pos_printers_name_uq" => "Bu adla bir yazıcı zaten tanımlı.",
        _ => "Aynı bilgiye sahip bir kayıt zaten var.",
    };

    static string ShortId()
    {
        var id = Activity.Current?.TraceId.ToHexString() ?? Guid.NewGuid().ToString("N");
        return id[..8].ToUpperInvariant();
    }
}
