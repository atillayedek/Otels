-- Misafir kartı ek bilgileri: hitap, medeni hal, dil, ikinci telefon, kimlik belgesi seri no / veriliş yeri ve tarihi,
-- ilçe, posta kodu, araç plakası ve resepsiyonda gösterilecek uyarı notu.
ALTER TABLE pms.guests ADD COLUMN title text CHECK (title IS NULL OR length(title) <= 20);
ALTER TABLE pms.guests ADD COLUMN marital_status text CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed'));
ALTER TABLE pms.guests ADD COLUMN language text CHECK (language IS NULL OR language ~ '^[a-z]{2}$');
ALTER TABLE pms.guests ADD COLUMN phone2 text CHECK (phone2 IS NULL OR length(phone2) <= 40);
ALTER TABLE pms.guests ADD COLUMN identity_serial text CHECK (identity_serial IS NULL OR length(identity_serial) <= 30);
ALTER TABLE pms.guests ADD COLUMN identity_issue_place text CHECK (identity_issue_place IS NULL OR length(identity_issue_place) <= 100);
ALTER TABLE pms.guests ADD COLUMN identity_issue_date date;
ALTER TABLE pms.guests ADD COLUMN district text CHECK (district IS NULL OR length(district) <= 100);
ALTER TABLE pms.guests ADD COLUMN postal_code text CHECK (postal_code IS NULL OR length(postal_code) <= 20);
ALTER TABLE pms.guests ADD COLUMN vehicle_plate text CHECK (vehicle_plate IS NULL OR length(vehicle_plate) <= 20);
ALTER TABLE pms.guests ADD COLUMN alert_note text CHECK (alert_note IS NULL OR length(alert_note) <= 500);
