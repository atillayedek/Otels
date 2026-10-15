import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock, ArrowRightLeft, BedDouble, BellOff, Brush, CalendarClock, ClipboardList, CreditCard, Crown, FileText, Lock, LogIn, LogOut, Minus,
  NotebookPen, Plus, Printer, Search, StickyNote, UserPlus, Utensils, Wrench,
} from 'lucide-react';
import { useRoomStatus, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { BLOCK_LABEL, fmtDate, fmtDateTime, fmtMoney, HK_LABEL } from '../lib/format';
import type { RoomStatus } from '../lib/types';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Spinner, useContextMenu, type MenuItem } from '../components/ui';
import { HkStatusModal, TicketModal } from '../components/RoomActions';
import { DocFooter, DocHeader } from '../components/PrintDoc';

type Filter = 'all' | 'vacant' | 'occupied' | 'arrival' | 'departure' | 'dirty' | 'blocked';
type Size = 's' | 'm' | 'l';

function tileClass(r: RoomStatus) {
  if (r.blockKind) return 'hk-ooo';
  return `hk-${r.hkStatus}`;
}

const SIZE_KEY = 'pms-rack-size';
const readSize = (): Size => { try { const v = localStorage.getItem(SIZE_KEY); return v === 's' || v === 'l' ? v : 'm'; } catch { return 'm'; } };
const saveSize = (s: Size) => { try { localStorage.setItem(SIZE_KEY, s); } catch { /* tarayıcı depolaması kapalı olabilir */ } };

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
const localDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');

