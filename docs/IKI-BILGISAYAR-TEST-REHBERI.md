# İki bilgisayarla deneme rehberi (sunucu + resepsiyon)

Aynı ağa (aynı modem/switch, kablolu veya Wi-Fi) bağlı iki Windows bilgisayar:

- **Sunucu bilgisayarı**: PMS sunucusu, veritabanı, Sunucu Yöneticisi ve PMS Client.
- **Resepsiyon bilgisayarı**: yalnız PMS Client.

Gereken dosya: `build\installer\HotelPMS-Setup-1.0.0.exe` (USB bellekle iki bilgisayara da götürün). Telefon denemesi için APK'lar sunucu kurulumundan sonra
`C:\Program Files\HotelPMS\client-setup` klasöründe olur.

Her maddenin yanındaki kutuyu deneyince işaretleyin. Beklenen sonuç tutmazsa ekran görüntüsünü ve saati not edin.

---

## 1. Sunucu bilgisayarı kurulumu

- [ ] `HotelPMS-Setup-1.0.0.exe` çalıştırın. Windows "bilinmeyen yayımcı" (SmartScreen) uyarısı çıkarsa **Ek bilgi → Yine de çalıştır**. (Kod imzalama sertifikası alınınca bu uyarı kalkar.)
- [ ] Kurulum türü: **Sunucu bilgisayarı**.
- [ ] Kurulum bitince **PMS Server Manager** açılır. Beklenen: Hizmet "Çalışıyor", Veritabanı "Hazır".
- [ ] Manager'da **Ağ** uyarısı varsa ("Ortak ağ"): **Ağı "Özel" olarak işaretle** düğmesine basın. Ortak ağda resepsiyon sunucuyu göremez.
- [ ] Manager'da görünen **HTTPS portu** (normalde 443; 443 başka programdaysa 8443) ve **sertifika parmak izini** not edin.
- [ ] Manager'daki **ilk kurulum kodunu** not edin.
- [ ] Önerilir: modemde sunucu bilgisayarına **sabit IP (DHCP rezervasyonu)** verin. Verilmese de çalışır: IP değişirse sunucu sertifikasını kendisi yeniler, resepsiyon programı sunucuyu ağda yeniden bulur.

## 2. İlk kurulum (sunucu bilgisayarındaki PMS Client'tan)

- [ ] Masaüstündeki **Ferrolit PMS**'i açın. Sunucu listede görünür (aynı bilgisayar) → seçin → bağlanın.
- [ ] Kurulum sihirbazı: kurulum kodu, otel adı ve fatura bilgileri, saat dilimi (Europe/Istanbul), para birimi, açılış iş günü, yönetici kullanıcı ve parola. Beklenen: giriş ekranına döner.
- [ ] Yönetici ile giriş yapın. **Yönetim → Lisans**: "Deneme sürümü: 30 gün kaldı" görünür (üst bantta yalnız son 14 günde uyarı çıkar).
- [ ] **Yönetim → Tesis Bilgileri**: unvan, vergi dairesi/no, adres, telefon, e-posta, **logo yükle**. Kaydet.

## 3. Resepsiyon bilgisayarı kurulumu ve bağlantı

- [ ] Aynı `HotelPMS-Setup-1.0.0.exe` → kurulum türü **İstemci bilgisayarı**.
- [ ] Ferrolit PMS'i açın. Beklenen: **ağda sunucu otomatik bulunur** (sunucu adı ve IP'si listelenir).
  - Listede yoksa: sunucunun IP'sini ve portunu elle yazın (sunucuda `ipconfig` ile görülür).
- [ ] Bağlanırken gösterilen **sertifika parmak izi**, Manager'daki ile **aynı olmalı**. Aynıysa onaylayın.
- [ ] Yönetici ile giriş yapın.
- [ ] Resepsiyon için ayrı kullanıcı açın (Yönetim → Kullanıcılar, rol: Resepsiyon), çıkış yapıp o kullanıcıyla girin. İlk girişte parola değiştirme istenir.

## 4. Temel tanımlar (resepsiyondan)

- [ ] **Oda ve oda tipleri**: oda tipi ekleyin (ör. STD, DLX), **Toplu ekle** ile odalar (ör. 101–110, 201–210).
- [ ] **Fiyat planları**: bir plan ve tarih aralığı fiyatı.
- [ ] **İşlem kodları ve ödeme tipleri**: varsayılanlar var; konaklama vergisi oranını kontrol edin.
- [ ] **Döviz kurları → TCMB kurlarını al** (internet gerekir; yalnız kur bülteni alınır, otel verisi gönderilmez).

## 5. Günlük akış (iki bilgisayarda birlikte)

