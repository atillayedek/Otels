namespace HotelPms.Shared;

/// <summary>
/// Sunucu dosya düzeni. Tüm kalıcı veri %ProgramData%\HotelPMS altında tutulur; uygulama kaldırılsa bile silinmez.
/// Test ve geliştirme için HOTELPMS_DATA_ROOT ortam değişkeniyle ayrı bir kök verilebilir (production verisinden izolasyon).
/// </summary>
public sealed class PmsPaths
{
    public string DataRoot { get; }
    public string InstallDir { get; }

    public PmsPaths(string? dataRoot = null, string? installDir = null)
    {
        DataRoot = Path.GetFullPath(dataRoot
            ?? Environment.GetEnvironmentVariable("HOTELPMS_DATA_ROOT")
            ?? (OperatingSystem.IsWindows()
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "HotelPMS")
                : "/var/lib/hotelpms"));
        InstallDir = Path.GetFullPath(installDir
            ?? Environment.GetEnvironmentVariable("HOTELPMS_INSTALL_DIR")
            ?? AppContext.BaseDirectory);
    }

    public string ConfigDir => Path.Combine(DataRoot, "config");
    public string ServerConfigFile => Path.Combine(ConfigDir, "server.json");
    public string SecretsFile => Path.Combine(ConfigDir, "secrets.dat");
    public string SetupTokenFile => Path.Combine(ConfigDir, "setup-token.txt");
    public string CertsDir => Path.Combine(DataRoot, "certs");
    public string CaCertFile => Path.Combine(CertsDir, "hotelpms-local-ca.crt");
    public string CaPfxFile => Path.Combine(CertsDir, "hotelpms-local-ca.pfx");
    public string ServerPfxFile => Path.Combine(CertsDir, "hotelpms-server.pfx");
    public string PgDataDir => Path.Combine(DataRoot, "pgdata");
    public string LogsDir => Path.Combine(DataRoot, "logs");
    public string StorageDir => Path.Combine(DataRoot, "storage");
    public string ImportsDir => Path.Combine(DataRoot, "imports");
    public string DefaultBackupDir => Path.Combine(DataRoot, "backups");
    public string UpdatesDir => Path.Combine(DataRoot, "updates");
    public string StatusFile => Path.Combine(DataRoot, "server-status.json");

    /// <summary>Gömülü PostgreSQL bin klasörü. Kurulumda {app}\pgsql\bin; geliştirmede HOTELPMS_PG_BIN.</summary>
    public string PgBinDir
    {
        get
        {
            if (Environment.GetEnvironmentVariable("HOTELPMS_PG_BIN") is { Length: > 0 } env) return env;
            var bundled = Path.Combine(InstallDir, "pgsql", "bin");
            if (OperatingSystem.IsWindows() || Directory.Exists(bundled)) return bundled;
            // Linux: dağıtımın PostgreSQL paketi (ör. /usr/lib/postgresql/17/bin), en yüksek sürüm.
            const string debian = "/usr/lib/postgresql";
            if (Directory.Exists(debian))
            {
                var best = Directory.GetDirectories(debian).Select(d => (Dir: d, Ok: int.TryParse(Path.GetFileName(d), out var v), V: v))
                    .Where(x => x.Ok && File.Exists(Path.Combine(x.Dir, "bin", "initdb"))).OrderByDescending(x => x.V).FirstOrDefault();
                if (best.Dir is not null) return Path.Combine(best.Dir, "bin");
            }
            return File.Exists("/usr/bin/initdb") ? "/usr/bin" : bundled;
        }
    }

    public void EnsureDirectories()
    {
        foreach (var d in new[] { ConfigDir, CertsDir, LogsDir, StorageDir, ImportsDir, DefaultBackupDir, UpdatesDir })
            Directory.CreateDirectory(d);
    }
}
