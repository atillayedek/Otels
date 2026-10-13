using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Accounting;

public sealed record GlAccountDto(string Code, string Name, string Kind, bool IsSystem, bool IsActive, decimal Debit, decimal Credit);
public sealed record SaveGlAccountRequest(string Code, string Name, string Kind, bool IsActive);
public sealed record GlMappingDto(string Key, string AccountCode, string AccountName);
public sealed record SaveMappingRequest(string AccountCode);
public sealed record CodeAccountDto(Guid Id, string Code, string Name, string Category, string? GlAccount);
public sealed record SaveCodeAccountRequest(string? AccountCode);
public sealed record GlEntryDto(Guid Id, long EntryNo, DateOnly EntryDate, string Kind, DateOnly? BusinessDate, string Description, Guid? ReversalOf,
    long? ReversedByNo, decimal Total, string? Username, DateTime CreatedAt);
public sealed record GlLineDto(int LineNo, string AccountCode, string AccountName, decimal Debit, decimal Credit, string? Description);
public sealed record GlEntryDetail(GlEntryDto Entry, IReadOnlyList<GlLineDto> Lines);
public sealed record ManualLine(string AccountCode, decimal Debit, decimal Credit, string? Description);
public sealed record ManualEntryRequest(DateOnly EntryDate, string Description, IReadOnlyList<ManualLine> Lines);
public sealed record ReverseEntryRequest(string Reason);
public sealed record GenerateRequest(DateOnly From, DateOnly To);

/// <summary>Muhasebe: hesap planı, eşlemeler, yevmiye fişleri. Mizan, yevmiye ve muavin raporları rapor ekranındadır.</summary>
public static class AccountingEndpoints
{
    public static readonly Dictionary<string, string> MappingLabels = new()
    {
        ["cash.cash"] = "Nakit tahsilat (TL)", ["cash.fx"] = "Nakit tahsilat (döviz)", ["cash.credit_card"] = "Kredi kartı tahsilatı", ["cash.bank_transfer"] = "Havale / EFT", ["cash.other"] = "Diğer tahsilat",
        ["receivable.guest"] = "Misafir alacakları (konaklama folyoları)", ["receivable.account"] = "Şirket / acente carileri",
        ["revenue.room"] = "Konaklama geliri", ["revenue.food_beverage"] = "Yiyecek-içecek geliri", ["revenue.minibar"] = "Minibar geliri",
        ["revenue.laundry"] = "Çamaşırhane geliri", ["revenue.telephone"] = "Telefon geliri", ["revenue.spa"] = "Spa geliri", ["revenue.transfer"] = "Transfer geliri",
        ["revenue.misc"] = "Diğer gelirler", ["revenue.package"] = "Paket gelirleri",
        ["tax.accommodation"] = "Konaklama vergisi", ["vat.output"] = "Hesaplanan KDV (ana hesap)", ["vat.input"] = "İndirilecek KDV (ana hesap)",
        ["discount"] = "Satış iskontoları", ["stock.inventory"] = "Stok (malzeme)", ["stock.consumption"] = "Stok tüketimi (maliyet)", ["stock.payable"] = "Satıcılar",
        ["fx.gain"] = "Kur farkı karı", ["fx.loss"] = "Kur farkı zararı",
    };

    const string EntrySelect = """
        SELECT e.id, e.entry_no, e.entry_date, e.kind, e.business_date, e.description, e.reversal_of,
               (SELECT r.entry_no FROM pms.gl_entries r WHERE r.reversal_of = e.id) AS reversed_by_no,
               COALESCE((SELECT sum(debit) FROM pms.gl_lines l WHERE l.entry_id = e.id), 0) AS total, u.username, e.created_at
        FROM pms.gl_entries e LEFT JOIN pms.users u ON u.id = e.created_by
        """;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/accounting").WithTags("Accounting");

