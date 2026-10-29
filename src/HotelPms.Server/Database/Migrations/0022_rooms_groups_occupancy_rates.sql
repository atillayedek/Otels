-- Oda grupları (ör. kat hizmetleri bölümü / temizlik ekibi: Grup 1, Grup 2…). Her grubun rengi oda durumları ekranında ve rack'te görünür.
CREATE TABLE pms.room_groups (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    color       text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX room_groups_name_uq ON pms.room_groups (lower(name));
ALTER TABLE pms.rooms ADD COLUMN group_id uuid REFERENCES pms.room_groups(id) ON DELETE SET NULL;

-- Kişi sayısına göre gecelik fiyat (kontrat detayı: tek / çift / üç / dört kişilik). Doluysa yetişkin sayısı değişince
-- gecelik fiyat bu tablodan alınır; fiyat yine elle de değiştirilebilir. Tutarlar rezervasyonun fiyat para birimindedir.
ALTER TABLE pms.reservations ADD COLUMN rate_sgl numeric(18,2) CHECK (rate_sgl IS NULL OR rate_sgl >= 0);
ALTER TABLE pms.reservations ADD COLUMN rate_dbl numeric(18,2) CHECK (rate_dbl IS NULL OR rate_dbl >= 0);
ALTER TABLE pms.reservations ADD COLUMN rate_trp numeric(18,2) CHECK (rate_trp IS NULL OR rate_trp >= 0);
ALTER TABLE pms.reservations ADD COLUMN rate_quad numeric(18,2) CHECK (rate_quad IS NULL OR rate_quad >= 0);
