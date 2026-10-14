-- KVKK: ilgili kişi başvurusu (kişisel veri dökümü), anonimleştirme ve saklama süresi dolan kayıtların imhası.
-- Anonimleştirilen misafirin kimliği geri döndürülemez; konaklama, folyo ve muhasebe kayıtları (yasal saklama) kişiye bağlanamadan kalır.

ALTER TABLE pms.guests ADD COLUMN anonymized_at timestamptz;
ALTER TABLE pms.guests ADD COLUMN anonymized_by uuid;
CREATE INDEX guests_not_anonymized_idx ON pms.guests (created_at) WHERE anonymized_at IS NULL;

INSERT INTO pms.permissions (code, module, description) VALUES
 ('guest.privacy', 'guest', 'KVKK: kişisel veri dökümü, anonimleştirme ve saklama süresi dolan kayıtların imhası')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 ('SUPER_ADMIN', 'guest.privacy'), ('HOTEL_ADMIN', 'guest.privacy'), ('GENERAL_MANAGER', 'guest.privacy')
) AS v(role_code, permission_code)
WHERE EXISTS (SELECT 1 FROM pms.roles r WHERE r.code = v.role_code)
ON CONFLICT DO NOTHING;
