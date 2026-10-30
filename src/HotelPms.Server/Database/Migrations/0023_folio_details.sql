-- Folyo detayı (resepsiyon folyo penceresi) alanları.
-- Misafir kodu: misafir kartının kısa sıra numarası (folyoda M.Kodu, misafir listesinde müşteri no).
CREATE SEQUENCE pms.guest_no_seq;
ALTER TABLE pms.guests ADD COLUMN guest_no bigint;
UPDATE pms.guests SET guest_no = x.n FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM pms.guests) x WHERE x.id = pms.guests.id;
SELECT setval('pms.guest_no_seq', COALESCE((SELECT max(guest_no) FROM pms.guests), 0) + 1, false);
ALTER TABLE pms.guests ALTER COLUMN guest_no SET DEFAULT nextval('pms.guest_no_seq');
ALTER TABLE pms.guests ALTER COLUMN guest_no SET NOT NULL;
ALTER SEQUENCE pms.guest_no_seq OWNED BY pms.guests.guest_no;
CREATE UNIQUE INDEX guests_guest_no_uq ON pms.guests (guest_no);

-- Konaklama (folyo) ayarları
ALTER TABLE pms.reservations ADD COLUMN discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100);
ALTER TABLE pms.reservations ADD COLUMN no_manual_charges boolean NOT NULL DEFAULT false;
ALTER TABLE pms.reservations ADD COLUMN invoice_type text NOT NULL DEFAULT 'invoice' CHECK (invoice_type IN ('invoice', 'receipt'));
ALTER TABLE pms.reservations ADD COLUMN key_card_type text NOT NULL DEFAULT 'GENEL' CHECK (length(key_card_type) BETWEEN 1 AND 30);
ALTER TABLE pms.reservations ADD COLUMN credit_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0);
ALTER TABLE pms.reservations ADD COLUMN note_on_checkout boolean NOT NULL DEFAULT false;
ALTER TABLE pms.reservations ADD COLUMN rate_locked boolean NOT NULL DEFAULT false;

-- Odadaki misafir: oda kartı numarası (kapı kilidi entegrasyonu gelene kadar kayıt olarak) ve aktiflik
ALTER TABLE pms.reservation_guests ADD COLUMN key_card_no text CHECK (key_card_no IS NULL OR length(key_card_no) BETWEEN 1 AND 40);
ALTER TABLE pms.reservation_guests ADD COLUMN is_active boolean NOT NULL DEFAULT true;
