import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { FileSignature } from 'lucide-react';
import { get } from '../lib/api';
import type { Property, Setting } from '../lib/types';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from './ui';

export interface KvkkPerson { name: string; room?: string; reservationNumber?: string; arrival?: string; departure?: string }

/** Aydınlatma metnindeki yer tutucuları otel bilgileriyle doldurur. */
export function fillNotice(text: string, p?: Property) {
  return text
    .replaceAll('{UNVAN}', p?.legalName || p?.name || '')
    .replaceAll('{OTEL}', p?.name ?? '')
    .replaceAll('{ADRES}', [p?.address, p?.city].filter(Boolean).join(', '))
    .replaceAll('{TELEFON}', p?.phone ? `Tel: ${p.phone}` : '')
    .replaceAll('{EPOSTA}', p?.email ? `E-posta: ${p.email}` : '');
}

export const useKvkkTexts = () => useQuery({
  queryKey: ['settings', 'all'], queryFn: () => get<Setting[]>('/api/v1/property/settings'),
  select: s => ({
    notice: String(s.find(x => x.key === 'kvkk.notice_text')?.value ?? ''),
    consent: String(s.find(x => x.key === 'kvkk.consent_text')?.value ?? ''),
  }),
});

/** Her misafir için ayrı sayfa: aydınlatma metni, okudum-anladım beyanı, ticari ileti izni seçimi ve imza. */
export function KvkkFormDoc({ people, notice, consent, property }: { people: KvkkPerson[]; notice: string; consent: string; property?: Property }) {
  return (
    <>
      {people.map((p, i) => (
        <div key={i} className="doc kvkk-doc" style={i > 0 ? { breakBefore: 'page' } : undefined}>
          <div className="kv-head">
            <div><b>{property?.name}</b><div className="fine">{property?.legalName}</div></div>
            <div style={{ textAlign: 'right' }}>
              {p.reservationNumber && <div>Rez. {p.reservationNumber}{p.room ? ` · Oda ${p.room}` : ''}</div>}
              {p.arrival && <div>{fmtDate(p.arrival)} – {fmtDate(p.departure)}</div>}
            </div>
          </div>
          <div className="kv-text">{fillNotice(notice, property)}</div>
          <div className="kv-consent">
            <div className="kv-box-row"><span className="kv-box" /> Yukarıdaki aydınlatma metnini okudum ve anladım.</div>
            {consent.trim() && <div className="kv-box-row"><span className="kv-box" /> {consent} <i>(isteğe bağlı)</i></div>}
          </div>
          <div className="kv-sign">
            <div><span>Misafir adı soyadı</span><b>{p.name}</b></div>
            <div><span>Tarih</span><b>{fmtDate(new Date().toISOString().slice(0, 10))}</b></div>
            <div><span>İmza</span><b>&nbsp;</b></div>
          </div>
          <div className="fine" style={{ marginTop: '6mm' }}>Yazdırma: {fmtDateTime(new Date().toISOString())}. İmzalı form otelde KVKK kapsamında saklanır.</div>
        </div>
      ))}
    </>
  );
}

/** Rezervasyondaki tüm misafirler için aydınlatma ve onay formunu yazdırır. */
export function KvkkPrintButton({ reservationId, primary }: { reservationId: string; primary: KvkkPerson }) {
  const { property } = useSession();
  const toast = useToast();
  const texts = useKvkkTexts();
  const [people, setPeople] = useState<KvkkPerson[] | null>(null);
  const print = async () => {
    try {
      const sharers = await get<{ name: string; isPrimary?: boolean }[]>(`/api/v1/reservations/${reservationId}/guests`);
      const extra = sharers.filter(s => !s.isPrimary && s.name !== primary.name).map(s => ({ ...primary, name: s.name }));
      setPeople([primary, ...extra]);
      setTimeout(() => { window.print(); setPeople(null); }, 80);
    } catch (e) { toast.error(e); }
  };
  if (!texts.data?.notice.trim()) return null;
  return (
    <>
      <button className="btn" onClick={() => void print()} title="KVKK aydınlatma ve onay formunu yazdır"><FileSignature /> KVKK formu</button>
      {people && createPortal(<KvkkFormDoc people={people} notice={texts.data.notice} consent={texts.data.consent} property={property} />, document.getElementById('print-root')!)}
    </>
  );
}
