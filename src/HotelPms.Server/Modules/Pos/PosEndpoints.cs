using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Folios;
using HotelPms.Server.Modules.Property;
using HotelPms.Server.Modules.Stock;

namespace HotelPms.Server.Modules.Pos;

public sealed record OutletDto(Guid Id, string Code, string Name, Guid TransactionCodeId, string TransactionCode, Guid? WarehouseId, string? WarehouseName,
    int SortOrder, bool IsActive, int OpenChecks, int Version);
public sealed record SaveOutletRequest(string Code, string Name, Guid TransactionCodeId, Guid? WarehouseId, int SortOrder, bool IsActive, int? Version);

public sealed record PosProductDto(Guid Id, string Code, string Name, string Category, decimal Price, decimal VatRate, int SortOrder, bool IsActive,
    string? OutletIdsCsv, int RecipeItems, Guid? PrinterId, int Version)
{
    public IReadOnlyList<Guid> OutletIds => string.IsNullOrEmpty(OutletIdsCsv) ? [] : OutletIdsCsv.Split(',').Select(Guid.Parse).ToList();
}
public sealed record SavePosProductRequest(string Code, string Name, string Category, decimal Price, decimal VatRate, int SortOrder, bool IsActive,
    IReadOnlyList<Guid>? OutletIds, int? Version, Guid? PrinterId = null);
public sealed record PosPrinterDto(Guid Id, string Name, string Host, int Port, string CodePage, int LineWidth, bool IsActive, int Products, int Version);
public sealed record SavePosPrinterRequest(string Name, string Host, int Port, string CodePage, int LineWidth, bool IsActive, int? Version);
public sealed record SendResult(IReadOnlyList<string> Sent, IReadOnlyList<SendFailure> Failed, int Lines, CheckDetail Detail);
public sealed record SendFailure(string Printer, string Error);
public sealed record RecipeLineDto(Guid StockItemId, string ItemCode, string ItemName, string Unit, decimal Quantity);
public sealed record RecipeLine(Guid StockItemId, decimal Quantity);
public sealed record SaveRecipeRequest(IReadOnlyList<RecipeLine> Lines);

public sealed record CheckDto(Guid Id, long CheckNo, Guid OutletId, string OutletName, string? TableLabel, int Covers, string Status, DateOnly BusinessDate,
    string? OpenedBy, DateTime OpenedAt, string? Note, decimal Subtotal, decimal DiscountAmount, string? DiscountReason, decimal Total, decimal Paid,
    string? Settlement, Guid? ReservationId, string? RoomNumber, string? GuestName, string? ClosedBy, DateTime? ClosedAt, DateOnly? ClosedBusinessDate,
    string? CancelReason, int ItemCount, int Version);
public sealed record CheckLineDto(Guid Id, Guid ProductId, string Name, decimal Quantity, decimal UnitPrice, decimal Amount, decimal VatRate, string? Note,
    string? AddedBy, DateTime AddedAt, bool IsVoid, string? VoidReason, string? VoidedBy, bool Printable, DateTime? SentAt);
public sealed record CheckPaymentDto(Guid Id, string PaymentMethod, decimal Amount, string? TenderedCurrency, decimal? TenderedAmount, decimal? ExchangeRate,
    string? Reference, bool IsReversal, string? Username, DateTime CreatedAt);
public sealed record CheckDetail(CheckDto Check, IReadOnlyList<CheckLineDto> Lines, IReadOnlyList<CheckPaymentDto> Payments);

public sealed record OpenCheckRequest(Guid OutletId, string? TableLabel, int Covers, string? Note);
public sealed record UpdateCheckRequest(string? TableLabel, int Covers, string? Note, int Version);
public sealed record AddLineRequest(Guid ProductId, decimal Quantity, string? Note);
public sealed record VoidLineRequest(string Reason);
public sealed record CheckDiscountRequest(decimal Amount, string? Reason, int Version);
public sealed record CheckPaymentRequest(Guid PaymentMethodId, decimal Amount, string? TenderedCurrency, decimal? TenderedAmount, decimal? ExchangeRate, string? Reference);
public sealed record CloseCheckRequest(string Settlement, Guid? ReservationId, IReadOnlyList<CheckPaymentRequest>? Payments, int Version);
public sealed record CancelCheckRequest(string Reason, int Version);
public sealed record InHouseRoomDto(Guid ReservationId, string RoomNumber, string GuestName, DateOnly Departure, bool IsBlacklisted);

/// <summary>Restoran / bar satış noktası. Ürün iptali, indirim ve kapanmış adisyon iptali gerekçeli ve denetim kayıtlıdır.</summary>
public static class PosEndpoints
{
    /// <summary>Ürünü ekleyen kullanıcı, pos.void yetkisi olmadan da kendi eklediği satırı bu süre içinde iptal edebilir (yanlış tuşlama).</summary>
    static readonly TimeSpan SelfVoidWindow = TimeSpan.FromMinutes(2);

