import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarHeart, Ban, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, get, newKey, post, put, qs } from '../lib/api';
import { addDays, fmtDate, fmtDateTime } from '../lib/format';
import { useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import type { CalendarNote, CalendarNoteKind, StopSale } from '../lib/types';
import { PageHead } from '../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, Tabs, useConfirm, useToast } from '../components/ui';

export const NOTE_KIND: Record<CalendarNoteKind, string> = { special_day: 'Özel gün', sales_note: 'Satış notu' };
type Tab = 'stop' | 'special_day' | 'sales_note';

/** Stop sale, özel günler takvimi ve satış notları. */
export default function SalesCalendarPage() {
  const { can, property } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('stop');
  const [showAll, setShowAll] = useState(false);
  const [newStop, setNewStop] = useState(false);
  const [editNote, setEditNote] = useState<CalendarNote | 'new' | null>(null);
  const bd = property?.businessDate ?? '';
  const stops = useQuery({ queryKey: ['availability', 'stop-sales', showAll], queryFn: () => get<StopSale[]>(`/api/v1/stop-sales${qs({ all: showAll })}`), enabled: !!bd });
  const notes = useQuery({ queryKey: ['availability', 'calendar-notes'], queryFn: () => get<CalendarNote[]>('/api/v1/calendar-notes'), enabled: !!bd });
  const refresh = () => qc.invalidateQueries({ queryKey: ['availability'] });

  const lift = async (s: StopSale) => {
    if (!await confirm({ title: 'Satışa aç', message: `${s.roomTypeCode ?? 'Tüm oda tipleri'} · ${fmtDate(s.dateFrom)} – ${fmtDate(addDays(s.dateTo, -1))} yeniden satışa açılacak.`, confirmText: 'Satışa aç' })) return;
    try { await post(`/api/v1/stop-sales/${s.id}/lift`); await refresh(); toast.ok('Stop sale kaldırıldı.'); } catch (e) { toast.error(e); }
  };
  const removeNote = async (n: CalendarNote) => {
    if (!await confirm({ title: `${NOTE_KIND[n.kind]} sil`, message: `"${n.title}" silinecek.`, confirmText: 'Sil', danger: true })) return;
    try { await api('DELETE', `/api/v1/calendar-notes/${n.id}`); await refresh(); toast.ok('Silindi.'); } catch (e) { toast.error(e); }
  };

  const kindNotes = (notes.data ?? []).filter(n => n.kind === tab);
  return (
    <div className="page">
      <PageHead title="Satış Takvimi" sub="Stop sale (satışa kapama), özel günler ve satış notları; rezervasyon girilirken ilgili tarihlerde uyarı olarak görünür"
        actions={tab === 'stop'
          ? can('stop_sale.manage') && <button className="btn primary" onClick={() => setNewStop(true)}><Ban /> Stop sale ver</button>
          : can('calendar.manage') && <button className="btn primary" onClick={() => setEditNote('new')}><Plus /> {NOTE_KIND[tab]} ekle</button>} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'stop', label: 'Stop Sale', count: stops.data?.filter(s => s.isActive).length },
        { key: 'special_day', label: 'Özel Günler', count: notes.data?.filter(n => n.kind === 'special_day').length },
        { key: 'sales_note', label: 'Satış Notları', count: notes.data?.filter(n => n.kind === 'sales_note').length },
      ]} />
      <div className="card" style={{ borderTopLeftRadius: 0 }}>
        {tab === 'stop' ? <>
          <div className="toolbar"><label className="check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Kaldırılanları da göster</label></div>
          {stops.isLoading ? <Spinner /> : stops.error ? <ErrorBox error={stops.error} /> : !stops.data?.length
            ? <Empty icon={<Ban />} title="Satışa kapalı tarih yok" text="Stop sale verilen tarihlerde ilgili oda tipine yeni rezervasyon ve walk-in alınmaz (yetkili kullanıcı hariç)." />
            : (
              <div className="table-wrap"><table className="dt">
                <thead><tr><th>Oda tipi</th><th>Başlangıç</th><th>Bitiş (dahil)</th><th className="r">Gece</th><th>Gerekçe</th><th>Veren</th><th>Durum</th><th /></tr></thead>
                <tbody>{stops.data.map(s => (
                  <tr key={s.id} className={s.isActive ? '' : 'muted'}>
                    <td><b>{s.roomTypeCode ?? 'Tüm tipler'}</b></td>
                    <td>{fmtDate(s.dateFrom)}</td><td>{fmtDate(addDays(s.dateTo, -1))}</td>
                    <td className="r">{Math.round((Date.parse(s.dateTo) - Date.parse(s.dateFrom)) / 864e5)}</td>
                    <td>{s.reason}</td><td>{s.createdBy} · {fmtDateTime(s.createdAt)}</td>
                    <td>{s.isActive ? <Badge color="red">Satışa kapalı</Badge> : <span className="muted">Kaldırıldı ({s.closedBy}, {fmtDateTime(s.closedAt)})</span>}</td>
                    <td className="r">{s.isActive && can('stop_sale.manage') && <button className="btn sm" onClick={() => void lift(s)}>Satışa aç</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
        </> : notes.isLoading ? <Spinner /> : notes.error ? <ErrorBox error={notes.error} /> : !kindNotes.length
          ? <Empty icon={<CalendarHeart />} title={tab === 'special_day' ? 'Özel gün yok' : 'Satış notu yok'}
            text={tab === 'special_day' ? 'Bayram, fuar, konser gibi günleri ekleyin; doluluk ve rezervasyon ekranında görünür.' : 'Belirli tarihlere rezervasyon alacak herkesin bilmesi gereken notlar (ör. "en az 2 gece").'} />
          : (
            <div className="table-wrap"><table className="dt">
              <thead><tr><th>Tarih</th><th>Başlık</th><th>Açıklama</th><th>Ekleyen</th><th /></tr></thead>
              <tbody>{kindNotes.map(n => (
                <tr key={n.id}>
                  <td><i className="cal-dot" style={{ background: n.color }} />{fmtDate(n.dateFrom)}{n.dateTo !== n.dateFrom && ` – ${fmtDate(n.dateTo)}`}</td>
                  <td><b>{n.title}</b></td><td className="wrap">{n.note}</td><td>{n.createdBy}</td>
                  <td className="r nowrap">{can('calendar.manage') && <>
                    <button className="btn sm ghost icon" title="Düzenle" onClick={() => setEditNote(n)}><Pencil /></button>
                    <button className="btn sm ghost icon" title="Sil" onClick={() => void removeNote(n)}><Trash2 /></button>
                  </>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </div>
      {newStop && <StopSaleModal bd={bd} onClose={() => setNewStop(false)} onSaved={refresh} />}
      {editNote && tab !== 'stop' && <NoteModal kind={tab} note={editNote === 'new' ? null : editNote} bd={bd} onClose={() => setEditNote(null)} onSaved={refresh} />}
    </div>
  );
}

function StopSaleModal({ bd, onClose, onSaved }: { bd: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const types = useRoomTypes();
  const toast = useToast();
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState(bd);
  const [last, setLast] = useState(bd);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !!from && !!last && last >= from && !!reason.trim();
  const save = async () => {
    setBusy(true);
    try {
      // Kullanıcı son kapalı geceyi seçer; sunucu bitişi hariç tuttuğu için bir gün eklenir.
      await post('/api/v1/stop-sales', { roomTypeId: typeId || null, dateFrom: from, dateTo: addDays(last, 1), reason: reason.trim() }, newKey());
      await onSaved(); toast.ok('Stop sale verildi.'); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Stop sale ver (satışa kapat)" onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!ok || busy} onClick={() => void save()}>Satışa kapat</button>
    </>}>
      <div className="stack">
        <Field label="Oda tipi">
          <select className="input" value={typeId} onChange={e => setTypeId(e.target.value)} autoFocus>
            <option value="">Tüm oda tipleri</option>
            {types.data?.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </select>
        </Field>
        <div className="grid cols-2">
          <Field label="İlk kapalı gece" required><input className="input" type="date" min={bd} value={from} onChange={e => { setFrom(e.target.value); if (last < e.target.value) setLast(e.target.value); }} /></Field>
          <Field label="Son kapalı gece" required><input className="input" type="date" min={from} value={last} onChange={e => setLast(e.target.value)} /></Field>
        </div>
        <Field label="Gerekçe" required><input className="input" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ör. fuar bloğu, tadilat, kontenjan doldu" /></Field>
        <div className="muted" style={{ fontSize: 12 }}>Mevcut rezervasyonlar etkilenmez. Bu gecelere yeni rezervasyon, walk-in ve tarih değişikliği yalnız stop sale yetkisi olan kullanıcılarca yapılabilir.</div>
      </div>
    </Modal>
  );
}

function NoteModal({ kind, note, bd, onClose, onSaved }: { kind: CalendarNoteKind; note: CalendarNote | null; bd: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [from, setFrom] = useState(note?.dateFrom ?? bd);
  const [to, setTo] = useState(note?.dateTo ?? bd);
  const [title, setTitle] = useState(note?.title ?? '');
  const [text, setText] = useState(note?.note ?? '');
  const [color, setColor] = useState(note?.color ?? (kind === 'special_day' ? '#d97706' : '#2563eb'));
  const [busy, setBusy] = useState(false);
  const ok = !!from && !!to && to >= from && !!title.trim();
  const save = async () => {
    setBusy(true);
    const body = { kind, dateFrom: from, dateTo: to, title: title.trim(), note: text.trim() || null, color, version: note?.version };
    try {
      if (note) await put(`/api/v1/calendar-notes/${note.id}`, body); else await post('/api/v1/calendar-notes', body, newKey());
      await onSaved(); toast.ok('Kaydedildi.'); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${NOTE_KIND[kind]} ${note ? 'düzenle' : 'ekle'}`} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!ok || busy} onClick={() => void save()}>Kaydet</button>
    </>}>
      <div className="stack">
        <div className="grid cols-2">
          <Field label="Başlangıç" required><input className="input" type="date" value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
          <Field label="Bitiş (dahil)" required><input className="input" type="date" min={from} value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>
        <Field label="Başlık" required><input className="input" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder={kind === 'special_day' ? 'Ör. Kurban Bayramı, Erzurum Kış Festivali' : 'Ör. En az 2 gece satılır'} /></Field>
        <Field label="Açıklama"><textarea className="input" rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)} /></Field>
        <Field label="Renk"><input type="color" value={color} onChange={e => setColor(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Rezervasyon girilirken seçilen tarihlere değen stop sale, özel gün ve satış notları (uyarı kutusu). */
export function DateNotices({ roomTypeId, arrival, departure }: { roomTypeId?: string; arrival?: string; departure?: string }) {
  const valid = !!arrival && !!departure && departure > arrival;
  const stops = useQuery({ queryKey: ['availability', 'stop-sales', 'range', arrival, departure], enabled: valid,
    queryFn: () => get<StopSale[]>(`/api/v1/stop-sales${qs({ from: arrival, to: departure })}`) });
  const notes = useQuery({ queryKey: ['availability', 'calendar-notes', 'range', arrival, departure], enabled: valid,
    queryFn: () => get<CalendarNote[]>(`/api/v1/calendar-notes${qs({ from: arrival, to: addDays(departure!, -1) })}`) });
  if (!valid) return null;
  const st = (stops.data ?? []).filter(s => !s.roomTypeId || s.roomTypeId === roomTypeId);
  const ns = notes.data ?? [];
  if (!st.length && !ns.length) return null;
  return (
    <div className="date-notices">
      {st.map(s => <div key={s.id} className="dn stop"><Ban size={14} /> <b>Stop sale</b> {s.roomTypeCode ?? 'tüm tipler'} · {fmtDate(s.dateFrom)} – {fmtDate(addDays(s.dateTo, -1))}: {s.reason}</div>)}
      {ns.map(n => <div key={n.id} className="dn" style={{ borderLeftColor: n.color }}><b>{NOTE_KIND[n.kind]}:</b> {n.title}{n.note ? ` — ${n.note}` : ''} <span className="muted">({fmtDate(n.dateFrom)}{n.dateTo !== n.dateFrom ? ` – ${fmtDate(n.dateTo)}` : ''})</span></div>)}
    </div>
  );
}
