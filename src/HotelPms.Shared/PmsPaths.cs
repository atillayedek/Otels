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
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "HotelPMS"));
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
    public string PgBinDir => Environment.GetEnvironmentVariable("HOTELPMS_PG_BIN") is { Length: > 0 } env
        ? env
        : Path.Combine(InstallDir, "pgsql", "bin");

    public string WebRoot => Environment.GetEnvironmentVariable("HOTELPMS_WEB_ROOT") is { Length: > 0 } env
        ? env
        : Path.Combine(InstallDir, "wwwroot");

    public void EnsureDirectories()
    {
        foreach (var d in new[] { ConfigDir, CertsDir, LogsDir, StorageDir, ImportsDir, DefaultBackupDir, UpdatesDir })
            Directory.CreateDirectory(d);
    }
}
