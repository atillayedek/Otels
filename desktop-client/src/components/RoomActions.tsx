import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, post } from '../lib/api';
import { HK_LABEL, PRIORITY_LABEL, BLOCK_LABEL } from '../lib/format';
import { useRooms, useStaff } from '../lib/queries';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { ErrorBox, Field, Modal } from './ui';

/** Oda temizlik durumu, rahatsız etmeyin ve kat notu. Sürüm kontrolü ile kaydedilir. */
export function HkStatusModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const rooms = useRooms();
  const room = rooms.data?.find(r => r.id === roomId);
  const qc = useQueryClient();
  const [hk, setHk] = useState<string | null>(null);
  const [dnd, setDnd] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = useAction(async () => {
    await api('POST', `/api/v1/rooms/${roomId}/housekeeping`, { hkStatus: hk ?? room!.hkStatus, isDnd: dnd ?? room!.isDnd, hkNote: (note ?? room!.hkNote ?? '') || null, version: room!.version });
    await qc.invalidateQueries({ queryKey: ['rooms'] });
  }, { success: 'Oda durumu güncellendi.' });
  if (!room) return null;
  return (
    <Modal title={`Oda ${room.number} — temizlik durumu`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="stack">
        <div className="seg">
          {Object.entries(HK_LABEL).map(([k, l]) => <button key={k} className={(hk ?? room.hkStatus) === k ? 'active' : ''} onClick={() => setHk(k)}>{l}</button>)}
        </div>
        <label className="check"><input type="checkbox" checked={dnd ?? room.isDnd} onChange={e => setDnd(e.target.checked)} /> Rahatsız etmeyin (DND)</label>
        <Field label="Kat notu"><textarea className="input" rows={3} value={note ?? room.hkNote ?? ''} onChange={e => setNote(e.target.value)} maxLength={500} /></Field>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}

/** Arıza kaydı; isteğe bağlı olarak odayı satışa kapatır. */
export function TicketModal({ roomId, onClose }: { roomId?: string; onClose: () => void }) {
  const rooms = useRooms();
  const staff = useStaff();
  const { property } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ roomId: roomId ?? '', location: '', issue: '', description: '', priority: 'normal', assignedUserId: '', blockRoom: false, blockKind: 'out_of_order', blockFrom: property?.businessDate ?? '', blockTo: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = useAction(async (key: string) => {
    await post('/api/v1/maintenance/tickets', {
      roomId: f.roomId || null, location: f.location || null, issue: f.issue, description: f.description || null, priority: f.priority,
      assignedUserId: f.assignedUserId || null, blockRoom: f.blockRoom && !!f.roomId, blockFrom: f.blockRoom ? f.blockFrom : null, blockTo: f.blockRoom ? f.blockTo : null, blockKind: f.blockRoom ? f.blockKind : null,
    }, key);
    await qc.invalidateQueries({ queryKey: ['tickets'] });
  }, { success: 'Arıza kaydı oluşturuldu.' });
  return (
    <Modal title="Yeni arıza kaydı" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={save.busy || !f.issue.trim() || (!f.roomId && !f.location.trim()) || (f.blockRoom && (!f.blockFrom || !f.blockTo))} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>
    </>}>
      <div className="form-grid">
        <Field label="Oda" className="span-2"><select className="input" value={f.roomId} onChange={set('roomId')}><option value="">Oda dışı alan</option>{rooms.data?.map(r => <option key={r.id} value={r.id}>{r.number} · {r.roomTypeCode}</option>)}</select></Field>
        {!f.roomId && <Field label="Yer" required className="span-2"><input className="input" value={f.location} onChange={set('location')} placeholder="Lobi, mutfak…" /></Field>}
        <Field label="Arıza" required className="span-4"><input className="input" value={f.issue} onChange={set('issue')} maxLength={200} autoFocus /></Field>
        <Field label="Açıklama" className="span-4"><textarea className="input" rows={3} value={f.description} onChange={set('description')} /></Field>
        <Field label="Öncelik"><select className="input" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Görevli" className="span-2"><select className="input" value={f.assignedUserId} onChange={set('assignedUserId')}><option value="">Atanmadı</option>{staff.data?.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></Field>
        {f.roomId && <>
          <div className="span-4"><label className="check"><input type="checkbox" checked={f.blockRoom} onChange={set('blockRoom')} /> Odayı satışa kapat</label></div>
          {f.blockRoom && <>
            <Field label="Blokaj türü"><select className="input" value={f.blockKind} onChange={set('blockKind')}>{Object.entries(BLOCK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Başlangıç" required><input type="date" className="input" value={f.blockFrom} onChange={set('blockFrom')} /></Field>
            <Field label="Bitiş (dahil değil)" required><input type="date" className="input" value={f.blockTo} onChange={set('blockTo')} /></Field>
          </>}
        </>}
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
