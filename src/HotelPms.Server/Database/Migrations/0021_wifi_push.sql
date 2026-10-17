-- Wi-Fi entegrasyonu, otomatik gönderim: misafir odaya giriş yapınca, odası/kalışı değişince ve çıkışta kimlik no + oda numarası
-- Wi-Fi firmasının otel ağındaki adresine (yalnız yerel ağ) imzalı olarak gönderilir.
ALTER TABLE pms.wifi_config ADD COLUMN webhook_url text CHECK (webhook_url IS NULL OR length(webhook_url) <= 300);
ALTER TABLE pms.wifi_config ADD COLUMN webhook_secret text CHECK (webhook_secret IS NULL OR length(webhook_secret) BETWEEN 16 AND 128);
-- Otel ağındaki cihazlar çoğu zaman kendinden imzalı sertifika kullanır; yalnız yerel ağ adresinde ve açıkça istenirse doğrulama atlanır.
ALTER TABLE pms.wifi_config ADD COLUMN webhook_insecure_tls boolean NOT NULL DEFAULT false;

-- Wi-Fi sistemine en son başarıyla bildirilen durum (konaklama + misafir başına). Fark oluşunca yeniden gönderilir.
CREATE TABLE pms.wifi_push_state (
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id),
    guest_id        uuid NOT NULL REFERENCES pms.guests(id),
    identity_number text NOT NULL,
    room_number     text NOT NULL,
    password        text NOT NULL,
    valid_until     timestamptz NOT NULL,
    sent_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (reservation_id, guest_id)
);

-- Gönderim günlüğü (destek için; bakım temizliğinde 180 günden eskiler silinir). Kimlik numarası maskeli tutulur.
CREATE TABLE pms.wifi_push_log (
    id              bigserial PRIMARY KEY,
    at              timestamptz NOT NULL DEFAULT now(),
    event           text NOT NULL,
    room_number     text,
    username_masked text,
    status_code     integer,
    error           text
);
CREATE INDEX wifi_push_log_at_idx ON pms.wifi_push_log (at);
