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
- Oda Rack kartında misafir, firma/acente, giriş zamanı → çıkış tarihi, kişi sayısı, bakiye ve rezervasyon notu; firma, giriş ve çıkış tarihi filtreleri; kart boyutu (küçült/büyült) ve Rack dökümü yazdırma. Odaya tıklayınca: konaklamayı aç, masraf, tahsilat, adisyon aç, oda değişimi, uzat/kısalt, uyandırma, misafir isteği, çıkış; gelişte giriş yap; boş odada walk-in ve rezervasyon; oda durumu/notu, arıza ve satışa kapatma
- Misafir kartı: hitap, medeni hal, dil, ikinci telefon, belge seri no, belgenin verildiği yer ve tarih, ilçe, posta kodu, araç plakası ve resepsiyon uyarısı (rezervasyon ve giriş ekranında gösterilir). Bu alanlar eski programdan aktarımda da eşlenir, anonimleştirmede silinir

## Folyo ve kasa

- Folyo pencereleri (misafir, şirket, acente); oda ücretinin hangi pencereye işleneceği yönlendirilebilir
- Masraf (işlem kodu, miktar, birim fiyat, KDV oranı), tahsilat, depozito, iade, indirim/allowance
- Satır iptali ve aktarımı ayrı satırlarla izlenir; satır silinmez
- Şirkete/acenteye (city ledger) aktarım ile cari hesaba borç kaydı
- Kasa vardiyası: açılış kasası, ödeme tipi ve para birimine göre döküm; TL ve her döviz için ayrı beklenen/sayılan nakit ve fark
- Dövizli tahsilat ve iade: misafirden alınan döviz ve uygulanan kur satırda saklanır, folyoya tesis para birimi karşılığı işlenir. Kur günlük girilir (**Ön Kasa → Döviz Kurları**), istenirse TCMB'nin günlük bülteninden alınır (efektif/döviz alış-satış seçilebilir; yalnız tesis para birimi TRY iken). İş gününde kur yoksa son kur kullanılır: TCMB'nin yayım yapmadığı bayram tatilleri için en fazla 10 gün; 3 günden eski kur kullanılıyorsa gece denetimi uyarır. Elle kur `exchange_rate.manage` yetkisi ister.
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
- **Satış Ekranı**: masa/yer ve kişi sayısıyla adisyon, kategori düğmeleriyle ürün ekleme, ürün iptali (kendi eklediği ve mutfağa gönderilmemiş ürünü 2 dakika içinde garson; gönderilmiş ürünü ve sonrasını `pos.void` yetkilisi), tutar veya yüzde indirim (gerekçeli).
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

## Muhasebe

