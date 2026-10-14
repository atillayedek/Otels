import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ListTodo } from 'lucide-react';
import { get, qs } from '../lib/api';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { DEPARTMENT, TraceRow, type Trace } from '../components/Traces';

/** Bugün ve geçmişte kalmış açık misafir hatırlatmaları; bölüme göre süzülür. */
export default function TracesPage() {
  const nav = useNavigate();
  const [department, setDepartment] = useState('');
  const [upcoming, setUpcoming] = useState(false);
  const list = useQuery({ queryKey: ['traces', 'open', department, upcoming], queryFn: () => get<Trace[]>(`/api/v1/traces${qs({ department, upcoming })}`) });
  return (
    <div className="page">
      <PageHead title="Hatırlatmalar" sub="Misafirle ilgili bugün yapılacak işler (rezervasyon ekranındaki Hatırlatmalar sekmesinden eklenir)" />
      <div className="toolbar">
        <div className="seg"><button className={department === '' ? 'active' : ''} onClick={() => setDepartment('')}>Tüm bölümler</button>
          {Object.entries(DEPARTMENT).map(([k, v]) => <button key={k} className={department === k ? 'active' : ''} onClick={() => setDepartment(k)}>{v}</button>)}</div>
        <label className="check"><input type="checkbox" checked={upcoming} onChange={e => setUpcoming(e.target.checked)} /> İleri tarihlileri de göster</label>
        <span className="count">{list.data?.length ?? 0} açık</span>
      </div>
      <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.length
          ? <Empty icon={<ListTodo />} title="Açık hatırlatma yok" />
          : (
            <div className="table-wrap">
              <table className="dt"><thead><tr><th>Gün</th><th>Bölüm</th><th>Misafir</th><th>Hatırlatma</th><th>Durum</th><th /></tr></thead>
                <tbody>{list.data.map(t => <TraceRow key={t.id} t={t} showReservation onOpen={() => nav(`/reservations/${t.reservationId}`)} />)}</tbody></table>
            </div>
          )}
      </div>
    </div>
  );
}
