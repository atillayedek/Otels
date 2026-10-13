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
        Application.Run(new MainForm());
    }
}
