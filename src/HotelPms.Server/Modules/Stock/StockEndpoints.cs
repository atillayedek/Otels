using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Stock;

public sealed record WarehouseDto(Guid Id, string Code, string Name, bool IsActive, int Version);
public sealed record SaveWarehouseRequest(string Code, string Name, bool IsActive, int? Version);

public sealed record StockItemDto(Guid Id, string Code, string Name, string Unit, string? Category, string? Barcode, decimal? MinQty, decimal VatRate,
    bool IsActive, decimal TotalQty, int Version);
public sealed record SaveStockItemRequest(string Code, string Name, string Unit, string? Category, string? Barcode, decimal? MinQty, decimal VatRate,
    bool IsActive, int? Version);

public sealed record SupplierDto(Guid Id, string Name, string? TaxOffice, string? TaxNumber, string? ContactName, string? Phone, string? Email,
    string? Address, string? Notes, bool IsActive, int Version);
public sealed record SaveSupplierRequest(string Name, string? TaxOffice, string? TaxNumber, string? ContactName, string? Phone, string? Email,
    string? Address, string? Notes, bool IsActive, int? Version);

public sealed record StockBalanceDto(Guid WarehouseId, string WarehouseCode, string WarehouseName, Guid ItemId, string ItemCode, string ItemName,
    string Unit, string? Category, decimal Quantity, decimal AvgCost, decimal Value, decimal? MinQty);

public sealed record StockMovementDto(Guid Id, Guid DocumentId, string DocNo, string Kind, string WarehouseCode, decimal Quantity, decimal UnitCost,
    bool IsReversal, DateOnly BusinessDate, DateTime CreatedAt, string? Username, string? Party);

public sealed record StockDocumentDto(Guid Id, string DocNo, string Kind, Guid WarehouseId, string WarehouseName, string? TargetWarehouseName,
    Guid? SupplierId, string? SupplierName, string? PurchaseOrderNo, string? InvoiceNo, DateOnly? InvoiceDate, string? Department, string? Reference,
    string? Notes, DateOnly BusinessDate, string? Username, DateTime CreatedAt, bool IsCancelled, string? CancelReason, decimal TotalValue, int LineCount);
public sealed record StockDocumentLineDto(Guid ItemId, string ItemCode, string ItemName, string Unit, string WarehouseCode, decimal Quantity,
    decimal UnitCost, decimal Amount, bool IsReversal);
public sealed record StockDocumentDetail(StockDocumentDto Document, IReadOnlyList<StockDocumentLineDto> Lines);

public sealed record ReceiptLine(Guid ItemId, decimal Quantity, decimal UnitCost, Guid? PurchaseOrderLineId);
public sealed record CreateReceiptRequest(Guid WarehouseId, Guid SupplierId, Guid? PurchaseOrderId, string? InvoiceNo, DateOnly? InvoiceDate,
    string? Reference, string? Notes, IReadOnlyList<ReceiptLine> Lines);
public sealed record QtyLine(Guid ItemId, decimal Quantity);
public sealed record CreateIssueRequest(Guid WarehouseId, string Department, string? Reference, string? Notes, IReadOnlyList<QtyLine> Lines);
public sealed record CreateTransferRequest(Guid WarehouseId, Guid TargetWarehouseId, string? Notes, IReadOnlyList<QtyLine> Lines);
public sealed record CountLine(Guid ItemId, decimal CountedQuantity);
public sealed record CreateCountRequest(Guid WarehouseId, string? Notes, IReadOnlyList<CountLine> Lines);
public sealed record CancelStockDocumentRequest(string Reason);

public sealed record PurchaseOrderDto(Guid Id, string OrderNo, Guid SupplierId, string SupplierName, Guid WarehouseId, string WarehouseName, string Status,
    DateOnly OrderDate, DateOnly? ExpectedDate, string? Notes, string? CancelReason, decimal Total, string? Username, DateTime CreatedAt, int Version);
public sealed record PurchaseOrderLineDto(Guid Id, int LineNo, Guid ItemId, string ItemCode, string ItemName, string Unit, decimal Quantity,
    decimal UnitCost, decimal VatRate, decimal ReceivedQty, decimal Amount);
public sealed record PurchaseOrderDetail(PurchaseOrderDto Order, IReadOnlyList<PurchaseOrderLineDto> Lines);
public sealed record PurchaseOrderLineRequest(Guid ItemId, decimal Quantity, decimal UnitCost, decimal VatRate);
public sealed record SavePurchaseOrderRequest(Guid SupplierId, Guid WarehouseId, DateOnly? ExpectedDate, string? Notes,
    IReadOnlyList<PurchaseOrderLineRequest> Lines, int? Version);
public sealed record PurchaseOrderActionRequest(int Version, string? Reason);

