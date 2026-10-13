# Kimlik Bildirim Sistemi (KBS)

Her check-in, check-out ve oda değişikliği için konaklayan misafirler adına bir kimlik bildirimi kaydı oluşur.

## Durum

Bu sürümde resmi KBS servisine otomatik gönderim **yapılandırılmamıştır**. Resmi entegrasyon, otele ait kurum kodu ve yetkili kullanıcı bilgileriyle ilgili kurumun sağladığı resmi yöntem doğrulandıktan sonra eklenecektir. Doğrulanmamış veya tahmin edilen bir entegrasyon kullanılmaz.

Bu nedenle:

- Bildirimler **"Yapılandırılmamış"** durumunda bekler; sistem gönderilmiş gibi davranmaz.
- PMS Client → Resepsiyon → **Kimlik Bildirimi (KBS)** ekranının üstünde "KBS entegrasyonu yapılandırılmamış." uyarısı görünür.
- Resepsiyon, bildirimi resmi KBS ekranından elle yapar ve kaydı **Manuel bildirildi** olarak işaretler (resmi referans numarası ve açıklama zorunludur). Bu işlem denetim kaydına yazılır.
- Kimlik bilgisi eksik misafirler **Eksik bilgi** durumunda listelenir; girişte kimlik zorunluluğu ayarı açıksa giriş zaten engellenir.

KBS kimlik bilgileri (kurum kodu, kullanıcı, parola) yapılandırıldığında şifreli gizli değer deposunda tutulacak, günlüklere yazılmayacaktır.
