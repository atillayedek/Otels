# Uygulama ve doğrulama durumu

2026-10-11 MFA düzeltmesi: Auth logunda aynı `Tesis doğrulayıcı` adıyla yarım kalmış kayıt çakışması doğrulandı. MFA bileşeni SDK `all` listesindeki yalnız kendi adlı, doğrulanmamış TOTP kaydını yeniler; doğrulanmış faktörü kullanır ve ekranda QR varken tekrar enrollment başlatmaz. Gerçek yerel HTTP regresyonu ad çakışmasını üretme, yenileme, TOTP AAL2 doğrulama ve doğrulanmış faktörü yeniden bulma adımlarında exit0 geçti; kapsamlı mevcut HTTP akışı ve geçici kayıt temizliği de geçti. Bu test kullanıcının doğrulayıcı uygulamasında kurulum yaptığı anlamına gelmez.

Bu rapor kaynak inceleme snapshot'ıdır. Kod varlığı, çalıştırılmış doğrulama ve canlı kabul ayrı durumlar. Son test sonuçları tamamlandığında root tarafından güncellenmelidir.

| Alan | Kaynakta görülen uygulama | Doğrulama / kabul |
|---|---|---|
| Temel tenant/property/auth/access | core migration, SSR web temeli | PG17 core/MFA PASS bildirildi; gerçek local HTTP PASS; uzak deploy yok |
| Oda/tip/guest | scoped RPC CRUD | PG17 core PASS |
| Confirmed reservation/amend/cancel | DB inventory lock, version, composite FK | PG17 core/advanced PASS; eşzamanlı son oda yarışında1COMMIT/DBcount1 PASS |
| Check-in/out/move/extend | stay/folio/dirty/task/KBS atomic commands + timestamp room assignment geçmişi/aktif oda unique | PG17 core/advanced PASS; tam kimlik pending |
| Manual finans | charge/payment/refund/reverse/transfer | PG17 core/advanced numeric/idempotency PASS; gerçek local HTTP PASS |
| HK/bakım | cleanliness/block/release commands | tam görev/atama/checklist pending |
| Multi-folyo/gece kapanışı | folio.create, unique nightly_postings, KBS/geliş/çıkış blocker ve atomic business_date.close | PG17 advanced PASS; tam night audit pending |
| MFA | migration005 admin/finance JWT aal2 enforcement; /account TOTP | PG17 MFA ve gerçek local Auth/TOTP AAL2 PASS; authenticated browser kabulü bekliyor |
| KBS | reports/outbox/manual status, gerçek lease worker | PG17 worker PASS; live blocked_configuration, provider kabul yok |
| Storage policy | migration003 private property-documents bucket, scoped select/admin insert | gerçek local Storage own upload/download ve unrelated object denial PASS; kapsamlı lifecycle pending |
| Web | Next16 login/tesis/operasyon server actions | build/lint/types6tests PASS; root gerçek browser login formunu doğruladı; authenticated E2E bekliyor |
| Dokümantasyon | zorunlu kapsam, contract ve runbook belgeleri | uygulamayla sürekli sync gerekli |

Cloud erişim durumu (2026-10-11 son kontrol): **2.hesap artık bağlayıcıdan erişilebilir.** Gerçek list_projects sonucu boş; list_organizations ve get_organization sonucunda `Otels` (`jsyqymzpjtbeautaphnm`) organizasyonu ve Free plan doğrulandı. Önceki oturumun eski hesap listesi engeli kalktı. Henüz bulut projesi oluşturulmadı; maliyet ve oluşturma uygunluğu provisioning sırasında ayrıca doğrulanmalı. Uygulama yerel Supabase kullanmaya devam ediyor. Ücretli upgrade veya başka projeyi pause etmek yetkilendirilmiş değildir.