- [ ] Resepsiyonda **yeni rezervasyon** (yeni misafir, T.C. kimlik no ile). Beklenen: **sunucu bilgisayarındaki ekranda da birkaç saniye içinde görünür** (anlık güncelleme).
- [ ] **Oda Rack**: odaya tıklayınca menü; kartta misafir/firma/bakiye/not görünür; **büyült/küçült**, **Yazdır**.
- [ ] **Giriş (check-in)**: kimlik zorunlu; KBS bildirim formu açılır.
- [ ] Aynı odaya **iki bilgisayardan aynı anda** giriş yapmayı deneyin. Beklenen: biri kabul, diğeri "oda dolu/değişti" uyarısı (çift kayıt olmaz).
- [ ] **Folyo**: masraf, tahsilat, indirim/düzeltme, iptal; **Yazdır** (logolu folyo çıktısı).
- [ ] **KVKK formu** ve **Onay belgesi** yazdırma.
- [ ] **Misafir kartı**: hitap, ikinci telefon, plaka, **resepsiyon uyarısı** girin → rezervasyonu açınca sarı uyarı görünür.
- [ ] **Raporlar**: bir raporu ekranda görüntüleyin, **Excel** ve **CSV** olarak kaydedin, yazdırın (logolu).
- [ ] **Gece denetimi**: eksik işlemler listelenir; kapanış yapılınca iş günü bir gün ilerler (iki bilgisayarda da).
- [ ] **Çıkış (check-out)**: bakiye varken engellenir; tahsilattan sonra çıkış.

## 6. Ağ ve dayanıklılık denemeleri

- [ ] **Sunucu yeniden başlatma**: Manager → Yeniden başlat. Resepsiyonda kısa süre kırmızı "Sunucu bağlantısı kesildi. Otomatik olarak yeniden bağlanılıyor…" bandı görünür, sonra kendiliğinden kalkar.
- [ ] **Ağ kablosu / Wi-Fi kesme**: resepsiyonun ağını 30 sn kesip geri verin. Beklenen: yeniden bağlanır, yarım kalan işlem çift kaydedilmez.
- [ ] **IP değişikliği** (isteğe bağlı): sunucuda yönetici komut isteminde `ipconfig /release` sonra `ipconfig /renew`. IP değişirse resepsiyon programı ağda sunucuyu bulup yeni adrese bağlanır (en geç bir dakika; programı kapatıp açmak da yeter).
- [ ] **Yedek**: Manager → Yedekler → Şimdi yedek al. Ardından **Seçili yedeği geri yükle** ("GERI YUKLE" yazarak). Beklenen: veriler yedek anındaki haline döner; resepsiyonda kısa süre "Sunucu bağlantısı kesildi" bandı görünür, sonra yeniden bağlanır (yedekten sonra açılan oturumlar için yeniden giriş istenebilir).
- [ ] **Destek paketi**: Manager → Destek paketi oluştur (yalnız teknik günlük içerir).

## 7. Lisans

- [ ] Lisans üreticide (`build\lisans-uretici\TSDMR-Lisans-Uretici.exe`, yalnız sizin bilgisayarınızda) müşteri/otel adı ve **Tesis Bilgileri'ne girdiğiniz vergi no** ile lisans üretin.
- [ ] PMS'te **Yönetim → Lisans → Lisans dosyası seç → Lisansı yükle**. Beklenen: "Lisanslı" ve modüller görünür; Manager'da da lisans durumu.
- [ ] Yanlış vergi nolu lisans reddedilmeli.

## 8. Telefon uygulamaları (aynı Wi-Fi'de Android)

- [ ] `Ferrolit-PMS-Android.apk` (kat hizmetleri) kurun (telefonda "bilinmeyen kaynaklardan yükleme" izni istenir) → sunucuyu bulur; bulamazsa sunucu IP'si ve portu girilir → **Kat Görevlisi** rolündeki kullanıcıyla oda durumu değiştirin → resepsiyonda anında görünür.
- [ ] `Ferrolit-Restoran-Android.apk` (garson) → adisyon açın, odaya aktarın → folyoda görünür.

## 9. Wi-Fi entegrasyonu (Wi-Fi firması yoksa yalnız ekran denemesi)

- [ ] **Yönetim → Wi-Fi Entegrasyonu**: açıp kaydedin → durum "Açık · Dinliyor".
- [ ] **Misafir bilgilerini dene**: konaklayan bir misafirin kimlik no + oda no → "Girebilir"; yanlış oda → "Giremez".
- [ ] **Wi-Fi firmasına verilecek belge** yazdırılır. (Gerçek Wi-Fi cihazıyla deneme, firma ile birlikte yapılmalıdır.)

---

## Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| Resepsiyon sunucuyu listede görmüyor | Sunucu ağı "Ortak" olabilir → Manager'da "Ağı Özel olarak işaretle". Aynı ağda olduğunuzu kontrol edin; IP'yi elle girin. |
| "Sunucuya ulaşılamıyor" | Manager'da hizmet çalışıyor mu? Antivirüs/üçüncü taraf güvenlik duvarı 443 (veya 8443) portunu engelliyor olabilir. |
| Parmak izi uyuşmuyor | Yanlış sunucuya bağlanılıyor olabilir; bağlanmayın, Manager'daki parmak izini kontrol edin. |
| Kurulum kodu hatalı | Kod Manager'da görünür; ilk kurulumdan sonra geçersiz olur. |
| Yönetici parolası unutuldu | Sunucu bilgisayarında Manager → Bakım → **Acil parola sıfırlama**. |
| "Veritabanına erişilemiyor" | Manager → Yeniden başlat; sürerse Manager → Destek paketi. |
| Yazıcı çıktısı | Folyo, form ve raporlar o bilgisayarın Windows yazdırma penceresiyle basılır; yazıcı orada seçilir. Restoran mutfak/bar fişi yazıcısı Menü ve Satış Noktaları'nda tanımlanır. |
