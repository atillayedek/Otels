import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, newKey, post } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { useTransactionCodes } from '../lib/queries';
import type { Reservation, RoomStatus } from '../lib/types';
import { CodePicker } from './CodePicker';
import { Field, Modal, MoneyInput, useToast } from './ui';

const refreshRack = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ predicate: q => ['roomStatus', 'rooms', 'rack', 'reservation', 'reservations', 'folios', 'folio', 'dashboard'].includes(String(q.queryKey[0])) });

const roomList = (rooms: RoomStatus[]) => rooms.map(r => r.number).join(', ');

/** Seçili odalara aynı kat notu (boş bırakılırsa notlar silinir). */
export function BulkNoteModal({ rooms, onClose }: { rooms: RoomStatus[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/v1/rooms/bulk-housekeeping', { roomIds: rooms.map(r => r.id), setNote: true, hkNote: note.trim() || null, setGroup: false });
      await refreshRack(qc);
      toast.ok(note.trim() ? `${rooms.length} odaya not yazıldı.` : `${rooms.length} odanın notu silindi.`);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Toplu oda notu · ${rooms.length} oda`} onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={busy} onClick={() => void save()}>{note.trim() ? 'Notu yaz' : 'Notları sil'}</button>
    </>}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12 }}>Odalar: {roomList(rooms)}</div>
        <Field label="Oda durum notu" hint="Boş bırakırsanız seçili odaların notu silinir.">
          <textarea className="input" rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

/** Seçili konaklayan odalara aynı masraf; tek işlemde yazılır, bir oda reddedilirse hiçbirine yazılmaz. */
export function BulkChargeModal({ rooms, onClose }: { rooms: RoomStatus[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const codes = useTransactionCodes();
  const targets = rooms.filter(r => r.inHouseReservationId);
  const skipped = rooms.length - targets.length;
  const [codeId, setCodeId] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const list = codes.data?.filter(c => c.isActive && c.category !== 'room' && c.category !== 'tax') ?? [];
  const q = Number(qty.replace(',', '.'));
  const each = Math.round(q * Number(price) * 100) / 100;
  const cur = targets[0]?.inHouseCurrency;
  const currencies = [...new Set(targets.map(t => t.inHouseCurrency ?? ''))];
  const ok = targets.length > 0 && currencies.length === 1 && !!codeId && q > 0 && Number(price) > 0;
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ count: number }>('/api/v1/folios/bulk-charge', {
        reservationIds: targets.map(t => t.inHouseReservationId), transactionCodeId: codeId, description: desc.trim() || null,
        quantity: qty.replace(',', '.'), unitPrice: price, reference: reference.trim() || null,
      }, newKey());
      await refreshRack(qc);
      toast.ok(`${r.count} odaya masraf yazıldı.`);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Toplu masraf · ${targets.length} oda`} size="lg" onClose={onClose} footer={<>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Vazgeç</button>
      <button className="btn primary" disabled={!ok || busy} onClick={() => void save()}>{targets.length} odaya yaz</button>
    </>}>
      <div className="stack">
        <div className="muted" style={{ fontSize: 12 }}>
          Odalar: {roomList(targets) || '—'}{skipped > 0 && <> · {skipped} oda konaklayan olmadığı için atlanacak</>}
        </div>
        {currencies.length > 1 && <div className="info-box">Seçili odalar farklı para birimlerinde ({currencies.join(', ')}). Aynı tutar her odaya kendi para biriminde yazılacağı için toplu masrafı aynı para birimindeki odaları seçerek yapın.</div>}
        <Field label="Departman / işlem kodu" required>
          <CodePicker codes={list} value={codeId} autoFocus onChange={id => { setCodeId(id); const c = list.find(x => x.id === id); if (c?.defaultPrice && !price) setPrice(c.defaultPrice); }} />
        </Field>
        <Field label="Açıklama" hint="Boş bırakılırsa işlem kodunun adı yazılır.">
          <input className="input" maxLength={300} value={desc} onChange={e => setDesc(e.target.value)} />
        </Field>
        <div className="grid cols-3">
          <Field label="Miktar" required><input className="input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></Field>
          <Field label="Birim fiyat" required><MoneyInput value={price} onChange={setPrice} /></Field>
          <Field label="Belge / not"><input className="input" maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></Field>
        </div>
        {each > 0 && <div className="info-box">Oda başına <b>{fmtMoney(String(each), cur)}</b>, toplam <b>{fmtMoney(String(Math.round(each * targets.length * 100) / 100), cur)}</b>.
          Ana folyoya bağlı odaların masrafı ana odaya yazılır. Bir odada kural engeli (manuel harcama yasağı, kredi limiti) varsa hiçbir odaya yazılmaz ve o oda gösterilir.</div>}
      </div>
    </Modal>
  );
}

