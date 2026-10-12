using System.Drawing.Printing;

namespace HotelPms.Server.Modules.Printing;

public sealed record PrinterInfo(string Name, bool IsDefault);

/// <summary>
/// Sunucuya kurulu Windows yazıcılarını listeler. Baskı istemci tarafında (tarayıcı veya PMS Client) yazdırma
/// iletişim kutusuyla yapılır; varsayılan yazıcı eşlemesi ayarlarda (print.default_printers) tutulur.
/// </summary>
public static class PrinterService
{
    public static IReadOnlyList<PrinterInfo> InstalledPrinters()
    {
        try
        {
            var def = new PrinterSettings().PrinterName;
            return PrinterSettings.InstalledPrinters.Cast<string>().Select(p => new PrinterInfo(p, p == def)).OrderBy(p => p.Name).ToList();
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or PlatformNotSupportedException)
        {
            // Yazdırma biriktiricisi (Spooler) kapalıysa liste boş döner; PMS çalışmaya devam eder.
            return [];
        }
    }
}
