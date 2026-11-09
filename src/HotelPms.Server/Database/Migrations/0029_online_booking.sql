-- Online rezervasyon (otel web sitesi). Rezervasyonun tek kaynağı yine pms.reservations'tır; ayrı bir rezervasyon veritabanı yoktur.
-- Web'den gelen talep "opsiyonlu" (tentative) olarak açılır = Onay Bekliyor; resepsiyon onaylayınca "onaylı" olur.

-- Web talepleri bu sistem hesabıyla kaydedilir (denetim kaydında "Online Rezervasyon" görünür). Hesap pasiftir, parolası yoktur, oturum açamaz.
INSERT INTO pms.users (id, username, full_name, password_hash, is_active)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'online-rezervasyon', 'Online Rezervasyon (sistem)', '!', false)
ON CONFLICT (id) DO NOTHING;

-- Misafirin rezervasyonunu sorgulamak için verilen, tahmin edilemeyen takip kodu (ör. CIHAN-8K4P7Q2M). Yalnız web rezervasyonlarında dolu.
ALTER TABLE pms.reservations ADD COLUMN booking_code text CHECK (booking_code IS NULL OR booking_code ~ '^[A-Z0-9]{2,12}-[A-Z0-9]{8}$');
CREATE UNIQUE INDEX reservations_booking_code_uq ON pms.reservations (booking_code) WHERE booking_code IS NOT NULL;
-- İptal edilen rezervasyonun iptal anındaki durumu: tentative = onaylanmadan reddedildi/geri çekildi, confirmed = onaydan sonra iptal.
ALTER TABLE pms.reservations ADD COLUMN cancelled_from text CHECK (cancelled_from IS NULL OR cancelled_from IN ('tentative', 'confirmed'));

-- Tek satırlık online rezervasyon ayarı ve web sitesi içeriği (PMS → Yönetim → Online Rezervasyon ekranından düzenlenir).
CREATE TABLE pms.online_config (
    id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_enabled          boolean NOT NULL DEFAULT false,
    code_prefix         text NOT NULL DEFAULT 'WEB' CHECK (code_prefix ~ '^[A-Z0-9]{2,12}$'),
    rate_plan_id        uuid REFERENCES pms.rate_plans(id),
    min_lead_days       int NOT NULL DEFAULT 0 CHECK (min_lead_days BETWEEN 0 AND 60),
    max_advance_days    int NOT NULL DEFAULT 365 CHECK (max_advance_days BETWEEN 1 AND 730),
    max_nights          int NOT NULL DEFAULT 30 CHECK (max_nights BETWEEN 1 AND 90),
    hotel_name          text NOT NULL DEFAULT '' CHECK (length(hotel_name) <= 120),
    phone               text CHECK (phone IS NULL OR length(phone) <= 40),
    whatsapp            text CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,15}$'),
    email               text CHECK (email IS NULL OR length(email) <= 120),
    address             text CHECK (address IS NULL OR length(address) <= 400),
    map_url             text CHECK (map_url IS NULL OR map_url ~ '^https://'),
    -- Çok dilli metinler: {"tr": "...", "en": "..."}; dil eklemek için yalnız yeni anahtar yazılır.
    about               jsonb NOT NULL DEFAULT '{}'::jsonb,
    terms               jsonb NOT NULL DEFAULT '{}'::jsonb,
    checkin_time        time NOT NULL DEFAULT '14:00',
    checkout_time       time NOT NULL DEFAULT '12:00',
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          uuid,
    version             int NOT NULL DEFAULT 1
);
INSERT INTO pms.online_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Web sitesinde gösterilen oda tipleri ve açıklamaları (yalnız is_listed olanlar satışa açılır).
CREATE TABLE pms.online_room_content (
    room_type_id    uuid PRIMARY KEY REFERENCES pms.room_types(id) ON DELETE CASCADE,
    is_listed       boolean NOT NULL DEFAULT false,
    title           jsonb NOT NULL DEFAULT '{}'::jsonb,
    description     jsonb NOT NULL DEFAULT '{}'::jsonb,
    features        jsonb NOT NULL DEFAULT '[]'::jsonb,
    sort_order      int NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         int NOT NULL DEFAULT 1
);

-- Web sitesi fotoğrafları (dosya sunucunun storage/online klasöründe, adı rastgele). room_type_id boşsa genel/galeri fotoğrafıdır.
CREATE TABLE pms.online_photos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_type_id    uuid REFERENCES pms.room_types(id) ON DELETE CASCADE,
    place           text NOT NULL DEFAULT 'gallery' CHECK (place IN ('hero', 'gallery', 'room', 'logo')),
    file_name       text NOT NULL CHECK (file_name ~ '^[0-9a-f]{32}\.(jpg|png|webp)$'),
    content_type    text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    width           int,
    height          int,
    caption         jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort_order      int NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid
);
CREATE INDEX online_photos_place_idx ON pms.online_photos (place, sort_order);

INSERT INTO pms.permissions (code, module, description) VALUES ('online.manage', 'online', 'Online rezervasyon ve web sitesi içeriği yönetimi')
ON CONFLICT DO NOTHING;
INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT r.code, 'online.manage' FROM pms.roles r WHERE r.code IN ('SUPER_ADMIN', 'HOTEL_ADMIN', 'GENERAL_MANAGER', 'FRONT_OFFICE_MANAGER', 'SALES') ON CONFLICT DO NOTHING;
