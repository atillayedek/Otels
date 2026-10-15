import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { FileSignature } from 'lucide-react';
import { get } from '../lib/api';
import type { Property, Setting } from '../lib/types';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from './ui';
import { DocFooter, DocHeader } from './PrintDoc';

export interface KvkkPerson { name: string; room?: string; reservationNumber?: string; arrival?: string; departure?: string }

/** Aydınlatma metnindeki yer tutucuları otel bilgileriyle doldurur. */
export function fillNotice(text: string, p?: Property) {
  const name = p?.name ?? '';
  const legal = p?.legalName?.trim() || '';
  return text
    // Unvan girilmemişse "Otel (Otel)" tekrarı oluşmaz.
    .replaceAll('{UNVAN} ({OTEL})', legal && legal !== name ? `${legal} (${name})` : name)
    .replaceAll('{UNVAN}', legal || name)
    .replaceAll('{OTEL}', name)
    .replaceAll('{ADRES}', [p?.address, p?.city].filter(Boolean).join(', '))
    .replaceAll('{TELEFON}', p?.phone ? `Tel: ${p.phone}` : '')
    .replaceAll('{EPOSTA}', p?.email ? `E-posta: ${p.email}` : '')
    // Boş kalan bilgilerden artan noktalama temizlenir.
    .replace(/,\s*\./g, '.')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]*İletişim:[ \t]*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/,\s*$/gm, '.');
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
        <div key={i} className="doc folio-doc kvkk-doc" style={i > 0 ? { breakBefore: 'page' } : undefined}>
          <DocHeader kind="KVKK aydınlatma ve onay formu" lines={[p.reservationNumber ? `Rez. ${p.reservationNumber}${p.room ? ` · Oda ${p.room}` : ''}` : null,
            p.arrival ? `${fmtDate(p.arrival)} – ${fmtDate(p.departure)}` : null]} />
          <div className="kv-text">{fillNotice(notice, property)}</div>
          <div className="kv-consent">
            <div className="kv-box-row"><span className="kv-box" /> Yukarıdaki aydınlatma metnini okudum ve anladım.</div>
            {consent.trim() && <div className="kv-box-row"><span className="kv-box" /><span>{consent} <i>(isteğe bağlı)</i></span></div>}
          </div>
          <div className="kv-sign">
            <div><span>Misafir adı soyadı</span><b>{p.name}</b></div>
            <div><span>Tarih</span><b>{fmtDate(new Date().toISOString().slice(0, 10))}</b></div>
            <div><span>İmza</span><b>&nbsp;</b></div>
          </div>
          <DocFooter note="İmzalı form otelde KVKK kapsamında saklanır." />
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
