import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock } from 'lucide-react';
import { api, get, post, qs } from '../lib/api';
import type { RoomBlock } from '../lib/types';
import { addDays, BLOCK_LABEL, fmtDate, fmtDateTime } from '../lib/format';
import { useRooms } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, useConfirm, useToast, type Column } from '../components/ui';

export default function RoomBlocksPage() {
  const { can, property } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const bd = property?.businessDate ?? '';
  const [from, setFrom] = useState(bd);
  const [to, setTo] = useState(addDays(bd, 60));
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['blocks', from, to], queryFn: () => get<RoomBlock[]>(`/api/v1/room-blocks${qs({ from, to })}`) });

  const release = async (b: RoomBlock) => {
    if (!await confirm({ title: 'Blokajı kaldır', message: `Oda ${b.roomNumber} için ${fmtDate(b.dateFrom)} – ${fmtDate(b.dateTo)} blokajı kaldırılacak ve oda satışa açılacak.`, confirmText: 'Kaldır' })) return;
    try { await api('POST', `/api/v1/room-blocks/${b.id}/release`); toast.ok('Blokaj kaldırıldı.'); await qc.invalidateQueries({ queryKey: ['blocks'] }); } catch (e) { toast.error(e); }
  };

  const cols: Column<RoomBlock>[] = [
    { key: 'roomNumber', header: 'Oda', width: 70, filter: true },
    { key: 'kind', header: 'Tür', width: 140, value: b => BLOCK_LABEL[b.kind] },
    { key: 'dateFrom', header: 'Başlangıç', width: 100, render: b => fmtDate(b.dateFrom) },
    { key: 'dateTo', header: 'Bitiş', width: 100, render: b => fmtDate(b.dateTo) },
    { key: 'reason', header: 'Gerekçe', filter: true },
    { key: 'isActive', header: 'Durum', width: 90, render: b => b.isActive ? <Badge color="orange">Aktif</Badge> : <Badge color="gray">Kaldırıldı</Badge> },
    { key: 'createdAt', header: 'Oluşturma', width: 150, render: b => `${fmtDateTime(b.createdAt)}` },
    { key: 'act', header: '', width: 90, render: b => b.isActive && can('maintenance.manage') ? <button className="btn sm" onClick={e => { e.stopPropagation(); void release(b); }}><Unlock /> Kaldır</button> : null },
  ];

  return (
    <div className="page">
      <PageHead title="Oda Blokajları" sub="Arızalı, servis dışı ve bloke odalar" actions={can('maintenance.manage') && <button className="btn primary" onClick={() => setCreating(true)}><Lock /> Odayı blokla</button>} />
      <div className="toolbar">
        <input type="date" className="input" style={{ width: 150 }} value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" className="input" style={{ width: 150 }} value={to} onChange={e => setTo(e.target.value)} />
        <span className="count">{list.data?.length ?? 0} kayıt</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : <DataTable rows={list.data ?? []} columns={cols} rowKey={b => b.id} maxHeight="calc(100vh - 240px)" empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Bu aralıkta blokaj bulunmuyor.'} />} />}
      {creating && <BlockModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function BlockModal({ onClose }: { onClose: () => void }) {
  const rooms = useRooms();
  const qc = useQueryClient();
  const { property } = useSession();
  const [f, setF] = useState({ roomId: '', kind: 'out_of_order', dateFrom: property?.businessDate ?? '', dateTo: addDays(property?.businessDate ?? '', 1), reason: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const save = useAction(async (key: string) => { await post('/api/v1/room-blocks', { ...f, ticketId: null }, key); await qc.invalidateQueries({ queryKey: ['blocks'] }); }, { success: 'Oda bloklandı.' });
  return (
    <Modal title="Odayı satışa kapat" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!f.roomId || !f.reason.trim() || f.dateTo <= f.dateFrom || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Oda" required className="span-2"><select className="input" value={f.roomId} onChange={set('roomId')}><option value="">Seçin</option>{rooms.data?.map(r => <option key={r.id} value={r.id}>{r.number} · {r.roomTypeCode}</option>)}</select></Field>
        <Field label="Tür" className="span-2"><select className="input" value={f.kind} onChange={set('kind')}>{Object.entries(BLOCK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Başlangıç" required className="span-2"><input type="date" className="input" value={f.dateFrom} onChange={set('dateFrom')} /></Field>
        <Field label="Bitiş (dahil değil)" required className="span-2"><input type="date" className="input" value={f.dateTo} onChange={set('dateTo')} /></Field>
        <Field label="Gerekçe" required className="span-4"><input className="input" value={f.reason} onChange={set('reason')} maxLength={300} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
