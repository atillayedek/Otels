-- Acente kontenjanı (allotment): acenteye belirli tarih aralığında oda tipi bazında ayrılan günlük oda sayısı.
-- Kullanılmayan kontenjan, ilgili gecenin release süresi dolana kadar diğer satışlara kapalıdır; süre dolunca serbest kalır.

CREATE TABLE pms.allotments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id     uuid NOT NULL REFERENCES pms.agencies(id),
    room_type_id  uuid NOT NULL REFERENCES pms.room_types(id),
    date_from     date NOT NULL,
    date_to       date NOT NULL,
    rooms         integer NOT NULL CHECK (rooms BETWEEN 1 AND 999),
    release_days  integer NOT NULL DEFAULT 0 CHECK (release_days BETWEEN 0 AND 365),
    notes         text,
    is_active     boolean NOT NULL DEFAULT true,
    created_by    uuid REFERENCES pms.users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    version       integer NOT NULL DEFAULT 1,
    CHECK (date_from < date_to),
    CONSTRAINT allotments_no_overlap EXCLUDE USING gist (agency_id WITH =, room_type_id WITH =, daterange(date_from, date_to) WITH &&) WHERE (is_active)
);
CREATE INDEX allotments_type_dates_idx ON pms.allotments (room_type_id, date_from, date_to) WHERE is_active;

INSERT INTO pms.permissions (code, module, description) VALUES
 ('allotment.manage', 'sales', 'Acente kontenjanı tanımla / değiştir')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 ('SUPER_ADMIN', 'allotment.manage'),
 ('HOTEL_ADMIN', 'allotment.manage'),
 ('GENERAL_MANAGER', 'allotment.manage'),
 ('FRONT_OFFICE_MANAGER', 'allotment.manage'),
 ('SALES', 'allotment.manage')
) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
