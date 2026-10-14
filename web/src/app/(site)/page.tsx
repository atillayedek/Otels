import Link from 'next/link';
import {
  ArrowRight, BedDouble, CheckCircle2, DatabaseBackup, FileInput, Moon, Receipt, ServerCog, ShieldCheck, WifiOff,
} from 'lucide-react';
import { ArchitectureDiagram } from '@/components/ArchitectureDiagram';

const HIGHLIGHTS = [
  { icon: <WifiOff />, title: 'İnternetsiz çalışır', text: 'Sunucu ve tüm bilgisayarlar otelin kendi ağında haberleşir. İnternet kesildiğinde resepsiyon durmaz.' },
  { icon: <ShieldCheck />, title: 'Veriler otelde kalır', text: 'Misafir ve muhasebe kayıtları buluta gönderilmez. Veritabanı yalnız sunucu bilgisayarın içinden erişilebilir.' },
  { icon: <FileInput />, title: 'Eski programdan geçiş', text: 'AmonRa ve diğer programlardan misafir, şirket, vergi numarası ve cari hareketler aktarılır; eski veriye yalnız okuma amaçlı erişilir.' },
  { icon: <DatabaseBackup />, title: 'Otomatik yedekleme', text: 'Zamanlanmış, doğrulama özetli yedekler; her geri yüklemeden ve şema güncellemesinden önce ek güvenlik yedeği.' },
];

const MODULES = [
  { icon: <BedDouble />, title: 'Rezervasyon ve ön büro', items: ['Oda rack ve blokaj çizelgesi', 'Gece bazlı fiyatlandırma', 'Check-in, check-out, walk-in', 'Oda değişikliği ve uzatma'] },
  { icon: <Receipt />, title: 'Folyo, kasa ve cari', items: ['Değiştirilemez folyo kayıtları', 'İptal, iade ve transfer izi', 'Kasa vardiyası ve sayım', 'Şirket ve acente carisi'] },
  { icon: <Moon />, title: 'Gün sonu ve raporlar', items: ['Tek işlemde gece denetimi', 'İş günü ve tesis saat dilimi', 'Excel ve CSV rapor çıktısı', 'Denetim kayıtları'] },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow"><ServerCog size={15} /> Ön sipariş dönemi</span>
            <h1>Otelinizin kendi sunucusunda çalışan otel yönetim sistemi</h1>
            <p className="lead">
              Ferrolit PMS; rezervasyon, ön büro, folyo, kasa ve gece denetimini otelinizdeki bir bilgisayarda çalıştırır.
              Resepsiyon ve diğer bölümler aynı ağdan bağlanır; internet bağlantısı gerekmez.
            </p>
            <div className="actions">
              <Link href="/on-siparis" className="btn primary">Ön sipariş ver <ArrowRight /></Link>
              <Link href="/nasil-calisir" className="btn">Nasıl çalışır?</Link>
            </div>
            <ul className="hero-points">
              <li><CheckCircle2 /> Windows sunucu (Linux da desteklenir)</li>
              <li><CheckCircle2 /> Tam Türkçe arayüz</li>
              <li><CheckCircle2 /> Ödeme alınmaz, yalnız talep</li>
            </ul>
          </div>
          <div className="diagram"><ArchitectureDiagram /></div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Neden yerel sunucu?</h2>
            <p>Bulut tabanlı sistemlerde internet kesintisi resepsiyonu durdurur. Ferrolit PMS, otellerin alışık olduğu yerel sunucu modeliyle otelin içindeki bir bilgisayarda çalışır; bilgisayarlar birbirine yerel ağ üzerinden bağlanır.</p>
          </div>
          <div className="grid c4">
            {HIGHLIGHTS.map(h => (
              <div key={h.title} className="card">
                <span className="icon-chip">{h.icon}</span>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <div className="section-head">
            <h2>Günlük operasyon tek ekranda</h2>
            <p>Resepsiyondan muhasebeye kadar her bölüm, yetkisine göre aynı veriyi anlık olarak görür. Bir bilgisayarda yapılan işlem diğerlerine hemen yansır.</p>
          </div>
          <div className="grid c3">
            {MODULES.map(m => (
              <div key={m.title} className="card elev">
                <span className="icon-chip">{m.icon}</span>
                <h3>{m.title}</h3>
                <ul>{m.items.map(i => <li key={i}>{i}</li>)}</ul>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 22 }}><Link href="/urun">Tüm modülleri inceleyin <ArrowRight size={15} style={{ verticalAlign: '-2px' }} /></Link></p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta">
            <div>
              <h2>Otelinize kurulum için ön sipariş verin</h2>
              <p>Formu doldurun; oda sayınıza, kullandığınız programa ve sunucu durumunuza göre sizinle iletişime geçelim. Formda ödeme bilgisi istenmez.</p>
            </div>
            <Link href="/on-siparis" className="btn">Ön sipariş formu <ArrowRight /></Link>
          </div>
        </div>
      </section>
    </>
  );
}
