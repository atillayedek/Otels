using System.Diagnostics;
using System.Drawing.Printing;
using System.Runtime.Versioning;

namespace HotelPms.Server.Modules.Printing;

public sealed record PrinterInfo(string Name, bool IsDefault);

/// <summary>
/// Sunucuya kurulu yazıcıları listeler (Windows yazdırma biriktiricisi; Linux'ta CUPS). Belgeler PMS Client'ta
/// hazırlanıp yazdırılır; varsayılan yazıcı eşlemeleri ayarlarda (print.default_printers) tutulur.
/// </summary>
public static class PrinterService
{
    public static IReadOnlyList<PrinterInfo> InstalledPrinters()
    {
        try { return OperatingSystem.IsWindows() ? Windows() : Cups(); }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or PlatformNotSupportedException or IOException)
        {
            // Yazdırma hizmeti kapalıysa liste boş döner; PMS çalışmaya devam eder.
            return [];
        }
    }

    [SupportedOSPlatform("windows")]
    static IReadOnlyList<PrinterInfo> Windows()
    {
        var def = new PrinterSettings().PrinterName;
        return PrinterSettings.InstalledPrinters.Cast<string>().Select(p => new PrinterInfo(p, p == def)).OrderBy(p => p.Name).ToList();
    }

    static IReadOnlyList<PrinterInfo> Cups()
    {
        if (!File.Exists("/usr/bin/lpstat")) return [];
        string Run(string args)
        {
            var psi = new ProcessStartInfo("lpstat", args) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.Environment["LANG"] = "C";
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            return o;
        }
        var def = Run("-d").Split(':').ElementAtOrDefault(1)?.Trim();
        return Run("-e").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(n => new PrinterInfo(n, n == def)).OrderBy(p => p.Name).ToList();
    }
}
