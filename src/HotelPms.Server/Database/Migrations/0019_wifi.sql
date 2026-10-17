-- Misafir Wi-Fi girişi (RADIUS). Otelin hotspot cihazı misafirin giriş ekranına yazdığı kimlik no ve oda numarasını
-- RADIUS ile PMS sunucusuna sorar; PMS, o odada konaklayan misafirse girişe izin verir.
CREATE TABLE pms.wifi_config (
    id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled         boolean NOT NULL DEFAULT false,
    -- Hotspot cihazına girilen ortak gizli anahtar. RADIUS protokolü gereği açık metin saklanır; yalnız settings.manage yetkisiyle görülür.
    shared_secret   text CHECK (shared_secret IS NULL OR length(shared_secret) BETWEEN 16 AND 128),
    -- İzin verilen hotspot cihazı IP adresleri. Boşsa yerel ağdaki (RFC1918) tüm cihazlar ortak anahtarla sorabilir.
    allowed_clients text[] NOT NULL DEFAULT '{}',
    -- Şifre olarak oda numarası (room) veya soyadı (last_name).
    password_mode   text NOT NULL DEFAULT 'room' CHECK (password_mode IN ('room', 'last_name')),
    include_sharers boolean NOT NULL DEFAULT true,
    -- Çıkış saatinden sonra internetin açık kalacağı süre (saat).
    grace_hours     integer NOT NULL DEFAULT 2 CHECK (grace_hours BETWEEN 0 AND 24),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid
);
INSERT INTO pms.wifi_config (id) VALUES (1);

-- Hotspot cihazının gönderdiği oturum (accounting) kayıtları: hangi misafir, hangi cihaz (MAC), hangi iç IP, ne zaman.
CREATE TABLE pms.wifi_sessions (
    id              bigserial PRIMARY KEY,
    nas_ip          inet NOT NULL,
    acct_session_id text NOT NULL,
    username_masked text,
    guest_id        uuid REFERENCES pms.guests(id),
    reservation_id  uuid REFERENCES pms.reservations(id),
    room_number     text,
    mac             text,
    framed_ip       inet,
    started_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    stopped_at      timestamptz,
    input_bytes     bigint NOT NULL DEFAULT 0,
    output_bytes    bigint NOT NULL DEFAULT 0,
    terminate_cause text,
    UNIQUE (nas_ip, acct_session_id)
);
CREATE INDEX wifi_sessions_started_idx ON pms.wifi_sessions (started_at);
CREATE INDEX wifi_sessions_guest_idx ON pms.wifi_sessions (guest_id) WHERE guest_id IS NOT NULL;

-- Giriş denemeleri (kabul/red ve nedeni). Destek ve kötüye kullanım takibi için; bakım temizliğinde 180 günden eskiler silinir.
CREATE TABLE pms.wifi_auth_log (
    id              bigserial PRIMARY KEY,
    at              timestamptz NOT NULL DEFAULT now(),
    nas_ip          inet,
    mac             text,
    username_masked text,
    accepted        boolean NOT NULL,
    reason          text NOT NULL,
    guest_id        uuid REFERENCES pms.guests(id),
    reservation_id  uuid REFERENCES pms.reservations(id)
);
CREATE INDEX wifi_auth_log_at_idx ON pms.wifi_auth_log (at);
