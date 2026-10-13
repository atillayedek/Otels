# Kurulum

## Gereksinimler

- Sunucu: 64 bit Windows 10/11 veya Windows Server 2019+ (önerilen: sabit IP, SSD, en az 8 GB RAM)
- İstemciler: 64 bit Windows 10/11 (WebView2 çalışma ortamı; Windows 10/11'de genellikle yüklüdür, yoksa kurulum ekler)
- Sunucu ile istemciler aynı yerel ağda

## 1. Sunucu bilgisayarı

1. `HotelPMS-Setup-<sürüm>.exe` dosyasını yönetici olarak çalıştırın.
2. Kurulum türü: **Sunucu bilgisayarı**.
3. Kurulum klasörü yalnız İngilizce karakter içermelidir (varsayılan `C:\HotelPMS`).
4. HTTPS portu: varsayılan 443. Bilgisayarda IIS vb. 443'ü kullanıyorsa 8443 gibi farklı bir port girin.
5. Kurulum şunları yapar:
   - PostgreSQL veri klasörünü oluşturur (`%ProgramData%\HotelPMS\pgdata`), yalnız `127.0.0.1` dinleyecek şekilde yapılandırır
   - Veritabanı rollerini rastgele parolalarla oluşturur (parolalar DPAPI ile şifreli saklanır)
   - Yerel sertifika otoritesi ve sunucu sertifikası üretir
   - `HotelPMS-PostgreSQL` ve `HotelPMSServer` Windows hizmetlerini otomatik başlayacak ve çökmede yeniden başlayacak şekilde kaydeder
   - Güvenlik duvarında yalnız PMS HTTPS, HTTP (yönlendirme) ve keşif portlarını açar; veritabanı portu açılmaz
   - Bu bilgisayara da PMS Client kurar
6. Kurulum sonunda **PMS Server Manager** açılır. Burada şunları görürsünüz:
   - Sunucu IP adresi ve portu
   - Sertifika parmak izi
   - **İlk kurulum kodu**

## 2. İlk ayar

1. Herhangi bir bilgisayarda PMS Client'ı açın. Sunucu ağda otomatik bulunur; bulunamazsa IP ve port girin.
2. Gösterilen sertifika parmak izini Server Manager'daki ile karşılaştırın, aynıysa **kaydet ve bağlan**.
3. Kurulum sihirbazında otel bilgilerini ve ilk yönetici hesabını girin, son adımda Server Manager'daki kurulum kodunu yazın.
4. Sistem boş başlar: örnek veya deneme kaydı oluşturulmaz.
5. Yönetim menüsünden sırasıyla: oda tipleri ve odalar, işlem kodları ve ödeme tipleri, fiyat planları, kullanıcılar.
6. Eski programdan veri almak için: [Veri aktarımı](DATA_MIGRATION.md).

## 3. İstemci bilgisayarları

`C:\HotelPMS\client-setup\PMS-Client-Setup.exe` dosyasını (veya `HotelPMS-Setup` → **İstemci bilgisayarı**) her bilgisayarda çalıştırın. İlk açılışta sunucuyu seçip parmak izini onaylayın.

## Sessiz kurulum

```bat
HotelPMS-Setup-1.0.0.exe /VERYSILENT /TYPE=client
HotelPMS-Setup-1.0.0.exe /VERYSILENT /TYPE=server
```

## Kaldırma

Denetim Masası → Programlar üzerinden kaldırılır. Hizmetler ve güvenlik duvarı kuralları silinir; **veritabanı, yedekler ve belgeler (`%ProgramData%\HotelPMS`) silinmez**. Bu verileri silmek isterseniz, yedeğini aldığınızdan emin olduktan sonra klasörü elle silin.
