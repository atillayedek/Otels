using HotelPms.Server.Infrastructure;
using HotelPms.Server.Modules.Backup;
using HotelPms.Server.Modules.Platform;
using HotelPms.Shared;
using Microsoft.Extensions.Logging.Abstractions;

namespace HotelPms.Server;

/// <summary>
/// Komut satırı: installer ve Server Manager tarafından kullanılır.
///   provision [--install-services] [--firewall] [--start-postgres] [--https-port N] [--http-port N] [--db-port N] [--radius-port N]
///   backup [--kind manual|pre_update]
///   unregister            (servisleri kaldırır, VERİYİ SİLMEZ)
///   renew-cert
///   version
/// </summary>
public static class Cli
{
    public static async Task<int> RunAsync(string[] args, PmsPaths paths)
    {
        void Out(string m) => Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {m}");
        int? IntArg(string name) => args.SkipWhile(a => a != name).Skip(1).FirstOrDefault() is { } v && int.TryParse(v, out var n) ? n : null;
        string? StrArg(string name) => args.SkipWhile(a => a != name).Skip(1).FirstOrDefault();
        try
        {
            switch (args[0])
            {
                case "version":
                    Console.WriteLine(PmsConstants.VersionText);
                    return 0;
                case "provision":
                    await new Provisioner(paths, Out).RunAsync(new ProvisionOptions
                    {
                        InstallServices = args.Contains("--install-services"),
                        ConfigureFirewall = args.Contains("--firewall"),
                        StartPostgresProcess = args.Contains("--start-postgres"),
                        HttpsPort = IntArg("--https-port"),
                        HttpPort = IntArg("--http-port"),
                        DbPort = IntArg("--db-port"),
                        RadiusPort = IntArg("--radius-port"),
                        ServerExePath = Environment.ProcessPath,
                    });
                    return 0;
                case "renew-cert":
                    new CertificateManager(paths, new SecretStore(paths)).EnsureCertificates(forceServerRenew: true);
                    Out("Sunucu sertifikası yenilendi. Servisi yeniden başlatın.");
                    return 0;
                case "backup":
                {
                    var cfg = ServerConfig.Load(paths);
                    var secrets = new SecretStore(paths);
                    Db.ConfigureDapper();
                    var svc = new BackupService(paths, cfg, secrets, new HealthState(), NullLogger<BackupService>.Instance);
                    var id = await svc.CreateAsync(StrArg("--kind") ?? "manual", null, CancellationToken.None);
                    Out($"Yedek alındı: {id}");
                    return 0;
                }
                case "stop-postgres":
                {
                    var r = await new PostgresTools(paths, ServerConfig.Load(paths), new SecretStore(paths))
                        .RunAsync("pg_ctl", ["stop", "-D", paths.PgDataDir, "-m", "fast", "-w"], null);
                    Out(r.Success ? "PostgreSQL durduruldu." : "PostgreSQL durdurulamadı: " + r.StdErr);
                    return r.ExitCode;
                }
                case "unregister" when !OperatingSystem.IsWindows():
                    Out("Linux'ta kaldırma için uninstall.sh kullanın (veri korunur).");
                    return 2;
                case "unregister" when OperatingSystem.IsWindows():
                    foreach (var svc in new[] { PmsConstants.ServiceName, PmsConstants.PostgresServiceName })
                    {
                        if (!Provisioner.ServiceExists(svc)) continue;
                        using (var sc = new System.ServiceProcess.ServiceController(svc))
                        {
                            if (sc.Status != System.ServiceProcess.ServiceControllerStatus.Stopped)
                            {
                                sc.Stop();
                                sc.WaitForStatus(System.ServiceProcess.ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60));
                            }
                        }
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("sc.exe", $"delete {svc}") { CreateNoWindow = true, UseShellExecute = false })!.WaitForExit();
                        Out($"Servis kaldırıldı: {svc}");
                    }
                    foreach (var rule in new[] { "HotelPMS HTTPS", "HotelPMS HTTP (yonlendirme)", "HotelPMS Kesif", "HotelPMS WiFi RADIUS", "HotelPMS WiFi RADIUS kayit" })
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("netsh", $"advfirewall firewall delete rule name=\"{rule}\"") { CreateNoWindow = true, UseShellExecute = false })!.WaitForExit();
                    Out("Veri klasörü korunuyor: " + paths.DataRoot);
                    return 0;
            }
            return 2;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("HATA: " + ex.Message);
            return 1;
        }
    }
}