    const string OutletSelect = """
        SELECT o.id, o.code, o.name, o.transaction_code_id, tc.code AS transaction_code, o.warehouse_id, w.name AS warehouse_name, o.sort_order, o.is_active,
               (SELECT count(*)::int FROM pms.pos_checks c WHERE c.outlet_id = o.id AND c.status = 'open') AS open_checks, o.version
        FROM pms.pos_outlets o JOIN pms.transaction_codes tc ON tc.id = o.transaction_code_id LEFT JOIN pms.warehouses w ON w.id = o.warehouse_id
        """;
    const string ProductSelect = """
        SELECT p.id, p.code, p.name, p.category, p.price, p.vat_rate, p.sort_order, p.is_active,
               (SELECT string_agg(po.outlet_id::text, ',') FROM pms.pos_product_outlets po WHERE po.product_id = p.id) AS outlet_ids_csv,
               (SELECT count(*)::int FROM pms.pos_recipes r WHERE r.product_id = p.id) AS recipe_items, p.printer_id, p.version
        FROM pms.pos_products p
        """;
    const string CheckSelect = """
        SELECT c.id, c.check_no, c.outlet_id, o.name AS outlet_name, c.table_label, c.covers, c.status, c.business_date, ou.username AS opened_by, c.opened_at,
               c.note, t.subtotal, c.discount_amount, c.discount_reason, COALESCE(c.total_amount, GREATEST(t.subtotal - c.discount_amount, 0)) AS total,
               COALESCE((SELECT sum(p.amount) FROM pms.pos_payments p WHERE p.check_id = c.id), 0) AS paid,
               c.settlement, c.reservation_id, rm.number AS room_number, g.first_name || ' ' || g.last_name AS guest_name,
               cu.username AS closed_by, c.closed_at, c.closed_business_date, c.cancel_reason, t.item_count, c.version
        FROM pms.pos_checks c JOIN pms.pos_outlets o ON o.id = c.outlet_id
        LEFT JOIN LATERAL (SELECT COALESCE(sum(l.amount) FILTER (WHERE NOT l.is_void), 0) AS subtotal,
                                  COALESCE(sum(l.quantity) FILTER (WHERE NOT l.is_void), 0)::int AS item_count
                           FROM pms.pos_check_lines l WHERE l.check_id = c.id) t ON true
        LEFT JOIN pms.users ou ON ou.id = c.opened_by LEFT JOIN pms.users cu ON cu.id = c.closed_by
        LEFT JOIN pms.reservations r ON r.id = c.reservation_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id LEFT JOIN pms.guests g ON g.id = r.guest_id
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/pos").WithTags("POS");

        // ---- Satış noktaları
        g.MapGet("/outlets", (Db db) => db.QueryAsync<OutletDto>(OutletSelect + " ORDER BY o.sort_order, o.name")).RequireAnyPermission("pos.view", "pos.manage");
        g.MapPost("/outlets", (SaveOutletRequest req, CommandRunner cmd) => cmd.RunAsync("pos_outlet.create", req, async tx =>
        {
            var (code, name) = await OutletParamsAsync(tx, req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.pos_outlets (code, name, transaction_code_id, warehouse_id, sort_order, is_active)
                VALUES (@code, @name, @TransactionCodeId, @WarehouseId, @SortOrder, @IsActive) RETURNING id
                """, new { code, name, req.TransactionCodeId, req.WarehouseId, req.SortOrder, req.IsActive });
            await tx.AuditAsync("pos_outlet.create", "pos_outlet", id, null, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");
        g.MapPut("/outlets/{id:guid}", (Guid id, SaveOutletRequest req, CommandRunner cmd) => cmd.RunAsync("pos_outlet.update", new { id, req }, async tx =>
        {
            var (code, name) = await OutletParamsAsync(tx, req);
            if (!req.IsActive && await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.pos_checks WHERE outlet_id = @id AND status = 'open')", new { id }))
                throw PmsException.Validation("Açık adisyonu olan satış noktası pasifleştirilemez.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.pos_outlets SET code = @code, name = @name, transaction_code_id = @TransactionCodeId, warehouse_id = @WarehouseId,
                    sort_order = @SortOrder, is_active = @IsActive, version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, code, name, req.TransactionCodeId, req.WarehouseId, req.SortOrder, req.IsActive, version = req.Version ?? -1 });
            await tx.AuditAsync("pos_outlet.update", "pos_outlet", id, null, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");

        // ---- Menü
        g.MapGet("/products", (Db db, Guid? outletId, bool? includeInactive) => db.QueryAsync<PosProductDto>(ProductSelect + """
             WHERE (@all OR p.is_active)
               AND (@outletId::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM pms.pos_product_outlets x WHERE x.product_id = p.id)
                    OR EXISTS (SELECT 1 FROM pms.pos_product_outlets x WHERE x.product_id = p.id AND x.outlet_id = @outletId))
            ORDER BY p.category, p.sort_order, p.name
            """, new { outletId, all = includeInactive ?? false })).RequireAnyPermission("pos.view", "pos.manage");
        g.MapPost("/products", (SavePosProductRequest req, CommandRunner cmd) => cmd.RunAsync("pos_product.create", req, async tx =>
        {
            var p = ProductParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.pos_products (code, name, category, price, vat_rate, sort_order, is_active, printer_id)
                VALUES (@code, @name, @category, @price, @vat, @sort, @active, @printer) RETURNING id
                """, new { p.code, p.name, p.category, p.price, p.vat, p.sort, p.active, printer = await PrinterRefAsync(tx, req.PrinterId) });
            await WriteProductOutletsAsync(tx, id, req.OutletIds);
            await tx.AuditAsync("pos_product.create", "pos_product", id, null, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");
        g.MapPut("/products/{id:guid}", (Guid id, SavePosProductRequest req, CommandRunner cmd) => cmd.RunAsync("pos_product.update", new { id, req }, async tx =>
        {
            var p = ProductParams(req);
            var before = await tx.OneOrNullAsync<PosProductDto>(ProductSelect + " WHERE p.id = @id", new { id }) ?? throw PmsException.NotFound("Ürün");
            await tx.ExecVersionedAsync("""
                UPDATE pms.pos_products SET code = @code, name = @name, category = @category, price = @price, vat_rate = @vat, sort_order = @sort,
                    is_active = @active, printer_id = @printer, version = version + 1
                WHERE id = @id AND version = @version
                """, new { p.code, p.name, p.category, p.price, p.vat, p.sort, p.active, printer = await PrinterRefAsync(tx, req.PrinterId), id, version = req.Version ?? -1 });
            await tx.ExecAsync("DELETE FROM pms.pos_product_outlets WHERE product_id = @id", new { id });
            await WriteProductOutletsAsync(tx, id, req.OutletIds);
            await tx.AuditAsync("pos_product.update", "pos_product", id, before, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");
        g.MapGet("/products/{id:guid}/recipe", (Guid id, Db db) => db.QueryAsync<RecipeLineDto>("""
            SELECT r.stock_item_id, i.code AS item_code, i.name AS item_name, i.unit, r.quantity
            FROM pms.pos_recipes r JOIN pms.stock_items i ON i.id = r.stock_item_id WHERE r.product_id = @id ORDER BY i.name
            """, new { id })).RequireAnyPermission("pos.manage", "stock.view");
        g.MapPut("/products/{id:guid}/recipe", (Guid id, SaveRecipeRequest req, CommandRunner cmd) => cmd.RunAsync("pos_recipe.save", new { id, req }, async tx =>
        {
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.pos_products WHERE id = @id)", new { id })) throw PmsException.NotFound("Ürün");
            var lines = req.Lines ?? [];
            if (lines.Count > 50) throw PmsException.Validation("Bir reçetede en fazla 50 malzeme olabilir.");
            if (lines.Select(l => l.StockItemId).Distinct().Count() != lines.Count) throw PmsException.Validation("Aynı malzeme reçetede birden fazla kez var.");
            foreach (var l in lines)
            {
                await StockService.EnsureItemAsync(tx, l.StockItemId);
                StockService.Quantity(l.Quantity, "Reçete miktarı");
            }
            await tx.ExecAsync("DELETE FROM pms.pos_recipes WHERE product_id = @id", new { id });
            foreach (var l in lines)
                await tx.ExecAsync("INSERT INTO pms.pos_recipes (product_id, stock_item_id, quantity) VALUES (@id, @StockItemId, @Quantity)",
                    new { id, l.StockItemId, l.Quantity });
            await tx.AuditAsync("pos_recipe.save", "pos_product", id, null, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");

        // ---- Sipariş yazıcıları (mutfak, bar)
        g.MapGet("/printers", (Db db) => db.QueryAsync<PosPrinterDto>("""
            SELECT pr.id, pr.name, pr.host, pr.port, pr.code_page, pr.line_width, pr.is_active,
                   (SELECT count(*)::int FROM pms.pos_products p WHERE p.printer_id = pr.id) AS products, pr.version
            FROM pms.pos_printers pr ORDER BY pr.name
            """)).RequireAnyPermission("pos.view", "pos.manage");
        g.MapPost("/printers", (SavePosPrinterRequest req, CommandRunner cmd) => cmd.RunAsync("pos_printer.create", req, async tx =>
        {
            var p = PrinterParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.pos_printers (name, host, port, code_page, line_width, is_active) VALUES (@name, @host, @port, @cp, @width, @active) RETURNING id
                """, new { p.name, p.host, p.port, p.cp, p.width, p.active });
            await tx.AuditAsync("pos_printer.create", "pos_printer", id, null, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");
        g.MapPut("/printers/{id:guid}", (Guid id, SavePosPrinterRequest req, CommandRunner cmd) => cmd.RunAsync("pos_printer.update", new { id, req }, async tx =>
        {
            var p = PrinterParams(req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.pos_printers SET name = @name, host = @host, port = @port, code_page = @cp, line_width = @width, is_active = @active, version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, p.name, p.host, p.port, p.cp, p.width, p.active, version = req.Version ?? -1 });
            await tx.AuditAsync("pos_printer.update", "pos_printer", id, null, req);
            tx.Publish("pos");
            return new { id };
        }, requireKey: false)).RequirePermission("pos.manage");
        g.MapPost("/printers/{id:guid}/test", async (Guid id, Db db, RequestContext ctx) =>
        {
            var p = await db.QuerySingleOrDefaultAsync<KitchenPrinterConfig>(
                "SELECT id, name, host, port, code_page, line_width FROM pms.pos_printers WHERE id = @id", new { id }) ?? throw PmsException.NotFound("Yazıcı");
            try
            {
                await KitchenPrinter.SendAsync(p, new KitchenTicket("Deneme", 0, "1", 1, ctx.RequireUser().FullName, DateTime.Now,
                    [new KitchenTicketLine(1, "Deneme ürünü", "Not satırı")], [], IsTest: true));
            }
            catch (IOException ex) { throw new PmsException(502, "printer_unreachable", ex.Message); }
            return Results.Ok(new { printed = true });
        }).RequirePermission("pos.manage");

        // Sipariş fişi: gönderilmemiş yazdırılabilir ürünler ve gönderildikten sonra iptal edilenler yazıcılarına gider.
        // 1) Satırlar kısa bir transaction'da "gönderildi" olarak işaretlenir (aynı anda ikinci gönderim aynı satırları bulamaz),
        // 2) fişler transaction dışında yazdırılır (adisyon kilidi ağ beklemesi boyunca tutulmaz),
        // 3) ulaşılamayan yazıcının satırları geri alınır; tekrar gönderilebilir. Yazdırılmış fiş veritabanı hatasıyla ikinci kez basılmaz.
        g.MapPost("/checks/{id:guid}/send", async (Guid id, CommandRunner cmd) =>
        {
            var claim = await cmd.WriteAsync(async tx =>
            {
                var c = await LockOpenCheckAsync(tx, id);
                var head = await tx.OneAsync<(string Outlet, string? Table, int Covers)>("""
                    SELECT o.name, c.table_label, c.covers FROM pms.pos_checks c JOIN pms.pos_outlets o ON o.id = c.outlet_id WHERE c.id = @id
                    """, new { id });
                var lines = await tx.ListAsync<(Guid LineId, Guid PrinterId, string Name, decimal Quantity, string? Note, bool IsVoid, string? VoidReason, bool PrinterActive)>("""
                    SELECT l.id, p.printer_id, l.name, l.quantity, l.note, l.is_void, l.void_reason, pr.is_active
                    FROM pms.pos_check_lines l JOIN pms.pos_products p ON p.id = l.product_id JOIN pms.pos_printers pr ON pr.id = p.printer_id
                    WHERE l.check_id = @id
                      AND ((NOT l.is_void AND l.sent_at IS NULL) OR (l.is_void AND l.sent_at IS NOT NULL AND l.void_sent_at IS NULL))
                    ORDER BY l.added_at
                    """, new { id });
                var printable = lines.Where(l => l.PrinterActive).ToList();
                var newIds = printable.Where(l => !l.IsVoid).Select(l => l.LineId).ToArray();
                var voidIds = printable.Where(l => l.IsVoid).Select(l => l.LineId).ToArray();
                await tx.ExecAsync("UPDATE pms.pos_check_lines SET sent_at = now() WHERE id = ANY(@newIds)", new { newIds });
                await tx.ExecAsync("UPDATE pms.pos_check_lines SET void_sent_at = now() WHERE id = ANY(@voidIds)", new { voidIds });
                var printers = await tx.ListAsync<KitchenPrinterConfig>(
                    "SELECT id, name, host, port, code_page, line_width FROM pms.pos_printers WHERE id = ANY(@ids)",
                    new { ids = printable.Select(l => l.PrinterId).Distinct().ToArray() });
                return (c.CheckNo, head.Outlet, head.Table, head.Covers, Waiter: tx.User.FullName, Printable: printable,
                    Printers: printers.ToDictionary(p => p.Id), InactiveLines: lines.Count - printable.Count);
            });

            var sent = new List<string>();
            var failed = new List<SendFailure>();
            var failedNew = new List<Guid>();
            var failedVoid = new List<Guid>();
            if (claim.InactiveLines > 0)
                failed.Add(new("Pasif yazıcı", "Bazı ürünlerin yazıcısı pasif; Menü ekranından yazıcıyı değiştirin veya yazıcıyı etkinleştirin."));
            foreach (var grp in claim.Printable.GroupBy(l => l.PrinterId))
            {
                var p = claim.Printers[grp.Key];
                var ticket = new KitchenTicket(claim.Outlet, claim.CheckNo, claim.Table, claim.Covers, claim.Waiter, DateTime.Now,
                    grp.Where(l => !l.IsVoid).Select(l => new KitchenTicketLine(l.Quantity, l.Name, l.Note)).ToList(),
                    grp.Where(l => l.IsVoid).Select(l => new KitchenTicketLine(l.Quantity, l.Name, l.VoidReason)).ToList());
                try { await KitchenPrinter.SendAsync(p, ticket); sent.Add(p.Name); }
                catch (IOException ex)
                {
                    failed.Add(new(p.Name, ex.Message));
                    failedNew.AddRange(grp.Where(l => !l.IsVoid).Select(l => l.LineId));
                    failedVoid.AddRange(grp.Where(l => l.IsVoid).Select(l => l.LineId));
                }
            }
            var count = claim.Printable.Count - failedNew.Count - failedVoid.Count;

            var result = await cmd.WriteAsync(async tx =>
            {
                if (failedNew.Count > 0)
                    await tx.ExecAsync("UPDATE pms.pos_check_lines SET sent_at = NULL WHERE id = ANY(@ids)", new { ids = failedNew.ToArray() });
                if (failedVoid.Count > 0)
                    await tx.ExecAsync("UPDATE pms.pos_check_lines SET void_sent_at = NULL WHERE id = ANY(@ids)", new { ids = failedVoid.ToArray() });
                if (claim.Printable.Count > 0)
                {
                    await TouchAsync(tx, id);
                    await tx.AuditAsync("pos.check_send", "pos_check", id, null, new { sent, failed, count });
                    tx.Publish("pos");
                }
                return new SendResult(sent, failed, count, await DetailAsync(tx, id));
            });
            return Results.Text(System.Text.Json.JsonSerializer.Serialize(result, Json.Options), "application/json", System.Text.Encoding.UTF8);
        }).RequirePermission("pos.order");

        // ---- Odaya aktarma için konaklayanlar (yalnız oda, ad ve çıkış tarihi; bakiye gösterilmez)
        g.MapGet("/in-house", (Db db) => db.QueryAsync<InHouseRoomDto>("""
            SELECT r.id AS reservation_id, rm.number AS room_number, g.first_name || ' ' || g.last_name AS guest_name, r.departure, g.is_blacklisted
            FROM pms.reservations r JOIN pms.rooms rm ON rm.id = r.room_id JOIN pms.guests g ON g.id = r.guest_id
            WHERE r.status = 'checked_in' ORDER BY rm.sort_order, rm.number
            """)).RequirePermission("pos.settle");

        // ---- Adisyonlar
        g.MapGet("/checks", (Db db, Guid? outletId, string? status, DateOnly? date) => db.QueryAsync<CheckDto>(CheckSelect + """
             WHERE (@outletId::uuid IS NULL OR c.outlet_id = @outletId)
               AND (@status::text IS NULL OR c.status = @status)
               AND (@date::date IS NULL OR c.business_date = @date OR c.closed_business_date = @date)
            ORDER BY c.status = 'open' DESC, c.opened_at DESC LIMIT 1000
            """, new { outletId, status, date })).RequirePermission("pos.view");
        g.MapGet("/checks/{id:guid}", (Guid id, CommandRunner cmd) => cmd.ReadAsync(tx => DetailAsync(tx, id))).RequirePermission("pos.view");

        g.MapPost("/checks", (OpenCheckRequest req, CommandRunner cmd) => cmd.RunAsync("pos.check_open", req, async tx =>
        {
            var outlet = await tx.ScalarAsync<bool?>("SELECT is_active FROM pms.pos_outlets WHERE id = @OutletId", req) ?? throw PmsException.NotFound("Satış noktası");
            if (!outlet) throw PmsException.Validation("Satış noktası pasif.");
            if (req.Covers is < 1 or > 500) throw PmsException.Validation("Kişi sayısı 1-500 arasında olmalıdır.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.pos_checks (outlet_id, table_label, covers, business_date, opened_by, note)
                VALUES (@OutletId, @table, @Covers, @bd, @uid, @note) RETURNING id
                """, new { req.OutletId, table = Validate.Optional(req.TableLabel, 30), req.Covers, bd, uid = tx.User.Id, note = Validate.Optional(req.Note, 500) });
            await tx.AuditAsync("pos.check_open", "pos_check", id, null, req);
            tx.Publish("pos");
            return await DetailAsync(tx, id);
        })).RequirePermission("pos.order");

        g.MapPut("/checks/{id:guid}", (Guid id, UpdateCheckRequest req, CommandRunner cmd) => cmd.RunAsync("pos.check_update", new { id, req }, async tx =>
        {
            await LockOpenCheckAsync(tx, id);
            if (req.Covers is < 1 or > 500) throw PmsException.Validation("Kişi sayısı 1-500 arasında olmalıdır.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.pos_checks SET table_label = @table, covers = @Covers, note = @note, version = version + 1 WHERE id = @id AND version = @version
                """, new { id, table = Validate.Optional(req.TableLabel, 30), req.Covers, note = Validate.Optional(req.Note, 500), version = req.Version });
            tx.Publish("pos");
            return await DetailAsync(tx, id);
        }, requireKey: false)).RequirePermission("pos.order");

        g.MapPost("/checks/{id:guid}/lines", (Guid id, AddLineRequest req, CommandRunner cmd) => cmd.RunAsync("pos.line_add", new { id, req }, async tx =>
        {
            var c = await LockOpenCheckAsync(tx, id);
            if (req.Quantity <= 0 || req.Quantity > 1000 || decimal.Round(req.Quantity, 3) != req.Quantity)
                throw PmsException.Validation("Miktar pozitif ve en fazla 3 ondalıklı olmalıdır.");
            var p = await tx.OneOrNullAsync<(string Name, decimal Price, decimal VatRate, bool IsActive)>(
                "SELECT name, price, vat_rate, is_active FROM pms.pos_products WHERE id = @ProductId", req);
            if (p == default || !p.IsActive) throw PmsException.Validation("Ürün bulunamadı veya satışta değil.");
            if (await tx.ScalarAsync<bool>("""
                SELECT EXISTS (SELECT 1 FROM pms.pos_product_outlets WHERE product_id = @ProductId)
                   AND NOT EXISTS (SELECT 1 FROM pms.pos_product_outlets WHERE product_id = @ProductId AND outlet_id = @outlet)
                """, new { req.ProductId, outlet = c.OutletId }))
                throw PmsException.Validation($"{p.Name} bu satış noktasında satılmıyor.");
            var amount = decimal.Round(req.Quantity * p.Price, 2, MidpointRounding.AwayFromZero);
            await tx.ExecAsync("""
                INSERT INTO pms.pos_check_lines (check_id, product_id, name, quantity, unit_price, amount, vat_rate, note, added_by)
                VALUES (@id, @ProductId, @Name, @Quantity, @Price, @amount, @VatRate, @note, @uid)
                """, new { id, req.ProductId, p.Name, req.Quantity, p.Price, amount, p.VatRate, note = Validate.Optional(req.Note, 200), uid = tx.User.Id });
            await TouchAsync(tx, id);
            tx.Publish("pos");
            return await DetailAsync(tx, id);
        })).RequirePermission("pos.order");

        g.MapPost("/check-lines/{lineId:guid}/void", (Guid lineId, VoidLineRequest req, CommandRunner cmd) => cmd.RunAsync("pos.line_void", new { lineId, req }, async tx =>
        {
            var line = await tx.OneOrNullAsync<(Guid CheckId, bool IsVoid, Guid? AddedBy, DateTime AddedAt, string Name, decimal Amount, bool Sent)>(
                "SELECT check_id, is_void, added_by, added_at, name, amount, sent_at IS NOT NULL FROM pms.pos_check_lines WHERE id = @lineId", new { lineId });
            if (line == default) throw PmsException.NotFound("Adisyon satırı");
            await LockOpenCheckAsync(tx, line.CheckId);
            if (line.IsVoid) throw PmsException.Validation("Satır zaten iptal edilmiş.");
            // Yanlış tuşlama düzeltmesi yalnız mutfağa/bara gönderilmemiş satır için geçerlidir; hazırlanmaya başlamış ürünün iptali yetki ister.
            var own = !line.Sent && line.AddedBy == tx.User.Id && DateTime.UtcNow - line.AddedAt.ToUniversalTime() <= SelfVoidWindow;
            if (!own) tx.Ctx.Require("pos.void");
            var reason = Validate.Required(req.Reason, "İptal gerekçesi", 200);
            await tx.ExecAsync("UPDATE pms.pos_check_lines SET is_void = true, void_reason = @reason, voided_by = @uid, voided_at = now() WHERE id = @lineId",
                new { lineId, reason, uid = tx.User.Id });
            await tx.ExecAsync("""
                UPDATE pms.pos_checks c SET discount_amount = 0, discount_reason = NULL
                WHERE c.id = @id AND c.discount_amount > (SELECT COALESCE(sum(amount), 0) FROM pms.pos_check_lines WHERE check_id = c.id AND NOT is_void)
                """, new { id = line.CheckId });
            await TouchAsync(tx, line.CheckId);
            await tx.AuditAsync("pos.line_void", "pos_check", line.CheckId, new { line.Name, line.Amount }, null, reason);
            tx.Publish("pos");
            return await DetailAsync(tx, line.CheckId);
        })).RequirePermission("pos.order");

        g.MapPost("/checks/{id:guid}/discount", (Guid id, CheckDiscountRequest req, CommandRunner cmd) => cmd.RunAsync("pos.discount", new { id, req }, async tx =>
        {
            await LockOpenCheckAsync(tx, id, req.Version);
            Validate.Money(req.Amount, "İndirim", allowZero: true);
            var reason = req.Amount == 0 ? null : Validate.Required(req.Reason, "İndirim gerekçesi", 200);
            var subtotal = await tx.ScalarAsync<decimal>("SELECT COALESCE(sum(amount), 0) FROM pms.pos_check_lines WHERE check_id = @id AND NOT is_void", new { id });
            if (req.Amount > subtotal) throw PmsException.Validation($"İndirim adisyon tutarını ({subtotal:N2}) aşamaz.");
            await tx.ExecAsync("UPDATE pms.pos_checks SET discount_amount = @Amount, discount_reason = @reason, version = version + 1 WHERE id = @id",
                new { id, req.Amount, reason });
            await tx.AuditAsync("pos.discount", "pos_check", id, null, new { req.Amount, subtotal }, reason);
            tx.Publish("pos");
            return await DetailAsync(tx, id);
        })).RequirePermission("pos.discount");

        g.MapPost("/checks/{id:guid}/close", (Guid id, CloseCheckRequest req, CommandRunner cmd) => cmd.RunAsync("pos.check_close", new { id, req }, async tx =>
        {
            var c = await LockOpenCheckAsync(tx, id, req.Version);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var baseCur = await PropertyEndpoints.CurrencyAsync(tx);
            var lines = await tx.ListAsync<(Guid ProductId, decimal Quantity, decimal Amount, decimal VatRate)>(
                "SELECT product_id, quantity, amount, vat_rate FROM pms.pos_check_lines WHERE check_id = @id AND NOT is_void", new { id });
            if (lines.Count == 0) throw PmsException.Validation("Adisyonda ürün yok. Boş adisyonu iptal edin.");
            var subtotal = lines.Sum(l => l.Amount);
            var discount = await tx.ScalarAsync<decimal>("SELECT discount_amount FROM pms.pos_checks WHERE id = @id", new { id });
            var total = Math.Max(subtotal - discount, 0);
            var outlet = await tx.OneAsync<(Guid CodeId, Guid? WarehouseId, string Name)>(
                "SELECT transaction_code_id, warehouse_id, name FROM pms.pos_outlets WHERE id = @o", new { o = c.OutletId });
            Guid? reservationId = null, firstLine = null;

            switch (req.Settlement)
            {
                case "complimentary":
                    tx.Ctx.Require("pos.discount");
                    if (total != 0) throw PmsException.Validation("İkram kapanışı için önce tamamına indirim (gerekçeli) uygulayın.");
                    break;
                case "room":
                {
                    if (total <= 0) throw PmsException.Validation("Tutarı sıfır olan adisyon odaya aktarılamaz; ikram olarak kapatın.");
                    var rid = req.ReservationId ?? throw PmsException.Validation("Aktarılacak odayı seçin.");
                    var r = await tx.OneOrNullAsync<(string Status, bool Blacklisted, string? Room)>("""
                        SELECT r.status, g.is_blacklisted, rm.number FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id
                        LEFT JOIN pms.rooms rm ON rm.id = r.room_id WHERE r.id = @rid FOR UPDATE OF r
                        """, new { rid });
                    if (r == default || r.Status != "checked_in") throw PmsException.Validation("Yalnız konaklayan misafirin odasına aktarılabilir.");
                    var folioId = await tx.ScalarAsync<Guid?>(
                        "SELECT id FROM pms.folios WHERE reservation_id = @rid AND status = 'open' ORDER BY window_no LIMIT 1", new { rid })
                        ?? throw PmsException.Validation($"Oda {r.Room} için açık folyo yok. Resepsiyona bildirin.");
                    // KDV oranı farklı ürünler ayrı folyo satırı olur; indirim oransal dağıtılır, yuvarlama farkı son satıra eklenir.
                    var groups = lines.GroupBy(l => l.VatRate).Select(x => (Vat: x.Key, Amount: x.Sum(l => l.Amount))).OrderBy(x => x.Vat).ToList();
                    decimal posted = 0;
                    for (var i = 0; i < groups.Count; i++)
                    {
                        var share = i == groups.Count - 1 ? total - posted
                            : decimal.Round(groups[i].Amount - discount * groups[i].Amount / subtotal, 2, MidpointRounding.AwayFromZero);
                        posted += share;
                        if (share <= 0) continue;
                        var lid = await FolioService.PostExternalChargeAsync(tx, folioId, outlet.CodeId,
                            $"{outlet.Name} adisyon #{c.CheckNo}" + (groups.Count > 1 ? $" (KDV %{groups[i].Vat:0.##})" : ""), share, groups[i].Vat, $"ADS-{c.CheckNo}");
                        firstLine ??= lid;
                    }
                    reservationId = rid;
                    break;
                }
                case "payment":
                {
                    if (total <= 0) throw PmsException.Validation("Tutarı sıfır olan adisyon ikram olarak kapatılır.");
                    var pays = req.Payments ?? [];
                    if (pays.Count is 0 or > 10) throw PmsException.Validation("1-10 arası ödeme satırı girin.");
                    var shift = await FolioService.CurrentShiftAsync(tx, required: true);
                    decimal paid = 0;
                    foreach (var p in pays)
                    {
                        var m = await tx.OneOrNullAsync<(string Name, string Kind, bool RequiresReference, bool IsActive)>(
                            "SELECT name, kind, requires_reference, is_active FROM pms.payment_methods WHERE id = @PaymentMethodId", p);
                        if (m == default || !m.IsActive) throw PmsException.Validation("Ödeme tipi bulunamadı veya pasif.");
                        if (m.Kind is "city_ledger" or "company" or "agency")
                            throw PmsException.Validation($"{m.Name} adisyonda kullanılamaz. Misafir için odaya aktarın.");
                        var reference = Validate.Optional(p.Reference, 100);
                        if (m.RequiresReference && reference is null) throw PmsException.Validation($"{m.Name} için referans (slip no) zorunludur.");
                        var (tender, amount) = await FolioService.ResolveTenderAsync(tx, baseCur, p.TenderedCurrency, p.TenderedAmount, p.ExchangeRate, p.Amount, bd);
                        Validate.Money(amount, "Ödeme tutarı");
                        await tx.ExecAsync("""
                            INSERT INTO pms.pos_payments (check_id, payment_method_id, amount, currency, tendered_currency, tendered_amount, exchange_rate,
                                cashier_shift_id, reference, business_date, created_by)
                            VALUES (@id, @PaymentMethodId, @amount, @baseCur, @tCur, @tAmt, @tRate, @shift, @reference, @bd, @uid)
                            """, new { id, p.PaymentMethodId, amount, baseCur, tCur = tender?.Currency, tAmt = tender?.Amount, tRate = tender?.Rate, shift, reference, bd, uid = tx.User.Id });
                        paid += amount;
                    }
                    // Dövizli ödemede kurdan doğan kuruş farkı (en fazla 0,05) kabul edilir; fazlası para üstü olarak kasadan verilir, adisyona yazılmaz.
                    if (paid < total - 0.05m) throw PmsException.Validation($"Ödemeler ({paid:N2}) adisyon toplamından ({total:N2}) az.");
                    if (paid > total + 0.05m) throw PmsException.Validation($"Ödemeler ({paid:N2}) adisyon toplamını ({total:N2}) aşıyor. Para üstünü ödeme tutarına yansıtmayın.");
                    tx.Publish("cashier");
                    break;
                }
                default: throw PmsException.Validation("Kapanış türü 'room', 'payment' veya 'complimentary' olmalıdır.");
            }

            var docId = await ConsumeStockAsync(tx, c.CheckNo, outlet.WarehouseId, lines.Select(l => (l.ProductId, l.Quantity)).ToList(), bd);
            await tx.ExecAsync("""
                UPDATE pms.pos_checks SET status = 'closed', settlement = @Settlement, reservation_id = @reservationId, folio_line_id = @firstLine,
                    stock_document_id = @docId, total_amount = @total, closed_by = @uid, closed_at = now(), closed_business_date = @bd, version = version + 1
                WHERE id = @id
                """, new { id, req.Settlement, reservationId, firstLine, docId, total, uid = tx.User.Id, bd });
            await tx.AuditAsync("pos.check_close", "pos_check", id, null, new { req.Settlement, total, discount, reservationId });
            tx.Publish("pos");
            if (docId is not null) tx.Publish("stock");
            return await DetailAsync(tx, id);
        })).RequirePermission("pos.settle");

        g.MapPost("/checks/{id:guid}/cancel", (Guid id, CancelCheckRequest req, CommandRunner cmd) => cmd.RunAsync("pos.check_cancel", new { id, req }, async tx =>
        {
            var reason = Validate.Required(req.Reason, "İptal gerekçesi", 300);
            var c = await tx.OneOrNullAsync<(string Status, int Version, DateOnly? ClosedBd, string? Settlement, Guid? ReservationId, Guid? DocId, long CheckNo, Guid? OpenedBy)>("""
                SELECT status, version, closed_business_date, settlement, reservation_id, stock_document_id, check_no, opened_by FROM pms.pos_checks WHERE id = @id FOR UPDATE
                """, new { id });
            if (c == default) throw PmsException.NotFound("Adisyon");
            if (c.Version != req.Version) throw PmsException.Concurrency();
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            if (c.Status == "cancelled") throw PmsException.Validation("Adisyon zaten iptal edilmiş.");
            if (c.Status == "open")
            {
                var hasItems = await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.pos_check_lines WHERE check_id = @id AND NOT is_void)", new { id });
                // Boş adisyonu açan kişi kapatabilir; ürünlü adisyonu iptal etmek pos.void ister.
                if (hasItems || c.OpenedBy != tx.User.Id) tx.Ctx.Require("pos.void");
            }
            else
            {
                tx.Ctx.Require("pos.void");
                if (c.ClosedBd != bd) throw PmsException.Validation("Yalnız bugünkü iş gününde kapatılmış adisyon iptal edilebilir.");
                if (c.Settlement == "room")
                {
                    // Odaya yazılan tutar başka folyoya (ör. şirket) aktarıldıysa iptal eksik kalırdı: tutar aktarılan folyoda borç olarak
                    // dururken adisyon iptal görünürdü. Bu durumda iptal edilmez; düzeltme, tutarın bulunduğu folyoda gerekçeli düzeltmeyle yapılır.
                    var moved = await tx.ListAsync<string>("""
                        SELECT tf.folio_number FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id
                        JOIN pms.folio_lines t ON t.related_line_id = l.id AND t.line_type = 'transfer_out'
                        LEFT JOIN pms.folio_lines ti ON ti.related_line_id = t.id AND ti.line_type = 'transfer_in'
                        LEFT JOIN pms.folios tf ON tf.id = ti.folio_id
                        WHERE f.reservation_id = @rid AND l.reference = @reference AND l.line_type = 'charge'
                        """, new { rid = c.ReservationId, reference = $"ADS-{c.CheckNo}" });
                    if (moved.Count > 0)
                        throw PmsException.Validation($"Adisyon tutarı başka folyoya aktarılmış ({string.Join(", ", moved.Where(x => x is not null).Distinct())}); " +
                            "adisyon iptal edilemez. Tutarı düzeltmek için o folyoda gerekçeli düzeltme (allowance) girin.");
                    var charges = await tx.ListAsync<Guid>("""
                        SELECT l.id FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id
                        WHERE f.reservation_id = @rid AND l.reference = @reference AND l.line_type = 'charge'
                          AND NOT EXISTS (SELECT 1 FROM pms.folio_lines v WHERE v.related_line_id = l.id AND v.line_type IN ('void', 'transfer_out'))
                        """, new { rid = c.ReservationId, reference = $"ADS-{c.CheckNo}" });
                    foreach (var lid in charges) await FolioService.VoidAsync(tx, lid, new VoidRequest("Adisyon iptali: " + reason));
                }
                else if (c.Settlement == "payment")
                {
                    var shift = await FolioService.CurrentShiftAsync(tx, required: true);
                    await tx.ExecAsync("""
                        INSERT INTO pms.pos_payments (check_id, payment_method_id, amount, currency, tendered_currency, tendered_amount, exchange_rate,
                            cashier_shift_id, reference, business_date, is_reversal, created_by)
                        SELECT check_id, payment_method_id, -amount, currency, tendered_currency, -tendered_amount, exchange_rate, @shift, reference, @bd, true, @uid
                        FROM pms.pos_payments WHERE check_id = @id AND NOT is_reversal
                        """, new { id, shift, bd, uid = tx.User.Id });
                    tx.Publish("cashier");
                }
                if (c.DocId is { } docId)
                {
                    var moves = await tx.ListAsync<(Guid ItemId, Guid WarehouseId, decimal Quantity, decimal UnitCost)>(
                        "SELECT item_id, warehouse_id, quantity, unit_cost FROM pms.stock_movements WHERE document_id = @docId AND NOT is_reversal ORDER BY item_id", new { docId });
                    foreach (var m in moves)
                        await StockService.MoveAsync(tx, docId, m.ItemId, m.WarehouseId, -m.Quantity, m.UnitCost, bd, allowNegative: true, isReversal: true);
                    await tx.ExecAsync("""
                        UPDATE pms.stock_documents SET is_cancelled = true, cancelled_by = @uid, cancelled_at = now(), cancel_reason = @reason WHERE id = @docId
                        """, new { docId, uid = tx.User.Id, reason = "Adisyon iptali: " + reason });
                    tx.Publish("stock");
                }
            }
            await tx.ExecAsync("UPDATE pms.pos_checks SET status = 'cancelled', cancel_reason = @reason, version = version + 1 WHERE id = @id", new { id, reason });
            await tx.AuditAsync("pos.check_cancel", "pos_check", id, new { c.Status, c.Settlement }, null, reason);
            tx.Publish("pos");
            return await DetailAsync(tx, id);
        })).RequirePermission("pos.view");
    }

    sealed record OpenCheck(Guid OutletId, long CheckNo, int Version);

    static async Task<OpenCheck> LockOpenCheckAsync(Tx tx, Guid id, int? version = null)
    {
        var c = await tx.OneOrNullAsync<(Guid OutletId, long CheckNo, string Status, int Version)>(
            "SELECT outlet_id, check_no, status, version FROM pms.pos_checks WHERE id = @id FOR UPDATE", new { id });
        if (c == default) throw PmsException.NotFound("Adisyon");
        if (c.Status != "open") throw PmsException.Validation("Adisyon kapalı veya iptal edilmiş.");
        if (version is { } v && v != c.Version) throw PmsException.Concurrency();
        return new OpenCheck(c.OutletId, c.CheckNo, c.Version);
    }

    static Task TouchAsync(Tx tx, Guid id) => tx.ExecAsync("UPDATE pms.pos_checks SET version = version + 1 WHERE id = @id", new { id });

    /// <summary>Reçeteli ürünlerin malzemelerini satış noktasının deposundan düşer (satış engellenmez; eksi stok raporda görünür).</summary>
    static async Task<Guid?> ConsumeStockAsync(Tx tx, long checkNo, Guid? warehouseId, List<(Guid ProductId, decimal Quantity)> lines, DateOnly bd)
    {
        if (warehouseId is not { } wh) return null;
        var productIds = lines.Select(l => l.ProductId).Distinct().ToArray();
        var recipes = await tx.ListAsync<(Guid ProductId, Guid ItemId, decimal Quantity)>(
            "SELECT product_id, stock_item_id, quantity FROM pms.pos_recipes WHERE product_id = ANY(@productIds)", new { productIds });
        if (recipes.Count == 0) return null;
        var need = recipes.Join(lines, r => r.ProductId, l => l.ProductId, (r, l) => (r.ItemId, Qty: r.Quantity * l.Quantity))
            .GroupBy(x => x.ItemId).Select(x => (ItemId: x.Key, Qty: decimal.Round(x.Sum(y => y.Qty), 3, MidpointRounding.AwayFromZero)))
            .Where(x => x.Qty > 0).OrderBy(x => x.ItemId).ToList();
        if (need.Count == 0) return null;
        var docId = await StockService.CreateDocumentAsync(tx, "pos", wh, bd, reference: $"ADS-{checkNo}", department: "Satış (adisyon)");
        foreach (var n in need) await StockService.MoveAsync(tx, docId, n.ItemId, wh, -n.Qty, null, bd, allowNegative: true);
        return docId;
    }

    static async Task<CheckDetail> DetailAsync(Tx tx, Guid id)
    {
        var c = await tx.OneOrNullAsync<CheckDto>(CheckSelect + " WHERE c.id = @id", new { id }) ?? throw PmsException.NotFound("Adisyon");
        var lines = await tx.ListAsync<CheckLineDto>("""
            SELECT l.id, l.product_id, l.name, l.quantity, l.unit_price, l.amount, l.vat_rate, l.note, au.username AS added_by, l.added_at, l.is_void,
                   l.void_reason, vu.username AS voided_by, (p.printer_id IS NOT NULL) AS printable, l.sent_at
            FROM pms.pos_check_lines l JOIN pms.pos_products p ON p.id = l.product_id
            LEFT JOIN pms.users au ON au.id = l.added_by LEFT JOIN pms.users vu ON vu.id = l.voided_by
            WHERE l.check_id = @id ORDER BY l.added_at
            """, new { id });
        var pays = await tx.ListAsync<CheckPaymentDto>("""
            SELECT p.id, pm.name AS payment_method, p.amount, p.tendered_currency::text AS tendered_currency, p.tendered_amount, p.exchange_rate, p.reference,
                   p.is_reversal, u.username, p.created_at
            FROM pms.pos_payments p JOIN pms.payment_methods pm ON pm.id = p.payment_method_id LEFT JOIN pms.users u ON u.id = p.created_by
            WHERE p.check_id = @id ORDER BY p.created_at
            """, new { id });
        return new CheckDetail(c, lines, pays);
    }

    static async Task<(string code, string name)> OutletParamsAsync(Tx tx, SaveOutletRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 16).ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,16}$")) throw PmsException.Validation("Kod yalnız harf, rakam, - ve _ içerebilir.");
        var tc = await tx.OneOrNullAsync<(string Category, bool IsActive)>("SELECT category, is_active FROM pms.transaction_codes WHERE id = @TransactionCodeId", r);
        if (tc == default || !tc.IsActive) throw PmsException.Validation("İşlem kodu bulunamadı veya pasif.");
        if (tc.Category is "room" or "tax") throw PmsException.Validation("Satış noktasına oda veya vergi işlem kodu bağlanamaz.");
        if (r.WarehouseId is { } w) await StockService.EnsureWarehouseAsync(tx, w);
        return (code, Validate.Required(r.Name, "Ad", 100));
    }

    static async Task<Guid?> PrinterRefAsync(Tx tx, Guid? printerId)
    {
        if (printerId is not { } pid) return null;
        if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.pos_printers WHERE id = @pid)", new { pid })) throw PmsException.NotFound("Yazıcı");
        return pid;
    }

    static (string name, string host, int port, string cp, int width, bool active) PrinterParams(SavePosPrinterRequest r)
    {
        var host = Validate.Required(r.Host, "Yazıcı adresi", 253);
        if (!System.Text.RegularExpressions.Regex.IsMatch(host, "^[A-Za-z0-9.-]{1,253}$")) throw PmsException.Validation("Yazıcı adresi IP veya ağ adı olmalıdır (ör. 192.168.1.50).");
        if (r.Port is < 1 or > 65535) throw PmsException.Validation("Port 1-65535 arasında olmalıdır (fiş yazıcılarında genellikle 9100).");
        if (r.CodePage is not ("PC857" or "ASCII")) throw PmsException.Validation("Karakter seti PC857 veya ASCII olmalıdır.");
        if (r.LineWidth is < 24 or > 64) throw PmsException.Validation("Satır genişliği 24-64 karakter olmalıdır (80 mm: 42/48, 58 mm: 32).");
        return (Validate.Required(r.Name, "Yazıcı adı", 60), host, r.Port, r.CodePage, r.LineWidth, r.IsActive);
    }

    static (string code, string name, string category, decimal price, decimal vat, int sort, bool active) ProductParams(SavePosProductRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 24).ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_.-]{1,24}$")) throw PmsException.Validation("Ürün kodu yalnız harf, rakam, nokta, - ve _ içerebilir.");
        Validate.Money(r.Price, "Fiyat", allowZero: true);
        if (r.VatRate is < 0 or > 100) throw PmsException.Validation("KDV oranı 0-100 arasında olmalıdır.");
        return (code, Validate.Required(r.Name, "Ürün adı", 120), Validate.Required(r.Category, "Kategori", 60), r.Price, r.VatRate, r.SortOrder, r.IsActive);
    }

    static async Task WriteProductOutletsAsync(Tx tx, Guid productId, IReadOnlyList<Guid>? outlets)
    {
        foreach (var o in (outlets ?? []).Distinct())
        {
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.pos_outlets WHERE id = @o)", new { o })) throw PmsException.NotFound("Satış noktası");
            await tx.ExecAsync("INSERT INTO pms.pos_product_outlets (product_id, outlet_id) VALUES (@productId, @o)", new { productId, o });
        }
    }
}
