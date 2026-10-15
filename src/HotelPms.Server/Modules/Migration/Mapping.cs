using System.Globalization;
using System.Text;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Migration;

public sealed record TargetField(string Key, string Label, string Type, bool Required, string[] Synonyms, string? Note = null);

public sealed record FieldMapping(string? Source, string Target, string Transform = "none", string? Format = null, string? Constant = null);

public sealed record MappingSuggestion(string Target, string? Source, int Confidence);

public static class MappingCatalog
{
    static readonly string[] SourceId = ["ID", "KOD", "KAYITNO", "MUSTERIID", "MUSTERINO", "GUESTID", "SOURCEID", "NO", "SIRANO"];

    public static readonly Dictionary<string, TargetField[]> Entities = new()
    {
        ["guests"] =
        [
            new("first_name", "Ad", "text", true, ["ADI", "AD", "FIRSTNAME", "FIRST", "NAME", "ISIM", "MUSTERIADI", "MISAFIRADI", "GIVENNAME"]),
            new("last_name", "Soyad", "text", true, ["SOYADI", "SOYAD", "LASTNAME", "LAST", "SURNAME", "SOYISIM", "FAMILYNAME"]),
            new("full_name", "Ad Soyad (tek alan)", "text", false, ["ADSOYAD", "ADISOYADI", "FULLNAME", "MISAFIR", "MUSTERI", "MUSTERIADSOYAD", "UNVAN"],
                "Ad ve soyad ayrı sütunlarda değilse kullanılır; son kelime soyad kabul edilir."),
            new("gender", "Cinsiyet", "gender", false, ["CINSIYET", "CINSIYETI", "GENDER", "SEX", "C"]),
            new("birth_date", "Doğum tarihi", "date", false, ["DOGUMTARIHI", "DOGUMTAR", "DTARIH", "BIRTHDATE", "BIRTHDAY", "DOB", "DOGUM"]),
            new("birth_place", "Doğum yeri", "text", false, ["DOGUMYERI", "BIRTHPLACE"]),
            new("father_name", "Baba adı", "text", false, ["BABAADI", "BABA", "FATHERNAME"]),
            new("mother_name", "Anne adı", "text", false, ["ANNEADI", "ANA", "ANAADI", "ANNE", "MOTHERNAME"]),
            new("nationality", "Uyruk", "country", false, ["UYRUK", "UYRUGU", "NATIONALITY", "NATION", "MILLIYET", "ULKEKODU"]),
            new("tckn", "T.C. kimlik no", "text", false, ["TC", "TCKN", "TCNO", "TCKIMLIK", "TCKIMLIKNO", "KIMLIKNO", "TCKIMLIKNUMARASI"]),
            new("passport_no", "Pasaport no", "text", false, ["PASAPORT", "PASAPORTNO", "PASSPORT", "PASSPORTNO", "PASAPORTNUMARASI"]),
            new("identity_number", "Diğer kimlik no", "text", false, ["BELGENO", "KIMLIKBELGENO", "DOCUMENTNO", "IDNO"]),
            new("identity_country", "Kimlik veren ülke", "country", false, ["VERENULKE", "ISSUINGCOUNTRY"]),
            new("phone", "Telefon", "phone", false, ["TELEFON", "TEL", "GSM", "CEP", "CEPTEL", "PHONE", "MOBILE", "TELNO", "CEPTELEFONU"]),
            new("email", "E-posta", "email", false, ["EMAIL", "EPOSTA", "MAIL", "EMAILADRES", "MAILADRESI"]),
            new("address", "Adres", "text", false, ["ADRES", "ADDRESS", "EVADRESI"]),
            new("city", "Şehir", "text", false, ["SEHIR", "IL", "CITY", "IKAMETIL"]),
            new("country", "Ülke", "country", false, ["ULKE", "COUNTRY", "IKAMETULKE"]),
            new("phone2", "İkinci telefon", "phone", false, ["TEL2", "TELEFON2", "EVTEL", "ISTEL", "PHONE2"]),
            new("identity_serial", "Kimlik belgesi seri no", "text", false, ["SERINO", "SERI", "BELGESERINO", "SERIALNO"]),
            new("identity_issue_place", "Belgenin verildiği yer", "text", false, ["VERILDIGIYER", "VERILDIGIYERI", "VERYER", "ISSUEPLACE"]),
            new("identity_issue_date", "Belge veriliş tarihi", "date", false, ["VERILISTARIHI", "VERILDIGITARIH", "VERTAR", "ISSUEDATE"]),
            new("district", "İlçe", "text", false, ["ILCE", "ILCESI", "DISTRICT"]),
            new("postal_code", "Posta kodu", "text", false, ["PK", "POSTAKODU", "POSTKODU", "ZIP", "ZIPCODE", "POSTALCODE"]),
            new("vehicle_plate", "Araç plakası", "text", false, ["PLAKA", "PLAKANO", "ARACPLAKA", "PLATE"]),
            new("title", "Hitap", "text", false, ["HITAP", "TITLE"]),
            new("tax_office", "Vergi dairesi", "text", false, ["VERGIDAIRESI", "VD", "TAXOFFICE"]),
            new("tax_number", "Vergi no", "text", false, ["VERGINO", "VKN", "TAXNUMBER", "VERGINUMARASI"]),
            new("company_name", "Şirket (ad veya kod)", "text", false, ["FIRMA", "SIRKET", "COMPANY", "FIRMAADI", "SIRKETADI"], "Mevcut şirket kartıyla eşleştirilir; bulunamazsa boş bırakılır."),
            new("notes", "Notlar", "text", false, ["NOT", "NOTLAR", "ACIKLAMA", "NOTES", "REMARK", "REMARKS"]),
            new("preferences", "Tercihler", "text", false, ["TERCIH", "TERCIHLER", "PREFERENCES"]),
            new("is_vip", "VIP", "bool", false, ["VIP", "ISVIP", "VIPMI"]),
            new("vip_level", "VIP seviyesi", "text", false, ["VIPSEVIYE", "VIPLEVEL", "VIPKOD"]),
            new("is_blacklisted", "Kara liste", "bool", false, ["KARALISTE", "BLACKLIST", "YASAKLI", "ISTENMEYEN"]),
            new("blacklist_reason", "Kara liste gerekçesi", "text", false, ["KARALISTENEDEN", "BLACKLISTREASON", "YASAKNEDENI"]),
            new("kvkk_consent", "KVKK onayı", "bool", false, ["KVKK", "KVKKONAY", "ACIKRIZA"]),
            new("marketing_consent", "Pazarlama izni", "bool", false, ["IYS", "PAZARLAMAIZNI", "TICARIILETI", "MARKETING"]),
            new("source_id", "Eski sistem kayıt no", "text", false, SourceId),
        ],
        ["companies"] = AccountFields(false),
        ["agencies"] = AccountFields(true),
        ["room_types"] =
        [
            new("code", "Kod", "code", true, ["KOD", "TIPKODU", "ODATIPI", "CODE", "TYPE", "ROOMTYPE"]),
            new("name", "Ad", "text", true, ["AD", "ADI", "ACIKLAMA", "NAME", "TIPADI"]),
            new("max_adults", "Yetişkin kapasitesi", "int", false, ["KAPASITE", "YETISKIN", "MAXADULT", "MAXPAX", "PAX"]),
            new("max_children", "Çocuk kapasitesi", "int", false, ["COCUK", "MAXCHILD"]),
            new("default_rate", "Varsayılan fiyat", "decimal", false, ["FIYAT", "RACK", "PRICE", "RATE"]),
            new("description", "Açıklama", "text", false, ["DETAY", "DESCRIPTION"]),
            new("source_id", "Eski sistem kayıt no", "text", false, SourceId),
        ],
        ["rooms"] =
        [
            new("number", "Oda no", "code", true, ["ODANO", "ODA", "NO", "ROOM", "ROOMNO", "NUMBER"]),
            new("room_type_code", "Oda tipi kodu", "code", true, ["TIP", "ODATIPI", "TIPKODU", "ROOMTYPE", "TYPE"]),
            new("floor", "Kat", "text", false, ["KAT", "FLOOR"]),
            new("description", "Açıklama", "text", false, ["ACIKLAMA", "DESCRIPTION"]),
            new("features", "Özellikler", "text", false, ["OZELLIK", "OZELLIKLER", "FEATURES"]),
            new("source_id", "Eski sistem kayıt no", "text", false, SourceId),
        ],
        ["reservations"] =
        [
            new("reservation_number", "Rezervasyon no", "text", false, ["REZNO", "REZERVASYONNO", "VOUCHER", "RESNO", "RESERVATIONNUMBER", "KONFIRMASYON"]),
            new("guest_ref", "Misafir (eski kayıt no / TC / pasaport)", "text", false, ["MUSTERIID", "MISAFIRID", "GUESTID", "MUSTERINO", "TC", "TCKN", "PASAPORT"],
                "Önce eski sistem kayıt numarasıyla, sonra kimlik numarasıyla eşleştirilir."),
            new("guest_name", "Misafir adı soyadı", "text", false, ["MISAFIR", "ADSOYAD", "MUSTERI", "GUESTNAME", "ISIM"],
                "Misafir bulunamazsa bu adla yeni misafir kaydı oluşturulur."),
            new("room_type_code", "Oda tipi kodu", "code", true, ["ODATIPI", "TIP", "ROOMTYPE"]),
            new("room_number", "Oda no", "code", false, ["ODANO", "ODA", "ROOM", "ROOMNO"]),
            new("arrival", "Giriş tarihi", "date", true, ["GIRIS", "GIRISTARIHI", "GELIS", "ARRIVAL", "CHECKIN", "CI"]),
            new("departure", "Çıkış tarihi", "date", true, ["CIKIS", "CIKISTARIHI", "AYRILIS", "DEPARTURE", "CHECKOUT", "CO"]),
            new("adults", "Yetişkin", "int", false, ["YETISKIN", "YET", "ADULT", "ADULTS", "PAX"]),
            new("children", "Çocuk", "int", false, ["COCUK", "COC", "CHILD", "CHILDREN"]),
            new("nightly_rate", "Gecelik fiyat", "decimal", false, ["FIYAT", "GECELIK", "RATE", "PRICE", "ODAFIYATI"]),
            new("status", "Durum", "res_status", true, ["DURUM", "STATUS", "REZDURUM"], "Geçerli: onaylı, opsiyon, çıkış yapmış, iptal, no-show."),
            new("company_name", "Şirket (ad veya kod)", "text", false, ["FIRMA", "SIRKET", "COMPANY"]),
            new("agency_name", "Acente (ad veya kod)", "text", false, ["ACENTE", "AGENCY", "TOUROPERATOR"]),
            new("meal_plan", "Pansiyon", "meal_plan", false, ["PANSIYON", "BOARD", "MEALPLAN"]),
            new("market", "Pazar", "text", false, ["PAZAR", "MARKET"]),
            new("segment", "Segment", "text", false, ["SEGMENT"]),
            new("notes", "Notlar", "text", false, ["NOT", "NOTLAR", "ACIKLAMA", "NOTES"]),
            new("source_id", "Eski sistem kayıt no", "text", false, SourceId),
        ],
        ["folio_history"] =
        [
            new("reservation_ref", "Rezervasyon (eski no)", "text", true, ["REZNO", "REZERVASYONNO", "RESNO", "REZID"], "Bu işle veya önceki aktarımla gelen rezervasyon eşleştirilir."),
            new("date", "İşlem tarihi", "date", true, ["TARIH", "ISLEMTARIHI", "DATE"]),
            new("kind", "Tür (borç/ödeme)", "line_kind", true, ["TUR", "TIP", "BA", "BORCALACAK", "TYPE"]),
            new("description", "Açıklama", "text", true, ["ACIKLAMA", "DESCRIPTION", "ISLEM"]),
            new("amount", "Tutar", "decimal", true, ["TUTAR", "AMOUNT", "MEBLAG"]),
            new("payment_method", "Ödeme tipi (kod/ad)", "text", false, ["ODEMETIPI", "ODEME", "PAYMENT", "KASA"]),
            new("reference", "Belge no", "text", false, ["BELGENO", "FISNO", "REFERANS", "REFERENCE"]),
            new("source_id", "Eski sistem kayıt no", "text", false, SourceId),
        ],
        ["account_ledger"] =
        [
            new("account_kind", "Cari türü (şirket/acente)", "account_kind", true, ["CARITURU", "HESAPTURU", "TUR", "TIP"],
                "Tüm dosya tek türse sabit değer seçin (Şirket veya Acente)."),
            new("account_ref", "Cari (vergi no / kod / unvan)", "text", true, ["VERGINO", "VKN", "CARIKOD", "CARIKODU", "HESAPKODU", "UNVAN", "FIRMA", "CARI"],
                "Önce vergi numarasıyla, sonra cari koduyla, en son tam unvanla eşleştirilir."),
            new("date", "İşlem tarihi", "date", true, ["TARIH", "ISLEMTARIHI", "FISTARIHI", "DATE"]),
            new("kind", "Borç / Alacak", "line_kind", true, ["BA", "BORCALACAK", "TUR", "TIP"]),
            new("description", "Açıklama", "text", true, ["ACIKLAMA", "DESCRIPTION", "ISLEM"]),
            new("amount", "Tutar", "decimal", true, ["TUTAR", "MEBLAG", "AMOUNT"]),
            new("payment_method", "Tahsilat yöntemi (alacak satırları için)", "text", false, ["ODEMETIPI", "ODEME", "KASA", "BANKA"],
                "Alacak (tahsilat) satırlarında zorunludur; kaynakta yoksa sabit bir ödeme tipi seçin."),
            new("reference", "Belge / fiş no", "text", false, ["BELGENO", "FISNO", "EVRAKNO", "FATURANO", "REFERANS"]),
            new("source_id", "Eski sistem kayıt no", "text", false, ["ID", "KAYITNO", "HAREKETNO", "SIRANO"]),
        ],
    };

