# Veritabanı

- PostgreSQL 17, yalnız `127.0.0.1:54329`, `scram-sha-256` kimlik doğrulama.
- Roller:
  - `hotelpms_owner`: şema değişiklikleri (migration)
  - `hotelpms_app`: çalışma zamanı; denetim kaydında güncelleme/silme ve folyo satırında güncelleme yetkisi yoktur
- Parolalar kurulumda rastgele üretilir, Windows'ta DPAPI (LocalMachine) ile, Linux'ta AES-256-GCM ve yalnız sahibinin okuyabildiği anahtar dosyasıyla şifrelenir.

## Şema

`src/HotelPms.Server/Database/Migrations/*.sql` sırayla uygulanır ve `public.schema_migrations` tablosunda sağlama toplamıyla izlenir. Uygulanmış bir dosya değiştirilirse sunucu başlamaz (sessiz şema bozulmasını önler). Her şema güncellemesinden önce otomatik yedek alınır.

Önemli kısıtlar:

- Aynı odaya çakışan konaklama: `EXCLUDE USING gist` (veritabanı seviyesinde)
- Oda blokajları çakışamaz
- Gece denetimi her iş günü için bir kez çalışır (benzersiz kısıt)
- Oda ücreti her gece için bir kez işlenir
- Tutarlar `numeric(14,2)`

## Doğrudan erişim

Bakım dışında veritabanına doğrudan bağlanılmamalıdır. Bakım görevleri (ANALYZE, VACUUM, eski oturum temizliği) Server Manager → Bakım sekmesindedir.
