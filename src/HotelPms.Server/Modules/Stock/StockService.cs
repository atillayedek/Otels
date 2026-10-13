using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Stock;

/// <summary>
/// Stok hareketi ve bakiye. Her hareket bakiye satırını kilitleyerek yazar; ağırlıklı ortalama maliyet girişlerde güncellenir.
/// Hareketler değiştirilemez; belge iptali ters hareket yazar.
/// </summary>
public static class StockService
{
    public sealed record Balance(decimal Quantity, decimal AvgCost);

    static async Task<Balance> LockBalanceAsync(Tx tx, Guid warehouseId, Guid itemId)
    {
        await tx.ExecAsync("""
            INSERT INTO pms.stock_balances (warehouse_id, item_id) VALUES (@warehouseId, @itemId) ON CONFLICT (warehouse_id, item_id) DO NOTHING
            """, new { warehouseId, itemId });
        return await tx.OneAsync<Balance>(
            "SELECT quantity, avg_cost FROM pms.stock_balances WHERE warehouse_id = @warehouseId AND item_id = @itemId FOR UPDATE", new { warehouseId, itemId });
    }

    /// <summary>
    /// Stok hareketi yazar. qty işaretlidir (giriş +, çıkış −). Girişte unitCost zorunludur ve ortalama maliyeti günceller;
    /// çıkışta unitCost verilmezse ortalama maliyetten çıkılır. Ters kayıt (iptal) girişte verilen maliyetle ortalamayı geri alır.
    /// Dönen değer, hareketin birim maliyetidir.
    /// </summary>
    public static async Task<decimal> MoveAsync(Tx tx, Guid documentId, Guid itemId, Guid warehouseId, decimal qty, decimal? unitCost, DateOnly bd,
        bool allowNegative, bool isReversal = false, string? itemLabel = null)
    {
        if (qty == 0) throw PmsException.Validation("Miktar sıfır olamaz.");
        var b = await LockBalanceAsync(tx, warehouseId, itemId);
        var newQty = b.Quantity + qty;
        decimal cost, newAvg;
        if (qty > 0)
        {
            cost = unitCost ?? b.AvgCost;
            newAvg = b.Quantity > 0 && newQty > 0 ? (b.Quantity * b.AvgCost + qty * cost) / newQty : cost;
        }
        else
        {
            if (newQty < 0 && !allowNegative)
            {
                var label = itemLabel ?? await tx.ScalarAsync<string>("SELECT code || ' ' || name FROM pms.stock_items WHERE id = @itemId", new { itemId });
                var wh = await tx.ScalarAsync<string>("SELECT name FROM pms.warehouses WHERE id = @warehouseId", new { warehouseId });
                throw PmsException.Validation($"{label}: {wh} deposunda yeterli stok yok (mevcut {b.Quantity:0.###}, istenen {-qty:0.###}).");
            }
            cost = unitCost ?? b.AvgCost;
            // Giriş iptalinde (verilen maliyetle çıkış) ortalama, o girişin etkisi çıkarılarak yeniden hesaplanır.
            newAvg = unitCost is not null && isReversal && newQty > 0
                ? Math.Max((b.Quantity * b.AvgCost + qty * cost) / newQty, 0)
                : b.AvgCost;
        }
        newAvg = decimal.Round(newAvg, 4, MidpointRounding.AwayFromZero);
        cost = decimal.Round(cost, 4, MidpointRounding.AwayFromZero);
        await tx.ExecAsync("""
            UPDATE pms.stock_balances SET quantity = @newQty, avg_cost = @newAvg, updated_at = now() WHERE warehouse_id = @warehouseId AND item_id = @itemId
            """, new { newQty, newAvg, warehouseId, itemId });
        await tx.ExecAsync("""
            INSERT INTO pms.stock_movements (document_id, item_id, warehouse_id, quantity, unit_cost, is_reversal, business_date, created_by)
            VALUES (@documentId, @itemId, @warehouseId, @qty, @cost, @isReversal, @bd, @uid)
            """, new { documentId, itemId, warehouseId, qty, cost, isReversal, bd, uid = tx.Ctx.User?.Id });
        return cost;
    }

    public static async Task<Guid> CreateDocumentAsync(Tx tx, string kind, Guid warehouseId, DateOnly bd, Guid? targetWarehouseId = null,
        Guid? supplierId = null, Guid? purchaseOrderId = null, string? invoiceNo = null, DateOnly? invoiceDate = null, string? department = null,
        string? reference = null, string? notes = null)
    {
        var no = "S" + await tx.ScalarAsync<long>("SELECT nextval('pms.stock_document_seq')");
        return await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.stock_documents (doc_no, kind, warehouse_id, target_warehouse_id, supplier_id, purchase_order_id, invoice_no, invoice_date,
                department, reference, notes, business_date, created_by)
            VALUES (@no, @kind, @warehouseId, @targetWarehouseId, @supplierId, @purchaseOrderId, @invoiceNo, @invoiceDate, @department, @reference, @notes, @bd, @uid)
            RETURNING id
            """, new { no, kind, warehouseId, targetWarehouseId, supplierId, purchaseOrderId, invoiceNo, invoiceDate, department, reference, notes, bd, uid = tx.Ctx.User?.Id });
    }

    public static async Task EnsureWarehouseAsync(Tx tx, Guid id, string label = "Depo")
    {
        var active = await tx.ScalarAsync<bool?>("SELECT is_active FROM pms.warehouses WHERE id = @id", new { id });
        if (active is null) throw PmsException.NotFound(label);
        if (active == false) throw PmsException.Validation($"{label} pasif durumda.");
    }

    public static async Task<string> EnsureItemAsync(Tx tx, Guid id)
    {
        var it = await tx.OneOrNullAsync<(string Code, string Name, bool IsActive)>("SELECT code, name, is_active FROM pms.stock_items WHERE id = @id", new { id });
        if (it == default) throw PmsException.NotFound("Stok kartı");
        if (!it.IsActive) throw PmsException.Validation($"{it.Code} {it.Name} stok kartı pasif.");
        return $"{it.Code} {it.Name}";
    }

    public static decimal Quantity(decimal q, string field = "Miktar")
    {
        if (q <= 0 || decimal.Round(q, 3) != q || q > 1_000_000_000) throw PmsException.Validation($"{field} pozitif ve en fazla 3 ondalıklı olmalıdır.");
        return q;
    }

    public static decimal Cost(decimal c, string field = "Birim maliyet")
    {
        if (c < 0 || decimal.Round(c, 4) != c || c > 1_000_000_000) throw PmsException.Validation($"{field} sıfır veya pozitif, en fazla 4 ondalıklı olmalıdır.");
        return c;
    }

    public static Task<bool> AllowNegativeAsync(Tx tx) => PropertyEndpoints.SettingAsync<bool>(tx, "stock.allow_negative");
}
