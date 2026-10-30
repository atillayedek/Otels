-- Ana folyo: bir konaklamanın harcamaları (kapsama göre) başka bir konaklamanın (ana odanın) folyosuna yazılır.
-- all: oda ücreti ve ekstralar, room: yalnız oda ücreti ve konaklama vergisi, extras: yalnız elle/restoran masrafları.
ALTER TABLE pms.reservations ADD COLUMN master_reservation_id uuid REFERENCES pms.reservations(id);
ALTER TABLE pms.reservations ADD COLUMN master_scope text NOT NULL DEFAULT 'all' CHECK (master_scope IN ('all', 'room', 'extras'));
ALTER TABLE pms.reservations ADD CONSTRAINT reservations_master_not_self CHECK (master_reservation_id IS DISTINCT FROM id);
CREATE INDEX reservations_master_idx ON pms.reservations (master_reservation_id) WHERE master_reservation_id IS NOT NULL;
