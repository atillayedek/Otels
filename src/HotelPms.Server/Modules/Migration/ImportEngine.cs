using System.Globalization;
using System.Text.Json;
using Dapper;
using HotelPms.Server.Infrastructure;
using Npgsql;

namespace HotelPms.Server.Modules.Migration;

/// <summary>Satır bazında iş kuralı doğrulaması. Kaynakta olmayan bilgi uydurulmaz; boşsa boş kalır.</summary>
public static class Validator
{
    static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    public static void Check(string entity, Dictionary<string, string?> m, List<ImportIssue> issues, Lookups lk, DateOnly businessDate)
    {
        void Error(string field, string reason) => issues.Add(new(field, m.GetValueOrDefault(field), reason, "error"));
        void Warn(string field, string reason) => issues.Add(new(field, m.GetValueOrDefault(field), reason, "warning"));
        void Lose(string field, string reason)
        {
            Warn(field, reason);
            m["__lost_" + field] = m[field];
            m.Remove(field);
        }
        string? V(string k) => m.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? v : null;

        switch (entity)
        {
            case "guests":
                if (V("first_name") is null) Error("first_name", "Ad boş.");
                if (V("last_name") is null) Error("last_name", "Soyad boş.");
                foreach (var f in new[] { "first_name", "last_name" })
                    if (V(f) is { Length: > 100 }) Error(f, "100 karakterden uzun.");
                if (V("tckn") is { } tc)
                {
                    tc = new string(tc.Where(char.IsDigit).ToArray());
                    m["tckn"] = tc;
                    if (!Validate.IsValidTckn(tc)) Warn("tckn", "T.C. kimlik numarası algoritma kontrolünden geçmedi; değer olduğu gibi aktarılacak.");
                }
                if (V("email") is { } email && !email.Contains('@')) Lose("email", "E-posta biçimi geçersiz; değer misafir notuna eklendi.");
                if (V("birth_date") is { } bdate && DateOnly.Parse(bdate, CultureInfo.InvariantCulture) > businessDate) Lose("birth_date", "Doğum tarihi gelecekte; misafir notuna eklendi.");
                if (V("is_blacklisted") == "true" && V("blacklist_reason") is null) m["blacklist_reason"] = "Eski sistemde kara listede (kaynakta gerekçe yok)";
                break;

            case "companies":
            case "agencies":
                if (V("name") is null) Error("name", "Unvan boş.");
                if (V("email") is { } em && !em.Contains('@')) Lose("email", "E-posta biçimi geçersiz; değer notlara eklendi.");
                if (V("commission_rate") is { } cr && (decimal.Parse(cr, CultureInfo.InvariantCulture) is < 0 or > 100)) Error("commission_rate", "Komisyon oranı 0-100 arasında olmalı.");
                break;

            case "room_types":
                if (V("code") is not { } code || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]{1,12}$"))
                    Error("code", "Kod 1-12 karakter; yalnız harf, rakam, - ve _ olmalı.");
                if (V("name") is null) Error("name", "Ad boş.");
                if (V("max_adults") is { } ma && int.Parse(ma, CultureInfo.InvariantCulture) is < 1 or > 30) Error("max_adults", "Kapasite 1-30 arasında olmalı.");
                break;

            case "rooms":
                if (V("number") is not { } num || !System.Text.RegularExpressions.Regex.IsMatch(num, "^[A-Za-z0-9_-]{1,10}$"))
                    Error("number", "Oda numarası 1-10 karakter; harf, rakam, - ve _ olmalı.");
                if (V("room_type_code") is not { } rt) Error("room_type_code", "Oda tipi boş.");
                else if (!lk.RoomTypes.ContainsKey(rt)) Error("room_type_code", $"Oda tipi '{rt}' tanımlı değil. Önce oda tiplerini aktarın veya tanımlayın.");
                break;

            case "reservations":
                if (V("room_type_code") is not { } rtc) Error("room_type_code", "Oda tipi boş.");
                else if (!lk.RoomTypes.ContainsKey(rtc)) Error("room_type_code", $"Oda tipi '{rtc}' tanımlı değil.");
                if (V("room_number") is { } rn && !lk.Rooms.ContainsKey(rn)) Lose("room_number", $"Oda '{rn}' tanımlı değil; oda ataması yapılmadan aktarılacak.");
                if (V("guest_ref") is null && V("guest_name") is null) Error("guest_ref", "Misafir bilgisi (eski kayıt no/kimlik veya ad soyad) yok.");
                if (V("arrival") is { } a && V("departure") is { } d)
                {
                    var arr = DateOnly.Parse(a, CultureInfo.InvariantCulture);
                    var dep = DateOnly.Parse(d, CultureInfo.InvariantCulture);
                    if (dep <= arr) Error("departure", "Çıkış tarihi girişten sonra olmalı.");
                    else if (dep.DayNumber - arr.DayNumber > 365) Error("departure", "Konaklama 365 geceden uzun.");
                    var st = V("status");
                    if (st == "checked_in")
                        Error("status", "Konaklayan (in-house) misafir aktarılamaz: açık folyo bakiyesi ve oda durumu doğrulanamaz. Bu misafirlerin check-in'ini yeni sistemde yapın.");
                    else if (st is "confirmed" or "tentative")
                    {
                        if (arr < businessDate)
                            Error("arrival", $"Giriş tarihi iş gününden ({businessDate:dd.MM.yyyy}) önce olan açık rezervasyon; eski sistemde durumu (çıkış/iptal/no-show) netleştirin.");
                        if (V("nightly_rate") is null) Error("nightly_rate", "Gelecek rezervasyon için gecelik fiyat zorunludur (uydurma fiyat kullanılmaz).");
                    }
                    else if (V("nightly_rate") is null && st is "checked_out")
                        Warn("nightly_rate", "Fiyat kaynakta yok; geçmiş konaklama 0 fiyatla aktarılacak (gelir raporuna yansımaz).");
                }
                if (V("adults") is { } ad && int.Parse(ad, CultureInfo.InvariantCulture) is < 1 or > 30) Error("adults", "Yetişkin sayısı 1-30 arasında olmalı.");
                if (V("children") is { } ch && int.Parse(ch, CultureInfo.InvariantCulture) is < 0 or > 30) Error("children", "Çocuk sayısı 0-30 arasında olmalı.");
                if (V("nightly_rate") is { } nr && decimal.Parse(nr, CultureInfo.InvariantCulture) < 0) Error("nightly_rate", "Fiyat negatif olamaz.");
                break;

            case "folio_history":
            case "account_ledger":
                if (V("amount") is { } amt)
                {
                    var val = decimal.Parse(amt, CultureInfo.InvariantCulture);
                    if (val == 0) Error("amount", "Tutar sıfır.");
                    if (val < 0)
                    {
                        Warn("amount", "Negatif tutar mutlak değer olarak alındı; yön 'Tür' alanından belirlenir.");
                        m["amount"] = Math.Abs(val).ToString(CultureInfo.InvariantCulture);
                    }
                }
                if (V("kind") == "payment")
                {
                    if (V("payment_method") is not { } pm) Error("payment_method", "Ödeme satırı için ödeme tipi zorunludur.");
                    else if (!lk.PaymentMethods.Contains(pm)) Error("payment_method", $"Ödeme tipi '{pm}' tanımlı değil. Ayarlar → Ödeme Tipleri'nden ekleyin.");
                }
                break;
        }
    }

