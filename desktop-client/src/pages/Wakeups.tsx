import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { Wakeup } from '../lib/types';
import { fmtDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, useToast, type Column } from '../components/ui';

const ST: Record<string, [string, string]> = { pending: ['Bekliyor', 'orange'], done: ['Yapıldı', 'green'], cancelled: ['İptal', 'gray'] };

export default function WakeupsPage() {
  const { property, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(property?.businessDate ?? '');
  const list = useQuery({ queryKey: ['wakeups', date], queryFn: () => get<Wakeup[]>(`/api/v1/wakeup-calls${qs({ date })}`) });
  const act = async (w: Wakeup, a: 'done' | 'cancelled') => {
    try { await api('POST', `/api/v1/wakeup-calls/${w.id}/${a}`); await qc.invalidateQueries({ queryKey: ['wakeups'] }); toast.ok(a === 'done' ? 'Uyandırma yapıldı olarak işaretlendi.' : 'Uyandırma iptal edildi.'); } catch (e) { toast.error(e); }
  };
  const cols: Column<Wakeup>[] = [
    { key: 'callAt', header: 'Saat', width: 150, render: w => fmtDateTime(w.callAt) },
    { key: 'roomNumber', header: 'Oda', width: 70 },
    { key: 'guestName', header: 'Misafir' },
    { key: 'notes', header: 'Not' },
    { key: 'status', header: 'Durum', width: 100, render: w => <Badge color={ST[w.status]?.[1]}>{ST[w.status]?.[0] ?? w.status}</Badge> },
    { key: 'act', header: '', width: 200, render: w => w.status === 'pending' && can('reservation.edit') ? <div className="row"><button className="btn sm success" onClick={() => void act(w, 'done')}><Check /> Yapıldı</button><button className="btn sm ghost" onClick={() => void act(w, 'cancelled')}><X /> İptal</button></div> : null },
  ];
  return (
    <div className="page">
      <PageHead title="Uyandırmalar" sub="Yeni uyandırma, konaklayan misafirin rezervasyon ekranından eklenir." />
      <div className="toolbar"><input type="date" className="input" style={{ width: 150 }} value={date} onChange={e => setDate(e.target.value)} /><span className="count">{list.data?.length ?? 0} kayıt</span></div>
      {list.error ? <ErrorBox error={list.error} /> : <DataTable rows={list.data ?? []} columns={cols} rowKey={w => w.id} empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Bu tarihte uyandırma bulunmuyor.'} />} />}
    </div>
  );
}
