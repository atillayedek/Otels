import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { PRODUCT_NAME } from '../lib/product';
import { useSession } from '../lib/session';

/** Otel logosu (Yönetim → Tesis Bilgileri). Yazdırma anında hazır olması için menü yüklenirken önbelleğe alınır. */
export const useLogo = () => useQuery({ queryKey: ['property', 'logo'], queryFn: () => get<{ dataUrl?: string | null }>('/api/v1/property/logo'), staleTime: Infinity });

/** Tüm yazdırılan belgelerin ortak başlığı: otel logosu ve kimliği solda, belge türü ve numarası sağda. */
export function DocHeader({ kind, no, lines }: { kind: string; no?: ReactNode; lines?: ReactNode[] }) {
  const { property: p } = useSession();
  const logo = useLogo().data?.dataUrl;
  const contact = [p?.phone && `Tel: ${p.phone}`, p?.email].filter(Boolean).join(' · ');
  return (
    <header className="fd-head">
      <div className="fd-brand">
        {logo && <img className="fd-logo" src={logo} alt="" />}
        <div>
          <div className="fd-hotel">{p?.name}</div>
          {p?.legalName && <div className="fd-legal">{p.legalName}</div>}
          {(p?.address || p?.city) && <div className="fd-legal">{[p?.address, p?.city].filter(Boolean).join(', ')}</div>}
          {(p?.taxOffice || p?.taxNumber) && <div className="fd-legal">{p?.taxOffice && `${p.taxOffice} V.D. `}{p?.taxNumber && `· VKN ${p.taxNumber}`}</div>}
          {contact && <div className="fd-legal">{contact}</div>}
        </div>
      </div>
      <div className="fd-title">
        <div className="fd-kind">{kind}</div>
        {no && <div className="fd-no">{no}</div>}
        {lines?.filter(Boolean).map((l, i) => <div key={i} className="fd-legal">{l}</div>)}
      </div>
    </header>
  );
}

/** Belge alt bilgisi: isteğe bağlı vurgu satırı, açıklama ve yazdırma zamanı. */
export function DocFooter({ lead, note }: { lead?: ReactNode; note?: ReactNode }) {
  const { me } = useSession();
  return (
    <footer className="fd-foot">
      {lead && <div className="fd-lead">{lead}</div>}
      <div>{note}{note ? ' ' : ''}Yazdırma: {fmtDateTime(new Date().toISOString())}{me?.fullName ? ` · ${me.fullName}` : ''} · {PRODUCT_NAME}</div>
    </footer>
  );
}
