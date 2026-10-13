using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Accounting;

/// <summary>
/// Gün sonu muhasebe fişi. Kapatılan iş gününün folyo, restoran ve stok hareketleri hesap eşlemelerine göre tek, dengeli bir
/// yevmiye fişine dönüştürülür (hesap bazında toplanmış). Fiş bir gün için bir kez oluşur ve değiştirilemez.
/// <para>Kurallar (fiyatlar KDV dahildir):</para>
/// <list type="bullet">
/// <item>Folyo satırı, folyonun alacak hesabına (konaklayan misafir / şirket-acente carisi) işaretli tutarıyla yazılır.</item>
/// <item>Masraf: karşılığı gelir (net) + hesaplanan KDV; konaklama vergisi ödenecek vergi hesabına.</item>
/// <item>Tahsilat, depozito, iade: karşılığı kasa/banka/kredi kartı. Cari hesaba aktarım ve folyolar arası aktarım yalnız alacak hesapları arasında yer değiştirir.</item>
/// <item>İndirim ve allowance: satış iskontoları (ilgili masrafın KDV oranıyla KDV düzeltmesi). İptal, orijinal satırın kaydını ters çevirir.</item>
/// <item>Restoranda doğrudan ödenen adisyon: kasa / gelir + KDV (indirim KDV gruplarına oransal). Odaya aktarılan adisyon folyo masrafıdır.</item>
/// <item>Stok: mal kabul stok + indirilecek KDV / satıcılar; çıkış, satış tüketimi ve sayım farkı stok / hizmet üretim maliyeti. Depolar arası transfer fiş üretmez.</item>
/// <item>Dövizli tahsilattaki kuruş farkları kambiyo kar/zarar hesabına yazılır.</item>
/// </list>
/// </summary>
public static class AccountingService
{
    sealed class Builder(Dictionary<string, string> map)
    {
        readonly Dictionary<(string Account, string Label), decimal> sums = new();
        public string Map(string key) => map.TryGetValue(key, out var a) ? a : throw PmsException.Validation($"Muhasebe eşlemesi eksik: {key}");
        public void Add(string account, decimal amount, string label)
        {
            if (amount == 0) return;
            sums[(account, label)] = sums.GetValueOrDefault((account, label)) + amount;
        }
        public decimal Imbalance => sums.Values.Sum();
        public IEnumerable<(string Account, string Label, decimal Amount)> Lines =>
            sums.Where(kv => kv.Value != 0).OrderBy(kv => kv.Key.Account).ThenBy(kv => kv.Key.Label).Select(kv => (kv.Key.Account, kv.Key.Label, kv.Value));
    }

    static decimal R(decimal v) => decimal.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>KDV dahil tutarı net + KDV olarak böler ve gelir/KDV hesaplarına yazar (tutarın işareti korunur, karşı kayıt olarak eksi).</summary>
    static async Task RevenueAsync(Tx tx, Builder b, string revenueAccount, decimal grossCounter, decimal vatRate, string label)
    {
        var net = R(grossCounter / (1 + vatRate / 100m));
        b.Add(revenueAccount, net, label);
        if (grossCounter - net != 0) b.Add(await VatAccountAsync(tx, b.Map("vat.output"), vatRate, "Hesaplanan KDV"), grossCounter - net, $"KDV %{vatRate:0.##}");
    }

    /// <summary>KDV oranına göre alt hesap (ör. 391.10); yoksa açılır.</summary>
    static async Task<string> VatAccountAsync(Tx tx, string parent, decimal rate, string title)
    {
        if (rate == 0) return parent;
        // KDV oranları tam sayıdır (1, 10, 20): 391.01, 391.10, 391.20
        var code = $"{parent}.{(int)decimal.Round(rate):00}";
        await tx.ExecAsync("""
            INSERT INTO pms.gl_accounts (code, name, kind, is_system)
            SELECT @code, @name, kind, true FROM pms.gl_accounts WHERE code = @parent
            ON CONFLICT (code) DO NOTHING
            """, new { code, parent, name = $"{title} %{rate:0.##}" });
        return code;
    }

    static string RevenueKey(string? category) => category switch
    {
        "tax" => "tax.accommodation",
        null or "" => "revenue.misc",
        _ => "revenue." + category,
    };

    /// <summary>Dövizle alınan nakit ayrı (döviz kasası) hesaba yazılır.</summary>
    static string CashKey(string? kind, bool foreign = false) => kind switch
    {
        "cash" => foreign ? "cash.fx" : "cash.cash", "credit_card" => "cash.credit_card", "bank_transfer" => "cash.bank_transfer", _ => "cash.other",
    };
    static bool IsLedgerMethod(string? kind) => kind is "city_ledger" or "company" or "agency";

