# Kabul kriterleri

Kaynak prompt §22. Aşağıdaki testler yalnız izolasyon ortamında geçici kayıtlarla yapılabilir; canlı kurumlara sahte olay gönderilmez. Sonuçlar pending; gerçek çalıştırma/log kanıtı olmadan PASS olmaz. Her satır SRS QUAL aile kimlikleriyle eşleştirilir.

| ID | Senaryo | Ölçülebilir kanıt | Durum |
|---|---|---|---|
| AC-01 | İki işletme izolasyonu | A oturumu B satırını select/export/realtime/storage ile alamaz | SQL PASS; export/realtime/storage pending |
| AC-02 | URL/API yetki reddi | UI gizli olsa da doğrudan RPC/URL anon ve yanlış role mutasyon yapamaz | SQL role/RPC ve local HTTP AAL1 admin denial PASS; tam RBAC pending |
| AC-03 | Son oda concurrent satış | iki transaction yarışında bir confirmed; diğer no availability | PG17 iki session1COMMIT/DBcount1 PASS |
| AC-04 | Fiziksel oda overlap | DB EXCLUDE ikinci aktif çakışmayı reddeder; bitiş/giriş aynı gün geçerli | PG17 exclusion/aktifoda PASS |
| AC-05 | Opsiyon expiry | aktif hold tüketir; expiry atomik release ve tekrar release tek sonuç | pending; hold yok |
| AC-06 | Rezervasyon amend | eski capacity bırakma/yeni alma tek transaction; failed amend eskiyi korur | SQL/version/core PASS; tam rate/hold pending |
| AC-07 | Check-in/out replay | aynı actor/key tek stay/folio/report/task; farklı payload key reddi | PG17 core/advanced PASS |
| AC-08 | Payment/charge replay | aynı key tek ledger; karşı role finance reddi | PG17 core/MFA/operations PASS |
| AC-09 | Folyo/fatura/tahsilat ayrımı | invoice düzenlenmesi settlement sayılmaz; ayrı ids/status/mutabakat | pending; invoice yok |
| AC-10 | Night audit replay | aynı stay/night bir posting; restart adım devamı güvenli | PG17 çekirdek close replay PASS; tam night audit pending |
| AC-11 | KBS rejected/unknown | real/provider-isolated timeout → outcome_unknown, reject → rejected; sent != accepted | pending; live erişim yok |
| AC-12 | OTA duplicate | aynı external event ikinci reservation üretmez | pending; OTA yok |
| AC-13 | OTA stale update | eski version yeni rate/availability değiştirmez | pending; OTA yok |
| AC-14 | HK doğru oda | selected property/room update diğer odayı değiştirmez; actor audit | SQL core PASS; mobil assignment/checklist pending |
| AC-15 | Tenant/property FK | farklı property guest/type/room/folio/report ilişkisi DB reddi | PG17 core/ops011 negativeFK PASS |
| AC-16 | Finans geçmişi | refund/reversal/transfer kaynak değişmeden yeni kayıttır; toplam mutabık | PG17 advanced exactmoney PASS |
| AC-17 | Secret/identity log | logs/build/client/Git taraması PAN/CVV/secret/full identity göstermez | pending |
| AC-18 | Dosya/export yetkisi | private object ve export cross-property reddi; süreli token expiry | pending; storage/export yok |
| AC-19 | Worker crash | claim sonrası kill, lease expiry/reclaim; stale token finish reddi, iş kaybolmaz | PG17 worker lease/expiryunknown/order PASS; process-kill live pending |
| AC-20 | Backup restore | ayrı ortam restore DB+Storage+Auth mutabakat; ölçülen RPO/RTO | PG17 gerçek DBdump/restore PASS; Auth/Storage/RPO/RTO pending |
| AC-21 | Boş DB | sahte tesis/oda/KPI yok; loading/no data/zero/error ayrımı; gerçek create yönlendirmesi | pending |
| AC-22 | Build/quality | npm build/lint/typecheck/test:web ve migration/SQL checks exit0 | build/lint/types6tests ve finalPG17 PASS |

Ek tam ürün kapıları: user-entered gerçek tesis yapılandırması; full SRS aile kabulü; finance/admin MFA, effective tax/FX, room assignment history, provider onboarding/canlı kabul, tenant scoped reports/detail parity, declared realistic performance target ve restore tatbikatı. İzole PostgreSQL16 shim testleri gerçek Supabase Auth/Storage/Realtime E2E yerine geçmez.

Kanıt formatı: tarih, commit/source snapshot, environment, çalıştırılan command, exit/result, test scenario IDs, known gaps. Failed/blocked/pending durumlar aynen korunur; doküman tamamlığı ürün kabulü değildir.

2026-10-11 güncel kanıt: bağımsız typecheck exit0, web boundary test6/6 exit0; web implementer son build/lint/typecheck ve6/6 test geçişini bildirdi. FinalPG17 bütün001–012/coreMFA/ops/advanced/worker/concurrency/DBdump-restore exit0. Gerçek local HTTP/Auth/TOTP/Storage alt kapsam PASS; authenticated browser kabulü pending. Root dependency audit production0 vulnerability; root local empty properties0. DB/web kanıtları tam ürün ve canlı provider satırlarını PASS yapmaz. Yeni2.hesap bağlı kullanıcı tarafından doğrulandı; connector catalog eski/Unknown tool olduğu için yeni hesap Free kotası bilinmiyor.

Son ek kanıt: finalPG17 `verify.ps1 -Image postgres:17-alpine` exit0; bütün001–012/coreMFA/RLS/ops011/advancedfinance/night/overdue-active-assignment/worker PASS; concurrent tam1COMMIT/DBcount1 ve diğer No availability; pg_dump ayrıDBrestore ledger toplam0/report count2 PASS. Bu DB kapsamıyla AC-01/02/03/04/06/07/08/10çekirdek/14/15/16/19 ve AC-20DB-restore parçaları doğrulandı; Auth/Storage/production RPO/RTO ve full-night kapsamı ayrı pending. Root CUA AX+screenshot gerçek `/login` formunu doğruladı; authenticated booking/finance akışı bu kanıtla PASS olmaz. İlk HTTP TOTP kapalı hatası temizlendi; configtrue restart sonrası gerçek HTTP tekrar testi exit0 geçti.


Son gerçek local HTTP kanıtı: node tests/web/local-integration.mjs exit0. Password login; AAL1 admin reddi; gerçek TOTP enroll/challenge/verify AAL2; bootstrap, oda tipi/oda/misafir/rezervasyon; aynı-key check-in/payment/check-out replay; balance0 ve tek payment; check-out dirty oda; iki KBS blocked_configuration report. Storage own upload/download ve gerçek unrelated UUID object read reddi geçti. Exact iki Storage path kaldırma, SQL scoped fixture cleanup ve Auth user delete PASS; backend bağımsız boşluk kontrolü PASS. Bu izole local API kabulüdür; authenticated tarayıcı otel akışı ve production/provider kabulü değildir.


Nihai bağımsız temizlik/worker kanıtı: backend local SQL properties=0, tenants=0, tüm Auth users=0, fixture Auth users=0, property-documents objects=0, private.command_results=0; fixture state dosyası yok. Gerçek worker process smoke exit0, health healthy ve provider blocked_configuration. Local log/vector restartları gözlendi; observability production kabulü pending. Ayrıntı: [backend verification](docs/backend-verification.md).