        g.MapGet("/accounts", (Db db) => db.QueryAsync<GlAccountDto>("""
            SELECT a.code, a.name, a.kind, a.is_system, a.is_active,
                   COALESCE(sum(l.debit), 0) AS debit, COALESCE(sum(l.credit), 0) AS credit
            FROM pms.gl_accounts a LEFT JOIN pms.gl_lines l ON l.account_code = a.code
            GROUP BY a.code ORDER BY a.code
            """)).RequireAnyPermission("accounting.view", "settings.manage");
        g.MapPost("/accounts", (SaveGlAccountRequest req, CommandRunner cmd) => cmd.RunAsync("gl_account.create", req, async tx =>
        {
            var (code, name, kind) = AccountParams(req);
            var parent = code.Contains('.') ? code[..code.LastIndexOf('.')] : null;
            if (parent is not null && !await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.gl_accounts WHERE code = @parent)", new { parent }))
                throw PmsException.Validation($"Üst hesap {parent} tanımlı değil; önce onu açın.");
            await tx.ExecAsync("INSERT INTO pms.gl_accounts (code, name, kind, is_active) VALUES (@code, @name, @kind, @IsActive)", new { code, name, kind, req.IsActive });
            await tx.AuditAsync("gl_account.create", "gl_account", code, null, req);
            tx.Publish("accounting");
            return new { code };
        }, requireKey: false)).RequirePermission("accounting.manage");
        g.MapPut("/accounts/{code}", (string code, SaveGlAccountRequest req, CommandRunner cmd) => cmd.RunAsync("gl_account.update", new { code, req }, async tx =>
        {
            var (_, name, kind) = AccountParams(req with { Code = code });
            var cur = await tx.OneOrNullAsync<(bool IsSystem, string Kind)>("SELECT is_system, kind FROM pms.gl_accounts WHERE code = @code", new { code });
            if (cur == default) throw PmsException.NotFound("Hesap");
            if (cur.IsSystem && (kind != cur.Kind || !req.IsActive)) throw PmsException.Validation("Sistem hesabının türü değiştirilemez, pasifleştirilemez.");
            if (!req.IsActive && await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.gl_mappings WHERE account_code = @code)", new { code }))
                throw PmsException.Validation("Otomatik fiş eşlemesinde kullanılan hesap pasifleştirilemez.");
            // Tablo değişmezlik kuralı yalnız fişler içindir; hesap kartı güncellenebilir.
            await tx.ExecAsync("UPDATE pms.gl_accounts SET name = @name, kind = @kind, is_active = @IsActive WHERE code = @code", new { code, name, kind, req.IsActive });
            await tx.AuditAsync("gl_account.update", "gl_account", code, cur, req);
            tx.Publish("accounting");
            return new { code };
        }, requireKey: false)).RequirePermission("accounting.manage");

        g.MapGet("/mappings", async (Db db) =>
        {
            var rows = await db.QueryAsync<(string Key, string AccountCode, string AccountName)>("""
                SELECT m.key, m.account_code, a.name FROM pms.gl_mappings m JOIN pms.gl_accounts a ON a.code = m.account_code ORDER BY m.key
                """);
            return rows.Select(r => new GlMappingDto(r.Key, r.AccountCode, r.AccountName)).ToList();
        }).RequireAnyPermission("accounting.view", "settings.manage");
        g.MapPut("/mappings/{key}", (string key, SaveMappingRequest req, CommandRunner cmd) => cmd.RunAsync("gl_mapping.update", new { key, req }, async tx =>
        {
            if (!MappingLabels.ContainsKey(key)) throw PmsException.Validation("Tanımsız eşleme.");
            await EnsureAccountAsync(tx, req.AccountCode);
            var old = await tx.ScalarAsync<string?>("SELECT account_code FROM pms.gl_mappings WHERE key = @key", new { key });
            await tx.ExecAsync("""
                INSERT INTO pms.gl_mappings (key, account_code) VALUES (@key, @code) ON CONFLICT (key) DO UPDATE SET account_code = EXCLUDED.account_code, updated_at = now()
                """, new { key, code = req.AccountCode });
            await tx.AuditAsync("gl_mapping.update", "gl_mapping", key, old, req.AccountCode);
            tx.Publish("accounting");
            return new { key };
        }, requireKey: false)).RequirePermission("accounting.manage");

