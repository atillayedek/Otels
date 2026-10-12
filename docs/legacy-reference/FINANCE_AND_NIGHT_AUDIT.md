# Finans ve gece denetimi

Mevcut ledger miktarı PostgreSQL numeric(18,2), JavaScript floating-point muhasebe kaynağı değildir. charge pozitif/payment negatif; refund pozitif; reversal öncekinin tersi; transfer kaynak/hedef toplamı sıfır. Kayıtlar direct CRUD ile değiştirilmez; yeni adjustment ve gerekçe gerekir. Açık folyo bakiyesi hareket toplamıdır.

Manual cash/manual_bank kullanıcının gerçek kaydıdır; ödeme sağlayıcı settled onayı değildir. Kart PAN/CVV saklanmaz. Mevcut accounting rolü financial command yapar; reception okuyabilir ancak tahsilat command yetkisi yoktur. Açık bakiyeli checkout reddedilir; yetkili override modeli pending.

Refund orijinal payment'ın toplamını aşmamalı; reversal tekrar yapılamamalı. Transfer aynı property açık folyo arasında atomik çift harekettir. Idempotency actor/key aynı tahsilatı yeniden üretmez. Finansal hareket, fatura ve alacak/tahsilat ayrı modeller; mevcut ledger e-fatura değildir.

Ek folyo `folio.create` command ile açık stay'e açılır. Pending: alıcı ayrımı/şirket-acente routing, revenue center, exchange-rate snapshot/source/currency conversion, effective-date tax/rounding/paket, discount approvals, cash shift/aging/deposit/bank reconciliation/accounting export, invoices/UUID/events/e-Arşiv/e-İrsaliye. Gerçek GİB/entegratör sözleşmesi ve sağlayıcı response olmadan resmi düzenlendi denmez.

Property business_date takvim tarihinden ayrıdır. **Çekirdek gece kapanışı implemented; tam night audit pending.** `business_date.close` current business_date şartı, bekleyen geliş/çıkış ve çözümlenmemiş identity report engeli, aktif stay gece ücretini ilk folyoya yazma, stay/date nightly_postings unique ve property/date closure ile günü atomik ilerletme yapar. Aynı key/payload tekrar kapanış sonucu döndürür. Paket/vergi ayrıştırma, no-show, açık kasa, eksik posting, OTA queue ve kapsamlı gelir/ödeme mutabakatı hâlâ yapılmalıdır. KBS blocked kayıtları kapanışı durdurur; gerçek operator reference ile reported_manually ayrı durumdur.

Raporlar: ADR/RevPAR/occupancy, OTB/pickup, channel/segment/revenue center, cash/aging/refund/invoice durumları. Tarih kaynağı, dahil/hariç vergi, currency ve denominator policy açıklanmadan dashboard miktarı kabul edilmez. Boş veri/hata/sıfır farklıdır.
