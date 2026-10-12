# KBS entegrasyon durumu

**Canlı EGM/Jandarma bağlantısı blocked_configuration.** Kurum kabulü, yazılım sağlayıcı onboarding, tesis kodları, API dokümanı ve gerçek erişim yoktur. Bir rapor tablosu/outbox/worker geliştirmek canlı KBS teslimatını tamamlamaz.

[EGM resmî EGMSEC kılavuzunun](https://m.egm.gov.tr/EGMSEC/KBS-K%C4%B1lavuz.pdf) indekslenen kayıt/ikinci faktör bölümü portal parolası ve OTP adımlarını; [Jandarma e-Devlet hizmeti](https://turkiye.gov.tr/jandarma-kimlik-bildirim-sistemi) doğrulanmış oturum gereğini gösterir. Bunlar makine API sözleşmesi değildir. Resmî PDF doğrudan okunamadı; güncel API alanları/cevapları/zaman sınırları doğrulanmış sayılmaz.

EGM ve Jandarma ayrı provider olmalıdır. Her biri configuration validation, capabilities, payload validation/preparation, submit/response classification ve desteklenirse query/reconciliation/correction/exit yeteneklerini açıkça bildirir. Desteklenmeyen özelliğe düğme veya uydurma endpoint verilmez. CAPTCHA aşma/portal kazıma yoktur.

Mevcut check-in/out/move/extend DB transaction'ı identity_reports ve outbox olayı üretir. Başlangıç durumu blocked_configuration. Worker gerçek provider hazır değilse başarı durumuna yükseltemez. Manuel operator reference ve reason ile reported_manually kaydı oluşturulur; bu otomatik accepted değildir.

Durum sözleşmesi: needs_data, blocked_configuration, queued, processing, sent_awaiting_confirmation, accepted, retry_scheduled, rejected, outcome_unknown, manual_action_required, reported_manually, superseded. Queue kalıcılığı ile provider exactly-once garantisi ayrı konulardır. Timeout sonrası gönderim ulaşmış olabilir; query desteklenmiyorsa operatör incelemesi, kör yeniden gönderim yoktur. Olaylar giriş/düzeltme/çıkış bağımlılığını korur.

Pending: kimlik/provider configuration modeli, payload hash/idempotency/version, masked attempt detayları, backoff/rate limits, query/mutabakat, claim token ownership kapsamı, gerçek kod listesi ve canlı kabul. Tam kimlik belgeleri loglanmaz, varsayılan görsel arşivlenmez. OCR varsa kullanıcı onayı gerekir ve resmî kimlik doğrulaması sayılmaz.

Canlı kabul kanıtı: gerçek tesis erişimi, onaylı test/gerçek senaryo, provider kabul referansı, tekrar/timeout/reject/exit sırası ve tenant izolasyonu. Gerçek kurumlara sahte kimlik göndererek test yapılmaz.