- **Hesap planı**: Tek Düzen Hesap Planı'nın otel işlemlerinde kullanılan hesapları (kasa TL/döviz, banka, kredi kartı, misafir ve cari alacakları, stok, indirilecek/hesaplanan KDV, konaklama vergisi, satıcılar, gelirler, iskontolar, kur farkları, hizmet üretim maliyeti). Alt hesaplar eklenebilir; KDV oranına göre alt hesaplar (ör. 391.10, 391.20) otomatik açılır.
- **Otomatik fiş eşlemeleri**: her işlem türünün yazılacağı hesap Muhasebe → Otomatik fiş eşlemeleri ekranından değiştirilir; işlem koduna özel gelir hesabı verilebilir.
- **Gün sonu fişi**: gece denetimi gün kapanışıyla aynı işlemde günün yevmiye fişini oluşturur: folyo masrafları (net gelir + hesaplanan KDV, konaklama vergisi), indirimler, iptaller, tahsilat ve iadeler (TL/döviz kasası, banka, kredi kartı), cari hesaba aktarımlar, restoranda doğrudan ödenen adisyonlar, stok alımları (indirilecek KDV, satıcılar), bölüm çıkışları, satış tüketimi ve sayım farkları. Dövizli tahsilattaki kuruş farkları kur farkı hesabına yazılır.
- Fişler değiştirilemez; dengesiz fiş veritabanı tarafından reddedilir. Düzeltme elle fiş veya ters fişle yapılır. Muhasebe modülünden önce kapatılmış günler için fiş sonradan oluşturulabilir.
- Raporlar (Excel'e aktarılabilir): Mizan, Mizan (ana hesaplar), Yevmiye dökümü, Hesap ekstresi (muavin). Mali müşavirin programına aktarım için Excel çıktısı kullanılır.
- Hesap eşlemeleri ve KDV/konaklama vergisi uygulaması otelin mali müşaviriyle kontrol edilmelidir.

## Günübirlik kullanım

Aynı iş gününde giriş yapıp gece denetiminden önce çıkan konaklamada o gecenin oda ücreti gece denetiminde yazılmaz. Çıkış penceresi bunu gösterir: **Günübirlik ücret işle** ile oda ücreti (ve varsa konaklama vergisi) yazılır, tahsil edilir, sonra çıkış yapılır. Ücret alınmayacaksa `rate.override` yetkili kullanıcı gerekçe yazarak ücretsiz çıkış yapar; gerekçe denetim kaydına geçer.

## Misafir hatırlatmaları ve kayıp eşya

- **Hatırlatmalar (trace):** rezervasyon ekranındaki Hatırlatmalar sekmesinden belirli bir gün ve bölüm için iş eklenir (ör. "doğum günü pastası 20:00"). Resepsiyon → Misafir Hatırlatmaları ekranı bugünün ve geciken işlerin bölüme göre listesidir; tamamlanmayanlar gece denetiminde uyarı olarak çıkar.
- **Kayıp eşya defteri** (Kat Hizmetleri → Kayıp Eşya): bulunan eşya, yer/oda, muhafaza yeri; sahibine teslimde teslim alan kişi, imha/bağışta açıklama zorunludur. Kapanan kayıt değiştirilemez.

## Rezervasyon onay belgesi ve KVKK formu

Rezervasyon ekranında **Onay belgesi** misafire veya acenteye verilecek çıktıyı (tarihler, giriş-çıkış saatleri, oda, gecelik fiyatlar, toplam, ön ödeme) yazdırır ya da PDF olarak kaydeder; altındaki not Yönetim → Tesis Bilgileri'nden düzenlenir. **KVKK formu** her misafir için aydınlatma metni, isteğe bağlı ticari ileti onayı ve imza alanı içeren formu yazdırır.

## KVKK ve kişisel veriler

Yönetim → KVKK ve Kişisel Veriler: aydınlatma ve açık rıza metni, saklama süresi (yıl) ve süresi dolan misafirlerin toplu anonimleştirilmesi. Misafir kartında **Kişisel veri dökümü** (ilgili kişi başvurusu için Excel) ve **Anonimleştir** (silme talebi; aktif rezervasyon veya açık folyo varken yapılamaz). Ayrıntı: [legal/KVKK-OTEL-REHBERI.md](legal/KVKK-OTEL-REHBERI.md).

## Lisans

Yönetim → Lisans: lisans durumu ve `.lisans` dosyasının yüklenmesi. Lisans yüklenene kadar kurulumdan itibaren 30 gün deneme süresi işler. Süre dolduğunda veya lisans geçersizse kayıtlara erişim, çıkış, tahsilat, gece denetimi, raporlar ve yedekleme çalışmaya devam eder; yalnız yeni rezervasyon, giriş, grup ve adisyon açılamaz. Lisans otelin vergi numarasına, oda sınırına ve ek modüllere (restoran, stok, muhasebe) bağlanabilir; lisansta olmayan modüller menüde görünmez.

## Bu sürümde bulunmayanlar

- Kanal yöneticisi / online satış kanalları ile otomatik bağlantı (kanal rezervasyonları kanal adı ve numarasıyla elle girilir)
- E-fatura / e-arşiv entegrasyonu (fatura no elle kaydedilir)
- Kapı kilidi ve santral entegrasyonları
- Linux için kurulum paketi

Bağlantısı olmayan entegrasyonlar arayüzde gösterilmez.

## Wi-Fi entegrasyonu (misafir internet girişi)

Yönetim → Wi-Fi Entegrasyonu. Otelin Wi-Fi sistemi başka bir firmaya aittir; firma sistemini bu ekrandaki bilgilerle (yazdırılabilir entegrasyon belgesi) bağlar. Misafir otelin Wi-Fi'sine bağlanınca hotspot cihazının giriş sayfasında **kullanıcı adı olarak T.C. kimlik numarasını** (yabancılar pasaport numarasını), **şifre olarak oda numarasını** (ayarla soyadı) yazar. Hotspot cihazı bu bilgiyi standart RADIUS protokolüyle (RFC 2865/2866) PMS sunucusuna sorar; PMS yalnız o odada **şu an konaklayan** misafir ise kabul eder. İzin, çıkış günü otelin çıkış saatine ayarlanan ek süre eklenene kadar geçerlidir (Session-Timeout); çıkış yapıldıktan sonra yeni giriş reddedilir.

- Cihaz tarafı: RADIUS destekleyen her hotspot/captive portal cihazı (MikroTik, Ruckus, UniFi, Fortinet, Cisco vb.). Sunucu IP'si, UDP 1812 (doğrulama) / 1813 (oturum kaydı), ortak anahtar ekranda gösterilir; PAP ve CHAP desteklenir. Yanıtlara Message-Authenticator eklenir.
- Güvenlik: yalnız yerel ağdan ve (tanımlıysa) izin verilen cihaz IP'lerinden gelen, ortak anahtarla doğrulanan istekler yanıtlanır. Aynı cihazdan 10 dakikada 5 hatalı denemeden sonra 10 dakika kilit. Kapalıyken port dinlenmez.
- Kayıtlar: giriş denemeleri (180 gün, bakım temizliğinde silinir) ve cihazın gönderdiği oturum kayıtları (MAC, iç IP, başlangıç/bitiş, veri miktarı). Raporlar → Sistem → **Wi-Fi Oturumları**. Misafirin kişisel veri dökümünde Wi-Fi oturumları ayrı sayfadadır.
- Ekrandaki **Misafir bilgilerini dene** ile resepsiyon, misafirin bilgileriyle girişin kabul edilip edilmeyeceğini cihaza gitmeden görür.
- 5651 sayılı Kanun kapsamındaki iç IP dağıtım kaydı ve saklama yükümlülüğünün hotspot cihazı/servis sağlayıcıyla birlikte nasıl karşılanacağını hukuk danışmanınızla netleştirin; PMS oturum kayıtlarını otomatik silmez.
- Bağlantı yöntemleri: (1) **RADIUS** — cihaz sorar; (2) **HTTP API** — firmanın giriş sayfası/sunucusu `POST /api/v1/wifi-gateway/verify` ile sorar, oturumları `/sessions` ile bildirir, `GET /in-house` ile anlık listeyi alır (`X-PMS-Api-Key`; anahtar yalnız özetiyle saklanır); (3) **Otomatik gönderim** — misafir odaya giriş yapınca, odası/çıkış tarihi değişince ve çıkışta PMS kimlik no + oda numarasını firmanın otel ağındaki adresine HMAC-SHA256 imzalı JSON olarak gönderir (checkin/update/checkout); Wi-Fi sistemine elle bilgi girilmez. Gönderilemezse 30 sn'de bir yeniden denenir. Kimlik numarası içerdiği için yalnız yerel ağ adresleri kabul edilir.
