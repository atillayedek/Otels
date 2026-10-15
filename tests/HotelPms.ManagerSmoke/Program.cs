using HotelPms.Manager;

// Sunucu Yöneticisi düğmelerinin karşılığı olan her yönetim çağrısı sırayla denenir; ilk hatada çıkış kodu 1.
var failed = 0;
async Task Step(string name, Func<Task> body)
{
    try { await body(); Console.WriteLine($"PASS {name}"); }
    catch (Exception ex) { failed++; Console.WriteLine($"FAIL {name}: {ex.GetType().Name}: {ex.Message}"); }
}

using var c = new ManageClient();
Console.WriteLine($"Veri kökü: {c.Paths.DataRoot} · port {c.Config.HttpsPort}");
ManageStatus? st = null;
await Step("Durum (Yenile düğmesi)", async () =>
{
    st = await c.StatusAsync();
    if (st.Status != "running") throw new Exception("Durum: " + st.Status);
    Console.WriteLine($"   sürüm {st.Version} · şema {st.SchemaVersion} · {st.Checks.Count} kontrol · lisans: {st.License ?? "-"}");
    foreach (var k in st.Checks.Where(k => k.Status != "healthy")) Console.WriteLine($"   UYARI {k.Name}: {k.Message}");
});
await Step("Sertifika parmak izi", () => { if (string.IsNullOrEmpty(c.CaFingerprint())) throw new Exception("boş"); return Task.CompletedTask; });
await Step("Günlük sekmesi", async () => { var l = await c.LogsAsync(800); if (l.Length == 0) throw new Exception("günlük boş"); });
await Step("Bakım: İstatistikleri güncelle", async () => await c.MaintenanceAsync("analyze"));
await Step("Bakım: Alan geri kazan (VACUUM)", async () => await c.MaintenanceAsync("vacuum"));
await Step("Bakım: Eski oturum/anahtar kayıtlarını temizle", async () => await c.MaintenanceAsync("cleanup"));
await Step("Bakım: geçersiz görev reddedilir", async () =>
{
    try { await c.MaintenanceAsync("drop"); throw new Exception("kabul edildi"); } catch (ManageException) { }
});
List<BackupFileInfo> before = [];
await Step("Yedekler sekmesi", async () => before = await c.BackupsAsync());
await Step("Şimdi yedek al", async () =>
{
    await c.BackupAsync();
    var after = await c.BackupsAsync();
    if (after.Count != before.Count + 1) throw new Exception($"yedek sayısı {before.Count} → {after.Count}");
    var newest = after.OrderByDescending(b => b.ModifiedAt).First();
    if (newest.Problem is not null) throw new Exception("yedek doğrulanamadı: " + newest.Problem);
});
await Step("Acil parola sıfırlama: zayıf parola reddedilir", async () =>
{
    try { await c.EmergencyResetAsync("e2egarson", "kisa"); throw new Exception("kabul edildi"); } catch (ManageException) { }
});
await Step("Acil parola sıfırlama: bilinmeyen kullanıcı", async () =>
{
    try { await c.EmergencyResetAsync("boyle-biri-yok", "UzunVeGucluParola-2026"); throw new Exception("kabul edildi"); } catch (ManageException) { }
});
await Step("Acil parola sıfırlama", async () => await c.EmergencyResetAsync("e2egarson", "UzunVeGucluParola-2026"));
await Step("Destek paketi oluştur", () =>
{
    var path = Path.Combine(Path.GetTempPath(), $"ferrolit-destek-test-{Guid.NewGuid():N}.zip");
    var made = SupportBundle.Create(c.Paths, c.Config, path);
    using (var zip = System.IO.Compression.ZipFile.OpenRead(made))
    {
        if (zip.Entries.Count == 0) throw new Exception("boş paket");
        if (zip.Entries.Any(e => e.Name.EndsWith(".hpbak") || e.Name.EndsWith(".pfx") || e.Name.Contains("secret", StringComparison.OrdinalIgnoreCase)))
            throw new Exception("pakette gizli dosya var");
        Console.WriteLine($"   {zip.Entries.Count} dosya: {string.Join(", ", zip.Entries.Select(e => e.FullName).Take(8))}");
    }
    File.Delete(made);
    return Task.CompletedTask;
});
await Step("Geri yükle: onay metni olmadan reddedilir", async () =>
{
    var b = (await c.BackupsAsync()).OrderByDescending(x => x.ModifiedAt).First();
    try { await c.RestoreAsync(b.Path, "evet"); throw new Exception("kabul edildi"); } catch (ManageException) { }
});
await Step("Seçili yedeği geri yükle", async () =>
{
    var b = (await c.BackupsAsync()).OrderByDescending(x => x.ModifiedAt).First();
    await c.RestoreAsync(b.Path, "GERI YUKLE");
    var s = await c.StatusAsync();
    if (!s.DatabaseReady) throw new Exception("geri yükleme sonrası veritabanı hazır değil");
});
Console.WriteLine(failed == 0 ? "Sunucu Yöneticisi: tüm adımlar geçti" : $"Sunucu Yöneticisi: {failed} adım başarısız");
return failed == 0 ? 0 : 1;
