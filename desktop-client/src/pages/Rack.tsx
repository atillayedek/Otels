import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedDouble, BellOff, Brush, ClipboardList, Crown, FileText, LogIn, Search, UserPlus, Wrench } from 'lucide-react';
import { useRoomStatus, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { BLOCK_LABEL, fmtDate, HK_LABEL } from '../lib/format';
import type { RoomStatus } from '../lib/types';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Spinner, useContextMenu, type MenuItem } from '../components/ui';
import { HkStatusModal, TicketModal } from '../components/RoomActions';

type Filter = 'all' | 'vacant' | 'occupied' | 'arrival' | 'departure' | 'dirty' | 'blocked';

function tileClass(r: RoomStatus) {
  if (r.blockKind) return 'hk-ooo';
  return `hk-${r.hkStatus}`;
}

export default function RackPage() {
  const nav = useNavigate();
  const { can, property } = useSession();
  const status = useRoomStatus();
  const types = useRoomTypes();
  const menu = useContextMenu();
  const [filter, setFilter] = useState<Filter>('all');
  const [typeId, setTypeId] = useState('');
  const [floor, setFloor] = useState('');
  const [q, setQ] = useState('');
  const [hkRoom, setHkRoom] = useState<string | null>(null);
  const [ticketRoom, setTicketRoom] = useState<string | null>(null);

  const rooms = useMemo(() => status.data ?? [], [status.data]);
  const floors = useMemo(() => [...new Set(rooms.map(r => r.floor).filter(Boolean))] as string[], [rooms]);
  const counts = useMemo(() => ({
    all: rooms.length,
    vacant: rooms.filter(r => r.foStatus === 'vacant' && !r.blockKind).length,
    occupied: rooms.filter(r => r.foStatus === 'occupied').length,
    arrival: rooms.filter(r => r.arrivalReservationId).length,
    departure: rooms.filter(r => r.departureToday).length,
    dirty: rooms.filter(r => r.hkStatus === 'dirty').length,
    blocked: rooms.filter(r => r.blockKind).length,
  }), [rooms]);

  const view = rooms.filter(r => {
    if (typeId && r.roomTypeId !== typeId) return false;
    if (floor && r.floor !== floor) return false;
    const needle = q.trim().toLocaleLowerCase('tr-TR');
    if (needle && !r.number.toLocaleLowerCase('tr-TR').includes(needle) && !(r.inHouseGuest ?? '').toLocaleLowerCase('tr-TR').includes(needle) && !(r.arrivalGuest ?? '').toLocaleLowerCase('tr-TR').includes(needle)) return false;
    switch (filter) {
      case 'vacant': return r.foStatus === 'vacant' && !r.blockKind;
      case 'occupied': return r.foStatus === 'occupied';
      case 'arrival': return !!r.arrivalReservationId;
      case 'departure': return r.departureToday;
      case 'dirty': return r.hkStatus === 'dirty';
      case 'blocked': return !!r.blockKind;
      default: return true;
    }
  });

  const items = (r: RoomStatus): MenuItem[] => [
    ...(r.inHouseReservationId ? [{ label: 'Konaklamayı aç', icon: <FileText size={14} />, onClick: () => nav(`/reservations/${r.inHouseReservationId}`) }] : []),
    ...(r.arrivalReservationId ? [{ label: `Gelişi aç (${r.arrivalGuest})`, icon: <LogIn size={14} />, onClick: () => nav(`/reservations/${r.arrivalReservationId}`) }] : []),
    ...(r.foStatus === 'vacant' && !r.blockKind && can('checkin.execute') ? [{ label: 'Walk-in giriş', icon: <UserPlus size={14} />, onClick: () => nav(`/walk-in?room=${r.id}`) }] : []),
    ...(r.foStatus === 'vacant' && can('reservation.create') ? [{ label: 'Bu odaya rezervasyon', icon: <ClipboardList size={14} />, onClick: () => nav(`/reservations/new?room=${r.id}&type=${r.roomTypeId}`) }] : []),
    { separator: true, label: '' },
    { label: 'Temizlik durumu', icon: <Brush size={14} />, onClick: () => setHkRoom(r.id), disabled: !can('housekeeping.update') },
    { label: 'Arıza kaydı aç', icon: <Wrench size={14} />, onClick: () => setTicketRoom(r.id), disabled: !can('maintenance.manage') },
  ];

  const F = (k: Filter, label: string) => <button className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label} ({counts[k]})</button>;

  return (
    <div className="page">
      <PageHead title="Oda Rack" sub={`İş günü ${fmtDate(property?.businessDate)}`} actions={<>
        {can('checkin.execute') && <button className="btn" onClick={() => nav('/walk-in')}><UserPlus /> Walk-in</button>}
        {can('reservation.create') && <button className="btn primary" onClick={() => nav('/reservations/new')}><ClipboardList /> Yeni rezervasyon</button>}
      </>} />

      <div className="row wrap" style={{ marginBottom: 12, gap: 10 }}>
        <div className="seg">{F('all', 'Tümü')}{F('vacant', 'Boş')}{F('occupied', 'Dolu')}{F('arrival', 'Geliş')}{F('departure', 'Çıkış')}{F('dirty', 'Kirli')}{F('blocked', 'Bloke')}</div>
        <select className="input" style={{ width: 160 }} value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">Tüm oda tipleri</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select>
        {floors.length > 0 && <select className="input" style={{ width: 110 }} value={floor} onChange={e => setFloor(e.target.value)}><option value="">Tüm katlar</option>{floors.map(f => <option key={f} value={f}>{f}. kat</option>)}</select>}
        <div className="row" style={{ gap: 6 }}><Search size={15} className="muted" /><input className="input" style={{ width: 200 }} placeholder="Oda no veya misafir" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="legend" style={{ marginLeft: 'auto' }}>
          <span><i className="hk-clean" />Temiz</span><span><i className="hk-dirty" />Kirli</span><span><i className="hk-inspected" />Kontrol edildi</span><span><i className="hk-cleaning" />Temizleniyor</span><span><i className="hk-ooo" />Bloke</span>
        </div>
      </div>

      {status.isLoading ? <Spinner /> : status.error ? <ErrorBox error={status.error} /> : rooms.length === 0 ? (
        <Empty icon={<BedDouble />} title="Henüz oda tanımlanmamış" text="Odaları Yönetim → Oda ve Oda Tipleri ekranından ekleyin." action={can('room.manage') ? <button className="btn primary" onClick={() => nav('/settings/rooms')}>Oda tanımla</button> : undefined} />
      ) : view.length === 0 ? <Empty title="Bu filtreye uyan oda yok" /> : (
        <div className="rack-grid">
          {view.map(r => (
            <div key={r.id} className={`room-tile ${r.foStatus === 'occupied' ? 'occupied' : ''}`} style={{ position: 'relative' }}
              onClick={e => menu.open(e, items(r))} onContextMenu={e => menu.open(e, items(r))}
              onDoubleClick={() => { const id = r.inHouseReservationId ?? r.arrivalReservationId; if (id) nav(`/reservations/${id}`); }}>
              <div className={`rt-head ${tileClass(r)}`}>
                <span>{r.blockKind ? BLOCK_LABEL[r.blockKind] : HK_LABEL[r.hkStatus]}</span>
                <span>{r.foStatus === 'occupied' ? 'DOLU' : 'BOŞ'}</span>
              </div>
              <div className="rt-icons">
                {r.isVip && <Crown size={13} />}
                {r.isDnd && <BellOff size={13} />}
                {r.openTickets > 0 && <Wrench size={13} />}
              </div>
              <div className="rt-body">
                <div className="rt-no">{r.number}</div>
                <div className="rt-type">{r.roomTypeCode}{r.floor ? ` · ${r.floor}. kat` : ''}</div>
              </div>
              <div className="rt-foot" title={r.inHouseGuest ?? r.arrivalGuest ?? r.blockReason ?? ''}>
                {r.inHouseGuest ? <>{r.inHouseGuest}<br /><span className="muted">Çıkış {fmtDate(r.inHouseDeparture)}{r.departureToday ? ' · bugün' : ''}</span></>
                  : r.arrivalGuest ? <><b style={{ color: 'var(--st-arrival)' }}>Geliş:</b> {r.arrivalGuest}</>
                  : r.blockReason ? <span className="muted">{r.blockReason}</span>
                  : <span className="muted">—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {menu.node}
      {hkRoom && <HkStatusModal roomId={hkRoom} onClose={() => setHkRoom(null)} />}
      {ticketRoom && <TicketModal roomId={ticketRoom} onClose={() => setTicketRoom(null)} />}
    </div>
  );
}
