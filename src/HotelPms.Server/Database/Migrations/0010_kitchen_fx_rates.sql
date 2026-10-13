-- Mutfak/bar sipariş yazıcıları (ağ üzerinden ESC/POS) ve dövizli fiyat (acente sözleşmeleri).

CREATE TABLE pms.pos_printers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    host        text NOT NULL CHECK (host ~ '^[A-Za-z0-9.-]{1,253}$'),
    port        integer NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
    code_page   text NOT NULL DEFAULT 'PC857' CHECK (code_page IN ('PC857', 'ASCII')),
    line_width  integer NOT NULL DEFAULT 42 CHECK (line_width BETWEEN 24 AND 64),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX pos_printers_name_uq ON pms.pos_printers (lower(name));

-- Ürünün siparişi hangi yazıcıya gider (boşsa sipariş fişi basılmaz, ör. kasadan verilen içecekler).
ALTER TABLE pms.pos_products ADD COLUMN printer_id uuid REFERENCES pms.pos_printers(id);
ALTER TABLE pms.pos_check_lines ADD COLUMN sent_at timestamptz;
ALTER TABLE pms.pos_check_lines ADD COLUMN void_sent_at timestamptz;

-- Dövizli fiyat: fiyat planı ve rezervasyon bir dövizde anlaşılabilir. Mevcut tutar alanları tesis para birimindeki
-- tahmini karşılığı tutar (rezervasyon anındaki kurla); gece denetimi oda ücretini o günün kuruyla çevirerek yazar.
ALTER TABLE pms.rate_plans ADD COLUMN currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
ALTER TABLE pms.reservations ADD COLUMN rate_currency char(3) CHECK (rate_currency IS NULL OR rate_currency ~ '^[A-Z]{3}$');
ALTER TABLE pms.reservations ADD COLUMN fx_nightly_rate numeric(18,2) CHECK (fx_nightly_rate IS NULL OR fx_nightly_rate >= 0);
ALTER TABLE pms.reservations ADD CONSTRAINT reservations_fx_check CHECK ((rate_currency IS NULL) = (fx_nightly_rate IS NULL));
ALTER TABLE pms.reservation_rates ADD COLUMN fx_amount numeric(18,2) CHECK (fx_amount IS NULL OR fx_amount >= 0);
