-- Kasa hareketleri: folyoya bağlı olmayan nakit hareketleri vardiyanın beklenen nakdine eklenir.
--   cash_in / cash_out : kasa girişi / çıkışı (ör. bozuk para alındı, kargo ödendi), açıklama zorunlu
--   exchange           : döviz bozdurma; aynı exchange_id ile iki satır (alınan döviz +, verilen yerel para -)
--   transfer           : kasa transferi; aynı transfer_id ile iki satır (gönderen vardiyada -, alan vardiyada +)
CREATE TABLE pms.cashier_movements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        uuid NOT NULL REFERENCES pms.cashier_shifts(id),
    kind            text NOT NULL CHECK (kind IN ('cash_in', 'cash_out', 'exchange', 'transfer')),
    currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount          numeric(18,2) NOT NULL CHECK (amount <> 0),
    -- Yerel para karşılığı (döviz bozdurmada dövizli satırın TL değeri); gün sonu muhasebe fişi bu tutarla yazılır.
    base_amount     numeric(18,2) NOT NULL,
    business_date   date NOT NULL,
    group_id        uuid,
    exchange_rate   numeric(18,6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
    counterpart     text CHECK (counterpart IS NULL OR length(counterpart) <= 120),
    description     text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
    reference       text CHECK (reference IS NULL OR length(reference) <= 100),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    CHECK (kind NOT IN ('exchange', 'transfer') OR group_id IS NOT NULL),
    CHECK (kind <> 'cash_in' OR amount > 0),
    CHECK (kind <> 'cash_out' OR amount < 0)
);
CREATE INDEX cashier_movements_shift_idx ON pms.cashier_movements (shift_id);
CREATE INDEX cashier_movements_date_idx ON pms.cashier_movements (business_date);
CREATE INDEX cashier_movements_group_idx ON pms.cashier_movements (group_id) WHERE group_id IS NOT NULL;

-- Kapanmış vardiyanın hareketi değiştirilemez/silinemez (kasa sayımı bozulmasın).
CREATE FUNCTION pms.cashier_movements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Kasa hareketi değiştirilemez veya silinemez.'; END IF;
    IF (SELECT status FROM pms.cashier_shifts WHERE id = NEW.shift_id) <> 'open' THEN
        RAISE EXCEPTION 'Kapanmış kasa vardiyasına hareket yazılamaz.';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER cashier_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON pms.cashier_movements
    FOR EACH ROW EXECUTE FUNCTION pms.cashier_movements_guard();

-- Gün sonu muhasebe fişi: kasa girişi / çıkışının karşı hesapları (Muhasebe → Hesap eşlemeleri ekranından değiştirilebilir).
INSERT INTO pms.gl_accounts (code, name, kind, is_system) VALUES
 ('649', 'Diğer Olağan Gelir ve Kârlar', 'revenue', true),
 ('770', 'Genel Yönetim Giderleri', 'expense', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO pms.gl_mappings (key, account_code) VALUES ('cash.in', '649'), ('cash.out', '770') ON CONFLICT (key) DO NOTHING;
