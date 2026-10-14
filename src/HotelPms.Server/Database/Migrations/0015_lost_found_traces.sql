-- Kayıp eşya defteri ve misafir hatırlatmaları (trace).

CREATE SEQUENCE pms.lost_item_seq START 1;
CREATE TABLE pms.lost_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_no       bigint NOT NULL UNIQUE DEFAULT nextval('pms.lost_item_seq'),
    found_date    date NOT NULL,
    location      text NOT NULL CHECK (length(btrim(location)) BETWEEN 1 AND 120),
    room_id       uuid REFERENCES pms.rooms(id),
    guest_id      uuid REFERENCES pms.guests(id),
    category      text NOT NULL DEFAULT 'other' CHECK (category IN ('clothing', 'electronics', 'jewelry', 'document', 'money', 'bag', 'other')),
    description   text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
    storage       text CHECK (storage IS NULL OR length(storage) <= 120),
    found_by      text CHECK (found_by IS NULL OR length(found_by) <= 100),
    status        text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'returned', 'disposed')),
    returned_to   text CHECK (returned_to IS NULL OR length(returned_to) <= 200),
    closed_at     timestamptz,
    closed_by     uuid,
    close_note    text CHECK (close_note IS NULL OR length(close_note) <= 500),
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid,
    version       integer NOT NULL DEFAULT 1,
    CHECK (status <> 'returned' OR returned_to IS NOT NULL),
    CHECK ((status = 'stored') = (closed_at IS NULL))
);
CREATE INDEX lost_items_status_idx ON pms.lost_items (status, found_date DESC);

CREATE TABLE pms.traces (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id),
    department      text NOT NULL CHECK (department IN ('front_office', 'housekeeping', 'maintenance', 'restaurant', 'accounting', 'management')),
    message         text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 500),
    due_date        date NOT NULL,
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    done_at         timestamptz,
    done_by         uuid,
    done_note       text CHECK (done_note IS NULL OR length(done_note) <= 300),
    CHECK ((status = 'open') = (done_at IS NULL))
);
CREATE INDEX traces_open_idx ON pms.traces (due_date, department) WHERE status = 'open';
CREATE INDEX traces_reservation_idx ON pms.traces (reservation_id);

INSERT INTO pms.permissions (code, module, description) VALUES
 ('lost_found.manage', 'housekeeping', 'Kayıp eşya defteri: kayıt, teslim ve imha'),
 ('trace.manage', 'reservation', 'Misafir hatırlatmaları: ekleme ve tamamlama')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT r.code, p.code FROM pms.roles r CROSS JOIN (VALUES ('lost_found.manage'), ('trace.manage')) AS p(code)
WHERE r.code IN ('SUPER_ADMIN', 'HOTEL_ADMIN', 'GENERAL_MANAGER', 'FRONT_OFFICE_MANAGER', 'RECEPTION', 'NIGHT_AUDIT', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING')
ON CONFLICT DO NOTHING;
INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT r.code, 'trace.manage' FROM pms.roles r WHERE r.code IN ('TECHNICAL', 'CASHIER', 'ACCOUNTING', 'SALES')
ON CONFLICT DO NOTHING;