Tamamlanmamış kapsam: Auth production setup/SMTP ve comprehensive RBAC; Storage bütün-stack kabulü/Realtime; group/options/no-show/day-use/identity fields; rates/holds/allotments; kapsamlı night audit/e-belge/currency/tax/revenue center/shift/aging; OTA/booking engine/guest portal; aşağıdaki advanced POS/stock/purchase/SPA/banquet/CRM kapsamı; chain/CRS/SaaS/extended products/personnel/assets, reports/export/alerts/AI, provider acceptance, production Auth/Storage restore ve RPO/RTO/performance/deployment. [SRS](SRS.md) tam maddeler için pending izler; kaynakta kısmi feature gereksinim bütününün tamamlandığı anlamına gelmez.

Üretime engel: gerçek KBS bağlantısı ve kurum kabulü, cloud proje/deploy, kritik güvenlik/quality doğrulamaları, üretim Auth/Storage yedekten dönüş ve RPO/RTO kabulü, nihai tam modül kapsamı. **Production ready beyanı yoktur.**

## Operasyon fazı — doğrulanmış alt kapsam

Migration `202610110010_operations.sql`, `/operations` dedicated sayfa/server action, `components/operations.tsx`, `lib/operations-validation.ts` eklendi. Tesis sahibi/müdür admin izniyle çalışır; bu rollerin ayrı POS/stok/CRM çalışan rollerine ayrılması pending. Privileged işlem backend AAL2 şartına bağlı; sayfa MFA gerektiğinde `/account` yönlendirir.

- Ürün/birim/satış fiyatı, depo, tedarikçi ve tek ürünlü satın alma siparişi/iptali; tek tam teslim receipt idempotent. Kalıcı stok hareketleri, negatif stok engeli ve ağırlıklı ortalama maliyet.
- Açık adisyon/ürün satırları/iptal; aktarım stok tüketimi ve açık konaklama folyo charge kaydını atomik yapar. Ürün fiyatı satırda saklanır. Aynı command key tekrar tüketmez/ücretlemez.
- Append-only iletişim izin/ret kanıtı ve CRM hizmet/şikayet/çözüm kaydı. Mesaj veya kampanya sağlayıcısı gönderimi yok.
- SPA/banket kaynak kapasitesi; timezone içeren timestamp rezervasyonu, DB exclusion ile çakışma engeli; rezervasyon iptali ve açık folyoya tek ücret aktarımı.

İlk izole **PostgreSQL16** migration010 testinde receipt replay/duplicate reject, 10@4+10@6 ağırlıklı ortalama5, POS 2 tüketim sonrası quantity18 ve ledger20.20, replay, stok yetersizliği atomik rollback, direct journal write reddi, CRM/consent, booking overlap exclusion, service posting, cross-tenant select/RPC reddi exit0 geçti. **Son fresh PostgreSQL17 bütün001–012 testi de exit0**; AAL2 ve011 cross-property ledger FK negatif senaryoları dahil edildi. Fixtures ROLLBACK; production seed yok.

Advanced pending: unit conversions/transfers/returns/count/recipe/fire/lot/expiry, minimum-stock otomasyonu; multi-line purchase/partial receipts/budget/approval/quotes/invoice matching; POS modifiers/kitchen/printer/QR/split/cash settlement/tax; CRM campaigns/loyalty/profile merge/consent delivery; SPA packages/staff/recurrence, banquet offer/contracts/equipment/tasks/invoice; table pagination beyond first100. Full SRS pending satırları bu dar alt kapsamın PASS sonucu ile topluca tamamlandı olmaz.

## Son doğrulama kanıtı

