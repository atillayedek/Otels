using System.Globalization;
using System.IO.Compression;
using System.Security;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using HotelPms.Server.Auth;
using HotelPms.Server.Infrastructure;

namespace HotelPms.Server.Modules.Reports;

/// <summary>
/// Polis (Emniyet KBS) "Toplu Konaklayan Ekle" Excel'i. KBS'nin örnek şablonu (Resources/KbsTopluKonaklayan.xlsx) aynen kullanılır;
/// yalnız "Örnek Liste" sayfasının satırları konaklayan kişilerle doldurulur, "Ülke Kodları" sayfası değişmez.
/// Sütunlar: TC KimlikNo · GecerliBelge · Adi · Soyadi · Dogum Tarihi · Cinsiyet · Cep Telefonu · Arac Plaka · VerilenOda · Uyruğu (KBS ülke kodu).
/// </summary>
public static class KbsExcel
{
    /// <summary>ISO 3166 alfa-2 → KBS ülke kodu (şablonun "Ülke Kodları" sayfası). KKTC'nin (2) ISO kodu yoktur; bu misafirlerin uyruğu dosyada elle seçilir.</summary>
    public static readonly IReadOnlyDictionary<string, int> CountryCodes = new Dictionary<string, int>
    {
        ["AD"] = 7, ["AE"] = 227, ["AF"] = 3, ["AG"] = 11, ["AI"] = 9, ["AL"] = 4, ["AM"] = 13, ["AO"] = 8, ["AQ"] = 10, ["AR"] = 12,
        ["AS"] = 6, ["AT"] = 16, ["AU"] = 15, ["AW"] = 14, ["AZ"] = 17, ["BA"] = 29, ["BB"] = 21, ["BD"] = 20, ["BE"] = 23, ["BF"] = 36,
        ["BG"] = 35, ["BH"] = 19, ["BI"] = 37, ["BJ"] = 25, ["BM"] = 26, ["BN"] = 34, ["BO"] = 28, ["BR"] = 32, ["BS"] = 18, ["BT"] = 27,
        ["BV"] = 31, ["BW"] = 30, ["BY"] = 22, ["BZ"] = 24, ["CA"] = 40, ["CC"] = 48, ["CD"] = 52, ["CF"] = 43, ["CG"] = 51, ["CH"] = 210,
        ["CI"] = 55, ["CK"] = 53, ["CL"] = 45, ["CM"] = 39, ["CN"] = 46, ["CO"] = 49, ["CR"] = 54, ["CU"] = 57, ["CV"] = 41, ["CX"] = 47,
        ["CY"] = 58, ["CZ"] = 59, ["DE"] = 82, ["DJ"] = 61, ["DK"] = 60, ["DM"] = 62, ["DO"] = 63, ["DZ"] = 5, ["EC"] = 64, ["EE"] = 69,
        ["EG"] = 65, ["EH"] = 240, ["ER"] = 68, ["ES"] = 203, ["ET"] = 70, ["FI"] = 74, ["FJ"] = 73, ["FK"] = 72, ["FM"] = 142, ["FO"] = 71,
        ["FR"] = 75, ["GA"] = 79, ["GB"] = 228, ["GD"] = 87, ["GE"] = 81, ["GF"] = 76, ["GG"] = 91, ["GH"] = 83, ["GI"] = 84, ["GL"] = 86,
        ["GM"] = 80, ["GN"] = 92, ["GP"] = 88, ["GQ"] = 67, ["GR"] = 85, ["GS"] = 202, ["GT"] = 90, ["GU"] = 89, ["GW"] = 93, ["GY"] = 94,
        ["HK"] = 98, ["HM"] = 96, ["HN"] = 97, ["HR"] = 56, ["HT"] = 95, ["HU"] = 99, ["ID"] = 102, ["IE"] = 105, ["IL"] = 106, ["IN"] = 101,
        ["IO"] = 33, ["IQ"] = 104, ["IR"] = 103, ["IS"] = 100, ["IT"] = 107, ["JE"] = 110, ["JM"] = 108, ["JO"] = 111, ["JP"] = 109, ["KE"] = 113,
        ["KG"] = 118, ["KH"] = 38, ["KI"] = 114, ["KM"] = 50, ["KN"] = 183, ["KP"] = 115, ["KR"] = 116, ["KW"] = 117, ["KY"] = 42, ["KZ"] = 112,
        ["LA"] = 119, ["LB"] = 121, ["LC"] = 184, ["LI"] = 125, ["LK"] = 204, ["LR"] = 123, ["LS"] = 122, ["LT"] = 126, ["LU"] = 127, ["LV"] = 120,
        ["LY"] = 124, ["MA"] = 147, ["MC"] = 144, ["MD"] = 143, ["ME"] = 192, ["MG"] = 130, ["MH"] = 136, ["MK"] = 129, ["ML"] = 134, ["MM"] = 149,
        ["MN"] = 145, ["MO"] = 128, ["MP"] = 162, ["MQ"] = 137, ["MR"] = 138, ["MS"] = 146, ["MT"] = 135, ["MU"] = 139, ["MV"] = 133, ["MW"] = 131,
        ["MX"] = 141, ["MY"] = 132, ["MZ"] = 148, ["NA"] = 150, ["NC"] = 155, ["NE"] = 158, ["NF"] = 161, ["NG"] = 159, ["NI"] = 157, ["NL"] = 153,
        ["NO"] = 163, ["NP"] = 152, ["NR"] = 151, ["NU"] = 160, ["NZ"] = 156, ["OM"] = 164, ["PA"] = 168, ["PE"] = 171, ["PF"] = 77, ["PG"] = 169,
        ["PH"] = 172, ["PK"] = 165, ["PL"] = 174, ["PM"] = 185, ["PN"] = 173, ["PR"] = 176, ["PS"] = 167, ["PT"] = 175, ["PW"] = 166, ["PY"] = 170,
        ["QA"] = 177, ["RE"] = 178, ["RO"] = 179, ["RS"] = 192, ["RU"] = 180, ["RW"] = 181, ["SA"] = 190, ["SB"] = 198, ["SC"] = 193, ["SD"] = 205,
        ["SE"] = 209, ["SG"] = 195, ["SH"] = 182, ["SI"] = 197, ["SJ"] = 207, ["SK"] = 196, ["SL"] = 194, ["SM"] = 188, ["SN"] = 191, ["SO"] = 199,
        ["SR"] = 206, ["ST"] = 189, ["SV"] = 66, ["SY"] = 211, ["SZ"] = 208, ["TC"] = 223, ["TD"] = 44, ["TF"] = 78, ["TG"] = 217, ["TH"] = 215,
        ["TJ"] = 213, ["TK"] = 218, ["TL"] = 216, ["TM"] = 222, ["TN"] = 221, ["TO"] = 219, ["TR"] = 1, ["TT"] = 220, ["TV"] = 224, ["TW"] = 212,
        ["TZ"] = 214, ["UA"] = 226, ["UG"] = 225, ["UM"] = 230, ["US"] = 229, ["UY"] = 231, ["UZ"] = 232, ["VA"] = 234, ["VC"] = 186, ["VE"] = 235,
        ["VG"] = 237, ["VI"] = 238, ["VN"] = 236, ["VU"] = 233, ["WF"] = 239, ["WS"] = 187, ["XK"] = 244, ["YE"] = 241, ["YT"] = 140, ["ZA"] = 200,
        ["ZM"] = 242, ["ZW"] = 243,
    };

