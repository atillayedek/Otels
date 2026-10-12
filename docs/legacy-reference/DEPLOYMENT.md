# Dağıtım

Web ve worker ayrı process; DB ayrı Supabase lifecycle. Node24 + npm lockfile. Gerçek web scripts package.json; worker plain Node ESM `worker/index.mjs`. Build: `npm ci` → `npm run build`; runtime `npm run start`. `docker compose --env-file .env.local build` ve `docker compose --env-file .env.local up -d` web/worker image ve process'lerini hazırlar; DB'yi oluşturmaz. Publishable URL/key build args ile derlenir, servis secret yalnız runtime environment. .dockerignore env/secret ve local build artefaktlarını context'ten çıkarır. Dockerfiles build/runtime kanıtı tamamlanana kadar tested sayılmaz.

## Ortam

Web `.env.local`: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, APP_URL. Publishable key RLS gerektirir. Worker: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_POLL_MS, WORKER_PORT. Secret server/worker'a environment olarak enjekte edilir; image layer/build arg/Git/client içinde tutulmaz.

Supabase Auth site/redirect URLs APP_URL ve `/auth/callback` ile uyumlu; production HTTPS/SMTP/MFA/backup seçimi ayrıca gerekir. SQL migrations sıralı uygulanır; mevcut gerçek işletme projesine izinsiz migration/test verisi uygulanmaz. Yeni bağlı hesabın bu oturumdaki connector görünürlüğü engeli nedeniyle uzak proje henüz oluşturulmadı; yeni hesap kotası doğrulanmadı.

## Yerel doğrulama

Node24/Docker kullanılabilir. `tests/database/verify.ps1` varsayılan izole PostgreSQL16 container ile SQL verification ve dump/restore sağlar; gerçek Supabase Auth/Storage gateway değildir. `supabase/config.toml` local stack yapılandırması mevcuttur; CLI `supabase start`, `supabase status` ile lokal API/Auth/DB bilgilerini verir. Root local stack erişimini ve properties=0 doğruladı. Gerçek Auth/RLS/Storage/browser E2E ayrı kabul kaydı gerektirir; yalnız stack çalışması tüm modüllerin uçtan uca kabulü değildir.

CI `npm ci`, lint/typecheck/web tests/build ve ayrı Docker SQL verification yürütür. CI deployment/publish yapmaz. GitHub remote repo/push yetkisi veya hedefi doğrulanmadan uzak publish yoktur.

## Cloud engeli

Kullanıcı yeni2.hesap bağlantısını ekran görüntüsüyle doğruladı; ancak mevcut tool catalog eski bağlantıyı gösteriyor ve eski tool link `Unknown tool` dönüyor. Yeni hesabın proje/kotası bilinmiyor. Bilinen Atillayedek hesabında iki aktif proje vardı; [Supabase Free sınırı](https://supabase.com/docs/guides/platform/billing-on-supabase) yeni hesabın slot doluluğunu göstermez. Ücretli upgrade veya mevcut başka projeyi durdurmak seçilmedi. Local geliştirme ve kontroller güncel cloud connector görünürlüğünden bağımsızdır.

## Üretime geçiş kapısı

Tüm kritik AC/SRS acceptance, gerçek KBS/OTA/e-belge/ödeme kapsam kabulü, DB+Storage restore, RPO/RTO, performance target, security/MFA, secrets rotation, monitoring ve migration forward-fix planı. Staging'de aynı build/migrations ve provider config doğrulanır; prod feature flag etkinleşmesi gerçek capabilities'e bağlıdır. HTTP endpoint secret/PII göstermemeli.
