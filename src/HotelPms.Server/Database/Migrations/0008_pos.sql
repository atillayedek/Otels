-- Restoran / bar satış noktası (POS): satış noktaları, menü ürünleri, reçeteler, adisyonlar ve adisyon ödemeleri.
-- Adisyon odaya aktarılırsa misafir folyosuna masraf yazılır; doğrudan ödenirse ödeme kasa vardiyasına işlenir.
-- Reçetesi olan ürünler adisyon kapanınca satış noktasının deposundan düşülür.

CREATE TABLE pms.pos_outlets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,16}$'),
    name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    transaction_code_id uuid NOT NULL REFERENCES pms.transaction_codes(id),
    warehouse_id        uuid REFERENCES pms.warehouses(id),
    sort_order          integer NOT NULL DEFAULT 0,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX pos_outlets_code_uq ON pms.pos_outlets (code);

CREATE TABLE pms.pos_products (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,24}$'),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    category    text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 60),
    price       numeric(18,2) NOT NULL CHECK (price >= 0),
    vat_rate    numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 100),
    sort_order  integer NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX pos_products_code_uq ON pms.pos_products (code);

-- Ürünün satılabildiği satış noktaları; hiç satır yoksa tüm satış noktalarında satılır.
CREATE TABLE pms.pos_product_outlets (
    product_id  uuid NOT NULL REFERENCES pms.pos_products(id) ON DELETE CASCADE,
    outlet_id   uuid NOT NULL REFERENCES pms.pos_outlets(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, outlet_id)
);

-- Reçete: bir porsiyon/adet satışta düşülecek stok miktarı.
CREATE TABLE pms.pos_recipes (
    product_id      uuid NOT NULL REFERENCES pms.pos_products(id) ON DELETE CASCADE,
    stock_item_id   uuid NOT NULL REFERENCES pms.stock_items(id),
    quantity        numeric(18,3) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (product_id, stock_item_id)
);

CREATE SEQUENCE pms.pos_check_seq START 1;
CREATE TABLE pms.pos_checks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    check_no            bigint NOT NULL UNIQUE DEFAULT nextval('pms.pos_check_seq'),
    outlet_id           uuid NOT NULL REFERENCES pms.pos_outlets(id),
    table_label         text,
    covers              integer NOT NULL DEFAULT 1 CHECK (covers BETWEEN 1 AND 500),
    status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
    business_date       date NOT NULL,
    opened_by           uuid REFERENCES pms.users(id),
    opened_at           timestamptz NOT NULL DEFAULT now(),
    note                text,
    discount_amount     numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    discount_reason     text,
    total_amount        numeric(18,2) CHECK (total_amount IS NULL OR total_amount >= 0),
    settlement          text CHECK (settlement IN ('room', 'payment', 'complimentary')),
    reservation_id      uuid REFERENCES pms.reservations(id),
    folio_line_id       uuid REFERENCES pms.folio_lines(id),
    stock_document_id   uuid REFERENCES pms.stock_documents(id),
    closed_by           uuid REFERENCES pms.users(id),
    closed_at           timestamptz,
    closed_business_date date,
    cancel_reason       text,
    version             integer NOT NULL DEFAULT 1,
    CHECK (discount_amount = 0 OR discount_reason IS NOT NULL),
    CHECK (status <> 'closed' OR (settlement IS NOT NULL AND closed_business_date IS NOT NULL)),
    CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
    CHECK (settlement IS DISTINCT FROM 'room' OR (reservation_id IS NOT NULL AND folio_line_id IS NOT NULL))
);
CREATE INDEX pos_checks_open_idx ON pms.pos_checks (outlet_id) WHERE status = 'open';
CREATE INDEX pos_checks_closed_idx ON pms.pos_checks (closed_business_date, outlet_id) WHERE status = 'closed';
CREATE INDEX pos_checks_reservation_idx ON pms.pos_checks (reservation_id) WHERE reservation_id IS NOT NULL;

CREATE TABLE pms.pos_check_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id    uuid NOT NULL REFERENCES pms.pos_checks(id),
    product_id  uuid NOT NULL REFERENCES pms.pos_products(id),
    name        text NOT NULL,
    quantity    numeric(12,3) NOT NULL CHECK (quantity > 0),
    unit_price  numeric(18,2) NOT NULL CHECK (unit_price >= 0),
    amount      numeric(18,2) NOT NULL CHECK (amount >= 0),
    vat_rate    numeric(5,2) NOT NULL,
    note        text,
    added_by    uuid REFERENCES pms.users(id),
    added_at    timestamptz NOT NULL DEFAULT now(),
    is_void     boolean NOT NULL DEFAULT false,
    void_reason text,
    voided_by   uuid REFERENCES pms.users(id),
    voided_at   timestamptz,
    CHECK (NOT is_void OR void_reason IS NOT NULL)
);
CREATE INDEX pos_check_lines_check_idx ON pms.pos_check_lines (check_id);

