# Veri aktarımı

PMS Client → Yönetim → **Veri Aktarım Merkezi** (`migration.manage` yetkisi).

## Kaynaklar

| Kaynak | Not |
|---|---|
| CSV / TXT | `;` `,` sekme `\|` ayırıcıları otomatik algılanır; UTF-8, Windows-1254, ISO-8859-9 kodlaması algılanır |
| Excel XLSX / XLS | Sayfa seçilebilir |
| JSON, XML | XML için kayıt öğesi seçilebilir |
| PostgreSQL | Oturum salt okunur (`default_transaction_read_only`) |
| SQL Server | `ApplicationIntent=ReadOnly`, yalnız SELECT |
| MySQL / MariaDB | `READ ONLY` oturum |
| SQLite | `Mode=ReadOnly` |
| ODBC / Access | Sunucuda ODBC sürücüsü varsa, salt okunur |

**Eski programın verisine hiçbir zaman yazılmaz**: yalnız SELECT çalıştırılır. Bağlantı parolası diske, günlüğe veya veritabanına yazılmaz.

## Aktarılabilen veriler

Misafirler (kimlik, iletişim, vergi dairesi/no), şirketler ve acenteler (cari kartlar, vergi no), oda tipleri, odalar, rezervasyonlar, geçmiş folyo hareketleri, **cari hareketler** (borç/alacak). Önerilen sıra: oda tipleri → odalar → şirketler/acenteler → misafirler → cari hareketler → rezervasyonlar.

## Adımlar

1. **Kaynak ve eşleştirme**: Önizleme görünür. Sütunlar PMS alanlarıyla otomatik eşleştirilir (Türkçe/İngilizce sütun adı eş anlamlıları), gerekirse elle değiştirilir. Dönüşümler: Türkçe karakter düzeltme (Ã¼ → ü), büyük/küçük harf, ad-soyad ayırma; tarih ve sayı biçimi (`dd.MM.yyyy`, `12.500,75`). Eşleştirme profil olarak kaydedilip sonraki aktarımda yüklenebilir.
2. **Doğrula ve önizle**: Her satır doğrulanır (zorunlu alan, T.C. kimlik no algoritması, tarih, tutar). Mükerrer kayıtlar puanlanır (kimlik no, vergi no, ad+doğum tarihi, telefon). Politika: bana sor / atla / güncelle / yeni oluştur. İnceleme bekleyen satırlar için tek tek veya toplu karar verilir. Hatalı satırlar CSV olarak indirilebilir.
3. **Aktarım**: Başlamadan önce otomatik yedek alınır. Satırlar gruplar hâlinde, her satır kendi geri alma noktasıyla aktarılır; bir satırın hatası diğerlerini etkilemez. Sonunda rapor gösterilir.

## Geri alma

**Aktarımı geri al**: eklenen kayıtları kaldırır, güncellenenleri önceki hâline döndürür. Aktarımdan sonra elle değiştirilmiş veya başka kayıtlarca kullanılan (ör. rezervasyonu olan misafir) kayıtlar varsa geri alma engellenir ve hangi kayıtlar olduğu bildirilir.

## Kişisel veri

Aktarım bittikten sonra **Ham kaynak verisini temizle** ile, geçici olarak saklanan kaynak satırları silinir; özet sayılar ve hata nedenleri korunur.