    public static string TrLower(string s) => s.Trim().ToLower(Tr);
}

public sealed record DuplicateMatch(Guid Id, int Score, string Reason);

/// <summary>
/// Mükerrer kayıt tespiti. Kimlik/vergi no/kod gibi kesin eşleşmeler skor 100; ad+doğum tarihi, e-posta, telefon
/// gibi kesin olmayan eşleşmeler daha düşük skor alır ve otomatik birleştirilmez ("İncelenmeli").
/// </summary>
public static class Duplicates
{
    public static string? InFileKey(string entity, Dictionary<string, string?> m) => entity switch
    {
        "guests" => (m.GetValueOrDefault("tckn") ?? m.GetValueOrDefault("passport_no") ?? m.GetValueOrDefault("identity_number")) is { Length: > 0 } k ? "kimlik:" + k.ToUpperInvariant() : null,
        "companies" or "agencies" => m.GetValueOrDefault("tax_number") is { Length: > 0 } t ? "vergi no:" + t : m.GetValueOrDefault("code") is { Length: > 0 } c ? "kod:" + c.ToUpperInvariant() : null,
        "room_types" => m.GetValueOrDefault("code") is { Length: > 0 } c2 ? "kod:" + c2 : null,
        "rooms" => m.GetValueOrDefault("number") is { Length: > 0 } n ? "oda no:" + n.ToUpperInvariant() : null,
        "reservations" => m.GetValueOrDefault("reservation_number") is { Length: > 0 } r ? "rezervasyon no:" + r : m.GetValueOrDefault("source_id") is { Length: > 0 } s ? "kayıt no:" + s : null,
        "folio_history" or "account_ledger" => m.GetValueOrDefault("source_id") is { Length: > 0 } s2 ? "kayıt no:" + s2 : null,
        _ => null,
    };