    static TargetField[] AccountFields(bool agency) =>
    [
        new("code", "Kod", "text", false, ["KOD", "CARIKOD", "CARIKODU", "CODE"]),
        new("name", "Unvan", "text", true, ["UNVAN", "FIRMA", "FIRMAADI", "ACENTE", "ACENTEADI", "AD", "NAME", "COMPANYNAME"]),
        new("tax_office", "Vergi dairesi", "text", false, ["VERGIDAIRESI", "VD", "TAXOFFICE"]),
        new("tax_number", "Vergi no", "text", false, ["VERGINO", "VKN", "TAXNUMBER", "VERGINUMARASI"]),
        new("address", "Adres", "text", false, ["ADRES", "ADDRESS"]),
        new("city", "Şehir", "text", false, ["SEHIR", "IL", "CITY"]),
        new("country", "Ülke", "country", false, ["ULKE", "COUNTRY"]),
        new("phone", "Telefon", "phone", false, ["TELEFON", "TEL", "PHONE"]),
        new("email", "E-posta", "email", false, ["EMAIL", "EPOSTA", "MAIL"]),
        new("contact_name", "Yetkili", "text", false, ["YETKILI", "ILGILI", "CONTACT"]),
        new("credit_limit", "Kredi limiti", "decimal", false, ["LIMIT", "KREDILIMIT", "CREDITLIMIT"]),
        agency
            ? new("commission_rate", "Komisyon %", "decimal", false, ["KOMISYON", "KOMISYONORANI", "COMMISSION"])
            : new("is_city_ledger", "Cari çalışma", "bool", false, ["CARI", "CITYLEDGER", "CARICALISMA"]),
        new("notes", "Notlar", "text", false, ["NOT", "NOTLAR", "ACIKLAMA", "NOTES"]),
        new("source_id", "Eski sistem kayıt no", "text", false, SourceId),
    ];

