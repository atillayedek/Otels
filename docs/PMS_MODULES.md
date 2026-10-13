# PMS modülleri

## Rezervasyon

- Durumlar: opsiyon, onaylı, konaklıyor, çıkış yaptı, iptal, no-show
- Gece bazlı fiyat (`reservation_rates`): fiyat planı + oda tipi + tarih aralığı; plan yoksa oda tipi varsayılan fiyatı. Elle fiyat `rate.override` yetkisi ister.
- Oda ataması isteğe bağlı; aynı odaya çakışan kayıt veritabanı tarafından engellenir. Son boş oda için aynı anda gelen iki istekten yalnız biri başarılı olur.
- Şirket, acente, kaynak, depozito, özel istek, ek misafirler, işlem geçmişi

## Ön büro

- Check-in: oda seçimi, temiz oda kuralı, kimlik bilgisi zorunluluğu, erken giriş
- Walk-in: rezervasyon + giriş tek işlemde
- Oda değişikliği (aynı tip / upgrade / downgrade, fiyat koruma veya yeni fiyat, gerekçe)
- Konaklama uzatma/kısaltma, no-show, iptal (gerekçeli)
- Check-out: tüm folyo pencerelerinin bakiyesi sıfır olmalı
- Oda rack ve blokaj zaman çizelgesi (sürükle-bırak ile oda atama), uyandırma kayıtları

## Folyo ve kasa

- Folyo pencereleri (misafir, şirket, acente); oda ücretinin hangi pencereye işleneceği yönlendirilebilir
- Masraf (işlem kodu, miktar, birim fiyat, KDV oranı), tahsilat, depozito, iade, indirim/allowance
- Satır iptali ve aktarımı ayrı satırlarla izlenir; satır silinmez
- Şirkete/acenteye (city ledger) aktarım ile cari hesaba borç kaydı
- Kasa vardiyası: açılış kasası, ödeme tipi ve para birimine göre döküm; TL ve her döviz için ayrı beklenen/sayılan nakit ve fark
- Dövizli tahsilat ve iade: misafirden alınan döviz ve uygulanan kur satırda saklanır, folyoya tesis para birimi karşılığı işlenir. Kur günlük girilir (**Ön Kasa → Döviz Kurları**), istenirse TCMB'nin günlük bülteninden alınır (efektif/döviz alış-satış seçilebilir; yalnız tesis para birimi TRY iken). İş gününde kur yoksa en fazla 3 gün önceki kur kullanılır. Elle kur `exchange_rate.manage` yetkisi ister.
- Fatura numarası kaydı (fatura dış e-fatura/muhasebe programında kesilir)

## Gece denetimi

Önizleme: engeller (ör. açık kasa vardiyası ayarı) ve uyarılar. Çalıştırma tek veritabanı işleminde: konaklayan odalara oda ücreti, isteğe bağlı no-show, opsiyon süresi dolan rezervasyonların isteğe bağlı iptali, günlük istatistik, iş gününün ilerlemesi. Aynı gün ikinci kez çalıştırılamaz.

**Konaklama vergisi:** Yönetim → İşlem Kodları ve Ödeme Tipleri ekranında oran girilirse (0 = kapalı) gece denetimi oda ücretinin yanına "KV" kodlu ayrı satır yazar. Fiyatlara dahil seçilirse gecelik fiyattan ayrıştırılır (net = fiyat / ((1 + KV) × (1 + KDV)), vergi = net × KV × (1 + KDV)); değilse fiyatın üstüne eklenir. Oda KDV oranı "ROOM" işlem kodundan alınır. Konaklama vergisi oda gelirine (ADR/RevPAR) ve diğer gelire dahil edilmez. Oran ve uygulama otelin mali müşaviriyle teyit edilmelidir.

**Opsiyon:** opsiyon tarihi bugün veya daha önce olan, girişi gelmemiş opsiyonlu rezervasyonlar önizlemede uyarı olarak listelenir; "Opsiyon süresi dolanları iptal et" seçiliyse gerekçeyle iptal edilir ve oda kapasitesi serbest kalır.

## Kat hizmetleri ve teknik servis

Temiz / kirli / temizleniyor / kontrol edildi, rahatsız etmeyin, kat notu, toplu güncelleme, görevler ve görevli ataması. Arıza kayıtları (öncelik, durum, görevli) ve odayı satışa kapatma (arızalı, servis dışı, bloke).

## Raporlar

Doluluk/ADR/RevPAR, geliş, çıkış, konaklayanlar, misafir listesi, no-show ve iptaller, oda durumu, kat hizmetleri, kasa, gelir/masraf dökümü, tahsilat detayı, açık folyolar, şirket ve acente carisi, üretim, misafir geçmişi, uyruk, gece denetimi geçmişi, denetim kayıtları, veri aktarım raporu. Ekranda görüntüleme, yazdırma, Excel (XLSX) ve CSV.

## Grup rezervasyonları

**Rezervasyon → Grup Rezervasyonları**: grup kartı (ad, şirket/acente, tarih, opsiyon, not) ve gruba toplu oda ekleme (oda tipi başına adet, 1–200). Ekleme ya tamamen yapılır ya hiç yapılmaz; müsaitlik yetmezse hiçbir rezervasyon oluşmaz. Fazla satış yalnız `reservation.overbook` yetkisiyle ve açık onayla yapılır. Grup içindeki rezervasyonlar normal rezervasyon gibi check-in/check-out edilir.

## Belgeler (kimlik ve sözleşme)

Misafir kartında **Kimlik ve belgeler**, rezervasyonda **Belgeler** sekmesi: kimlik kartı, pasaport, sözleşme veya fatura için PDF/JPG/PNG yüklenir. Dosya türü içerikten doğrulanır, belgeler yalnız sunucuda saklanır (internete gönderilmez), her görüntüleme ve silme denetim kaydına yazılır. Sekme `guest.identity.view` yetkisi ister.

## Bu sürümde bulunmayanlar

- Kanal yöneticisi / online satış kanalları
- E-fatura / e-arşiv entegrasyonu (fatura no elle kaydedilir)
- Kapı kilidi, santral, POS entegrasyonları
- Linux için kurulum paketi

Bu entegrasyonlar arayüzde çalışıyormuş gibi gösterilmez; **Yönetim → Entegrasyonlar** ekranında "Bu sürümde bulunmuyor" olarak listelenir.
