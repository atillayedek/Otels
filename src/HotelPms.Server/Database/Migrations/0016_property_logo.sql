-- Otel logosu: yazdırılan belgelerde (folyo, onay belgesi, raporlar, formlar) ve Excel çıktılarında kullanılır.
-- Görüntü istemcide en fazla 800×300 piksele küçültülüp PNG/JPEG olarak gönderilir; veritabanında data URL olarak saklanır (yedekle birlikte taşınır).
ALTER TABLE pms.property ADD COLUMN logo_data text CHECK (logo_data IS NULL OR length(logo_data) <= 1000000);
ALTER TABLE pms.property ADD COLUMN logo_updated_at timestamptz;
