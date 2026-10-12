using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Xml;
using ExcelDataReader;
using HotelPms.Server.Infrastructure;
using Microsoft.Win32;

namespace HotelPms.Server.Modules.Migration;

public sealed record SourceOptions
{
    public string? Table { get; init; }
    public int HeaderRow { get; init; } = 1;
    public string? Encoding { get; init; }
    public string? Separator { get; init; }
    public string? XmlRecordElement { get; init; }
}

public sealed record SourceTable(string Name, long? RowCount);

public sealed record SourceInspection(IReadOnlyList<SourceTable> Tables, string? SelectedTable, IReadOnlyList<string> Columns,
    IReadOnlyList<string?[]> Preview, string? DetectedEncoding, string? DetectedSeparator, IReadOnlyList<string> Warnings, int MojibakeCells);

/// <summary>Kaynak satırlarını sütun adı → metin değer olarak üretir. Kaynak asla değiştirilmez.</summary>
public interface ISourceReader : IDisposable
{
    IReadOnlyList<SourceTable> ListTables();
    (IReadOnlyList<string> Columns, IEnumerable<string?[]> Rows) Read(SourceOptions options, int? limit = null);
    string? DetectedEncoding => null;
    string? DetectedSeparator => null;
}

public static class TurkishEncoding
{
    static TurkishEncoding() => System.Text.Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    public static void Register() { }

    public static Encoding Get(string name) => name.ToLowerInvariant() switch
    {
        "utf-8" or "utf8" => new UTF8Encoding(false, false),
        "windows-1254" or "cp1254" => System.Text.Encoding.GetEncoding(1254),
        "iso-8859-9" or "latin5" => System.Text.Encoding.GetEncoding(28599),
        "utf-16" => System.Text.Encoding.Unicode,
        _ => throw PmsException.Validation("Desteklenmeyen karakter kodlaması: " + name),
    };

    /// <summary>BOM → UTF; geçerli UTF-8 → UTF-8; aksi halde Türkçe ANSI (Windows-1254).</summary>
    public static string Detect(byte[] sample)
    {
        if (sample.Length >= 3 && sample[0] == 0xEF && sample[1] == 0xBB && sample[2] == 0xBF) return "utf-8";
        if (sample.Length >= 2 && sample[0] == 0xFF && sample[1] == 0xFE) return "utf-16";
        try
        {
            new UTF8Encoding(false, true).GetString(sample, 0, TrimIncompleteUtf8(sample));
            return "utf-8";
        }
        catch (DecoderFallbackException) { return "windows-1254"; }
    }

    static int TrimIncompleteUtf8(byte[] b)
    {
        var n = b.Length;
        for (var i = 1; i <= 3 && n - i >= 0; i++)
        {
            var c = b[n - i];
            if ((c & 0xC0) == 0xC0) return n - i;
            if ((c & 0x80) == 0) break;
        }
        return n;
    }

    static readonly string[] MojibakeMarkers = ["Ã¼", "Ã§", "Ã¶", "Ä±", "ÄŸ", "Åž", "ÅŸ", "Ã‡", "Ã–", "Ãœ", "Ä°", "Äž"];

    /// <summary>UTF-8 metnin Latin-1/1252 olarak yanlış çözülmesiyle oluşan bozulma (ör. "Ã¼" → "ü").</summary>
    public static bool LooksMojibake(string? s) => s is not null && MojibakeMarkers.Any(s.Contains);

    public static string FixMojibake(string s)
    {
        if (!LooksMojibake(s)) return s;
        try
        {
            var bytes = System.Text.Encoding.GetEncoding(1252).GetBytes(s);
            var fixedText = new UTF8Encoding(false, true).GetString(bytes);
            return fixedText;
        }
        catch (DecoderFallbackException) { return s; }
    }
}

// ------------------------------------------------------------------------------------------------ CSV
public sealed class CsvSource(string path) : ISourceReader
{
    string? _encoding;
    string? _separator;
    public string? DetectedEncoding => _encoding;
    public string? DetectedSeparator => _separator;

    public IReadOnlyList<SourceTable> ListTables() => [new(Path.GetFileName(path), null)];

