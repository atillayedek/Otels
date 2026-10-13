# Güvenlik

## Kimlik ve yetki

- Parolalar Argon2id ile özetlenir; düz metin saklanmaz veya günlüğe yazılmaz.
- Parola politikası: en az 10 karakter, harf ve rakam. İlk girişte ve yönetici sıfırlamasında parola değişikliği zorunludur.
- Hatalı girişlerde hesap geçici olarak kilitlenir; giriş denemeleri hız sınırlıdır.
- Oturum anahtarları veritabanında SHA-256 özetleri olarak tutulur; parola değişince kullanıcının diğer oturumları kapanır.
- Rol bazlı yetki (RBAC) sunucuda her uç noktada denetlenir; arayüzde gizlenen bir işlem sunucuda da reddedilir.
- Her bilgisayar cihaz olarak kaydedilir; yönetici bir cihazı engelleyebilir, açık oturumları kapatabilir.

## Hazır roller

| Rol | Yapabildikleri |
|---|---|
| Süper Yönetici, Otel Yöneticisi | Tüm yetkiler |
| Genel Müdür | Yönetim ayarları (kullanıcı, cihaz, yedek, aktarım, entegrasyon, yazıcı, oda tanımı) dışında her şey |
| Ön Büro Müdürü | Rezervasyon (fiyat aşımı ve overbook dahil), giriş/çıkış, oda değişikliği, misafir ve kara liste, şirket/acente, fiyat planları, tüm folyo ve kasa işlemleri (iade, indirim, iptal), döviz kuru girişi, kat hizmetleri durumu ve görev ataması, arıza ve oda blokajı, gece denetimi, finansal raporlar, KBS, denetim kayıtları |
| Resepsiyon | Rezervasyon oluşturma/düzenleme/iptal, giriş/çıkış, walk-in, oda değişikliği, misafir kartı (kimlik görme), folyo görüntüleme, masraf, tahsilat, aktarım, folyo kapatma ve fatura no, kasa vardiyası, oda temizlik durumu, arıza bildirme, operasyon raporları, KBS |
| Gece Denetçisi | Gece resepsiyonu (rezervasyon, giriş/çıkış, oda değişikliği, misafir), masraf, tahsilat, aktarım, folyo kapatma, kasa, döviz kuru girişi, no-show, oda durumu, arıza bildirme, gece denetimi, finansal raporlar, KBS |
| Kat Hizmetleri Müdürü | Oda durumları, kontrol onayı (inspected), görev ataması, arıza ve oda blokajı, raporlar |
| Kat Görevlisi | Oda durumları, görevleri güncelleme, arıza bildirme |
| Muhasebe | Folyo ve cari işlemleri (iade, indirim, iptal dahil), şirket/acente, tüm kasa vardiyaları, döviz kuru girişi, finansal raporlar, denetim kayıtları |
| Kasiyer | Folyo görüntüleme, masraf, tahsilat, folyo kapatma, kasa vardiyası, döviz kuru girişi |
| Satış | Rezervasyon oluşturma/düzenleme/iptal, misafir, şirket/acente, fiyat planları ve elle fiyat, raporlar |
| Teknik Servis | Arıza kayıtları ve oda blokajı |
| Yalnız Rapor | Gösterge paneli ve raporlar |
| Restoran / Bar | Adisyon açma, ürün ekleme, kendi yanlış girdiği ve mutfağa gönderilmemiş ürünü 2 dakika içinde iptal, adisyon kapatma (ödeme, odaya aktarma), kasa vardiyası |
| Restoran Müdürü | Restoran / Bar yetkileri + ürün iptali, indirim ve ikram, kapanmış adisyon iptali, menü ve satış noktaları, stok görüntüleme, raporlar |
| Depo / Satın Alma | Depo, stok kartı, tedarikçi, satın alma siparişi, mal kabul, çıkış, transfer, sayım, belge iptali, raporlar |

Ek olarak Satış ve Ön Büro Müdürü acente kontenjanı tanımlayabilir; Muhasebe stok görüntüleme ve satın alma, Kat Hizmetleri Müdürü stok görüntüleme yetkisine sahiptir.

Rollerin yetkileri **Yönetim → Kullanıcılar ve Roller** ekranından değiştirilebilir, yeni rol tanımlanabilir. Bir kullanıcıya birden fazla rol verilebilir (ör. küçük otelde Resepsiyon + Gece Denetçisi). Sürüm güncellemeleri rollere yalnız yeni yetki ekler; yöneticinin yaptığı değişiklikleri geri almaz.

## Denetim kaydı

Tüm yazma işlemleri; kullanıcı, cihaz, IP, önceki ve sonraki değer ve gerekçeyle aynı veritabanı işleminde kaydedilir. Uygulama rolünün denetim kaydını değiştirme veya silme yetkisi yoktur.

## Ağ ve şifreleme

- İstemci–sunucu trafiği TLS ile şifrelenir; istemci, sunucunun yerel sertifika otoritesine sabitlenir.
- Veritabanı yalnız 127.0.0.1'i dinler.
- Yönetim API'si (`/api/v1/manage`) yalnız sunucunun kendisinden ve gizli yönetim anahtarıyla erişilebilir.

## Kişisel veri

- Kimlik numaraları listelerde maskelenir.
- Hata mesajlarında teknik ayrıntı veya SQL gösterilmez; kullanıcı hata kodu görür, ayrıntı sunucu günlüğündedir.
- Günlüklere parola, kimlik belgesi, kart bilgisi veya KBS kimlik bilgisi yazılmaz.
- Kart numarası saklanmaz; ödeme satırlarında yalnız slip/provizyon referansı tutulur.
- Veri aktarımında eski programın veritabanı parolası diske veya günlüğe yazılmaz; aktarım sonrası ham kaynak satırları **Ham veriyi temizle** ile silinebilir.

## Sorumlulukların paylaşımı

Sunucu bilgisayarının işletim sistemi güncellemeleri, disk şifrelemesi (BitLocker önerilir), fiziksel güvenliği ve yedeklerin sunucu dışında saklanması otelin sorumluluğundadır.