public static class StockEndpoints
{
    const string ItemSelect = """
        SELECT i.id, i.code, i.name, i.unit, i.category, i.barcode, i.min_qty, i.vat_rate, i.is_active,
               COALESCE((SELECT sum(b.quantity) FROM pms.stock_balances b WHERE b.item_id = i.id), 0) AS total_qty, i.version
        FROM pms.stock_items i
        """;
    const string SupplierSelect = """
        SELECT id, name, tax_office, tax_number, contact_name, phone, email, address, notes, is_active, version FROM pms.suppliers
        """;
    const string DocSelect = """
        SELECT d.id, d.doc_no, d.kind, d.warehouse_id, w.name AS warehouse_name, tw.name AS target_warehouse_name, d.supplier_id, s.name AS supplier_name,
               po.order_no AS purchase_order_no, d.invoice_no, d.invoice_date, d.department, d.reference, d.notes, d.business_date, u.username,
               d.created_at, d.is_cancelled, d.cancel_reason,
               COALESCE((SELECT sum(abs(m.quantity) * m.unit_cost) FROM pms.stock_movements m WHERE m.document_id = d.id AND NOT m.is_reversal
                          AND (d.kind <> 'transfer' OR m.quantity < 0)), 0)::numeric(18,2) AS total_value,
               (SELECT count(*)::int FROM pms.stock_movements m WHERE m.document_id = d.id AND NOT m.is_reversal AND (d.kind <> 'transfer' OR m.quantity < 0)) AS line_count
        FROM pms.stock_documents d JOIN pms.warehouses w ON w.id = d.warehouse_id
        LEFT JOIN pms.warehouses tw ON tw.id = d.target_warehouse_id LEFT JOIN pms.suppliers s ON s.id = d.supplier_id
        LEFT JOIN pms.purchase_orders po ON po.id = d.purchase_order_id LEFT JOIN pms.users u ON u.id = d.created_by
        """;
    const string OrderSelect = """
        SELECT o.id, o.order_no, o.supplier_id, s.name AS supplier_name, o.warehouse_id, w.name AS warehouse_name, o.status, o.order_date, o.expected_date,
               o.notes, o.cancel_reason,
               COALESCE((SELECT sum(round(l.quantity * l.unit_cost * (1 + l.vat_rate / 100), 2)) FROM pms.purchase_order_lines l WHERE l.order_id = o.id), 0) AS total,
               u.username, o.created_at, o.version
        FROM pms.purchase_orders o JOIN pms.suppliers s ON s.id = o.supplier_id JOIN pms.warehouses w ON w.id = o.warehouse_id
        LEFT JOIN pms.users u ON u.id = o.created_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/stock").WithTags("Stock");

        // ---- Depolar
        g.MapGet("/warehouses", (Db db) => db.QueryAsync<WarehouseDto>("SELECT id, code, name, is_active, version FROM pms.warehouses ORDER BY code"))
            .RequireAnyPermission("stock.view", "pos.manage", "purchase.manage");
        g.MapPost("/warehouses", (SaveWarehouseRequest req, CommandRunner cmd) => cmd.RunAsync("warehouse.create", req, async tx =>
        {
            var (code, name) = WarehouseParams(req);
            var id = await tx.ScalarAsync<Guid>("INSERT INTO pms.warehouses (code, name, is_active) VALUES (@code, @name, @IsActive) RETURNING id",
                new { code, name, req.IsActive });
            await tx.AuditAsync("warehouse.create", "warehouse", id, null, req);
            tx.Publish("stock");
            return new { id };
        }, requireKey: false)).RequirePermission("stock.manage");
        g.MapPut("/warehouses/{id:guid}", (Guid id, SaveWarehouseRequest req, CommandRunner cmd) => cmd.RunAsync("warehouse.update", new { id, req }, async tx =>
        {
            var (code, name) = WarehouseParams(req);
            if (!req.IsActive && await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.stock_balances WHERE warehouse_id = @id AND quantity <> 0)", new { id }))
                throw PmsException.Validation("Stoğu olan depo pasifleştirilemez. Önce stoğu transfer edin veya sayımla sıfırlayın.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.warehouses SET code = @code, name = @name, is_active = @IsActive, version = version + 1 WHERE id = @id AND version = @version
                """, new { id, code, name, req.IsActive, version = req.Version ?? -1 });
            await tx.AuditAsync("warehouse.update", "warehouse", id, null, req);
            tx.Publish("stock");
            return new { id };
        }, requireKey: false)).RequirePermission("stock.manage");

        // ---- Stok kartları
        g.MapGet("/items", (Db db, string? q, bool? includeInactive) => db.QueryAsync<StockItemDto>(ItemSelect + """
             WHERE (@all OR i.is_active) AND (@q::text IS NULL OR i.code ILIKE '%' || @q || '%' OR i.name ILIKE '%' || @q || '%' OR i.barcode = @q)
            ORDER BY i.category NULLS LAST, i.name LIMIT 2000
            """, new { all = includeInactive ?? false, q = string.IsNullOrWhiteSpace(q) ? null : q.Trim() }))
            .RequireAnyPermission("stock.view", "pos.manage", "purchase.manage");
        g.MapPost("/items", (SaveStockItemRequest req, CommandRunner cmd) => cmd.RunAsync("stock_item.create", req, async tx =>
        {
            var p = ItemParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.stock_items (code, name, unit, category, barcode, min_qty, vat_rate, is_active)
                VALUES (@code, @name, @unit, @category, @barcode, @minQty, @vatRate, @isActive) RETURNING id
                """, new { p.code, p.name, p.unit, p.category, p.barcode, p.minQty, p.vatRate, p.isActive });
            await tx.AuditAsync("stock_item.create", "stock_item", id, null, req);
            tx.Publish("stock");
            return new { id };
        }, requireKey: false)).RequirePermission("stock.manage");
        g.MapPut("/items/{id:guid}", (Guid id, SaveStockItemRequest req, CommandRunner cmd) => cmd.RunAsync("stock_item.update", new { id, req }, async tx =>
        {
            var p = ItemParams(req);
            var before = await tx.OneOrNullAsync<StockItemDto>(ItemSelect + " WHERE i.id = @id", new { id }) ?? throw PmsException.NotFound("Stok kartı");
            if (before.Unit != p.unit && await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.stock_movements WHERE item_id = @id)", new { id }))
                throw PmsException.Validation("Hareket görmüş stok kartının birimi değiştirilemez. Yeni kart açın.");
            await tx.ExecVersionedAsync("""
                UPDATE pms.stock_items SET code = @code, name = @name, unit = @unit, category = @category, barcode = @barcode, min_qty = @minQty,
                    vat_rate = @vatRate, is_active = @isActive, version = version + 1
                WHERE id = @id AND version = @version
                """, new { p.code, p.name, p.unit, p.category, p.barcode, p.minQty, p.vatRate, p.isActive, id, version = req.Version ?? -1 });
            await tx.AuditAsync("stock_item.update", "stock_item", id, before, req);
            tx.Publish("stock");
            return new { id };
        }, requireKey: false)).RequirePermission("stock.manage");
        g.MapGet("/items/{id:guid}/movements", (Guid id, Guid? warehouseId, Db db) => db.QueryAsync<StockMovementDto>("""
            SELECT m.id, m.document_id, d.doc_no, d.kind, w.code AS warehouse_code, m.quantity, m.unit_cost, m.is_reversal, m.business_date, m.created_at,
                   u.username, COALESCE(s.name, d.department, tw.name) AS party
            FROM pms.stock_movements m JOIN pms.stock_documents d ON d.id = m.document_id JOIN pms.warehouses w ON w.id = m.warehouse_id
            LEFT JOIN pms.users u ON u.id = m.created_by LEFT JOIN pms.suppliers s ON s.id = d.supplier_id LEFT JOIN pms.warehouses tw ON tw.id = d.target_warehouse_id
            WHERE m.item_id = @id AND (@warehouseId::uuid IS NULL OR m.warehouse_id = @warehouseId)
            ORDER BY m.created_at DESC LIMIT 500
            """, new { id, warehouseId })).RequirePermission("stock.view");

        // ---- Tedarikçiler
        g.MapGet("/suppliers", (Db db, bool? includeInactive) => db.QueryAsync<SupplierDto>(SupplierSelect + " WHERE @all OR is_active ORDER BY name",
            new { all = includeInactive ?? false })).RequireAnyPermission("stock.view", "purchase.manage");
        g.MapPost("/suppliers", (SaveSupplierRequest req, CommandRunner cmd) => cmd.RunAsync("supplier.create", req, async tx =>
        {
            var p = SupplierParams(req);
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.suppliers (name, tax_office, tax_number, contact_name, phone, email, address, notes, is_active)
                VALUES (@name, @taxOffice, @taxNumber, @contact, @phone, @email, @address, @notes, @isActive) RETURNING id
                """, new { p.name, p.taxOffice, p.taxNumber, p.contact, p.phone, p.email, p.address, p.notes, p.isActive });
            await tx.AuditAsync("supplier.create", "supplier", id, null, req);
            tx.Publish("stock");
            return new { id };
        }, requireKey: false)).RequireAnyPermission("stock.manage", "purchase.manage");
        g.MapPut("/suppliers/{id:guid}", (Guid id, SaveSupplierRequest req, CommandRunner cmd) => cmd.RunAsync("supplier.update", new { id, req }, async tx =>
        {
            var p = SupplierParams(req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.suppliers SET name = @name, tax_office = @taxOffice, tax_number = @taxNumber, contact_name = @contact, phone = @phone, email = @email,
                    address = @address, notes = @notes, is_active = @isActive, version = version + 1
                WHERE id = @id AND version = @version
                """, new { p.name, p.taxOffice, p.taxNumber, p.contact, p.phone, p.email, p.address, p.notes, p.isActive, id, version = req.Version ?? -1 });
            await tx.AuditAsync("supplier.update", "supplier", id, null, req);
            tx.Publish("stock");
            return new { id };
        }, requireKey: false)).RequireAnyPermission("stock.manage", "purchase.manage");

        // ---- Bakiyeler
        g.MapGet("/balances", (Db db, Guid? warehouseId, string? q, bool? lowOnly, bool? nonZero) => db.QueryAsync<StockBalanceDto>("""
            SELECT w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name, i.id AS item_id, i.code AS item_code, i.name AS item_name,
                   i.unit, i.category, b.quantity, b.avg_cost, round(GREATEST(b.quantity, 0) * b.avg_cost, 2) AS value, i.min_qty
            FROM pms.stock_balances b JOIN pms.warehouses w ON w.id = b.warehouse_id JOIN pms.stock_items i ON i.id = b.item_id
            WHERE (@warehouseId::uuid IS NULL OR b.warehouse_id = @warehouseId)
              AND (@q::text IS NULL OR i.code ILIKE '%' || @q || '%' OR i.name ILIKE '%' || @q || '%')
              AND (NOT @nonZero OR b.quantity <> 0)
              AND (NOT @lowOnly OR b.quantity < 0 OR (i.min_qty IS NOT NULL AND b.quantity < i.min_qty))
            ORDER BY w.code, i.category NULLS LAST, i.name
            """, new { warehouseId, q = string.IsNullOrWhiteSpace(q) ? null : q.Trim(), lowOnly = lowOnly ?? false, nonZero = nonZero ?? false }))
            .RequirePermission("stock.view");

        // ---- Belgeler
        g.MapGet("/documents", (Db db, string? kind, DateOnly? from, DateOnly? to, Guid? warehouseId, Guid? supplierId) => db.QueryAsync<StockDocumentDto>(DocSelect + """
             WHERE (@kind::text IS NULL OR d.kind = @kind) AND (@from::date IS NULL OR d.business_date >= @from) AND (@to::date IS NULL OR d.business_date <= @to)
               AND (@warehouseId::uuid IS NULL OR d.warehouse_id = @warehouseId OR d.target_warehouse_id = @warehouseId)
               AND (@supplierId::uuid IS NULL OR d.supplier_id = @supplierId)
            ORDER BY d.created_at DESC LIMIT 1000
            """, new { kind, from, to, warehouseId, supplierId })).RequirePermission("stock.view");
        g.MapGet("/documents/{id:guid}", (Guid id, CommandRunner cmd) => cmd.ReadAsync(async tx =>
        {
            var d = await tx.OneOrNullAsync<StockDocumentDto>(DocSelect + " WHERE d.id = @id", new { id }) ?? throw PmsException.NotFound("Stok belgesi");
            var lines = await tx.ListAsync<StockDocumentLineDto>("""
                SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.unit, w.code AS warehouse_code, m.quantity, m.unit_cost,
                       round(m.quantity * m.unit_cost, 2) AS amount, m.is_reversal
                FROM pms.stock_movements m JOIN pms.stock_items i ON i.id = m.item_id JOIN pms.warehouses w ON w.id = m.warehouse_id
                WHERE m.document_id = @id ORDER BY m.is_reversal, m.created_at, i.name
                """, new { id });
            return new StockDocumentDetail(d, lines);
        })).RequirePermission("stock.view");

        g.MapPost("/receipts", (CreateReceiptRequest req, CommandRunner cmd) => cmd.RunAsync("stock.receipt", req, async tx =>
        {
            await StockService.EnsureWarehouseAsync(tx, req.WarehouseId);
            if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.suppliers WHERE id = @SupplierId AND is_active)", req))
                throw PmsException.Validation("Tedarikçi bulunamadı veya pasif.");
            var lines = DistinctLines(req.Lines, l => l.ItemId);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            if (req.PurchaseOrderId is { } poId)
            {
                var po = await tx.OneOrNullAsync<(string Status, Guid SupplierId, Guid WarehouseId)>(
                    "SELECT status, supplier_id, warehouse_id FROM pms.purchase_orders WHERE id = @poId FOR UPDATE", new { poId });
                if (po == default) throw PmsException.NotFound("Satın alma siparişi");
                if (po.Status is not ("ordered" or "partially_received")) throw PmsException.Validation("Yalnız gönderilmiş ve teslim alınmamış siparişlere mal kabul yapılabilir.");
                if (po.SupplierId != req.SupplierId || po.WarehouseId != req.WarehouseId) throw PmsException.Validation("Mal kabulün tedarikçisi ve deposu siparişle aynı olmalıdır.");
            }
            else if (lines.Any(l => l.PurchaseOrderLineId is not null)) throw PmsException.Validation("Sipariş satırı yalnız siparişe bağlı mal kabulde kullanılabilir.");

            var docId = await StockService.CreateDocumentAsync(tx, "receipt", req.WarehouseId, bd, supplierId: req.SupplierId, purchaseOrderId: req.PurchaseOrderId,
                invoiceNo: Validate.Optional(req.InvoiceNo, 50), invoiceDate: req.InvoiceDate, reference: Validate.Optional(req.Reference, 100),
                notes: Validate.Optional(req.Notes, 1000));
            foreach (var l in lines.OrderBy(l => l.ItemId))
            {
                var label = await StockService.EnsureItemAsync(tx, l.ItemId);
                StockService.Quantity(l.Quantity);
                StockService.Cost(l.UnitCost);
                await StockService.MoveAsync(tx, docId, l.ItemId, req.WarehouseId, l.Quantity, l.UnitCost, bd, allowNegative: true, itemLabel: label);
                if (l.PurchaseOrderLineId is { } polId)
                {
                    if (await tx.ExecAsync("""
                        UPDATE pms.purchase_order_lines SET received_qty = received_qty + @Quantity WHERE id = @polId AND order_id = @po AND item_id = @ItemId
                        """, new { l.Quantity, polId, po = req.PurchaseOrderId, l.ItemId }) == 0)
                        throw PmsException.Validation($"{label}: sipariş satırı bu siparişe ait değil.");
                }
            }
            if (req.PurchaseOrderId is { } orderId) await RefreshOrderStatusAsync(tx, orderId);
            await tx.AuditAsync("stock.receipt", "stock_document", docId, null, req);
            tx.Publish("stock");
            return new { id = docId };
        })).RequirePermission("stock.receive");

        g.MapPost("/issues", (CreateIssueRequest req, CommandRunner cmd) => cmd.RunAsync("stock.issue", req, async tx =>
        {
            await StockService.EnsureWarehouseAsync(tx, req.WarehouseId);
            var dept = Validate.Required(req.Department, "Çıkış yapılan bölüm", 100);
            var lines = DistinctLines(req.Lines, l => l.ItemId);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var allowNeg = await StockService.AllowNegativeAsync(tx);
            var docId = await StockService.CreateDocumentAsync(tx, "issue", req.WarehouseId, bd, department: dept, reference: Validate.Optional(req.Reference, 100),
                notes: Validate.Optional(req.Notes, 1000));
            foreach (var l in lines.OrderBy(l => l.ItemId))
            {
                var label = await StockService.EnsureItemAsync(tx, l.ItemId);
                await StockService.MoveAsync(tx, docId, l.ItemId, req.WarehouseId, -StockService.Quantity(l.Quantity), null, bd, allowNeg, itemLabel: label);
            }
            await tx.AuditAsync("stock.issue", "stock_document", docId, null, req);
            tx.Publish("stock");
            return new { id = docId };
        })).RequirePermission("stock.issue");

        g.MapPost("/transfers", (CreateTransferRequest req, CommandRunner cmd) => cmd.RunAsync("stock.transfer", req, async tx =>
        {
            if (req.WarehouseId == req.TargetWarehouseId) throw PmsException.Validation("Kaynak ve hedef depo farklı olmalıdır.");
            await StockService.EnsureWarehouseAsync(tx, req.WarehouseId, "Kaynak depo");
            await StockService.EnsureWarehouseAsync(tx, req.TargetWarehouseId, "Hedef depo");
            var lines = DistinctLines(req.Lines, l => l.ItemId);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var allowNeg = await StockService.AllowNegativeAsync(tx);
            var docId = await StockService.CreateDocumentAsync(tx, "transfer", req.WarehouseId, bd, targetWarehouseId: req.TargetWarehouseId,
                notes: Validate.Optional(req.Notes, 1000));
            foreach (var l in lines.OrderBy(l => l.ItemId))
            {
                var label = await StockService.EnsureItemAsync(tx, l.ItemId);
                var qty = StockService.Quantity(l.Quantity);
                var cost = await StockService.MoveAsync(tx, docId, l.ItemId, req.WarehouseId, -qty, null, bd, allowNeg, itemLabel: label);
                await StockService.MoveAsync(tx, docId, l.ItemId, req.TargetWarehouseId, qty, cost, bd, allowNegative: true, itemLabel: label);
            }
            await tx.AuditAsync("stock.transfer", "stock_document", docId, null, req);
            tx.Publish("stock");
            return new { id = docId };
        })).RequirePermission("stock.issue");

        g.MapPost("/counts", (CreateCountRequest req, CommandRunner cmd) => cmd.RunAsync("stock.count", req, async tx =>
        {
            await StockService.EnsureWarehouseAsync(tx, req.WarehouseId);
            var lines = DistinctLines(req.Lines, l => l.ItemId);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var docId = await StockService.CreateDocumentAsync(tx, "count", req.WarehouseId, bd, notes: Validate.Optional(req.Notes, 1000));
            var adjusted = 0;
            foreach (var l in lines.OrderBy(l => l.ItemId))
            {
                var label = await StockService.EnsureItemAsync(tx, l.ItemId);
                if (l.CountedQuantity < 0 || decimal.Round(l.CountedQuantity, 3) != l.CountedQuantity)
                    throw PmsException.Validation($"{label}: sayılan miktar sıfır veya pozitif, en fazla 3 ondalıklı olmalıdır.");
                var current = await tx.ScalarAsync<decimal?>("SELECT quantity FROM pms.stock_balances WHERE warehouse_id = @w AND item_id = @i FOR UPDATE",
                    new { w = req.WarehouseId, i = l.ItemId }) ?? 0;
                var diff = l.CountedQuantity - current;
                if (diff == 0) continue;
                await StockService.MoveAsync(tx, docId, l.ItemId, req.WarehouseId, diff, null, bd, allowNegative: true, itemLabel: label);
                adjusted++;
            }
            if (adjusted == 0) throw PmsException.Validation("Sayım sonucunda fark yok; belge oluşturulmadı.");
            await tx.AuditAsync("stock.count", "stock_document", docId, null, new { req.WarehouseId, adjusted, req.Lines });
            tx.Publish("stock");
            return new { id = docId, adjusted };
        })).RequirePermission("stock.count");

        g.MapPost("/documents/{id:guid}/cancel", (Guid id, CancelStockDocumentRequest req, CommandRunner cmd) => cmd.RunAsync("stock.cancel", new { id, req }, async tx =>
        {
            var reason = Validate.Required(req.Reason, "İptal gerekçesi", 300);
            var d = await tx.OneOrNullAsync<(string Kind, bool IsCancelled, Guid? PurchaseOrderId)>(
                "SELECT kind, is_cancelled, purchase_order_id FROM pms.stock_documents WHERE id = @id FOR UPDATE", new { id });
            if (d == default) throw PmsException.NotFound("Stok belgesi");
            if (d.IsCancelled) throw PmsException.Validation("Belge zaten iptal edilmiş.");
            if (d.Kind == "pos") throw PmsException.Validation("Satış tüketim belgesi buradan iptal edilemez; ilgili adisyon iptal edilmelidir.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var moves = await tx.ListAsync<(Guid ItemId, Guid WarehouseId, decimal Quantity, decimal UnitCost)>("""
                SELECT item_id, warehouse_id, quantity, unit_cost FROM pms.stock_movements WHERE document_id = @id AND NOT is_reversal ORDER BY item_id, quantity
                """, new { id });
            // İptal, iptal anındaki bakiyeyi eksiye düşürebilir (girdi tüketilmişse); bu durumda ayar ne olursa olsun iptale izin verilmez.
            foreach (var m in moves)
                await StockService.MoveAsync(tx, id, m.ItemId, m.WarehouseId, -m.Quantity, m.UnitCost, bd, allowNegative: m.Quantity < 0, isReversal: true);
            if (d.Kind == "receipt" && d.PurchaseOrderId is { } poId)
            {
                await tx.ExecAsync("SELECT 1 FROM pms.purchase_orders WHERE id = @poId FOR UPDATE", new { poId });
                var recv = await tx.ListAsync<(Guid ItemId, decimal Quantity)>(
                    "SELECT item_id, quantity FROM pms.stock_movements WHERE document_id = @id AND NOT is_reversal", new { id });
                foreach (var r in recv)
                    await tx.ExecAsync("""
                        UPDATE pms.purchase_order_lines SET received_qty = GREATEST(received_qty - @Quantity, 0)
                        WHERE id = (SELECT id FROM pms.purchase_order_lines WHERE order_id = @poId AND item_id = @ItemId AND received_qty > 0 ORDER BY line_no LIMIT 1)
                        """, new { r.Quantity, poId, r.ItemId });
                await RefreshOrderStatusAsync(tx, poId);
            }
            await tx.ExecAsync("""
                UPDATE pms.stock_documents SET is_cancelled = true, cancelled_by = @uid, cancelled_at = now(), cancel_reason = @reason WHERE id = @id
                """, new { id, uid = tx.User.Id, reason });
            await tx.AuditAsync("stock.cancel", "stock_document", id, null, null, reason);
            tx.Publish("stock");
            return new { id };
        })).RequirePermission("stock.manage");

        // ---- Satın alma siparişleri
        var po = app.MapGroup("/api/v1/purchase-orders").WithTags("Stock");
        po.MapGet("/", (Db db, string? status, Guid? supplierId) => db.QueryAsync<PurchaseOrderDto>(OrderSelect + """
             WHERE (@status::text IS NULL OR o.status = @status OR (@status = 'open' AND o.status IN ('ordered','partially_received')))
               AND (@supplierId::uuid IS NULL OR o.supplier_id = @supplierId)
            ORDER BY o.created_at DESC LIMIT 500
            """, new { status, supplierId })).RequireAnyPermission("purchase.manage", "stock.receive");
        po.MapGet("/{id:guid}", (Guid id, CommandRunner cmd) => cmd.ReadAsync(tx => OrderDetailAsync(tx, id)))
            .RequireAnyPermission("purchase.manage", "stock.receive");
        po.MapPost("/", (SavePurchaseOrderRequest req, CommandRunner cmd) => cmd.RunAsync("purchase_order.create", req, async tx =>
        {
            await ValidateOrderAsync(tx, req);
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var no = "PO" + await tx.ScalarAsync<long>("SELECT nextval('pms.purchase_order_seq')");
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.purchase_orders (order_no, supplier_id, warehouse_id, order_date, expected_date, notes, created_by)
                VALUES (@no, @SupplierId, @WarehouseId, @bd, @ExpectedDate, @notes, @uid) RETURNING id
                """, new { no, req.SupplierId, req.WarehouseId, bd, req.ExpectedDate, notes = Validate.Optional(req.Notes, 1000), uid = tx.User.Id });
            await WriteOrderLinesAsync(tx, id, req.Lines);
            await tx.AuditAsync("purchase_order.create", "purchase_order", id, null, req);
            tx.Publish("stock");
            return new { id, orderNo = no };
        })).RequirePermission("purchase.manage");
        po.MapPut("/{id:guid}", (Guid id, SavePurchaseOrderRequest req, CommandRunner cmd) => cmd.RunAsync("purchase_order.update", new { id, req }, async tx =>
        {
            var status = await tx.ScalarAsync<string?>("SELECT status FROM pms.purchase_orders WHERE id = @id FOR UPDATE", new { id }) ?? throw PmsException.NotFound("Sipariş");
            if (status != "draft") throw PmsException.Validation("Yalnız taslak sipariş düzenlenebilir.");
            await ValidateOrderAsync(tx, req);
            await tx.ExecVersionedAsync("""
                UPDATE pms.purchase_orders SET supplier_id = @SupplierId, warehouse_id = @WarehouseId, expected_date = @ExpectedDate, notes = @notes,
                    updated_at = now(), version = version + 1
                WHERE id = @id AND version = @version
                """, new { id, req.SupplierId, req.WarehouseId, req.ExpectedDate, notes = Validate.Optional(req.Notes, 1000), version = req.Version ?? -1 });
            await tx.ExecAsync("DELETE FROM pms.purchase_order_lines WHERE order_id = @id", new { id });
            await WriteOrderLinesAsync(tx, id, req.Lines);
            await tx.AuditAsync("purchase_order.update", "purchase_order", id, null, req);
            tx.Publish("stock");
            return new { id };
        })).RequirePermission("purchase.manage");
        po.MapPost("/{id:guid}/send", (Guid id, PurchaseOrderActionRequest req, CommandRunner cmd) => cmd.RunAsync("purchase_order.send", new { id, req }, async tx =>
        {
            var status = await tx.ScalarAsync<string?>("SELECT status FROM pms.purchase_orders WHERE id = @id FOR UPDATE", new { id }) ?? throw PmsException.NotFound("Sipariş");
            if (status != "draft") throw PmsException.Validation("Yalnız taslak sipariş gönderilebilir.");
            await tx.ExecVersionedAsync("UPDATE pms.purchase_orders SET status = 'ordered', updated_at = now(), version = version + 1 WHERE id = @id AND version = @version",
                new { id, version = req.Version });
            await tx.AuditAsync("purchase_order.send", "purchase_order", id, new { status }, new { status = "ordered" });
            tx.Publish("stock");
            return new { id };
        })).RequirePermission("purchase.manage");
        po.MapPost("/{id:guid}/cancel", (Guid id, PurchaseOrderActionRequest req, CommandRunner cmd) => cmd.RunAsync("purchase_order.cancel", new { id, req }, async tx =>
        {
            var reason = Validate.Required(req.Reason, "İptal gerekçesi", 300);
            var status = await tx.ScalarAsync<string?>("SELECT status FROM pms.purchase_orders WHERE id = @id FOR UPDATE", new { id }) ?? throw PmsException.NotFound("Sipariş");
            if (status is "received" or "cancelled") throw PmsException.Validation("Teslim alınmış veya iptal edilmiş sipariş iptal edilemez.");
            // Kısmen teslim alınan siparişte kalan miktar kapatılır; alınan mallar stokta kalır.
            await tx.ExecVersionedAsync("""
                UPDATE pms.purchase_orders SET status = 'cancelled', cancel_reason = @reason, updated_at = now(), version = version + 1 WHERE id = @id AND version = @version
                """, new { id, reason, version = req.Version });
            await tx.AuditAsync("purchase_order.cancel", "purchase_order", id, new { status }, new { status = "cancelled" }, reason);
            tx.Publish("stock");
            return new { id };
        })).RequirePermission("purchase.manage");
    }

    static List<T> DistinctLines<T>(IReadOnlyList<T>? lines, Func<T, Guid> key)
    {
        if (lines is null || lines.Count == 0) throw PmsException.Validation("En az bir satır girin.");
        if (lines.Count > 500) throw PmsException.Validation("Bir belgede en fazla 500 satır olabilir.");
        if (lines.Select(key).Distinct().Count() != lines.Count) throw PmsException.Validation("Aynı stok kartı birden fazla satırda; satırları birleştirin.");
        return lines.ToList();
    }

    static async Task RefreshOrderStatusAsync(Tx tx, Guid orderId) => await tx.ExecAsync("""
        UPDATE pms.purchase_orders o SET status = CASE
                WHEN NOT EXISTS (SELECT 1 FROM pms.purchase_order_lines l WHERE l.order_id = o.id AND l.received_qty < l.quantity) THEN 'received'
                WHEN EXISTS (SELECT 1 FROM pms.purchase_order_lines l WHERE l.order_id = o.id AND l.received_qty > 0) THEN 'partially_received'
                ELSE 'ordered' END,
            updated_at = now(), version = version + 1
        WHERE o.id = @orderId AND o.status <> 'cancelled'
        """, new { orderId });

    static async Task<PurchaseOrderDetail> OrderDetailAsync(Tx tx, Guid id)
    {
        var o = await tx.OneOrNullAsync<PurchaseOrderDto>(OrderSelect + " WHERE o.id = @id", new { id }) ?? throw PmsException.NotFound("Sipariş");
        var lines = await tx.ListAsync<PurchaseOrderLineDto>("""
            SELECT l.id, l.line_no, l.item_id, i.code AS item_code, i.name AS item_name, i.unit, l.quantity, l.unit_cost, l.vat_rate, l.received_qty,
                   round(l.quantity * l.unit_cost * (1 + l.vat_rate / 100), 2) AS amount
            FROM pms.purchase_order_lines l JOIN pms.stock_items i ON i.id = l.item_id WHERE l.order_id = @id ORDER BY l.line_no
            """, new { id });
        return new PurchaseOrderDetail(o, lines);
    }

    static async Task ValidateOrderAsync(Tx tx, SavePurchaseOrderRequest req)
    {
        if (!await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.suppliers WHERE id = @SupplierId AND is_active)", req))
            throw PmsException.Validation("Tedarikçi bulunamadı veya pasif.");
        await StockService.EnsureWarehouseAsync(tx, req.WarehouseId);
        var lines = DistinctLines(req.Lines, l => l.ItemId);
        foreach (var l in lines)
        {
            await StockService.EnsureItemAsync(tx, l.ItemId);
            StockService.Quantity(l.Quantity);
            StockService.Cost(l.UnitCost);
            if (l.VatRate is < 0 or > 100) throw PmsException.Validation("KDV oranı 0-100 arasında olmalıdır.");
        }
    }

    static async Task WriteOrderLinesAsync(Tx tx, Guid orderId, IReadOnlyList<PurchaseOrderLineRequest> lines)
    {
        var n = 1;
        foreach (var l in lines)
            await tx.ExecAsync("""
                INSERT INTO pms.purchase_order_lines (order_id, line_no, item_id, quantity, unit_cost, vat_rate) VALUES (@orderId, @n, @ItemId, @Quantity, @UnitCost, @VatRate)
                """, new { orderId, n = n++, l.ItemId, l.Quantity, l.UnitCost, l.VatRate });
    }

    static (string code, string name) WarehouseParams(SaveWarehouseRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 16).ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,16}$")) throw PmsException.Validation("Depo kodu yalnız harf, rakam, - ve _ içerebilir.");
        return (code, Validate.Required(r.Name, "Depo adı", 100));
    }

    static (string code, string name, string unit, string? category, string? barcode, decimal? minQty, decimal vatRate, bool isActive) ItemParams(SaveStockItemRequest r)
    {
        var code = Validate.Required(r.Code, "Kod", 24).ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_.-]{1,24}$")) throw PmsException.Validation("Stok kodu yalnız harf, rakam, nokta, - ve _ içerebilir.");
        if (r.MinQty is { } m && (m < 0 || decimal.Round(m, 3) != m)) throw PmsException.Validation("Asgari stok sıfır veya pozitif, en fazla 3 ondalıklı olmalıdır.");
        if (r.VatRate is < 0 or > 100) throw PmsException.Validation("KDV oranı 0-100 arasında olmalıdır.");
        return (code, Validate.Required(r.Name, "Ad", 150), Validate.Required(r.Unit, "Birim", 12), Validate.Optional(r.Category, 60),
            Validate.Optional(r.Barcode, 40), r.MinQty, r.VatRate, r.IsActive);
    }

    static (string name, string? taxOffice, string? taxNumber, string? contact, string? phone, string? email, string? address, string? notes, bool isActive)
        SupplierParams(SaveSupplierRequest r)
    {
        var tax = Validate.Optional(r.TaxNumber, 11);
        if (tax is not null && !System.Text.RegularExpressions.Regex.IsMatch(tax, "^[0-9]{10,11}$"))
            throw PmsException.Validation("Vergi numarası 10, T.C. kimlik numarası 11 haneli olmalıdır.");
        return (Validate.Required(r.Name, "Tedarikçi adı", 200), Validate.Optional(r.TaxOffice, 100), tax, Validate.Optional(r.ContactName, 100),
            Validate.Optional(r.Phone, 40), Validate.Email(r.Email), Validate.Optional(r.Address, 500), Validate.Optional(r.Notes, 1000), r.IsActive);
    }
}
