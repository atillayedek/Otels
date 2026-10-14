-- Ürün lisansı. Lisans yüklenene kadar kurulumdan itibaren 30 günlük deneme süresi işler. Süre dolduğunda veya lisans geçersizse veriye erişim
-- ve günlük kapanış işlemleri (çıkış, tahsilat, gece denetimi, rapor, yedek) sürer; yalnız yeni satış işlemleri (rezervasyon, giriş, adisyon) durur.

CREATE TABLE pms.license_state (
    id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    trial_started_at  timestamptz NOT NULL DEFAULT now(),
    content           text,
    installed_at      timestamptz,
    installed_by      uuid
);
INSERT INTO pms.license_state (id) VALUES (1) ON CONFLICT DO NOTHING;

INSERT INTO pms.permissions (code, module, description) VALUES
 ('license.manage', 'system', 'Ürün lisansını yükleme')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES ('SUPER_ADMIN', 'license.manage'), ('HOTEL_ADMIN', 'license.manage')) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
