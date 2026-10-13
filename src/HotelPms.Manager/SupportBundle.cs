using System.IO.Compression;
using System.ServiceProcess;
using System.Text;
using HotelPms.Shared;

namespace HotelPms.Manager;

/// <summary>
/// Destek paketi: son 14 günün sunucu günlükleri, kurulum günlüğü ve sistem bilgisi tek bir ZIP dosyasında.
/// Veritabanı, yedekler, belgeler, sertifika anahtarları ve parola dosyası pakete eklenmez.
/// </summary>
public static class SupportBundle
{
    public static string Create(PmsPaths paths, ServerConfig config, string targetZip)
    {
        if (File.Exists(targetZip)) File.Delete(targetZip);
        using var zip = ZipFile.Open(targetZip, ZipArchiveMode.Create);

        var info = new StringBuilder();
        info.AppendLine($"Ürün: {PmsConstants.DisplayName} {PmsConstants.VersionText}");
        info.AppendLine($"Oluşturma: {DateTime.Now:dd.MM.yyyy HH:mm:ss}");
        info.AppendLine($"Bilgisayar: {Environment.MachineName}");
        info.AppendLine($"İşletim sistemi: {Environment.OSVersion} ({(Environment.Is64BitOperatingSystem ? "64 bit" : "32 bit")})");
        info.AppendLine($".NET: {Environment.Version}");
        info.AppendLine($"Kurulum klasörü: {paths.InstallDir}");
        info.AppendLine($"Veri klasörü: {paths.DataRoot}");
        info.AppendLine($"Sunucu adı: {config.ServerName}");
        info.AppendLine($"HTTPS portu: {config.HttpsPort}");
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(paths.DataRoot)!);
            info.AppendLine($"Disk ({drive.Name}): boş {drive.AvailableFreeSpace / 1024 / 1024 / 1024} GB / toplam {drive.TotalSize / 1024 / 1024 / 1024} GB");
        }
        catch (IOException) { }
        foreach (var name in new[] { PmsConstants.ServiceName, PmsConstants.PostgresServiceName })
        {
            try { using var s = new ServiceController(name); info.AppendLine($"Hizmet {name}: {s.Status}"); }
            catch (InvalidOperationException) { info.AppendLine($"Hizmet {name}: kurulu değil"); }
        }
        AddText(zip, "sistem-bilgisi.txt", info.ToString());

        AddFile(zip, paths.StatusFile, "sunucu-durumu.json");
        AddFile(zip, Path.Combine(paths.InstallDir, "provision.log"), "kurulum/provision.log");
        if (Directory.Exists(paths.LogsDir))
        {
            var since = DateTime.Now.AddDays(-14);
            foreach (var f in Directory.EnumerateFiles(paths.LogsDir, "*", SearchOption.AllDirectories).Where(f => File.GetLastWriteTime(f) >= since))
                AddFile(zip, f, "gunluk/" + Path.GetRelativePath(paths.LogsDir, f).Replace('\\', '/'));
        }
        return targetZip;
    }

    static void AddText(ZipArchive zip, string name, string text)
    {
        using var w = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(true));
        w.Write(text);
    }

    /// <summary>Çalışan hizmetin açık tuttuğu günlük dosyaları da okunabilsin diye paylaşımlı açılır.</summary>
    static void AddFile(ZipArchive zip, string path, string entryName)
    {
        if (!File.Exists(path)) return;
        try
        {
            using var src = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var dst = zip.CreateEntry(entryName, CompressionLevel.Optimal).Open();
            src.CopyTo(dst);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
