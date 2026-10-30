using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Folios;

/// <summary>
/// Currency boşsa (veya tesis para birimiyse) Amount tesis para birimindedir. Dövizle ödenen satışta Amount döviz tutarıdır;
/// satış tutarı sunucuda günün kuruyla (exchange_rate.manage yetkisiyle elle girilen kurla) hesaplanır.
/// </summary>
public sealed record CashSaleRequest(Guid TransactionCodeId, string? Description, decimal Amount, string? Currency, decimal? ExchangeRate,
    Guid PaymentMethodId, string? Reference, string? Note);
public sealed record CashSaleDto(Guid Id, string FolioNumber, string Name, string Currency, decimal Total, string? PaymentMethods, string? Note,
    string? Username, DateTime CreatedAt, DateOnly BusinessDate, bool IsCancelled);

/// <summary>
/// Peşin satış: odaya yazılmayan, resepsiyonda anında ödenen satış (dışarıdan müşteri, çamaşır, otopark, telefon vb.).
/// Her satış rezervasyonsuz bir folyodur (ödeyen türü "house"): masraf ve tahsilat aynı işlemde yazılır, folyo sıfır bakiyeyle kapanır.
/// Böylece satış kasa vardiyasına, gelir raporlarına ve gün sonu muhasebe fişine diğer folyo hareketleri gibi girer.
/// </summary>
public static class CashSaleEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/cash-sales").WithTags("Folios");

        g.MapGet("/", async (Db db, DateOnly? date, CommandRunner cmd) =>
        {
            var day = date ?? await cmd.ReadAsync(tx => PropertyEndpoints.BusinessDateAsync(tx));
            return await db.QueryAsync<CashSaleDto>("""
                SELECT f.id, f.folio_number, f.name, f.currency::text AS currency,
                       COALESCE(sum(l.amount) FILTER (WHERE l.line_type = 'charge'), 0) AS total,
                       string_agg(DISTINCT pm.name, ', ') FILTER (WHERE l.line_type = 'payment') AS payment_methods,
                       max(l.reference) FILTER (WHERE l.line_type = 'charge') AS note,
                       u.username, f.created_at, min(l.business_date) AS business_date,
                       bool_or(l.line_type = 'void') AS is_cancelled
                FROM pms.folios f
                JOIN pms.folio_lines l ON l.folio_id = f.id
                LEFT JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
                LEFT JOIN pms.users u ON u.id = f.created_by
                WHERE f.payer_kind = 'house' AND f.reservation_id IS NULL
                GROUP BY f.id, u.username
                HAVING min(l.business_date) = @day
                ORDER BY f.created_at DESC
                """, new { day });
        }).RequirePermission("folio.view");

        g.MapPost("/", (CashSaleRequest req, CommandRunner cmd) => cmd.RunAsync("cash_sale.create", req, async tx =>
        {
            tx.Ctx.Require("payment.create");
            var method = await tx.OneOrNullAsync<(string Kind, bool IsActive)>("SELECT kind, is_active FROM pms.payment_methods WHERE id = @id", new { id = req.PaymentMethodId });
            if (method == default || !method.IsActive) throw PmsException.Validation("Kart tipi (ödeme tipi) bulunamadı veya pasif.");
            if (method.Kind is "city_ledger" or "company" or "agency")
                throw PmsException.Validation("Peşin satış cari hesaba aktarılamaz. Şirket/acente adına satış için ilgili folyoyu kullanın.");
            var codeName = await tx.ScalarAsync<string?>("SELECT name FROM pms.transaction_codes WHERE id = @id", new { id = req.TransactionCodeId })
                ?? throw PmsException.Validation("Departman (işlem kodu) bulunamadı.");

            var currency = await PropertyEndpoints.CurrencyAsync(tx);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var (tender, amount) = await FolioService.ResolveTenderAsync(tx, currency, req.Currency, req.Amount, req.ExchangeRate, req.Amount, bd);
            Validate.Money(amount, "Tutar");
            var description = Validate.Optional(req.Description, 200);
            var note = Validate.Optional(req.Note, 100);

            var number = "F" + await tx.ScalarAsync<long>("SELECT nextval('pms.folio_number_seq')");
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.folios (folio_number, reservation_id, window_no, payer_kind, name, currency, created_by)
                VALUES (@number, NULL, 1, 'house', @name, @currency, @uid) RETURNING id
                """, new { number, name = description ?? "Peşin Satış", currency, uid = tx.User.Id });

            await FolioService.PostChargeAsync(tx, id, new PostChargeRequest(req.TransactionCodeId, description ?? codeName, 1, amount, note));
            var reference = Validate.Optional(req.Reference, 100);
            await FolioService.PostPaymentAsync(tx, id, tender is null
                ? new PostPaymentRequest(req.PaymentMethodId, amount, null, reference, null, null, false)
                : new PostPaymentRequest(req.PaymentMethodId, amount, null, reference, null, null, false, tender.Currency, tender.Amount, req.ExchangeRate));
            var balance = await tx.ScalarAsync<decimal>("SELECT COALESCE(sum(amount), 0) FROM pms.folio_lines WHERE folio_id = @id", new { id });
            if (balance != 0) throw PmsException.Validation($"Satış ve tahsilat tutarı eşleşmedi ({balance:N2}).");

            await tx.ExecAsync("UPDATE pms.folios SET status = 'closed', closed_at = now(), closed_by = @uid, version = version + 1 WHERE id = @id",
                new { id, uid = tx.User.Id });
            await tx.AuditAsync("cash_sale.create", "folio", id, null, new { number, amount, req.TransactionCodeId, req.PaymentMethodId, tender });
            tx.Publish("folios", id);
            tx.Publish("cashier");
            return new { id, folioNumber = number, total = amount };
        })).RequirePermission("folio.post");

        // İptal: satış ve tahsilat ters kayıtla kapatılır; denetim için kayıt korunur. Yalnız satışın yapıldığı iş günü içinde yapılabilir.
        g.MapPost("/{id:guid}/cancel", (Guid id, FolioEndpoints.ReasonBody req, CommandRunner cmd) => cmd.RunAsync("cash_sale.cancel", new { id, req }, async tx =>
        {
            tx.Ctx.Require("payment.refund");
            var reason = Validate.Required(req.Reason, "İptal gerekçesi", 300);
            var f = await tx.OneOrNullAsync<(string PayerKind, Guid? ReservationId, string Status)>(
                "SELECT payer_kind, reservation_id, status FROM pms.folios WHERE id = @id FOR UPDATE", new { id });
            if (f == default || f.PayerKind != "house" || f.ReservationId is not null) throw PmsException.NotFound("Peşin satış");
            if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.folio_lines WHERE folio_id = @id AND line_type = 'void')", new { id }))
                throw PmsException.Validation("Bu satış zaten iptal edilmiş.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            if (await tx.ScalarAsync<DateOnly>("SELECT min(business_date) FROM pms.folio_lines WHERE folio_id = @id", new { id }) != bd)
                throw PmsException.Validation("Yalnız bugünkü iş gününde yapılan peşin satış iptal edilebilir.");

            if (f.Status == "closed") await tx.ExecAsync("UPDATE pms.folios SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = @id", new { id });
            var lines = await tx.ListAsync<Guid>("""
                SELECT l.id FROM pms.folio_lines l
                WHERE l.folio_id = @id AND l.line_type IN ('charge', 'payment')
                  AND NOT EXISTS (SELECT 1 FROM pms.folio_lines v WHERE v.related_line_id = l.id AND v.line_type = 'void')
                ORDER BY l.posted_at DESC, l.id
                """, new { id });
            foreach (var lineId in lines) await FolioService.VoidAsync(tx, lineId, new VoidRequest(reason));
            var balance = await tx.ScalarAsync<decimal>("SELECT COALESCE(sum(amount), 0) FROM pms.folio_lines WHERE folio_id = @id", new { id });
            if (balance != 0) throw PmsException.Validation($"İptal sonrası bakiye sıfır değil ({balance:N2}).");
            await tx.ExecAsync("UPDATE pms.folios SET status = 'closed', closed_at = now(), closed_by = @uid, version = version + 1 WHERE id = @id", new { id, uid = tx.User.Id });
            await tx.AuditAsync("cash_sale.cancel", "folio", id, null, new { voided = lines.Count }, reason);
            tx.Publish("folios", id);
            tx.Publish("cashier");
            return new { id };
        })).RequirePermission("folio.void");
    }
}
