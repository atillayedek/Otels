# Ağ

| Port | Protokol | Yön | Açıklama |
|---|---|---|---|
| 443 (değiştirilebilir) | TCP | LAN → sunucu | PMS API ve WebSocket (HTTPS) |
| 80 (değiştirilebilir) | TCP | LAN → sunucu | Yalnız HTTPS'e yönlendirme, CA sertifikası ve sağlık kontrolü |
| 47820 | UDP | LAN yayını | Sunucu keşfi |
| 54329 | TCP | **yalnız 127.0.0.1** | PostgreSQL — güvenlik duvarında açılmaz, dış ağdan erişilemez |

Kurulum, Windows Güvenlik Duvarı'na yalnız ilk üç port için kural ekler.

## Öneriler

- Sunucuya sabit IP verin (modemde DHCP rezervasyonu). IP değişirse istemciler keşifle sunucuyu yine bulur; sertifikayı yeni IP için yenilemek için `HotelPms.Server.exe renew-cert` çalıştırın.
- Sunucuyu misafir Wi-Fi ağından ayrı tutun.
- Keşif çalışmıyorsa (ağ yayınları engellenmiş olabilir) istemcide IP ve port elle girilir.
- PMS internete açılmamalıdır; modemde port yönlendirme yapmayın.
