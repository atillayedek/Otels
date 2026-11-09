-- Kullanıcıya özel web girişi doğrulama kodu (MFA). Kod PMS istemcisinde gösterilir, 10 saniyede bir yenilenir;
-- internetten (otel web sitesi yönetim girişi) oturum açarken parolayla birlikte istenir.
-- Gizli anahtar sunucu anahtarıyla şifreli saklanır (AES-GCM); veritabanı yedeği tek başına kod üretmeye yetmez.
CREATE TABLE pms.user_mfa (
    user_id     uuid PRIMARY KEY REFERENCES pms.users(id) ON DELETE CASCADE,
    secret_enc  bytea NOT NULL,
    -- Son kabul edilen kod adımı: aynı kod ikinci kez kullanılamaz (tekrar oynatma koruması).
    last_step   bigint NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