    public static async Task<List<DuplicateMatch?>> FindAsync(NpgsqlConnection c, string entity, List<Dictionary<string, string?>> rows)
    {
        var result = rows.Select(_ => (DuplicateMatch?)null).ToList();
        void Set(int i, DuplicateMatch d)
        {
            if (result[i] is null || result[i]!.Score < d.Score) result[i] = d;
        }
        string? G(int i, string k) => rows[i].TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? v : null;

        switch (entity)
        {
            case "guests":
            {
                var ids = rows.Select(r => r.GetValueOrDefault("tckn") ?? r.GetValueOrDefault("passport_no") ?? r.GetValueOrDefault("identity_number"))
                    .Where(x => x is not null).Select(x => x!.ToUpperInvariant()).Distinct().ToArray();
                var byId = (await c.QueryAsync<(Guid Id, string Idn)>("SELECT id, upper(identity_number) FROM pms.guests WHERE upper(identity_number) = ANY(@ids)", new { ids }))
                    .GroupBy(x => x.Idn).ToDictionary(g => g.Key, g => g.First().Id);
                var emails = rows.Select(r => r.GetValueOrDefault("email")?.ToLowerInvariant()).Where(x => x is not null).Distinct().ToArray();
                var byEmail = (await c.QueryAsync<(Guid Id, string Email)>("SELECT id, lower(email) FROM pms.guests WHERE lower(email) = ANY(@emails)", new { emails }))
                    .GroupBy(x => x.Email).ToDictionary(g => g.Key, g => g.First().Id);
                var phones = rows.Select(r => Validate.NormalizePhone(r.GetValueOrDefault("phone"))).Where(x => x is { Length: >= 7 }).Distinct().ToArray();
                var byPhone = (await c.QueryAsync<(Guid Id, string Phone)>("SELECT id, phone_normalized FROM pms.guests WHERE phone_normalized = ANY(@phones)", new { phones }))
                    .GroupBy(x => x.Phone).ToDictionary(g => g.Key, g => g.First().Id);
                var births = rows.Select(r => r.GetValueOrDefault("birth_date")).Where(x => x is not null)
                    .Select(x => DateOnly.Parse(x!, CultureInfo.InvariantCulture)).Distinct().ToArray();
                var byBirth = (await c.QueryAsync<(Guid Id, string First, string Last, DateTime Birth)>(
                    "SELECT id, first_name, last_name, birth_date FROM pms.guests WHERE birth_date = ANY(@births)", new { births }))
                    .GroupBy(x => $"{Validator.TrLower(x.First)}|{Validator.TrLower(x.Last)}|{DateOnly.FromDateTime(x.Birth):yyyy-MM-dd}")
                    .ToDictionary(g => g.Key, g => g.First().Id);
                var sourceIds = rows.Select(r => r.GetValueOrDefault("source_id")).Where(x => x is not null).Distinct().ToArray();
                var bySource = (await c.QueryAsync<(Guid Id, string Sid)>("SELECT id, migration_source_id FROM pms.guests WHERE migration_source_id = ANY(@sourceIds)", new { sourceIds }))
                    .GroupBy(x => x.Sid).ToDictionary(g => g.Key, g => g.First().Id);
                for (var i = 0; i < rows.Count; i++)
                {
                    var idn = (G(i, "tckn") ?? G(i, "passport_no") ?? G(i, "identity_number"))?.ToUpperInvariant();
                    if (idn is not null && byId.TryGetValue(idn, out var g1)) Set(i, new(g1, 100, "Aynı kimlik/pasaport numarası"));
                    if (G(i, "source_id") is { } sid && bySource.TryGetValue(sid, out var g5)) Set(i, new(g5, 95, "Aynı eski sistem kayıt numarası daha önce aktarılmış"));
                    if (G(i, "first_name") is { } fn && G(i, "last_name") is { } ln && G(i, "birth_date") is { } bd &&
                        byBirth.TryGetValue($"{Validator.TrLower(fn)}|{Validator.TrLower(ln)}|{bd}", out var g2)) Set(i, new(g2, 85, "Aynı ad, soyad ve doğum tarihi"));
                    if (G(i, "email") is { } em && byEmail.TryGetValue(em.ToLowerInvariant(), out var g3)) Set(i, new(g3, 75, "Aynı e-posta adresi"));
                    if (Validate.NormalizePhone(G(i, "phone")) is { Length: >= 7 } ph && byPhone.TryGetValue(ph, out var g4)) Set(i, new(g4, 70, "Aynı telefon numarası"));
                }
                break;
            }
            case "companies":
            case "agencies":
            {
                var all = (await c.QueryAsync<(Guid Id, string? Code, string Name, string? Tax)>($"SELECT id, upper(code), name, tax_number FROM pms.{entity}")).ToList();
                for (var i = 0; i < rows.Count; i++)
                {
                    if (G(i, "tax_number") is { } t && all.FirstOrDefault(a => a.Tax == t) is { Id: var tid } && tid != Guid.Empty) Set(i, new(tid, 100, "Aynı vergi numarası"));
                    if (G(i, "code") is { } cd && all.FirstOrDefault(a => a.Code == cd.ToUpperInvariant()) is { Id: var cid } && cid != Guid.Empty) Set(i, new(cid, 100, "Aynı cari kod"));
                    if (G(i, "name") is { } n && all.FirstOrDefault(a => Validator.TrLower(a.Name) == Validator.TrLower(n)) is { Id: var nid } && nid != Guid.Empty) Set(i, new(nid, 90, "Aynı unvan"));
                }
                break;
            }
            case "room_types":
            {
                var all = (await c.QueryAsync<(Guid Id, string Code)>("SELECT id, code FROM pms.room_types")).ToDictionary(x => x.Code, x => x.Id, StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < rows.Count; i++) if (G(i, "code") is { } cd && all.TryGetValue(cd, out var id)) Set(i, new(id, 100, "Aynı oda tipi kodu"));
                break;
            }
            case "rooms":
            {
                var all = (await c.QueryAsync<(Guid Id, string Number)>("SELECT id, number FROM pms.rooms")).ToDictionary(x => x.Number, x => x.Id, StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < rows.Count; i++) if (G(i, "number") is { } n && all.TryGetValue(n, out var id)) Set(i, new(id, 100, "Aynı oda numarası"));
                break;
            }
            case "reservations":
            {
                var nums = rows.Select(r => r.GetValueOrDefault("reservation_number")).Where(x => x is not null).ToArray();
                var sids = rows.Select(r => r.GetValueOrDefault("source_id")).Where(x => x is not null).ToArray();
                var existing = (await c.QueryAsync<(Guid Id, string Number, string? Sid)>(
                    "SELECT id, reservation_number, migration_source_id FROM pms.reservations WHERE reservation_number = ANY(@nums) OR migration_source_id = ANY(@sids) OR migration_source_id = ANY(@nums)",
                    new { nums, sids })).ToList();
                for (var i = 0; i < rows.Count; i++)
                {
                    var n = G(i, "reservation_number");
                    var s = G(i, "source_id");
                    var hit = existing.FirstOrDefault(e => (n is not null && (e.Sid == n || e.Number == n)) || (s is not null && e.Sid == s));
                    if (hit.Id != Guid.Empty) Set(i, new(hit.Id, 100, "Rezervasyon daha önce aktarılmış veya aynı numara mevcut"));
                }
                break;
            }
            case "folio_history":
            case "account_ledger":
            {
                var sids = rows.Select(r => r.GetValueOrDefault("source_id")).Where(x => x is not null).ToArray();
                var existing = (await c.QueryAsync<(Guid Id, string Sid)>("SELECT id, migration_source_id FROM pms.folio_lines WHERE migration_source_id = ANY(@sids)", new { sids }))
                    .GroupBy(x => x.Sid).ToDictionary(g => g.Key, g => g.First().Id);
                for (var i = 0; i < rows.Count; i++) if (G(i, "source_id") is { } s && existing.TryGetValue(s, out var id)) Set(i, new(id, 100, "Bu folyo hareketi daha önce aktarılmış"));
                break;
            }
        }
        return result;
    }
}

/// <summary>Doğrulanmış satırı üretim tablosuna yazar ve rollback için import_records kaydı tutar.</summary>
public sealed class EntityWriter(NpgsqlConnection c, NpgsqlTransaction tx, Guid jobId, string sourceLabel, Guid userId, int batchNo, string currency)
{
    int _rowNo;

    static string? S(Dictionary<string, string?> m, string k) => m.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? v.Trim() : null;
    static bool B(Dictionary<string, string?> m, string k) => S(m, k) == "true";
    static int? I(Dictionary<string, string?> m, string k) => S(m, k) is { } v ? int.Parse(v, CultureInfo.InvariantCulture) : null;
    static decimal? D(Dictionary<string, string?> m, string k) => S(m, k) is { } v ? decimal.Parse(v, CultureInfo.InvariantCulture) : null;
    static DateOnly? Dt(Dictionary<string, string?> m, string k) => S(m, k) is { } v ? DateOnly.Parse(v, CultureInfo.InvariantCulture) : null;

    static string? LostNotes(Dictionary<string, string?> m, string? existing)
    {
        var lost = m.Where(kv => kv.Key.StartsWith("__lost_") && !string.IsNullOrWhiteSpace(kv.Value))
            .Select(kv => $"{kv.Key[7..]}: {kv.Value}").ToList();
        if (lost.Count == 0) return existing;
        var note = "[Aktarım - dönüştürülemeyen değerler] " + string.Join("; ", lost);
        return string.IsNullOrEmpty(existing) ? note : existing + "\n" + note;
    }

    Task Record(string table, Guid id, string action, string? before, int? afterVersion) =>
        c.ExecuteAsync("""
            INSERT INTO pms.import_records (job_id, row_no, entity_table, entity_id, action, before_value, after_version, batch_no)
            VALUES (@jobId, @rowNo, @table, @id, @action, @before::jsonb, @afterVersion, @batchNo)
            """, new { jobId, rowNo = _rowNo, table, id, action, before, afterVersion, batchNo }, tx);

    Task<T> Scalar<T>(string sql, object p) => c.ExecuteScalarAsync<T>(sql, p, tx)!;

