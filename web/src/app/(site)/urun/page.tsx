import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight, BarChart3, BedDouble, Brush, Building2, CalendarRange, DatabaseBackup, FileInput, IdCard, KeyRound, Moon, Printer, Receipt, ServerCog, Users, Wallet, Wrench,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Ürün',
  description: 'TSDMR Otel PMS modülleri: rezervasyon, ön büro, folyo ve kasa, gece denetimi, kat hizmetleri, raporlar, yedekleme ve veri aktarımı.',
};

const GROUPS: { title: string; lead: string; modules: { icon: React.ReactNode; title: string; items: string[] }[] }[] = [
  {
    title: 'Ön büro ve rezervasyon',
    lead: 'Resepsiyonun gün içinde kullandığı tüm ekranlar.',
    modules: [
      { icon: <CalendarRange />, title: 'Rezervasyon', items: ['Gece bazlı fiyat ve fiyat planları', 'Şirket ve acente bağlantısı', 'Aynı odaya çakışan kayıt veritabanı seviyesinde engellenir', 'Çift tıklamada mükerrer kayıt oluşmaz'] },
      { icon: <BedDouble />, title: 'Oda rack ve blokaj', items: ['Oda durumlarının anlık görünümü', 'Zaman çizelgesi üzerinde blokaj', 'Fiyat ve doluluk tablosu', 'Beklenen gelişler, çıkışlar, konaklayanlar'] },
      { icon: <IdCard />, title: 'Check-in ve check-out', items: ['Walk-in konaklama', 'Kimlik bilgisi doğrulaması (T.C. kimlik no kontrolü)', 'Bakiyesi kapanmamış folyoda çıkış engeli', 'Oda değişikliği ve konaklama uzatma'] },
      { icon: <Users />, title: 'Misafir ve şirket kartları', items: ['Misafir geçmişi', 'Vergi dairesi ve vergi numarası', 'Şirket, acente ve fiyat planı tanımları', 'Uyandırma kayıtları'] },
    ],
  },
  {
    title: 'Finans',
    lead: 'Para hareketlerinde silme yoktur; her düzeltme iz bırakır.',
    modules: [
      { icon: <Receipt />, title: 'Folyo', items: ['Folyo satırları sonradan değiştirilemez', 'İptal, iade, indirim ve transfer ayrı kayıt olarak tutulur', 'Tutarlar kuruş hassasiyetinde, yuvarlama hatası olmadan saklanır', 'Ödemede mükerrer tahsilat koruması'] },
      { icon: <Wallet />, title: 'Ön kasa', items: ['Kasa vardiyası açma ve kapama', 'Beklenen ve sayılan nakit karşılaştırması', 'İşlem kodları ve ödeme tipleri', 'Açık folyo bakiyeleri'] },
      { icon: <Building2 />, title: 'Şirket carisi', items: ['Şirket ve acente borç/alacak takibi', 'Eski programdaki cari hareketlerin aktarımı', 'Cari bakiye raporu'] },
      { icon: <Moon />, title: 'Gece denetimi', items: ['Oda gelirleri tek işlemde işlenir', 'Aynı gün iki kez çalıştırılamaz', 'İş günü tesis saat dilimine göre ilerler', 'Günlük istatistikler'] },
    ],
  },
  {
    title: 'Operasyon',
    lead: 'Kat hizmetleri ve teknik servis aynı sistemde.',
    modules: [
      { icon: <Brush />, title: 'Kat hizmetleri', items: ['Temiz, kirli, kontrol durumları', 'Görev atama', 'Kirli odaya check-in uyarısı'] },
      { icon: <Wrench />, title: 'Teknik servis', items: ['Arıza kayıtları', 'Satışa kapalı oda blokajı'] },
      { icon: <BarChart3 />, title: 'Raporlar', items: ['Ekranda görüntüleme', 'Excel (XLSX) ve CSV çıktısı', 'Yetkiye göre finansal rapor erişimi'] },
      { icon: <Printer />, title: 'Yazdırma', items: ['Sunucuya bağlı yazıcılar', 'Folyo ve rapor çıktıları'] },
    ],
  },
  {
    title: 'Sistem ve güvenlik',
    lead: 'Sunucu otelin içinde; yönetimi de otelin elinde.',
    modules: [
      { icon: <ServerCog />, title: 'Yerel sunucu', items: ['Windows hizmeti olarak otomatik başlar', 'Linux sunucu desteği', 'Veritabanı dış ağa kapalı', 'Otel ağında otomatik sunucu bulma'] },
      { icon: <KeyRound />, title: 'Kullanıcı ve yetki', items: ['Rol bazlı yetkiler', 'Parolalar Argon2id ile özetlenir', 'Hatalı girişte hesap kilidi', 'Cihaz kaydı ve oturum iptali'] },
      { icon: <DatabaseBackup />, title: 'Yedekleme', items: ['Zamanlanmış otomatik yedek', 'İkinci bir diske kopya', 'Doğrulama özeti (SHA-256)', 'Geri yükleme öncesi güvenlik yedeği'] },
      { icon: <FileInput />, title: 'Veri Aktarım Merkezi', items: ['CSV, Excel, JSON, XML ve veritabanından aktarım', 'Türkçe karakter kodlaması otomatik algılanır', 'Mükerrer kayıt tespiti ve önizleme', 'Hatalı aktarımı geri alma'] },
    ],
  },
];

