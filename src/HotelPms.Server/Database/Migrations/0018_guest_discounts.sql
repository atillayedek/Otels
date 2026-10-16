-- Misafire özel indirim oranları: konaklama (gecelik fiyata uygulanır) ve ekstra (masraflara ayrı indirim satırı olarak uygulanır).
ALTER TABLE pms.guests ADD COLUMN room_discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (room_discount_pct >= 0 AND room_discount_pct <= 100);
ALTER TABLE pms.guests ADD COLUMN extra_discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (extra_discount_pct >= 0 AND extra_discount_pct <= 100);
