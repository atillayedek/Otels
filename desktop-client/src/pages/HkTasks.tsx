import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { HkTask } from '../lib/types';
import { fmtDateTime, TASK_LABEL, TASK_STATUS } from '../lib/format';
import { useRooms, useStaff } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, type Column } from '../components/ui';

const ST_COLOR: Record<string, string> = { open: 'orange', in_progress: 'blue', done: 'green', cancelled: 'gray' };

export default function HkTasksPage() {
  const { can, property } = useSession();
  const [date, setDate] = useState(property?.businessDate ?? '');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [edit, setEdit] = useState<HkTask | 'new' | null>(null);
  const staff = useStaff();
  const tasks = useQuery({ queryKey: ['hk', 'tasks', date, status, assignee], queryFn: () => get<HkTask[]>(`/api/v1/housekeeping/tasks${qs({ date, status, assignee })}`) });

  const cols: Column<HkTask>[] = [
    { key: 'roomNumber', header: 'Oda', width: 70, filter: true },
    { key: 'floor', header: 'Kat', width: 60 },
    { key: 'taskType', header: 'Görev', value: t => TASK_LABEL[t.taskType] ?? t.taskType },
    { key: 'status', header: 'Durum', width: 120, value: t => TASK_STATUS[t.status], render: t => <Badge color={ST_COLOR[t.status]}>{TASK_STATUS[t.status]}</Badge> },
    { key: 'assignedTo', header: 'Görevli', filter: true },
    { key: 'notes', header: 'Not' },
    { key: 'createdAt', header: 'Oluşturma', width: 140, render: t => fmtDateTime(t.createdAt) },
    { key: 'completedAt', header: 'Tamamlanma', width: 140, render: t => fmtDateTime(t.completedAt) },
  ];

  return (
    <div className="page">
      <PageHead title="Kat Hizmetleri Görevleri" actions={can('housekeeping.assign') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Görev oluştur</button>} />
      <div className="toolbar">
        <input type="date" className="input" style={{ width: 150 }} value={date} onChange={e => setDate(e.target.value)} />
        <select className="input" style={{ width: 140 }} value={status} onChange={e => setStatus(e.target.value)}><option value="">Tüm durumlar</option>{Object.entries(TASK_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" style={{ width: 180 }} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Tüm görevliler</option>{staff.data?.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
        <span className="count">{tasks.data?.length ?? 0} görev</span>
      </div>
      {tasks.error ? <ErrorBox error={tasks.error} /> : (
        <DataTable rows={tasks.data ?? []} columns={cols} rowKey={t => t.id} onRowClick={t => setEdit(t)} maxHeight="calc(100vh - 240px)"
          empty={<Empty title={tasks.isLoading ? 'Yükleniyor…' : 'Bu tarihte görev bulunmuyor.'} text="Çıkış yapan odalar için temizlik görevleri otomatik oluşur." />} />
      )}
      {edit && <TaskModal task={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TaskModal({ task, onClose }: { task?: HkTask; onClose: () => void }) {
  const qc = useQueryClient();
  const rooms = useRooms();
  const staff = useStaff();
  const { can } = useSession();
  const [f, setF] = useState({ roomId: task?.roomId ?? '', taskType: task?.taskType ?? 'stayover_clean', status: task?.status ?? 'open', assignedUserId: task?.assignedUserId ?? '', notes: task?.notes ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const save = useAction(async () => {
    if (task) await api('PUT', `/api/v1/housekeeping/tasks/${task.id}`, { status: f.status, assignedUserId: f.assignedUserId || null, notes: f.notes || null, version: task.version });
    else await api('POST', '/api/v1/housekeeping/tasks', { roomId: f.roomId, taskType: f.taskType, assignedUserId: f.assignedUserId || null, notes: f.notes || null });
    await qc.invalidateQueries({ queryKey: ['hk'] });
  }, { success: 'Görev kaydedildi.' });
  const readOnly = !can('housekeeping.update') && !can('housekeeping.assign');
  return (
    <Modal title={task ? `Oda ${task.roomNumber} · ${TASK_LABEL[task.taskType]}` : 'Yeni görev'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Kapat</button>
      {!readOnly && <button className="btn primary" disabled={(!task && !f.roomId) || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button>}
    </>}>
      <div className="form-grid">
        {!task && <>
          <Field label="Oda" required className="span-2"><select className="input" value={f.roomId} onChange={set('roomId')}><option value="">Seçin</option>{rooms.data?.map(r => <option key={r.id} value={r.id}>{r.number}</option>)}</select></Field>
          <Field label="Görev" className="span-2"><select className="input" value={f.taskType} onChange={set('taskType')}>{Object.entries(TASK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </>}
        {task && <Field label="Durum" className="span-2"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(TASK_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
        <Field label="Görevli" className="span-2"><select className="input" value={f.assignedUserId} onChange={set('assignedUserId')} disabled={!can('housekeeping.assign')}><option value="">Atanmadı</option>{staff.data?.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></Field>
        <Field label="Not" className="span-4"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
