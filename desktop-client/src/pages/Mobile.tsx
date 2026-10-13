import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Brush, ClipboardList, LogOut, RefreshCw, Wrench } from 'lucide-react';
import { api, get, qs } from '../lib/api';
import type { HkTask, Room, RoomStatus } from '../lib/types';
import { BLOCK_LABEL, fmtDate, HK_LABEL, TASK_LABEL, TASK_STATUS } from '../lib/format';
import { useRooms, useRoomStatus } from '../lib/queries';
import { useSession } from '../lib/session';
import { Empty, ErrorBox, Modal, Spinner, useToast } from '../components/ui';
import { TicketModal } from '../components/RoomActions';

type Filter = 'dirty' | 'cleaning' | 'clean' | 'all';

/** Telefon arayüzü: kat şefi, kat görevlisi, resepsiyon ve müdür için oda temizlik durumları ve görevler. */
export function MobileApp() {
  const { me, property, connected, can, logout } = useSession();
  const [tab, setTab] = useState<'rooms' | 'tasks'>('rooms');
  const qc = useQueryClient();
  return (
    <div className="m-shell">
      <header className="m-top">
        <div><b>{property?.name}</b><small>{me?.fullName} · İş günü {fmtDate(property?.businessDate)}</small></div>
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? 'Bağlı' : 'Bağlantı yok'} />
        <button className="btn ghost icon" aria-label="Yenile" onClick={() => void qc.invalidateQueries()}><RefreshCw /></button>
        <button className="btn ghost icon" aria-label="Çıkış" onClick={() => void logout()}><LogOut /></button>
      </header>
      {!connected && <div className="banner danger">Sunucu bağlantısı yok; yeniden bağlanılıyor…</div>}
      <main className="m-main">
        {!can('housekeeping.view')
          ? <Empty title="Bu ekran için yetkiniz yok" text="Telefon uygulaması kat hizmetleri yetkisi olan kullanıcılar içindir." />
          : tab === 'rooms' ? <MobileRooms /> : <MobileTasks />}
      </main>
      <nav className="m-tabs">
        <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}><Brush /><span>Odalar</span></button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><ClipboardList /><span>Görevler</span></button>
      </nav>
    </div>
  );
}

