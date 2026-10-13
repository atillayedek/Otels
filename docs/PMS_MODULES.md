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

## Dövizli fiyat (acente sözleşmeleri)

Fiyat planına para birimi verilebilir (ör. EUR); plan fiyatları bu dövizde girilir. Rezervasyonda "Fiyat para birimi" seçilir; plan aynı dövizde değilse gecelik fiyat elle girilir. Rezervasyondaki TL tutarlar rezervasyon anındaki kurla tahminidir; gece denetimi her gecenin oda ücretini **o günün kuruyla** TL'ye çevirerek yazar ve döviz tutarını ve kuru folyo satırında saklar (konaklama vergisi varsa döviz tutarı satırlara oransal bölünür). Dövizli konaklama varken güncel kur girilmemişse gün kapatılmaz. Uzatma ve erken girişte anlaşmalı döviz fiyatı korunur.

## Grup rezervasyonları

**Rezervasyon → Grup Rezervasyonları**: grup kartı (ad, şirket/acente, tarih, opsiyon, not) ve gruba toplu oda ekleme (oda tipi başına adet, 1–200). Ekleme ya tamamen yapılır ya hiç yapılmaz; müsaitlik yetmezse hiçbir rezervasyon oluşmaz. Fazla satış yalnız `reservation.overbook` yetkisiyle ve açık onayla yapılır. Grup içindeki rezervasyonlar normal rezervasyon gibi check-in/check-out edilir.

## Belgeler (kimlik ve sözleşme)

Misafir kartında **Kimlik ve belgeler**, rezervasyonda **Belgeler** sekmesi: kimlik kartı, pasaport, sözleşme veya fatura için PDF/JPG/PNG yüklenir. Dosya türü içerikten doğrulanır, belgeler yalnız sunucuda saklanır (internete gönderilmez), her görüntüleme ve silme denetim kaydına yazılır. Sekme `guest.identity.view` yetkisi ister.

## Acente kontenjanı (allotment)

**Rezervasyon → Acente Kontenjanları**: acente, oda tipi, tarih aralığı, günlük oda sayısı ve release süresi. Acentenin o oda tipindeki rezervasyonları kontenjandan düşer. Kullanılmayan kontenjan, gecenin release tarihine (gece − release günü) kadar diğer satışlara kapalıdır; bu tarihte serbest kalır. Acente kendi kontenjanına satış yapabilir. Kontenjan boş oda sayısını aşamaz; aynı acente ve oda tipi için çakışan aktif kontenjan tanımlanamaz. Fiyat ve Doluluk ekranında kontenjanda tutulan odalar "+nK" olarak görünür. Rapor: Acente Kontenjan Kullanımı.

## Restoran / bar (POS)

- **Menü ve Satış Noktaları**: satış noktası (restoran, bar, oda servisi…), folyo işlem kodu, stok düşülecek depo; ürünler (kategori, KDV dahil fiyat, KDV oranı, satıldığı yerler) ve reçeteler.
- **Satış Ekranı**: masa/yer ve kişi sayısıyla adisyon, kategori düğmeleriyle ürün ekleme, ürün iptali (kendi eklediği ürünü 2 dakika içinde garson, sonrasını `pos.void` yetkilisi), tutar veya yüzde indirim (gerekçeli).
- Kapanış: **Ödeme** (bölünmüş, dövizli, kasa vardiyasına işlenir, para üstü hesabı), **Odaya aktar** (konaklayan misafir; KDV oranına göre ayrı folyo satırı, indirim oransal dağıtılır), **İkram** (tamamı gerekçeli indirimle).
- Kapanmış adisyon aynı iş gününde iptal edilebilir: folyo satırları iptal edilir veya ödemeler kasadan ters kayıtla geri alınır; reçeteyle düşülen stok geri yüklenir.
- Reçeteli ürünler adisyon kapanınca satış noktasının deposundan düşülür; satış stok yetersizliğinden engellenmez (eksi stok Stok Durumu raporunda görünür).
- Açık adisyonlar gece denetiminde uyarı olarak listelenir. Doğrudan ödenen adisyonlar günlük diğer gelire ve tahsilata, odaya aktarılanlar folyo masrafı olarak dahil edilir.
- **Sipariş yazıcıları**: ağa bağlı fiş yazıcıları (ESC/POS, genellikle TCP 9100) Menü ve Satış Noktaları ekranında tanımlanır; her ürüne yazıcı atanır (boşsa fiş basılmaz). "Mutfağa gönder" yalnız gönderilmemiş ürünleri basar; gönderildikten sonra iptal edilen ürün için İPTAL fişi çıkar. Ulaşılamayan yazıcının ürünleri "gönderilmedi" olarak bekler. Türkçe karakterler PC857 kod sayfasıyla basılır; desteklemeyen yazıcıda ASCII seçilir. Fiş sunucudan doğrudan gönderilir, Windows yazıcı kurulumu gerekmez.
- **Telefon (garson)**: Android uygulamasında restoran yetkili kullanıcıya "Adisyon" sekmesi: masa açma, ürün ekleme, kendi yanlışını iptal, mutfağa gönderme. Hesap kasada kapatılır.
- Raporlar: Restoran Satışları, Ürün Satışları, Adisyon Listesi, Ürün İptalleri.

## Stok ve satın alma

- Depolar, stok kartları (birim, kategori, barkod, asgari stok, KDV), tedarikçiler.
- **Satın alma siparişi**: taslak → sipariş verildi → kısmen/tamamen teslim alındı; iptal gerekçeli.
- **Mal kabul** (siparişe bağlı veya doğrudan; fatura/irsaliye no), **çıkış** (bölüme sarf), **depolar arası transfer**, **sayım** (yalnız farklar düzeltme olarak kaydedilir).
- Maliyet ağırlıklı ortalamadır. Stok hareketleri değiştirilemez; belge iptali ters hareket yazar (tüketilmiş girişin iptali stoğu eksiye düşürecekse engellenir).
- Çıkış ve transferde stok yetersizse işlem reddedilir (`stock.allow_negative` ayarı ile açılabilir).
- Raporlar: Stok Durumu, Stok Hareketleri, Alımlar (Mal Kabul), Tüketim Özeti.

## Bu sürümde bulunmayanlar

- Kanal yöneticisi / online satış kanalları
- E-fatura / e-arşiv entegrasyonu (fatura no elle kaydedilir)
- Kapı kilidi, santral, POS entegrasyonları
- Linux için kurulum paketi

Bu entegrasyonlar arayüzde çalışıyormuş gibi gösterilmez; **Yönetim → Entegrasyonlar** ekranında "Bu sürümde bulunmuyor" olarak listelenir.