    public static TargetField[] Fields(string entity) => Entities.TryGetValue(entity, out var f) ? f : throw PmsException.Validation("Geçersiz aktarım türü.");

    /// <summary>Başlık adını karşılaştırma için normalize eder: Türkçe harf katlama, yalnız harf/rakam, büyük harf.</summary>
    public static string NormalizeHeader(string s)
    {
        var map = new Dictionary<char, char> { ['ç'] = 'C', ['Ç'] = 'C', ['ğ'] = 'G', ['Ğ'] = 'G', ['ı'] = 'I', ['İ'] = 'I', ['ö'] = 'O', ['Ö'] = 'O', ['ş'] = 'S', ['Ş'] = 'S', ['ü'] = 'U', ['Ü'] = 'U' };
        var sb = new StringBuilder();
        foreach (var ch in TurkishEncoding.FixMojibake(s))
        {
            var c = map.TryGetValue(ch, out var m) ? m : ch;
            if (char.IsAsciiLetterOrDigit(c)) sb.Append(char.ToUpperInvariant(c));
        }
        return sb.ToString();
    }

    /// <summary>Önerilen eşleştirme; kesin kabul edilmez, kullanıcı ekranında onaylanır.</summary>
    public static IReadOnlyList<MappingSuggestion> Suggest(string entity, IReadOnlyList<string> columns)
    {
        var normalized = columns.Select(c => (Col: c, N: NormalizeHeader(c))).ToList();
        var used = new HashSet<string>();
        var result = new List<MappingSuggestion>();
        foreach (var f in Fields(entity))
        {
            var keyN = NormalizeHeader(f.Key);
            var labelN = NormalizeHeader(f.Label);  // PMS şablonundaki Türkçe başlık
            var exact = normalized.FirstOrDefault(c => !used.Contains(c.Col) && (c.N == keyN || c.N == labelN || f.Synonyms.Contains(c.N)));
            if (exact.Col is not null)
            {
                used.Add(exact.Col);
                result.Add(new(f.Key, exact.Col, c_confidence(exact.N == keyN || exact.N == labelN || f.Synonyms.Take(2).Contains(exact.N))));
                continue;
            }
            var partial = normalized.FirstOrDefault(c => !used.Contains(c.Col) && c.N.Length >= 3 && f.Synonyms.Any(s => s.Length >= 4 && (c.N.StartsWith(s) || s.StartsWith(c.N))));
            if (partial.Col is not null)
            {
                used.Add(partial.Col);
                result.Add(new(f.Key, partial.Col, 50));
            }
            else result.Add(new(f.Key, null, 0));
        }
        return result;

        static int c_confidence(bool strong) => strong ? 95 : 80;
    }
}

