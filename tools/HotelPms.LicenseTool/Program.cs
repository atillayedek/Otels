using System.Security.Cryptography;
using System.Text;
using HotelPms.Shared;

namespace HotelPms.LicenseTool;

/// <summary>
/// TSDMR Lisans Üretici. Satılan her otel için imzalı lisans dosyası üretir. İmza anahtarı (lisans-imza-anahtari.pem) yalnız satıcıdadır;
/// kaybolursa yeni lisans üretilemez, başkasının eline geçerse sahte lisans üretilebilir. Yedeğini güvenli bir yerde saklayın.
/// </summary>
static class Program
{
    public const string KeyFileName = "lisans-imza-anahtari.pem";
    public const string LedgerFileName = "verilen-lisanslar.csv";

    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    public static string DefaultKeyDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TSDMR", "Lisans");
}

sealed class MainForm : Form
{
    readonly TextBox customer = new() { Width = 360 };
    readonly TextBox hotel = new() { Width = 360 };
    readonly TextBox vkn = new() { Width = 200, MaxLength = 11 };
    readonly NumericUpDown rooms = new() { Minimum = 1, Maximum = 5000, Value = 30, Width = 100 };
    readonly CheckBox modRestaurant = new() { Text = "Restoran / Adisyon", AutoSize = true, Checked = true };
    readonly CheckBox modStock = new() { Text = "Stok ve Satın Alma", AutoSize = true, Checked = true };
    readonly CheckBox modAccounting = new() { Text = "Muhasebe", AutoSize = true, Checked = true };
    readonly CheckBox perpetual = new() { Text = "Süresiz lisans", AutoSize = true, Checked = true };
    readonly DateTimePicker expires = new() { Format = DateTimePickerFormat.Short, Width = 140, Enabled = false };
    readonly DateTimePicker support = new() { Format = DateTimePickerFormat.Short, Width = 140 };
    readonly TextBox output = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Width = 560, Height = 120, Font = new Font("Consolas", 8.5f) };
    readonly Label keyInfo = new() { AutoSize = true, MaximumSize = new Size(560, 0) };
    string? keyPath;

    public MainForm()
    {
        Text = "TSDMR Lisans Üretici";
        Font = new Font("Segoe UI", 9.5f);
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink; Padding = new Padding(16);
        support.Value = DateTime.Today.AddYears(1);
        expires.Value = DateTime.Today.AddYears(1);
        perpetual.CheckedChanged += (_, _) => expires.Enabled = !perpetual.Checked;

        var grid = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill };
        void Row(string label, Control c) { grid.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 8, 12, 0) }); grid.Controls.Add(c); }
        var title = new Label { Text = "Otel için lisans üret", Font = new Font("Segoe UI Semibold", 13f), AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
        grid.Controls.Add(title); grid.SetColumnSpan(title, 2);
        Row("Müşteri (fatura unvanı)", customer);
        Row("Otel adı", hotel);
        Row("Vergi no (VKN/TCKN)", vkn);
        Row("Oda sayısı (üst sınır)", rooms);
        var mods = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
        mods.Controls.AddRange([modRestaurant, modStock, modAccounting]);
        Row("Ek modüller", mods);
        var exp = new FlowLayoutPanel { AutoSize = true };
        exp.Controls.AddRange([perpetual, new Label { Text = "veya bitiş:", AutoSize = true, Margin = new Padding(10, 6, 4, 0) }, expires]);
        Row("Lisans süresi", exp);
        Row("Destek / güncelleme bitişi", support);

        var hint = new Label
        {
            AutoSize = true, MaximumSize = new Size(560, 0), ForeColor = Color.DimGray, Margin = new Padding(0, 6, 0, 6),
            Text = "Vergi no girilirse lisans yalnız Yönetim → Otel Bilgileri'nde aynı vergi numarası kayıtlı otelde geçerli olur (lisansın başka otelde kullanılmasını önler).",
        };
        grid.Controls.Add(hint); grid.SetColumnSpan(hint, 2);

        var buttons = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 8, 0, 8) };
        var make = new Button { Text = "Lisans üret ve kaydet", AutoSize = true, Padding = new Padding(10, 4, 10, 4) };
        var copy = new Button { Text = "Metni kopyala", AutoSize = true, Padding = new Padding(10, 4, 10, 4) };
        var verify = new Button { Text = "Lisans dosyası doğrula", AutoSize = true, Padding = new Padding(10, 4, 10, 4) };
        var keyBtn = new Button { Text = "İmza anahtarı…", AutoSize = true, Padding = new Padding(10, 4, 10, 4) };
        var newKeyBtn = new Button { Text = "Yeni imza anahtarı oluştur", AutoSize = true, Padding = new Padding(10, 4, 10, 4) };
        newKeyBtn.Click += (_, _) => CreateKey();
        make.Click += (_, _) => Make();
        copy.Click += (_, _) => { if (output.Text.Length > 0) Clipboard.SetText(output.Text); };
        verify.Click += (_, _) => VerifyFile();
        keyBtn.Click += (_, _) => ChooseKey();
        buttons.Controls.AddRange([make, copy, verify, keyBtn, newKeyBtn]);
        grid.Controls.Add(buttons); grid.SetColumnSpan(buttons, 2);
        grid.Controls.Add(output); grid.SetColumnSpan(output, 2);
        grid.Controls.Add(keyInfo); grid.SetColumnSpan(keyInfo, 2);
        Controls.Add(grid);
        FindKey();
    }

    void FindKey()
    {
        var candidates = new[] { Path.Combine(AppContext.BaseDirectory, Program.KeyFileName), Path.Combine(Program.DefaultKeyDir, Program.KeyFileName) };
        keyPath = candidates.FirstOrDefault(File.Exists);
        keyInfo.ForeColor = keyPath is null ? Color.Firebrick : Color.DimGray;
        keyInfo.Text = keyPath is null
            ? $"İmza anahtarı bulunamadı. \"İmza anahtarı…\" ile {Program.KeyFileName} dosyasını seçin."
            : $"İmza anahtarı: {keyPath}\nBu dosyanın yedeğini (ör. şifreli USB bellek) mutlaka saklayın; kaybolursa yeni lisans üretilemez.";
    }

    void ChooseKey()
    {
        using var dlg = new OpenFileDialog { Filter = "İmza anahtarı (*.pem)|*.pem", Title = "Lisans imza anahtarını seçin" };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        Directory.CreateDirectory(Program.DefaultKeyDir);
        var target = Path.Combine(Program.DefaultKeyDir, Program.KeyFileName);
        try
        {
            using var k = LoadKey(dlg.FileName);
            if (!PublicMatches(k)) { Error("Seçilen anahtar bu ürün sürümünün lisans anahtarıyla eşleşmiyor."); return; }
            if (!string.Equals(Path.GetFullPath(dlg.FileName), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) File.Copy(dlg.FileName, target, overwrite: true);
        }
        catch (Exception ex) when (ex is CryptographicException or IOException or ArgumentException) { Error("Anahtar okunamadı: " + ex.Message); return; }
        FindKey();
    }

    /// <summary>
    /// Yeni imza anahtarını bu bilgisayarda oluşturur (özel anahtar yalnız buraya yazılır). Açık anahtar ekranda gösterilir ve panoya kopyalanır;
    /// ürünün bu anahtarla üretilen lisansları tanıması için açık anahtar ürüne gömülüp ürün yeniden derlenmelidir.
    /// </summary>
    void CreateKey()
    {
        var target = Path.Combine(Program.DefaultKeyDir, Program.KeyFileName);
        if (File.Exists(target))
        {
            Error($"Bu bilgisayarda zaten bir imza anahtarı var:\n{target}\n\nÜzerine yazılmaz. Gerçekten yenisini istiyorsanız önce bu dosyayı yedekleyip silin.");
            return;
        }
        if (MessageBox.Show(this, "Yeni imza anahtarı oluşturulacak. Daha önce verilmiş lisanslar (varsa) bu anahtarla doğrulanmaz.\n\nDevam edilsin mi?",
                "Yeni imza anahtarı", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        Directory.CreateDirectory(Program.DefaultKeyDir);
        var (pem, pub) = LicenseFormat.NewKeyPair();
        File.WriteAllText(target, pem, new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(Program.DefaultKeyDir, "acik-anahtar.txt"), pub + Environment.NewLine, new UTF8Encoding(false));
        output.Text = pub;
        Clipboard.SetText(pub);
        FindKey();
        MessageBox.Show(this, $"İmza anahtarı oluşturuldu:\n{target}\n\nAçık anahtar panoya kopyalandı (aşağıdaki kutuda da görünüyor). Bu açık anahtarı geliştiriciye iletin; " +
            "ürün bu anahtarla yeniden derlendikten sonra lisans üretebilirsiniz.\n\nÖzel anahtar dosyasını (lisans-imza-anahtari.pem) şifreli bir USB belleğe yedekleyin ve kimseyle paylaşmayın.",
            "Anahtar hazır", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static ECDsa LoadKey(string path)
    {
        var k = ECDsa.Create();
        k.ImportFromPem(File.ReadAllText(path));
        return k;
    }

    static bool PublicMatches(ECDsa k) => Convert.ToBase64String(k.ExportSubjectPublicKeyInfo()) == LicenseFormat.PublicKey;

    void Make()
    {
        if (keyPath is null) { Error("Önce imza anahtarını seçin."); return; }
        var c = customer.Text.Trim(); var h = hotel.Text.Trim(); var v = new string(vkn.Text.Where(char.IsDigit).ToArray());
        if (c.Length < 2 || h.Length < 2) { Error("Müşteri unvanı ve otel adı zorunludur."); return; }
        if (v.Length is not (0 or 10 or 11)) { Error("Vergi no 10 haneli VKN veya 11 haneli TCKN olmalıdır (boş bırakılabilir)."); return; }
        if (!perpetual.Checked && expires.Value.Date <= DateTime.Today) { Error("Bitiş tarihi bugünden sonra olmalıdır."); return; }
        var modules = new List<string>();
        if (modRestaurant.Checked) modules.Add(LicenseModules.Restaurant);
        if (modStock.Checked) modules.Add(LicenseModules.Stock);
        if (modAccounting.Checked) modules.Add(LicenseModules.Accounting);
        var payload = new LicensePayload(
            $"L{DateTime.Now:yyMMdd}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(3))}", c, h, v.Length == 0 ? null : v, (int)rooms.Value, modules,
            DateOnly.FromDateTime(DateTime.Today), perpetual.Checked ? null : DateOnly.FromDateTime(expires.Value), DateOnly.FromDateTime(support.Value));
        string text;
        try
        {
            using var k = LoadKey(keyPath);
            if (!PublicMatches(k)) { Error("İmza anahtarı bu ürün sürümüyle eşleşmiyor."); return; }
            text = LicenseFormat.Sign(payload, k);
        }
        catch (Exception ex) when (ex is CryptographicException or IOException) { Error("Lisans imzalanamadı: " + ex.Message); return; }
        if (LicenseFormat.Verify(text, out var err) is null) { Error("Üretilen lisans doğrulanamadı: " + err); return; }

        using var save = new SaveFileDialog { Filter = "TSDMR lisans dosyası (*.lisans)|*.lisans", FileName = $"{Safe(h)}-{payload.LicenseId}.lisans" };
        if (save.ShowDialog(this) != DialogResult.OK) return;
        File.WriteAllText(save.FileName, text + Environment.NewLine, new UTF8Encoding(false));
        AppendLedger(payload);
        output.Text = text;
        MessageBox.Show(this, $"Lisans kaydedildi:\n{save.FileName}\n\n{LicenseFormat.Describe(payload)}\n\nOtelde: Yönetim → Lisans ekranında dosyayı açın veya metni yapıştırın.",
            "Lisans hazır", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    void AppendLedger(LicensePayload p)
    {
        if (keyPath is null) return;
        var ledger = Path.Combine(Path.GetDirectoryName(keyPath)!, Program.LedgerFileName);
        var isNew = !File.Exists(ledger);
        string Q(string? s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
        var line = string.Join(';', Q(p.LicenseId), Q(p.IssuedAt.ToString("yyyy-MM-dd")), Q(p.Customer), Q(p.Hotel), Q(p.TaxNumber), p.MaxRooms,
            Q(string.Join(",", p.Modules)), Q(p.ExpiresAt?.ToString("yyyy-MM-dd") ?? "süresiz"), Q(p.SupportUntil?.ToString("yyyy-MM-dd")));
        File.AppendAllText(ledger, (isNew ? "Lisans;Tarih;Müşteri;Otel;Vergi no;Oda;Modüller;Bitiş;Destek bitişi" + Environment.NewLine : "") + line + Environment.NewLine,
            new UTF8Encoding(true));
    }

    void VerifyFile()
    {
        using var dlg = new OpenFileDialog { Filter = "TSDMR lisans dosyası (*.lisans)|*.lisans|Tüm dosyalar|*.*" };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var p = LicenseFormat.Verify(File.ReadAllText(dlg.FileName), out var err);
        if (p is null) Error(err ?? "Geçersiz lisans.");
        else MessageBox.Show(this, $"Geçerli lisans: {p.LicenseId}\n{LicenseFormat.Describe(p)}\nVergi no: {p.TaxNumber ?? "—"}\nDestek bitişi: {p.SupportUntil:dd.MM.yyyy}",
            "Lisans doğrulandı", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    static string Safe(string s) => new(s.Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray());

    void Error(string message) => MessageBox.Show(this, message, "TSDMR Lisans Üretici", MessageBoxButtons.OK, MessageBoxIcon.Warning);
}