type CoResult = { room: string; ok: boolean; msg: string };

/** Seçili odalardan bakiyesi sıfır olanların çıkışı sırayla yapılır; bakiyesi olan odalar atlanır. */
export function BulkCheckoutModal({ rooms, onClose }: { rooms: RoomStatus[]; onClose: () => void }) {
  const qc = useQueryClient();
  const inhouse = rooms.filter(r => r.inHouseReservationId);
  const ready = inhouse.filter(r => Number(r.inHouseBalance ?? 0) === 0);
  const due = inhouse.filter(r => Number(r.inHouseBalance ?? 0) !== 0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CoResult[] | null>(null);
  const run = async () => {
    setBusy(true);
    const out: CoResult[] = [];
    for (const r of ready) {
      try {
        const res = await get<Reservation>(`/api/v1/reservations/${r.inHouseReservationId}`);
        await post(`/api/v1/reservations/${res.id}/check-out`, { version: res.version, lateCheckOut: false, waiveDayUse: false, waiveReason: null }, newKey());
        out.push({ room: r.number, ok: true, msg: 'Çıkış yapıldı.' });
      } catch (e) {
        out.push({ room: r.number, ok: false, msg: e instanceof Error ? e.message : String(e) });
      }
      setResults([...out]);
    }
    await refreshRack(qc);
    setBusy(false);
  };
  const done = results?.filter(x => x.ok).length ?? 0;
  return (
    <Modal title={`Toplu çıkış (check-out) · ${ready.length} oda`} size="lg" onClose={() => !busy && onClose()} footer={<>
      <span className="spacer" />
      {results && !busy ? <button className="btn primary" onClick={onClose}>Kapat</button> : <>
        <button className="btn" disabled={busy} onClick={onClose}>Vazgeç</button>
        <button className="btn primary" disabled={busy || ready.length === 0} onClick={() => void run()}>{busy ? 'Çıkışlar yapılıyor…' : `${ready.length} odanın çıkışını yap`}</button>
      </>}
    </>}>
      <div className="stack">
        {!results && <>
          <div>Bakiyesi sıfır olan odalar: <b>{roomList(ready) || '—'}</b></div>
          {due.length > 0 && <div className="info-box">Bakiyesi olan odalar atlanacak (önce tahsilat veya aktarım gerekir): {due.map(r => `${r.number} (${fmtMoney(r.inHouseBalance!, r.inHouseCurrency)})`).join(', ')}</div>}
          {rooms.length > inhouse.length && <div className="muted" style={{ fontSize: 12 }}>{rooms.length - inhouse.length} seçili oda konaklayan olmadığı için atlanacak.</div>}
          <div className="muted" style={{ fontSize: 12 }}>Her oda ayrı ayrı çıkarılır; bir odada engel çıkarsa (ana folyo, günübirlik ücret gibi) o oda atlanır ve nedeni aşağıda yazar.</div>
        </>}
        {results && <>
          <div><b>{done}</b> oda çıkış yaptı{results.length - done > 0 && <>, <b>{results.length - done}</b> odada çıkış yapılamadı</>}.</div>
          <table className="table">
            <thead><tr><th>Oda</th><th>Sonuç</th></tr></thead>
            <tbody>{results.map(x => <tr key={x.room}><td><b>{x.room}</b></td><td style={x.ok ? undefined : { color: "var(--danger)" }}>{x.msg}</td></tr>)}</tbody>
          </table>
        </>}
      </div>
    </Modal>
  );
}
