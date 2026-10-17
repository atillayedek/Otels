using System.Text.Json;
using System.Text.Json.Serialization;

namespace HotelPms.Shared;

/// <summary>Altyapı ayarları (port, yedek klasörü vb.). İşletme ayarları veritabanındadır. Gizli değer içermez.</summary>
public sealed class ServerConfig
{
    public string ServerName { get; set; } = Environment.MachineName;
    public int HttpsPort { get; set; } = 443;
    public int HttpPort { get; set; } = 80;
    public int DiscoveryPort { get; set; } = PmsConstants.DiscoveryPort;
    /// <summary>Misafir Wi-Fi girişi (RADIUS) portları. Yalnız Yönetim → Wi-Fi Girişi açıkken dinlenir.</summary>
    public int RadiusAuthPort { get; set; } = 1812;
    public int RadiusAcctPort { get; set; } = 1813;
    public string DbHost { get; set; } = "127.0.0.1";
    public int DbPort { get; set; } = 54329;
    public string DbName { get; set; } = "hotelpms";
    public string DbOwnerUser { get; set; } = "hotelpms_owner";
    public string DbAppUser { get; set; } = "hotelpms_app";
    public string DbSuperUser { get; set; } = "postgres";
    public BackupPolicy Backup { get; set; } = new();
    /// <summary>Disk boş alanı bu değerin altına inerse yazma işlemleri reddedilir (MB).</summary>
    public long CriticalFreeDiskMb { get; set; } = 1024;
    public long WarningFreeDiskMb { get; set; } = 5120;
    public long MaxUploadBytes { get; set; } = 10 * 1024 * 1024;
    public long MaxImportBytes { get; set; } = 200L * 1024 * 1024;
    /// <summary>Güncelleme denetimi için isteğe bağlı adres. Boşsa çevrimdışı modda yalnız manuel paket kullanılır.</summary>
    public string? UpdateFeedUrl { get; set; }

    static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static ServerConfig Load(PmsPaths paths)
    {
        if (!File.Exists(paths.ServerConfigFile)) return new ServerConfig();
        var text = File.ReadAllText(paths.ServerConfigFile);
        return JsonSerializer.Deserialize<ServerConfig>(text, Json) ?? new ServerConfig();
    }

    public void Save(PmsPaths paths)
    {
        Directory.CreateDirectory(paths.ConfigDir);
        var tmp = paths.ServerConfigFile + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
        File.Move(tmp, paths.ServerConfigFile, overwrite: true);
    }
}

public sealed class BackupPolicy
{
    /// <summary>off | daily | weekly | monthly</summary>
    public string Schedule { get; set; } = "daily";
    /// <summary>Yerel saat HH:mm</summary>
    public string Time { get; set; } = "03:00";
    public DayOfWeek WeeklyDay { get; set; } = DayOfWeek.Sunday;
    public int MonthlyDay { get; set; } = 1;
    public string? PrimaryDirectory { get; set; }
    /// <summary>İkincil disk veya ağ klasörü (\\server\share). Erişilemezse hata raporlanır, PMS çalışmaya devam eder.</summary>
    public string? SecondaryDirectory { get; set; }
    public int KeepScheduled { get; set; } = 14;
    public int KeepManual { get; set; } = 20;
    public int KeepSystem { get; set; } = 10;
}

public static class PmsConstants
{
    public const string ProductName = "HotelPMS";
    public const string DisplayName = "Ferrolit PMS";
    public const string Vendor = "TSDMR Digital Studio";
    public const string SupportEmail = "iletisim@tsdmrdigitalstudio.com.tr";
    public const string ServiceName = "HotelPMSServer";
    public const string ServiceDisplayName = "HotelPMS Server Service";
    public const string PostgresServiceName = "HotelPMS-PostgreSQL";
    public const int DiscoveryPort = 47820;
    public const string DiscoveryRequest = "HOTELPMS_DISCOVER_V1";
    public const string ManageTokenHeader = "X-PMS-Manage-Token";

    /// <summary>Uygulama sürümü. Installer ve güncelleme paketleri bu değeri kullanır.</summary>
    public static readonly Version Version = typeof(PmsConstants).Assembly.GetName().Version ?? new Version(1, 0, 0);
    public static string VersionText => $"{Version.Major}.{Version.Minor}.{Version.Build}";

    /// <summary>Bu sunucuyla çalışabilen en eski istemci sürümü.</summary>
    public static readonly Version MinClientVersion = new(1, 0, 0);
}
