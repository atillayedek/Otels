# Güvenlik

Güven sınırı: tarayıcı payload güvenilmez; Supabase verified user kimliği ve DB property erişimi authoritative. RLS exposed tablolarda enabled; sensitive mutation private implementation + invoker RPC wrapper. Fixed search_path ve schema-qualified SQL; normal roller kritik tablolara write grant alamaz. service_role yalnız worker/server secret ortamı, hiçbir NEXT_PUBLIC değişkeni veya Git/log içinde yoktur.

Mevcut temel rol modeli nihai RBAC/ABAC değildir. Migration005 admin/finance command'larında sunucu Auth JWT `aal2` şartını uygular. `/account` TOTP enroll/challengeAndVerify sağlar; `/operations` verified claims aal2 olmadan işlem ekranı açmaz. MFA code/client state tek başına backend yetkisi değildir. Tutar limitleri, revoke/session policies, rate limits, kapsamlı identity masking, security events, export permission ve timed support access pending. user_metadata izin kaynağı değildir.

Server actions origin kontrolleri framework davranışıyla doğrulanmalı; APP_URL HTTPS production olmalı. Kullanıcı/tenant cevapları ortak CDN cache'e konmamalı. UI input validation DB constraint ve authorization yerine geçmez. Auth login hata metni secret veya hassas payload göstermemeli; trace correlation maskeli tutulmalı.

Storage migration003 private property-documents bucket, MIME PDF/JPEG/PNG ve5MB limiti, property folder UUID + private.allowed policies sağlar. Gerçek local Storage own upload/download ve unrelated UUID object read denial PASS; signed expiry access, malware ve lifecycle pending. [Storage policy](https://supabase.com/docs/guides/storage/security/access-control) klasör üyelik kontrolünü kullanır. Realtime property publication ve cross-tenant subscription testleri pending.

KVKK saklama/silme, hassas kimlik erişim audit ve veri yerleşimi/aktarım gerçek deployment seçimine göre değerlendirilir. Kimlik görselleri varsayılan tutulmaz; ödeme PAN/CVV kaydı yoktur. Audit normal kullanıcı tarafından değiştirilemez; DBA'ya karşı mutlak immutability iddia edilmez; bağımsız log aktarımı ileride gereklidir.

Doğrulama: auth/anon API reddi, role scope, cross-property FK, SQL RPC unknown command, stale version, retry key reuse, secrets taraması, file/export policies, worker claim token erişimi ve production build. Sadece build geçmesi güvenlik kabulü değildir.


Son gerçek local HTTP kanıtı: node tests/web/local-integration.mjs exit0. Password login; AAL1 admin reddi; gerçek TOTP enroll/challenge/verify AAL2; bootstrap, oda tipi/oda/misafir/rezervasyon; aynı-key check-in/payment/check-out replay; balance0 ve tek payment; check-out dirty oda; iki KBS blocked_configuration report. Storage own upload/download ve gerçek unrelated UUID object read reddi geçti. Exact iki Storage path kaldırma, SQL scoped fixture cleanup ve Auth user delete PASS; backend bağımsız boşluk kontrolü PASS. Bu izole local API kabulüdür; authenticated tarayıcı otel akışı ve production/provider kabulü değildir.


Nihai bağımsız temizlik/worker kanıtı: backend local SQL properties=0, tenants=0, tüm Auth users=0, fixture Auth users=0, property-documents objects=0, private.command_results=0; fixture state dosyası yok. Gerçek worker process smoke exit0, health healthy ve provider blocked_configuration. Local log/vector restartları gözlendi; observability production kabulü pending. Ayrıntı: [backend verification](docs/backend-verification.md).
