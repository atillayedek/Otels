import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Search, UserPlus } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { GuestListItem, Paged } from '../lib/types';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Modal, Pager, type Column } from '../components/ui';
import { draftToBody, emptyGuest, GuestFields, type GuestDraft } from '../components/GuestFields';

export default function GuestsPage() {
  const nav = useNavigate();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [flag, setFlag] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['guests', term, flag, page], queryFn: () => get<Paged<GuestListItem>>(`/api/v1/guests${qs({ q: term, vip: flag === 'vip' || null, blacklisted: flag === 'black' || null, page, pageSize: 100 })}`) });

  const cols: Column<GuestListItem>[] = [
    { key: 'name', header: 'Ad soyad', filter: true, value: g => `${g.firstName} ${g.lastName}`, render: g => <>{g.isVip && <Crown size={12} color="var(--warning)" />} {g.firstName} {g.lastName} {g.isBlacklisted && <Badge color="red">Kara liste</Badge>}</> },
    { key: 'nationality', header: 'Uyruk', width: 70, filter: true },
    { key: 'identityNumber', header: 'Kimlik no', filter: true, render: g => <span className="mono">{g.identityNumber}</span> },
    { key: 'phone', header: 'Telefon', filter: true },
    { key: 'email', header: 'E-posta', filter: true },
    { key: 'stayCount', header: 'Konaklama', align: 'right', width: 90 },
    { key: 'lastStay', header: 'Son konaklama', width: 120, render: g => fmtDate(g.lastStay) },
  ];

  return (
    <div className="page">
      <PageHead title="Misafir Kartları" actions={can('guest.edit') && <button className="btn primary" onClick={() => setCreating(true)}><UserPlus /> Yeni misafir</button>} />
      <div className="toolbar">
        <Search size={15} className="muted" />
        <input className="input" style={{ width: 300 }} placeholder="Ad, soyad, kimlik no, telefon, e-posta" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <select className="input" style={{ width: 150 }} value={flag} onChange={e => { setFlag(e.target.value); setPage(1); }}><option value="">Tüm misafirler</option><option value="vip">VIP</option><option value="black">Kara liste</option></select>
        <span className="count">{list.data ? `${list.data.total} misafir` : ''}</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data?.items ?? []} columns={cols} rowKey={g => g.id} onRowClick={g => nav(`/guests/${g.id}`)} maxHeight="calc(100vh - 250px)"
          empty={<Empty title={list.isLoading ? 'Yükleniyor…' : term || flag ? 'Aramaya uyan misafir yok' : 'Henüz misafir kaydı bulunmuyor.'} text={!term && !flag && !list.isLoading ? 'Misafirler rezervasyonla veya Veri Aktarım Merkezi ile eklenir.' : undefined} />} />
      )}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {creating && <GuestCreateModal onClose={() => setCreating(false)} onSaved={id => nav(`/guests/${id}`)} />}
    </div>
  );
}

export function GuestCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const [g, setG] = useState<GuestDraft>(emptyGuest);
  const save = useAction(async (key: string) => {
    const r = await api<{ id: string }>('POST', '/api/v1/guests', draftToBody(g), { key });
    await qc.invalidateQueries({ queryKey: ['guests'] });
    return r.id;
  }, { success: 'Misafir kaydedildi.' });
  return (
    <Modal title="Yeni misafir" size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!g.firstName.trim() || !g.lastName.trim() || save.busy} onClick={async () => { const id = await save.run(); if (id) { onClose(); onSaved(id); } }}>Kaydet</button>
    </>}>
      <GuestFields value={g} onChange={setG} />
      <ErrorBox error={save.error} />
    </Modal>
  );
}
