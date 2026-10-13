# PMS Client

Masaüstü uygulaması (`PMS-Client.exe`). Tüm PMS ekranları buradadır.

## Bağlantı

- İlk açılışta **Sunucuya bağlan** ekranı gelir. Aynı ağdaki sunucular UDP 47820 ile otomatik bulunur.
- Bulunamazsa sunucu adı/IP ve port girilir (**Sunucuyu bul**).
- Sunucunun sertifika parmak izi gösterilir; Server Manager'daki ile aynıysa kaydedilir. Bu adım, araya girme (MITM) saldırılarına karşı korur.
- Birden çok sunucu kaydedilebilir; **Yönetim → Sunucu Bağlantısı** ekranından değiştirilir ve **Bağlantıyı test et** ile sürüm, veritabanı ve gecikme kontrol edilir.
- Bağlantı koparsa üstte uyarı çıkar, istemci otomatik yeniden bağlanır.

Bağlantı ayarları `%APPDATA%\com.tsdmr.hotelpms.client\` altında tutulur; parola veya oturum anahtarı diske yazılmaz.

## Ekranlar

Sol menü ve üst hızlı erişim çubuğu kullanıcının yetkilerine göre gösterilir:

- **Gösterge paneli**: doluluk, gelişler, çıkışlar, bugünün gelirleri, bekleyen işler, 14 günlük doluluk
- **Rezervasyon**: yeni rezervasyon, liste (gelişler/çıkışlar/konaklayanlar), fiyat ve doluluk tablosu, şirketler, acenteler, fiyat planları
- **Resepsiyon**: oda rack, blokaj zaman çizelgesi (sürükle-bırak oda atama/değiştirme), walk-in, uyandırmalar, KBS
- **Misafirler**: misafir kartları, konaklama ve folyo geçmişi, kara liste
- **Ön kasa**: kasa vardiyası, açık folyolar, şirket carisi, işlem kodları ve ödeme tipleri
- **Kat hizmetleri**: oda durumları (toplu güncelleme), görevler
- **Teknik servis**: arıza kayıtları, oda blokajları
- **Gün sonu**: gece denetimi
- **Raporlar**: ekranda görüntüleme, yazdırma, Excel ve CSV
- **Yönetim**: tesis, odalar, kullanıcılar ve roller, cihazlar ve oturumlar, yedekleme, veri aktarım merkezi, yazıcılar, entegrasyonlar, denetim kayıtları, sunucu bağlantısı

## Android uygulaması (kat hizmetleri)

`TSDMR-Otel-PMS-Android.apk` sunucuda `C:\HotelPMS\client-setup` klasörüne kopyalanır. Telefona aktarılıp kurulur (Android ayarlarında bu kaynaktan uygulama yüklemeye izin verilmelidir). Telefon otelin Wi-Fi ağına bağlı olmalıdır; bağlantı ve sertifika doğrulaması masaüstü uygulamasıyla aynıdır.

Telefon arayüzü sadeleştirilmiştir: kirli odalar en üstte olmak üzere oda durumu listesi, tek dokunuşla **Temiz** / **Kontrol edildi** (yetkiye göre), kat filtresi ve arıza bildirme. Kat şefi, resepsiyon ve müdür kendi kullanıcılarıyla girer; yetkiler masaüstüyle aynıdır.

İmza anahtarı `%APPDATA%\TSDMRndroid` klasöründedir ve depoya eklenmez. Güncellemelerin eski sürümün üzerine kurulabilmesi için bu klasör yedeklenmelidir; anahtar kaybolursa telefonlardaki uygulama kaldırılıp yeniden kurulmalıdır.

## Sürüm uyumu

İstemci her istekte sürümünü bildirir. Sunucu daha yeni bir istemci sürümü gerektiriyorsa istemci güncelleme uyarısı gösterir; güncel kurulum dosyası sunucudaki `C:\HotelPMS\client-setup` klasöründedir.
