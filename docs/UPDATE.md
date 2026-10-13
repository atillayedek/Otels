# Güncelleme

1. Gün sonu (gece denetimi) tamamlandıktan sonra, kullanıcılar çalışmıyorken yapın.
2. Server Manager → Yedekler → **Şimdi yedek al**.
3. Yeni `HotelPMS-Setup-<sürüm>.exe` dosyasını sunucuda çalıştırın, **Sunucu bilgisayarı** seçin, aynı klasöre kurun.
   - Kurulum hizmetleri durdurur, program dosyalarını değiştirir, hizmetleri yeniden başlatır.
   - Veritabanı, yedekler ve ayarlar korunur.
4. Sunucu ilk açılışta şema güncellemelerini uygular; **uygulamadan önce otomatik yedek alır**. Bir şema adımı başarısız olursa işlem geri alınır ve sunucu güvenli modda (veritabanı hatası bildirerek) bekler; yedekten geri dönülebilir.
5. İstemciler: yeni sürüm sunucu daha yeni istemci gerektiriyorsa uyarı gösterir. `C:\HotelPMS\client-setup\PMS-Client-Setup.exe` her istemcide çalıştırılır.

Güncellemeler internetten otomatik indirilmez; kurulum dosyası otele elle getirilir. Dosyayla birlikte gelen `.sha256` özeti `Get-FileHash` ile doğrulanabilir.
