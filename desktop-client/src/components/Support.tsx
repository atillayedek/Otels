import { useState } from 'react';
import { Copy, LifeBuoy } from 'lucide-react';
import { useSession } from '../lib/session';
import { PRODUCT_NAME, SUPPORT_EMAIL, VENDOR } from '../lib/product';
import { Modal } from './ui';

/** Yardım ve destek: destek e-postası ve destek ekibinin isteyeceği sürüm/bağlantı bilgileri. */
export function SupportModal({ onClose }: { onClose: () => void }) {
  const { client, property, me } = useSession();
  const [copied, setCopied] = useState<string | null>(null);
  const details = [
    `Ürün: ${PRODUCT_NAME} ${client?.version ?? ''}`,
    `Otel: ${property?.name ?? '-'}`,
    `Sunucu: ${client?.activeServer ? `${client.activeServer.name} (${client.activeServer.host}:${client.activeServer.port})` : '-'}`,
    `Bilgisayar: ${client?.hostname ?? '-'}`,
    `Kullanıcı: ${me?.username ?? '-'}`,
  ].join('\n');
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied(null); }
  };
  return (
    <Modal title="Yardım ve destek" onClose={onClose} footer={<button className="btn" onClick={onClose}>Kapat</button>}>
      <div className="stack">
        <div className="row"><LifeBuoy size={18} color="var(--primary)" /><b>{VENDOR} destek</b></div>
        <div className="support-mail">
          <span className="mono">{SUPPORT_EMAIL}</span>
          <button className="btn sm" onClick={() => void copy(SUPPORT_EMAIL, 'mail')}><Copy /> {copied === 'mail' ? 'Kopyalandı' : 'Kopyala'}</button>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Sorununuzu e-postayla bildirirken aşağıdaki bilgileri ekleyin; sunucu tarafındaki sorunlar için sunucu bilgisayarındaki
          <b> PMS Server Manager → Destek</b> sekmesinden "Destek paketi oluştur" ile hazırlanan dosyayı da gönderin.
        </div>
        <pre className="support-details">{details}</pre>
        <div><button className="btn sm" onClick={() => void copy(details, 'details')}><Copy /> {copied === 'details' ? 'Kopyalandı' : 'Bilgileri kopyala'}</button></div>
      </div>
    </Modal>
  );
}
