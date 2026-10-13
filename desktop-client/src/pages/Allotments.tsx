import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { get, post, put, qs } from '../lib/api';
import type { Allotment, AllotmentDay } from '../lib/types';
import { fmtDate } from '../lib/format';
import { useAgencies, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { PageHead, useAction } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, Spinner, type Column } from '../components/ui';

/** Acente kontenjanları: acenteye ayrılan günlük oda sayısı ve release süresi. */
export default function AllotmentsPage() {
  const { can } = useSession();
  const agencies = useAgencies();
  const [agency, setAgency] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [edit, setEdit] = useState<Allotment | 'new' | null>(null);
  const [usage, setUsage] = useState<Allotment | null>(null);
  const list = useQuery({ queryKey: ['allotments', agency, activeOnly], queryFn: () => get<Allotment[]>(`/api/v1/allotments${qs({ agencyId: agency || null, activeOnly: activeOnly || null })}`) });
  const cols: Column<Allotment>[] = [
    { key: 'agencyName', header: 'Acente', filter: true, render: a => <>{a.agencyName}{!a.isActive && <Badge color="gray">Pasif</Badge>}</> },
    { key: 'roomTypeCode', header: 'Oda tipi', width: 100 },
    { key: 'dateFrom', header: 'Başlangıç', width: 110, render: a => fmtDate(a.dateFrom) },
    { key: 'dateTo', header: 'Bitiş (çıkış)', width: 110, render: a => fmtDate(a.dateTo) },
    { key: 'rooms', header: 'Günlük oda', align: 'right', width: 100 },
    { key: 'releaseDays', header: 'Release', align: 'right', width: 90, render: a => `${a.releaseDays} gün` },
    { key: 'usage', header: 'Kullanım', align: 'right', width: 140, value: a => a.totalRoomNights ? a.usedRoomNights / a.totalRoomNights : 0,
      render: a => `${a.usedRoomNights} / ${a.totalRoomNights} gece (%${a.totalRoomNights ? Math.round(a.usedRoomNights * 100 / a.totalRoomNights) : 0})` },
    { key: 'notes', header: 'Not' },
  ];
  return (
    <div className="page">
      <PageHead title="Acente Kontenjanları" sub="Kullanılmayan kontenjan, release tarihine kadar diğer satışlara kapalıdır" actions={can('allotment.manage') && <button className="btn primary" onClick={() => setEdit('new')}><Plus /> Yeni kontenjan</button>} />
      <div className="toolbar">
        <select className="input" style={{ width: 240 }} value={agency} onChange={e => setAgency(e.target.value)}><option value="">Tüm acenteler</option>{agencies.data?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label className="check"><input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} /> Yalnız aktif</label>
        <span className="count">{list.data?.length ?? 0} kontenjan</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data ?? []} columns={cols} rowKey={a => a.id} onRowClick={setUsage} maxHeight="calc(100vh - 250px)"
          empty={<Empty title={list.isLoading ? 'Yükleniyor…' : 'Kontenjan tanımlı değil'} text="Acentelerle yapılan kontenjan anlaşmalarını buradan girin." />} />
      )}
      {usage && <UsageModal a={usage} onClose={() => setUsage(null)} onEdit={() => { setEdit(usage); setUsage(null); }} />}
      {edit && <AllotmentModal a={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function UsageModal({ a, onClose, onEdit }: { a: Allotment; onClose: () => void; onEdit: () => void }) {
  const { can } = useSession();
  const u = useQuery({ queryKey: ['allotments', 'usage', a.id], queryFn: () => get<AllotmentDay[]>(`/api/v1/allotments/${a.id}/usage`) });
  return (
    <Modal title={`${a.agencyName} · ${a.roomTypeCode}`} size="lg" onClose={onClose} footer={<>
      {can('allotment.manage') && <button className="btn" onClick={onEdit}>Düzenle</button>}<span className="spacer" /><button className="btn" onClick={onClose}>Kapat</button></>}>
      <div className="muted" style={{ marginBottom: 8 }}>{fmtDate(a.dateFrom)} – {fmtDate(a.dateTo)} · günlük {a.rooms} oda · release {a.releaseDays} gün{a.notes ? ` · ${a.notes}` : ''}</div>
      {u.isLoading ? <Spinner /> : u.error ? <ErrorBox error={u.error} /> : (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="dt"><thead><tr><th>Gece</th><th style={{ textAlign: 'right' }}>Kontenjan</th><th style={{ textAlign: 'right' }}>Kullanılan</th><th style={{ textAlign: 'right' }}>Kalan</th><th>Release</th><th /></tr></thead>
            <tbody>{u.data!.map(d => (
              <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="num">{d.rooms}</td><td className="num">{d.used}</td><td className="num"><b>{d.remaining}</b></td>
                <td>{fmtDate(d.releaseDate)}</td><td>{d.released ? <Badge color="gray">Serbest</Badge> : d.remaining > 0 ? <Badge color="orange">Satışa kapalı</Badge> : null}</td></tr>))}</tbody></table>
        </div>
      )}
    </Modal>
  );
}

function AllotmentModal({ a, onClose }: { a?: Allotment; onClose: () => void }) {
  const qc = useQueryClient();
  const { property } = useSession();
  const agencies = useAgencies();
  const types = useRoomTypes();
  const [f, setF] = useState({ agencyId: a?.agencyId ?? '', roomTypeId: a?.roomTypeId ?? '', dateFrom: a?.dateFrom ?? property?.businessDate ?? '', dateTo: a?.dateTo ?? '',
    rooms: String(a?.rooms ?? ''), releaseDays: String(a?.releaseDays ?? 7), notes: a?.notes ?? '', isActive: a?.isActive ?? true });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = useAction(async (key: string) => {
    const body = { agencyId: f.agencyId, roomTypeId: f.roomTypeId, dateFrom: f.dateFrom, dateTo: f.dateTo, rooms: Number(f.rooms), releaseDays: Number(f.releaseDays), notes: f.notes.trim() || null, isActive: f.isActive, version: a?.version };
    if (a) await put(`/api/v1/allotments/${a.id}`, body, key); else await post('/api/v1/allotments', body, key);
    await qc.invalidateQueries({ queryKey: ['allotments'] });
  }, { success: 'Kontenjan kaydedildi.' });
  const valid = f.agencyId && f.roomTypeId && f.dateFrom && f.dateTo && f.dateTo > f.dateFrom && Number(f.rooms) >= 1 && Number(f.releaseDays) >= 0;
  return (
    <Modal title={a ? 'Kontenjanı düzenle' : 'Yeni kontenjan'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!valid || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Acente" required className="span-2"><select className="input" value={f.agencyId} onChange={set('agencyId')} disabled={!!a} autoFocus><option value="">Seçin</option>{agencies.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Oda tipi" required className="span-2"><select className="input" value={f.roomTypeId} onChange={set('roomTypeId')}><option value="">Seçin</option>{types.data?.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>
        <Field label="İlk gece" required><input type="date" className="input" value={f.dateFrom} onChange={set('dateFrom')} /></Field>
        <Field label="Bitiş (son çıkış)" required><input type="date" className="input" value={f.dateTo} onChange={set('dateTo')} /></Field>
        <Field label="Günlük oda" required><input className="input num" value={f.rooms} onChange={e => setF(s => ({ ...s, rooms: e.target.value.replace(/\D/g, '') }))} /></Field>
        <Field label="Release (gün)" required hint="Gecenin bu kadar gün öncesinde kullanılmayan oda serbest kalır"><input className="input num" value={f.releaseDays} onChange={e => setF(s => ({ ...s, releaseDays: e.target.value.replace(/\D/g, '') }))} /></Field>
        <Field label="Not" className="span-3"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
        <div style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /> Aktif</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
