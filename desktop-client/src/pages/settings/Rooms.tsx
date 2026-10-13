import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Rows3 } from 'lucide-react';
import { api } from '../../lib/api';
import type { Room, RoomType } from '../../lib/types';
import { fmtMoney } from '../../lib/format';
import { useRooms, useRoomTypes } from '../../lib/queries';
import { PageHead, useAction } from '../../components/common';
import { Badge, DataTable, Empty, ErrorBox, Field, Modal, MoneyInput, useToast, type Column } from '../../components/ui';

export default function RoomsSettingsPage() {
  const types = useRoomTypes();
  const rooms = useRooms();
  const [type, setType] = useState<RoomType | 'new' | null>(null);
  const [room, setRoom] = useState<Room | 'new' | null>(null);
  const [bulk, setBulk] = useState(false);

  const tcols: Column<RoomType>[] = [
    { key: 'code', header: 'Kod', width: 80 }, { key: 'name', header: 'Ad' },
    { key: 'cap', header: 'Kapasite', width: 100, value: t => `${t.maxAdults}+${t.maxChildren}` },
    { key: 'defaultRate', header: 'Varsayılan fiyat', align: 'right', width: 130, render: t => fmtMoney(t.defaultRate) },
    { key: 'roomCount', header: 'Oda', align: 'right', width: 60 },
    { key: 'isActive', header: 'Durum', width: 80, render: t => t.isActive ? <Badge color="green">Aktif</Badge> : <Badge color="gray">Pasif</Badge> },
  ];
  const rcols: Column<Room>[] = [
    { key: 'number', header: 'Oda no', width: 80, filter: true }, { key: 'roomTypeCode', header: 'Tip', width: 80, filter: true },
    { key: 'floor', header: 'Kat', width: 60, filter: true }, { key: 'description', header: 'Açıklama' }, { key: 'features', header: 'Özellikler' },
    { key: 'isActive', header: 'Durum', width: 80, render: r => r.isActive ? <Badge color="green">Aktif</Badge> : <Badge color="gray">Pasif</Badge> },
  ];

  return (
    <div className="page">
      <PageHead title="Oda ve Oda Tipleri" />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Oda tipleri</h3><div className="right"><button className="btn sm primary" onClick={() => setType('new')}><Plus /> Oda tipi</button></div></div>
          <div className="card-body tight"><DataTable rows={types.data ?? []} columns={tcols} rowKey={t => t.id} onRowClick={setType} empty={<Empty title="Henüz oda tipi yok" text="Önce oda tiplerini (Standart, Deluxe…) ekleyin." />} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Odalar ({rooms.data?.length ?? 0})</h3><div className="right">
            <button className="btn sm" disabled={!types.data?.length} onClick={() => setBulk(true)}><Rows3 /> Toplu ekle</button>
            <button className="btn sm primary" disabled={!types.data?.length} onClick={() => setRoom('new')}><Plus /> Oda</button>
          </div></div>
          <div className="card-body tight"><DataTable rows={rooms.data ?? []} columns={rcols} rowKey={r => r.id} onRowClick={setRoom} maxHeight="calc(100vh - 260px)" empty={<Empty title="Henüz oda yok" />} /></div>
        </div>
      </div>
      {type && <TypeModal t={type === 'new' ? undefined : type} onClose={() => setType(null)} />}
      {room && <RoomModal r={room === 'new' ? undefined : room} onClose={() => setRoom(null)} />}
      {bulk && <BulkModal onClose={() => setBulk(false)} />}
    </div>
  );
}

