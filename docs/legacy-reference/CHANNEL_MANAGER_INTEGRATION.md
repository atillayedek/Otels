# Kanal yöneticisi entegrasyonu

OTA/third-party channel manager **pending / erişim bekliyor**. Booking/Expedia partner onayı, sözleşme, webhook imzası, limitler ve tesis erişimi mevcut değildir. Kamuya açık Elektraweb kanal ailesi kapsam referansıdır; bu ürünün hazır bağlantısı olduğunu kanıtlamaz.

Her connection için property, provider, credentials secret reference, capabilities, room/rate/board/currency/tax mapping gerekir. Internal reservation ile external id bağlantısı unique olmalı. Inbox source event id/version ile dedupe; create/amend/cancel controlled domain komutuna aktarılır. Mapping yoksa tahmin yerine operator conflict kuyruğu.

Availability, rate ve restriction ayrı versioned outbox olaylarıdır. Commit edilmiş state gönderilir; kabul ve son gönderim ayrı tutulur. Eski version yeniyi ezemez. Partner rate limit/backoff ve reconciliation gerçek API'den kopyalanır. Restart, replay, duplicate webhook ve stale update testleri zorunlu.

İç satış DB atomik capacity kontrolü ve oda exclusion ile korunur. Dış kanal gecikmesinde sıfır overbooking garantisi verilemez. Nihai kanal modülünde onaylı kapasite aşımı reservation kaybına değil conflict akışına alınmalıdır. Safety quota, stop-sell, full sync ve explicit override politika/audit hâlâ pending kapsamıdır.

Pending bütün kanal özellikleri: oda/fiyat eşleştirme, BAR/season/person/child/channel prices, min/max stay CTA/CTD stop-sell allotment/release, cancellation/guarantee/commission net-gross; partner live receipt ve gerçek export. Online booking/guest portal, expiring inventory hold ve gerçek payment finalize de bu aşamayla birlikte tamamlanır.
