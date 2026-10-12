using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Property;

namespace HotelPms.Server.Modules.Folios;

public sealed record FolioDto(Guid Id, string FolioNumber, Guid? ReservationId, string? ReservationNumber, int WindowNo, string PayerKind,
    Guid? GuestId, Guid? CompanyId, Guid? AgencyId, string Name, string Currency, string Status, decimal Balance, decimal TotalCharges,
    decimal TotalCredits, string? InvoiceNumber, DateOnly? InvoiceDate, DateTime CreatedAt, int Version);

public sealed record FolioLineDto(Guid Id, Guid FolioId, string LineType, string? TransactionCode, string? PaymentMethod, string Description,
    decimal Quantity, decimal? UnitPrice, decimal Amount, string Currency, DateOnly BusinessDate, DateTime PostedAt, string? Username,
    long? ShiftNo, string? Reference, string? Reason, Guid? RelatedLineId, string? RoomNumber, bool IsVoided, decimal TransferredOut);

public sealed record PostChargeRequest(Guid TransactionCodeId, string? Description, decimal Quantity, decimal UnitPrice, string? Reference);
public sealed record PostPaymentRequest(Guid PaymentMethodId, decimal Amount, string? Description, string? Reference, Guid? CompanyId, Guid? AgencyId,
    bool IsDeposit);
public sealed record RefundRequest(Guid PaymentMethodId, decimal Amount, string Reason, string? Reference);
public sealed record DiscountRequest(string Kind, decimal Amount, string Reason, Guid? RelatedLineId);
public sealed record VoidRequest(string Reason);
public sealed record TransferLineRequest(Guid TargetFolioId, decimal? Amount, string Reason);
public sealed record TransferBalanceRequest(Guid TargetFolioId, string Reason);
public sealed record CreateFolioRequest(string PayerKind, Guid? CompanyId, Guid? AgencyId, string? Name);
public sealed record InvoiceReferenceRequest(string InvoiceNumber, DateOnly InvoiceDate);
public sealed record RoutingRequest(int RoomChargeWindow);

public sealed record TransactionCodeDto(Guid Id, string Code, string Name, string Category, decimal? DefaultPrice, decimal VatRate, bool IsSystem, bool IsActive);
public sealed record SaveTransactionCodeRequest(string Code, string Name, string Category, decimal? DefaultPrice, decimal VatRate, bool IsActive);
public sealed record PaymentMethodDto(Guid Id, string Code, string Name, string Kind, bool RequiresReference, bool IsSystem, bool IsActive);
public sealed record SavePaymentMethodRequest(string Code, string Name, string Kind, bool RequiresReference, bool IsActive);

/// <summary>
/// Folyo hareketleri. Satırlar asla güncellenmez/silinmez; her düzeltme yeni ve gerekçeli bir satırdır.
/// Bakiye = satır tutarlarının toplamı (pozitif: misafir borcu).
/// </summary>
public static class FolioService
{
    public const string FolioSelect = """
        SELECT f.id, f.folio_number, f.reservation_id, r.reservation_number, f.window_no, f.payer_kind, f.guest_id, f.company_id, f.agency_id, f.name,
               f.currency::text AS currency, f.status,
               COALESCE(sum(l.amount), 0) AS balance,
               COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0) AS total_charges,
               COALESCE(-sum(l.amount) FILTER (WHERE l.amount < 0), 0) AS total_credits,
               f.invoice_number, f.invoice_date, f.created_at, f.version
        FROM pms.folios f LEFT JOIN pms.reservations r ON r.id = f.reservation_id LEFT JOIN pms.folio_lines l ON l.folio_id = f.id
        """;
    public const string FolioGroup = " GROUP BY f.id, r.reservation_number";

    public const string LineSelect = """
        SELECT l.id, l.folio_id, l.line_type, tc.code AS transaction_code, pm.name AS payment_method, l.description, l.quantity, l.unit_price, l.amount,
               l.currency::text AS currency, l.business_date, l.posted_at, u.username, cs.shift_no, l.reference, l.reason, l.related_line_id, l.room_number,
               EXISTS (SELECT 1 FROM pms.folio_lines v WHERE v.related_line_id = l.id AND v.line_type = 'void') AS is_voided,
               COALESCE((SELECT -sum(t.amount) FROM pms.folio_lines t WHERE t.related_line_id = l.id AND t.line_type = 'transfer_out'), 0) AS transferred_out
        FROM pms.folio_lines l
        LEFT JOIN pms.transaction_codes tc ON tc.id = l.transaction_code_id
        LEFT JOIN pms.payment_methods pm ON pm.id = l.payment_method_id
        LEFT JOIN pms.users u ON u.id = l.user_id
        LEFT JOIN pms.cashier_shifts cs ON cs.id = l.cashier_shift_id
        """;

