import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IdCard } from 'lucide-react';
import { get, post, qs } from '../lib/api';
import type { KbsReport } from '../lib/types';
import { fmtDateTime, KBS_STATUS } from '../lib/format';
import { PageHead, useAction } from '../components/common';
import { useOpenReservation } from '../components/Windows';
import { KbsFormModal } from '../components/KbsForm';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, type Column } from '../components/ui';

const COLOR: Record<string, string> = { accepted: 'green', reported_manually: 'green', blocked_configuration: 'orange', needs_data: 'orange', rejected: 'red', manual_action_required: 'red', outcome_unknown: 'red' };

export default function KbsPage() {
  const openRes = useOpenReservation();
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState<KbsReport | null>(null);
  const [formFor, setFormFor] = useState<string | null>(null);
  const st = useQuery({ queryKey: ['kbs', 'status'], queryFn: () => get<{ configured: boolean; message: string }>('/api/v1/kbs/status') });
  const list = useQuery({ queryKey: ['kbs', 'reports', status], queryFn: () => get<KbsReport[]>(`/api/v1/kbs/reports${qs({ status })}`) });
  const cols: Column<KbsReport>[] = [
    { key: 'createdAt', header: 'Zaman', width: 140, render: r => fmtDateTime(r.createdAt) },
    { key: 'event', header: 'Olay', width: 90, value: r => (r.event === 'check_in' ? 'Giriş' : r.event === 'check_out' ? 'Çıkış' : r.event === 'room_move' ? 'Oda değişimi' : r.event) },
    { key: 'roomNumber', header: 'Oda', width: 70 },
    { key: 'guestName', header: 'Misafir', filter: true },
    { key: 'reservationNumber', header: 'Rez. No', width: 110 },
    { key: 'status', header: 'Durum', width: 170, value: r => KBS_STATUS[r.status], render: r => <Badge color={COLOR[r.status] ?? 'blue'}>{KBS_STATUS[r.status] ?? r.status}</Badge> },
    { key: 'manualReference', header: 'Manuel referans' },
    { key: 'act', header: '', width: 240, render: r => <div className="row">
      <button className="btn sm primary" onClick={e => { e.stopPropagation(); setFormFor(r.reservationId); }}>Bildirim formu</button>
      {!['accepted', 'reported_manually', 'superseded'].includes(r.status) && <button className="btn sm" onClick={e => { e.stopPropagation(); setManual(r); }}>Tek kişi işaretle</button>}
    </div> },
  ];
  return (
    <div className="page">
      <PageHead title="Kimlik Bildirimi (KBS)" />
      {st.data && <div className={st.data.configured ? 'ok-box' : 'warn-box'} style={{ marginBottom: 12 }}><IdCard size={14} /> {st.data.message}{!st.data.configured && ' Bildirimler kuyrukta bekletilir; resmi KBS ekranından elle bildirip burada "Manuel bildirildi" olarak işaretleyebilirsiniz.'}</div>}
      <div className="toolbar">
        <select className="input" style={{ width: 200 }} value={status} onChange={e => setStatus(e.target.value)}><option value="">Tüm durumlar</option>{Object.entries(KBS_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="count">{list.data?.length ?? 0} kayıt</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : <DataTable rows={list.data ?? []} columns={cols} rowKey={r => r.id} onRowClick={r => openRes(r.reservationId)} maxHeight="calc(100vh - 290px)" empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Kimlik bildirimi kaydı bulunmuyor.'} />} />}
      {manual && <ManualModal report={manual} onClose={() => setManual(null)} />}
      {formFor && <KbsFormModal reservationId={formFor} onClose={() => setFormFor(null)} />}
    </div>
  );
}

function ManualModal({ report, onClose }: { report: KbsReport; onClose: () => void }) {
  const qc = useQueryClient();
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction(async (key: string) => { await post(`/api/v1/kbs/reports/${report.id}/manual`, { reference: ref, reason }, key); await qc.invalidateQueries({ queryKey: ['kbs'] }); }, { success: 'Manuel bildirim kaydedildi.' });
  return (
    <Modal title={`Manuel bildirim · ${report.guestName}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!ref.trim() || !reason.trim() || act.busy} onClick={async () => { if (await act.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Resmi bildirim referansı" required className="span-4"><input className="input" value={ref} onChange={e => setRef(e.target.value)} autoFocus /></Field>
        <Field label="Açıklama" required className="span-4"><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="KBS ekranından elle bildirildi" /></Field>
      </div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}
