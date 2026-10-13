# Mimari

```
 Otel içi ağ (LAN)
 ┌──────────────────────────── Sunucu bilgisayarı ─────────────────────────────┐
 │  HotelPMSServer (Windows hizmeti)        HotelPMS-PostgreSQL (Windows hizmeti) │
 │  ├─ HTTPS API  :443 (değiştirilebilir) ──► 127.0.0.1:54329 (dışarı kapalı)     │
 │  ├─ WebSocket anlık bildirim                                                  │
 │  ├─ UDP keşif :47820                                                          │
 │  ├─ Zamanlanmış yedekleme, gece denetimi, veri aktarımı                       │
 │  └─ /api/v1/manage (yalnız 127.0.0.1 + yönetim anahtarı) ◄── PMS Server Manager│
 └───────────────────────────────────────────────────────────────────────────────┘
        ▲ HTTPS (yerel sertifika otoritesi, parmak izi ile doğrulanır)
        │
  PMS Client (resepsiyon, kasa, kat hizmetleri, yönetim)
```

## İlkeler

- **Yerel**: İnternet, bulut veya dış hizmet gerekmez. Veriler otelin sunucusunda kalır.
- **Tek kaynak**: Tüm iş kuralları sunucudadır. İstemci veritabanına hiçbir zaman doğrudan bağlanmaz.
- **İşlem bütünlüğü**: Her yazma işlemi tek veritabanı işleminde (transaction) yapılır; denetim kaydı aynı işlemde yazılır, anlık bildirim işlem onaylandıktan sonra gönderilir.
- **Tekrar güvenliği**: Rezervasyon, ödeme, masraf, check-in/out gibi işlemler `Idempotency-Key` ile gönderilir. Çift tıklama veya ağ tekrarı ikinci kayıt oluşturmaz.
- **Eşzamanlılık**: Kayıtlar sürüm numarası taşır; başka bir kullanıcının değiştirdiği kayıt üzerine yazılmaz (409).
- **Para**: Tüm tutarlar `numeric` saklanır, API'de metin (`"1250.50"`) olarak taşınır; kayan nokta kullanılmaz.
- **İş günü**: Gece denetimi tesisin saat dilimine göre iş gününü ilerletir. Folyo satırları iş gününe yazılır.
- **Değiştirilemez finans**: Folyo satırları güncellenmez veya silinmez; iptal, iade, indirim ve aktarım ayrı satırlardır.

## Bileşenler

| Bileşen | Teknoloji |
|---|---|
| Sunucu | .NET 10, ASP.NET Core minimal API, Dapper + Npgsql, Serilog |
| Veritabanı | PostgreSQL 17 (kurulumla gelir), `btree_gist` (oda çakışma engeli), `pg_trgm` (arama) |
| İstemci | Tauri 2 (Rust), React 18, TanStack Query |
| Server Manager | .NET 10 Windows Forms |
| Kurulum | Inno Setup 6 (sunucu/istemci seçimi), istemci için NSIS |

## İstemci güvenliği

İstemcideki tüm ağ trafiği Rust katmanında yapılır. Oturum anahtarı yalnız bellekte tutulur, arayüze ve diske yazılmaz. Sunucu sertifikası, ilk bağlantıda kullanıcının Server Manager ekranıyla karşılaştırıp onayladığı yerel sertifika otoritesine sabitlenir (pinning).

## Anlık güncelleme

Sunucu, onaylanan her işlemden sonra ilgili konuyu (ör. `reservations`, `folios`, `rooms`) WebSocket ile yayınlar. İstemci yalnız etkilenen ekran verisini yeniden yükler; sürekli sorgulama (polling) yapılmaz.
