# Sorun giderme

| Belirti | Kontrol |
|---|---|
| İstemci sunucuyu bulamıyor | Sunucu açık mı? Server Manager'da hizmet "çalışıyor" mu? Aynı ağda mısınız? Keşif yayınları engellenmiş olabilir: IP ve portu elle girin. |
| "Bağlantı kurulamadı" | Güvenlik duvarında PMS kuralı var mı (kurulum ekler)? Port doğru mu (Server Manager'da yazar)? Başka program aynı portu kullanıyor olabilir. |
| "Parmak izi eşleşmiyor" | Kaydetmeyin. Sunucu yeniden kurulduysa Server Manager'daki yeni parmak izini doğrulayıp istemcide eski bağlantıyı kaldırıp yeniden ekleyin. Kurulum yapılmadıysa ağ yöneticinize başvurun. |
| "Veritabanı geçici olarak kullanılamıyor" | Server Manager → Durum → sağlık kontrolleri. `HotelPMS-PostgreSQL` hizmeti çalışıyor mu? Disk dolu olabilir. |
| "İstemci güncellemesi gerekli" | Sunucudaki `C:\HotelPMS\client-setup\PMS-Client-Setup.exe` ile istemciyi güncelleyin. |
| Yönetici parolası unutuldu | Sunucu bilgisayarında Server Manager → Bakım → Acil parola sıfırlama. |
| Kurulum kodu sorulmuyor/kayıp | Kod yalnız ilk kurulum bitene kadar Server Manager → Durum'da görünür. |
| Gece denetimi çalışmıyor | Gece Denetimi ekranındaki kırmızı maddeleri çözün (ör. açık kasa vardiyaları ayarı). |
| Check-out yapılamıyor | Tüm folyo pencerelerinin bakiyesi sıfır olmalı; tahsilat yapın veya cari hesaba aktarın. |
| Kirli odaya giriş yapılamıyor | Odayı temiz işaretleyin veya Tesis Bilgileri → işleyiş kuralları ayarını değiştirin. |
| Hata mesajında "Hata kodu: XXXXXXXX" | Server Manager → Günlük sekmesinde bu kodu arayın; ayrıntı orada yazar. |

## Günlükler

`%ProgramData%\HotelPMS\logs\server-YYYYMMDD.log` (JSON satırları). Server Manager → Günlük sekmesi son satırları gösterir.

## Sertifika

Sunucunun IP adresi değiştiyse: `C:\HotelPMS\server\HotelPms.Server.exe renew-cert` ve hizmeti yeniden başlatın. Yerel sertifika otoritesi değişmediği için istemcilerin yeniden onay vermesi gerekmez.
