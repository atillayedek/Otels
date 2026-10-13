# Sunucu

## Klasörler

| Yol | İçerik |
|---|---|
| `C:\HotelPMS\server` | Sunucu programı ve PostgreSQL ikili dosyaları |
| `C:\HotelPMS\manager` | PMS Server Manager |
| `%ProgramData%\HotelPMS\config` | `server.json` (portlar, yedekleme ayarı), şifreli gizli değerler, kurulum kodu |
| `%ProgramData%\HotelPMS\pgdata` | Veritabanı |
| `%ProgramData%\HotelPMS\backups` | Yedekler (varsayılan) |
| `%ProgramData%\HotelPMS\storage` | Yüklenen belgeler |
| `%ProgramData%\HotelPMS\logs` | Günlükler (JSON satırları, günlük döner) |
| `%ProgramData%\HotelPMS\certs` | Yerel sertifika otoritesi ve sunucu sertifikası |

Linux'ta veri kökü `/var/lib/hotelpms`'dir.

## Hizmetler

| Hizmet | Açıklama |
|---|---|
| `HotelPMS-PostgreSQL` | Veritabanı, yalnız 127.0.0.1:54329 |
| `HotelPMSServer` | PMS sunucusu; PostgreSQL'e bağımlı, otomatik başlar, çökmede 5/10/30 sn sonra yeniden başlar |

Server Manager'dan başlatılıp durdurulabilir.

## Komut satırı

```bat
HotelPms.Server.exe version
HotelPms.Server.exe backup --kind manual
HotelPms.Server.exe renew-cert          :: IP adresi değiştiyse sertifikayı yeniler
HotelPms.Server.exe unregister          :: hizmetleri kaldırır, veriyi SİLMEZ
```

## Sağlık

`http://<sunucu>/api/v1/system/health` veritabanı, disk ve yedek durumunu döndürür. Server Manager aynı bilgileri ayrıntılı gösterir. Disk boş alanı 1 GB'ın altına inerse sunucu yeni yazma işlemlerini reddeder (veri bozulmasını önlemek için).

## Linux

`systemd` ile çalışır (`HotelPms.Server --service`). Dağıtımın PostgreSQL 17 paketi kullanılır. Birincil hedef Windows'tur; Linux kurulumu henüz otomatik betikle paketlenmemiştir.