    sealed record FolioRow(string LineType, decimal Amount, decimal? VatRate, bool IsAccountFolio, Guid? CodeId, string? Category, string? CodeGl,
        string? MethodKind, string? RelType, decimal? RelVat, Guid? RelCodeId, string? RelCategory, string? RelCodeGl, string? RelMethodKind, bool RelHasCode,
        bool IsForeign);

    /// <summary>İş günü için gün sonu fişi oluşturur; varsa yeniden oluşturmaz. Fiş yoksa (hareket yoksa) null döner.</summary>
    public static async Task<Guid?> GenerateDayAsync(Tx tx, DateOnly bd)
    {
        if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.gl_entries WHERE kind = 'day' AND business_date = @bd)", new { bd })) return null;
        var map = (await tx.ListAsync<(string Key, string Account)>("SELECT key, account_code FROM pms.gl_mappings")).ToDictionary(x => x.Key, x => x.Account);
        var b = new Builder(map);
        var dayLabel = "Gün sonu";

        // ---- Folyo hareketleri
        var rows = await tx.ListAsync<FolioRow>("""
            SELECT l.line_type, l.amount, l.vat_rate, (f.reservation_id IS NULL) AS is_account_folio,
                   l.transaction_code_id AS code_id, tc.category, tc.gl_account AS code_gl, pm.kind AS method_kind,
                   o.line_type AS rel_type, o.vat_rate AS rel_vat, o.transaction_code_id AS rel_code_id, otc.category AS rel_category,
                   otc.gl_account AS rel_code_gl, opm.kind AS rel_method_kind, (o.transaction_code_id IS NOT NULL) AS rel_has_code,
                   (l.tendered_currency IS NOT NULL) AS is_foreign
            FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id
            LEFT JOIN pms.transaction_codes tc ON tc.id = l.transaction_code_id
            LEFT JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
            LEFT JOIN pms.folio_lines o ON o.id = l.related_line_id
            LEFT JOIN pms.transaction_codes otc ON otc.id = o.transaction_code_id
            LEFT JOIN pms.payment_methods opm ON opm.id = o.payment_method_id
            WHERE l.business_date = @bd AND l.migration_job_id IS NULL
            """, new { bd });
        foreach (var l in rows)
        {
            var receivable = b.Map(l.IsAccountFolio ? "receivable.account" : "receivable.guest");
            b.Add(receivable, l.Amount, l.IsAccountFolio ? "Cari hesaplar" : "Misafir hesapları");
            var counter = -l.Amount;
            switch (l.LineType)
            {
                case "charge" when l.CodeId is not null:
                    await RevenueAsync(tx, b, l.CodeGl ?? b.Map(RevenueKey(l.Category)), counter, l.VatRate ?? 0, dayLabel);
                    break;
                case "charge":
                    // Cari hesaba aktarılan tahsilatın karşı kaydı: alacak hesapları arasında yer değiştirme (karşılığı tahsilat satırıdır).
                    break;
                case "payment" or "deposit" or "refund":
                    if (!IsLedgerMethod(l.MethodKind)) b.Add(b.Map(CashKey(l.MethodKind, l.IsForeign)), counter, "Tahsilat");
                    break;
                case "discount" or "allowance":
                    await RevenueAsync(tx, b, b.Map("discount"), counter, l.RelHasCode ? l.RelVat ?? 0 : 0, "İndirim");
                    break;
                case "void":
                    switch (l.RelType)
                    {
                        case "charge" when l.RelHasCode:
                            await RevenueAsync(tx, b, l.RelCodeGl ?? b.Map(RevenueKey(l.RelCategory)), counter, l.RelVat ?? 0, "İptal");
                            break;
                        case "payment" or "deposit" or "refund":
                            if (!IsLedgerMethod(l.RelMethodKind)) b.Add(b.Map(CashKey(l.RelMethodKind, l.IsForeign)), counter, "Tahsilat iptali");
                            break;
                        case "discount" or "allowance":
                            await RevenueAsync(tx, b, b.Map("discount"), counter, 0, "İndirim iptali");
                            break;
                    }
                    break;
                // transfer_in / transfer_out: iki folyonun alacak hesapları arasında; karşılığı eş satırdır.
            }
        }

