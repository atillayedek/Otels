namespace HotelPms.Manager;

static class Program
{
    [STAThread]
    static void Main()
    {
        using var single = new Mutex(true, @"Global\HotelPMS.ServerManager", out var first);
        if (!first)
        {
            MessageBox.Show("PMS Server Manager zaten açık.", "PMS Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => ShowError(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => { if (e.ExceptionObject is Exception ex) ShowError(ex); };

        MainForm form;
        try { form = new MainForm(); }
        catch (Exception ex) { ShowError(ex); return; }
        Application.Run(form);
    }

    /// <summary>Beklenmeyen hatada pencere kapanmadan önce anlaşılır mesaj gösterilir; teknik ayrıntı yalnız tür adıyla verilir.</summary>
    static void ShowError(Exception ex)
    {
        var text = ex switch
        {
            UnauthorizedAccessException => "Sunucu ayar dosyalarına erişilemedi. PMS Server Manager'ı yönetici olarak çalıştırın (sağ tık → Yönetici olarak çalıştır).",
            IOException io => "Sunucu dosyaları okunamadı: " + io.Message,
            _ => $"Beklenmeyen bir hata oluştu ({ex.GetType().Name}). Sunucu günlüğünü kontrol edin.",
        };
        MessageBox.Show(text, "PMS Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