    public async Task<(Guid Id, string Status)> WriteAsync(string entity, int rowNo, Dictionary<string, string?> m, Guid? updateId)
    {
        _rowNo = rowNo;
        return entity switch
        {
            "guests" => await GuestAsync(m, updateId),
            "companies" or "agencies" => await AccountAsync(entity, m, updateId),
            "room_types" => await RoomTypeAsync(m, updateId),
            "rooms" => await RoomAsync(m, updateId),
            "reservations" => updateId is null ? await ReservationAsync(m) : throw PmsException.Validation("Mevcut rezervasyonlar aktarımla güncellenmez; satır atlanmalıdır."),
            "folio_history" => updateId is null ? await FolioLineAsync(m) : throw PmsException.Validation("Aktarılmış folyo hareketi tekrar yazılmaz."),
            "account_ledger" => updateId is null ? await AccountLedgerAsync(m) : throw PmsException.Validation("Aktarılmış cari hareket tekrar yazılmaz."),
            _ => throw new InvalidOperationException(),
        };
    }

    async Task<Guid?> AccountByNameOrCode(string table, string? v)
    {
        if (v is null) return null;
        var ids = (await c.QueryAsync<Guid>($"SELECT id FROM pms.{table} WHERE upper(code) = upper(@v) OR lower(name) = lower(@v) LIMIT 2", new { v }, tx)).ToList();
        return ids.Count == 1 ? ids[0] : null;
    }

    static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    async Task<(Guid, string)> GuestAsync(Dictionary<string, string?> m, Guid? updateId)
    {
        var (idType, idNo) = S(m, "tckn") is { } tc ? ("tckn", tc) : S(m, "passport_no") is { } pp ? ("passport", pp.ToUpperInvariant()) : S(m, "identity_number") is { } other ? ("other", other.ToUpperInvariant()) : (null, null);
        if (S(m, "tckn") is not null && S(m, "passport_no") is { } extraPass) m["__lost_passport_no"] = extraPass;
        var phone = S(m, "phone");
        var companyId = await AccountByNameOrCode("companies", S(m, "company_name"));
        if (S(m, "company_name") is { } cn && companyId is null) m["__lost_company"] = cn;
        var p = new
        {
            first = S(m, "first_name")!, last = S(m, "last_name")!, gender = S(m, "gender"), birth = Dt(m, "birth_date"), birthPlace = S(m, "birth_place"),
            father = S(m, "father_name"), mother = S(m, "mother_name"), nationality = S(m, "nationality") ?? (idType == "tckn" ? "TR" : null),
            idType, idNo, idCountry = S(m, "identity_country"), phone, phoneN = Validate.NormalizePhone(phone), email = S(m, "email"), address = S(m, "address"),
            city = S(m, "city"), country = S(m, "country"), taxOffice = S(m, "tax_office"), taxNo = S(m, "tax_number"), companyId, notes = LostNotes(m, S(m, "notes")), prefs = S(m, "preferences"), vip = B(m, "is_vip"),
            vipLevel = S(m, "vip_level"), bl = B(m, "is_blacklisted"), blReason = S(m, "blacklist_reason"), kvkk = B(m, "kvkk_consent"), mkt = B(m, "marketing_consent"),
            jobId, src = sourceLabel, sid = S(m, "source_id"), userId, id = updateId,
            phone2 = Cut(S(m, "phone2"), 40), serial = Cut(S(m, "identity_serial")?.ToUpperInvariant(), 30), issuePlace = Cut(S(m, "identity_issue_place"), 100),
            issueDate = Dt(m, "identity_issue_date"), district = Cut(S(m, "district"), 100), postal = Cut(S(m, "postal_code"), 20),
            plate = Cut(S(m, "vehicle_plate")?.ToUpperInvariant().Replace(" ", ""), 20), title = Cut(S(m, "title"), 20),
        };
        if (updateId is { } uid)
        {
            var before = await Scalar<string>("SELECT row_to_json(g)::text FROM pms.guests g WHERE id = @uid FOR UPDATE", new { uid });
            // Kimlik ve ad bilgileri asla üzerine yazılmaz; yalnız boş alanlar doldurulur, notlar eklenir.
            var ver = await Scalar<int>("""
                UPDATE pms.guests SET gender = COALESCE(gender, @gender), birth_date = COALESCE(birth_date, @birth), birth_place = COALESCE(birth_place, @birthPlace),
                    father_name = COALESCE(father_name, @father), mother_name = COALESCE(mother_name, @mother), nationality = COALESCE(nationality, @nationality),
                    identity_type = COALESCE(identity_type, @idType), identity_number = COALESCE(identity_number, @idNo), identity_country = COALESCE(identity_country, @idCountry),
                    phone = COALESCE(phone, @phone), phone_normalized = COALESCE(phone_normalized, @phoneN), email = COALESCE(email, @email),
                    address = COALESCE(address, @address), city = COALESCE(city, @city), country = COALESCE(country, @country), company_id = COALESCE(company_id, @companyId),
                    tax_office = COALESCE(tax_office, @taxOffice), tax_number = COALESCE(tax_number, @taxNo),
                    notes = CASE WHEN @notes IS NULL THEN notes WHEN notes IS NULL THEN @notes ELSE notes || E'\n' || @notes END,
                    preferences = COALESCE(preferences, @prefs), is_vip = is_vip OR @vip, vip_level = COALESCE(vip_level, @vipLevel),
                    is_blacklisted = is_blacklisted OR @bl, blacklist_reason = COALESCE(blacklist_reason, @blReason),
                    phone2 = COALESCE(phone2, @phone2), identity_serial = COALESCE(identity_serial, @serial), identity_issue_place = COALESCE(identity_issue_place, @issuePlace),
                    identity_issue_date = COALESCE(identity_issue_date, @issueDate), district = COALESCE(district, @district), postal_code = COALESCE(postal_code, @postal),
                    vehicle_plate = COALESCE(vehicle_plate, @plate), title = COALESCE(title, @title),
                    updated_at = now(), version = version + 1
                WHERE id = @id RETURNING version
                """, p);
            await Record("guests", uid, "updated", before, ver);
            return (uid, "updated");
        }
        var newId = await Scalar<Guid>("""
            INSERT INTO pms.guests (first_name, last_name, gender, birth_date, birth_place, father_name, mother_name, nationality, identity_type, identity_number,
                identity_country, phone, phone_normalized, email, address, city, country, tax_office, tax_number, company_id, notes, preferences, is_vip, vip_level, is_blacklisted,
                blacklist_reason, kvkk_consent, kvkk_consent_at, marketing_consent, created_by, migration_job_id, migration_source, migration_source_id,
                phone2, identity_serial, identity_issue_place, identity_issue_date, district, postal_code, vehicle_plate, title)
            VALUES (@first, @last, @gender, @birth, @birthPlace, @father, @mother, @nationality, @idType, @idNo, @idCountry, @phone, @phoneN, @email, @address,
                @city, @country, @taxOffice, @taxNo, @companyId, @notes, @prefs, @vip, @vipLevel, @bl, @blReason, @kvkk, CASE WHEN @kvkk THEN now() END, @mkt, @userId,
                @jobId, @src, @sid, @phone2, @serial, @issuePlace, @issueDate, @district, @postal, @plate, @title)
            RETURNING id
            """, p);
        await Record("guests", newId, "created", null, 1);
        return (newId, "imported");
    }

