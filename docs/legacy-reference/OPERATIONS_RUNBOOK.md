# Operasyon runbook

## Sağlık ve başlangıç

Web process `npm run start`; worker `node worker/index.mjs`. Web health yalnız app çalışma ve DB/Auth erişimini ayrı değerlendirir; health içinde secret/PII yoktur. Worker port/env ve gerçek health endpoint implementasyonundan doğrulanır. Başlangıçta `.env` değerleri secret yönetiminden enjekte edilir; logs maskeli.

## KBS erişim veya sağlayıcı kesintisi

blocked_configuration gönderilmiş değildir. Config credentials/API sözleşmesini doğrula; ihtiyaç duyulan kurum erişimini KBS_INTEGRATION üzerinden takip et. accepted sadece provider kanıtıdır. outcome_unknown kaydı otomatik kör retry edilmez; varsa provider status query, yoksa yetkili manual çözüm. Operator reference/reason reported_manually oluşturur. Check-in/out outbox commit sağlığını ve olay sırasını denetle; gerçek yasal operasyon prosedürü tesis/kollukla doğrulanır.

## Worker çökmesi

Process'i yeniden başlat; migration 003 süresi dolan processing kaydını outcome_unknown'a alır, otomatik yeniden göndermez. Sonuç kaydı/ack yalnız doğru property ve geçerli lease token ile olur. Kuyruk yaşını, attempts ve blocked/unknown sayısını incele. İşin DB transaction sonucunu görmeden yeni ücret/rezervasyon üretme. Eski worker'ın geç dönen finish çağrısı yeni claim'i ezmemeli.

## Finans hatası

Hareketi update/delete etme. Kaynak folyo, currency, business_date, original/refund/reversal bağını incele. Yetkili reversal/refund/transfer gerekçeli yeni hareket oluşturur. Banka sağlayıcı mutabakatı henüz yok; manual_bank settled garantisi değildir. Checkout bakiye reddi UI hilesiyle aşılmaz.

## Envanter uyuşmazlığı

Reservation/stay/type/room, room_assignments timestamp tarihçesi ve maintenance date aralığını kontrol et. DB source authoritative; cache nihai stok değildir. Kanal onaylı kapasite aşımı kaydı silinmez, conflict çözülür. İşlem geçmişi ve idempotency kayıtları silinerek çakışma çözülmez; tam OTA mutabakatı ve ileri envanter özellikleri pending.

## Migration ve incident

Önce isolated/staging restore/forward-fix dene. Production migration önce verified backup ve maintenance planı gerektirir. Incident correlation, başlangıç/etkilenen tesis/modül, data integrity riski, son değişiklik ve recovery sonucu maskeli kaydedilir. Restore sonrası KBS/ödeme/OTA unknown sonuçları gerçek provider ile mutabakat gerektirir; snapshot geri dönmek dış dünyayı geri almaz.

Provider, alert, RPO/RTO ve on-call/escalation sahipleri gerçek işletme kurulumu ile atanacak; bu belgede uydurma kişi veya iletişim bilgisi yoktur.
