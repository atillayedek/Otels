import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { get, qs } from '../lib/api';
import type { AvailabilityDay, RatePrice } from '../lib/types';
import { addDays, fmtDay, fmtMoney } from '../lib/format';
import { useRatePlans, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Spinner } from '../components/ui';

export default function AvailabilityPage() {
  const { property } = useSession();
  const bd = property?.businessDate ?? new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(bd);
  const days = 14;
  const to = addDays(from, days - 1);
  const types = useRoomTypes();
  const plans = useRatePlans();
  const [planId, setPlanId] = useState('');
  const avail = useQuery({ queryKey: ['availability', from, to], queryFn: () => get<AvailabilityDay[]>(`/api/v1/availability${qs({ from, to: addDays(from, days) })}`) });
  const prices = useQuery({ queryKey: ['ratePrices', planId], queryFn: () => get<RatePrice[]>(`/api/v1/rate-plans/${planId}/prices`), enabled: !!planId });
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from]);

  const cell = (typeId: string, d: string) => avail.data?.find(a => a.roomTypeId === typeId && a.date === d);
  const price = (typeId: string, d: string) => {
    if (!planId) return types.data?.find(t => t.id === typeId)?.defaultRate;
    return prices.data?.find(p => p.roomTypeId === typeId && p.dateFrom <= d && d < p.dateTo)?.price;
  };
  const totals = dates.map(d => (avail.data ?? []).filter(a => a.date === d).reduce((s, a) => ({ total: s.total + a.total - a.blocked, sold: s.sold + a.sold, free: s.free + a.available }), { total: 0, sold: 0, free: 0 }));

  return (
    <div className="page">
      <PageHead title="Fiyat ve Doluluk" sub="Oda tipine göre boş oda ve fiyat" actions={<>
        <select className="input" style={{ width: 220 }} value={planId} onChange={e => setPlanId(e.target.value)}><option value="">Varsayılan oda tipi fiyatı</option>{plans.data?.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
        <button className="btn icon" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft /></button>
        <input type="date" className="input" style={{ width: 150 }} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
        <button className="btn icon" onClick={() => setFrom(addDays(from, 7))}><ChevronRight /></button>
        <button className="btn" onClick={() => setFrom(bd)}>Bugün</button>
      </>} />
      {avail.isLoading || types.isLoading ? <Spinner /> : avail.error ? <ErrorBox error={avail.error} /> : (types.data ?? []).length === 0 ? <Empty title="Henüz oda tipi tanımlanmamış" /> : (
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr><th style={{ minWidth: 150 }}>Oda tipi</th>{dates.map(d => { const f = fmtDay(d); return <th key={d} style={{ textAlign: 'center', background: d === bd ? 'var(--primary-50)' : f.weekend ? 'var(--surface-3)' : undefined }}>{f.day}<br /><span className="muted">{f.weekday}</span></th>; })}</tr>
            </thead>
            <tbody>
              {types.data!.filter(t => t.isActive).map(t => (
                <tr key={t.id}>
                  <td><b>{t.code}</b> · {t.name}<br /><span className="muted">{t.roomCount} oda</span></td>
                  {dates.map(d => {
                    const c = cell(t.id, d);
                    const p = price(t.id, d);
                    const free = c?.available ?? 0;
                    return (
                      <td key={d} style={{ textAlign: 'center', background: free <= 0 ? 'var(--danger-50)' : free <= 1 ? 'var(--warning-50)' : undefined }} title={c ? `Toplam ${c.total}, bloke ${c.blocked}, satılan ${c.sold}${c.held ? `, acente kontenjanında ${c.held}` : ''}` : ''}>
                        <b style={{ fontSize: 15 }}>{free}</b>{c?.held ? <span className="muted" style={{ fontSize: 11 }}> +{c.held}K</span> : null}<br /><span className="muted" style={{ fontSize: 11 }}>{p ? fmtMoney(p) : '—'}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Boş oda</td>{totals.map((t, i) => <td key={i} style={{ textAlign: 'center' }}><b>{t.free}</b></td>)}</tr>
              <tr><td>Doluluk</td>{totals.map((t, i) => <td key={i} style={{ textAlign: 'center' }}>%{t.total ? Math.round((t.sold / t.total) * 100) : 0}</td>)}</tr>
            </tfoot>
          </table>
        </div>
      )}
      {planId && prices.data && prices.data.length === 0 && <div className="warn-box" style={{ marginTop: 10 }}>Bu fiyat planında tanımlı fiyat yok; rezervasyonda oda tipi varsayılan fiyatı kullanılır.</div>}
    </div>
  );
}