    public (IReadOnlyList<string> Columns, IEnumerable<string?[]> Rows) Read(SourceOptions o, int? limit = null)
    {
        var sample = new byte[Math.Min(256 * 1024, new FileInfo(path).Length)];
        using (var fs = File.OpenRead(path)) _ = fs.Read(sample, 0, sample.Length);
        _encoding = o.Encoding ?? TurkishEncoding.Detect(sample);
        var enc = TurkishEncoding.Get(_encoding);
        var text = enc.GetString(sample);
        _separator = o.Separator is { Length: > 0 } s ? (s == "\\t" ? "\t" : s) : DetectSeparator(text);
        var sep = _separator[0];

        var all = Parse(path, enc, sep);
        var headerIndex = Math.Max(o.HeaderRow, 1) - 1;
        using var e = all.GetEnumerator();
        string?[]? header = null;
        for (var i = 0; i <= headerIndex && e.MoveNext(); i++) header = e.Current;
        if (header is null) throw PmsException.Validation("Dosyada başlık satırı bulunamadı.");
        var columns = UniqueColumns(header);
        return (columns, Rows(all.Skip(headerIndex + 1), columns.Count, limit));
    }

    static IEnumerable<string?[]> Rows(IEnumerable<string?[]> src, int width, int? limit)
    {
        var n = 0;
        foreach (var r in src)
        {
            if (r.All(string.IsNullOrWhiteSpace)) continue;
            if (limit is { } l && n++ >= l) yield break;
            if (r.Length == width) yield return r;
            else
            {
                var fixedRow = new string?[width];
                Array.Copy(r, fixedRow, Math.Min(width, r.Length));
                yield return fixedRow;
            }
        }
    }

    /// <summary>İlk satırlarda tırnak dışındaki ayırıcıları sayar; satırlar arası en tutarlı ve en sık olanı seçer. Eşitlikte ';' (Türkiye Excel varsayılanı).</summary>
    public static string DetectSeparator(string text)
    {
        var lines = text.Split('\n').Take(20).Where(l => l.Trim().Length > 0).ToList();
        var candidates = new[] { ';', ',', '\t', '|' };
        var best = ';';
        var bestScore = -1.0;
        foreach (var c in candidates)
        {
            var counts = lines.Select(l => CountOutsideQuotes(l, c)).ToList();
            if (counts.Count == 0 || counts[0] == 0) continue;
            var consistent = counts.Count(x => x == counts[0]) / (double)counts.Count;
            var score = consistent * 1000 + counts[0] + (c == ';' ? 0.5 : 0);
            if (score > bestScore) { bestScore = score; best = c; }
        }
        return best.ToString();
    }

    static int CountOutsideQuotes(string line, char sep)
    {
        var n = 0;
        var q = false;
        foreach (var ch in line)
        {
            if (ch == '"') q = !q;
            else if (ch == sep && !q) n++;
        }
        return n;
    }

    /// <summary>RFC 4180: tırnaklı alan, "" kaçışı, alan içinde satır sonu.</summary>
    static IEnumerable<string?[]> Parse(string path, Encoding enc, char sep)
    {
        using var reader = new StreamReader(path, enc, detectEncodingFromByteOrderMarks: true);
        var fields = new List<string?>();
        var sb = new StringBuilder();
        var inQuotes = false;
        var fieldStarted = false;
        int ch;
        while ((ch = reader.Read()) != -1)
        {
            var c = (char)ch;
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (reader.Peek() == '"') { sb.Append('"'); reader.Read(); }
                    else inQuotes = false;
                }
                else sb.Append(c);
                continue;
            }
            if (c == '"' && !fieldStarted) { inQuotes = true; fieldStarted = true; continue; }
            if (c == sep) { fields.Add(sb.ToString()); sb.Clear(); fieldStarted = false; continue; }
            if (c == '\r') continue;
            if (c == '\n')
            {
                fields.Add(sb.ToString());
                sb.Clear();
                fieldStarted = false;
                yield return fields.ToArray();
                fields.Clear();
                continue;
            }
            sb.Append(c);
            fieldStarted = true;
        }
        if (sb.Length > 0 || fields.Count > 0)
        {
            fields.Add(sb.ToString());
            yield return fields.ToArray();
        }
    }

    public static List<string> UniqueColumns(string?[] header)
    {
        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var result = new List<string>();
        for (var i = 0; i < header.Length; i++)
        {
            var name = string.IsNullOrWhiteSpace(header[i]) ? $"Sütun{i + 1}" : header[i]!.Trim();
            if (seen.TryGetValue(name, out var count)) { seen[name] = count + 1; name = $"{name}_{count + 1}"; }
            else seen[name] = 1;
            result.Add(name);
        }
        return result;
    }

    public void Dispose() { }
}