        // ---- Restoranda doğrudan ödenen adisyonlar
        var checks = await tx.ListAsync<(Guid Id, decimal Total, decimal Discount, Guid CodeId, string Category, string? CodeGl)>("""
            SELECT c.id, c.total_amount, c.discount_amount, o.transaction_code_id, tc.category, tc.gl_account
            FROM pms.pos_checks c JOIN pms.pos_outlets o ON o.id = c.outlet_id JOIN pms.transaction_codes tc ON tc.id = o.transaction_code_id
            WHERE c.status = 'closed' AND c.settlement = 'payment' AND c.closed_business_date = @bd
            """, new { bd });
        foreach (var c in checks)
        {
            var groups = await tx.ListAsync<(decimal Vat, decimal Amount)>(
                "SELECT vat_rate, sum(amount) FROM pms.pos_check_lines WHERE check_id = @id AND NOT is_void GROUP BY vat_rate ORDER BY vat_rate", new { id = c.Id });
            var subtotal = groups.Sum(x => x.Amount);
            decimal posted = 0;
            for (var i = 0; i < groups.Count; i++)
            {
                var share = i == groups.Count - 1 ? c.Total - posted : R(groups[i].Amount - (subtotal == 0 ? 0 : c.Discount * groups[i].Amount / subtotal));
                posted += share;
                await RevenueAsync(tx, b, c.CodeGl ?? b.Map(RevenueKey(c.Category)), -share, groups[i].Vat, "Restoran");
            }
        }
        var posPays = await tx.ListAsync<(string Kind, bool Foreign, decimal Amount)>("""
            SELECT pm.kind, p.tendered_currency IS NOT NULL, sum(p.amount) FROM pms.pos_payments p JOIN pms.payment_methods pm ON pm.id = p.payment_method_id
            WHERE p.business_date = @bd GROUP BY 1, 2
            """, new { bd });
        foreach (var p in posPays) b.Add(b.Map(CashKey(p.Kind, p.Foreign)), p.Amount, "Restoran tahsilatı");

        // ---- Stok
        var moves = await tx.ListAsync<(string Kind, decimal Quantity, decimal UnitCost, decimal VatRate)>("""
            SELECT d.kind, m.quantity, m.unit_cost, i.vat_rate
            FROM pms.stock_movements m JOIN pms.stock_documents d ON d.id = m.document_id JOIN pms.stock_items i ON i.id = m.item_id
            WHERE m.business_date = @bd AND d.kind <> 'transfer'
            """, new { bd });
        foreach (var m in moves)
        {
            var v = R(m.Quantity * m.UnitCost);
            if (v == 0) continue;
            b.Add(b.Map("stock.inventory"), v, "Stok");
            if (m.Kind == "receipt")
            {
                var vat = R(v * m.VatRate / 100m);
                if (vat != 0) b.Add(await VatAccountAsync(tx, b.Map("vat.input"), m.VatRate, "İndirilecek KDV"), vat, $"KDV %{m.VatRate:0.##}");
                b.Add(b.Map("stock.payable"), -(v + vat), "Mal alımları");
            }
            else b.Add(b.Map("stock.consumption"), -v, m.Kind == "pos" ? "Satış tüketimi" : m.Kind == "count" ? "Sayım farkı" : "Bölüm çıkışları");
        }

        // ---- Dövizli tahsilat kuruş farkları
        var diff = b.Imbalance;
        if (diff != 0)
        {
            if (Math.Abs(diff) > 1m)
                throw PmsException.Validation($"Gün sonu muhasebe fişi dengelenemedi (fark {diff:N2}). Hesap eşlemelerini kontrol edin.");
            b.Add(b.Map(diff > 0 ? "fx.gain" : "fx.loss"), -diff, "Kur farkı");
        }

        var lines = b.Lines.ToList();
        if (lines.Count == 0) return null;
        var id = await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.gl_entries (entry_date, kind, business_date, description, created_by) VALUES (@bd, 'day', @bd, @desc, @uid) RETURNING id
            """, new { bd, desc = $"Gün sonu fişi {bd:dd.MM.yyyy}", uid = tx.Ctx.User?.Id });
        var no = 1;
        foreach (var l in lines)
            await tx.ExecAsync("""
                INSERT INTO pms.gl_lines (entry_id, line_no, account_code, debit, credit, description) VALUES (@id, @no, @Account, @d, @c, @Label)
                """, new { id, no = no++, l.Account, d = l.Amount > 0 ? l.Amount : 0, c = l.Amount < 0 ? -l.Amount : 0, l.Label });
        return id;
    }
}
