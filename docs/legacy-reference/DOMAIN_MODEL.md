# Domain modeli

Tenant müşteri organizasyonu; property onun tesisidir. Auth user membership ile organizasyona, property_access ile tesise erişir. Fiziksel oda room_type'a bağlanır. Reservation ticari satış, stay gerçekleşen konaklama; guest misafir profili, kimlik belgesi ayrı gelecekteki modeldir.

Reservation tarih aralığı `[arrival, departure)` gece tüketir; çıkış tarihi tüketmez. Mevcut temel confirmed/cancelled/completed durumlarını sağlar; draft/option/no-show, grup, reservation_rooms/guests, allotment/hold, rate plan ve çocuk kuralları pending. Oda temizlik durumu cleanliness; bakım maintenance_blocks; doluluk stay üzerinden hesaplanır.

Stay → folio → ledger_entries bağıdır. Finans işaretleri: charge pozitif, payment negatif, refund pozitif, reversal ters işaret, transfer kaynak negatif/hedef pozitif. Bakiyenin kaynağı sum(amount); ödeme sağlayıcı onayı ayrı kavramdır. Mevcut manual_bank/cash sadece operatörün kaydettiği tahsilattır.

Stay olayları → identity_reports → integration_outbox. Bildirim sırası stay içinde unique; provider kabulü olmadan accepted olamaz. identity_report_attempts girişimler; audit_logs aktör, property, action, kaynak, correlation ve gerekçe kaydeder. private.command_results actor/key ile idempotency sonucunu saklar.

Gelecekteki sınırlar: kanal inbox/outbox ve mapping; HK görev/atama/inspection; bakım ticket/material; invoice/event/refund/payment provider; POS/order/table, stock/warehouse/recipe/purchase; CRM/consent/campaign; spa/resources, banquet/events; chain/CRS, platform subscriptions/entitlements. Her yeni model tenant/property composite FK, yetki, durum geçişi ve audit kabulü olmadan expose edilmez.

Oda değişiminde room_assignments starts_at/ends_at tarihçesi korunur; timestamp EXCLUDE fiziksel overlap engeller. Migration012 checked_in stay.room_id unique, planlanan çıkış süresi dolsa bile aktif konaklamanın odasına başka check-in'i engeller. stay.room_id mevcut odayı temsil eder. folio.create açık stay'e ek folyo oluşturur. Migration007 stay_status projection muhasebeye misafir/stay kayıt izni vermeden açık folyo bilgisi sağlar. Birlikte konaklayan ve grup oda/misafir modeli hâlâ pending.

nightly_postings stay/business_date PK ile oda ücretini bir kez kaydeder; business_date_closures property/date PK kapanış kaydıdır. business_date.close çözümlenmemiş geliş/çıkış ve KBS olaylarını engeller; gece charge yazıp iş gününü tek transaction ilerletir. Bu çekirdek kapanış, tam paket/vergi/no-show/kasa/OTA mutabakatı kapsamının tamamı değildir.

Migration010 products/warehouse/supplier/purchase → receipt → stock movement ve ağırlıklı ortalama balances; pos_order/lines → stok tüketimi + folyo charge; consent/CRM append geçmişi; SPA/banket resource → service booking → folyo charge ilişkileri gerçek command altyapısıyla bağlıdır. Migration011 source ledger bağlarını property FK ile sınırlar.