- Bağımsız `npm run typecheck`: exit0 (operations sayfası, AAL2 gate ve yeni UI dahil).
- Bağımsız `npm run test:web`: exit0; 6/6. Money string/precision/manual method, strict reservation dates, consent withdrawalfalse, nonzero quantity/scale ve explicit timezone booking sınırları.
- Web implementer **son build/lint/typecheck ve6/6 web testi exit0** bildirdi; routes `/`, `/account`, `/auth/callback`, `/login`, `/operations` build'e dahil. Root mevcut lockfile üzerinde `npm audit --omit=dev --json` exit0 ve production vulnerability total0 doğruladı. Bu dependency audit uygulama güvenlik sertifikası değildir.
- Kaynak kalite incelemesi: app/components/lib/worker/migrations tarandı. TODO/fake/demo işletme kayıtları, parseFloat ile para, dangerouslySetInnerHTML veya client service_role bulunmadı. Number kullanım alanları pagination/worker timing; finans SQL decimal ve string input. KBS accepted durumunu üreten uydurma provider yok.
- İnceleme bulguları: eksik version SQL NULL bypass backend tarafından IS DISTINCT FROM düzeltildi; cross-property financial/report FK006 ve operations ledger FK011 eklendi. Muhasebe ekranı açık-stay selector ve MFA ağ-hatası busy state web tarafından düzeltildiği bildirildi; son browser kanıtı ayrıca gerekir.
- Backend son **`powershell -NoProfile -ExecutionPolicy Bypass -File tests/database/verify.ps1 -Image postgres:17-alpine` exit0** doğruladı: fresh migrations001–012; core/MFA/RLS; operations011 cross-property FK; exact financial transfer/refund/reversal/night idempotency; overdue aktif oda/assignment extend/exclusion; worker ordered claim/expiry→unknown; iki eşzamanlı SQL session'da tam1COMMIT, diğer No availability ve DB reservation count1. Gerçek pg_dump ayrı yeni DB'ye restore edildi; ledger toplam0/report count2 invariantları geçti. Windows process ExitCode belirsizliği harness'ta actualCOMMIT+DBcount bağımsız kanıtıyla düzeltildi.
- Local Supabase reset001–012 ve properties=0 backend/root tarafından doğrulandı; geçici DB test fixture üretim kayıtlarından ayrıdır. Root CUA127.0.0.1:3000 reload sonrası `/login` erişimini AX ve ekran görüntüsüyle doğruladı: gerçek e-posta/parola formu, config hatası yok. Bu **authenticated otel akışı kabulü değildir**. Gerçek local HTTP/Auth/TOTP/Storage alt kapsam PASS; authenticated browser sonucu ayrı bekleniyor; Docker image/live deployment ayrı kanıt gerektirir.
- İlk gerçek HTTP/MFA denemesi local TOTP kapalı olduğundan başarısız oldu; geçici kayıt temizliği doğrulandı. TOTP config etkinleştirme/restart sonrası gerçek HTTP tekrar testi exit0 geçti. Bu başarısız deneme başarılı MFA kabulü diye raporlanmaz.


Son gerçek local HTTP kanıtı: node tests/web/local-integration.mjs exit0. Password login; AAL1 admin reddi; gerçek TOTP enroll/challenge/verify AAL2; bootstrap, oda tipi/oda/misafir/rezervasyon; aynı-key check-in/payment/check-out replay; balance0 ve tek payment; check-out dirty oda; iki KBS blocked_configuration report. Storage own upload/download ve gerçek unrelated UUID object read reddi geçti. Exact iki Storage path kaldırma, SQL scoped fixture cleanup ve Auth user delete PASS; backend bağımsız boşluk kontrolü PASS. Bu izole local API kabulüdür; authenticated tarayıcı otel akışı ve production/provider kabulü değildir.


Nihai bağımsız temizlik/worker kanıtı: backend local SQL properties=0, tenants=0, tüm Auth users=0, fixture Auth users=0, property-documents objects=0, private.command_results=0; fixture state dosyası yok. Gerçek worker process smoke exit0, health healthy ve provider blocked_configuration. Local log/vector restartları gözlendi; observability production kabulü pending. Ayrıntı: [backend verification](docs/backend-verification.md).
