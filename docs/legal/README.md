# Satış ve uyum belgeleri

Her satışta kullanılacak sözleşme ve uyum belgeleri. Hepsi şablondur; köşeli parantezli alanları doldurun. İlk kullanımdan önce bir avukata (özellikle sözleşme ve KVKK belgeleri) kontrol ettirmeniz önerilir.

| Belge | Kim imzalar / kullanır | Ne zaman |
|---|---|---|
| [Son Kullanıcı Lisans Sözleşmesi](../../installer/LISANS-SOZLESMESI.txt) | Kurulumda otel kabul eder (kurulum sihirbazında gösterilir) | Kurulum |
| [Satış, Kurulum ve Destek Hizmet Sözleşmesi](SATIS-VE-DESTEK-SOZLESMESI.md) | TSDMR ve otel | Satış |
| [Uzaktan Destek Gizlilik Taahhüdü](UZAKTAN-DESTEK-GIZLILIK-TAAHHUDU.md) | TSDMR ve otel | Satış (sözleşme eki) |
| [Kurulum ve Teslim Tutanağı](KURULUM-TESLIM-TUTANAGI.md) | TSDMR ve otel | Kurulum sonu |
| [KVKK: otel için yapılacaklar](KVKK-OTEL-REHBERI.md) | Otele verilir | Kurulum / eğitim |
| [Kişisel Veri Saklama ve İmha Politikası](KISISEL-VERI-SAKLAMA-VE-IMHA-POLITIKASI.md) | Otel doldurur | Kurulum sonrası |

Misafir aydınlatma metni ve ticari ileti açık rıza metni yazılımın içindedir: **Yönetim → KVKK ve Kişisel Veriler**. Rezervasyon ekranındaki **KVKK formu** düğmesi imza alanlı formu yazdırır.

## Lisans üretimi

1. `TSDMR-Lisans-Uretici.exe` programını açın (yalnız sizin bilgisayarınızda; otellere verilmez).
2. Müşteri unvanı, otel adı, vergi numarası, oda sınırı, modüller ve süreleri girin → **Lisans üret ve kaydet**.
3. Oluşan `.lisans` dosyasını otele gönderin; otelde **Yönetim → Lisans** ekranında dosya seçilerek yüklenir.
4. Verilen tüm lisanslar `verilen-lisanslar.csv` dosyasına (imza anahtarının yanında) kaydedilir.

**İmza anahtarı** (`lisans-imza-anahtari.pem`, `%APPDATA%\TSDMR\Lisans`) yalnız sizdedir: kaybolursa yeni lisans üretilemez, başkasının eline geçerse sahte lisans üretilebilir. Şifreli bir USB belleğe ve güvenli ikinci bir yere yedekleyin; e-postayla göndermeyin, git deposuna koymayın.
