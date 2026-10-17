-- Wi-Fi entegrasyonu: RADIUS'a ek olarak hotspot firmasının HTTP API ile bağlanması için API anahtarı.
-- Anahtarın kendisi saklanmaz; yalnız SHA-256 özeti ve ekranda tanımak için ilk karakterleri tutulur.
ALTER TABLE pms.wifi_config ADD COLUMN api_key_hash text CHECK (api_key_hash IS NULL OR length(api_key_hash) = 64);
ALTER TABLE pms.wifi_config ADD COLUMN api_key_hint text;
ALTER TABLE pms.wifi_config ADD COLUMN api_key_created_at timestamptz;
-- Hotspot firmasının adı ve iletişim bilgisi (destek ve denetim için).
ALTER TABLE pms.wifi_config ADD COLUMN provider_name text CHECK (provider_name IS NULL OR length(provider_name) <= 120);
