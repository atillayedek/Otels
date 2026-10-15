import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { FileCheck2 } from 'lucide-react';
import { get } from '../lib/api';
import type { Property, Reservation, Setting } from '../lib/types';
import { fmtDate, fmtMoney, MEAL_LABEL } from '../lib/format';
import { CHANNEL_NAME } from '../lib/product';
import { useSession } from '../lib/session';
import { useToast } from './ui';
import { DocFooter, DocHeader } from './PrintDoc';

/** Misafire veya acenteye verilen rezervasyon onay belgesi (yazdır / PDF olarak kaydet). */
function ConfirmationDoc({ r, rates, note, property }: { r: Reservation; rates: { date: string; rate: string }[]; note: string; property?: Property }) {
  const time = (t?: string) => (t ? t.slice(0, 5) : '');
  const rows: [string, string | undefined][] = [
    ['Misafir', r.guestName],
    ['Rezervasyon no', r.reservationNumber + (r.channel ? ` · ${CHANNEL_NAME[r.channel] ?? r.channel}${r.channelRef ? ' ' + r.channelRef : ''}` : '')],
    ['Giriş', `${fmtDate(r.arrival)}${property?.checkInTime ? ` · ${time(property.checkInTime)} itibarıyla` : ''}`],
    ['Çıkış', `${fmtDate(r.departure)}${property?.checkOutTime ? ` · en geç ${time(property.checkOutTime)}` : ''}`],
    ['Konaklama', `${r.nights} gece`],
    ['Oda', `${r.roomTypeCode}${r.roomNumber ? ` · Oda ${r.roomNumber}` : ''}`],
    ['Kişi', `${r.adults} yetişkin${r.children ? `, ${r.children} çocuk` : ''}`],
    ['Pansiyon', MEAL_LABEL[r.mealPlan] ?? r.mealPlan],
    ['Şirket / acente', r.companyName ?? r.agencyName ?? undefined],
    ['Özel istek', r.specialRequests ?? undefined],
  ];
  const deposit = Number(r.depositRequired);
  return (
    <div className="doc folio-doc">
      <DocHeader kind="Rezervasyon onayı" no={r.reservationNumber} lines={[`Düzenleme: ${fmtDate(new Date().toISOString().slice(0, 10))}`]} />
      <p style={{ margin: '5mm 0 3mm' }}>Sayın <b>{r.guestName}</b>, rezervasyonunuz aşağıdaki bilgilerle {r.status === 'tentative' ? <b>opsiyonlu olarak</b> : ''} kayıt altına alınmıştır.
        {r.status === 'tentative' && r.optionUntil ? <> Opsiyon bitiş tarihi: <b>{fmtDate(r.optionUntil)}</b>.</> : null}</p>
      <section className="fd-info">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </section>
      {rates.length > 0 && (
        <table className="fd-table">
          <thead><tr><th>Gece</th><th className="r">Oda fiyatı</th></tr></thead>
          <tbody>{rates.map(x => <tr key={x.date}><td>{fmtDate(x.date)}</td><td className="r">{fmtMoney(x.rate, r.currency)}</td></tr>)}</tbody>
        </table>
      )}
      <section className="fd-totals">
        <div><span>Konaklama toplamı</span><span>{fmtMoney(r.totalRate, r.currency)}</span></div>
        {deposit > 0 && <div><span>İstenen ön ödeme</span><span>{fmtMoney(r.depositRequired, r.currency)}</span></div>}
        <div className="fd-balance"><span>Toplam</span><span>{fmtMoney(r.totalRate, r.currency)}</span></div>
      </section>
      {note.trim() && <div className="kv-text" style={{ whiteSpace: 'pre-wrap', marginTop: '8mm', fontSize: '9pt', color: '#374151' }}>{note}</div>}
      <DocFooter lead="Sizi ağırlamaktan mutluluk duyacağız." note="Bu belge bilgi amaçlıdır, fatura yerine geçmez." />
    </div>
  );
}

export function ConfirmationButton({ r }: { r: Reservation }) {
  const { property } = useSession();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: () => get<Setting[]>('/api/v1/property/settings') });
  const [data, setData] = useState<{ date: string; rate: string }[] | null>(null);
  const print = async () => {
    try {
      setData(await get<{ date: string; rate: string }[]>(`/api/v1/reservations/${r.id}/rates`));
      setTimeout(() => { window.print(); setData(null); }, 80);
    } catch (e) { toast.error(e); }
  };
  const note = String(settings.data?.find(s => s.key === 'frontoffice.confirmation_note')?.value ?? '');
  return (
    <>
      <button className="btn" onClick={() => void print()} title="Misafire / acenteye verilecek onay belgesini yazdır veya PDF olarak kaydet"><FileCheck2 /> Onay belgesi</button>
      {data && createPortal(<ConfirmationDoc r={r} rates={data} note={note} property={property} />, document.getElementById('print-root')!)}
    </>
  );
}
