import type { Metadata } from 'next';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'KVKK aydınlatma metni',
  description: 'Ön sipariş formu kapsamında işlenen kişisel verilere ilişkin aydınlatma metni.',
};

export default function KvkkPage() {
  const controller = SITE.legalName || SITE.studio;
  return (
    <section className="section tight" style={{ paddingTop: 56 }}>
      <div className="container prose">
        <h1>Kişisel verilerin işlenmesine ilişkin aydınlatma metni</h1>
        <p className="muted">6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) madde 10 kapsamında, ön sipariş formu aracılığıyla toplanan kişisel veriler hakkında bilgilendirme.</p>

        <h2>Veri sorumlusu</h2>
        <p>
          {controller}
          {SITE.legalAddress && <><br />Adres: {SITE.legalAddress}</>}
          {SITE.contactEmail && <><br />E-posta: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a></>}
          {SITE.contactPhone && <><br />Telefon: {SITE.contactPhone}</>}
        </p>

        <h2>İşlenen kişisel veriler</h2>
        <ul>
          <li>Kimlik ve iletişim: ad soyad, telefon numarası, e-posta adresi</li>
          <li>İşletme bilgisi: otel adı, şehir, oda sayısı, bilgisayar sayısı, kullanılan program ve sunucu tercihi</li>
          <li>Formda kendi isteğinizle yazdığınız açıklamalar</li>
          <li>Kötüye kullanımı önlemek için IP adresinizden üretilen, geri döndürülemez özet değer (IP adresinin kendisi saklanmaz)</li>
        </ul>

        <h2>İşleme amaçları</h2>
        <ul>
          <li>Ön sipariş talebinizin değerlendirilmesi ve sizinle iletişime geçilmesi</li>
          <li>Kurulum kapsamı ve teklif hazırlanması</li>
          <li>Formun otomatik veya kötü niyetli kullanımının engellenmesi</li>
        </ul>

        <h2>Hukuki sebep</h2>
        <p>Veriler, KVKK madde 5/2-c uyarınca bir sözleşmenin kurulmasına doğrudan ilişkin olması ve madde 5/2-f uyarınca veri sorumlusunun meşru menfaati hukuki sebeplerine dayanılarak işlenir.</p>

        <h2>Toplama yöntemi ve aktarım</h2>
        <p>Veriler bu sitedeki ön sipariş formu aracılığıyla elektronik ortamda toplanır. Veriler, sitenin barındırma ve veritabanı hizmetlerini sağlayan altyapı sağlayıcılarının sunucularında saklanır; bu hizmetler yurt dışında bulunabilir. Veriler pazarlama amacıyla üçüncü kişilerle paylaşılmaz.</p>

        <h2>Saklama süresi</h2>
        <p>Talep kayıtları, talebin sonuçlanmasından itibaren ilgili mevzuatta öngörülen süreler ve olası uyuşmazlıklar için gereken süre boyunca saklanır; bu sürenin sonunda silinir veya anonim hale getirilir.</p>

        <h2>Haklarınız</h2>
        <p>KVKK madde 11 uyarınca; verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, işleme amacını öğrenme, aktarıldığı kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, silinmesini veya yok edilmesini isteme, itiraz etme ve zarara uğramanız halinde giderilmesini talep etme haklarına sahipsiniz.
          {SITE.contactEmail ? <> Başvurularınızı <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> adresine iletebilirsiniz.</> : ' Başvurularınızı veri sorumlusuna yazılı olarak iletebilirsiniz.'}
        </p>
      </div>
    </section>
  );
}
