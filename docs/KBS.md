# Kimlik Bildirim Sistemi (KBS)

Her check-in, check-out ve oda değişikliği için konaklayan misafirler adına bir kimlik bildirimi kaydı oluşur.

## Durum

Bu sürümde resmi KBS servisine otomatik gönderim **yapılandırılmamıştır**. Resmi entegrasyon, otele ait kurum kodu ve yetkili kullanıcı bilgileriyle ilgili kurumun sağladığı resmi yöntem doğrulandıktan sonra eklenecektir. Doğrulanmamış veya tahmin edilen bir entegrasyon kullanılmaz.

## Resepsiyon akışı

1. Odada kalacak herkes girişten önce rezervasyonun **Ek misafirler** sekmesine eklenir. Check-in penceresi odadaki misafirleri ve kimlik bilgisi eksik olanları gösterir.
2. Giriş (check-in veya walk-in) tamamlanınca **"Odadaki misafirler KBS'ye bildirilsin mi?"** sorusu çıkar (`kbs.manage` yetkisi olan kullanıcılara).
3. **Evet** denince bildirim formu açılır: oda numarası, giriş/çıkış tarihleri ve her misafirin ad, soyad, uyruk, kimlik türü ve numarası, doğum tarihi, cinsiyet, doğum yeri, baba/anne adı hazır doldurulmuş gelir. Boş alanlar kırmızı işaretlenir. Her alan tek tıkla kopyalanır; form yazdırılabilir.
4. Bilgiler resmi KBS ekranına girilir; KBS'nin verdiği referans numarası formun altına yazılıp **Bildirildi olarak kaydet** denir. Odadaki tüm misafirlerin bildirimi bu referansla tek seferde işaretlenir.
5. **Şimdi değil** denirse bildirimler kuyrukta bekler; **Resepsiyon → Kimlik Bildirimi (KBS)** ekranında her satırdaki **Bildirim formu** düğmesiyle sonra yapılır.

Formun her açılışı denetim kaydına yazılır. Kimlik numaraları yalnız `guest.identity.view` yetkisi olan kullanıcılara maskesiz gösterilir.

Resmi KBS servisi bağlandığında aynı soru, formu açmak yerine bildirimi otomatik gönderir.

Bu nedenle:

- Bildirimler **"Yapılandırılmamış"** durumunda bekler; sistem gönderilmiş gibi davranmaz.
- PMS Client → Resepsiyon → **Kimlik Bildirimi (KBS)** ekranının üstünde "KBS entegrasyonu yapılandırılmamış." uyarısı görünür.
- Resepsiyon, bildirimi resmi KBS ekranından elle yapar ve kaydı **Manuel bildirildi** olarak işaretler (resmi referans numarası ve açıklama zorunludur). Bu işlem denetim kaydına yazılır.
- Kimlik bilgisi eksik misafirler **Eksik bilgi** durumunda listelenir; girişte kimlik zorunluluğu ayarı açıksa giriş zaten engellenir.

KBS kimlik bilgileri (kurum kodu, kullanıcı, parola) yapılandırıldığında şifreli gizli değer deposunda tutulacak, günlüklere yazılmayacaktır.
