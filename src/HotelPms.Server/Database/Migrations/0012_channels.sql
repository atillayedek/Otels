-- Satış kanalı takibi: rezervasyonun geldiği kanal (Booking.com, Expedia, HotelRunner…) ve kanalın kendi rezervasyon numarası.
-- Aynı kanal numarasıyla ikinci aktif rezervasyon girilemez (çift kayıt önlemi). Kanal raporu gelir ve komisyon takibine temel olur.

ALTER TABLE pms.reservations ADD COLUMN channel text CHECK (channel IS NULL OR channel ~ '^[a-z0-9_]{2,30}$');
ALTER TABLE pms.reservations ADD COLUMN channel_ref text CHECK (channel_ref IS NULL OR length(btrim(channel_ref)) BETWEEN 1 AND 60);
ALTER TABLE pms.reservations ADD CONSTRAINT reservations_channel_ref_needs_channel CHECK (channel_ref IS NULL OR channel IS NOT NULL);
CREATE UNIQUE INDEX reservations_channel_ref_uq ON pms.reservations (channel, lower(channel_ref))
    WHERE channel_ref IS NOT NULL AND status IN ('tentative', 'confirmed', 'checked_in', 'checked_out');
CREATE INDEX reservations_channel_idx ON pms.reservations (channel, arrival) WHERE channel IS NOT NULL;