function TypeModal({ t, onClose }: { t?: RoomType; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: t?.code ?? '', name: t?.name ?? '', description: t?.description ?? '', maxAdults: t?.maxAdults ?? 2, maxChildren: t?.maxChildren ?? 1, defaultRate: t?.defaultRate ?? '', sortOrder: t?.sortOrder ?? 0, isActive: t?.isActive ?? true });
  const save = useAction(async () => {
    const body = { ...f, code: f.code.trim().toUpperCase(), description: f.description || null, version: t?.version ?? null };
    if (t) await api('PUT', `/api/v1/room-types/${t.id}`, body); else await api('POST', '/api/v1/room-types', body);
    await qc.invalidateQueries({ queryKey: ['rooms'] });
  }, { success: 'Oda tipi kaydedildi.' });
  return (
    <Modal title={t ? `Oda tipi · ${t.code}` : 'Yeni oda tipi'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.code.trim() || !f.name.trim() || !f.defaultRate || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Kod" required><input className="input" value={f.code} onChange={e => setF(s => ({ ...s, code: e.target.value }))} maxLength={10} autoFocus /></Field>
        <Field label="Ad" required className="span-3"><input className="input" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="Yetişkin kapasitesi"><input type="number" min={1} className="input" value={f.maxAdults} onChange={e => setF(s => ({ ...s, maxAdults: Number(e.target.value) }))} /></Field>
        <Field label="Çocuk kapasitesi"><input type="number" min={0} className="input" value={f.maxChildren} onChange={e => setF(s => ({ ...s, maxChildren: Number(e.target.value) }))} /></Field>
        <Field label="Varsayılan gecelik fiyat" required className="span-2"><MoneyInput value={f.defaultRate} onChange={v => setF(s => ({ ...s, defaultRate: v }))} /></Field>
        <Field label="Açıklama" className="span-3"><input className="input" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></Field>
        <Field label="Sıra"><input type="number" className="input" value={f.sortOrder} onChange={e => setF(s => ({ ...s, sortOrder: Number(e.target.value) }))} /></Field>
        <div className="span-4"><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif (satışa açık)</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function RoomModal({ r, onClose }: { r?: Room; onClose: () => void }) {
  const qc = useQueryClient();
  const types = useRoomTypes();
  const [f, setF] = useState({ roomTypeId: r?.roomTypeId ?? types.data?.[0]?.id ?? '', number: r?.number ?? '', floor: r?.floor ?? '', description: r?.description ?? '', features: r?.features ?? '', sortOrder: r?.sortOrder ?? 0, isActive: r?.isActive ?? true });
  const save = useAction(async () => {
    const body = { ...f, number: f.number.trim(), floor: f.floor || null, description: f.description || null, features: f.features || null, version: r?.version ?? null };
    if (r) await api('PUT', `/api/v1/rooms/${r.id}`, body); else await api('POST', '/api/v1/rooms', body);
    await qc.invalidateQueries({ queryKey: ['rooms'] });
    await qc.invalidateQueries({ queryKey: ['roomStatus'] });
  }, { success: 'Oda kaydedildi.' });
  return (
    <Modal title={r ? `Oda ${r.number}` : 'Yeni oda'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={!f.number.trim() || !f.roomTypeId || save.busy} onClick={async () => { if (await save.run() !== undefined) onClose(); }}>Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Oda no" required><input className="input" value={f.number} onChange={e => setF(s => ({ ...s, number: e.target.value }))} maxLength={10} autoFocus /></Field>
        <Field label="Oda tipi" required className="span-2"><select className="input" value={f.roomTypeId} onChange={e => setF(s => ({ ...s, roomTypeId: e.target.value }))}>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>
        <Field label="Kat"><input className="input" value={f.floor} onChange={e => setF(s => ({ ...s, floor: e.target.value }))} maxLength={10} /></Field>
        <Field label="Açıklama" className="span-2"><input className="input" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} /></Field>
        <Field label="Özellikler" className="span-2"><input className="input" value={f.features} onChange={e => setF(s => ({ ...s, features: e.target.value }))} placeholder="Deniz manzarası, balkon…" /></Field>
        <Field label="Sıra"><input type="number" className="input" value={f.sortOrder} onChange={e => setF(s => ({ ...s, sortOrder: Number(e.target.value) }))} /></Field>
        <div className="span-3" style={{ alignSelf: 'end' }}><label className="check"><input type="checkbox" checked={f.isActive} onChange={e => setF(s => ({ ...s, isActive: e.target.checked }))} /> Aktif</label></div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** Kat bazında ardışık oda numaraları (ör. 101–120) oluşturur. */
function BulkModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useRoomTypes();
  const rooms = useRooms();
  const [f, setF] = useState({ roomTypeId: types.data?.[0]?.id ?? '', floor: '1', from: '101', to: '110' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const nums = (() => { const a = Number(f.from), b = Number(f.to); if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 199) return []; return Array.from({ length: b - a + 1 }, (_, i) => String(a + i)); })();
  const existing = new Set(rooms.data?.map(r => r.number));
  const run = async () => {
    setBusy(true);
    const ok: string[] = [];
    for (const n of nums) {
      if (existing.has(n)) continue;
      try { await api('POST', '/api/v1/rooms', { roomTypeId: f.roomTypeId, number: n, floor: f.floor || null, description: null, features: null, sortOrder: Number(n), isActive: true, version: null }); ok.push(n); }
      catch (e) { toast.error(`Oda ${n}: ${e instanceof Error ? e.message : ''}`); break; }
    }
    setDone(ok);
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ['rooms'] });
    await qc.invalidateQueries({ queryKey: ['roomStatus'] });
    if (ok.length) toast.ok(`${ok.length} oda eklendi.`);
  };
  return (
    <Modal title="Toplu oda ekle" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Kapat</button><button className="btn primary" disabled={busy || nums.length === 0 || !f.roomTypeId} onClick={() => void run()}>{busy ? 'Ekleniyor…' : `${nums.filter(n => !existing.has(n)).length} oda ekle`}</button></>}>
      <div className="form-grid">
        <Field label="Oda tipi" required className="span-2"><select className="input" value={f.roomTypeId} onChange={e => setF(s => ({ ...s, roomTypeId: e.target.value }))}>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>
        <Field label="Kat"><input className="input" value={f.floor} onChange={e => setF(s => ({ ...s, floor: e.target.value }))} /></Field>
        <div />
        <Field label="İlk oda no" required><input className="input" value={f.from} onChange={e => setF(s => ({ ...s, from: e.target.value.replace(/\D/g, '') }))} /></Field>
        <Field label="Son oda no" required><input className="input" value={f.to} onChange={e => setF(s => ({ ...s, to: e.target.value.replace(/\D/g, '') }))} /></Field>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{nums.length ? `${nums[0]}–${nums[nums.length - 1]} arası; mevcut numaralar atlanır.` : 'Geçerli bir aralık girin (en fazla 200 oda).'}</div>
      {done.length > 0 && <div className="ok-box" style={{ marginTop: 8 }}>Eklenen odalar: {done.join(', ')}</div>}
    </Modal>
  );
}