    public static async Task<Guid> CreateReservationFolioAsync(Tx tx, Guid reservationId, int window, string payerKind, Guid? guestId, Guid? companyId,
        Guid? agencyId, string currency, string? name = null)
    {
        var resolvedName = name ?? payerKind switch
        {
            "company" => await tx.OneAsync<string>("SELECT name FROM pms.companies WHERE id = @companyId", new { companyId }),
            "agency" => await tx.OneAsync<string>("SELECT name FROM pms.agencies WHERE id = @agencyId", new { agencyId }),
            _ => await tx.OneAsync<string>("""
                SELECT g.first_name || ' ' || g.last_name FROM pms.guests g WHERE g.id = COALESCE(@guestId, (SELECT guest_id FROM pms.reservations WHERE id = @reservationId))
                """, new { guestId, reservationId }),
        };
        var number = "F" + await tx.ScalarAsync<long>("SELECT nextval('pms.folio_number_seq')");
        return await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.folios (folio_number, reservation_id, window_no, payer_kind, guest_id, company_id, agency_id, name, currency, created_by)
            VALUES (@number, @reservationId, @window, @payerKind, @guestId, @companyId, @agencyId, @resolvedName, @currency, @uid) RETURNING id
            """, new { number, reservationId, window, payerKind, guestId, companyId, agencyId, resolvedName, currency, uid = tx.User.Id });
    }

    /// <summary>Şirket/acente cari (city ledger) folyosu: rezervasyona bağlı olmayan, açık tek folyo.</summary>
    public static async Task<Guid> GetOrCreateAccountFolioAsync(Tx tx, string payerKind, Guid accountId)
    {
        var col = payerKind == "company" ? "company_id" : "agency_id";
        await tx.LockAsync("account_folio", accountId);
        var existing = await tx.ScalarAsync<Guid?>($"SELECT id FROM pms.folios WHERE {col} = @accountId AND reservation_id IS NULL AND status = 'open' ORDER BY created_at LIMIT 1",
            new { accountId });
        if (existing is { } e) return e;
        var currency = await PropertyEndpoints.CurrencyAsync(tx);
        return await CreateAccountFolioAsync(tx, payerKind, accountId, currency);
    }

    static async Task<Guid> CreateAccountFolioAsync(Tx tx, string payerKind, Guid accountId, string currency)
    {
        var name = payerKind == "company"
            ? await tx.OneAsync<string>("SELECT name FROM pms.companies WHERE id = @accountId", new { accountId })
            : await tx.OneAsync<string>("SELECT name FROM pms.agencies WHERE id = @accountId", new { accountId });
        var number = "F" + await tx.ScalarAsync<long>("SELECT nextval('pms.folio_number_seq')");
        return await tx.ScalarAsync<Guid>("""
            INSERT INTO pms.folios (folio_number, reservation_id, window_no, payer_kind, company_id, agency_id, name, currency, created_by)
            VALUES (@number, NULL, 1, @payerKind, @companyId, @agencyId, @name, @currency, @uid) RETURNING id
            """, new
        {
            number, payerKind, companyId = payerKind == "company" ? accountId : (Guid?)null, agencyId = payerKind == "agency" ? accountId : (Guid?)null,
            name = "Cari: " + name, currency, uid = tx.User.Id,
        });
    }

    sealed record OpenFolio(Guid Id, string Status, string Currency, Guid? ReservationId, string? RoomNumber, string? ReservationStatus);

    static async Task<OpenFolio> LockOpenFolioAsync(Tx tx, Guid folioId)
    {
        var f = await tx.OneOrNullAsync<OpenFolio>("""
            SELECT f.id, f.status, f.currency::text AS currency, f.reservation_id, rm.number AS room_number, r.status AS reservation_status
            FROM pms.folios f LEFT JOIN pms.reservations r ON r.id = f.reservation_id LEFT JOIN pms.rooms rm ON rm.id = r.room_id
            WHERE f.id = @folioId FOR UPDATE OF f
            """, new { folioId }) ?? throw PmsException.NotFound("Folyo");
        if (f.Status != "open") throw PmsException.Validation("Folyo kapalı. İşlem için önce folyoyu açın.");
        return f;
    }

    static async Task<Guid?> CurrentShiftAsync(Tx tx, bool required)
    {
        var shift = await tx.ScalarAsync<Guid?>("SELECT id FROM pms.cashier_shifts WHERE user_id = @uid AND status = 'open'", new { uid = tx.User.Id });
        if (shift is null && required && await PropertyEndpoints.SettingAsync<bool>(tx, "finance.require_cashier_shift"))
            throw PmsException.Validation("Tahsilat/iade için açık kasa vardiyanız olmalıdır. Önce 'Kasa Aç' işlemini yapın.");
        return shift;
    }

    static Task<Guid> InsertLineAsync(Tx tx, Guid folioId, string type, string description, decimal amount, string currency, DateOnly bd,
        Guid? codeId = null, Guid? methodId = null, decimal quantity = 1, decimal? unitPrice = null, Guid? shiftId = null, string? reference = null,
        string? reason = null, Guid? related = null, string? room = null, bool isRoomCharge = false, decimal? vat = null) =>
        tx.ScalarAsync<Guid>("""
            INSERT INTO pms.folio_lines (folio_id, line_type, transaction_code_id, payment_method_id, description, quantity, unit_price, amount, vat_rate,
                currency, business_date, user_id, device_id, cashier_shift_id, reference, reason, related_line_id, room_number, is_room_charge)
            VALUES (@folioId, @type, @codeId, @methodId, @description, @quantity, @unitPrice, @amount, @vat, @currency, @bd, @uid, @device, @shiftId,
                @reference, @reason, @related, @room, @isRoomCharge)
            RETURNING id
            """, new
        {
            folioId, type, codeId, methodId, description, quantity, unitPrice, amount, vat, currency, bd, uid = tx.Ctx.User?.Id, device = tx.Ctx.DeviceId,
            shiftId, reference, reason, related, room, isRoomCharge,
        });

    public static async Task<Guid> PostChargeAsync(Tx tx, Guid folioId, PostChargeRequest req)
    {
        var f = await LockOpenFolioAsync(tx, folioId);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var code = await tx.OneOrNullAsync<(string Name, bool IsActive, decimal VatRate, string Category)>(
            "SELECT name, is_active, vat_rate, category FROM pms.transaction_codes WHERE id = @id", new { id = req.TransactionCodeId });
        if (code == default || !code.IsActive) throw PmsException.Validation("İşlem kodu bulunamadı veya pasif.");
        if (req.Quantity <= 0 || decimal.Round(req.Quantity, 3) != req.Quantity) throw PmsException.Validation("Miktar pozitif ve en fazla 3 ondalıklı olmalıdır.");
        Validate.Money(req.UnitPrice, "Birim fiyat");
        var amount = decimal.Round(req.Quantity * req.UnitPrice, 2, MidpointRounding.AwayFromZero);
        if (amount <= 0) throw PmsException.Validation("Tutar sıfırdan büyük olmalıdır.");
        var desc = Validate.Optional(req.Description, 300) ?? code.Name;
        var id = await InsertLineAsync(tx, folioId, "charge", desc, amount, f.Currency, bd, codeId: req.TransactionCodeId, quantity: req.Quantity,
            unitPrice: req.UnitPrice, reference: Validate.Optional(req.Reference, 100), room: f.RoomNumber, vat: code.VatRate);
        await tx.AuditAsync("folio.charge", "folio", folioId, null, new { lineId = id, amount, req.TransactionCodeId, desc });
        tx.Publish("folios", folioId);
        return id;
    }

    public static async Task<Guid> PostPaymentAsync(Tx tx, Guid folioId, PostPaymentRequest req)
    {
        var f = await LockOpenFolioAsync(tx, folioId);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        Validate.Money(req.Amount, "Tutar");
        var method = await tx.OneOrNullAsync<(string Name, string Kind, bool RequiresReference, bool IsActive)>(
            "SELECT name, kind, requires_reference, is_active FROM pms.payment_methods WHERE id = @id", new { id = req.PaymentMethodId });
        if (method == default || !method.IsActive) throw PmsException.Validation("Ödeme tipi bulunamadı veya pasif.");
        var reference = Validate.Optional(req.Reference, 100);
        if (method.RequiresReference && reference is null) throw PmsException.Validation($"{method.Name} için referans (slip/dekont no) zorunludur.");
        var toAccount = method.Kind is "city_ledger" or "company" or "agency";
        if (req.IsDeposit && toAccount) throw PmsException.Validation("Depozito cari hesaba aktarılarak alınamaz.");
        var shift = await CurrentShiftAsync(tx, required: !toAccount);
        var type = req.IsDeposit ? "deposit" : "payment";
        var desc = Validate.Optional(req.Description, 300) ?? (req.IsDeposit ? "Depozito - " : "Tahsilat - ") + method.Name;
        var lineId = await InsertLineAsync(tx, folioId, type, desc, -req.Amount, f.Currency, bd, methodId: req.PaymentMethodId, shiftId: shift,
            reference: reference, room: f.RoomNumber);

        if (toAccount)
        {
            var (kind, accountId) = method.Kind switch
            {
                "agency" => ("agency", req.AgencyId ?? throw PmsException.Validation("Aktarılacak acente seçilmelidir.")),
                _ when req.AgencyId is { } a => ("agency", a),
                _ => ("company", req.CompanyId ?? throw PmsException.Validation("Aktarılacak şirket seçilmelidir.")),
            };
            if (kind == "company" && method.Kind == "city_ledger" &&
                !await tx.ScalarAsync<bool>("SELECT is_city_ledger AND is_active FROM pms.companies WHERE id = @accountId", new { accountId }))
                throw PmsException.Validation("Seçilen şirket için cari hesap (city ledger) çalışması tanımlı değil.");
            await EnsureCreditLimitAsync(tx, kind, accountId, req.Amount);
            var accountFolio = await GetOrCreateAccountFolioAsync(tx, kind, accountId);
            var resNo = f.ReservationId is { } rid ? await tx.ScalarAsync<string>("SELECT reservation_number FROM pms.reservations WHERE id = @rid", new { rid }) : null;
            await InsertLineAsync(tx, accountFolio, "charge", $"Cari aktarım {resNo} {f.RoomNumber}".Trim(), req.Amount, f.Currency, bd,
                related: lineId, reference: reference, room: f.RoomNumber);
            tx.Publish("folios", accountFolio);
        }
        await tx.AuditAsync(req.IsDeposit ? "payment.deposit" : "payment.create", "folio", folioId, null,
            new { lineId, amount = req.Amount, method = method.Name, reference, req.CompanyId, req.AgencyId });
        tx.Publish("folios", folioId);
        tx.Publish("cashier");
        return lineId;
    }

    static async Task EnsureCreditLimitAsync(Tx tx, string kind, Guid accountId, decimal amount)
    {
        var table = kind == "company" ? "companies" : "agencies";
        var col = kind == "company" ? "company_id" : "agency_id";
        var limit = await tx.ScalarAsync<decimal?>($"SELECT credit_limit FROM pms.{table} WHERE id = @accountId", new { accountId });
        if (limit is null) return;
        var balance = await tx.ScalarAsync<decimal>($"""
            SELECT COALESCE(sum(l.amount), 0) FROM pms.folios f JOIN pms.folio_lines l ON l.folio_id = f.id WHERE f.{col} = @accountId AND f.reservation_id IS NULL
            """, new { accountId });
        if (balance + amount > limit && !tx.User.Has("folio.discount"))
            throw PmsException.Conflict($"Cari kredi limiti aşılıyor (limit {limit:N2}, mevcut bakiye {balance:N2}).", "credit_limit");
    }

    public static async Task<Guid> RefundAsync(Tx tx, Guid folioId, RefundRequest req)
    {
        var f = await LockOpenFolioAsync(tx, folioId);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        Validate.Money(req.Amount, "İade tutarı");
        var reason = Validate.Required(req.Reason, "İade gerekçesi", 300);
        var method = await tx.OneOrNullAsync<(string Name, string Kind, bool RequiresReference)>(
            "SELECT name, kind, requires_reference FROM pms.payment_methods WHERE id = @id AND is_active", new { id = req.PaymentMethodId });
        if (method == default || method.Kind is "city_ledger" or "company" or "agency") throw PmsException.Validation("İade için geçerli bir ödeme tipi seçin.");
        var reference = Validate.Optional(req.Reference, 100);
        if (method.RequiresReference && reference is null) throw PmsException.Validation($"{method.Name} iadesi için referans zorunludur.");
        // İade, bu folyoda alınmış net tahsilatı aşamaz.
        var netCollected = await tx.ScalarAsync<decimal>("""
            SELECT COALESCE(-sum(l.amount), 0) FROM pms.folio_lines l
            WHERE l.folio_id = @folioId AND (l.line_type IN ('payment','deposit','refund')
               OR (l.line_type = 'void' AND EXISTS (SELECT 1 FROM pms.folio_lines o WHERE o.id = l.related_line_id AND o.line_type IN ('payment','deposit','refund'))))
            """, new { folioId });
        if (req.Amount > netCollected) throw PmsException.Validation($"İade tutarı bu folyoda alınan net tahsilatı ({netCollected:N2}) aşamaz.");
        var shift = await CurrentShiftAsync(tx, required: true);
        var id = await InsertLineAsync(tx, folioId, "refund", "İade - " + method.Name, req.Amount, f.Currency, bd, methodId: req.PaymentMethodId,
            shiftId: shift, reference: reference, reason: reason, room: f.RoomNumber);
        await tx.AuditAsync("payment.refund", "folio", folioId, null, new { lineId = id, req.Amount, method = method.Name, reference }, reason);
        tx.Publish("folios", folioId);
        tx.Publish("cashier");
        return id;
    }

    public static async Task<Guid> DiscountAsync(Tx tx, Guid folioId, DiscountRequest req)
    {
        var f = await LockOpenFolioAsync(tx, folioId);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (req.Kind is not ("discount" or "allowance")) throw PmsException.Validation("Tür 'discount' veya 'allowance' olmalıdır.");
        Validate.Money(req.Amount, "Tutar");
        var reason = Validate.Required(req.Reason, "Gerekçe", 300);
        var maxAllowed = await tx.ScalarAsync<decimal>("""
            SELECT COALESCE(sum(l.amount), 0) FROM pms.folio_lines l
            WHERE l.folio_id = @folioId AND l.line_type NOT IN ('payment','deposit','refund')
              AND NOT (l.line_type = 'void' AND EXISTS (SELECT 1 FROM pms.folio_lines o WHERE o.id = l.related_line_id AND o.line_type IN ('payment','deposit','refund')))
            """, new { folioId });
        if (req.Amount > maxAllowed) throw PmsException.Validation($"İndirim tutarı folyodaki net masrafı ({maxAllowed:N2}) aşamaz.");
        if (req.RelatedLineId is { } rl && !await tx.ScalarAsync<bool>(
                "SELECT EXISTS (SELECT 1 FROM pms.folio_lines WHERE id = @rl AND folio_id = @folioId AND line_type = 'charge')", new { rl, folioId }))
            throw PmsException.Validation("İndirim yalnız bu folyodaki bir masraf satırına bağlanabilir.");
        var id = await InsertLineAsync(tx, folioId, req.Kind, (req.Kind == "discount" ? "İndirim" : "Allowance") + " - " + reason, -req.Amount, f.Currency, bd,
            reason: reason, related: req.RelatedLineId, room: f.RoomNumber);
        await tx.AuditAsync("folio." + req.Kind, "folio", folioId, null, new { lineId = id, req.Amount }, reason);
        tx.Publish("folios", folioId);
        return id;
    }

    public static async Task<Guid> VoidAsync(Tx tx, Guid lineId, VoidRequest req)
    {
        var line = await tx.OneOrNullAsync<(Guid FolioId, string LineType, decimal Amount, DateOnly BusinessDate, string Description, Guid? MethodId, bool IsRoomCharge)>(
            "SELECT folio_id, line_type, amount, business_date, description, payment_method_id, is_room_charge FROM pms.folio_lines WHERE id = @lineId", new { lineId });
        if (line == default) throw PmsException.NotFound("Folyo satırı");
        var f = await LockOpenFolioAsync(tx, line.FolioId);
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var reason = Validate.Required(req.Reason, "İptal gerekçesi", 300);
        if (line.LineType is "void" or "transfer_in" or "transfer_out") throw PmsException.Validation("Bu satır türü iptal edilemez; aktarım için ters aktarım yapın.");
        if (line.BusinessDate != bd) throw PmsException.Validation("Yalnız bugünkü iş gününe ait satırlar iptal edilebilir. Geçmiş gün için allowance veya iade kullanın.");
        if (line.IsRoomCharge) throw PmsException.Validation("Gece denetimi oda ücreti iptal edilemez; allowance kullanın.");
        if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.folio_lines WHERE related_line_id = @lineId AND line_type IN ('void','transfer_out'))", new { lineId }))
            throw PmsException.Validation("Bu satır daha önce iptal edilmiş veya aktarılmış.");
        Guid? shift = line.LineType is "payment" or "deposit" or "refund" ? await CurrentShiftAsync(tx, false) : null;
        var id = await InsertLineAsync(tx, line.FolioId, "void", "İPTAL: " + line.Description, -line.Amount, f.Currency, bd, methodId: line.MethodId,
            shiftId: shift, reason: reason, related: lineId, room: f.RoomNumber);
        // Cari hesaba aktarılmış tahsilatın karşı kaydı da iptal edilir.
        var mirrors = await tx.ListAsync<(Guid Id, Guid FolioId, decimal Amount, string Description)>(
            "SELECT id, folio_id, amount, description FROM pms.folio_lines WHERE related_line_id = @lineId AND line_type = 'charge'", new { lineId });
        foreach (var m in mirrors)
        {
            await tx.ExecAsync("SELECT 1 FROM pms.folios WHERE id = @fid FOR UPDATE", new { fid = m.FolioId });
            await InsertLineAsync(tx, m.FolioId, "void", "İPTAL: " + m.Description, -m.Amount, f.Currency, bd, reason: reason, related: m.Id);
            tx.Publish("folios", m.FolioId);
        }
        await tx.AuditAsync("folio.void", "folio_line", lineId, new { line.Amount, line.Description }, new { voidLineId = id }, reason);
        tx.Publish("folios", line.FolioId);
        if (shift is not null) tx.Publish("cashier");
        return id;
    }

    public static async Task<Guid> TransferLineAsync(Tx tx, Guid lineId, TransferLineRequest req)
    {
        var line = await tx.OneOrNullAsync<(Guid FolioId, string LineType, decimal Amount, string Description)>(
            "SELECT folio_id, line_type, amount, description FROM pms.folio_lines WHERE id = @lineId", new { lineId });
        if (line == default) throw PmsException.NotFound("Folyo satırı");
        if (line.LineType is not ("charge" or "transfer_in")) throw PmsException.Validation("Yalnız masraf satırları aktarılabilir.");
        if (req.TargetFolioId == line.FolioId) throw PmsException.Validation("Hedef folyo kaynakla aynı olamaz.");
        var reason = Validate.Required(req.Reason, "Aktarım gerekçesi", 300);
        // Kilit sırası sabit: deadlock önleme.
        var (a, b) = line.FolioId.CompareTo(req.TargetFolioId) < 0 ? (line.FolioId, req.TargetFolioId) : (req.TargetFolioId, line.FolioId);
        await LockOpenFolioAsync(tx, a);
        await LockOpenFolioAsync(tx, b);
        var src = await LockOpenFolioAsync(tx, line.FolioId);
        var dst = await LockOpenFolioAsync(tx, req.TargetFolioId);
        if (src.Currency != dst.Currency) throw PmsException.Validation("Farklı para birimli folyolar arasında aktarım yapılamaz.");
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        if (await tx.ScalarAsync<bool>("SELECT EXISTS (SELECT 1 FROM pms.folio_lines WHERE related_line_id = @lineId AND line_type = 'void')", new { lineId }))
            throw PmsException.Validation("İptal edilmiş satır aktarılamaz.");
        var already = await tx.ScalarAsync<decimal>("SELECT COALESCE(-sum(amount), 0) FROM pms.folio_lines WHERE related_line_id = @lineId AND line_type = 'transfer_out'", new { lineId });
        var remaining = line.Amount - already;
        var amount = req.Amount ?? remaining;
        Validate.Money(amount, "Aktarım tutarı");
        if (amount > remaining) throw PmsException.Validation($"Aktarılabilir tutar {remaining:N2}.");
        var targetNo = await tx.OneAsync<string>("SELECT folio_number FROM pms.folios WHERE id = @id", new { id = req.TargetFolioId });
        var sourceNo = await tx.OneAsync<string>("SELECT folio_number FROM pms.folios WHERE id = @id", new { id = line.FolioId });
        var outId = await InsertLineAsync(tx, line.FolioId, "transfer_out", $"→ {targetNo}: {line.Description}", -amount, src.Currency, bd,
            reason: reason, related: lineId, room: src.RoomNumber);
        var inId = await InsertLineAsync(tx, req.TargetFolioId, "transfer_in", $"← {sourceNo}: {line.Description}", amount, dst.Currency, bd,
            reason: reason, related: outId, room: src.RoomNumber);
        await tx.AuditAsync("folio.transfer", "folio_line", lineId, null, new { amount, req.TargetFolioId, outId, inId }, reason);
        tx.Publish("folios", line.FolioId);
        tx.Publish("folios", req.TargetFolioId);
        return inId;
    }

    /// <summary>Folyonun tüm bakiyesini başka bir folyoya taşır (birleştirme / routing düzeltmesi).</summary>
    public static async Task<Guid?> TransferBalanceAsync(Tx tx, Guid folioId, TransferBalanceRequest req)
    {
        if (req.TargetFolioId == folioId) throw PmsException.Validation("Hedef folyo kaynakla aynı olamaz.");
        var reason = Validate.Required(req.Reason, "Aktarım gerekçesi", 300);
        var (a, b) = folioId.CompareTo(req.TargetFolioId) < 0 ? (folioId, req.TargetFolioId) : (req.TargetFolioId, folioId);
        await LockOpenFolioAsync(tx, a);
        await LockOpenFolioAsync(tx, b);
        var src = await LockOpenFolioAsync(tx, folioId);
        var dst = await LockOpenFolioAsync(tx, req.TargetFolioId);
        if (src.Currency != dst.Currency) throw PmsException.Validation("Farklı para birimli folyolar arasında aktarım yapılamaz.");
        var balance = await tx.ScalarAsync<decimal>("SELECT COALESCE(sum(amount), 0) FROM pms.folio_lines WHERE folio_id = @folioId", new { folioId });
        if (balance == 0) throw PmsException.Validation("Aktarılacak bakiye yok.");
        var bd = await PropertyEndpoints.BusinessDateAsync(tx);
        var targetNo = await tx.OneAsync<string>("SELECT folio_number FROM pms.folios WHERE id = @id", new { id = req.TargetFolioId });
        var sourceNo = await tx.OneAsync<string>("SELECT folio_number FROM pms.folios WHERE id = @id", new { id = folioId });
        // Pozitif bakiye: borç taşınır. Negatif (alacak) bakiye: alacak taşınır; işaret kuralı için tür ters çevrilir.
        var outType = balance > 0 ? "transfer_out" : "transfer_in";
        var inType = balance > 0 ? "transfer_in" : "transfer_out";
        var outId = await InsertLineAsync(tx, folioId, outType, $"Bakiye aktarımı → {targetNo}", -balance, src.Currency, bd, reason: reason, room: src.RoomNumber);
        var inId = await InsertLineAsync(tx, req.TargetFolioId, inType, $"Bakiye aktarımı ← {sourceNo}", balance, dst.Currency, bd, reason: reason, related: outId);
        await tx.AuditAsync("folio.transfer_balance", "folio", folioId, null, new { balance, req.TargetFolioId, outId, inId }, reason);
        tx.Publish("folios", folioId);
        tx.Publish("folios", req.TargetFolioId);
        return inId;
    }

    public static async Task<Guid> PostRoomChargeAsync(Tx tx, Guid reservationId, int window, string currency, DateOnly bd, decimal rate, string roomNumber,
        string reservationNumber, Guid roomCodeId)
    {
        var folioId = await tx.ScalarAsync<Guid?>(
            "SELECT id FROM pms.folios WHERE reservation_id = @reservationId AND window_no = @window AND status = 'open'", new { reservationId, window })
            ?? await tx.ScalarAsync<Guid?>("SELECT id FROM pms.folios WHERE reservation_id = @reservationId AND status = 'open' ORDER BY window_no LIMIT 1", new { reservationId })
            ?? throw PmsException.Conflict($"{reservationNumber} için açık folyo yok.");
        var lineId = await InsertLineAsync(tx, folioId, "charge", $"Konaklama {bd:dd.MM.yyyy}", rate, currency, bd, codeId: roomCodeId, unitPrice: rate,
            room: roomNumber, isRoomCharge: true);
        await tx.ExecAsync("INSERT INTO pms.room_charge_postings (reservation_id, business_date, folio_line_id) VALUES (@reservationId, @bd, @lineId)",
            new { reservationId, bd, lineId });
        return lineId;
    }
}
