import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { get, qs } from '../../lib/api';
import type { AuditLog } from '../../lib/types';
import { fmtDateTime } from '../../lib/format';
import { PageHead } from '../../components/common';
import { DataTable, Empty, ErrorBox, Modal, type Column } from '../../components/ui';

function pretty(v?: string) {
  if (!v) return '';
  try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
}

export default function AuditSettingsPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<AuditLog | null>(null);
  useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['audit', term, from, to, page], queryFn: () => get<AuditLog[]>(`/api/v1/audit-logs${qs({ q: term, from, to, page, pageSize: 100 })}`) });
  const cols: Column<AuditLog>[] = [
    { key: 'at', header: 'Zaman', width: 150, render: a => fmtDateTime(a.at) }, { key: 'username', header: 'Kullanıcı', width: 120 },
    { key: 'hostname', header: 'Cihaz', width: 140 }, { key: 'ip', header: 'IP', width: 120 }, { key: 'action', header: 'İşlem', width: 200 },
    { key: 'entityType', header: 'Kayıt türü', width: 120 }, { key: 'reason', header: 'Gerekçe' },
  ];
  return (
    <div className="page">
      <PageHead title="Denetim Kayıtları" sub="Kayıtlar değiştirilemez ve silinemez" />
      <div className="toolbar">
        <Search size={15} className="muted" /><input className="input" style={{ width: 260 }} placeholder="İşlem, kullanıcı, kayıt" value={q} onChange={e => setQ(e.target.value)} />
        <input type="date" className="input" style={{ width: 150 }} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} />
        <input type="date" className="input" style={{ width: 150 }} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} />
        <span className="count">Sayfa {page}</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : <DataTable rows={list.data ?? []} columns={cols} rowKey={a => String(a.id)} onRowClick={setSel} maxHeight="calc(100vh - 260px)" empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Kayıt bulunmuyor'} />} />}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Daha yeni</button>
        <button className="btn sm" disabled={(list.data?.length ?? 0) < 100} onClick={() => setPage(p => p + 1)}>Daha eski</button>
      </div>
      {sel && (
        <Modal title={sel.action} size="lg" onClose={() => setSel(null)}>
          <div className="stack">
            <div className="muted">{fmtDateTime(sel.at)} · {sel.username} · {sel.hostname} · {sel.entityType} {sel.entityId}</div>
            {sel.reason && <div><b>Gerekçe:</b> {sel.reason}</div>}
            <div className="grid cols-2">
              <div><div className="section-title">Önce</div><pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, background: 'var(--surface-2)', padding: 8, borderRadius: 6, maxHeight: 360, overflow: 'auto' }}>{pretty(sel.oldValue) || '—'}</pre></div>
              <div><div className="section-title">Sonra</div><pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, background: 'var(--surface-2)', padding: 8, borderRadius: 6, maxHeight: 360, overflow: 'auto' }}>{pretty(sel.newValue) || '—'}</pre></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
