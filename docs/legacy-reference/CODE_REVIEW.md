# Bağımsız kaynak kalite incelemesi

2026-10-11; kapsam app, components, lib, worker ve migrations001–011. Bu rapor statik/izole kanıttır; bütün ürünün production kabulü değildir.

| Bulgu | Etki | Düzeltme / doğrulama |
|---|---|---|
| SQL version karşılaştırmasında NULL | eksik version concurrency reddini aşabiliyordu | backend IS DISTINCT FROM; core/advanced test kapsamı |
| Ledger/report bağlantıları simple UUID FK | privileged SQL ile farklı property kaydı bağlanabilirdi | migration006 composite property FK; ops011 ek POS/service bağları; negatif SQL testleri |
| Finance UI accounting stays boş | accounting ödeme/charge formları görünmüyordu | web finance-friendly folio stay_status projection007 ile düzelttiğini bildirdi; browser kanıtı gerekli |
| MFA network throw busy state | kullanıcı tekrar deneyemeyebilirdi | web try/catch/finally; browser network-failure doğrulaması pending |
| Docker COPY env context | local secrets image'a girebilirdi | .dockerignore .env* çıkarır, yalnız publishable build args; service key runtime worker |
| Worker loopback container binding | compose port health erişilemezdi | WORKER_HOST env, compose0.0.0.0 iç/127.0.0.1 host port |

Mevcut iyi sınırlar: auth getUser/getClaims doğrulaması; APP_URL exact origin guard; unknown outcome aynı key/payload retry korunması; property lock ve idempotency/audit; SQL decimal para; direct critical-table DML revoke; fixed search_path; worker service-only lease/token/property checks; timeout outcome_unknown, gerçek provider yokken accepted üretilmez.

Anti-pattern taraması runtime kaynaklarında TODO/fake/demo işletme verisi, para parseFloat, client service-role veya dangerouslySetInnerHTML bulmadı. Number kullanımı pagination ve worker interval/port; DB monetary logic numeric. Bu tarama incelemenin sınırlarını aşan güvenlik kanıtı değildir.

Bağımsız kontroller: typecheck exit0; web test6/6 exit0; önceki ops isolated PG16 exit0. Web implementer son build/lint/typecheck ve6/6 testi PASS bildirdi. Root lockfile production dependency audit exit0 ve0 vulnerability. Backend finalPG17 bütün001–012 migration+AAL2+011, yarış ve ayrıDB dump/restore exit0 doğruladı. Gerçek local HTTP/Auth/TOTP/Storage alt kapsam PASS; authenticated browser akışı pending. Yeni2.hesap bağlantısı kullanıcı ekran görüntüsüyle doğrulandı; eski connector catalog/Unknown tool yeni hesap kotasını doğrulamayı engelliyor.

Somut açık sınırlar: tam per-operation RBAC/ABAC ve limitler, financial read AAL2 politikasının kapsamı, rate limits, Storage/Realtime gerçek izolasyon E2E, kimlik/KBS provider modeli ve canlı kabul, VAT/FX/paket/muhasebe/night-audit geniş kapsamı, büyük operasyon tablosu pagination, comprehensive reporting, restore RPO/RTO ve production hosting. Tüm bu konular SRS pending kapsamı içinde tutulur.

Son kanıt: backend finalPG17 verify.ps1 exit0 fresh001–012/coreMFA/ops011/advancedfinance-night/overdueactive/exclusion/worker; concurrent1COMMIT/DBcount1 ve No availability; gerçek pg_dump ayrıDBrestore ledger toplam0/report count2 PASS. Local reset001–012 properties0. Root CUA AX+screenshot `/login` doğrulandı. İlk HTTP TOTP kapalı olduğundan başarısız ve fixture temizliği yapıldı; configtrue restart sonrası gerçek HTTP testi exit0 geçti.


Son gerçek local HTTP kanıtı: node tests/web/local-integration.mjs exit0. Password login; AAL1 admin reddi; gerçek TOTP enroll/challenge/verify AAL2; bootstrap, oda tipi/oda/misafir/rezervasyon; aynı-key check-in/payment/check-out replay; balance0 ve tek payment; check-out dirty oda; iki KBS blocked_configuration report. Storage own upload/download ve gerçek unrelated UUID object read reddi geçti. Exact iki Storage path kaldırma, SQL scoped fixture cleanup ve Auth user delete PASS; backend bağımsız boşluk kontrolü PASS. Bu izole local API kabulüdür; authenticated tarayıcı otel akışı ve production/provider kabulü değildir.


Nihai bağımsız temizlik/worker kanıtı: backend local SQL properties=0, tenants=0, tüm Auth users=0, fixture Auth users=0, property-documents objects=0, private.command_results=0; fixture state dosyası yok. Gerçek worker process smoke exit0, health healthy ve provider blocked_configuration. Local log/vector restartları gözlendi; observability production kabulü pending. Ayrıntı: [backend verification](docs/backend-verification.md).