    public static readonly string ReportSql = $"""
        WITH kbs(iso, code) AS (VALUES {string.Join(", ", CountryCodes.Select(kv => $"('{kv.Key}', {kv.Value})"))}),
        people AS (
            SELECT rm.sort_order, rm.number AS room, g.*, 0 AS ord
            FROM pms.reservations r JOIN pms.rooms rm ON rm.id = r.room_id JOIN pms.guests g ON g.id = r.guest_id
            WHERE (@arrival::date IS NULL AND r.status = 'checked_in') OR (r.arrival = @arrival::date AND r.status IN ('checked_in', 'checked_out'))
            UNION ALL
            SELECT rm.sort_order, rm.number, g.*, 1
            FROM pms.reservations r JOIN pms.rooms rm ON rm.id = r.room_id
            JOIN pms.reservation_guests rg ON rg.reservation_id = r.id AND rg.guest_id <> r.guest_id JOIN pms.guests g ON g.id = rg.guest_id
            WHERE (@arrival::date IS NULL AND r.status = 'checked_in') OR (r.arrival = @arrival::date AND r.status IN ('checked_in', 'checked_out'))
        )
        SELECT p.room, CASE WHEN p.identity_type = 'tckn' THEN p.identity_number END AS tckn,
               CASE WHEN COALESCE(p.identity_type, '') <> 'tckn' THEN p.identity_number END AS document_no,
               p.first_name, p.last_name, p.birth_date,
               CASE p.gender WHEN 'male' THEN 'Erkek' WHEN 'female' THEN 'Kadın' END AS gender,
               p.phone, p.vehicle_plate AS plate, p.nationality::text AS nationality, k.code AS kbs_country,
               NULLIF(concat_ws(', ',
                   CASE WHEN COALESCE(btrim(p.identity_number), '') = '' THEN 'kimlik/belge no' END,
                   CASE WHEN p.birth_date IS NULL THEN 'doğum tarihi' END,
                   CASE WHEN p.gender IS NULL OR p.gender NOT IN ('male', 'female') THEN 'cinsiyet' END,
                   CASE WHEN k.code IS NULL THEN 'uyruk' END), '') AS missing
        FROM people p LEFT JOIN kbs k ON k.iso = p.nationality::text
        WHERE p.anonymized_at IS NULL
        ORDER BY p.sort_order, p.room, p.ord, p.last_name
        """;