    async Task<(Guid, string)> AccountAsync(string table, Dictionary<string, string?> m, Guid? updateId)
    {
        var agency = table == "agencies";
        var p = new
        {
            code = S(m, "code")?.ToUpperInvariant(), name = S(m, "name")!, taxOffice = S(m, "tax_office"), tax = S(m, "tax_number"), address = S(m, "address"),
            city = S(m, "city"), country = S(m, "country"), phone = S(m, "phone"), email = S(m, "email"), contact = S(m, "contact_name"),
            limit = D(m, "credit_limit"), commission = D(m, "commission_rate"), cl = B(m, "is_city_ledger"), notes = LostNotes(m, S(m, "notes")),
            jobId, src = sourceLabel, sid = S(m, "source_id"), id = updateId,
        };
        var extra = agency ? "commission_rate" : "is_city_ledger";
        var extraP = agency ? "@commission" : "@cl";
        if (updateId is { } uid)
        {
            var before = await Scalar<string>($"SELECT row_to_json(a)::text FROM pms.{table} a WHERE id = @uid FOR UPDATE", new { uid });
            var ver = await Scalar<int>($"""
                UPDATE pms.{table} SET tax_office = COALESCE(tax_office, @taxOffice), tax_number = COALESCE(tax_number, @tax), address = COALESCE(address, @address),
                    city = COALESCE(city, @city), country = COALESCE(country, @country), phone = COALESCE(phone, @phone), email = COALESCE(email, @email),
                    contact_name = COALESCE(contact_name, @contact), credit_limit = COALESCE(credit_limit, @limit),
                    notes = CASE WHEN @notes IS NULL THEN notes WHEN notes IS NULL THEN @notes ELSE notes || E'\n' || @notes END, updated_at = now(), version = version + 1
                WHERE id = @id RETURNING version
                """, p);
            await Record(table, uid, "updated", before, ver);
            return (uid, "updated");
        }
        var newId = await Scalar<Guid>($"""
            INSERT INTO pms.{table} (code, name, tax_office, tax_number, address, city, country, phone, email, contact_name, credit_limit, {extra}, notes,
                migration_job_id, migration_source, migration_source_id)
            VALUES (@code, @name, @taxOffice, @tax, @address, @city, @country, @phone, @email, @contact, @limit, {extraP}, @notes, @jobId, @src, @sid)
            RETURNING id
            """, p);
        await Record(table, newId, "created", null, 1);
        return (newId, "imported");
    }

    async Task<(Guid, string)> RoomTypeAsync(Dictionary<string, string?> m, Guid? updateId)
    {
        var p = new
        {
            code = S(m, "code")!, name = S(m, "name")!, desc = S(m, "description"), adults = I(m, "max_adults"), children = I(m, "max_children"),
            rate = D(m, "default_rate"), jobId, src = sourceLabel, sid = S(m, "source_id"), id = updateId,
        };
        if (updateId is { } uid)
        {
            var before = await Scalar<string>("SELECT row_to_json(t)::text FROM pms.room_types t WHERE id = @uid FOR UPDATE", new { uid });
            var ver = await Scalar<int>("""
                UPDATE pms.room_types SET name = @name, description = COALESCE(@desc, description), max_adults = COALESCE(@adults, max_adults),
                    max_children = COALESCE(@children, max_children), default_rate = COALESCE(@rate, default_rate), updated_at = now(), version = version + 1
                WHERE id = @id RETURNING version
                """, p);
            await Record("room_types", uid, "updated", before, ver);
            return (uid, "updated");
        }
        var newId = await Scalar<Guid>("""
            INSERT INTO pms.room_types (code, name, description, max_adults, max_children, default_rate, migration_job_id, migration_source, migration_source_id)
            VALUES (@code, @name, @desc, COALESCE(@adults, 2), COALESCE(@children, 0), COALESCE(@rate, 0), @jobId, @src, @sid) RETURNING id
            """, p);
        await Record("room_types", newId, "created", null, 1);
        return (newId, "imported");
    }

    async Task<(Guid, string)> RoomAsync(Dictionary<string, string?> m, Guid? updateId)
    {
        var typeId = await Scalar<Guid?>("SELECT id FROM pms.room_types WHERE upper(code) = upper(@c)", new { c = S(m, "room_type_code") })
            ?? throw PmsException.Validation("Oda tipi bulunamadı.");
        var p = new { number = S(m, "number")!, typeId, floor = S(m, "floor"), desc = S(m, "description"), features = S(m, "features"), jobId, src = sourceLabel, sid = S(m, "source_id"), id = updateId };
        if (updateId is { } uid)
        {
            var before = await Scalar<string>("SELECT row_to_json(r)::text FROM pms.rooms r WHERE id = @uid FOR UPDATE", new { uid });
            var ver = await Scalar<int>("""
                UPDATE pms.rooms SET floor = COALESCE(@floor, floor), description = COALESCE(@desc, description), features = COALESCE(@features, features),
                    updated_at = now(), version = version + 1
                WHERE id = @id RETURNING version
                """, p);
            await Record("rooms", uid, "updated", before, ver);
            return (uid, "updated");
        }
        var newId = await Scalar<Guid>("""
            INSERT INTO pms.rooms (room_type_id, number, floor, description, features, migration_job_id, migration_source, migration_source_id)
            VALUES (@typeId, @number, @floor, @desc, @features, @jobId, @src, @sid) RETURNING id
            """, p);
        await Record("rooms", newId, "created", null, 1);
        return (newId, "imported");
    }

