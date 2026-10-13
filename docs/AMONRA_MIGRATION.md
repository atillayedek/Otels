# AmonRa'dan geçiş

AmonRa'nın veritabanı yapısı kamuya açık değildir ve sürüme göre değişebilir. Bu nedenle tablo/alan adları **tahmin edilmez**; aktarım, eşleştirme ekranında gerçek kaynaktan okunan sütunlarla yapılır.

## Yöntem 1 — Dışa aktarılan dosyalarla (önerilen)

1. AmonRa'da misafir listesi, cari kart listesi (şirket/acente) ve cari hesap ekstresi gibi raporları **Excel** veya **CSV** olarak dışa aktarın.
2. Veri Aktarım Merkezi → Yeni aktarım → Dosyadan.
3. Önizlemede sütunları kontrol edin. Türkçe karakterler bozuk görünüyorsa kodlamayı `windows-1254` seçin veya ilgili alana **Türkçe karakter düzelt** dönüşümünü uygulayın.
4. Vergi numarası, vergi dairesi, kimlik numarası alanlarını eşleştirin. Tutarlar `12.500,75` biçimindeyse sayı biçimi `tr` seçin.
5. Doğrulayın, mükerrerleri inceleyin, aktarın.
6. Eşleştirmeyi **profil** olarak kaydedin (ör. "AmonRa misafir listesi").

## Yöntem 2 — Veritabanından salt okunur bağlantı

AmonRa kurulumu SQL Server veya erişilebilir bir veritabanı kullanıyorsa:

1. Mümkünse AmonRa veritabanında yalnız okuma yetkili bir kullanıcı oluşturun.
2. Veri Aktarım Merkezi → Yeni aktarım → Veritabanından → türü, sunucu adresi, veritabanı adı, kullanıcı.
3. Tablo listesinden ilgili tabloyu seçin; önizleme ve eşleştirme Yöntem 1'deki gibidir.

PMS bu bağlantıda yalnız SELECT çalıştırır; AmonRa verisi değiştirilmez.

## Cari hareketler

Cari hareket aktarımında her satır bir şirket/acente koduna veya vergi numarasına bağlanır. İlgili cari kart önce aktarılmış olmalıdır; eşleşmeyen satırlar "Bilinmeyen cari" hatasıyla raporlanır ve aktarılmaz.

## Geçiş günü önerisi

1. Geçişten önce cari kartları ve misafirleri aktarın, kontrol edin.
2. Geçiş günü: AmonRa'da gün sonunu alın, açık bakiyeleri ve gelecek rezervasyonları dışa aktarın.
3. PMS'te başlangıç iş gününü geçiş günü olarak ayarlayın (ilk kurulumda), rezervasyonları aktarın.
4. Bir süre AmonRa'yı salt okunur başvuru için açık tutun.
