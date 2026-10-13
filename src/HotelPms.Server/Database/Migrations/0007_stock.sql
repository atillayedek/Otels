-- Stok ve satın alma: depolar, stok kartları, tedarikçiler, satın alma siparişleri, stok belgeleri (mal kabul, çıkış, transfer, sayım).
-- Stok hareketleri değiştirilemez; iptal ters hareketle yapılır. Bakiye ve ağırlıklı ortalama maliyet stock_balances tablosunda tutulur.

CREATE TABLE pms.warehouses (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,16}$'),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX warehouses_code_uq ON pms.warehouses (code);

CREATE TABLE pms.stock_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,24}$'),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
    unit        text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 12),
    category    text,
    barcode     text,
    min_qty     numeric(18,3) CHECK (min_qty IS NULL OR min_qty >= 0),
    vat_rate    numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 100),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX stock_items_code_uq ON pms.stock_items (code);
CREATE UNIQUE INDEX stock_items_barcode_uq ON pms.stock_items (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE pms.suppliers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    tax_office    text,
    tax_number    text,
    contact_name  text,
    phone         text,
    email         text,
    address       text,
    notes         text,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    version       integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX suppliers_tax_number_uq ON pms.suppliers (tax_number) WHERE tax_number IS NOT NULL;

CREATE SEQUENCE pms.purchase_order_seq START 1000;
CREATE TABLE pms.purchase_orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no        text NOT NULL UNIQUE,
    supplier_id     uuid NOT NULL REFERENCES pms.suppliers(id),
    warehouse_id    uuid NOT NULL REFERENCES pms.warehouses(id),
    status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
    order_date      date NOT NULL,
    expected_date   date,
    notes           text,
    cancel_reason   text,
    created_by      uuid REFERENCES pms.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
CREATE INDEX purchase_orders_status_idx ON pms.purchase_orders (status, order_date);

CREATE TABLE pms.purchase_order_lines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL REFERENCES pms.purchase_orders(id) ON DELETE CASCADE,
    line_no       integer NOT NULL,
    item_id       uuid NOT NULL REFERENCES pms.stock_items(id),
    quantity      numeric(18,3) NOT NULL CHECK (quantity > 0),
    unit_cost     numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
    vat_rate      numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 100),
    received_qty  numeric(18,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    UNIQUE (order_id, line_no)
);

CREATE SEQUENCE pms.stock_document_seq START 1000;
CREATE TABLE pms.stock_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_no              text NOT NULL UNIQUE,
    kind                text NOT NULL CHECK (kind IN ('receipt', 'issue', 'transfer', 'count', 'pos')),
    warehouse_id        uuid NOT NULL REFERENCES pms.warehouses(id),
    target_warehouse_id uuid REFERENCES pms.warehouses(id),
    supplier_id         uuid REFERENCES pms.suppliers(id),
    purchase_order_id   uuid REFERENCES pms.purchase_orders(id),
    invoice_no          text,
    invoice_date        date,
    department          text,
    reference           text,
    notes               text,
    business_date       date NOT NULL,
    created_by          uuid REFERENCES pms.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    is_cancelled        boolean NOT NULL DEFAULT false,
    cancelled_by        uuid REFERENCES pms.users(id),
    cancelled_at        timestamptz,
    cancel_reason       text,
    CHECK (kind <> 'transfer' OR (target_warehouse_id IS NOT NULL AND target_warehouse_id <> warehouse_id)),
    CHECK (NOT is_cancelled OR cancel_reason IS NOT NULL)
);
CREATE INDEX stock_documents_date_idx ON pms.stock_documents (business_date, kind);
CREATE INDEX stock_documents_supplier_idx ON pms.stock_documents (supplier_id) WHERE supplier_id IS NOT NULL;

-- İşaretli miktar: giriş pozitif, çıkış negatif. Maliyet hareket anındaki birim maliyettir.
CREATE TABLE pms.stock_movements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid NOT NULL REFERENCES pms.stock_documents(id),
    item_id         uuid NOT NULL REFERENCES pms.stock_items(id),
    warehouse_id    uuid NOT NULL REFERENCES pms.warehouses(id),
    quantity        numeric(18,3) NOT NULL CHECK (quantity <> 0),
    unit_cost       numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
    is_reversal     boolean NOT NULL DEFAULT false,
    business_date   date NOT NULL,
    created_by      uuid REFERENCES pms.users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_idx ON pms.stock_movements (item_id, warehouse_id, created_at);
CREATE INDEX stock_movements_doc_idx ON pms.stock_movements (document_id);
CREATE INDEX stock_movements_date_idx ON pms.stock_movements (business_date);

CREATE FUNCTION pms.stock_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Stok hareketleri değiştirilemez; düzeltme için belge iptali veya sayım kullanın' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE OR DELETE ON pms.stock_movements
    FOR EACH ROW EXECUTE FUNCTION pms.stock_movements_immutable();

CREATE TABLE pms.stock_balances (
    warehouse_id  uuid NOT NULL REFERENCES pms.warehouses(id),
    item_id       uuid NOT NULL REFERENCES pms.stock_items(id),
    quantity      numeric(18,3) NOT NULL DEFAULT 0,
    avg_cost      numeric(18,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, item_id)
);

INSERT INTO pms.permissions (code, module, description) VALUES
 ('stock.view', 'stock', 'Stok kartları, bakiyeler ve hareketleri görüntüle'),
 ('stock.manage', 'stock', 'Depo, stok kartı ve tedarikçi tanımla; stok belgesi iptal et'),
 ('stock.receive', 'stock', 'Mal kabul (stok girişi)'),
 ('stock.issue', 'stock', 'Stok çıkışı ve depolar arası transfer'),
 ('stock.count', 'stock', 'Stok sayımı'),
 ('purchase.manage', 'stock', 'Satın alma siparişleri')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.roles (code, name, is_system) VALUES ('STOCK_KEEPER', 'Depo / Satın Alma', true) ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 ('SUPER_ADMIN', 'stock.view'), ('SUPER_ADMIN', 'stock.manage'), ('SUPER_ADMIN', 'stock.receive'), ('SUPER_ADMIN', 'stock.issue'), ('SUPER_ADMIN', 'stock.count'), ('SUPER_ADMIN', 'purchase.manage'),
 ('HOTEL_ADMIN', 'stock.view'), ('HOTEL_ADMIN', 'stock.manage'), ('HOTEL_ADMIN', 'stock.receive'), ('HOTEL_ADMIN', 'stock.issue'), ('HOTEL_ADMIN', 'stock.count'), ('HOTEL_ADMIN', 'purchase.manage'),
 ('GENERAL_MANAGER', 'stock.view'), ('GENERAL_MANAGER', 'stock.manage'), ('GENERAL_MANAGER', 'stock.receive'), ('GENERAL_MANAGER', 'stock.issue'), ('GENERAL_MANAGER', 'stock.count'), ('GENERAL_MANAGER', 'purchase.manage'),
 ('STOCK_KEEPER', 'dashboard.view'), ('STOCK_KEEPER', 'report.view'),
 ('STOCK_KEEPER', 'stock.view'), ('STOCK_KEEPER', 'stock.manage'), ('STOCK_KEEPER', 'stock.receive'), ('STOCK_KEEPER', 'stock.issue'), ('STOCK_KEEPER', 'stock.count'), ('STOCK_KEEPER', 'purchase.manage'),
 ('ACCOUNTING', 'stock.view'), ('ACCOUNTING', 'purchase.manage'),
 ('HOUSEKEEPING_MANAGER', 'stock.view')
) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