        g.MapGet("/code-accounts", (Db db) => db.QueryAsync<CodeAccountDto>(
            "SELECT id, code, name, category, gl_account FROM pms.transaction_codes ORDER BY category, code")).RequireAnyPermission("accounting.view", "settings.manage");
        g.MapPut("/code-accounts/{id:guid}", (Guid id, SaveCodeAccountRequest req, CommandRunner cmd) => cmd.RunAsync("gl_code_account.update", new { id, req }, async tx =>
        {
            var code = string.IsNullOrWhiteSpace(req.AccountCode) ? null : req.AccountCode.Trim();
            if (code is not null) await EnsureAccountAsync(tx, code);
            if (await tx.ExecAsync("UPDATE pms.transaction_codes SET gl_account = @code WHERE id = @id", new { id, code }) == 0) throw PmsException.NotFound("İşlem kodu");
            await tx.AuditAsync("gl_code_account.update", "transaction_code", id, null, new { code });
            tx.Publish("accounting");
            return new { id };
        }, requireKey: false)).RequirePermission("accounting.manage");

        g.MapGet("/entries", (Db db, DateOnly? from, DateOnly? to, string? kind) => db.QueryAsync<GlEntryDto>(EntrySelect + """
             WHERE (@from::date IS NULL OR e.entry_date >= @from) AND (@to::date IS NULL OR e.entry_date <= @to) AND (@kind::text IS NULL OR e.kind = @kind)
            ORDER BY e.entry_date DESC, e.entry_no DESC LIMIT 2000
            """, new { from, to, kind })).RequirePermission("accounting.view");
        g.MapGet("/entries/{id:guid}", (Guid id, CommandRunner cmd) => cmd.ReadAsync(tx => DetailAsync(tx, id))).RequirePermission("accounting.view");

