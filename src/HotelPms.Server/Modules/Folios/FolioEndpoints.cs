using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Folios;

public sealed record FolioDetail(FolioDto Folio, IReadOnlyList<FolioLineDto> Lines);
public sealed record ShiftDto(Guid Id, long ShiftNo, Guid UserId, string Username, DateOnly BusinessDate, DateTime OpenedAt, decimal OpeningFloat,
    DateTime? ClosedAt, decimal? CountedCash, decimal? ExpectedCash, decimal? Difference, string? CloseNote, string Status);
/// <summary>Ödeme tipi ve alınan para birimi bazında toplam. Dövizli satırlarda tutarlar döviz cinsindendir.</summary>
public sealed record ShiftTotalDto(string PaymentMethod, string Kind, string Currency, decimal Collected, decimal Refunded, decimal Net, int Count);
public sealed record ShiftCashDto(string Currency, decimal Expected, decimal? Counted, decimal? Difference);
public sealed record ShiftReport(ShiftDto Shift, IReadOnlyList<ShiftTotalDto> Totals, decimal ExpectedCash, IReadOnlyList<ShiftCashDto> Cash);
public sealed record OpenShiftRequest(decimal OpeningFloat);
/// <summary>CountedCash tesis para birimindeki nakit; CountedForeign kasadaki dövizlerin sayımı (para birimi → tutar).</summary>
public sealed record CloseShiftRequest(decimal CountedCash, string? Note, Dictionary<string, decimal>? CountedForeign = null);

