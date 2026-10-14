import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Plus } from 'lucide-react';
import { api, get, newKey, qs } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { useAction } from './common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, useToast } from './ui';

export interface Trace {
  id: string; reservationId: string; reservationNumber: string; guestName: string; roomNumber?: string; department: string; message: string; dueDate: string;
  status: 'open' | 'done' | 'cancelled'; createdAt: string; createdBy?: string; doneAt?: string; doneBy?: string; doneNote?: string;
}

export const DEPARTMENT: Record<string, string> = {
  front_office: 'Ön büro', housekeeping: 'Kat hizmetleri', maintenance: 'Teknik servis', restaurant: 'Restoran', accounting: 'Muhasebe', management: 'Yönetim',
};

export function useTraceActions() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (t: Trace, status: 'done' | 'cancelled', note?: string) => {
    try {
      await api('POST', `/api/v1/traces/${t.id}/complete`, { status, note: note ?? null }, { key: newKey() });
      await qc.invalidateQueries({ queryKey: ['traces'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      return true;
    } catch (e) { toast.error(e); return false; }
  };
}

function CancelTraceModal({ t, onClose }: { t: Trace; onClose: () => void }) {
  const act = useTraceActions();
  const [note, setNote] = useState('');
  return (
    <Modal title="Hatırlatmayı iptal et" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn danger" disabled={!note.trim()} onClick={async () => { if (await act(t, 'cancelled', note)) onClose(); }}>İptal et</button>
    </>}>
      <div className="stack"><div className="muted">{t.message}</div>
        <Field label="Gerekçe" required><input className="input" value={note} onChange={e => setNote(e.target.value)} autoFocus /></Field></div>
    </Modal>
  );
}

export function TraceRow({ t, showReservation, onOpen }: { t: Trace; showReservation?: boolean; onOpen?: () => void }) {
  const act = useTraceActions();
  const [cancel, setCancel] = useState(false);
  const { property } = useSession();
  const overdue = t.status === 'open' && t.dueDate < (property?.businessDate ?? '');
  return (
    <tr>
      <td>{fmtDate(t.dueDate)}{overdue && <div><Badge color="red">Gecikmiş</Badge></div>}</td>
      <td><Badge color="blue">{DEPARTMENT[t.department] ?? t.department}</Badge></td>
      {showReservation && <td className="clickable" onClick={onOpen}><b>{t.guestName}</b><div className="muted" style={{ fontSize: 11 }}>{t.reservationNumber}{t.roomNumber ? ` · Oda ${t.roomNumber}` : ''}</div></td>}
      <td style={{ maxWidth: 420 }}>{t.message}<div className="muted" style={{ fontSize: 11 }}>{t.createdBy} · {fmtDateTime(t.createdAt)}</div></td>
      <td>{t.status === 'open' ? <Badge color="orange">Açık</Badge> : <><Badge color={t.status === 'done' ? 'green' : 'gray'}>{t.status === 'done' ? 'Yapıldı' : 'İptal'}</Badge>
        <div className="muted" style={{ fontSize: 11 }}>{t.doneBy} · {fmtDateTime(t.doneAt)}{t.doneNote ? ` · ${t.doneNote}` : ''}</div></>}</td>
      <td className="r" style={{ whiteSpace: 'nowrap' }}>{t.status === 'open' && <>
        <button className="btn sm" onClick={() => void act(t, 'done')}><Check size={14} /> Yapıldı</button>
        <button className="btn sm ghost icon" title="İptal et" onClick={() => setCancel(true)}><Ban size={14} /></button>
      </>}{cancel && <CancelTraceModal t={t} onClose={() => setCancel(false)} />}</td>
    </tr>
  );
}

/** Rezervasyon ekranındaki hatırlatmalar sekmesi. */
export function ReservationTraces({ reservationId, arrival, departure, open }: { reservationId: string; arrival: string; departure: string; open: boolean }) {
  const qc = useQueryClient();
  const { property } = useSession();
  const bd = property?.businessDate ?? arrival;
  const list = useQuery({ queryKey: ['traces', 'reservation', reservationId], queryFn: () => get<Trace[]>(`/api/v1/traces${qs({ reservationId })}`) });
  const [f, setF] = useState({ department: 'front_office', dueDate: arrival > bd ? arrival : bd, message: '' });
  const add = useAction(async (key: string) => {
    await api('POST', `/api/v1/reservations/${reservationId}/traces`, f, { key });
    setF(s => ({ ...s, message: '' }));
    await qc.invalidateQueries({ queryKey: ['traces'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
  }, { success: 'Hatırlatma eklendi.' });
  return (
    <div className="stack">
      {open && (
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Gün"><input type="date" className="input" min={bd} max={departure} value={f.dueDate} onChange={e => setF(s => ({ ...s, dueDate: e.target.value }))} /></Field>
          <Field label="Bölüm"><select className="input" value={f.department} onChange={e => setF(s => ({ ...s, department: e.target.value }))}>
            {Object.entries(DEPARTMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Hatırlatma" className="grow"><input className="input" style={{ minWidth: 320 }} value={f.message} maxLength={500} placeholder="Ör. Doğum günü pastası 20:00, havalimanı transferi 07:00"
            onChange={e => setF(s => ({ ...s, message: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && f.message.trim()) void add.run(); }} /></Field>
          <button className="btn primary" disabled={!f.message.trim() || add.busy} onClick={() => void add.run()}><Plus /> Ekle</button>
        </div>
      )}
      <ErrorBox error={add.error} />
      {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty title="Hatırlatma yok" text="Misafirle ilgili belirli bir günde yapılacak işleri buraya ekleyin; ilgili bölüm günlük listede görür." /> : (
        <table className="dt"><thead><tr><th>Gün</th><th>Bölüm</th><th>Hatırlatma</th><th>Durum</th><th /></tr></thead>
          <tbody>{list.data.map(t => <TraceRow key={t.id} t={t} />)}</tbody></table>
      )}
    </div>
  );
}
