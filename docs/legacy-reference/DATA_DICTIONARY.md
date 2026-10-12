# Veri sözlüğü

Kaynak: `supabase/migrations/202610110001_core.sql` ve sonraki migrationlar. UUID primary key; zaman timestamptz; gece tarihleri date; para numeric(18,2). Null alanlar verinin bilinmediğini ifade eder, otomatik gerçek işletme varsayımı değildir.

| Tablo | Amaç / ana kurallar |
|---|---|
| tenants | name 1–200 karakter, bağımsız müşteri |
| properties | tenant_id, name, time_zone, currency ISO biçimi, business_date; unique tenant/id |
| memberships / property_access | Auth user FK, tenant üyeliği ve tesis rolü; scope izin kaynağı |
| room_types / rooms | capacity 1–30; property/name ve property/number unique; property/type composite FK; cleanliness ayrı |
| guests | property, first_name, last_name; kimlik belgesi içermez |
| reservations | guest/type composite FK; arrival<departure; adults>0, nightly_rate>=0; status/version |
| stays | reservation unique, room property FK; status/version; checked timestamps; migration012 checked_in room unique; zaman overlap assignment EXCLUDE |
| room_assignments | stay/property ve room/property composite FK, starts_at/ends_at timestamptz; fiziksel oda timestamp EXCLUDE, tarihçe |
| nightly_postings / business_date_closures | stay/date ve property/date unique; ledger/property FK, kapanış actor/time |
| folios | stay composite FK, currency/created_at; migration007 stay_status trigger projection muhasebeye guest/stay okumadan açıkkapalı bilgisi verir; bakiye alanı yok |
| ledger_entries | kind, amount<>0, description, manual method, related_id, actor, business_date; reversal unique ilişkisi |
| identity_reports | stay/event/sequence, status, provider_reference; stay/sequence unique |
| integration_outbox | report unique, status, attempts, available_at, lease_until/token |
| identity_report_attempts | report/outcome/created_at; hassas payload loglanmaz |
| housekeeping_tasks | room FK, status/created_at; tam atama/checklist modeli pending |
| maintenance_blocks | room/tarih/reason/active; geçerli tarih aralığı |
| audit_logs | actor/action/resource/correlation/reason/created_at; normal kullanıcı read kapsamlı |
| private.command_results | actor/key PK, property/action/payload/result; kullanıcı Data API'sine kapalı |

Migration006 related_id/report/nightly ledger scope FK; migration011 POS/service ledger scope FK uygulanır. Gerekli ama tamamlanmamış alanlar: currency/vergi/kur snapshots, identity payload hash/provider/configuration, attempts ayrıntısı, doküman lifecycle, hold/allotment/inventory_days, roles/permissions tabloları ve diğer [SRS](SRS.md) aileleri. Yeni migrations sözlüğüyle birlikte güncellenir; gelecek tablolar uygulanmış sayılmaz.

Migration010 operasyon tabloları:

| Tablo | Kural |
|---|---|
| products / warehouses / suppliers | property scoped UUID; ürün unit/sale_price, unique adlar |
| stock_balances | warehouse/product PK, property composite FK; quantity numeric18,3>=0, average_cost numeric18,6>=0 |
| purchase_orders / purchase_receipts | tek ürün/supplier/warehouse FK; qty/cost, ordered/received/cancelled; receipt.order_id unique |
| pos_orders / pos_order_lines | property/warehouse, table_label, open/posted/cancelled, folio/ledger bağları; line product qty/price snapshot |
| stock_movements | receipt veya pos_consumption; işaret ve tek source bağı CHECK; immutable direct writes denied |
| consent_records / crm_events | property/guest composite FK, actor/time; permission channel/evidence/granted; service note/complaint/resolution |
| operation_resources / service_bookings | spa/banquet kind/capacity; scoped guest/resource, start/end timestamptz, participants/amount; aktif booked/posted timestamp EXCLUDE |

Tüm operasyon tabloları admin property scope SELECT RLS; direct anon/authenticated DML revoke. Type numeric NaN/Infinity reddi. Üretim işletme seed verisi yok.
