-- Rol yetkilerinin günlük operasyona göre tamamlanması.
-- Yalnız EKLEME yapılır (ON CONFLICT DO NOTHING); yöneticinin rollere sonradan verdiği yetkiler korunur, hiçbir yetki geri alınmaz.

-- Arıza bildirimi, odayı satışa kapatmaktan (maintenance.manage) ayrıldı.
INSERT INTO pms.permissions (code, module, description) VALUES
 ('maintenance.report', 'maintenance', 'Arıza kaydı aç (bildir)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT v.role_code, v.permission_code FROM (VALUES
 -- Tüm yetkili roller yeni yetkiyi alır
 ('SUPER_ADMIN', 'maintenance.report'),
 ('HOTEL_ADMIN', 'maintenance.report'),
 ('GENERAL_MANAGER', 'maintenance.report'),

 -- Ön büro müdürü: oda durumları, kat görevi ataması ve fiyat planları
 ('FRONT_OFFICE_MANAGER', 'maintenance.report'),
 ('FRONT_OFFICE_MANAGER', 'housekeeping.update'),
 ('FRONT_OFFICE_MANAGER', 'housekeeping.assign'),
 ('FRONT_OFFICE_MANAGER', 'rate.manage'),

 -- Resepsiyon: oda temizlik durumu, arıza bildirimi, folyo kapatma ve fatura numarası
 ('RECEPTION', 'maintenance.report'),
 ('RECEPTION', 'housekeeping.update'),
 ('RECEPTION', 'folio.close'),

 -- Gece denetçisi: gece resepsiyonu (walk-in, oda değişikliği, misafir kaydı, folyo işlemleri)
 ('NIGHT_AUDIT', 'reservation.create'),
 ('NIGHT_AUDIT', 'reservation.edit'),
 ('NIGHT_AUDIT', 'room.change'),
 ('NIGHT_AUDIT', 'guest.edit'),
 ('NIGHT_AUDIT', 'guest.identity.view'),
 ('NIGHT_AUDIT', 'folio.transfer'),
 ('NIGHT_AUDIT', 'folio.close'),
 ('NIGHT_AUDIT', 'housekeeping.update'),
 ('NIGHT_AUDIT', 'maintenance.view'),
 ('NIGHT_AUDIT', 'maintenance.report'),

 -- Kat hizmetleri
 ('HOUSEKEEPING_MANAGER', 'maintenance.report'),
 ('HOUSEKEEPING', 'maintenance.report'),

 -- Teknik servis
 ('TECHNICAL', 'maintenance.report'),

 -- Kasiyer: tahsilat sonrası folyo kapatma
 ('CASHIER', 'folio.close'),

 -- Satış: kendi oluşturduğu rezervasyonları iptal edebilir
 ('SALES', 'reservation.cancel')
) AS v(role_code, permission_code)
JOIN pms.roles r ON r.code = v.role_code
ON CONFLICT DO NOTHING;
