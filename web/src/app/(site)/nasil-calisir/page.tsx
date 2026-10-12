import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ArchitectureDiagram } from '@/components/ArchitectureDiagram';

export const metadata: Metadata = {
  title: 'Nasıl çalışır',
  description: 'TSDMR Otel PMS kurulumu: sunucu bilgisayar, otel içi ağ, PMS Client bağlantısı, eski programdan veri aktarımı ve yedekleme.',
};

const STEPS = [
  { title: 'Ön sipariş ve keşif', text: 'Formu doldurursunuz. Oda sayınızı, kullandığınız programı ve bilgisayar altyapınızı birlikte değerlendiririz.' },
  { title: 'Sunucu kurulumu', text: 'Otelde sunucu olarak kullanılacak bilgisayara HotelPMS kurulum dosyası "Sunucu" modunda kurulur. PMS hizmeti ve veritabanı bu bilgisayarda çalışır; bilgisayar açıldığında hizmet kendiliğinden başlar.' },
  { title: 'İlk ayar', text: 'Sunucu ekranında görünen tek kullanımlık kurulum koduyla otel bilgileri ve ilk yönetici hesabı oluşturulur. Sistem boş başlar; örnek veya deneme kaydı eklenmez.' },
  { title: 'Bilgisayarların bağlanması', text: 'Resepsiyon, kasa ve diğer bilgisayarlara PMS Client kurulur. Uygulama aynı ağdaki sunucuyu kendisi bulur; bulunamazsa sunucunun adı veya IP adresi girilir. Sunucu sertifikasının parmak izi bir kez onaylanır.' },
  { title: 'Eski verilerin aktarımı', text: 'Veri Aktarım Merkezi ile AmonRa veya başka bir programdan misafirler, şirketler, vergi numaraları ve cari hareketler aktarılır. Eski veritabanına yalnız okuma amaçlı bağlanılır; eski programın verisi değiştirilmez.' },
  { title: 'Kullanım ve yedekleme', text: 'Kullanıcılar ve yetkileri tanımlanır, günlük çalışma başlar. Yedekler zamanlanmış olarak alınır ve isterseniz ikinci bir diske kopyalanır.' },
];

const FAQ = [
  { q: 'İnternet kesilirse ne olur?', a: 'Hiçbir şey durmaz. Sunucu ve bilgisayarlar otelin kendi ağı üzerinden haberleşir; internet bağlantısı gerekmez.' },
  { q: 'Verilerimiz nerede saklanıyor?', a: 'Otelinizdeki sunucu bilgisayarda. Veritabanı yalnız o bilgisayarın içinden erişilebilir; ağdaki diğer bilgisayarlar veritabanına değil, şifreli bağlantıyla PMS hizmetine bağlanır.' },
  { q: 'Sunucu bilgisayar arızalanırsa?', a: 'Alınan yedek, yeni bir bilgisayara kurulan sunucuya geri yüklenir. Yedeklerin ikinci bir diske veya farklı bir konuma kopyalanmasını öneririz.' },
  { q: 'Eski programdaki kayıtlar kaybolur mu?', a: 'Hayır. Aktarım sırasında eski programın verisine yalnız okuma amaçlı erişilir. Aktarılan kayıtlar önce önizlenir, mükerrerler işaretlenir; hatalı bir aktarım geri alınabilir.' },
  { q: 'Ödeme ne zaman alınır?', a: 'Ön sipariş formu ödeme almaz ve kart bilgisi istemez. Kapsam ve fiyat, görüşme sonrasında size ayrıca iletilir.' },
];

export default function HowPage() {
  return (
    <>
      <section className="section tight" style={{ paddingTop: 56 }}>
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Nasıl çalışır</span>
            <h1>Sunucu otelinizde, bilgisayarlar aynı ağda</h1>
            <p className="lead">Bir bilgisayar sunucu olur; diğer bilgisayarlar PMS Client uygulamasıyla ona bağlanır. Tüm işlemler otel ağında gerçekleşir.</p>
          </div>
          <div className="diagram"><ArchitectureDiagram /></div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <div className="section-head"><h2>Kurulumdan kullanıma</h2></div>
          <div className="steps">
            {STEPS.map(s => (
              <div key={s.title} className="step">
                <div><h3>{s.title}</h3><p>{s.text}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head"><h2>Sık sorulanlar</h2></div>
          <div className="grid c2">
            {FAQ.map(f => (
              <div key={f.q} className="card"><h3>{f.q}</h3><p>{f.a}</p></div>
            ))}
          </div>
          <p style={{ marginTop: 28 }}><Link href="/on-siparis" className="btn primary">Ön sipariş ver <ArrowRight /></Link></p>
        </div>
      </section>
    </>
  );
}