// ------------------------------------------------------------------------------------------------ Excel
public sealed class ExcelSource : ISourceReader
{
    readonly DataSet _ds;

    public ExcelSource(string path)
    {
        TurkishEncoding.Register();
        using var fs = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            using var reader = ExcelReaderFactory.CreateReader(fs, new ExcelReaderConfiguration { FallbackEncoding = System.Text.Encoding.GetEncoding(1254) });
            _ds = reader.AsDataSet(new ExcelDataSetConfiguration { UseColumnDataType = false, ConfigureDataTable = _ => new ExcelDataTableConfiguration { UseHeaderRow = false } });
        }
        catch (Exception ex) when (ex is ExcelDataReader.Exceptions.HeaderException or InvalidDataException or IOException or NotSupportedException)
        {
            throw PmsException.Validation("Excel dosyası okunamadı. Dosya bozuk veya parola korumalı olabilir.");
        }
    }

    public IReadOnlyList<SourceTable> ListTables() => _ds.Tables.Cast<DataTable>().Select(t => new SourceTable(t.TableName, t.Rows.Count)).ToList();

    public (IReadOnlyList<string> Columns, IEnumerable<string?[]> Rows) Read(SourceOptions o, int? limit = null)
    {
        var table = (o.Table is null ? _ds.Tables.Cast<DataTable>().FirstOrDefault() : _ds.Tables[o.Table])
            ?? throw PmsException.Validation("Seçilen sayfa bulunamadı.");
        var headerIndex = Math.Max(o.HeaderRow, 1) - 1;
        if (table.Rows.Count <= headerIndex) throw PmsException.Validation("Sayfada başlık satırı bulunamadı.");
        var header = table.Rows[headerIndex].ItemArray.Select(Cell).ToArray();
        var cols = CsvSource.UniqueColumns(header);
        IEnumerable<string?[]> Rows()
        {
            var n = 0;
            for (var i = headerIndex + 1; i < table.Rows.Count; i++)
            {
                var vals = table.Rows[i].ItemArray.Select(Cell).Take(cols.Count).ToArray();
                if (vals.All(string.IsNullOrWhiteSpace)) continue;
                if (limit is { } l && n++ >= l) yield break;
                if (vals.Length < cols.Count) Array.Resize(ref vals, cols.Count);
                yield return vals;
            }
        }
        return (cols, Rows());
    }

    static string? Cell(object? v) => v switch
    {
        null or DBNull => null,
        DateTime dt => dt.TimeOfDay == TimeSpan.Zero ? dt.ToString("yyyy-MM-dd") : dt.ToString("yyyy-MM-dd HH:mm:ss"),
        double d => d.ToString("0.############", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString(),
    };

    public void Dispose() => _ds.Dispose();
}

// ------------------------------------------------------------------------------------------------ JSON
public sealed class JsonSource(string path) : ISourceReader
{
    readonly JsonDocument _doc = Load(path);

    static JsonDocument Load(string path)
    {
        try { return JsonDocument.Parse(File.ReadAllBytes(path), new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip }); }
        catch (JsonException) { throw PmsException.Validation("JSON dosyası geçersiz."); }
    }

    IEnumerable<(string Name, JsonElement Array)> Arrays()
    {
        if (_doc.RootElement.ValueKind == JsonValueKind.Array) yield return ("(kök)", _doc.RootElement);
        else if (_doc.RootElement.ValueKind == JsonValueKind.Object)
            foreach (var p in _doc.RootElement.EnumerateObject().Where(p => p.Value.ValueKind == JsonValueKind.Array))
                yield return (p.Name, p.Value);
    }

    public IReadOnlyList<SourceTable> ListTables() => Arrays().Select(a => new SourceTable(a.Name, a.Array.GetArrayLength())).ToList();

    public (IReadOnlyList<string> Columns, IEnumerable<string?[]> Rows) Read(SourceOptions o, int? limit = null)
    {
        var arr = Arrays().FirstOrDefault(a => o.Table is null || a.Name == o.Table);
        if (arr.Name is null) throw PmsException.Validation("JSON içinde kayıt dizisi bulunamadı.");
        var cols = new List<string>();
        foreach (var item in arr.Array.EnumerateArray().Take(1000).Where(i => i.ValueKind == JsonValueKind.Object))
            foreach (var p in item.EnumerateObject())
                if (p.Value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array) && !cols.Contains(p.Name)) cols.Add(p.Name);
        IEnumerable<string?[]> Rows()
        {
            var n = 0;
            foreach (var item in arr.Array.EnumerateArray().Where(i => i.ValueKind == JsonValueKind.Object))
            {
                if (limit is { } l && n++ >= l) yield break;
                yield return cols.Select(c => item.TryGetProperty(c, out var v) ? v.ValueKind switch
                {
                    JsonValueKind.Null or JsonValueKind.Undefined => null,
                    JsonValueKind.String => v.GetString(),
                    _ => v.GetRawText(),
                } : null).ToArray();
            }
        }
        return (cols, Rows());
    }

    public void Dispose() => _doc.Dispose();
}