export default function RackPage() {
  const nav = useNavigate();
  const { can, property } = useSession();
  const status = useRoomStatus();
  const types = useRoomTypes();
  const menu = useContextMenu();
  const [filter, setFilter] = useState<Filter>('all');
  const [typeId, setTypeId] = useState('');
  const [floor, setFloor] = useState('');
  const [account, setAccount] = useState('');
  const [inDate, setInDate] = useState('');
  const [outDate, setOutDate] = useState('');
  const [q, setQ] = useState('');
  const [size, setSize] = useState<Size>(readSize);
  const [hkRoom, setHkRoom] = useState<string | null>(null);
  const [ticketRoom, setTicketRoom] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const rooms = useMemo(() => status.data ?? [], [status.data]);
  const floors = useMemo(() => [...new Set(rooms.map(r => r.floor).filter(Boolean))] as string[], [rooms]);
  const accounts = useMemo(() => [...new Set(rooms.flatMap(r => [r.inHouseAccount, r.arrivalAccount]).filter(Boolean))].sort((a, b) => a!.localeCompare(b!, 'tr')) as string[], [rooms]);
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
    if (account && r.inHouseAccount !== account && r.arrivalAccount !== account) return false;
    if (inDate && localDate(r.inHouseCheckedInAt) !== inDate && !(r.arrivalReservationId && property?.businessDate === inDate)) return false;
    if (outDate && r.inHouseDeparture !== outDate && r.arrivalDeparture !== outDate) return false;
    const needle = q.trim().toLocaleLowerCase('tr-TR');
    if (needle && ![r.number, r.inHouseGuest, r.arrivalGuest, r.inHouseAccount, r.arrivalAccount].some(x => (x ?? '').toLocaleLowerCase('tr-TR').includes(needle))) return false;
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
  const filtered = !!(typeId || floor || account || inDate || outDate || q.trim() || filter !== 'all');

  const go = (id: string, action?: string) => nav(`/reservations/${id}${action ? `?do=${action}` : ''}`);
  const items = (r: RoomStatus): MenuItem[] => {
    const ih = r.inHouseReservationId;
    const ar = r.arrivalReservationId;
    const list: MenuItem[] = [];
    if (ih) {
      list.push(
        { label: `Konaklamayı aç (${r.inHouseGuest})`, icon: <FileText size={14} />, onClick: () => go(ih) },
        ...(can('folio.post') ? [{ label: 'Masraf girişi', icon: <Plus size={14} />, onClick: () => go(ih, 'charge') }] : []),
        ...(can('payment.create') ? [{ label: 'Tahsilat', icon: <CreditCard size={14} />, onClick: () => go(ih, 'payment') }] : []),
        ...(can('pos.order') ? [{ label: 'Adisyon aç', icon: <Utensils size={14} />, onClick: () => nav(`/pos?room=${encodeURIComponent(r.number)}`) }] : []),
        { separator: true, label: '' },
        ...(can('room.change') ? [{ label: 'Oda değişimi', icon: <ArrowRightLeft size={14} />, onClick: () => go(ih, 'move') }] : []),
        ...(can('reservation.edit') ? [{ label: 'Uzat / kısalt', icon: <CalendarClock size={14} />, onClick: () => go(ih, 'extend') }] : []),
        ...(can('reservation.edit') ? [{ label: 'Uyandırma', icon: <AlarmClock size={14} />, onClick: () => go(ih, 'wakeup') }] : []),
        ...(can('trace.manage') ? [{ label: 'Misafir isteği / hatırlatma', icon: <NotebookPen size={14} />, onClick: () => go(ih, 'trace') }] : []),
        ...(can('checkout.execute') ? [{ label: 'Çıkış yap', icon: <LogOut size={14} />, onClick: () => go(ih, 'checkout') }] : []),
      );
    }
    if (ar) {
      if (list.length) list.push({ separator: true, label: '' });
      list.push(
        { label: `Gelişi aç (${r.arrivalGuest})`, icon: <ClipboardList size={14} />, onClick: () => go(ar) },
        ...(!ih && can('checkin.execute') ? [{ label: 'Giriş yap', icon: <LogIn size={14} />, onClick: () => go(ar, 'checkin') }] : []),
      );
    }
    if (r.foStatus === 'vacant' && !r.blockKind) {
      if (list.length) list.push({ separator: true, label: '' });
      list.push(
        ...(can('checkin.execute') && can('reservation.create') ? [{ label: 'Walk-in giriş', icon: <UserPlus size={14} />, onClick: () => nav(`/walk-in?room=${r.id}`) }] : []),
        ...(can('reservation.create') ? [{ label: 'Bu odaya rezervasyon', icon: <ClipboardList size={14} />, onClick: () => nav(`/reservations/new?room=${r.id}&type=${r.roomTypeId}`) }] : []),
      );
    }
    list.push(
      { separator: true, label: '' },
      { label: 'Oda durumu ve not', icon: <Brush size={14} />, onClick: () => setHkRoom(r.id), disabled: !can('housekeeping.update') },
      { label: 'Arıza kaydı aç', icon: <Wrench size={14} />, onClick: () => setTicketRoom(r.id), disabled: !can('maintenance.report') },
      ...(can('maintenance.manage') ? [{ label: 'Odayı satışa kapat', icon: <Lock size={14} />, onClick: () => nav('/maintenance/blocks') }] : []),
    );
    return list;
  };

  const setZoom = (s: Size) => { setSize(s); saveSize(s); };
  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); };
  const F = (k: Filter, label: string) => <button className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label} ({counts[k]})</button>;

  return (
    <div className="page">
      <PageHead title="Oda Rack" sub={`İş günü ${fmtDate(property?.businessDate)} · gösterilen ${view.length} / ${rooms.length} oda`} actions={<>
        <div className="seg" title="Kart boyutu">
          <button className={size === 's' ? 'active' : ''} onClick={() => setZoom('s')} aria-label="Küçült"><Minus size={14} /></button>
          <button className={size === 'm' ? 'active' : ''} onClick={() => setZoom('m')}>Normal</button>
          <button className={size === 'l' ? 'active' : ''} onClick={() => setZoom('l')} aria-label="Büyült"><Plus size={14} /></button>
        </div>
        <button className="btn" onClick={print} disabled={view.length === 0}><Printer /> Yazdır</button>
        {can('checkin.execute') && can('reservation.create') && <button className="btn" onClick={() => nav('/walk-in')}><UserPlus /> Walk-in</button>}
        {can('reservation.create') && <button className="btn primary" onClick={() => nav('/reservations/new')}><ClipboardList /> Yeni rezervasyon</button>}
      </>} />

      <div className="row wrap" style={{ marginBottom: 8, gap: 10 }}>
        <div className="seg">{F('all', 'Tümü')}{F('vacant', 'Boş')}{F('occupied', 'Dolu')}{F('arrival', 'Geliş')}{F('departure', 'Çıkış')}{F('dirty', 'Kirli')}{F('blocked', 'Bloke')}</div>
        <div className="row" style={{ gap: 6 }}><Search size={15} className="muted" /><input className="input" style={{ width: 210 }} placeholder="Oda no, misafir veya firma" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12, gap: 10 }}>
        <select className="input" style={{ width: 160 }} value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">Tüm oda tipleri</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select>
        {floors.length > 0 && <select className="input" style={{ width: 110 }} value={floor} onChange={e => setFloor(e.target.value)}><option value="">Tüm katlar</option>{floors.map(f => <option key={f} value={f}>{f}. kat</option>)}</select>}
        <select className="input" style={{ width: 190 }} value={account} onChange={e => setAccount(e.target.value)} title="Şirket veya acente">
          <option value="">Tüm firma / acenteler</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="row muted" style={{ gap: 6, fontSize: 12.5 }}>Giriş <input type="date" className="input" style={{ width: 150 }} value={inDate} onChange={e => setInDate(e.target.value)} /></label>
        <label className="row muted" style={{ gap: 6, fontSize: 12.5 }}>Çıkış <input type="date" className="input" style={{ width: 150 }} value={outDate} onChange={e => setOutDate(e.target.value)} /></label>
        {filtered && <button className="btn sm ghost" onClick={() => { setFilter('all'); setTypeId(''); setFloor(''); setAccount(''); setInDate(''); setOutDate(''); setQ(''); }}>Filtreleri temizle</button>}
        <div className="legend" style={{ marginLeft: 'auto' }}>
          <span><i className="hk-clean" />Temiz</span><span><i className="hk-dirty" />Kirli</span><span><i className="hk-inspected" />Kontrol edildi</span><span><i className="hk-cleaning" />Temizleniyor</span><span><i className="hk-ooo" />Bloke</span>
        </div>
      </div>

      {status.isLoading ? <Spinner /> : status.error ? <ErrorBox error={status.error} /> : rooms.length === 0 ? (
        <Empty icon={<BedDouble />} title="Henüz oda tanımlanmamış" text="Odaları Yönetim → Oda ve Oda Tipleri ekranından ekleyin." action={can('room.manage') ? <button className="btn primary" onClick={() => nav('/settings/rooms')}>Oda tanımla</button> : undefined} />
      ) : view.length === 0 ? <Empty title="Bu filtreye uyan oda yok" /> : (
        <div className={`rack-grid size-${size}`}>
          {view.map(r => (
            <div key={r.id} className={`room-tile ${r.foStatus === 'occupied' ? 'occupied' : ''} ${r.arrivalReservationId && r.foStatus !== 'occupied' ? 'arriving' : ''}`}
              onClick={e => menu.open(e, items(r))} onContextMenu={e => menu.open(e, items(r))}
              onDoubleClick={() => { const id = r.inHouseReservationId ?? r.arrivalReservationId; if (id) go(id); }}>
              <div className={`rt-head ${tileClass(r)}`}>
                <span>{r.blockKind ? BLOCK_LABEL[r.blockKind] : HK_LABEL[r.hkStatus]}</span>
                <span>{r.foStatus === 'occupied' ? (r.departureToday ? 'ÇIKIŞ' : 'DOLU') : r.arrivalReservationId ? 'GELİŞ' : 'BOŞ'}</span>
              </div>
              <div className="rt-icons">
                {r.isVip && <Crown size={13} />}
                {r.isDnd && <BellOff size={13} />}
                {r.openTickets > 0 && <Wrench size={13} />}
                {r.hkNote && <StickyNote size={13} />}
              </div>
              <div className="rt-body">
                <div className="rt-no">{r.number}</div>
                <div className="rt-type">{r.roomTypeCode}{r.floor ? ` · ${r.floor}. kat` : ''}</div>
              </div>
              <div className="rt-foot" title={tileTitle(r)}>
                {r.inHouseGuest ? <>
                  <div className="rt-guest">{r.inHouseGuest}{r.inHousePax && r.inHousePax > 1 ? <span className="muted"> · {r.inHousePax} kişi</span> : null}</div>
                  {r.inHouseAccount && <div className="rt-acc">{r.inHouseAccount}</div>}
                  <div className="rt-dates">{r.inHouseCheckedInAt ? `${fmtDate(localDate(r.inHouseCheckedInAt))} ${hhmm(r.inHouseCheckedInAt)}` : ''} → {fmtDate(r.inHouseDeparture)}</div>
                  {r.inHouseBalance != null && Number(r.inHouseBalance) !== 0 && <div className={`rt-bal ${Number(r.inHouseBalance) > 0 ? 'due' : ''}`}>Bakiye {fmtMoney(r.inHouseBalance, r.inHouseCurrency)}</div>}
                  {r.inHouseNote && <div className="rt-note">{r.inHouseNote}</div>}
                </> : r.arrivalGuest ? <>
                  <div className="rt-guest"><b style={{ color: 'var(--st-arrival)' }}>Geliş:</b> {r.arrivalGuest}</div>
                  {r.arrivalAccount && <div className="rt-acc">{r.arrivalAccount}</div>}
                  <div className="rt-dates">{r.arrivalEta ? `Saat ${r.arrivalEta.slice(0, 5)} · ` : ''}Çıkış {fmtDate(r.arrivalDeparture)}</div>
                  {r.arrivalNote && <div className="rt-note">{r.arrivalNote}</div>}
                </> : r.blockReason ? <span className="muted">{r.blockReason}</span>
                  : r.hkNote ? <span className="muted">{r.hkNote}</span> : <span className="muted">—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {menu.node}
      {hkRoom && <HkStatusModal roomId={hkRoom} onClose={() => setHkRoom(null)} />}
      {ticketRoom && <TicketModal roomId={ticketRoom} onClose={() => setTicketRoom(null)} />}
      {printing && createPortal(<RackPrint rooms={view} filtered={filtered} />, document.getElementById('print-root')!)}
    </div>
  );
}

function tileTitle(r: RoomStatus) {
  return [r.inHouseGuest ?? r.arrivalGuest, r.inHouseAccount ?? r.arrivalAccount, r.inHouseNote ?? r.arrivalNote, r.hkNote && `Kat notu: ${r.hkNote}`, r.blockReason]
    .filter(Boolean).join('\n');
}

/** Rack dökümü: ekrandaki filtreye uyan odalar tablo olarak. */
function RackPrint({ rooms, filtered }: { rooms: RoomStatus[]; filtered: boolean }) {
  const { property } = useSession();
  const occupied = rooms.filter(r => r.foStatus === 'occupied').length;
  return (
    <div className="doc folio-doc report-doc dense">
      <DocHeader kind="Oda Rack" no={`İş günü ${fmtDate(property?.businessDate)}`} lines={[`${rooms.length} oda · ${occupied} dolu${filtered ? ' · filtre uygulandı' : ''}`]} />
      <table className="fd-table">
        <thead><tr><th>Oda</th><th>Tip</th><th>Durum</th><th>Misafir</th><th>Firma / acente</th><th>Giriş</th><th>Çıkış</th><th className="r">Kişi</th><th className="r">Bakiye</th><th>Not</th></tr></thead>
        <tbody>
          {rooms.map(r => (
            <tr key={r.id}>
              <td><b>{r.number}</b></td>
              <td>{r.roomTypeCode}</td>
              <td>{r.blockKind ? BLOCK_LABEL[r.blockKind] : HK_LABEL[r.hkStatus]} · {r.foStatus === 'occupied' ? 'Dolu' : r.arrivalReservationId ? 'Geliş' : 'Boş'}</td>
              <td>{r.inHouseGuest ?? (r.arrivalGuest ? `Geliş: ${r.arrivalGuest}` : '')}</td>
              <td>{r.inHouseAccount ?? r.arrivalAccount ?? ''}</td>
              <td>{r.inHouseCheckedInAt ? fmtDateTime(r.inHouseCheckedInAt) : r.arrivalGuest ? `${fmtDate(property?.businessDate)}${r.arrivalEta ? ` ${r.arrivalEta.slice(0, 5)}` : ''}` : ''}</td>
              <td>{fmtDate(r.inHouseDeparture ?? r.arrivalDeparture)}</td>
              <td className="r">{r.inHousePax ?? ''}</td>
              <td className="r">{r.inHouseBalance != null && Number(r.inHouseBalance) !== 0 ? fmtMoney(r.inHouseBalance, r.inHouseCurrency) : ''}</td>
              <td>{[r.inHouseNote ?? r.arrivalNote, r.hkNote, r.blockReason].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DocFooter note={`${rooms.length} oda listelendi.`} />
    </div>
  );
}

