using System.Diagnostics;
using System.Runtime.Versioning;
using System.Net;
using System.Net.NetworkInformation;
using System.Text;
using Npgsql;

namespace HotelPms.Shared;

public sealed record ProvisionOptions
{
    /// <summary>PostgreSQL ve PMS'i Windows servisi olarak kaydet (yönetici yetkisi gerekir).</summary>
    public bool InstallServices { get; init; }
    /// <summary>Yalnız PMS portları için Windows Firewall kuralı ekle. PostgreSQL portu asla açılmaz.</summary>
    public bool ConfigureFirewall { get; init; }
    /// <summary>Servis yerine pg_ctl ile ön planda başlat (geliştirme/test).</summary>
    public bool StartPostgresProcess { get; init; }
    public int? HttpsPort { get; init; }
    public int? HttpPort { get; init; }
    public int? DbPort { get; init; }
    public string? ServerExePath { get; init; }
}

/// <summary>
/// Sunucu kurulumunu idempotent biçimde hazırlar. Her adım yeniden çalıştırılabilir; mevcut veri silinmez.
/// </summary>
public sealed class Provisioner
{
    readonly PmsPaths _paths;
    readonly Action<string> _log;

    public Provisioner(PmsPaths paths, Action<string> log)
    {
        _paths = paths;
        _log = log;
    }

    public async Task RunAsync(ProvisionOptions o, CancellationToken ct = default)
    {
        _paths.EnsureDirectories();
        // Yeniden kurulum/onarım: yapılandırma okunmadan önce veri klasörü izinleri düzeltilir.
        if (o.InstallServices && OperatingSystem.IsWindows()) HardenAcls();
        var config = ServerConfig.Load(_paths);
        var firstConfig = !File.Exists(_paths.ServerConfigFile);
        if (o.DbPort is { } dbp) config.DbPort = dbp;
        if (o.HttpsPort is { } hp) config.HttpsPort = hp;
        else if (firstConfig && !IsTcpPortFree(config.HttpsPort)) config.HttpsPort = 8443;
        if (o.HttpPort is { } hpp) config.HttpPort = hpp;
        else if (firstConfig && !IsTcpPortFree(config.HttpPort)) config.HttpPort = 8080;
        config.Save(_paths);
        _log($"Yapılandırma: HTTPS {config.HttpsPort}, HTTP {config.HttpPort}, DB 127.0.0.1:{config.DbPort}");

        var secrets = new SecretStore(_paths);
        var superPwd = secrets.GetOrCreate(SecretStore.DbSuperPassword);
        secrets.GetOrCreate(SecretStore.DbOwnerPassword);
        secrets.GetOrCreate(SecretStore.DbAppPassword);
        secrets.GetOrCreate(SecretStore.ManageToken, 48);

        var pg = new PostgresTools(_paths, config, secrets);
        if (!File.Exists(pg.Exe("initdb")))
            throw new InvalidOperationException($"PostgreSQL araçları bulunamadı: {_paths.PgBinDir}");

        if (!File.Exists(Path.Combine(_paths.PgDataDir, "PG_VERSION")))
            await InitDbAsync(pg, superPwd, ct);
        WritePostgresConfig(config);

        if (o.InstallServices && !OperatingSystem.IsWindows())
            throw new InvalidOperationException("Linux'ta systemd servisleri install.sh tarafından kurulur.");
        if (o.InstallServices && OperatingSystem.IsWindows())
        {
            HardenAcls();
            await RegisterPostgresServiceAsync(pg, ct);
            StartService(PmsConstants.PostgresServiceName);
        }
        else if (o.StartPostgresProcess)
        {
            await StartPostgresProcessAsync(pg, ct);
        }

        await WaitForPostgresAsync(pg, ct);
        await EnsureRolesAndDatabaseAsync(pg, config, secrets, ct);

        new CertificateManager(_paths, secrets).EnsureCertificates();
        _log("Yerel HTTPS sertifikaları hazır.");

        if (!File.Exists(_paths.SetupTokenFile))
        {
            // İlk kurulum sihirbazı LAN'daki rastgele bir kullanıcı tarafından ele geçirilmesin diye
            // sunucu ekranında görünen tek kullanımlık kod gerekir.
            File.WriteAllText(_paths.SetupTokenFile, SetupCode());
        }

        if (o.InstallServices && OperatingSystem.IsWindows())
        {
            var exe = o.ServerExePath ?? Path.Combine(_paths.InstallDir, "HotelPms.Server.exe");
            RegisterPmsService(exe);
        }
        if (o.ConfigureFirewall && OperatingSystem.IsWindows()) ConfigureFirewall(config);
        _log("Hazırlık tamamlandı.");
    }

