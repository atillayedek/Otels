import { useMemo, useState } from 'react';
import { BellOff, Brush, Search } from 'lucide-react';
import { api } from '../lib/api';
import { BLOCK_LABEL, fmtDate, fmtDateTime, HK_BADGE, HK_LABEL } from '../lib/format';
import { useRooms, useRoomStatus } from '../lib/queries';
import { useSession } from '../lib/session';
import type { RoomStatus } from '../lib/types';
import { PageHead } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, useToast, type Column } from '../components/ui';
import { HkStatusModal } from '../components/RoomActions';

export default function HousekeepingPage() {
  const { can } = useSession();
  const toast = useToast();
  const status = useRoomStatus();
  const rooms = useRooms();
  const [hk, setHk] = useState('');
  const [floor, setFloor] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const floors = useMemo(() => [...new Set((status.data ?? []).map(r => r.floor).filter(Boolean))] as string[], [status.data]);
  const view = (status.data ?? []).filter(r => (!hk || r.hkStatus === hk) && (!floor || r.floor === floor) && (!q || r.number.includes(q.trim())));

  const bulk = async (target: string) => {
    setBusy(true);
    let ok = 0;
    for (const id of sel) {
      const room = rooms.data?.find(r => r.id === id);
      if (!room) continue;
      try { await api('POST', `/api/v1/rooms/${id}/housekeeping`, { hkStatus: target, isDnd: room.isDnd, hkNote: room.hkNote ?? null, version: room.version }); ok++; }
      catch (e) { toast.error(`Oda ${room.number}: ${e instanceof Error ? e.message : ''}`); }
    }
    setBusy(false);
    setSel(new Set());
    if (ok) toast.ok(`${ok} odanın durumu "${HK_LABEL[target]}" yapıldı.`);
  };

  const cols: Column<RoomStatus>[] = [
    { key: 'sel', header: '', width: 34, render: r => <input type="checkbox" checked={sel.has(r.id)} onClick={e => e.stopPropagation()} onChange={e => setSel(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /> },
    { key: 'number', header: 'Oda', width: 70 },
    { key: 'floor', header: 'Kat', width: 60 },
    { key: 'roomTypeCode', header: 'Tip', width: 70 },
    { key: 'hkStatus', header: 'Temizlik', width: 130, value: r => HK_LABEL[r.hkStatus], render: r => <Badge color={HK_BADGE[r.hkStatus]}>{HK_LABEL[r.hkStatus]}</Badge> },
    { key: 'foStatus', header: 'Ön büro', width: 140, value: r => r.foStatus, render: r => <>{r.foStatus === 'occupied' ? 'Dolu' : 'Boş'}{r.departureToday ? ' · çıkış' : ''}{r.arrivalReservationId ? ' · geliş' : ''}{r.blockKind ? ` · ${BLOCK_LABEL[r.blockKind]}` : ''}</> },
    { key: 'isDnd', header: 'DND', width: 50, render: r => r.isDnd ? <BellOff size={14} color="var(--warning)" /> : null },
    { key: 'guest', header: 'Misafir', value: r => r.inHouseGuest ?? r.arrivalGuest ?? '' },
    { key: 'hkNote', header: 'Not' },
    { key: 'hkUpdatedAt', header: 'Güncelleme', width: 140, render: r => fmtDateTime(r.hkUpdatedAt) },
    { key: 'dep', header: 'Çıkış', width: 95, render: r => fmtDate(r.inHouseDeparture) },
  ];

  return (
    <div className="page">
      <PageHead title="Oda Durumları" sub="Kat hizmetleri" />
      <div className="toolbar">
        <Search size={15} className="muted" /><input className="input" style={{ width: 120 }} placeholder="Oda no" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input" style={{ width: 150 }} value={hk} onChange={e => setHk(e.target.value)}><option value="">Tüm durumlar</option>{Object.entries(HK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {floors.length > 0 && <select className="input" style={{ width: 110 }} value={floor} onChange={e => setFloor(e.target.value)}><option value="">Tüm katlar</option>{floors.map(f => <option key={f} value={f}>{f}. kat</option>)}</select>}
        {can('housekeeping.update') && sel.size > 0 && <>
          <span className="muted">{sel.size} oda seçili:</span>
          {Object.entries(HK_LABEL).filter(([k]) => k !== 'inspected' || can('housekeeping.inspect')).map(([k, l]) => <button key={k} className="btn sm" disabled={busy} onClick={() => void bulk(k)}><Brush /> {l}</button>)}
        </>}
        <span className="count">{view.length} oda</span>
      </div>
      {status.error ? <ErrorBox error={status.error} /> : (
        <DataTable rows={view} columns={cols} rowKey={r => r.id} onRowClick={r => can('housekeeping.update') && setEdit(r.id)} maxHeight="calc(100vh - 240px)"
          empty={<Empty title={status.isLoading ? 'Yükleniyor…' : 'Oda bulunmuyor'} />} />
      )}
      {edit && <HkStatusModal roomId={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