        g.MapPost("/entries", (ManualEntryRequest req, CommandRunner cmd) => cmd.RunAsync("gl_entry.manual", req, async tx =>
        {
            var desc = Validate.Required(req.Description, "Açıklama", 300);
            var lines = req.Lines ?? [];
            if (lines.Count < 2 || lines.Count > 200) throw PmsException.Validation("Fişte 2-200 satır olmalıdır.");
            foreach (var l in lines)
            {
                await EnsureAccountAsync(tx, l.AccountCode);
                Validate.Money(l.Debit, "Borç", allowZero: true);
                Validate.Money(l.Credit, "Alacak", allowZero: true);
                if ((l.Debit > 0) == (l.Credit > 0)) throw PmsException.Validation("Her satırda yalnız borç veya yalnız alacak girilmelidir.");
            }
            var (d, c) = (lines.Sum(l => l.Debit), lines.Sum(l => l.Credit));
            if (d != c) throw PmsException.Validation($"Fiş dengesiz: borç {d:N2}, alacak {c:N2}.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            if (req.EntryDate > bd) throw PmsException.Validation("Fiş tarihi iş gününden ileri olamaz.");
            var id = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.gl_entries (entry_date, kind, description, created_by) VALUES (@EntryDate, 'manual', @desc, @uid) RETURNING id
                """, new { req.EntryDate, desc, uid = tx.User.Id });
            var no = 1;
            foreach (var l in lines)
                await tx.ExecAsync("""
                    INSERT INTO pms.gl_lines (entry_id, line_no, account_code, debit, credit, description) VALUES (@id, @no, @AccountCode, @Debit, @Credit, @d)
                    """, new { id, no = no++, l.AccountCode, l.Debit, l.Credit, d = Validate.Optional(l.Description, 200) });
            await tx.AuditAsync("gl_entry.manual", "gl_entry", id, null, req);
            tx.Publish("accounting");
            return new { id };
        })).RequirePermission("accounting.manage");

        g.MapPost("/entries/{id:guid}/reverse", (Guid id, ReverseEntryRequest req, CommandRunner cmd) => cmd.RunAsync("gl_entry.reverse", new { id, req }, async tx =>
        {
            var reason = Validate.Required(req.Reason, "Gerekçe", 300);
            var e = await tx.OneOrNullAsync<(long No, string Kind)>("SELECT entry_no, kind FROM pms.gl_entries WHERE id = @id", new { id });
            if (e == default) throw PmsException.NotFound("Fiş");
            if (e.Kind == "reversal") throw PmsException.Validation("Ters fiş yeniden ters çevrilemez.");
            if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.gl_entries WHERE reversal_of = @id)", new { id }))
                throw PmsException.Validation("Bu fiş zaten ters çevrilmiş.");
            var bd = await PropertyEndpoints.BusinessDateAsync(tx);
            var rid = await tx.ScalarAsync<Guid>("""
                INSERT INTO pms.gl_entries (entry_date, kind, description, reversal_of, created_by) VALUES (@bd, 'reversal', @desc, @id, @uid) RETURNING id
                """, new { bd, desc = $"Ters fiş: #{e.No} — {reason}", id, uid = tx.User.Id });
            await tx.ExecAsync("""
                INSERT INTO pms.gl_lines (entry_id, line_no, account_code, debit, credit, description)
                SELECT @rid, line_no, account_code, credit, debit, description FROM pms.gl_lines WHERE entry_id = @id
                """, new { rid, id });
            await tx.AuditAsync("gl_entry.reverse", "gl_entry", id, null, new { reversal = rid }, reason);
            tx.Publish("accounting");
            return new { id = rid };
        })).RequirePermission("accounting.manage");

        // Muhasebe modülü kurulmadan önce kapatılmış günler için gün sonu fişlerini oluşturur (yalnız gece denetimi tamamlanmış günler).
        g.MapPost("/generate", (GenerateRequest req, CommandRunner cmd) => cmd.RunAsync("gl_entry.generate", req, async tx =>
        {
            if (req.To < req.From || req.To.DayNumber - req.From.DayNumber > 400) throw PmsException.Validation("Tarih aralığı en fazla 400 gün olabilir.");
            var days = await tx.ListAsync<DateOnly>("""
                SELECT n.business_date FROM pms.night_audits n
                WHERE n.business_date BETWEEN @From AND @To AND NOT EXISTS (SELECT 1 FROM pms.gl_entries e WHERE e.kind = 'day' AND e.business_date = n.business_date)
                ORDER BY n.business_date
                """, req);
            var created = 0;
            foreach (var d in days) if (await AccountingService.GenerateDayAsync(tx, d) is not null) created++;
            await tx.AuditAsync("gl_entry.generate", "gl_entry", null, null, new { req.From, req.To, created });
            tx.Publish("accounting");
            return new { created, days = days.Count };
        })).RequirePermission("accounting.manage");
    }

    static async Task<GlEntryDetail> DetailAsync(Tx tx, Guid id)
    {
        var e = await tx.OneOrNullAsync<GlEntryDto>(EntrySelect + " WHERE e.id = @id", new { id }) ?? throw PmsException.NotFound("Fiş");
        var lines = await tx.ListAsync<GlLineDto>("""
            SELECT l.line_no, l.account_code, a.name AS account_name, l.debit, l.credit, l.description
            FROM pms.gl_lines l JOIN pms.gl_accounts a ON a.code = l.account_code WHERE l.entry_id = @id ORDER BY l.line_no
            """, new { id });
        return new GlEntryDetail(e, lines);
    }

    static async Task EnsureAccountAsync(Tx tx, string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) throw PmsException.Validation("Hesap kodu girin.");
        var active = await tx.ScalarAsync<bool?>("SELECT is_active FROM pms.gl_accounts WHERE code = @code", new { code = code.Trim() });
        if (active is null) throw PmsException.Validation($"{code} hesabı hesap planında yok.");
        if (active == false) throw PmsException.Validation($"{code} hesabı pasif.");
    }

    static (string code, string name, string kind) AccountParams(SaveGlAccountRequest r)
    {
        var code = Validate.Required(r.Code, "Hesap kodu", 40).ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, @"^[0-9]{3}(\.[0-9A-Z]{1,10}){0,3}$"))
            throw PmsException.Validation("Hesap kodu Tek Düzen Hesap Planı biçiminde olmalıdır (ör. 600.01).");
        if (r.Kind is not ("asset" or "liability" or "equity" or "revenue" or "expense")) throw PmsException.Validation("Geçersiz hesap türü.");
        return (code, Validate.Required(r.Name, "Hesap adı", 150), r.Kind);
    }
}
