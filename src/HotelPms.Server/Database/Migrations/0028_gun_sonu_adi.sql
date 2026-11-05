-- Ekranlarda "Gece denetimi" yerine yaygın adı "Gün sonu" kullanılır; yetki açıklaması da buna göre güncellenir.
UPDATE pms.permissions SET description = 'Gün sonu çalıştır' WHERE code = 'night_audit.execute';