    async Task<(Guid, string)> ReservationAsync(Dictionary<string, string?> m)
    {
        var typeId = await Scalar<Guid?>("SELECT id FROM pms.room_types WHERE upper(code) = upper(@c)", new { c = S(m, "room_type_code") })
            ?? throw PmsException.Validation("Oda tipi bulunamadı.");
        Guid? roomId = S(m, "room_number") is { } rn ? await Scalar<Guid?>("SELECT id FROM pms.rooms WHERE upper(number) = upper(@rn)", new { rn }) : null;

        // Misafir: önce eski kayıt numarası / kimlik ile; bulunamazsa addan yeni misafir (otomatik birleştirme yapılmaz).
        Guid? guestId = null;
        if (S(m, "guest_ref") is { } gref)
        {
            var hits = (await c.QueryAsync<Guid>("SELECT id FROM pms.guests WHERE migration_source_id = @gref OR upper(identity_number) = upper(@gref) LIMIT 2", new { gref }, tx)).ToList();
            if (hits.Count == 1) guestId = hits[0];
            else if (hits.Count > 1) throw PmsException.Validation($"Misafir referansı '{gref}' birden fazla misafirle eşleşti; elle eşleştirin.");
        }
        if (guestId is null)
        {
            var name = S(m, "guest_name") ?? throw PmsException.Validation("Misafir bulunamadı ve ad bilgisi yok.");
            var (first, last) = Transform.SplitName(name);
            guestId = await Scalar<Guid>("""
                INSERT INTO pms.guests (first_name, last_name, created_by, migration_job_id, migration_source, migration_source_id)
                VALUES (@first, @last, @userId, @jobId, @src, @sid) RETURNING id
                """, new { first, last, userId, jobId, src = sourceLabel, sid = S(m, "guest_ref") });
            await Record("guests", guestId.Value, "created", null, 1);
        }

        var status = S(m, "status")!;
        var arrival = Dt(m, "arrival")!.Value;
        var departure = Dt(m, "departure")!.Value;
        var rate = D(m, "nightly_rate") ?? 0m;
        var srcNo = S(m, "reservation_number");
        var number = srcNo is not null && srcNo.Length <= 30 && !await Scalar<bool>("SELECT EXISTS (SELECT 1 FROM pms.reservations WHERE reservation_number = @srcNo)", new { srcNo })
            ? srcNo : "M" + await Scalar<long>("SELECT nextval('pms.reservation_number_seq')", new { });
        var companyId = await AccountByNameOrCode("companies", S(m, "company_name"));
        var agencyId = await AccountByNameOrCode("agencies", S(m, "agency_name"));
        if (S(m, "company_name") is { } cn && companyId is null) m["__lost_company"] = cn;
        if (S(m, "agency_name") is { } an && agencyId is null) m["__lost_agency"] = an;
        var id = await Scalar<Guid>("""
            INSERT INTO pms.reservations (reservation_number, status, guest_id, company_id, agency_id, room_type_id, room_id, arrival, departure, adults, children,
                nightly_rate, currency, meal_plan, source, market, segment, notes, cancel_reason, cancelled_on, no_show_on, checked_out_at, created_by,
                migration_job_id, migration_source, migration_source_id)
            VALUES (@number, @status, @guestId, @companyId, @agencyId, @typeId, @roomId, @arrival, @departure, COALESCE(@adults, 1), COALESCE(@children, 0),
                @rate, @currency, COALESCE(@meal, 'RO'), 'migration', @market, @segment, @notes,
                CASE WHEN @status = 'cancelled' THEN 'Eski sistemde iptal (aktarım)' WHEN @status = 'no_show' THEN 'Eski sistemde no-show (aktarım)' END,
                CASE WHEN @status = 'cancelled' THEN @arrival END, CASE WHEN @status = 'no_show' THEN @arrival END,
                CASE WHEN @status = 'checked_out' THEN @departure::timestamp END, @userId, @jobId, @src, COALESCE(@sid, @srcNo))
            RETURNING id
            """, new
        {
            number, status, guestId, companyId, agencyId, typeId, roomId, arrival, departure, adults = I(m, "adults"), children = I(m, "children"), rate, currency,
            meal = S(m, "meal_plan"), market = S(m, "market"), segment = S(m, "segment"), notes = LostNotes(m, S(m, "notes")), userId, jobId, src = sourceLabel,
            sid = S(m, "source_id"), srcNo,
        });
        await c.ExecuteAsync("INSERT INTO pms.reservation_guests (reservation_id, guest_id, is_primary) VALUES (@id, @guestId, true)", new { id, guestId }, tx);
        if (status is not ("cancelled" or "no_show"))
            await c.ExecuteAsync("""
                INSERT INTO pms.reservation_rates (reservation_id, stay_date, rate)
                SELECT @id, d::date, @rate FROM generate_series(@arrival::date, @departure::date - 1, interval '1 day') d
                """, new { id, rate, arrival, departure }, tx);
        var folioNo = "F" + await Scalar<long>("SELECT nextval('pms.folio_number_seq')", new { });
        await c.ExecuteAsync("""
            INSERT INTO pms.folios (folio_number, reservation_id, window_no, payer_kind, guest_id, name, currency, status, created_by, migration_job_id, migration_source)
            SELECT @folioNo, @id, 1, 'guest', @guestId, g.first_name || ' ' || g.last_name, @currency,
                   CASE WHEN @status IN ('tentative','confirmed') THEN 'open' ELSE 'closed' END, @userId, @jobId, @src
            FROM pms.guests g WHERE g.id = @guestId
            """, new { folioNo, id, guestId, currency, status, userId, jobId, src = sourceLabel }, tx);
        await Record("reservations", id, "created", null, 1);
        return (id, "imported");
    }

