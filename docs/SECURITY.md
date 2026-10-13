# Güvenlik

## Kimlik ve yetki

- Parolalar Argon2id ile özetlenir; düz metin saklanmaz veya günlüğe yazılmaz.
- Parola politikası: en az 10 karakter, harf ve rakam. İlk girişte ve yönetici sıfırlamasında parola değişikliği zorunludur.
- Hatalı girişlerde hesap geçici olarak kilitlenir; giriş denemeleri hız sınırlıdır.
- Oturum anahtarları veritabanında SHA-256 özetleri olarak tutulur; parola değişince kullanıcının diğer oturumları kapanır.
- Rol bazlı yetki (RBAC) sunucuda her uç noktada denetlenir; arayüzde gizlenen bir işlem sunucuda da reddedilir.
- Her bilgisayar cihaz olarak kaydedilir; yönetici bir cihazı engelleyebilir, açık oturumları kapatabilir.

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
