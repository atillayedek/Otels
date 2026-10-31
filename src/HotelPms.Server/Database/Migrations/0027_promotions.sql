-- Aksiyon ve indirimler: plan / oda tipi fiyatına otomatik uygulanan kampanyalar.
--   discount      : konaklama tarihleri aralığındaki gecelere % indirim
--   early_booking : girişten en az min_days_before gün önce alınan rezervasyona % indirim
--   stay_pay      : stay_nights kal, pay_nights öde (her stay_nights gecelik blokta en ucuz geceler ücretsiz)
-- Uyan kampanyalardan misafire en çok indirim sağlayan TEK kampanya uygulanır; elle girilen fiyatta uygulanmaz.
CREATE TABLE pms.promotions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
    name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    kind             text NOT NULL CHECK (kind IN ('discount', 'early_booking', 'stay_pay')),
    discount_pct     numeric(5,2) CHECK (discount_pct IS NULL OR (discount_pct > 0 AND discount_pct < 100)),
    stay_nights      integer CHECK (stay_nights IS NULL OR stay_nights BETWEEN 2 AND 60),
    pay_nights       integer CHECK (pay_nights IS NULL OR pay_nights >= 1),
    min_days_before  integer CHECK (min_days_before IS NULL OR min_days_before BETWEEN 1 AND 730),
    min_nights       integer NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 365),
    stay_from        date NOT NULL,
    stay_to          date NOT NULL,
    book_from        date,
    book_to          date,
    room_type_id     uuid REFERENCES pms.room_types(id),
    rate_plan_id     uuid REFERENCES pms.rate_plans(id),
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid,
    version          integer NOT NULL DEFAULT 1,
    CHECK (stay_to >= stay_from),
    CHECK (book_from IS NULL OR book_to IS NULL OR book_to >= book_from),
    CHECK (kind = 'stay_pay' OR discount_pct IS NOT NULL),
    CHECK (kind <> 'stay_pay' OR (stay_nights IS NOT NULL AND pay_nights IS NOT NULL AND pay_nights < stay_nights)),
    CHECK (kind <> 'early_booking' OR min_days_before IS NOT NULL)
);
CREATE INDEX promotions_active_idx ON pms.promotions (stay_from, stay_to) WHERE is_active;

ALTER TABLE pms.reservations ADD COLUMN promotion_id uuid REFERENCES pms.promotions(id);