// ------------------------------------------------------------------------------------------------ XML
public sealed class XmlSource(string path) : ISourceReader
{
    readonly XmlDocument _doc = Load(path);

    static XmlDocument Load(string path)
    {
        var d = new XmlDocument { XmlResolver = null };
        try
        {
            using var r = XmlReader.Create(path, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
            d.Load(r);
        }
        catch (XmlException) { throw PmsException.Validation("XML dosyası geçersiz."); }
        return d;
    }

    /// <summary>Aynı ebeveyn altında tekrar eden elemanlar kayıt adayıdır.</summary>
    public IReadOnlyList<SourceTable> ListTables()
    {
        var counts = new Dictionary<string, long>();
        void Walk(XmlNode n)
        {
            foreach (var g in n.ChildNodes.OfType<XmlElement>().GroupBy(e => e.Name).Where(g => g.Count() > 1))
                counts[g.Key] = counts.GetValueOrDefault(g.Key) + g.Count();
            foreach (var c in n.ChildNodes.OfType<XmlElement>()) Walk(c);
        }
        Walk(_doc);
        return counts.OrderByDescending(c => c.Value).Select(c => new SourceTable(c.Key, c.Value)).ToList();
    }

    public (IReadOnlyList<string> Columns, IEnumerable<string?[]> Rows) Read(SourceOptions o, int? limit = null)
    {
        var name = o.XmlRecordElement ?? o.Table ?? ListTables().FirstOrDefault()?.Name ?? throw PmsException.Validation("XML içinde tekrar eden kayıt elemanı bulunamadı.");
        var nodes = _doc.GetElementsByTagName(name).OfType<XmlElement>().ToList();
        var cols = new List<string>();
        foreach (var e in nodes.Take(1000))
        {
            foreach (XmlAttribute a in e.Attributes) if (!cols.Contains("@" + a.Name)) cols.Add("@" + a.Name);
            foreach (var c in e.ChildNodes.OfType<XmlElement>().Where(c => !c.HasChildNodes || c.ChildNodes.Cast<XmlNode>().All(x => x is XmlText)))
                if (!cols.Contains(c.Name)) cols.Add(c.Name);
        }
        IEnumerable<string?[]> Rows()
        {
            var n = 0;
            foreach (var e in nodes)
            {
                if (limit is { } l && n++ >= l) yield break;
                yield return cols.Select(c => c.StartsWith('@') ? e.GetAttribute(c[1..]) is { Length: > 0 } v ? v : null : e[c]?.InnerText).ToArray();
            }
        }
        return (cols, Rows());
    }

    public void Dispose() { }
}

// ------------------------------------------------------------------------------------------------ Veritabanı (salt okunur)
public sealed record DbSourceConnection(string SourceType, string? Host, int? Port, string? Database, string? Username, string? Password,
    string? Dsn, string? FilePath);

/// <summary>
/// Eski PMS veritabanından okuma. Yalnız bu sınıfın ürettiği SELECT sorguları çalışır; tablo adı kaynak
/// katalog listesinden seçilir ve tırnaklanır (serbest SQL yok). Bağlantılar mümkün olan her yerde
/// sürücü seviyesinde salt-okunur açılır. Parola yalnız bellekte tutulur, loglanmaz.
/// </summary>
public sealed class DbSource : ISourceReader
{
    readonly DbConnection _conn;
    readonly string _type;
    List<SourceTable>? _tables;

