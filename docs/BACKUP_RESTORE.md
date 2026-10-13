# Yedekleme ve geri yükleme

## Yedek dosyası

`.hpbak` dosyası bir ZIP paketidir: `manifest.json`, `database.dump` (pg_dump, custom format), `config/server.json` ve belgeler. Manifest'te dump dosyasının SHA-256 özeti bulunur; geri yüklemeden önce doğrulanır. Gizli değerler ve sertifika özel anahtarları pakete konmaz.

## Otomatik yedek

PMS Client → Yönetim → Yedekleme:

- Sıklık: günlük / haftalık / aylık / kapalı, saat
- Yedek klasörü ve **ikinci kopya klasörü** (farklı disk veya ağ klasörü önerilir)
- Saklanacak yedek sayısı (zamanlanmış, elle, sistem ayrı ayrı); eskiler otomatik silinir

Sistem yedekleri otomatik alınır: şema güncellemesi öncesi, geri yükleme öncesi, veri aktarımı öncesi.

## Elle yedek

- PMS Client → Yönetim → Yedekleme → **Şimdi yedek al**
- Server Manager → Yedekler → **Şimdi yedek al**
- Komut satırı: `HotelPms.Server.exe backup --kind manual`

## Geri yükleme

Yalnız sunucu bilgisayarında, **Server Manager → Yedekler**:

1. Listeden yedeği seçin (veya **Dosyadan geri yükle**).
2. Onay için `GERI YUKLE` yazın.
3. Sunucu: mevcut veritabanının güvenlik yedeğini alır, tüm istemci bağlantılarını keser, yedeği yeni bir veritabanına açar, şemayı günceller ve yeni veritabanına geçer.
4. Eski veritabanı **silinmez**, tarih damgalı adla saklanır.

Başka bir bilgisayara taşıma: yeni bilgisayara Sunucu kurulumu yapın, yedek dosyasını kopyalayın ve Server Manager'dan geri yükleyin.

## Öneri

En az bir kopya sunucu dışında (harici disk veya başka bilgisayarın paylaşılan klasörü) tutulmalıdır. Server Manager'daki **Son yedek** satırı ve sağlık kontrolü, 2 günden eski yedekte uyarı verir.
