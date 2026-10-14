# KVKK: Otel için yapılacaklar ve Ferrolit PMS'teki karşılıkları

Bu rehber, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında otelin (veri sorumlusu) yapması gerekenleri ve yazılımın bunlara nasıl yardımcı olduğunu özetler. Hukuki danışmanlık yerine geçmez; otelinizin politikalarını bir hukukçuyla netleştirin.

## 1. Rol dağılımı

- **Veri sorumlusu: otel işletmesi.** Misafir, personel ve tedarikçi verilerini kendi amaçları için işler.
- **TSDMR Digital Studio** yazılımı sağlar; yazılım otelin kendi sunucusunda çalıştığı ve veriler TSDMR'ye gönderilmediği için olağan kullanımda veri işleyen değildir. Uzaktan destek sırasında erişim gerekirse "Uzaktan Destek Gizlilik Taahhüdü" uygulanır.

## 2. Otelin yapması gerekenler

| Yükümlülük | Yazılımdaki karşılığı |
|---|---|
| **Aydınlatma (KVKK m.10):** misafire, verilerinin hangi amaçla işlendiğini veri toplanırken bildirmek | Yönetim → KVKK ve Kişisel Veriler: aydınlatma metni otel bilgileriyle doldurulur. Rezervasyon ekranındaki **KVKK formu** düğmesi her misafir için imza alanlı form yazdırır. |
| **Açık rıza:** yalnız gerekli olduğunda (ör. kampanya/tanıtım iletileri) | Formdaki isteğe bağlı onay kutusu; misafir kartında "Ticari ileti izni" alanı. |
| **Kayıt tutma:** aydınlatmanın yapıldığını ispatlayabilmek | Misafir kartında "KVKK aydınlatması yapıldı" işareti ve tarihi; imzalı formun saklanması. |
| **İlgili kişi başvuruları (m.11, m.13):** en geç 30 gün içinde yanıt | Misafir kartı → **Kişisel veri dökümü** (Excel): kimlik, iletişim, konaklamalar, folyo hareketleri, belgeler, kimlik bildirimleri ve işlem kayıtları. |
| **Silme / anonimleştirme (m.7):** işleme şartı kalmayan verinin silinmesi | Misafir kartı → **Anonimleştir** (aktif rezervasyon ve açık folyo yoksa). Kimlik belgesi dosyaları diskten imha edilir. |
| **Saklama ve imha politikası** | Yönetim → KVKK: saklama süresi (yıl). Süresi dolan misafirler listelenir ve toplu anonimleştirilir; işlem denetim kaydına gerekçesiyle yazılır. Bu klasördeki politika şablonunu doldurun. |
| **Veri güvenliği (m.12):** teknik ve idari tedbirler | Rol ve yetki bazlı erişim; kimlik numarası yalnız yetkiliye açık; değiştirilemez denetim kayıtları; şifreli yedek; yerel ağda TLS; oturum ve cihaz yönetimi; parola politikası. |
| **İhlal bildirimi:** ihlal öğrenildiğinde Kurula ve ilgili kişilere bildirim | Denetim kayıtları ve cihaz/oturum geçmişi incelemeye yardımcı olur. |
| **VERBİS kaydı** | Otelin kayıt yükümlülüğü olup olmadığını Kurulun güncel eşik kararlarına göre (çalışan sayısı, mali bilanço) kontrol edin. |
| **Yurt dışına aktarım** | Yazılım verileri yurt dışına aktarmaz. Kanal yöneticisi veya OTA ile çalışıyorsanız o firmaların aktarım koşullarını ayrıca değerlendirin. |

## 3. Saklama süreleri hakkında

Yazılım saklama süresini sizin belirlediğiniz değere göre uygular; varsayılan değer yoktur. Süreyi belirlerken örneğin şunları göz önünde bulundurun ve hukukçunuzla doğrulayın:

- Vergi mevzuatı: defter ve belgelerin saklanması (213 sayılı Vergi Usul Kanunu)
- Ticari defter ve belgeler (6102 sayılı Türk Ticaret Kanunu)
- Kimlik bildirme yükümlülüğü (1774 sayılı Kimlik Bildirme Kanunu) ve kolluk talepleri
- Olası hukuki uyuşmazlıklar için zamanaşımı süreleri

Anonimleştirme misafirin kimlik ve iletişim bilgilerini siler; konaklama, folyo ve muhasebe kayıtları tutar ve tarih olarak kalır (vergi/muhasebe saklama yükümlülüğü), ancak kişiyle ilişkilendirilemez.

## 4. Bilinmesi gereken sınırlar

- **Yedekler:** Anonimleştirmeden önce alınmış yedeklerde eski veriler bulunur. Yedek saklama süresini de politikanızda belirleyin ve süresi dolan yedekleri silin.
- **Denetim kayıtları:** Kim, ne zaman, ne yaptı kayıtları güvenlik ve ispat amacıyla değiştirilemez tutulur ve anonimleştirilmez. Bu kayıtlar yalnız yetkili yöneticilere açıktır.
- **Kâğıt belgeler:** İmzalı formlar ve kimlik fotokopileri yazılım dışındadır; politikanıza göre saklayıp imha edin.