    async Task<(Guid, string)> FolioLineAsync(Dictionary<string, string?> m)
    {
        var rref = S(m, "reservation_ref")!;
        var res = (await c.QueryAsync<(Guid Id, string? Room)>("""
            SELECT r.id, rm.number FROM pms.reservations r LEFT JOIN pms.rooms rm ON rm.id = r.room_id
            WHERE r.migration_source_id = @rref OR r.reservation_number = @rref LIMIT 2
            """, new { rref }, tx)).ToList();
        if (res.Count != 1) throw PmsException.Validation(res.Count == 0 ? $"Rezervasyon '{rref}' bulunamadı. Önce rezervasyonları aktarın." : $"Rezervasyon '{rref}' birden fazla kayıtla eşleşti.");
        var reservationId = res[0].Id;
        var folioId = await Scalar<Guid?>("SELECT id FROM pms.folios WHERE reservation_id = @reservationId ORDER BY window_no LIMIT 1", new { reservationId });
        if (folioId is null)
        {
            var folioNo = "F" + await Scalar<long>("SELECT nextval('pms.folio_number_seq')", new { });
            folioId = await Scalar<Guid>("""
                INSERT INTO pms.folios (folio_number, reservation_id, window_no, payer_kind, guest_id, name, currency, status, created_by, migration_job_id, migration_source)
                SELECT @folioNo, r.id, 1, 'guest', r.guest_id, g.first_name || ' ' || g.last_name, @currency, 'closed', @userId, @jobId, @src
                FROM pms.reservations r JOIN pms.guests g ON g.id = r.guest_id WHERE r.id = @reservationId RETURNING id
                """, new { folioNo, reservationId, currency, userId, jobId, src = sourceLabel });
            await Record("folios", folioId.Value, "created", null, 1);
        }
        var kind = S(m, "kind")!;
        var amount = D(m, "amount")!.Value;
        Guid? methodId = kind == "payment"
            ? await Scalar<Guid?>("SELECT id FROM pms.payment_methods WHERE upper(code) = upper(@pm) OR lower(name) = lower(@pm) LIMIT 1", new { pm = S(m, "payment_method") })
            : null;
        var id = await Scalar<Guid>("""
            INSERT INTO pms.folio_lines (folio_id, line_type, payment_method_id, description, amount, currency, business_date, user_id, reference, room_number,
                migration_job_id, migration_source, migration_source_id)
            VALUES (@folioId, @kind, @methodId, @desc, @amount, @currency, @date, @userId, @reference, @room, @jobId, @src, @sid) RETURNING id
            """, new
        {
            folioId, kind, methodId, desc = S(m, "description")!, amount = kind == "payment" ? -amount : amount, currency, date = Dt(m, "date")!.Value, userId,
            reference = S(m, "reference"), room = res[0].Room, jobId, src = sourceLabel, sid = S(m, "source_id"),
        });
        await Record("folio_lines", id, "created", null, null);
        return (id, "imported");
    }

    /// <summary>
    /// Eski muhasebe programındaki şirket/acente cari hareketi → ilgili carinin hesap (city ledger) folyosuna borç veya alacak satırı.
    /// Cari kart vergi no, kod veya tam unvanla bulunur; bulunamazsa satır hatalı sayılır (cari uydurulmaz).
    /// </summary>
    async Task<(Guid, string)> AccountLedgerAsync(Dictionary<string, string?> m)
    {
        var kind = S(m, "account_kind")!;
        var table = kind == "agency" ? "agencies" : "companies";
        var reference = S(m, "account_ref")!;
        var hits = (await c.QueryAsync<Guid>($"""
            SELECT id FROM pms.{table} WHERE tax_number = @reference
            UNION SELECT id FROM pms.{table} WHERE upper(code) = upper(@reference)
            """, new { reference }, tx)).Distinct().ToList();
        if (hits.Count == 0)
            hits = (await c.QueryAsync<Guid>($"SELECT id FROM pms.{table} WHERE lower(name) = lower(@reference)", new { reference }, tx)).ToList();
        if (hits.Count != 1)
            throw PmsException.Validation(hits.Count == 0
                ? $"Cari '{reference}' bulunamadı. Önce {(kind == "agency" ? "acenteleri" : "şirketleri")} aktarın."
                : $"Cari '{reference}' birden fazla kayıtla eşleşti; vergi no veya kod kullanın.");
        var accountId = hits[0];
        var col = kind == "agency" ? "agency_id" : "company_id";
        var folioId = await Scalar<Guid?>($"SELECT id FROM pms.folios WHERE {col} = @accountId AND reservation_id IS NULL ORDER BY status = 'open' DESC, created_at LIMIT 1", new { accountId });
        if (folioId is null)
        {
            var folioNo = "F" + await Scalar<long>("SELECT nextval('pms.folio_number_seq')", new { });
            folioId = await Scalar<Guid>($"""
                INSERT INTO pms.folios (folio_number, reservation_id, window_no, payer_kind, {col}, name, currency, created_by, migration_job_id, migration_source)
                SELECT @folioNo, NULL, 1, @kind, a.id, 'Cari: ' || a.name, @currency, @userId, @jobId, @src FROM pms.{table} a WHERE a.id = @accountId RETURNING id
                """, new { folioNo, kind, accountId, currency, userId, jobId, src = sourceLabel });
            await Record("folios", folioId.Value, "created", null, 1);
        }
        var lineKind = S(m, "kind")!;
        var amount = D(m, "amount")!.Value;
        Guid? methodId = null;
        if (lineKind == "payment")
        {
            methodId = await Scalar<Guid?>("SELECT id FROM pms.payment_methods WHERE upper(code) = upper(@pm) OR lower(name) = lower(@pm) LIMIT 1", new { pm = S(m, "payment_method") })
                ?? throw PmsException.Validation("Alacak satırı için ödeme tipi bulunamadı.");
        }
        var id = await Scalar<Guid>("""
            INSERT INTO pms.folio_lines (folio_id, line_type, payment_method_id, description, amount, currency, business_date, user_id, reference,
                migration_job_id, migration_source, migration_source_id)
            VALUES (@folioId, @lineKind, @methodId, @desc, @amount, @currency, @date, @userId, @reference, @jobId, @src, @sid) RETURNING id
            """, new
        {
            folioId, lineKind, methodId, desc = S(m, "description")!, amount = lineKind == "payment" ? -amount : amount, currency,
            date = Dt(m, "date")!.Value, userId, reference = S(m, "reference"), jobId, src = sourceLabel, sid = S(m, "source_id"),
        });
        await Record("folio_lines", id, "created", null, null);
        return (id, "imported");
    }
}

/// <summary>Geri alma güvenliği: aktarım sonrası değiştirilmiş veya başka kayıtlarla ilişkilendirilmiş kayıtlar silinmez.</summary>
public static class RollbackGuard
{
    static readonly HashSet<string> Tables = ["guests", "companies", "agencies", "room_types", "rooms", "reservations", "folios", "folio_lines"];