/// <summary>Kaynak değer → hedef değer dönüşümü. Hata durumunda istisna mesajı satır hatası olarak raporlanır.</summary>
public static class Transform
{
    static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    public static string? Apply(string? raw, string transform, string? format, string type)
    {
        var v = raw?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (transform == "fix_encoding") v = TurkishEncoding.FixMojibake(v);
        v = transform switch
        {
            "upper" => v.ToUpper(Tr),
            "lower" => v.ToLower(Tr),
            "title" => Validate.TitleCaseTr(v),
            "split_first" => SplitName(v).First,
            "split_last" => SplitName(v).Last,
            _ => v,
        };
        return type switch
        {
            "date" => ParseDate(v, format).ToString("yyyy-MM-dd"),
            "decimal" => ParseDecimal(v, format).ToString(CultureInfo.InvariantCulture),
            "int" => ParseInt(v).ToString(CultureInfo.InvariantCulture),
            "bool" => ParseBool(v) ? "true" : "false",
            "gender" => ParseGender(v),
            "country" => ParseCountry(v),
            "phone" => v,
            "email" => v.ToLowerInvariant(),
            "code" => v.ToUpperInvariant().Replace(' ', '-'),
            "res_status" => ParseReservationStatus(v),
            "meal_plan" => ParseMealPlan(v),
            "line_kind" => ParseLineKind(v),
            "account_kind" => MappingCatalog.NormalizeHeader(v) switch
            {
                "SIRKET" or "FIRMA" or "COMPANY" or "S" or "MUSTERI" => "company",
                "ACENTE" or "ACENTA" or "AGENCY" or "A" or "TOUROPERATOR" => "agency",
                _ => throw new FormatException($"Cari türü tanınmadı: '{v}' (Şirket veya Acente)"),
            },
            _ => v,
        };
    }