public static class FolioEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/folios").WithTags("Folios");

        g.MapGet("/{id:guid}", async (Guid id, CommandRunner cmd) => await cmd.ReadAsync(async tx =>
        {
            var f = await tx.OneOrNullAsync<FolioDto>(FolioService.FolioSelect + " WHERE f.id = @id" + FolioService.FolioGroup, new { id }) ?? throw PmsException.NotFound("Folyo");
            var lines = await tx.ListAsync<FolioLineDto>(FolioService.LineSelect + " WHERE l.folio_id = @id ORDER BY l.posted_at, l.id", new { id });
            return new FolioDetail(f, lines);
        })).RequirePermission("folio.view");

        g.MapGet("/", (Db db, Guid? reservationId, Guid? companyId, Guid? agencyId, string? status, bool? withBalance) => db.QueryAsync<FolioDto>(
            FolioService.FolioSelect + """
             WHERE (@reservationId::uuid IS NULL OR f.reservation_id = @reservationId)
               AND (@companyId::uuid IS NULL OR f.company_id = @companyId)
               AND (@agencyId::uuid IS NULL OR f.agency_id = @agencyId)
               AND (@status::text IS NULL OR f.status = @status)
            """ + FolioService.FolioGroup + """
             HAVING (@withBalance::bool IS NULL OR NOT @withBalance OR COALESCE(sum(l.amount), 0) <> 0)
             ORDER BY f.reservation_id NULLS LAST, f.window_no, f.created_at LIMIT 1000
            """, new { reservationId, companyId, agencyId, status, withBalance })).RequirePermission("folio.view");

        g.MapPost("/", (CreateFolioRequest req, Guid reservationId, CommandRunner cmd) => cmd.RunAsync("folio.create", new { reservationId, req }, async tx =>
        {
            var r = await tx.OneOrNullAsync<(string Status, Guid GuestId, string Currency)>(
                "SELECT status, guest_id, currency::text FROM pms.reservations WHERE id = @reservationId FOR UPDATE", new { reservationId });
            if (r == default) throw PmsException.NotFound("Rezervasyon");
            if (r.Status is "cancelled" or "no_show" or "checked_out") throw PmsException.Validation("Bu rezervasyona yeni folyo açılamaz.");
            if (req.PayerKind is not ("guest" or "company" or "agency")) throw PmsException.Validation("Geçersiz ödeyici türü.");
            var window = await tx.ScalarAsync<int>("SELECT COALESCE(max(window_no), 0) + 1 FROM pms.folios WHERE reservation_id = @reservationId", new { reservationId });
            if (window > 9) throw PmsException.Validation("Bir rezervasyon için en fazla 9 folyo penceresi açılabilir.");
            var id = await FolioService.CreateReservationFolioAsync(tx, reservationId, window, req.PayerKind, req.PayerKind == "guest" ? r.GuestId : null,
                req.CompanyId, req.AgencyId, r.Currency, Validate.Optional(req.Name, 200));
            await tx.AuditAsync("folio.create", "folio", id, null, new { reservationId, window, req.PayerKind });
            tx.Publish("folios", id);
            return new { id };
        })).RequirePermission("folio.post");

        g.MapPost("/{id:guid}/charges", (Guid id, PostChargeRequest req, CommandRunner cmd) => cmd.RunAsync("folio.charge", new { id, req }, async tx =>
            new { id = await FolioService.PostChargeAsync(tx, id, req) })).RequirePermission("folio.post");

        g.MapPost("/{id:guid}/payments", (Guid id, PostPaymentRequest req, CommandRunner cmd) => cmd.RunAsync("folio.payment", new { id, req }, async tx =>
            new { id = await FolioService.PostPaymentAsync(tx, id, req) })).RequirePermission("payment.create");

        g.MapPost("/{id:guid}/refunds", (Guid id, RefundRequest req, CommandRunner cmd) => cmd.RunAsync("folio.refund", new { id, req }, async tx =>
            new { id = await FolioService.RefundAsync(tx, id, req) })).RequirePermission("payment.refund");

        g.MapPost("/{id:guid}/discounts", (Guid id, DiscountRequest req, CommandRunner cmd) => cmd.RunAsync("folio.discount", new { id, req }, async tx =>
            new { id = await FolioService.DiscountAsync(tx, id, req) })).RequirePermission("folio.discount");

        g.MapPost("/{id:guid}/transfer-balance", (Guid id, TransferBalanceRequest req, CommandRunner cmd) => cmd.RunAsync("folio.transfer_balance", new { id, req }, async tx =>
            new { id = await FolioService.TransferBalanceAsync(tx, id, req) })).RequirePermission("folio.transfer");

        g.MapPost("/{id:guid}/close", (Guid id, VersionBody req, CommandRunner cmd) => cmd.RunAsync("folio.close", new { id, req }, async tx =>
        {
            var balance = await tx.ScalarAsync<decimal>("SELECT COALESCE(sum(amount), 0) FROM pms.folio_lines WHERE folio_id = @id", new { id });
            if (balance != 0) throw PmsException.Validation($"Bakiyesi sıfır olmayan folyo kapatılamaz ({balance:N2}).");
            await tx.ExecVersionedAsync("UPDATE pms.folios SET status = 'closed', closed_at = now(), closed_by = @uid, version = version + 1 WHERE id = @id AND version = @Version AND status = 'open'",
                new { id, uid = tx.User.Id, req.Version });
            await tx.AuditAsync("folio.close", "folio", id);
            tx.Publish("folios", id);
            return new { id };
        })).RequirePermission("folio.close");

        g.MapPost("/{id:guid}/reopen", (Guid id, ReasonBody req, CommandRunner cmd) => cmd.RunAsync("folio.reopen", new { id, req }, async tx =>
        {
            var reason = Validate.Required(req.Reason, "Gerekçe", 300);
            if (await tx.ExecAsync("UPDATE pms.folios SET status = 'open', closed_at = NULL, closed_by = NULL, version = version + 1 WHERE id = @id AND status = 'closed'", new { id }) == 0)
                throw PmsException.Validation("Folyo zaten açık.");
            await tx.AuditAsync("folio.reopen", "folio", id, null, null, reason);
            tx.Publish("folios", id);
            return new { id };
        })).RequirePermission("folio.close");

        g.MapPost("/{id:guid}/invoice-reference", (Guid id, InvoiceReferenceRequest req, CommandRunner cmd) => cmd.RunAsync("folio.invoice_reference", new { id, req }, async tx =>
        {
            var no = Validate.Required(req.InvoiceNumber, "Fatura numarası", 50);
            if (await tx.ExecAsync("UPDATE pms.folios SET invoice_number = @no, invoice_date = @InvoiceDate, version = version + 1 WHERE id = @id", new { id, no, req.InvoiceDate }) == 0)
                throw PmsException.NotFound("Folyo");
            await tx.AuditAsync("folio.invoice_reference", "folio", id, null, req);
            tx.Publish("folios", id);
            return new { id };
        }, requireKey: false)).RequirePermission("folio.close");

        var lines = app.MapGroup("/api/v1/folio-lines").WithTags("Folios");
        lines.MapPost("/{id:guid}/void", (Guid id, VoidRequest req, CommandRunner cmd) => cmd.RunAsync("folio.void", new { id, req }, async tx =>
            new { id = await FolioService.VoidAsync(tx, id, req) })).RequirePermission("folio.void");
        lines.MapPost("/{id:guid}/transfer", (Guid id, TransferLineRequest req, CommandRunner cmd) => cmd.RunAsync("folio.transfer_line", new { id, req }, async tx =>
            new { id = await FolioService.TransferLineAsync(tx, id, req) })).RequirePermission("folio.transfer");

        app.MapPost("/api/v1/reservations/{id:guid}/routing", (Guid id, RoutingRequest req, CommandRunner cmd) => cmd.RunAsync("reservation.routing", new { id, req }, async tx =>
        {
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.folios WHERE reservation_id = @id AND window_no = @RoomChargeWindow AND status = 'open')",
                    new { id, req.RoomChargeWindow }))
                throw PmsException.Validation("Seçilen folyo penceresi açık değil.");
            await tx.ExecAsync("UPDATE pms.reservations SET room_charge_window = @RoomChargeWindow, version = version + 1 WHERE id = @id", new { id, req.RoomChargeWindow });
            await tx.AuditAsync("reservation.routing", "reservation", id, null, req);
            tx.Publish("reservations", id);
            return new { id };
        }, requireKey: false)).WithTags("Folios").RequirePermission("folio.transfer");

        // ---- Kasa
        var cs = app.MapGroup("/api/v1/cashier").WithTags("Cashier");
        cs.MapGet("/current", async (Db db, RequestContext ctx) =>
            await db.QuerySingleOrDefaultAsync<ShiftDto>(ShiftSelect + " WHERE s.user_id = @uid AND s.status = 'open'", new { uid = ctx.RequireUser().Id }))
            .RequirePermission("cashier.manage");
        cs.MapGet("/shifts", (Db db, RequestContext ctx, DateOnly? date) =>
        {
            var u = ctx.RequireUser();
            return db.QueryAsync<ShiftDto>(ShiftSelect + """
                 WHERE (@all OR s.user_id = @uid) AND (@date::date IS NULL OR s.business_date = @date) ORDER BY s.opened_at DESC LIMIT 200
                """, new { all = u.Has("cashier.view_all"), uid = u.Id, date });
        }).RequirePermission("cashier.manage");
        cs.MapGet("/shifts/{id:guid}", async (Guid id, CommandRunner cmd, RequestContext ctx) => await cmd.ReadAsync(async tx =>
        {
            var s = await tx.OneOrNullAsync<ShiftDto>(ShiftSelect + " WHERE s.id = @id", new { id }) ?? throw PmsException.NotFound("Vardiya");
            var u = ctx.RequireUser();
            if (s.UserId != u.Id && !u.Has("cashier.view_all")) throw PmsException.Forbidden();
            return await ShiftReportAsync(tx, s);
        })).RequirePermission("cashier.manage");
        cs.MapPost("/open", (OpenShiftRequest req, CommandRunner cmd) => cmd.RunAsync("cashier.open", req, async tx =>
        {
            Validate.Money(req.OpeningFloat, "Açılış bakiyesi", allowZero: true);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var id = await tx.ScalarAsync<Guid>("INSERT INTO pms.cashier_shifts (user_id, business_date, opening_float) VALUES (@uid, @bd, @OpeningFloat) RETURNING id",
                new { uid = tx.User.Id, bd, req.OpeningFloat });
            await tx.AuditAsync("cashier.open", "cashier_shift", id, null, req);
            tx.Publish("cashier");
            return new { id };
        })).RequirePermission("cashier.manage");
        cs.MapPost("/close", (CloseShiftRequest req, CommandRunner cmd) => cmd.RunAsync("cashier.close", req, async tx =>
        {
            Validate.Money(req.CountedCash, "Sayılan nakit", allowZero: true);
            var s = await tx.OneOrNullAsync<ShiftDto>(ShiftSelect + " WHERE s.user_id = @uid AND s.status = 'open' FOR UPDATE OF s", new { uid = tx.User.Id })
                ?? throw PmsException.Validation("Açık kasa vardiyanız yok.");
            var report = await ShiftReportAsync(tx, s);
            var diff = req.CountedCash - report.ExpectedCash;
            var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
            var foreign = (req.CountedForeign ?? new()).ToDictionary(kv => kv.Key.Trim().ToUpperInvariant(), kv => kv.Value);
            foreach (var c in report.Cash.Where(c => c.Currency != baseCur && c.Expected != 0 && !foreign.ContainsKey(c.Currency)))
                throw PmsException.Validation($"Kasadaki {c.Currency} sayımını girin (beklenen {c.Expected:N2} {c.Currency}).");
            var counts = new List<ShiftCashDto> { new(baseCur, report.ExpectedCash, req.CountedCash, diff) };
            foreach (var (cur, counted) in foreign)
            {
                if (cur == baseCur) continue;
                Validate.Money(counted, $"Sayılan {cur}", allowZero: true);
                var exp = report.Cash.FirstOrDefault(c => c.Currency == cur)?.Expected ?? 0;
                counts.Add(new(cur, exp, counted, counted - exp));
            }
            foreach (var c in counts)
                await tx.ExecAsync("""
                    INSERT INTO pms.cashier_shift_counts (shift_id, currency, expected, counted, difference) VALUES (@id, @Currency, @Expected, @Counted, @Difference)
                    """, new { id = s.Id, c.Currency, c.Expected, c.Counted, c.Difference });
            await tx.ExecAsync("""
                UPDATE pms.cashier_shifts SET status = 'closed', closed_at = now(), counted_cash = @CountedCash, expected_cash = @exp, difference = @diff, close_note = @note
                WHERE id = @id
                """, new { id = s.Id, req.CountedCash, exp = report.ExpectedCash, diff, note = Validate.Optional(req.Note, 500) });
            await tx.AuditAsync("cashier.close", "cashier_shift", s.Id, null, new { req.CountedCash, report.ExpectedCash, diff, counts });
            tx.Publish("cashier");
            return new { id = s.Id, expected = report.ExpectedCash, difference = diff };
        })).RequirePermission("cashier.manage");

        // ---- Yapılandırma: işlem kodları ve ödeme tipleri
        var cfg = app.MapGroup("/api/v1/finance").WithTags("Finance");
        cfg.MapGet("/transaction-codes", (Db db) => db.QueryAsync<TransactionCodeDto>(
            "SELECT id, code, name, category, default_price, vat_rate, is_system, is_active FROM pms.transaction_codes ORDER BY category, code")).RequirePermission("folio.view");
        cfg.MapPost("/transaction-codes", (SaveTransactionCodeRequest req, CommandRunner cmd) => cmd.RunAsync("transaction_code.create", req, async tx =>
        {
            var p = CodeParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.transaction_codes (code, name, category, default_price, vat_rate, is_active) VALUES (@code, @name, @category, @price, @vat, @active) RETURNING id
                """, p);
            await tx.AuditAsync("transaction_code.create", "transaction_code", id, null, req);
            return new { id };
        }, requireKey: false)).RequirePermission("settings.manage");
        cfg.MapPut("/transaction-codes/{id:guid}", (Guid id, SaveTransactionCodeRequest req, CommandRunner cmd) => cmd.RunAsync("transaction_code.update", new { id, req }, async tx =>
        {
            var p = CodeParams(req);
            var cur = await tx.OneOrNullAsync<(bool IsSystem, string Code, string Category)>(
                "SELECT is_system, code, category FROM pms.transaction_codes WHERE id = @id", new { id });
            if (cur == default) throw PmsException.NotFound("İşlem kodu");
            // Sistem kodlarında (ROOM, KV) yalnız ad, fiyat ve KDV oranı değiştirilebilir.
            if (cur.IsSystem && (p.code != cur.Code || p.category != cur.Category || !p.active))
                throw PmsException.Validation("Sistem işlem kodunun kodu ve kategorisi değiştirilemez, pasifleştirilemez.");
            await tx.ExecAsync("UPDATE pms.transaction_codes SET code = @code, name = @name, category = @category, default_price = @price, vat_rate = @vat, is_active = @active WHERE id = @id",
                new { p.code, p.name, p.category, p.price, p.vat, p.active, id });
            await tx.AuditAsync("transaction_code.update", "transaction_code", id, null, req);
            return new { id };
        }, requireKey: false)).RequirePermission("settings.manage");
        cfg.MapGet("/payment-methods", (Db db) => db.QueryAsync<PaymentMethodDto>(
            "SELECT id, code, name, kind, requires_reference, is_system, is_active FROM pms.payment_methods ORDER BY sort_order, name")).RequirePermission("folio.view");
        cfg.MapPost("/payment-methods", (SavePaymentMethodRequest req, CommandRunner cmd) => cmd.RunAsync("payment_method.create", req, async tx =>
        {
            var p = MethodParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.payment_methods (code, name, kind, requires_reference, is_active, sort_order)
                VALUES (@code, @name, @kind, @reference, @active, (SELECT COALESCE(max(sort_order), 0) + 1 FROM pms.payment_methods)) RETURNING id
                """, p);
            await tx.AuditAsync("payment_method.create", "payment_method", id, null, req);
            return new { id };
        }, requireKey: false)).RequirePermission("settings.manage");
        cfg.MapPut("/payment-methods/{id:guid}", (Guid id, SavePaymentMethodRequest req, CommandRunner cmd) => cmd.RunAsync("payment_method.update", new { id, req }, async tx =>
        {
            var p = MethodParams(req);
            var system = await tx.ScalarAsync<bool?>("SELECT is_system FROM pms.payment_methods WHERE id = @id", new { id }) ?? throw PmsException.NotFound("Ödeme tipi");
            if (system && await tx.ScalarAsync<string>("SELECT kind FROM pms.payment_methods WHERE id = @id", new { id }) != p.kind)
                throw PmsException.Validation("Sistem ödeme tipinin türü değiştirilemez.");
            await tx.ExecAsync("UPDATE pms.payment_methods SET code = @code, name = @name, kind = @kind, requires_reference = @reference, is_active = @active WHERE id = @id",
                new { p.code, p.name, p.kind, p.reference, p.active, id });
            await tx.AuditAsync("payment_method.update", "payment_method", id, null, req);
            return new { id };
        }, requireKey: false)).RequirePermission("settings.manage");
    }

    public sealed record VersionBody(int Version);
    public sealed record ReasonBody(string Reason);

    sealed record CodeP(string code, string name, string category, decimal? price, decimal vat, bool active);
    sealed record MethodP(string code, string name, string kind, bool reference, bool active);

    static CodeP CodeParams(SaveTransactionCodeRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 16).ToUpperInvariant();
        if (!global::System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,16}$")) throw PmsException.Validation("Kod yalnız harf, rakam, - ve _ içerebilir.");
        if (r.Category is not ("room" or "food_beverage" or "minibar" or "laundry" or "telephone" or "spa" or "transfer" or "misc" or "tax" or "package"))
            throw PmsException.Validation("Geçersiz kategori.");
        if (r.VatRate is < 0 or > 100) throw PmsException.Validation("KDV oranı 0-100 arasında olmalıdır.");
        if (r.DefaultPrice is { } dp) Validate.Money(dp, "Varsayılan fiyat", allowZero: true);
        return new CodeP(code, Validate.Required(r.Name, "Ad", 100), r.Category, r.DefaultPrice, r.VatRate, r.IsActive);
    }

    static MethodP MethodParams(SavePaymentMethodRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 16).ToUpperInvariant();
        if (!global::System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,16}$")) throw PmsException.Validation("Kod yalnız harf, rakam, - ve _ içerebilir.");
        if (r.Kind is not ("cash" or "credit_card" or "bank_transfer" or "city_ledger" or "company" or "agency" or "other")) throw PmsException.Validation("Geçersiz ödeme türü.");
        return new MethodP(code, Validate.Required(r.Name, "Ad", 100), r.Kind, r.RequiresReference, r.IsActive);
    }

    const string ShiftSelect = """
        SELECT s.id, s.shift_no, s.user_id, u.username, s.business_date, s.opened_at, s.opening_float, s.closed_at, s.counted_cash, s.expected_cash,
               s.difference, s.close_note, s.status
        FROM pms.cashier_shifts s JOIN pms.users u ON u.id = s.user_id
        """;

    static async Task<ShiftReport> ShiftReportAsync(Tx tx, ShiftDto s)
    {
        // Dövizli satırlarda misafirden alınan döviz tutarı esas alınır (kasada fiziksel olarak o para durur).
        var totals = await tx.ListAsync<ShiftTotalDto>("""
            SELECT pm.name AS payment_method, pm.kind, COALESCE(l.tendered_currency, l.currency)::text AS currency,
                   COALESCE(-sum(COALESCE(l.tendered_amount, l.amount)) FILTER (WHERE l.amount < 0), 0) AS collected,
                   COALESCE(sum(COALESCE(l.tendered_amount, l.amount)) FILTER (WHERE l.amount > 0), 0) AS refunded,
                   COALESCE(-sum(COALESCE(l.tendered_amount, l.amount)), 0) AS net, count(*)::int AS count
            FROM pms.folio_lines l JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
            WHERE l.cashier_shift_id = @id
            GROUP BY pm.name, pm.kind, pm.sort_order, COALESCE(l.tendered_currency, l.currency)
            ORDER BY pm.sort_order, COALESCE(l.tendered_currency, l.currency)
            """, new { id = s.Id });
        var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
        var stored = await tx.ListAsync<ShiftCashDto>(
            "SELECT currency::text AS currency, expected, counted, difference FROM pms.cashier_shift_counts WHERE shift_id = @id", new { id = s.Id });
        var expected = totals.Where(t => t.Kind == "cash").GroupBy(t => t.Currency).ToDictionary(g => g.Key, g => g.Sum(t => t.Net));
        expected[baseCur] = s.OpeningFloat + expected.GetValueOrDefault(baseCur);
        var cash = expected.OrderBy(kv => kv.Key == baseCur ? 0 : 1).ThenBy(kv => kv.Key)
            .Select(kv => stored.FirstOrDefault(c => c.Currency == kv.Key) ?? new ShiftCashDto(kv.Key, kv.Value, null, null))
            .Concat(stored.Where(c => !expected.ContainsKey(c.Currency))).ToList();
        if (s.Status == "closed" && stored.Count == 0)
            cash = [new ShiftCashDto(baseCur, s.ExpectedCash ?? expected[baseCur], s.CountedCash, s.Difference)];
        return new ShiftReport(s, totals, expected[baseCur], cash);
    }
}