    public static async Task<string?> CheckAsync(NpgsqlConnection c, NpgsqlTransaction tx, Guid jobId, string table, Guid id, int? afterVersion)
    {
        if (!Tables.Contains(table)) return "bilinmeyen tablo";
        if (!await c.ExecuteScalarAsync<bool>($"SELECT EXISTS (SELECT 1 FROM pms.{table} WHERE id = @id)", new { id }, tx)) return null;
        if (afterVersion is { } v && table is not ("folios" or "folio_lines") &&
            await c.ExecuteScalarAsync<int>($"SELECT version FROM pms.{table} WHERE id = @id", new { id }, tx) != v)
            return "aktarımdan sonra kullanıcı tarafından değiştirilmiş";
        var notJob = "(x.migration_job_id IS DISTINCT FROM @jobId)";
        string? dep = table switch
        {
            "guests" => $"""
                SELECT CASE
                  WHEN EXISTS (SELECT 1 FROM pms.reservations x WHERE x.guest_id = @id AND {notJob}) THEN 'misafirin aktarım dışı rezervasyonu var'
                  WHEN EXISTS (SELECT 1 FROM pms.reservation_guests rg JOIN pms.reservations x ON x.id = rg.reservation_id WHERE rg.guest_id = @id AND {notJob}) THEN 'misafir başka konaklamaya eklenmiş'
                  WHEN EXISTS (SELECT 1 FROM pms.folios x WHERE x.guest_id = @id AND {notJob}) THEN 'misafirin folyosu var'
                  WHEN EXISTS (SELECT 1 FROM pms.documents d WHERE d.entity_id = @id AND d.deleted_at IS NULL) THEN 'misafire belge yüklenmiş'
                  WHEN EXISTS (SELECT 1 FROM pms.identity_reports d WHERE d.guest_id = @id) THEN 'kimlik bildirimi kaydı var' END
                """,
            "companies" or "agencies" => $"""
                SELECT CASE
                  WHEN EXISTS (SELECT 1 FROM pms.reservations x WHERE x.{(table == "companies" ? "company_id" : "agency_id")} = @id AND {notJob}) THEN 'aktarım dışı rezervasyonlarda kullanılıyor'
                  WHEN EXISTS (SELECT 1 FROM pms.folios x WHERE x.{(table == "companies" ? "company_id" : "agency_id")} = @id AND {notJob}) THEN 'cari folyosu var'
                  WHEN {(table == "companies" ? $"EXISTS (SELECT 1 FROM pms.guests x WHERE x.company_id = @id AND {notJob})" : "false")} THEN 'misafir kartlarına bağlanmış' END
                """,
            "room_types" => $"""
                SELECT CASE
                  WHEN EXISTS (SELECT 1 FROM pms.rooms x WHERE x.room_type_id = @id AND {notJob}) THEN 'aktarım dışı odalar bu tipe bağlı'
                  WHEN EXISTS (SELECT 1 FROM pms.reservations x WHERE x.room_type_id = @id AND {notJob}) THEN 'rezervasyonlarda kullanılıyor'
                  WHEN EXISTS (SELECT 1 FROM pms.rate_plan_prices x WHERE x.room_type_id = @id) THEN 'fiyat planında kullanılıyor' END
                """,
            "rooms" => $"""
                SELECT CASE
                  WHEN EXISTS (SELECT 1 FROM pms.reservations x WHERE x.room_id = @id AND {notJob}) THEN 'aktarım dışı rezervasyonlara atanmış'
                  WHEN EXISTS (SELECT 1 FROM pms.room_blocks x WHERE x.room_id = @id) THEN 'oda blokajı var'
                  WHEN EXISTS (SELECT 1 FROM pms.hk_tasks x WHERE x.room_id = @id) OR EXISTS (SELECT 1 FROM pms.maintenance_tickets x WHERE x.room_id = @id) THEN 'kat hizmetleri/bakım kaydı var' END
                """,
            "reservations" => """
                SELECT CASE
                  WHEN EXISTS (SELECT 1 FROM pms.folio_lines l JOIN pms.folios f ON f.id = l.folio_id WHERE f.reservation_id = @id AND l.migration_job_id IS NULL) THEN 'yeni sistemde folyo hareketi girilmiş'
                  WHEN EXISTS (SELECT 1 FROM pms.room_assignments x WHERE x.reservation_id = @id) THEN 'oda ataması yapılmış'
                  WHEN EXISTS (SELECT 1 FROM pms.identity_reports x WHERE x.reservation_id = @id) THEN 'kimlik bildirimi var'
                  WHEN EXISTS (SELECT 1 FROM pms.wakeup_calls x WHERE x.reservation_id = @id) THEN 'uyandırma kaydı var'
                  WHEN EXISTS (SELECT 1 FROM pms.room_charge_postings x WHERE x.reservation_id = @id) THEN 'gece denetimi ücreti postalanmış' END
                """,
            "folios" => "SELECT CASE WHEN EXISTS (SELECT 1 FROM pms.folio_lines l WHERE l.folio_id = @id AND l.migration_job_id IS DISTINCT FROM @jobId) THEN 'folyoya yeni hareket girilmiş' END",
            _ => null,
        };
        return dep is null ? null : await c.ExecuteScalarAsync<string?>(dep, new { id, jobId }, tx);
    }

    public static async Task DeleteAsync(NpgsqlConnection c, NpgsqlTransaction tx, string table, Guid id)
    {
        switch (table)
        {
            case "reservations":
                await c.ExecuteAsync("""
                    DELETE FROM pms.folio_lines WHERE folio_id IN (SELECT id FROM pms.folios WHERE reservation_id = @id) AND migration_job_id IS NOT NULL;
                    DELETE FROM pms.folios WHERE reservation_id = @id;
                    DELETE FROM pms.reservation_rates WHERE reservation_id = @id;
                    DELETE FROM pms.reservation_guests WHERE reservation_id = @id;
                    DELETE FROM pms.reservations WHERE id = @id;
                    """, new { id }, tx);
                break;
            case "folios":
                await c.ExecuteAsync("DELETE FROM pms.folios WHERE id = @id AND NOT EXISTS (SELECT 1 FROM pms.folio_lines WHERE folio_id = @id)", new { id }, tx);
                break;
            default:
                await c.ExecuteAsync($"DELETE FROM pms.{table} WHERE id = @id", new { id }, tx);
                break;
        }
    }

    public static async Task RestoreAsync(NpgsqlConnection c, NpgsqlTransaction tx, string table, Guid id, string beforeJson)
    {
        var cols = (await c.QueryAsync<string>("""
            SELECT column_name FROM information_schema.columns WHERE table_schema = 'pms' AND table_name = @table AND column_name <> 'id' ORDER BY ordinal_position
            """, new { table }, tx)).ToList();
        var list = string.Join(", ", cols.Select(x => "\"" + x + "\""));
        await c.ExecuteAsync($"""
            UPDATE pms.{table} SET ({list}) = (SELECT {list} FROM jsonb_populate_record(NULL::pms.{table}, @beforeJson::jsonb)) WHERE id = @id
            """, new { id, beforeJson }, tx);
    }
}
