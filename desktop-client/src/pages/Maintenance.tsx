import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { Ticket } from '../lib/types';
import { fmtDateTime, PRIORITY_LABEL, TICKET_STATUS } from '../lib/format';
import { useStaff } from '../lib/queries';
import { useSession } from '../lib/session';
import { Kv, PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, type Column } from '../components/ui';
import { TicketModal } from '../components/RoomActions';

const PR_COLOR: Record<string, string> = { low: 'gray', normal: 'blue', high: 'orange', urgent: 'red' };
const ST_COLOR: Record<string, string> = { open: 'orange', in_progress: 'blue', resolved: 'green', closed: 'gray', cancelled: 'gray' };

export default function MaintenancePage() {
  const { can } = useSession();
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Ticket | null>(null);
  const list = useQuery({ queryKey: ['tickets', status], queryFn: () => get<Ticket[]>(`/api/v1/maintenance/tickets${qs({ status: status === 'active' ? null : status })}`) });
  const rows = (list.data ?? []).filter(t => status !== 'active' || t.status === 'open' || t.status === 'in_progress');

  const cols: Column<Ticket>[] = [
    { key: 'ticketNo', header: 'No', width: 60 },
    { key: 'where', header: 'Oda / yer', width: 110, filter: true, value: t => t.roomNumber ?? t.location ?? '' },
    { key: 'issue', header: 'Arıza', filter: true },
    { key: 'priority', header: 'Öncelik', width: 100, value: t => PRIORITY_LABEL[t.priority], render: t => <Badge color={PR_COLOR[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge> },
    { key: 'status', header: 'Durum', width: 120, value: t => TICKET_STATUS[t.status], render: t => <Badge color={ST_COLOR[t.status]}>{TICKET_STATUS[t.status]}</Badge> },
    { key: 'assignedTo', header: 'Görevli', filter: true },
    { key: 'openedAt', header: 'Açılış', width: 140, render: t => fmtDateTime(t.openedAt) },
    { key: 'openedBy', header: 'Açan' },
  ];

  return (
    <div className="page">
      <PageHead title="Arıza Kayıtları" sub="Teknik servis" actions={can('maintenance.report') && <button className="btn primary" onClick={() => setCreating(true)}><Plus /> Yeni arıza</button>} />
      <div className="toolbar">
        <select className="input" style={{ width: 170 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">Açık ve çalışılanlar</option>{Object.entries(TICKET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="">Tümü</option>
        </select>
        <span className="count">{rows.length} kayıt</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={rows} columns={cols} rowKey={t => t.id} onRowClick={setEdit} maxHeight="calc(100vh - 240px)" empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Arıza kaydı bulunmuyor.'} />} />
      )}
      {creating && <TicketModal onClose={() => setCreating(false)} />}
      {edit && <TicketEditModal ticket={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TicketEditModal({ ticket: t, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const staff = useStaff();
  const { can } = useSession();
  const [f, setF] = useState({ status: t.status, priority: t.priority, assignedUserId: t.assignedUserId ?? '', notes: t.notes ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const save = useAction(async () => {
    await api('PUT', `/api/v1/maintenance/tickets/${t.id}`, { ...f, assignedUserId: f.assignedUserId || null, notes: f.notes || null, version: t.version });
    await qc.invalidateQueries({ queryKey: ['tickets'] });
  }, { success: 'Arıza kaydı güncellendi.' });
  return (
    <Modal title={`Arıza #${t.ticketNo} · ${t.issue}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Kapat</button>
      {can('maintenance.manage') && <button className="btn primary" disabled={save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>}
    </>}>
      <div className="stack">
        <Kv items={[['Oda / yer', t.roomNumber ?? t.location], ['Açıklama', t.description], ['Açılış', `${fmtDateTime(t.openedAt)} · ${t.openedBy ?? ''}`], ['Çözüm', fmtDateTime(t.resolvedAt)]]} />
        <div className="form-grid">
          <Field label="Durum"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(TICKET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Öncelik"><select className="input" value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Görevli" className="span-2"><select className="input" value={f.assignedUserId} onChange={set('assignedUserId')}><option value="">Atanmadı</option>{staff.data?.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></Field>
          <Field label="Notlar" className="span-4"><textarea className="input" rows={3} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
