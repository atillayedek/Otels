# Mimari

Modüler monolit: Next.js App Router/React/TypeScript web ve server actions; Supabase Auth, PostgreSQL/RLS; uzun entegrasyon işleri ayrı Node worker. Web üretim süreci `next start`. Node24 yerel çalışma ortamıdır. Paketler lockfile ile sabitlenir; registry doğrulaması olmadan sürüm tahmini yapılmaz.

Tarayıcıdaki publishable key gizli değildir; veriye erişim RLS ile sınırlanır. `lib/supabase.ts` cookie SSR istemcisi oluşturur; `proxy.ts` oturum yenilemesi Next16 konvansiyonudur. Server yetkisi doğrulanmış Auth kimliğinden gelir. Tenant ve property erişimleri PostgreSQL kayıtlarından denetlenir.

Kritik mutation yolu: form → server action → doğrulama → authenticated RPC `public.command` → private SECURITY DEFINER uygulama → izin + property lock + idempotency + domain constraint → transaction → audit + outbox → sonuç → cache/revalidation. Commit başarısızsa UI başarı gösteremez. Frontend kritik tablolara INSERT/UPDATE/DELETE yetkisi almaz.

Mevcut migrationlar property üzerinden tenant kapsamını taşır; tüm tablolarda fiziksel tenant_id kopyası bulunmaz. Composite property FK ilişkileri property dışı bağlamayı engeller. Mevcut property bazlı geniş lock operasyonları serialize eder; gerçek kapasite hedefi ölçülmeden yüksek ölçek iddia edilmez.

Check-in/out transaction içinde KBS report ve outbox oluşur. Worker kurum çağrısını DB transaction içinde bekletmez. KBS erişimi yoksa blocked_configuration kalır; provider sözleşmesi belgelendirilene kadar hiçbir endpoint uydurulmaz. Durable outbox burada yerel DB job deseni olarak geliştirilir; Supabase pgmq kullanılmış iddiası kurulu extension/worker kanıtına bağlıdır.

Dosya saklama/Realtime, tam RBAC/ABAC, SaaS entitlement, sağlayıcı entegrasyonları, merkezi rapor ve geri yükleme kabulü sonraki kapsamdır. Migration dosyası varlığı uzak Supabase üzerinde uygulandığını kanıtlamaz.

Desen kaynakları: [Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Ayrıntılı keşif [plan](docs/plan.md).