    public DbSource(DbSourceConnection c)
    {
        _type = c.SourceType;
        _conn = c.SourceType switch
        {
            "postgresql" => new Npgsql.NpgsqlConnection(new Npgsql.NpgsqlConnectionStringBuilder
            {
                Host = Req(c.Host, "Sunucu"), Port = c.Port ?? 5432, Database = Req(c.Database, "Veritabanı"), Username = c.Username, Password = c.Password,
                Timeout = 15, CommandTimeout = 600, Options = "-c default_transaction_read_only=on", ApplicationName = "HotelPMS-Import(readonly)",
                Pooling = false,
            }.ConnectionString),
            "sqlserver" => new Microsoft.Data.SqlClient.SqlConnection(new Microsoft.Data.SqlClient.SqlConnectionStringBuilder
            {
                DataSource = c.Port is { } p ? $"{Req(c.Host, "Sunucu")},{p}" : Req(c.Host, "Sunucu"), InitialCatalog = Req(c.Database, "Veritabanı"),
                UserID = c.Username ?? "", Password = c.Password ?? "", IntegratedSecurity = string.IsNullOrEmpty(c.Username),
                ApplicationIntent = Microsoft.Data.SqlClient.ApplicationIntent.ReadOnly, TrustServerCertificate = true, ConnectTimeout = 15,
                ApplicationName = "HotelPMS-Import(readonly)", Pooling = false,
            }.ConnectionString),
            "mysql" => new MySqlConnector.MySqlConnection(new MySqlConnector.MySqlConnectionStringBuilder
            {
                Server = Req(c.Host, "Sunucu"), Port = (uint)(c.Port ?? 3306), Database = Req(c.Database, "Veritabanı"), UserID = c.Username, Password = c.Password,
                ConnectionTimeout = 15, DefaultCommandTimeout = 600, Pooling = false, CharacterSet = "utf8mb4",
            }.ConnectionString),
            "sqlite" => new Microsoft.Data.Sqlite.SqliteConnection(new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder
            {
                DataSource = Req(c.FilePath, "Dosya"), Mode = Microsoft.Data.Sqlite.SqliteOpenMode.ReadOnly, Pooling = false,
            }.ConnectionString),
            "odbc" => new System.Data.Odbc.OdbcConnection(OdbcConnectionString(c)),
            _ => throw PmsException.Validation("Desteklenmeyen veritabanı türü."),
        };
        try { _conn.Open(); }
        catch (Exception ex) when (ex is DbException or InvalidOperationException or ArgumentException)
        {
            _conn.Dispose();
            throw PmsException.Validation("Eski sistem veritabanına bağlanılamadı. Sunucu adı, port, veritabanı ve kullanıcı bilgilerini kontrol edin.");
        }
        if (_type == "mysql") Exec("SET SESSION TRANSACTION READ ONLY");
    }

    static string Req(string? v, string f) => string.IsNullOrWhiteSpace(v) ? throw PmsException.Validation($"{f} zorunludur.") : v.Trim();

    static string OdbcConnectionString(DbSourceConnection c)
    {
        if (!string.IsNullOrWhiteSpace(c.Dsn))
        {
            var dsn = c.Dsn.Trim();
            if (dsn.Contains(';') || dsn.Contains('=')) throw PmsException.Validation("DSN adı geçersiz.");
            var cs = $"DSN={dsn};";
            if (!string.IsNullOrEmpty(c.Username)) cs += $"UID={c.Username};PWD={c.Password};";
            return cs;
        }
        if (!string.IsNullOrWhiteSpace(c.FilePath))
        {
            var ext = Path.GetExtension(c.FilePath).ToLowerInvariant();
            if (ext is not (".mdb" or ".accdb")) throw PmsException.Validation("ODBC dosya kaynağı olarak yalnız Access (.mdb/.accdb) desteklenir.");
            if (!OperatingSystem.IsWindows()) throw PmsException.Validation("Access dosyaları yalnız Windows sunucuda okunabilir. Veriyi CSV/XLSX olarak dışa aktarıp yükleyin.");
            if (!OdbcDrivers().Any(d => d.Contains("Access", StringComparison.OrdinalIgnoreCase)))
                throw PmsException.Validation("Bu sunucuda Microsoft Access ODBC sürücüsü kurulu değil. Access Database Engine kurulmalıdır.");
            var driver = OdbcDrivers().First(d => d.Contains("*.accdb", StringComparison.OrdinalIgnoreCase) || d.Contains("Access", StringComparison.OrdinalIgnoreCase));
            var cs = $"Driver={{{driver}}};Dbq={c.FilePath};ReadOnly=1;Exclusive=0;";
            if (!string.IsNullOrEmpty(c.Password)) cs += $"Pwd={c.Password};";
            return cs;
        }
        throw PmsException.Validation("ODBC için DSN adı veya Access dosyası gereklidir.");
    }

