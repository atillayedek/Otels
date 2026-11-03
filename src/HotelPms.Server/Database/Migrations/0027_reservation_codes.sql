-- Rezervasyon kodları: market ve segment tanımları (rezervasyonda listeden seçilir, raporlarda gruplanır).
-- Rezervasyonda kod metin olarak saklanır (reservations.market / reservations.segment); tanım silinse de eski kayıt bozulmaz.
CREATE TABLE pms.reservation_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text NOT NULL CHECK (kind IN ('market', 'segment')),
    code        text NOT NULL CHECK (code ~ '^[A-Z0-9_\-]{1,20}$'),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    sort_order  int NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true,
    version     int NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reservation_codes_kind_code_uq ON pms.reservation_codes (kind, code);
