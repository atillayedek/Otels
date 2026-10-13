-- Grup rezervasyonu numaralandırması ve arama.
CREATE SEQUENCE IF NOT EXISTS pms.group_number_seq START 1000;
CREATE INDEX IF NOT EXISTS reservation_groups_created_idx ON pms.reservation_groups (created_at DESC);