    /// <summary>Sunucuda kurulu 64-bit ODBC sürücüleri.</summary>
    public static IReadOnlyList<string> OdbcDrivers()
    {
        if (OperatingSystem.IsWindows())
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers");
            if (key is null) return [];
            var names = new List<string>();
            foreach (var n in key.GetValueNames()) if (key.GetValue(n) as string == "Installed") names.Add(n);
            return names.OrderBy(n => n).ToList();
        }
        // Linux: unixODBC sürücü kataloğu.
        const string ini = "/etc/odbcinst.ini";
        if (!File.Exists(ini)) return [];
        return File.ReadAllLines(ini).Select(l => l.Trim()).Where(l => l.StartsWith('[') && l.EndsWith(']') && l != "[ODBC]")
            .Select(l => l[1..^1]).OrderBy(n => n).ToList();
    }

    void Exec(string sql)
    {
        using var cmd = _conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    public IReadOnlyList<SourceTable> ListTables()
    {
        if (_tables is not null) return _tables;
        _tables = [];
        if (_type == "odbc")
        {
            var schema = _conn.GetSchema("Tables");
            foreach (DataRow r in schema.Rows)
            {
                var type = r["TABLE_TYPE"]?.ToString();
                if (type is "TABLE" or "VIEW") _tables.Add(new SourceTable(r["TABLE_NAME"]!.ToString()!, null));
            }
            return _tables;
        }
        var sql = _type switch
        {
            "postgresql" => "SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type IN ('BASE TABLE','VIEW') ORDER BY 1",
            "sqlserver" => "SELECT TABLE_SCHEMA + '.' + TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY 1",
            "mysql" => "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY 1",
            "sqlite" => "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY 1",
            _ => throw new InvalidOperationException(),
        };
        using var cmd = _conn.CreateCommand();
        cmd.CommandText = sql;
        using var rd = cmd.ExecuteReader();
        while (rd.Read()) _tables.Add(new SourceTable(rd.GetString(0), null));
        return _tables;
    }

    string Quote(string table)
    {
        if (ListTables().All(t => t.Name != table)) throw PmsException.Validation("Seçilen tablo kaynak veritabanında bulunamadı.");
        static string Q(string part, char open, char close) => open + part.Replace(close.ToString(), new string(close, 2)) + close;
        var parts = _type is "postgresql" or "sqlserver" ? table.Split('.', 2) : [table];
        return string.Join('.', parts.Select(p => _type switch
        {
            "postgresql" or "sqlite" => Q(p, '"', '"'),
            "sqlserver" or "odbc" => Q(p, '[', ']'),
            "mysql" => Q(p, '`', '`'),
            _ => throw new InvalidOperationException(),
        }));
    }

    public (IReadOnlyList<string> Columns, IEnumerable<string?[]> Rows) Read(SourceOptions o, int? limit = null)
    {
        var table = o.Table ?? throw PmsException.Validation("Tablo seçilmelidir.");
        var q = Quote(table);
        var sql = limit is { } l
            ? _type switch
            {
                "sqlserver" => $"SELECT TOP ({l}) * FROM {q}",
                "odbc" => $"SELECT TOP {l} * FROM {q}",
                _ => $"SELECT * FROM {q} LIMIT {l}",
            }
            : $"SELECT * FROM {q}";
        var cmd = _conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 600;
        var rd = cmd.ExecuteReader(CommandBehavior.SequentialAccess);
        var cols = CsvSource.UniqueColumns(Enumerable.Range(0, rd.FieldCount).Select(i => (string?)rd.GetName(i)).ToArray());
        IEnumerable<string?[]> Rows()
        {
            using (cmd)
            using (rd)
            {
                while (rd.Read())
                {
                    var row = new string?[cols.Count];
                    for (var i = 0; i < cols.Count; i++)
                    {
                        var v = rd.IsDBNull(i) ? null : rd.GetValue(i);
                        row[i] = v switch
                        {
                            null => null,
                            DateTime dt => dt.TimeOfDay == TimeSpan.Zero ? dt.ToString("yyyy-MM-dd") : dt.ToString("yyyy-MM-dd HH:mm:ss"),
                            DateOnly d => d.ToString("yyyy-MM-dd"),
                            byte[] => null,
                            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
                            _ => v.ToString(),
                        };
                    }
                    yield return row;
                }
            }
        }
        return (cols, Rows());
    }

    public void Dispose() => _conn.Dispose();
}
