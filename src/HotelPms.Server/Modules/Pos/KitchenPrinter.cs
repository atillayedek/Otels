using System.Net.Sockets;
using System.Text;

namespace HotelPms.Server.Modules.Pos;

public sealed record KitchenPrinterConfig(Guid Id, string Name, string Host, int Port, string CodePage, int LineWidth);
public sealed record KitchenTicketLine(decimal Quantity, string Name, string? Note);
public sealed record KitchenTicket(string Outlet, long CheckNo, string? Table, int Covers, string Waiter, DateTime At,
    IReadOnlyList<KitchenTicketLine> Items, IReadOnlyList<KitchenTicketLine> Cancelled, bool IsTest = false);

/// <summary>
/// Ağ üzerindeki fiş yazıcısına (ESC/POS, genellikle TCP 9100) doğrudan sipariş fişi gönderir. Sunucu hizmeti olarak çalışırken
/// Windows yazdırma biriktiricisine bağımlı değildir. Türkçe karakterler PC857 kod sayfasıyla (ESC t 13) basılır;
/// bu kod sayfasını desteklemeyen yazıcılar için ASCII seçeneği Türkçe harfleri en yakın Latin harfiyle yazar.
/// </summary>
public static class KitchenPrinter
{
    static readonly TimeSpan Timeout = TimeSpan.FromSeconds(4);

    static KitchenPrinter() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static async Task SendAsync(KitchenPrinterConfig p, KitchenTicket t, CancellationToken ct = default)
    {
        var data = Build(p, t);
        using var client = new TcpClient();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Timeout);
        try
        {
            await client.ConnectAsync(p.Host, p.Port, cts.Token);
            await using var s = client.GetStream();
            await s.WriteAsync(data, cts.Token);
            await s.FlushAsync(cts.Token);
        }
        catch (Exception ex) when (ex is SocketException or OperationCanceledException or IOException)
        {
            throw new IOException($"{p.Name} ({p.Host}:{p.Port}) yazıcısına ulaşılamadı.", ex);
        }
    }

    static byte[] Build(KitchenPrinterConfig p, KitchenTicket t)
    {
        var ascii = p.CodePage == "ASCII";
        var enc = ascii ? Encoding.ASCII : Encoding.GetEncoding(857);
        var w = p.LineWidth;
        var buf = new List<byte>();
        void Raw(params byte[] b) => buf.AddRange(b);
        void Text(string s) => buf.AddRange(enc.GetBytes(ascii ? ToAscii(s) : s));
        void Line(string s = "") { Text(s); Raw(0x0A); }
        void Bold(bool on) => Raw(0x1B, 0x45, (byte)(on ? 1 : 0));
        void Size(bool big) => Raw(0x1D, 0x21, (byte)(big ? 0x11 : 0x00));     // GS ! n: çift en/boy
        void Align(int a) => Raw(0x1B, 0x61, (byte)a);                           // 0 sol, 1 orta

        Raw(0x1B, 0x40);                                    // ESC @ başlat
        if (!ascii) Raw(0x1B, 0x74, 13);                    // ESC t 13: PC857 Türkçe
        Align(1); Size(true); Bold(true);
        Line(t.IsTest ? "DENEME FİŞİ" : t.Items.Count == 0 && t.Cancelled.Count > 0 ? "İPTAL" : "SİPARİŞ");
        Size(false); Line(t.Outlet); Bold(false);
        Align(0);
        Line(new string('-', w));
        Size(true); Bold(true);
        Line(t.Table is null ? $"#{t.CheckNo}" : $"MASA {t.Table}");
        Size(false); Bold(false);
        Line(Fit($"Adisyon #{t.CheckNo} - {t.Covers} kişi", $"{t.At:HH:mm}", w));
        Line($"Garson: {t.Waiter}");
        Line(new string('-', w));
        foreach (var i in t.Items)
        {
            Size(true); Bold(true);
            Line(Wrap($"{Qty(i.Quantity)} x {i.Name}", w / 2));
            Size(false); Bold(false);
            if (!string.IsNullOrWhiteSpace(i.Note)) Line(Wrap("  >> " + i.Note, w));
        }
        if (t.Cancelled.Count > 0)
        {
            if (t.Items.Count > 0) Line(new string('-', w));
            Bold(true); Line("*** İPTAL ***"); Bold(false);
            foreach (var i in t.Cancelled)
            {
                Size(true); Line(Wrap($"{Qty(i.Quantity)} x {i.Name}", w / 2)); Size(false);
                if (!string.IsNullOrWhiteSpace(i.Note)) Line(Wrap("  Gerekçe: " + i.Note, w));
            }
        }
        if (t.IsTest) { Line("Türkçe: ÇĞİÖŞÜ çğıöşü"); Line($"Satır genişliği: {w} karakter"); }
        Line(new string('-', w));
        Line(); Line(); Line();
        Raw(0x1D, 0x56, 66, 0);                             // GS V B 0: kağıdı besle ve kes
        return buf.ToArray();
    }

    static string Qty(decimal q) => q == decimal.Truncate(q) ? ((int)q).ToString() : q.ToString("0.###", System.Globalization.CultureInfo.GetCultureInfo("tr-TR"));

    static string Fit(string left, string right, int w) =>
        left.Length + right.Length + 1 > w ? left[..Math.Max(0, w - right.Length - 1)] + " " + right : left + new string(' ', w - left.Length - right.Length) + right;

    /// <summary>Uzun satırları kelime sınırından böler (yazıcı otomatik kaydırır ama kelimeyi ortadan keser).</summary>
    static string Wrap(string s, int w)
    {
        if (s.Length <= w) return s;
        var sb = new StringBuilder();
        var line = new StringBuilder();
        foreach (var word in s.Split(' '))
        {
            if (line.Length > 0 && line.Length + word.Length + 1 > w) { sb.Append(line).Append('\n'); line.Clear().Append("    "); }
            if (line.Length > 0 && line[^1] != ' ') line.Append(' ');
            line.Append(word);
        }
        return sb.Append(line).ToString();
    }

    static string ToAscii(string s)
    {
        var map = new Dictionary<char, char> { ['ç'] = 'c', ['Ç'] = 'C', ['ğ'] = 'g', ['Ğ'] = 'G', ['ı'] = 'i', ['İ'] = 'I', ['ö'] = 'o', ['Ö'] = 'O', ['ş'] = 's', ['Ş'] = 'S', ['ü'] = 'u', ['Ü'] = 'U', ['·'] = '-' };
        var sb = new StringBuilder(s.Length);
        foreach (var c in s) sb.Append(map.TryGetValue(c, out var r) ? r : c < 128 ? c : '?');
        return sb.ToString();
    }
}