function MobileRooms() {
  const status = useRoomStatus();
  const [filter, setFilter] = useState<Filter>('dirty');
  const [floor, setFloor] = useState('');
  const [sel, setSel] = useState<RoomStatus | null>(null);
  const rooms = useMemo(() => status.data ?? [], [status.data]);
  const floors = useMemo(() => [...new Set(rooms.map(r => r.floor).filter(Boolean))] as string[], [rooms]);
  const count = (f: Filter) => rooms.filter(r => f === 'all' || r.hkStatus === f || (f === 'clean' && r.hkStatus === 'inspected')).length;
  const view = rooms
    .filter(r => filter === 'all' || r.hkStatus === filter || (filter === 'clean' && r.hkStatus === 'inspected'))
    .filter(r => !floor || r.floor === floor)
    // Önce bugün çıkış yapanlar ve gelişi olan odalar: bunlar öncelikli temizlenir.
    .sort((a, b) => Number(!!b.arrivalReservationId) - Number(!!a.arrivalReservationId) || Number(b.departureToday) - Number(a.departureToday) || a.number.localeCompare(b.number, 'tr', { numeric: true }));

  if (status.isLoading) return <Spinner />;
  if (status.error) return <ErrorBox error={status.error} />;
  return (
    <>
      <div className="m-filters">
        {([['dirty', 'Kirli'], ['cleaning', 'Temizleniyor'], ['clean', 'Temiz'], ['all', 'Tümü']] as [Filter, string][]).map(([k, l]) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l} <b>{count(k)}</b></button>
        ))}
      </div>
      {floors.length > 1 && (
        <div className="m-filters">
          <button className={!floor ? 'active' : ''} onClick={() => setFloor('')}>Tüm katlar</button>
          {floors.map(f => <button key={f} className={floor === f ? 'active' : ''} onClick={() => setFloor(f)}>{f}. kat</button>)}
        </div>
      )}
      {view.length === 0 ? <Empty title={filter === 'dirty' ? 'Kirli oda yok' : 'Bu filtrede oda yok'} /> : (
        <div className="m-grid">
          {view.map(r => (
            <button key={r.id} className={`m-room ${r.blockKind ? 'hk-ooo' : `hk-${r.hkStatus}`}`} onClick={() => setSel(r)}>
              <span className="m-no">{r.number}</span>
              <span className="m-st">{r.blockKind ? BLOCK_LABEL[r.blockKind] : HK_LABEL[r.hkStatus]}</span>
              <span className="m-info">
                {r.foStatus === 'occupied' ? 'Dolu' : 'Boş'}{r.departureToday ? ' · çıkış' : ''}{r.arrivalReservationId ? ' · geliş var' : ''}
                {r.isDnd && <BellOff size={13} />}{r.openTickets > 0 && <Wrench size={13} />}
              </span>
            </button>
          ))}
        </div>
      )}
      {sel && <RoomSheet roomId={sel.id} status={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function RoomSheet({ roomId, status, onClose }: { roomId: string; status: RoomStatus; onClose: () => void }) {
  const rooms = useRooms();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(false);
  const room: Room | undefined = rooms.data?.find(r => r.id === roomId);
  const set = async (hk: string, dnd?: boolean) => {
    if (!room) return;
    setBusy(true);
    try {
      await api('POST', `/api/v1/rooms/${roomId}/housekeeping`, { hkStatus: hk, isDnd: dnd ?? room.isDnd, hkNote: room.hkNote ?? null, version: room.version });
      await qc.invalidateQueries({ queryKey: ['rooms'] });
      await qc.invalidateQueries({ queryKey: ['roomStatus'] });
      toast.ok(`Oda ${room.number}: ${HK_LABEL[hk]}`);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  if (ticket) return <TicketModal roomId={roomId} onClose={onClose} />;
  return (
    <Modal title={`Oda ${status.number} · ${HK_LABEL[status.hkStatus]}`} onClose={onClose}>
      <div className="m-actions">
        {status.inHouseGuest && <div className="muted">Misafir: {status.inHouseGuest}{status.inHouseDeparture ? ` · çıkış ${fmtDate(status.inHouseDeparture)}` : ''}</div>}
        {status.hkNote && <div className="info-box">{status.hkNote}</div>}
        {can('housekeeping.update') && <>
          <button className="btn success big" disabled={busy || !room} onClick={() => void set('clean')}>Temiz</button>
          <button className="btn big" disabled={busy || !room} onClick={() => void set('cleaning')}>Temizleniyor</button>
          {can('housekeeping.inspect') && <button className="btn big" disabled={busy || !room} onClick={() => void set('inspected')}>Kontrol edildi</button>}
          <button className="btn big" disabled={busy || !room} onClick={() => void set('dirty')}>Kirli</button>
          <button className="btn big" disabled={busy || !room} onClick={() => void set(room?.hkStatus ?? status.hkStatus, !(room?.isDnd ?? status.isDnd))}><BellOff /> {(room?.isDnd ?? status.isDnd) ? 'Rahatsız etmeyin kaldır' : 'Rahatsız etmeyin'}</button>
        </>}
        {can('maintenance.report') && <button className="btn big" onClick={() => setTicket(true)}><Wrench /> Arıza bildir</button>}
      </div>
    </Modal>
  );
}

function MobileTasks() {
  const { property, me, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [mine, setMine] = useState(!can('housekeeping.assign'));
  const tasks = useQuery({ queryKey: ['hk', 'tasks', property?.businessDate, 'mobile'], queryFn: () => get<HkTask[]>(`/api/v1/housekeeping/tasks${qs({ date: property?.businessDate })}`) });
  const view = (tasks.data ?? []).filter(t => t.status !== 'cancelled' && (!mine || t.assignedUserId === me?.id));
  const update = async (t: HkTask, status: string) => {
    try {
      await api('PUT', `/api/v1/housekeeping/tasks/${t.id}`, { status, assignedUserId: t.assignedUserId ?? null, notes: t.notes ?? null, version: t.version });
      await qc.invalidateQueries({ queryKey: ['hk'] });
      await qc.invalidateQueries({ queryKey: ['roomStatus'] });
      toast.ok(`Oda ${t.roomNumber}: ${TASK_STATUS[status]}`);
    } catch (e) { toast.error(e); }
  };
  if (tasks.isLoading) return <Spinner />;
  if (tasks.error) return <ErrorBox error={tasks.error} />;
  return (
    <>
      <div className="m-filters">
        <button className={mine ? 'active' : ''} onClick={() => setMine(true)}>Bana atananlar</button>
        <button className={!mine ? 'active' : ''} onClick={() => setMine(false)}>Tüm görevler</button>
      </div>
      {view.length === 0 ? <Empty title="Bugün görev yok" /> : (
        <ul className="m-list">
          {view.map(t => (
            <li key={t.id}>
              <div><b>Oda {t.roomNumber}</b> · {TASK_LABEL[t.taskType] ?? t.taskType}<small>{TASK_STATUS[t.status]}{t.assignedTo ? ` · ${t.assignedTo}` : ''}{t.notes ? ` · ${t.notes}` : ''}</small></div>
              {can('housekeeping.update') && t.status === 'open' && <button className="btn" onClick={() => void update(t, 'in_progress')}>Başla</button>}
              {can('housekeeping.update') && t.status !== 'done' && <button className="btn success" onClick={() => void update(t, 'done')}>Bitti</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
