# API sözleşmeleri

Kaynak `supabase/migrations/202610110002_commands.sql`; server action aynı authenticated oturumu kullanır. Her çağrı UUID key taşır; aynı aktör/key, aynı action/payload önceki sonucu döndürür; farklı payload ile key tekrar kullanımı reddedilir. Yetki önce doğrulanır. Response `{id}`; ilgili işlem `{folio_id}` ekleyebilir. Hatalar başarılı HTTP/UI durumuna çevrilmez.

`bootstrap_property(p_key uuid, p_payload jsonb) → jsonb`: tenant_name, name, time_zone, currency, business_date kullanıcı girdisidir. Auth kimliği gerekir; timezone PostgreSQL listesiyle doğrulanır. Dönen tenant_id/property_id gerçek transaction sonucudur.

`command(p_property_id uuid, p_key uuid, p_action text, p_payload jsonb) → jsonb`:

| action | Payload alanları | Kural |
|---|---|---|
| room_type.create | name, capacity | admin; capacity 1–30 |
| room.create | room_type_id, number | admin; type aynı property |
| guest.create | first_name,last_name | operations; boş isim reddi |
| membership.grant | user_id,role | admin; mevcut Auth user |
| reservation.create | guest_id,room_type_id,arrival,departure,adults,nightly_rate | kapasite/date/inventory atomic |
| reservation.amend | id,version,arrival,departure | confirmed ve stay başlamamış |
| reservation.cancel | id,version,reason | gerekçe ve optimistic version |
| stay.check_in | reservation_id,room_id | business_date aralıkta; approved matching room; bakım yok |
| stay.check_out | id,version | tüm folyo toplamı sıfır; dirty/task/KBS |
| stay.move | id,version,room_id | farklı hazır oda; bakım/overlap kontrol |
| stay.extend | id,version,departure | departure artar; kapasite ve bakım kontrol |
| ledger.charge | folio_id,amount,description | pozitif decimal; açık stay |
| ledger.payment | folio_id,amount,description,method | cash/manual_bank, negatif ledger |
| ledger.refund | folio_id,entry_id,amount,reason | toplam refund orijinal payment'ı aşamaz |
| ledger.reverse | folio_id,entry_id,reason | charge/payment; daha önce adjustment yok |
| ledger.transfer | folio_id,entry_id,target_folio_id,reason | aynı property farklı açık folyo; çift kayıt |
| housekeeping.update | room_id,cleanliness | approved için admin ayrıca gerekir |
| maintenance.block | room_id,arrival,departure,reason | satılmış gece veya aktif stay yerinden edilmez |
| maintenance.release | id | property scoped |
| kbs.manual | id,reason,reference | permitted failure state; reported_manually |
| folio.create | stay_id | finance/AAL2; açık stay'e ek folyo |
| business_date.close | business_date | admin/AAL2; exact current date, arrivals/departures/KBS blocker, nightly posting unique ve atomik ilerleme |

Worker migration 003: `worker_claim(p_limit integer default 10) → setof integration_outbox`; `worker_finish(p_id uuid,p_property_id uuid,p_lease_token uuid,p_outcome text) → void`. Yalnız service_role çalıştırır. Claim limit 0–50, skip locked ve 60 saniye lease; süresi dolan processing outcome_unknown'a geçirilir. Finish doğru property/token/unexpired lease gerektirir; kabul edilebilir outcomes blocked_configuration/outcome_unknown/rejected/retry_scheduled; accepted desteklenmez. service key sadece worker secret ortamında. `business_date.close` permission mapping varlığı desteklenen domain komutunun kanıtı değildir. Desteklenmeyen action `Unsupported command` üretir.

Eksik nihai komutlar: IssueInvoice, tam CloseBusinessDate muhasebe/kasa/paket/vergi/OTA kontrolleri, Submit/ReconcileIdentityReport gerçek provider, ApplyChannelReservation/UpdateAvailability, önceden fiziksel AllocateRoom/option/group/day-use ve advanced ancillary işlemler. Aynı auth, validation, transaction, idempotency, audit sözleşmesine eklenir.

## Bağlı operasyon komutları

Migration010 `operations_command(p_property_id uuid,p_key uuid,p_action text,p_payload jsonb) → {id,ledger_entry_id?}`. authenticated INVOKER public wrapper → private fixed search_path definer; admin property erişimi, property lock, `operations:` action namespace idempotency ve audit. Direct DML yok. Admin privileged AAL2 şartı diğer migrationla uygulanır.

| Action | Payload | Transaction sonucu |
|---|---|---|
| product.create | name,unit,sale_price | gerçek ürün |
| warehouse.create / supplier.create | name | gerçek depot/tedarikçi |
| purchase.create | supplier_id,warehouse_id,product_id,quantity,unit_cost | tek ürün ordered |
| purchase.receive | id | tek receipt, stok miktarı ve ağırlıklı ortalama, movement, received |
| purchase.cancel | id,reason | yalnız ordered iptal |
| pos.create | warehouse_id,table_label | açık adisyon |
| pos.line | order_id,product_id,quantity | mevcut ürün fiyatı snapshot |
| pos.post | id,folio_id | aggregated quantity stock check/consume + folio charge atomik |
| pos.cancel | id,reason | yalnız open iptal |
| consent.record | guest_id,channel,granted,evidence | izin/ret geçmişi; outbound yok |
| crm.event | guest_id,kind,note | service_note/complaint/resolution |
| resource.create | kind,name,capacity | spa/banquet kaynak |
| booking.create | resource_id,guest_id,start_at,end_at,participants,description,amount | timezone timestamp, capacity ve EXCLUDE |
| booking.cancel | id,reason | yalnız booked iptal |
| booking.post | id,folio_id | yalnız booked; açık folyoya charge ve posted |

Operations idempotency çekirdek key tablosunu paylaşır fakat namespace farklı action ile key reuse reddedilir. Native provider veya POS bankası settlement sonucu taklit edilmez. Miktar scale3, average_cost scale6, sale/ledger scale2; POS satır tutarı iki ondalığa yuvarlanır.
