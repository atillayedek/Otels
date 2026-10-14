using System.Diagnostics;
using System.ServiceProcess;
using HotelPms.Shared;

namespace HotelPms.Manager;

/// <summary>
/// Sunucu bilgisayarında çalışan yönetim ekranı: hizmet durumu ve kontrolü, istemci bağlantı bilgisi (adres, port, parmak izi),
/// ilk kurulum kodu, bağlı istemciler, yedekleme/geri yükleme, günlükler, bakım ve acil parola sıfırlama.
/// </summary>
public sealed class MainForm : Form
{
    static readonly Color Primary = Color.FromArgb(37, 99, 235);
    static readonly Color Ok = Color.FromArgb(22, 163, 74);
    static readonly Color Warn = Color.FromArgb(217, 119, 6);
    static readonly Color Bad = Color.FromArgb(220, 38, 38);
    static readonly Color Muted = Color.FromArgb(100, 116, 139);
    static readonly Color Surface = Color.FromArgb(244, 246, 250);

    readonly ManageClient _client = new();
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 5000 };
    bool _busy;

    readonly Label _status = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 13f), ForeColor = Muted };
    readonly Label _serviceInfo = new() { AutoSize = true, ForeColor = Muted };
    readonly Button _start = Btn("Başlat"), _stop = Btn("Durdur"), _restart = Btn("Yeniden başlat"), _refresh = Btn("Yenile");

    readonly TextBox _address = RoBox(), _port = RoBox(), _fingerprint = RoBox(), _setupCode = RoBox();
    readonly Label _setupHint = new() { AutoSize = true, ForeColor = Muted, MaximumSize = new Size(520, 0) };
    readonly ListView _checks = Lv(("Kontrol", 160), ("Durum", 90), ("Açıklama", 420));
    readonly ListView _metrics = Lv(("Ölçüm", 180), ("Değer", 300));
    readonly ListView _clients = Lv(("Kullanıcı", 140), ("Bilgisayar", 160), ("IP", 130), ("Bağlantı", 150));
    readonly ListView _backups = Lv(("Dosya", 290), ("Tarih", 140), ("Tür", 110), ("Boyut", 90), ("Şema", 70), ("Durum", 200));
    readonly TextBox _logs = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 9f), BackColor = Color.White };

    public MainForm()
    {
        Text = "PMS Server Manager · Ferrolit PMS";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(980, 680);
        Size = new Size(1120, 760);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9.5f);
        BackColor = Surface;

        var header = new Panel { Dock = DockStyle.Top, Height = 74, BackColor = Color.White, Padding = new Padding(18, 12, 18, 10) };
        var title = new Label { Text = "Ferrolit PMS · Sunucu", AutoSize = true, Font = new Font("Segoe UI Semibold", 11f), Location = new Point(18, 10) };
        _status.Location = new Point(18, 34);
        _serviceInfo.Location = new Point(300, 40);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, WrapContents = false, Padding = new Padding(0, 14, 0, 0) };
        buttons.Controls.AddRange([_start, _stop, _restart, _refresh]);
        header.Controls.AddRange([title, _status, _serviceInfo, buttons]);

        var tabs = new TabControl { Dock = DockStyle.Fill, Padding = new Point(14, 6) };
        tabs.TabPages.Add(StatusTab());
        tabs.TabPages.Add(Wrap("Bağlı istemciler", _clients));
        tabs.TabPages.Add(BackupTab());
        tabs.TabPages.Add(LogsTab());
        tabs.TabPages.Add(MaintenanceTab());
        tabs.TabPages.Add(SupportTab());
        tabs.SelectedIndexChanged += async (_, _) =>
        {
            if (tabs.SelectedIndex == 2) await LoadBackupsAsync();
            if (tabs.SelectedIndex == 3) await LoadLogsAsync();
        };

        var footer = new Label { Dock = DockStyle.Bottom, Height = 26, Text = $"  Veri klasörü: {_client.Paths.DataRoot}    ·    TSDMR Digital Studio", ForeColor = Muted, TextAlign = ContentAlignment.MiddleLeft, BackColor = Color.White };
        Controls.Add(tabs);
        Controls.Add(footer);
        Controls.Add(header);

        _start.Click += (_, _) => ServiceAction(s => s.Start(), ServiceControllerStatus.Running, "Hizmet başlatılıyor…");
        _stop.Click += (_, _) =>
        {
            if (Ask("Sunucu hizmeti durdurulursa bağlı tüm bilgisayarların bağlantısı kesilir. Devam edilsin mi?"))
                ServiceAction(s => s.Stop(), ServiceControllerStatus.Stopped, "Hizmet durduruluyor…");
        };
        _restart.Click += (_, _) =>
        {
            if (!Ask("Sunucu hizmeti yeniden başlatılacak; bağlı bilgisayarlar birkaç saniye içinde otomatik yeniden bağlanır. Devam edilsin mi?")) return;
            ServiceAction(s => { if (s.Status != ServiceControllerStatus.Stopped) { s.Stop(); s.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60)); } s.Start(); }, ServiceControllerStatus.Running, "Hizmet yeniden başlatılıyor…");
        };
        _refresh.Click += async (_, _) => await RefreshAsync();
        _timer.Tick += async (_, _) => await RefreshAsync();
        Shown += async (_, _) => { await RefreshAsync(); _timer.Start(); };
        FormClosed += (_, _) => { _timer.Dispose(); _client.Dispose(); };
    }

    // ------------------------------------------------------------------ Sekmeler

    TabPage StatusTab()
    {
        var page = new TabPage("Durum") { BackColor = Surface, Padding = new Padding(12) };
        var conn = new GroupBox { Text = "İstemci bağlantı bilgileri", Dock = DockStyle.Top, Height = 188, Padding = new Padding(12) };
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 5 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        void Row(string label, Control c) { grid.Controls.Add(new Label { Text = label, AutoSize = true, Padding = new Padding(0, 6, 0, 0) }); grid.Controls.Add(c); }
        Row("Sunucu adresi (IP)", _address);
        Row("Port", _port);
        Row("Sertifika parmak izi", _fingerprint);
        Row("İlk kurulum kodu", _setupCode);
        grid.Controls.Add(new Label());
        grid.Controls.Add(_setupHint);
        conn.Controls.Add(grid);

        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Vertical, SplitterDistance = 560 };
        split.Panel1.Controls.Add(Group("Sağlık kontrolleri", _checks));
        split.Panel2.Controls.Add(Group("Ölçümler", _metrics));
        page.Controls.Add(split);
        page.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
        page.Controls.Add(conn);
        return page;
    }

    TabPage BackupTab()
    {
        var page = new TabPage("Yedekler") { BackColor = Surface, Padding = new Padding(12) };
        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 44 };
        var create = Btn("Şimdi yedek al", primary: true);
        var restore = Btn("Seçili yedeği geri yükle");
        var restoreFile = Btn("Dosyadan geri yükle…");
        var openDir = Btn("Yedek klasörünü aç");
        var reload = Btn("Yenile");
        bar.Controls.AddRange([create, restore, restoreFile, openDir, reload]);
        create.Click += async (_, _) => await Run("Yedek alınıyor…", async () => { await _client.BackupAsync(); await LoadBackupsAsync(); }, "Yedek alındı.");
        reload.Click += async (_, _) => await LoadBackupsAsync();
        openDir.Click += (_, _) => OpenFolder(_client.Config.Backup.PrimaryDirectory ?? _client.Paths.DefaultBackupDir);
        restore.Click += async (_, _) =>
        {
            if (_backups.SelectedItems.Count == 0) { Info("Listeden geri yüklenecek yedeği seçin."); return; }
            await RestoreAsync(((BackupFileInfo)_backups.SelectedItems[0].Tag!).Path);
        };
        restoreFile.Click += async (_, _) =>
        {
            using var dlg = new OpenFileDialog { Filter = "PMS yedeği (*.hpbak)|*.hpbak", Title = "Geri yüklenecek yedek" };
            if (dlg.ShowDialog(this) == DialogResult.OK) await RestoreAsync(dlg.FileName);
        };
        var note = new Label { Dock = DockStyle.Bottom, Height = 40, ForeColor = Muted, Text = "Geri yüklemeden önce mevcut veritabanının güvenlik yedeği otomatik alınır ve eski veritabanı silinmeden yeniden adlandırılarak saklanır." };
        page.Controls.Add(_backups);
        page.Controls.Add(note);
        page.Controls.Add(bar);
        return page;
    }

    TabPage LogsTab()
    {
        var page = new TabPage("Günlük") { BackColor = Surface, Padding = new Padding(12) };
        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 44 };
        var reload = Btn("Yenile");
        var openDir = Btn("Günlük klasörünü aç");
        reload.Click += async (_, _) => await LoadLogsAsync();
        openDir.Click += (_, _) => OpenFolder(_client.Paths.LogsDir);
        bar.Controls.AddRange([reload, openDir]);
        page.Controls.Add(_logs);
        page.Controls.Add(bar);
        return page;
    }

    TabPage MaintenanceTab()
    {
        var page = new TabPage("Bakım") { BackColor = Surface, Padding = new Padding(12) };
        var db = new GroupBox { Text = "Veritabanı bakımı", Dock = DockStyle.Top, Height = 110, Padding = new Padding(12) };
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill };
        foreach (var (task, label) in new[] { ("analyze", "İstatistikleri güncelle"), ("vacuum", "Alan geri kazan (VACUUM)"), ("cleanup", "Eski oturum/anahtar kayıtlarını temizle") })
        {
            var b = Btn(label);
            b.Click += async (_, _) => await Run($"{label}…", async () => { var ms = await _client.MaintenanceAsync(task); Info($"{label} tamamlandı ({ms / 1000.0:0.0} sn)."); });
            flow.Controls.Add(b);
        }
        flow.Controls.Add(new Label { AutoSize = true, ForeColor = Muted, Padding = new Padding(0, 8, 0, 0), Text = "Gece, kullanıcılar çalışmıyorken çalıştırılması önerilir." });
        db.Controls.Add(flow);

        var reset = new GroupBox { Text = "Acil parola sıfırlama (yönetici parolası unutulduğunda)", Dock = DockStyle.Top, Height = 150, Padding = new Padding(12) };
        var g = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4 };
        var user = new TextBox { Width = 180 };
        var p1 = new TextBox { Width = 180, UseSystemPasswordChar = true };
        var p2 = new TextBox { Width = 180, UseSystemPasswordChar = true };
        var go = Btn("Parolayı sıfırla", primary: true);
        g.Controls.Add(new Label { Text = "Kullanıcı adı", AutoSize = true }, 0, 0); g.Controls.Add(user, 0, 1);
        g.Controls.Add(new Label { Text = "Yeni parola", AutoSize = true }, 1, 0); g.Controls.Add(p1, 1, 1);
        g.Controls.Add(new Label { Text = "Yeni parola (tekrar)", AutoSize = true }, 2, 0); g.Controls.Add(p2, 2, 1);
        g.Controls.Add(go, 3, 1);
        g.Controls.Add(new Label { AutoSize = true, ForeColor = Muted, Text = "Kullanıcı ilk girişte parolasını değiştirir; açık oturumları kapatılır ve işlem denetim kaydına yazılır." }, 0, 2);
        g.SetColumnSpan(g.GetControlFromPosition(0, 2)!, 4);
        go.Click += async (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(user.Text) || p1.Text.Length < 10) { Info("Kullanıcı adı ve en az 10 karakterlik yeni parola girin."); return; }
            if (p1.Text != p2.Text) { Info("Parolalar aynı değil."); return; }
            await Run("Parola sıfırlanıyor…", async () => { await _client.EmergencyResetAsync(user.Text.Trim(), p1.Text); p1.Clear(); p2.Clear(); }, "Parola sıfırlandı.");
        };
        reset.Controls.Add(g);

        page.Controls.Add(reset);
        page.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
        page.Controls.Add(db);
        return page;
    }

    TabPage SupportTab()
    {
        var page = new TabPage("Destek") { BackColor = Surface, Padding = new Padding(12) };
        var contact = new GroupBox { Text = $"{PmsConstants.Vendor} destek", Dock = DockStyle.Top, Height = 120, Padding = new Padding(12) };
        var cflow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        cflow.Controls.Add(new Label { AutoSize = true, Font = new Font("Segoe UI Semibold", 12f), ForeColor = Primary, Text = PmsConstants.SupportEmail });
        var copy = Btn("E-posta adresini kopyala");
        copy.Click += (_, _) => { Clipboard.SetText(PmsConstants.SupportEmail); Info("E-posta adresi panoya kopyalandı."); };
        cflow.Controls.Add(copy);
        cflow.Controls.Add(new Label { AutoSize = true, ForeColor = Muted, Text = $"Sürüm {PmsConstants.VersionText} · Bilgisayar {Environment.MachineName}" });
        contact.Controls.Add(cflow);

        var bundle = new GroupBox { Text = "Destek paketi", Dock = DockStyle.Top, Height = 130, Padding = new Padding(12) };
        var bflow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        bflow.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(820, 0), ForeColor = Muted,
            Text = "Son 14 günün sunucu günlükleri, kurulum günlüğü ve sistem bilgisi tek bir ZIP dosyasında toplanır. Veritabanı, misafir kayıtları, yedekler, belgeler ve parola/sertifika dosyaları pakete eklenmez. Oluşan dosyayı destek e-postasına ekleyin." });
        var make = Btn("Destek paketi oluştur", primary: true);
        make.Click += async (_, _) =>
        {
            using var dlg = new SaveFileDialog { Filter = "ZIP dosyası|*.zip", FileName = $"Ferrolit-destek-{Environment.MachineName}-{DateTime.Now:yyyyMMdd-HHmm}.zip",
                InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) };
            if (dlg.ShowDialog(this) != DialogResult.OK) return;
            try
            {
                var path = await Task.Run(() => SupportBundle.Create(_client.Paths, _client.Config, dlg.FileName));
                Info($"Destek paketi oluşturuldu:\n{path}\n\nBu dosyayı {PmsConstants.SupportEmail} adresine e-postayla gönderin.");
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Error("Destek paketi oluşturulamadı: " + ex.Message); }
        };
        bflow.Controls.Add(make);
        bundle.Controls.Add(bflow);

        page.Controls.Add(bundle);
        page.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
        page.Controls.Add(contact);
        return page;
    }

    // ------------------------------------------------------------------ Veri

    async Task RefreshAsync()
    {
        if (_busy) return;
        var svc = ServiceState();
        _serviceInfo.Text = svc is null ? "Sunucu hizmeti bu bilgisayarda kurulu değil." : $"Windows hizmeti: {Tr(svc.Value)}  ·  Veritabanı hizmeti: {PgState()}";
        _start.Enabled = svc is ServiceControllerStatus.Stopped;
        _stop.Enabled = _restart.Enabled = svc is ServiceControllerStatus.Running;
        _port.Text = _client.Config.HttpsPort.ToString();
        _fingerprint.Text = Group4(_client.CaFingerprint()) ?? "Sertifika henüz oluşturulmamış";

        if (svc is not ServiceControllerStatus.Running)
        {
            SetStatus(svc is null ? "Kurulu değil" : "Hizmet çalışmıyor", svc is null ? Muted : Bad);
            _address.Text = string.Join(", ", LocalIps());
            return;
        }
        try
        {
            var s = await _client.StatusAsync();
            SetStatus(s.Status == "running" ? "Çalışıyor" : s.Status == "degraded" ? "Veritabanı bekleniyor" : "Hata", s.Status == "running" ? Ok : s.Status == "degraded" ? Warn : Bad);
            _address.Text = string.Join(", ", s.Addresses.Count > 0 ? s.Addresses : LocalIps());
            _port.Text = s.HttpsPort.ToString();
            _setupCode.Text = s.SetupCode ?? "Kurulum tamamlandı";
            _setupHint.Text = s.SetupCode is null
                ? "İstemcilerde PMS Client açılınca sunucu otomatik bulunur; bulunamazsa yukarıdaki IP adresi ve port girilir. Parmak izinin istemcide gösterilenle aynı olduğunu doğrulayın."
                : "İlk bağlanan PMS Client, otel bilgilerini ve ilk yönetici hesabını oluştururken bu kodu isteyecektir.";
            Fill(_checks, s.Checks.Select(c => new[] { c.Name, c.Status == "healthy" ? "Tamam" : c.Status == "warning" ? "Uyarı" : "Hata", c.Message }),
                (item, i) => item.ForeColor = s.Checks[i].Status == "healthy" ? Color.Black : s.Checks[i].Status == "warning" ? Warn : Bad);
            Fill(_metrics, [
                ["Sürüm", s.Version], ["Veritabanı", $"{s.DatabaseVersion} · şema {s.SchemaVersion}"], ["Çalışma süresi", Duration(s.Uptime)],
                ["Bağlı istemci", s.ConnectedClients.ToString()], ["Açık oturum", $"{s.ActiveSessions} ({string.Join(", ", s.LoggedInUsers)})"],
                ["Veritabanı boyutu", Bytes(s.DatabaseSizeBytes)], ["Boş disk", $"{Bytes(s.FreeDiskBytes)} / {Bytes(s.TotalDiskBytes)}"],
                ["Bellek / CPU", $"{Bytes(s.MemoryBytes)} · %{s.CpuPercent:0.0}"],
                ["Son yedek", s.LastBackupAt is { } b ? $"{b.ToLocalTime():dd.MM.yyyy HH:mm} · {s.LastBackupStatus}" : "Henüz yedek yok"],
                ["Yedek klasörü", s.BackupDirectory], ["Başlangıç hatası", s.StartupError ?? "—"],
            ]);
            Fill(_clients, s.Clients.Select(c => new[] { c.Username, c.Hostname ?? "", c.Ip ?? "", c.ConnectedAt.ToLocalTime().ToString("dd.MM.yyyy HH:mm") }));
        }
        catch (ManageException ex) { SetStatus("Bağlanılamıyor", Bad); _setupHint.Text = ex.Message; }
    }

    async Task LoadBackupsAsync()
    {
        try
        {
            var list = (await _client.BackupsAsync()).OrderByDescending(b => b.ModifiedAt).ToList();
            _backups.BeginUpdate();
            _backups.Items.Clear();
            foreach (var b in list)
            {
                var item = new ListViewItem([b.FileName, b.ModifiedAt.ToLocalTime().ToString("dd.MM.yyyy HH:mm"), b.Manifest?.Kind ?? "", Bytes(b.SizeBytes), b.Manifest?.SchemaVersion ?? "", b.Problem ?? "Doğrulandı"]) { Tag = b };
                if (b.Problem is not null) item.ForeColor = Bad;
                _backups.Items.Add(item);
            }
            _backups.EndUpdate();
        }
        catch (ManageException ex) { Info(ex.Message); }
    }

    async Task LoadLogsAsync()
    {
        try { _logs.Text = (await _client.LogsAsync(800)).Replace("\n", Environment.NewLine); _logs.SelectionStart = _logs.TextLength; _logs.ScrollToCaret(); }
        catch (ManageException ex) { _logs.Text = ex.Message; }
    }

    async Task RestoreAsync(string file)
    {
        using var dlg = new ConfirmDialog(
            "Yedeği geri yükle",
            $"{Path.GetFileName(file)} geri yüklenecek.\r\n\r\nGeri yükleme sırasında tüm kullanıcıların bağlantısı kesilir. Mevcut veritabanının güvenlik yedeği önce otomatik alınır ve eski veritabanı silinmez.\r\n\r\nOnaylamak için GERI YUKLE yazın.",
            "GERI YUKLE");
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        await Run("Yedek geri yükleniyor… Bu işlem birkaç dakika sürebilir.", async () => await _client.RestoreAsync(file, "GERI YUKLE"), "Yedek geri yüklendi. İstemciler yeniden bağlanabilir.");
    }

    // ------------------------------------------------------------------ Hizmet

    static ServiceControllerStatus? ServiceState()
    {
        try { using var s = new ServiceController(PmsConstants.ServiceName); return s.Status; }
        catch (InvalidOperationException) { return null; }
    }

    static string PgState()
    {
        try { using var s = new ServiceController(PmsConstants.PostgresServiceName); return Tr(s.Status); }
        catch (InvalidOperationException) { return "kurulu değil"; }
    }

    void ServiceAction(Action<ServiceController> act, ServiceControllerStatus target, string message)
    {
        _ = Run(message, () => Task.Run(() =>
        {
            using var s = new ServiceController(PmsConstants.ServiceName);
            act(s);
            s.WaitForStatus(target, TimeSpan.FromSeconds(90));
        }));
    }

    async Task Run(string message, Func<Task> work, string? done = null)
    {
        _busy = true;
        UseWaitCursor = true;
        var prev = _status.Text;
        SetStatus(message, Primary);
        try { await work(); if (done is not null) Info(done); }
        catch (ManageException ex) { Error(ex.Message); }
        catch (System.ServiceProcess.TimeoutException) { Error("Hizmet beklenen sürede yanıt vermedi. Günlük sekmesini kontrol edin."); }
        catch (InvalidOperationException ex) { Error("Hizmet işlemi yapılamadı: " + ex.Message); }
        finally { _busy = false; UseWaitCursor = false; _status.Text = prev; await RefreshAsync(); }
    }

    // ------------------------------------------------------------------ Yardımcılar

    void SetStatus(string text, Color color) { _status.Text = "● " + text; _status.ForeColor = color; }
    void Info(string text) => MessageBox.Show(this, text, "PMS Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Information);
    void Error(string text) => MessageBox.Show(this, text, "PMS Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    bool Ask(string text) => MessageBox.Show(this, text, "PMS Server Manager", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;

    static void OpenFolder(string path)
    {
        if (Directory.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }

    static IEnumerable<string> LocalIps() => System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
        .Where(n => n.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up && n.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
        .SelectMany(n => n.GetIPProperties().UnicastAddresses).Where(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        .Select(a => a.Address.ToString());

    static string Tr(ServiceControllerStatus s) => s switch
    {
        ServiceControllerStatus.Running => "çalışıyor", ServiceControllerStatus.Stopped => "durdu", ServiceControllerStatus.StartPending => "başlıyor",
        ServiceControllerStatus.StopPending => "duruyor", _ => s.ToString(),
    };

    static string? Group4(string? fp) => fp is null ? null : string.Join(" ", Enumerable.Range(0, (fp.Length + 3) / 4).Select(i => fp.Substring(i * 4, Math.Min(4, fp.Length - i * 4))));
    static string Bytes(long b) => b < 1024 * 1024 ? $"{b / 1024.0:0.0} KB" : b < 1024L * 1024 * 1024 ? $"{b / 1048576.0:0.0} MB" : $"{b / 1073741824.0:0.00} GB";
    static string Duration(TimeSpan t) => t.TotalDays >= 1 ? $"{(int)t.TotalDays} gün {t.Hours} sa" : $"{t.Hours} sa {t.Minutes} dk";

    static Button Btn(string text, bool primary = false) => new()
    {
        Text = text, AutoSize = true, Height = 32, Padding = new Padding(8, 0, 8, 0), Margin = new Padding(0, 0, 8, 0), FlatStyle = FlatStyle.System,
        Font = primary ? new Font("Segoe UI Semibold", 9.5f) : new Font("Segoe UI", 9.5f),
    };

    static TextBox RoBox() => new() { ReadOnly = true, Width = 520, BorderStyle = BorderStyle.FixedSingle, BackColor = Color.White, Font = new Font("Consolas", 11f) };

    static ListView Lv(params (string Text, int Width)[] cols)
    {
        var lv = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, GridLines = true, HideSelection = false, MultiSelect = false };
        foreach (var (t, w) in cols) lv.Columns.Add(t, w);
        return lv;
    }

    static void Fill(ListView lv, IEnumerable<string[]> rows, Action<ListViewItem, int>? style = null)
    {
        lv.BeginUpdate();
        lv.Items.Clear();
        var i = 0;
        foreach (var r in rows) { var item = new ListViewItem(r); style?.Invoke(item, i++); lv.Items.Add(item); }
        lv.EndUpdate();
    }

    static GroupBox Group(string text, Control inner) { var g = new GroupBox { Text = text, Dock = DockStyle.Fill, Padding = new Padding(8) }; g.Controls.Add(inner); return g; }
    static TabPage Wrap(string text, Control inner) { var p = new TabPage(text) { Padding = new Padding(12), BackColor = Surface }; p.Controls.Add(inner); return p; }
}

/// <summary>Geri dönüşü olmayan işlemler için yazılı onay penceresi.</summary>
sealed class ConfirmDialog : Form
{
    public ConfirmDialog(string title, string message, string required)
    {
        Text = title;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(520, 250);
        Font = new Font("Segoe UI", 9.5f);
        var label = new Label { Text = message, Location = new Point(16, 14), Size = new Size(488, 140) };
        var box = new TextBox { Location = new Point(16, 160), Width = 488 };
        var ok = new Button { Text = "Onayla", DialogResult = DialogResult.OK, Enabled = false, Location = new Point(332, 204), Width = 82 };
        var cancel = new Button { Text = "Vazgeç", DialogResult = DialogResult.Cancel, Location = new Point(422, 204), Width = 82 };
        box.TextChanged += (_, _) => ok.Enabled = box.Text.Trim() == required;
        Controls.AddRange([label, box, ok, cancel]);
        AcceptButton = ok;
        CancelButton = cancel;
    }
}