    public static (string First, string Last) SplitName(string full)
    {
        var parts = full.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 1) return (parts[0], parts[0]);
        return (string.Join(' ', parts[..^1]), parts[^1]);
    }

    static readonly string[] DateFormats = ["dd.MM.yyyy", "d.M.yyyy", "dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd", "yyyy.MM.dd", "dd-MM-yyyy",
        "dd.MM.yyyy HH:mm:ss", "dd.MM.yyyy HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-ddTHH:mm:ss", "dd.MM.yy", "yyyyMMdd"];

    public static DateOnly ParseDate(string v, string? format)
    {
        if (format == "excel_serial" || (format is null or "auto" && double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var serial) && serial is > 10000 and < 80000 && !v.Contains('.')))
        {
            var s = double.Parse(v, CultureInfo.InvariantCulture);
            return DateOnly.FromDateTime(DateTime.FromOADate(s));
        }
        var formats = format is { Length: > 0 } f && f != "auto" ? [f] : DateFormats;
        if (format == "MM/dd/yyyy") formats = ["MM/dd/yyyy", "M/d/yyyy"];
        if (DateTime.TryParseExact(v, formats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var dt))
        {
            if (dt.Year < 1900 || dt.Year > 2100) throw new FormatException($"Tarih aralık dışında: {v}");
            return DateOnly.FromDateTime(dt);
        }
        throw new FormatException($"Tarih okunamadı: '{v}'" + (format is null or "auto" ? " (tarih biçimini seçin)" : $" (beklenen {format})"));
    }

    /// <summary>tr: 1.234,56 · en: 1,234.56 · auto: son ayırıcıya göre karar verir.</summary>
    public static decimal ParseDecimal(string v, string? format)
    {
        var s = v.Replace(" ", "").Replace("₺", "").Replace("TL", "", StringComparison.OrdinalIgnoreCase).Replace("TRY", "", StringComparison.OrdinalIgnoreCase);
        if (format == "tr" || (format is null or "auto" && s.LastIndexOf(',') > s.LastIndexOf('.')))
            s = s.Replace(".", "").Replace(',', '.');
        else
            s = s.Replace(",", "");
        if (decimal.TryParse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var d))
            return decimal.Round(d, 2, MidpointRounding.AwayFromZero);
        throw new FormatException($"Sayı okunamadı: '{v}'");
    }

    static int ParseInt(string v) => int.TryParse(v.Split(',', '.')[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)
        ? n : throw new FormatException($"Tam sayı okunamadı: '{v}'");

    public static bool ParseBool(string v) => MappingCatalog.NormalizeHeader(v) switch
    {
        "1" or "E" or "EVET" or "Y" or "YES" or "TRUE" or "X" or "VAR" or "T" => true,
        "0" or "H" or "HAYIR" or "N" or "NO" or "FALSE" or "YOK" or "F" or "" => false,
        _ => throw new FormatException($"Evet/Hayır değeri okunamadı: '{v}'"),
    };

    public static string? ParseGender(string v) => MappingCatalog.NormalizeHeader(v) switch
    {
        "E" or "ERKEK" or "BAY" or "M" or "MALE" or "MR" or "1" => "male",
        "K" or "KADIN" or "BAYAN" or "F" or "FEMALE" or "MRS" or "MS" or "2" => "female",
        "D" or "DIGER" or "OTHER" or "X" => "other",
        _ => throw new FormatException($"Cinsiyet değeri tanınmadı: '{v}'"),
    };

    static readonly Dictionary<string, string> Countries = new()
    {
        ["TURKIYE"] = "TR", ["TURKEY"] = "TR", ["TC"] = "TR", ["TUR"] = "TR", ["TURK"] = "TR", ["TURKIYECUMHURIYETI"] = "TR",
        ["ALMANYA"] = "DE", ["GERMANY"] = "DE", ["DEU"] = "DE", ["RUSYA"] = "RU", ["RUSSIA"] = "RU", ["RUS"] = "RU", ["INGILTERE"] = "GB",
        ["BIRLESIKKRALLIK"] = "GB", ["UNITEDKINGDOM"] = "GB", ["UK"] = "GB", ["GBR"] = "GB", ["HOLLANDA"] = "NL", ["NETHERLANDS"] = "NL", ["NLD"] = "NL",
        ["FRANSA"] = "FR", ["FRANCE"] = "FR", ["FRA"] = "FR", ["AMERIKA"] = "US", ["ABD"] = "US", ["USA"] = "US", ["UNITEDSTATES"] = "US",
        ["UKRAYNA"] = "UA", ["UKRAINE"] = "UA", ["UKR"] = "UA", ["IRAN"] = "IR", ["IRN"] = "IR", ["AZERBAYCAN"] = "AZ", ["AZERBAIJAN"] = "AZ", ["AZE"] = "AZ",
        ["BELCIKA"] = "BE", ["BELGIUM"] = "BE", ["AVUSTURYA"] = "AT", ["AUSTRIA"] = "AT", ["ISVICRE"] = "CH", ["SWITZERLAND"] = "CH", ["ITALYA"] = "IT",
        ["ITALY"] = "IT", ["ISPANYA"] = "ES", ["SPAIN"] = "ES", ["POLONYA"] = "PL", ["POLAND"] = "PL", ["ISVEC"] = "SE", ["SWEDEN"] = "SE",
        ["NORVEC"] = "NO", ["NORWAY"] = "NO", ["DANIMARKA"] = "DK", ["DENMARK"] = "DK", ["YUNANISTAN"] = "GR", ["GREECE"] = "GR", ["BULGARISTAN"] = "BG",
        ["BULGARIA"] = "BG", ["GURCISTAN"] = "GE", ["GEORGIA"] = "GE", ["KAZAKISTAN"] = "KZ", ["KAZAKHSTAN"] = "KZ", ["ISRAIL"] = "IL", ["ISRAEL"] = "IL",
        ["IRAK"] = "IQ", ["IRAQ"] = "IQ", ["SURIYE"] = "SY", ["SYRIA"] = "SY", ["SUUDIARABISTAN"] = "SA", ["SAUDIARABIA"] = "SA", ["KKTC"] = "CY",
    };

    public static string ParseCountry(string v)
    {
        var n = MappingCatalog.NormalizeHeader(v);
        if (n.Length == 2 && n.All(char.IsAsciiLetter)) return n;
        if (Countries.TryGetValue(n, out var c)) return c;
        throw new FormatException($"Ülke tanınmadı: '{v}' (ISO 2 harfli kod kullanın, ör. TR)");
    }

    static string ParseReservationStatus(string v) => MappingCatalog.NormalizeHeader(v) switch
    {
        "ONAYLI" or "KESIN" or "CONFIRMED" or "OK" or "AKTIF" or "REZERVASYON" => "confirmed",
        "OPSIYON" or "OPSIYONLU" or "TENTATIVE" or "OPTION" => "tentative",
        "CIKIS" or "CIKISYAPTI" or "CHECKEDOUT" or "CHECKOUT" or "AYRILDI" or "KAPANDI" or "TAMAMLANDI" => "checked_out",
        "IPTAL" or "CANCELLED" or "CANCELED" or "CANCEL" => "cancelled",
        "NOSHOW" or "GELMEDI" or "NS" => "no_show",
        "KONAKLIYOR" or "INHOUSE" or "CHECKEDIN" or "GIRISYAPTI" => "checked_in",
        _ => throw new FormatException($"Rezervasyon durumu tanınmadı: '{v}'"),
    };

    static string ParseMealPlan(string v) => MappingCatalog.NormalizeHeader(v) switch
    {
        "RO" or "SO" or "ODAKAHVALTISIZ" or "SADECEODA" or "ROOMONLY" => "RO",
        "BB" or "OK" or "ODAKAHVALTI" or "BEDBREAKFAST" => "BB",
        "HB" or "YP" or "YARIMPANSIYON" or "HALFBOARD" => "HB",
        "FB" or "TP" or "TAMPANSIYON" or "FULLBOARD" => "FB",
        "AI" or "HD" or "HERSEYDAHIL" or "ALLINCLUSIVE" => "AI",
        "UAI" or "UHD" or "ULTRAHERSEYDAHIL" => "UAI",
        _ => throw new FormatException($"Pansiyon tipi tanınmadı: '{v}'"),
    };

    static string ParseLineKind(string v) => MappingCatalog.NormalizeHeader(v) switch
    {
        "B" or "BORC" or "MASRAF" or "CHARGE" or "DEBIT" or "D" => "charge",
        "A" or "ALACAK" or "ODEME" or "TAHSILAT" or "PAYMENT" or "CREDIT" or "C" => "payment",
        _ => throw new FormatException($"İşlem türü tanınmadı (borç/ödeme): '{v}'"),
    };
}