export default function ProductPage() {
  return (
    <>
      <section className="section tight" style={{ paddingTop: 56 }}>
        <div className="container section-head">
          <span className="eyebrow">Ürün</span>
          <h1>Bir otelin ihtiyaç duyduğu modüller, tek sistemde</h1>
          <p className="lead">Tüm ekranlar Windows bilgisayarlara kurulan PMS Client uygulamasında çalışır. Sunucu yalnız otel ağı içinden erişilebilir.</p>
        </div>
      </section>

      {GROUPS.map((g, i) => (
        <section key={g.title} className={`section tight ${i % 2 === 0 ? 'alt' : ''}`}>
          <div className="container">
            <div className="section-head" style={{ marginBottom: 24 }}>
              <h2>{g.title}</h2>
              <p>{g.lead}</p>
            </div>
            <div className="grid c4">
              {g.modules.map(m => (
                <div key={m.title} className="card">
                  <span className="icon-chip">{m.icon}</span>
                  <h3>{m.title}</h3>
                  <ul>{m.items.map(it => <li key={it}>{it}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="section tight">
        <div className="container grid c2">
          <div className="card">
            <h3>Kimlik Bildirim Sistemi (KBS)</h3>
            <p>KBS bildirimi, otelinize ait resmi entegrasyon bilgileri tanımlandıktan sonra çalışır. Entegrasyon yapılandırılmadan sistem bildirim gönderilmiş gibi davranmaz; ekranda açıkça yapılandırılmamış olarak gösterilir.</p>
          </div>
          <div className="card">
            <h3>Sistem gereksinimleri</h3>
            <ul>
              <li>Sunucu: 64 bit Windows 10/11 veya Windows Server; ya da systemd kullanan bir Linux dağıtımı</li>
              <li>İstemciler: 64 bit Windows 10/11</li>
              <li>Sunucu ile istemciler aynı yerel ağda</li>
              <li>Sunucu bilgisayara sabit IP adresi verilmesi önerilir</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section tight">
        <div className="container">
          <div className="cta">
            <div>
              <h2>Oteliniz için uygun mu?</h2>
              <p>Ön sipariş formunda oda sayınızı ve kullandığınız programı belirtin; kurulum ve veri aktarımı planını birlikte çıkaralım.</p>
            </div>
            <Link href="/on-siparis" className="btn">Ön sipariş ver <ArrowRight /></Link>
          </div>
        </div>
      </section>
    </>
  );
}