    public static ReportDefinition Definition => new()
    {
        Name = "kbs-guests", Title = "Polis Konaklama Listesi (KBS Excel)", Category = "Misafir", Permission = "kbs.manage",
        Params = [new("arrival", "Giriş tarihi (boş: şu an konaklayanlar)", "date", false)],
        Columns = [new("room", "Oda", "text"), new("tckn", "T.C. Kimlik No", "text"), new("documentNo", "Belge No", "text"), new("firstName", "Adı", "text"),
            new("lastName", "Soyadı", "text"), new("birthDate", "Doğum Tarihi", "date"), new("gender", "Cinsiyet", "text"), new("phone", "Cep Telefonu", "text"),
            new("plate", "Araç Plaka", "text"), new("nationality", "Uyruk", "text"), new("kbsCountry", "KBS Ülke Kodu", "int"), new("missing", "Eksik bilgi", "text")],
        Sql = ReportSql,
    };

    public static void Map(RouteGroupBuilder g)
    {
        // Polis Excel'i: KBS şablonu doldurulur. Kimlik numaraları maskesiz yazıldığı için kimlik görme yetkisi de gerekir.
        g.MapGet("/kbs-guests/police-xlsx", async (HttpRequest req, Db db, RequestContext ctx) =>
        {
            var def = ReportEndpoints.Definitions.First(d => d.Name == "kbs-guests");
            var result = await ReportEndpoints.RunAsync(def, req.Query, db);
            var bytes = Build(result.Rows);
            await using (var c = await db.OpenAsync())
                await c.ExecuteAsync("INSERT INTO pms.audit_log (user_id, username, device_id, ip, action, entity_type, entity_id, reason) VALUES (@u, @n, @d, @ip::inet, 'report.export', 'report', 'kbs-guests.police-xlsx', @reason)",
                    new { u = ctx.User!.Id, n = ctx.User.Username, d = ctx.DeviceId, ip = ctx.Ip?.ToString(), reason = $"{result.Rows.Count} kişi" });
            return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"KBS-Toplu-Konaklayan-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
        }).RequirePermission("kbs.manage").RequirePermission("guest.identity.view");
    }

    /// <summary>
    /// KBS şablonunun kendisi kopyalanır; yalnız "Örnek Liste" sayfasının satır bölümü (başlık satırı aynen kalır) ve ortak metin listesi
    /// güncellenir. Biçimler, ülke kodları sayfası ve dosyanın iç düzeni şablonla birebir aynı kalır (KBS'nin dosyayı tanıması için).
    /// Hücre biçimleri şablonun örnek satırındakilerdir: TC, belge no ve uyruk sayı (s=7), diğerleri metin (s=8).
    /// </summary>
    public static byte[] Build(IReadOnlyList<IDictionary<string, object?>> rows)
    {
        using var template = typeof(KbsExcel).Assembly.GetManifestResourceStream("KbsTopluKonaklayan.xlsx")
            ?? throw new InvalidOperationException("KBS şablonu sunucu paketinde bulunamadı.");
        using var src = new MemoryStream();
        template.CopyTo(src);
        using var zin = new ZipArchive(new MemoryStream(src.ToArray()), ZipArchiveMode.Read);
        string Read(string name)
        {
            using var s = (zin.GetEntry(name) ?? throw new InvalidOperationException($"KBS şablonunda {name} yok.")).Open();
            using var rd = new StreamReader(s, new UTF8Encoding(false));
            return rd.ReadToEnd();
        }
        var sheet = Read("xl/worksheets/sheet1.xml");
        var sst = Read("xl/sharedStrings.xml");
        var header = Regex.Match(sheet, @"<row r=""1""[\s\S]*?</row>").Value;
        if (header.Length == 0) throw new InvalidOperationException("KBS şablonunun başlık satırı okunamadı.");

        var existing = Regex.Matches(sst, @"<si[\s>]").Count;
        var added = new List<string>();
        var tr = new CultureInfo("tr-TR");
        var data = new StringBuilder(header);
        var r = 2;
        foreach (var p in rows)
        {
            string? S(string k) => p.TryGetValue(k, out var v) && v is not null && v.ToString() is { Length: > 0 } s ? s.Trim() : null;
            var tc = S("tckn");
            var doc = S("documentNo");
            var cells = new object?[]
            {
                tc is { Length: 11 } && tc.All(char.IsAsciiDigit) ? long.Parse(tc, CultureInfo.InvariantCulture) : null,
                tc is not null ? 0L : NumberOrText(doc),
                S("firstName")?.ToUpper(tr), S("lastName")?.ToUpper(tr),
                p.TryGetValue("birthDate", out var bd) && bd is DateOnly d ? d.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture) : null,
                S("gender"), Phone(S("phone")), S("plate")?.ToUpperInvariant().Replace(" ", ""), S("room"),
                p.TryGetValue("kbsCountry", out var kc) && kc is not null ? Convert.ToInt64(kc, CultureInfo.InvariantCulture) : null,
            };
            data.Append($"<row r=\"{r}\" spans=\"1:10\" s=\"2\" customFormat=\"1\" ht=\"14.25\" x14ac:dyDescent=\"0.2\">");
            for (var i = 0; i < cells.Length; i++)
            {
                var refName = $"{(char)('A' + i)}{r}";
                var numericColumn = i is 0 or 1 or 9;
                switch (cells[i])
                {
                    case long n:
                        data.Append($"<c r=\"{refName}\" s=\"7\"><v>{n.ToString(CultureInfo.InvariantCulture)}</v></c>");
                        break;
                    case string s:
                        added.Add(s);
                        data.Append($"<c r=\"{refName}\" s=\"{(numericColumn ? 7 : 8)}\" t=\"s\"><v>{existing + added.Count - 1}</v></c>");
                        break;
                    default:
                        data.Append($"<c r=\"{refName}\" s=\"{(numericColumn ? 7 : 8)}\"/>");
                        break;
                }
            }
            data.Append("</row>");
            r++;
        }