    static string SetupCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(10);
        var sb = new StringBuilder();
        for (var i = 0; i < bytes.Length; i++)
        {
            if (i is 5) sb.Append('-');
            sb.Append(alphabet[bytes[i] % alphabet.Length]);
        }
        return sb.ToString();
    }

    async Task InitDbAsync(PostgresTools pg, string superPwd, CancellationToken ct)
    {
        _log("PostgreSQL veri dizini oluşturuluyor (initdb)...");
        // Windows'ta initdb yönetici yetkisini bırakıp kısıtlı belirteçle (Administrators devre dışı) çalışır. Veri kökü yalnız
        // SYSTEM ve Administrators'a açık olduğundan, işlem süresince yalnız pgdata ve parola dosyasına çalışan kullanıcıya izin verilir.
        Directory.CreateDirectory(_paths.PgDataDir);
        var pwFile = Path.Combine(_paths.ConfigDir, $"pw-{Guid.NewGuid():N}.tmp");
        await File.WriteAllTextAsync(pwFile, superPwd, ct);
        var userSid = OperatingSystem.IsWindows() ? System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value : null;
        if (userSid is not null)
        {
            RunProcess("icacls", _paths.PgDataDir, "/grant", $"*{userSid}:(OI)(CI)F", "/C", "/Q");
            RunProcess("icacls", pwFile, "/grant", $"*{userSid}:R", "/C", "/Q");
        }
        try
        {
            var common = new List<string> { "-D", _paths.PgDataDir, "-U", "postgres", "--pwfile", pwFile, "-E", "UTF8", "-A", "scram-sha-256" };
            // ICU tr-TR: Türkçe sıralama ve ı/İ büyük-küçük harf dönüşümü doğru çalışır.
            var r = await pg.RunAsync("initdb", [.. common, "--locale-provider=icu", "--icu-locale=tr-TR", "--locale=C"], null, ct);
            if (!r.Success)
            {
                _log("ICU yerel ayarı kullanılamadı (" + r.StdErr.Split('\n').FirstOrDefault(l => l.Contains("FATAL") || l.Contains("error"))?.Trim() + "), C yerel ayarıyla tekrar deneniyor.");
                // Klasör silinmez (izni korunur), yalnız yarım kalan içerik temizlenir. Tamamlanmış küme (PG_VERSION) varsa dokunulmaz.
                if (!File.Exists(Path.Combine(_paths.PgDataDir, "PG_VERSION")))
                    foreach (var e in new DirectoryInfo(_paths.PgDataDir).EnumerateFileSystemInfos())
                        if (e is DirectoryInfo d) d.Delete(true); else e.Delete();
                r = await pg.RunAsync("initdb", [.. common, "--locale=C"], null, ct);
            }
            if (!r.Success) throw new InvalidOperationException("initdb başarısız: " + r.StdErr);
        }
        finally
        {
            File.Delete(pwFile);
            if (userSid is not null) RunProcess("icacls", _paths.PgDataDir, "/remove:g", $"*{userSid}", "/C", "/Q");
        }
    }

    void WritePostgresConfig(ServerConfig config)
    {
        var auto = Path.Combine(_paths.PgDataDir, "postgresql.auto.conf");
        // ALTER SYSTEM dosyasını doğrudan yazıyoruz; PostgreSQL bu dosyayı postgresql.conf'tan sonra okur.
        var conf = $"""
            # HotelPMS tarafından yönetilir. PostgreSQL yalnız bu bilgisayardan erişilebilir.
            listen_addresses = '127.0.0.1'
            port = {config.DbPort}
            password_encryption = 'scram-sha-256'
            max_connections = 200
            shared_buffers = '256MB'
            work_mem = '16MB'
            maintenance_work_mem = '128MB'
            timezone = 'UTC'
            log_timezone = 'UTC'
            logging_collector = on
            log_directory = 'log'
            log_filename = 'postgresql-%a.log'
            log_truncate_on_rotation = on
            log_rotation_age = '1d'
            log_min_duration_statement = 2000
            log_statement = 'none'
            idle_in_transaction_session_timeout = '10min'
            """;
        File.WriteAllText(auto, conf.Replace("\r\n", "\n") + "\n", new UTF8Encoding(false));
        var hba = """
            # HotelPMS: yalnız yerel bağlantı. LAN istemcileri PostgreSQL'e doğrudan bağlanamaz.
            # TYPE  DATABASE  USER  ADDRESS        METHOD
            host    all       all   127.0.0.1/32   scram-sha-256
            host    all       all   ::1/128        scram-sha-256
            """;
        File.WriteAllText(Path.Combine(_paths.PgDataDir, "pg_hba.conf"), hba.Replace("\r\n", "\n") + "\n", new UTF8Encoding(false));
    }

    async Task StartPostgresProcessAsync(PostgresTools pg, CancellationToken ct)
    {
        var status = await pg.RunAsync("pg_ctl", ["status", "-D", _paths.PgDataDir], null, ct);
        if (status.ExitCode == 0) return;
        _log("PostgreSQL başlatılıyor (pg_ctl)...");
        var r = await pg.RunAsync("pg_ctl", ["start", "-D", _paths.PgDataDir, "-w", "-t", "60",
            "-l", Path.Combine(_paths.LogsDir, "postgres-startup.log")], null, ct, redirect: false);
        if (!r.Success) throw new InvalidOperationException("PostgreSQL başlatılamadı. Ayrıntı: " + Path.Combine(_paths.LogsDir, "postgres-startup.log"));
    }

    [SupportedOSPlatform("windows")]
    async Task RegisterPostgresServiceAsync(PostgresTools pg, CancellationToken ct)
    {
        if (ServiceExists(PmsConstants.PostgresServiceName)) return;
        _log("PostgreSQL Windows servisi kaydediliyor...");
        var r = await pg.RunAsync("pg_ctl", ["register", "-N", PmsConstants.PostgresServiceName,
            "-U", @"NT AUTHORITY\NetworkService", "-D", _paths.PgDataDir, "-S", "auto", "-w"], null, ct);
        if (!r.Success) throw new InvalidOperationException("PostgreSQL servisi kaydedilemedi: " + r.StdErr);
        RunSc("failure", PmsConstants.PostgresServiceName, "reset=", "86400", "actions=", "restart/5000/restart/10000/restart/30000");
        RunSc("description", PmsConstants.PostgresServiceName, "HotelPMS yerel veritabani (yalniz 127.0.0.1)");
    }

    [SupportedOSPlatform("windows")]
    void RegisterPmsService(string exePath)
    {
        if (!ServiceExists(PmsConstants.ServiceName))
        {
            _log("HotelPMS Server servisi kaydediliyor...");
            RunSc("create", PmsConstants.ServiceName, "binPath=", $"\"{exePath}\" --service", "start=", "auto",
                "DisplayName=", PmsConstants.ServiceDisplayName, "depend=", PmsConstants.PostgresServiceName);
        }
        // Recovery: 1., 2. ve sonraki hatalarda yeniden başlat.
        RunSc("failure", PmsConstants.ServiceName, "reset=", "86400", "actions=", "restart/5000/restart/10000/restart/30000");
        RunSc("failureflag", PmsConstants.ServiceName, "1");
        RunSc("description", PmsConstants.ServiceName, "HotelPMS yerel otel yonetim sunucusu (API, gercek zamanli, yedekleme)");
        StartService(PmsConstants.ServiceName);
    }

    [SupportedOSPlatform("windows")]
    void HardenAcls()
    {
        // Veri kökü: yalnız SYSTEM ve Administrators; PostgreSQL servis hesabı (NETWORK SERVICE) yalnız pgdata ve logs üzerinde yazabilir.
        // İzinler yalnız klasörlere verilir, dosya ve alt klasörler devralır. (OI)(CI) bayrakları /T ile dosyalara uygulanırsa
        // dosyada devralma kaldırılıp izin eklenemez ve erişim listesi boş kalır; önceki kurulumlarda kalmış böyle dosyalar /reset ile onarılır.
        RunProcess("icacls", _paths.DataRoot, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/C", "/Q");
        RunProcess("icacls", Path.Combine(_paths.DataRoot, "*"), "/reset", "/T", "/C", "/Q");
        RunProcess("icacls", _paths.DataRoot, "/grant", "*S-1-5-20:RX", "/C", "/Q");
        if (Directory.Exists(_paths.PgDataDir)) RunProcess("icacls", _paths.PgDataDir, "/grant", "*S-1-5-20:(OI)(CI)M", "/C", "/Q");
        RunProcess("icacls", _paths.LogsDir, "/grant", "*S-1-5-20:(OI)(CI)M", "/C", "/Q");
    }

    void ConfigureFirewall(ServerConfig config)
    {
        _log("Windows Firewall kuralları (yalnız PMS portları, Private/Domain profili)...");
        foreach (var (name, proto, port) in new[]
        {
            ("HotelPMS HTTPS", "TCP", config.HttpsPort),
            ("HotelPMS HTTP (yonlendirme)", "TCP", config.HttpPort),
            ("HotelPMS Kesif", "UDP", config.DiscoveryPort),
        })
        {
            RunProcess("netsh", "advfirewall", "firewall", "delete", "rule", $"name={name}");
            RunProcess("netsh", "advfirewall", "firewall", "add", "rule", $"name={name}", "dir=in", "action=allow",
                $"protocol={proto}", $"localport={port}", "profile=private,domain");
        }
    }

    async Task WaitForPostgresAsync(PostgresTools pg, CancellationToken ct)
    {
        for (var i = 0; i < 60; i++)
        {
            try
            {
                await using var c = new NpgsqlConnection(pg.SuperConnectionString());
                await c.OpenAsync(ct);
                return;
            }
            catch (NpgsqlException) { await Task.Delay(1000, ct); }
            catch (System.Net.Sockets.SocketException) { await Task.Delay(1000, ct); }
        }
        throw new InvalidOperationException("PostgreSQL 60 saniye içinde hazır olmadı.");
    }

    async Task EnsureRolesAndDatabaseAsync(PostgresTools pg, ServerConfig config, SecretStore secrets, CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(pg.SuperConnectionString());
        await c.OpenAsync(ct);
        async Task Exec(string sql)
        {
            await using var cmd = new NpgsqlCommand(sql, c);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        async Task<bool> Exists(string sql, string name)
        {
            await using var cmd = new NpgsqlCommand(sql, c);
            cmd.Parameters.AddWithValue(name);
            return await cmd.ExecuteScalarAsync(ct) is not null;
        }
        // Rol adları sabit (yapılandırmadan), parolalar quote_literal ile sunucu tarafında kaçırılır.
        foreach (var (role, pwdKey) in new[] { (config.DbOwnerUser, SecretStore.DbOwnerPassword), (config.DbAppUser, SecretStore.DbAppPassword) })
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(role, "^[a-z_][a-z0-9_]{0,40}$"))
                throw new InvalidOperationException("Geçersiz rol adı: " + role);
            var pwd = secrets.Get(pwdKey);
            await using (var q = new NpgsqlCommand("SELECT quote_literal($1)", c))
            {
                q.Parameters.AddWithValue(pwd);
                var lit = (string)(await q.ExecuteScalarAsync(ct))!;
                if (await Exists("SELECT 1 FROM pg_roles WHERE rolname = $1", role))
                    await Exec($"ALTER ROLE {role} WITH LOGIN PASSWORD {lit}");
                else
                    await Exec($"CREATE ROLE {role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {lit}");
            }
        }
        if (!System.Text.RegularExpressions.Regex.IsMatch(config.DbName, "^[a-z_][a-z0-9_]{0,40}$"))
            throw new InvalidOperationException("Geçersiz veritabanı adı");
        if (!await Exists("SELECT 1 FROM pg_database WHERE datname = $1", config.DbName))
        {
            _log("Veritabanı oluşturuluyor...");
            await Exec($"CREATE DATABASE {config.DbName} OWNER {config.DbOwnerUser} ENCODING 'UTF8' TEMPLATE template0");
        }
        await Exec($"REVOKE ALL ON DATABASE {config.DbName} FROM PUBLIC");
        await Exec($"GRANT CONNECT, TEMPORARY ON DATABASE {config.DbName} TO {config.DbAppUser}");
        // Yedekten geri dönüş için owner rolünün geçici veritabanı oluşturabilmesi gerekir.
        await Exec($"ALTER ROLE {config.DbOwnerUser} CREATEDB");
        await Exec($"GRANT {config.DbAppUser} TO {config.DbOwnerUser}");
    }

    public static bool IsTcpPortFree(int port) =>
        IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().All(e => e.Port != port);

    public static bool ServiceExists(string name)
    {
        if (!OperatingSystem.IsWindows()) return false;
        foreach (var s in System.ServiceProcess.ServiceController.GetServices())
            if (s.ServiceName.Equals(name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    [SupportedOSPlatform("windows")]
    void StartService(string name)
    {
        using var sc = new System.ServiceProcess.ServiceController(name);
        if (sc.Status == System.ServiceProcess.ServiceControllerStatus.Running) return;
        _log($"{name} başlatılıyor...");
        sc.Start();
        sc.WaitForStatus(System.ServiceProcess.ServiceControllerStatus.Running, TimeSpan.FromSeconds(90));
    }

    void RunSc(params string[] args) => RunProcess("sc.exe", args);

    void RunProcess(string file, params string[] args)
    {
        var psi = new ProcessStartInfo(file) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        p.StandardOutput.ReadToEnd();
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0 && !(file == "netsh" && args.Contains("delete")))
            _log($"Uyarı: {file} {args.FirstOrDefault()} çıkış kodu {p.ExitCode} {err.Trim()}");
    }
}