-- Doğrudan ödenen adisyonların tahsilatları (folyoya değil, kasa vardiyasına işlenir).
CREATE TABLE pms.pos_payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id            uuid NOT NULL REFERENCES pms.pos_checks(id),
    payment_method_id   uuid NOT NULL REFERENCES pms.payment_methods(id),
    amount              numeric(18,2) NOT NULL CHECK (amount <> 0),
    currency            char(3) NOT NULL,
    tendered_currency   char(3),
    tendered_amount     numeric(18,2),
    exchange_rate       numeric(18,6),
    cashier_shift_id    uuid REFERENCES pms.cashier_shifts(id),
    reference           text,
    business_date       date NOT NULL,
    is_reversal         boolean NOT NULL DEFAULT false,
    created_by          uuid REFERENCES pms.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK ((tendered_currency IS NULL AND tendered_amount IS NULL AND exchange_rate IS NULL)
        OR (tendered_currency IS NOT NULL AND tendered_amount IS NOT NULL AND exchange_rate > 0))
);
CREATE INDEX pos_payments_check_idx ON pms.pos_payments (check_id);
CREATE INDEX pos_payments_shift_idx ON pms.pos_payments (cashier_shift_id) WHERE cashier_shift_id IS NOT NULL;
CREATE INDEX pos_payments_date_idx ON pms.pos_payments (business_date);

CREATE FUNCTION pms.pos_payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Adisyon ödemeleri değiştirilemez; düzeltme ters kayıtla yapılır' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER pos_payments_no_update BEFORE UPDATE OR DELETE ON pms.pos_payments
    FOR EACH ROW EXECUTE FUNCTION pms.pos_payments_immutable();

INSERT INTO pms.permissions (code, module, description) VALUES
 ('pos.view', 'pos', 'Adisyonları görüntüle'),
 ('pos.order', 'pos', 'Adisyon aç, ürün ekle'),
 ('pos.settle', 'pos', 'Adisyonu kapat (ödeme veya odaya aktarma)'),
 ('pos.void', 'pos', 'Adisyonda ürün iptali, adisyon iptali ve kapanmış adisyonu iptal'),
 ('pos.discount', 'pos', 'Adisyon indirimi ve ikram'),
 ('pos.manage', 'pos', 'Satış noktaları, menü ve reçeteler')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.roles (code, name, is_system) VALUES
 ('RESTAURANT', 'Restoran / Bar', true),
 ('RESTAURANT_MANAGER', 'Restoran Müdürü', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 ('SUPER_ADMIN', 'pos.view'), ('SUPER_ADMIN', 'pos.order'), ('SUPER_ADMIN', 'pos.settle'), ('SUPER_ADMIN', 'pos.void'), ('SUPER_ADMIN', 'pos.discount'), ('SUPER_ADMIN', 'pos.manage'),
 ('HOTEL_ADMIN', 'pos.view'), ('HOTEL_ADMIN', 'pos.order'), ('HOTEL_ADMIN', 'pos.settle'), ('HOTEL_ADMIN', 'pos.void'), ('HOTEL_ADMIN', 'pos.discount'), ('HOTEL_ADMIN', 'pos.manage'),
 ('GENERAL_MANAGER', 'pos.view'), ('GENERAL_MANAGER', 'pos.order'), ('GENERAL_MANAGER', 'pos.settle'), ('GENERAL_MANAGER', 'pos.void'), ('GENERAL_MANAGER', 'pos.discount'), ('GENERAL_MANAGER', 'pos.manage'),
 ('RESTAURANT', 'dashboard.view'), ('RESTAURANT', 'pos.view'), ('RESTAURANT', 'pos.order'), ('RESTAURANT', 'pos.settle'), ('RESTAURANT', 'cashier.manage'),
 ('RESTAURANT_MANAGER', 'dashboard.view'), ('RESTAURANT_MANAGER', 'report.view'), ('RESTAURANT_MANAGER', 'cashier.manage'), ('RESTAURANT_MANAGER', 'stock.view'),
 ('RESTAURANT_MANAGER', 'pos.view'), ('RESTAURANT_MANAGER', 'pos.order'), ('RESTAURANT_MANAGER', 'pos.settle'), ('RESTAURANT_MANAGER', 'pos.void'),
 ('RESTAURANT_MANAGER', 'pos.discount'), ('RESTAURANT_MANAGER', 'pos.manage'),
 ('FRONT_OFFICE_MANAGER', 'pos.view'),
 ('NIGHT_AUDIT', 'pos.view'),
 ('ACCOUNTING', 'pos.view')
) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