        sheet = Regex.Replace(sheet, @"<sheetData>[\s\S]*?</sheetData>", _ => $"<sheetData>{data}</sheetData>");
        sheet = Regex.Replace(sheet, @"<dimension ref=""[^""]*""/>", $"<dimension ref=\"A1:J{Math.Max(1, r - 1)}\"/>");
        if (added.Count > 0)
        {
            var extra = string.Concat(added.Select(s => $"<si><t xml:space=\"preserve\">{SecurityElement.Escape(s)}</t></si>"));
            sst = sst.Replace("</sst>", extra + "</sst>");
            sst = Regex.Replace(sst, @"(<sst\b[^>]*\bcount="")(\d+)", m => m.Groups[1].Value + (int.Parse(m.Groups[2].Value) + added.Count));
            sst = Regex.Replace(sst, @"(<sst\b[^>]*\buniqueCount="")(\d+)", m => m.Groups[1].Value + (int.Parse(m.Groups[2].Value) + added.Count));
        }

        using var outMs = new MemoryStream();
        using (var zout = new ZipArchive(outMs, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var e in zin.Entries)
            {
                var ne = zout.CreateEntry(e.FullName, CompressionLevel.Optimal);
                ne.LastWriteTime = e.LastWriteTime;
                using var w = ne.Open();
                if (e.FullName == "xl/worksheets/sheet1.xml" || e.FullName == "xl/sharedStrings.xml")
                {
                    var bytes = new UTF8Encoding(false).GetBytes(e.FullName == "xl/sharedStrings.xml" ? sst : sheet);
                    w.Write(bytes);
                }
                else { using var s = e.Open(); s.CopyTo(w); }
            }
        }
        return outMs.ToArray();
    }

    /// <summary>Belge numarası yalnız rakamsa (şablondaki gibi) sayı, harf içeriyorsa (pasaport) metin olarak yazılır.</summary>
    static object? NumberOrText(string? v) =>
        v is null ? null : v.Length is > 0 and <= 15 && v.All(char.IsAsciiDigit) ? long.Parse(v, CultureInfo.InvariantCulture) : v.ToUpperInvariant();

    /// <summary>Türkiye cep numarası şablondaki gibi "5XX XXX XX XX"; diğer numaralar olduğu gibi.</summary>
    static string? Phone(string? v)
    {
        if (v is null) return null;
        var digits = new string(v.Where(char.IsAsciiDigit).ToArray());
        if (digits.StartsWith("90") && digits.Length == 12) digits = digits[2..];
        if (digits.StartsWith('0') && digits.Length == 11) digits = digits[1..];
        return digits.Length == 10 && digits[0] == '5' ? $"{digits[..3]} {digits[3..6]} {digits[6..8]} {digits[8..]}" : v;
    }
}
