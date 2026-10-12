# Yedek ve geri yükleme

**Üretim restore kabulü pending; izole DB restore PASS.** Final `tests/database/verify.ps1 -Image postgres:17-alpine` exit0: gerçek pg_dump ayrı `restore_verification` veritabanına yüklenip ledger toplam0/report count2 invariantları doğrulandı. Bu Supabase Auth/Storage bütün-stack yedeğinin veya production PITR/RPO/RTO kabulünün kanıtı değildir.

Tesis/tenant hedef kapasitesi, RPO/RTO ve retention henüz gerçek işletme tarafından tanımlanmamıştır. Yayından önce ölçülebilir değerler belirlenmeli ve restore süre/eksik olay hesabıyla kanıtlanmalı. Yeni2.hesap kotası bilinmiyor; güncel connector görünürlüğü/proje/plan doğrulanmadan cloud backup/PITR sunulduğu iddia edilemez.

Yedek kapsamı: PostgreSQL schema/data + Auth gerekli platform yapılandırmaları + private Storage nesneleri + bucket/policies + provider secret referansları + worker/web config + migration lockfile. DB backup Storage dosyasının içeriğini içermez; ikisi ayrı kopyalanır. Secret değerleri güvenli vault/rotation mekanizmasında, public backup manifestinde yoktur.

Restore tatbikatı:

1. Production'dan ayrı hedef ortam oluştur, dış provider gönderimlerini kapat.
2. Onaylı gerçek backup snapshot ve checksum/manifest doğrula; erişim scope kaydet.
3. DB restore ve migrations/version doğrula; Auth user FK ve tenant/property referanslarını kontrol et.
4. Storage içerik checksum ve policies/signed access test et.
5. Folyo toplamı, reservation capacity, room overlap, outbox/report sequence ve audit sürekliliğini mutabakatla kontrol et.
6. Restore öncesi dış gönderimler yeniden gönderilmeden query/unknown/manual reconciliation yap.
7. Süreyi, kurtarılan zaman aralığını, kayıp kabulünü ve RPO/RTO sonucunu raporla.

Migration geri dönüşü veri kaybı yaratıyorsa otomatik DROP yerine forward-fix; staging kanıtı ve audit gerekir. Henüz backup dosyası veya restore testi yapılmadığında bu plan başarılı tatbikat sayılmaz.
