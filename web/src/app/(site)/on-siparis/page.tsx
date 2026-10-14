import type { Metadata } from 'next';
import { ClipboardList, PhoneCall, ServerCog } from 'lucide-react';
import { PreOrderForm } from './PreOrderForm';

export const metadata: Metadata = {
  title: 'Ön sipariş',
  description: 'Ferrolit PMS için ön sipariş talebi oluşturun. Ödeme alınmaz; sizinle iletişime geçilir.',
};

export default function PreOrderPage() {
  return (
    <section className="section tight" style={{ paddingTop: 56 }}>
      <div className="container" style={{ display: 'grid', gap: 32, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div className="section-head" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Ön sipariş</span>
          <h1>Oteliniz için ön sipariş verin</h1>
          <p className="lead">Bu form ödeme almaz. Talebinizi inceleyip kurulum kapsamını ve fiyatı görüşmek için sizinle iletişime geçeriz.</p>
        </div>
        <div className="grid c3">
          <div className="card"><span className="icon-chip"><ClipboardList /></span><h3>1. Formu doldurun</h3><p>Otel bilgileri ve kullandığınız program yeterli.</p></div>
          <div className="card"><span className="icon-chip"><PhoneCall /></span><h3>2. Sizi arayalım</h3><p>Altyapınızı ve aktarılacak verileri birlikte değerlendirelim.</p></div>
          <div className="card"><span className="icon-chip"><ServerCog /></span><h3>3. Kurulum planı</h3><p>Sunucu, istemci ve veri aktarımı adımlarını netleştirelim.</p></div>
        </div>
        <div style={{ maxWidth: 860 }}>
          <PreOrderForm />
        </div>
      </div>
    </section>
  );
}
