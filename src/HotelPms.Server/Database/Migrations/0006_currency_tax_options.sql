-- Döviz kurları, dövizli tahsilat, kasa sayımında döviz ayrımı ve konaklama vergisi işlem kodu.

-- Günlük kur: 1 birim yabancı paranın tesis para birimi karşılığı. Kur geçmişi değiştirilmez; aynı gün için yeniden giriş üzerine yazar
-- ancak daha önce bu kurla alınmış tahsilatlar kendi satırlarındaki kuru korur.
CREATE TABLE pms.exchange_rates (
    currency    char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    rate_date   date NOT NULL,
    rate        numeric(18,6) NOT NULL CHECK (rate > 0),
    source      text NOT NULL CHECK (source IN ('manual', 'tcmb')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES pms.users(id),
    PRIMARY KEY (currency, rate_date)
);

-- Dövizli tahsilat/iade: folyo tutarı (amount) her zaman folyo para birimindedir; misafirden alınan döviz ve uygulanan kur ayrıca saklanır.
ALTER TABLE pms.folio_lines ADD COLUMN tendered_currency char(3);
ALTER TABLE pms.folio_lines ADD COLUMN tendered_amount numeric(18,2);
ALTER TABLE pms.folio_lines ADD COLUMN exchange_rate numeric(18,6);
ALTER TABLE pms.folio_lines ADD CONSTRAINT folio_lines_tendered_check CHECK (
    (tendered_currency IS NULL AND tendered_amount IS NULL AND exchange_rate IS NULL)
    OR (tendered_currency IS NOT NULL AND tendered_amount IS NOT NULL AND tendered_amount <> 0 AND exchange_rate > 0));

-- Kasa kapanışı: her para birimi için beklenen, sayılan ve fark.
CREATE TABLE pms.cashier_shift_counts (
    shift_id    uuid NOT NULL REFERENCES pms.cashier_shifts(id),
    currency    char(3) NOT NULL,
    expected    numeric(18,2) NOT NULL,
    counted     numeric(18,2) NOT NULL CHECK (counted >= 0),
    difference  numeric(18,2) NOT NULL,
    PRIMARY KEY (shift_id, currency)
);

-- Konaklama vergisi gece denetiminde ayrı satır olarak yazılır (oran Yönetim → Finans ayarlarından girilir; 0 ise yazılmaz).
INSERT INTO pms.transaction_codes (code, name, category, vat_rate, is_system) VALUES ('KV', 'Konaklama Vergisi', 'tax', 0, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.permissions (code, module, description) VALUES
 ('exchange_rate.manage', 'finance', 'Döviz kurlarını gir / güncelle')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 ('SUPER_ADMIN', 'exchange_rate.manage'),
 ('HOTEL_ADMIN', 'exchange_rate.manage'),
 ('GENERAL_MANAGER', 'exchange_rate.manage'),
 ('FRONT_OFFICE_MANAGER', 'exchange_rate.manage'),
 ('NIGHT_AUDIT', 'exchange_rate.manage'),
 ('ACCOUNTING', 'exchange_rate.manage'),
 ('CASHIER', 'exchange_rate.manage')
) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
