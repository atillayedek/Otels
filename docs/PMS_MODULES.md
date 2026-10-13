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
- Kasa vardiyası: açılış kasası, ödeme tipine göre döküm, beklenen ve sayılan nakit, fark
- Fatura numarası kaydı (fatura dış e-fatura/muhasebe programında kesilir)

## Gece denetimi

Önizleme: engeller (ör. açık kasa vardiyası ayarı) ve uyarılar. Çalıştırma tek veritabanı işleminde: konaklayan odalara oda ücreti, isteğe bağlı no-show, günlük istatistik, iş gününün ilerlemesi. Aynı gün ikinci kez çalıştırılamaz.

## Kat hizmetleri ve teknik servis

Temiz / kirli / temizleniyor / kontrol edildi, rahatsız etmeyin, kat notu, toplu güncelleme, görevler ve görevli ataması. Arıza kayıtları (öncelik, durum, görevli) ve odayı satışa kapatma (arızalı, servis dışı, bloke).

## Raporlar

Doluluk/ADR/RevPAR, geliş, çıkış, konaklayanlar, misafir listesi, no-show ve iptaller, oda durumu, kat hizmetleri, kasa, gelir/masraf dökümü, tahsilat detayı, açık folyolar, şirket ve acente carisi, üretim, misafir geçmişi, uyruk, gece denetimi geçmişi, denetim kayıtları, veri aktarım raporu. Ekranda görüntüleme, yazdırma, Excel (XLSX) ve CSV.

## Bu sürümde bulunmayanlar

- Kanal yöneticisi / online satış kanalları
- E-fatura / e-arşiv entegrasyonu (fatura no elle kaydedilir)
- Kapı kilidi, santral, POS entegrasyonları
- Grup rezervasyonu ekranı (veri modeli hazır, arayüzü yok)
- Linux için kurulum paketi

Bu entegrasyonlar arayüzde çalışıyormuş gibi gösterilmez; **Yönetim → Entegrasyonlar** ekranında "Bu sürümde bulunmuyor" olarak listelenir.
