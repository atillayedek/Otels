-- Stop sale (satışa kapama), takvim notları (özel günler, satış notları) ve misafir yorumları.

-- Stop sale: belirtilen tarihlerde (date_to hariç) oda tipinin (boşsa tüm tiplerin) yeni satışı kapatılır.
-- Mevcut rezervasyonlar etkilenmez; yalnız yeni rezervasyon / walk-in ve tarihi veya tipi değişen rezervasyon denetlenir.
CREATE TABLE pms.stop_sales (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_type_id  uuid REFERENCES pms.room_types(id),
    date_from     date NOT NULL,
    date_to       date NOT NULL,
    reason        text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid,
    closed_at     timestamptz,
    closed_by     uuid,
    CHECK (date_to > date_from),
    CHECK (is_active = (closed_at IS NULL))
);
CREATE INDEX stop_sales_active_idx ON pms.stop_sales (date_from, date_to) WHERE is_active;

-- Takvim notları: özel gün (bayram, fuar, maç...) ve satış notu (o tarihlere rezervasyon alan herkesin görmesi gereken bilgi).
-- date_to dahil (tek günlük not için date_from = date_to).
CREATE TABLE pms.calendar_notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text NOT NULL CHECK (kind IN ('special_day', 'sales_note')),
    date_from   date NOT NULL,
    date_to     date NOT NULL,
    title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
    note        text CHECK (note IS NULL OR length(note) <= 1000),
    color       text NOT NULL DEFAULT '#d97706' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid,
    version     integer NOT NULL DEFAULT 1,
    CHECK (date_to >= date_from)
);
CREATE INDEX calendar_notes_range_idx ON pms.calendar_notes (date_from, date_to) WHERE is_active;

-- Misafir yorumları: övgü, şikâyet, öneri; şikâyet çözülene kadar açık kalır.
CREATE SEQUENCE pms.guest_feedback_seq START 1;
CREATE TABLE pms.guest_feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_no     bigint NOT NULL UNIQUE DEFAULT nextval('pms.guest_feedback_seq'),
    guest_id        uuid NOT NULL REFERENCES pms.guests(id),
    reservation_id  uuid REFERENCES pms.reservations(id),
    kind            text NOT NULL CHECK (kind IN ('compliment', 'complaint', 'suggestion', 'other')),
    department      text NOT NULL CHECK (department IN ('front_office', 'housekeeping', 'maintenance', 'restaurant', 'accounting', 'management', 'other')),
    rating          smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    source          text NOT NULL DEFAULT 'in_person' CHECK (source IN ('in_person', 'phone', 'email', 'survey', 'online', 'other')),
    comment         text NOT NULL CHECK (length(btrim(comment)) BETWEEN 1 AND 2000),
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
    resolution      text CHECK (resolution IS NULL OR length(resolution) <= 1000),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    resolved_at     timestamptz,
    resolved_by     uuid,
    CHECK ((status = 'open') = (resolved_at IS NULL)),
    CHECK (status <> 'resolved' OR resolution IS NOT NULL)
);
CREATE INDEX guest_feedback_status_idx ON pms.guest_feedback (status, created_at DESC);
CREATE INDEX guest_feedback_guest_idx ON pms.guest_feedback (guest_id);

INSERT INTO pms.permissions (code, module, description) VALUES
 ('stop_sale.manage', 'reservation', 'Stop sale: oda tiplerini tarih aralığında satışa kapatma ve kapalı tarihe satış'),
 ('calendar.manage', 'reservation', 'Özel günler takvimi ve satış notları'),
 ('feedback.manage', 'guest', 'Misafir yorumları: kayıt ve çözüm')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT r.code, p.code FROM pms.roles r CROSS JOIN (VALUES ('stop_sale.manage'), ('calendar.manage'), ('feedback.manage')) AS p(code)
WHERE r.code IN ('SUPER_ADMIN', 'HOTEL_ADMIN', 'GENERAL_MANAGER', 'FRONT_OFFICE_MANAGER', 'SALES')
ON CONFLICT DO NOTHING;
INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT r.code, 'feedback.manage' FROM pms.roles r WHERE r.code IN ('RECEPTION', 'NIGHT_AUDIT', 'HOUSEKEEPING_MANAGER')
ON CONFLICT DO NOTHING;
