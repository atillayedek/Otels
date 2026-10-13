-- Muhasebe: hesap planı (Tek Düzen Hesap Planı), yevmiye fişleri, otomatik fiş eşlemeleri.
-- Gün sonu fişi gece denetiminde folyo, kasa, restoran ve stok hareketlerinden otomatik oluşur.
-- Fişler değiştirilemez; düzeltme ters fişle yapılır. Her fişte borç toplamı alacak toplamına eşit olmak zorundadır.

CREATE TABLE pms.gl_accounts (
    code        text PRIMARY KEY CHECK (code ~ '^[0-9]{3}(\.[0-9A-Z]{1,10}){0,3}$'),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
    kind        text NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    is_system   boolean NOT NULL DEFAULT false,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Tek Düzen Hesap Planı'nın otel işlemlerinde kullanılan hesapları. Mali müşavir alt hesapları kendi düzenine göre ekleyebilir/değiştirebilir.
INSERT INTO pms.gl_accounts (code, name, kind, is_system) VALUES
 ('100', 'Kasa', 'asset', true),
 ('100.01', 'TL kasası', 'asset', true),
 ('100.02', 'Döviz kasası', 'asset', true),
 ('102', 'Bankalar', 'asset', true),
 ('102.01', 'Banka hesabı', 'asset', true),
 ('108', 'Diğer Hazır Değerler', 'asset', true),
 ('108.01', 'Kredi kartı tahsilatları', 'asset', true),
 ('120', 'Alıcılar', 'asset', true),
 ('120.01', 'Konaklayan misafirler', 'asset', true),
 ('120.02', 'Şirket ve acente carileri', 'asset', true),
 ('150', 'İlk Madde ve Malzeme', 'asset', true),
 ('191', 'İndirilecek KDV', 'asset', true),
 ('320', 'Satıcılar', 'liability', true),
 ('360', 'Ödenecek Vergi ve Fonlar', 'liability', true),
 ('360.01', 'Konaklama vergisi', 'liability', true),
 ('391', 'Hesaplanan KDV', 'liability', true),
 ('600', 'Yurt İçi Satışlar', 'revenue', true),
 ('600.01', 'Konaklama gelirleri', 'revenue', true),
 ('600.02', 'Yiyecek ve içecek gelirleri', 'revenue', true),
 ('600.09', 'Diğer hizmet gelirleri', 'revenue', true),
 ('611', 'Satış İskontoları', 'expense', true),
 ('646', 'Kambiyo Karları', 'revenue', true),
 ('656', 'Kambiyo Zararları', 'expense', true),
 ('740', 'Hizmet Üretim Maliyeti', 'expense', true);

-- Otomatik fiş eşlemeleri: hangi işlem hangi hesaba yazılır. Mali müşavir değiştirebilir.
CREATE TABLE pms.gl_mappings (
    key           text PRIMARY KEY,
    account_code  text NOT NULL REFERENCES pms.gl_accounts(code),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pms.gl_mappings (key, account_code) VALUES
 ('cash.cash', '100.01'), ('cash.fx', '100.02'), ('cash.credit_card', '108.01'), ('cash.bank_transfer', '102.01'), ('cash.other', '100.01'),
 ('receivable.guest', '120.01'), ('receivable.account', '120.02'),
 ('revenue.room', '600.01'), ('revenue.food_beverage', '600.02'), ('revenue.minibar', '600.02'),
 ('revenue.laundry', '600.09'), ('revenue.telephone', '600.09'), ('revenue.spa', '600.09'), ('revenue.transfer', '600.09'),
 ('revenue.misc', '600.09'), ('revenue.package', '600.09'),
 ('tax.accommodation', '360.01'), ('vat.output', '391'), ('vat.input', '191'), ('discount', '611'),
 ('stock.inventory', '150'), ('stock.consumption', '740'), ('stock.payable', '320'),
 ('fx.gain', '646'), ('fx.loss', '656');

-- İşlem koduna özel gelir hesabı (boşsa kategorinin eşlemesi kullanılır).
ALTER TABLE pms.transaction_codes ADD COLUMN gl_account text REFERENCES pms.gl_accounts(code);

CREATE SEQUENCE pms.gl_entry_seq START 1;
CREATE TABLE pms.gl_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_no        bigint NOT NULL UNIQUE DEFAULT nextval('pms.gl_entry_seq'),
    entry_date      date NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('day', 'manual', 'reversal')),
    business_date   date,
    description     text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
    reversal_of     uuid REFERENCES pms.gl_entries(id),
    created_by      uuid REFERENCES pms.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'day' OR business_date IS NOT NULL),
    CHECK (kind <> 'reversal' OR reversal_of IS NOT NULL)
);
CREATE UNIQUE INDEX gl_entries_day_uq ON pms.gl_entries (business_date) WHERE kind = 'day';
CREATE UNIQUE INDEX gl_entries_reversal_uq ON pms.gl_entries (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX gl_entries_date_idx ON pms.gl_entries (entry_date);

CREATE TABLE pms.gl_lines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id      uuid NOT NULL REFERENCES pms.gl_entries(id),
    line_no       integer NOT NULL,
    account_code  text NOT NULL REFERENCES pms.gl_accounts(code),
    debit         numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit        numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description   text,
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
    UNIQUE (entry_id, line_no)
);
CREATE INDEX gl_lines_account_idx ON pms.gl_lines (account_code);

-- Fiş dengesi işlem sonunda (tüm satırlar yazıldıktan sonra) denetlenir.
CREATE FUNCTION pms.gl_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
    SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0) INTO d, c FROM pms.gl_lines WHERE entry_id = NEW.entry_id;
    IF d <> c THEN
        RAISE EXCEPTION 'Muhasebe fişi dengesiz: borç % / alacak %', d, c USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gl_lines_balanced AFTER INSERT ON pms.gl_lines DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION pms.gl_entry_balanced();

CREATE FUNCTION pms.gl_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Muhasebe fişleri değiştirilemez; düzeltme için ters fiş kesin' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER gl_lines_no_update BEFORE UPDATE OR DELETE ON pms.gl_lines FOR EACH ROW EXECUTE FUNCTION pms.gl_immutable();
CREATE TRIGGER gl_entries_no_update BEFORE UPDATE OR DELETE ON pms.gl_entries FOR EACH ROW EXECUTE FUNCTION pms.gl_immutable();

INSERT INTO pms.permissions (code, module, description) VALUES
 ('accounting.view', 'accounting', 'Muhasebe fişleri, mizan ve hesap ekstresi'),
 ('accounting.manage', 'accounting', 'Hesap planı, eşlemeler, elle fiş ve ters fiş')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 ('SUPER_ADMIN', 'accounting.view'), ('SUPER_ADMIN', 'accounting.manage'),
 ('HOTEL_ADMIN', 'accounting.view'), ('HOTEL_ADMIN', 'accounting.manage'),
 ('GENERAL_MANAGER', 'accounting.view'), ('GENERAL_MANAGER', 'accounting.manage'),
 ('ACCOUNTING', 'accounting.view'), ('ACCOUNTING', 'accounting.manage')
) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
