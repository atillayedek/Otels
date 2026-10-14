# Ferrolit PMS

Otelin kendi bilgisayarında çalışan, internet gerektirmeyen otel yönetim sistemi (PMS). TSDMR Digital Studio.

- **Sunucu**: Otelde sunucu olarak seçilen bilgisayarda Windows hizmeti (Linux'ta systemd) olarak çalışır. Yerel PostgreSQL veritabanı yalnız `127.0.0.1` üzerinden erişilebilir; dış ağa açılmaz.
- **PMS Client**: Resepsiyon, kasa, kat hizmetleri ve yönetim bilgisayarlarına kurulan masaüstü uygulaması. Sunucuyu yerel ağda kendisi bulur, şifreli (HTTPS) bağlantıyla çalışır.
- **PMS Server Manager**: Sunucu bilgisayarındaki yönetim ekranı (hizmet durumu, kurulum kodu, bağlı istemciler, yedekleme/geri yükleme, günlükler, bakım).
- **Tanıtım sitesi** (`web/`): Landing, ürün bilgisi, ön sipariş formu ve ön sipariş yönetim paneli. PMS'in kendisi web'de çalışmaz.

## Klasörler

| Klasör | İçerik |
|---|---|
| `src/HotelPms.Server` | Sunucu: API, gerçek zamanlı bildirim, gece denetimi, yedekleme, veri aktarımı, KBS altyapısı |
| `src/HotelPms.Shared` | Sunucu ve Manager ortak: yollar, yapılandırma, gizli değer deposu, sertifika, kurulum |
| `src/HotelPms.Manager` | PMS Server Manager (Windows Forms) |
| `desktop-client` | PMS Client (Tauri 2 + React) |
| `installer` | HotelPMS-Setup.exe (Inno Setup) ve PostgreSQL indirme betiği |
| `web` | Tanıtım sitesi (Next.js + Supabase) |
| `tests/e2e` | Uçtan uca API testi (yalnız yalıtılmış test ortamında) |
| `scripts` | Yalıtılmış test ortamı |
| `docs` | Belgeler |

## Belgeler

- [Mimari](docs/ARCHITECTURE.md)
- [Kurulum](docs/INSTALLATION.md) · [Sunucu](docs/SERVER.md) · [İstemci](docs/CLIENT.md) · [Ağ](docs/NETWORK.md)
- [Veritabanı](docs/DATABASE.md) · [Yedekleme ve geri yükleme](docs/BACKUP_RESTORE.md) · [Güvenlik](docs/SECURITY.md)
- [PMS modülleri](docs/PMS_MODULES.md) · [KBS](docs/KBS.md)
- [Veri aktarımı](docs/DATA_MIGRATION.md) · [AmonRa'dan geçiş](docs/AMONRA_MIGRATION.md)
- [Sorun giderme](docs/TROUBLESHOOTING.md) · [Güncelleme](docs/UPDATE.md)

## Derleme

Gereksinimler: .NET 10 SDK, Node.js 22+, Rust (MSVC araç zinciri), Inno Setup 6.

```powershell
dotnet build HotelPms.sln -c Release
cd desktop-client; npm ci; npx tauri build
powershell -File installer\fetch-postgres.ps1
powershell -File installer\build.ps1 -Version 1.0.0
```

Çıktı: `build\installer\HotelPMS-Setup-1.0.0.exe` ve SHA-256 dosyası.

> Repo yolu Türkçe karakter içeriyorsa Rust derlemesi için `CARGO_TARGET_DIR` değişkenini ASCII bir klasöre yönlendirin.
