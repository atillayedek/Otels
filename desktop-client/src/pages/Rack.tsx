import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, ArrowRightLeft, BedDouble, BellOff, Bell, Brush, CalendarClock, CalendarRange, CheckSquare, ClipboardList, CreditCard, Crown, FileText, List, Lock, LogIn, LogOut,
  Minus, NotebookPen, Pencil, Plus, Printer, Search, ShieldCheck, StickyNote, Tag, UserPlus, Users, Utensils, Wrench, X, XCircle,
} from 'lucide-react';
import { BulkChargeModal, BulkCheckoutModal, BulkNoteModal } from '../components/RackBulk';
import { api } from '../lib/api';
import { useRoomGroups, useRoomStatus } from '../lib/queries';
import { useSession } from '../lib/session';
import { BLOCK_LABEL, fmtDate, fmtDateTime, fmtMoney, HK_LABEL } from '../lib/format';
import type { RoomStatus } from '../lib/types';
import { Empty, ErrorBox, Spinner, useContextMenu, useToast, type MenuItem } from '../components/ui';
import { HkStatusModal, TicketModal } from '../components/RoomActions';
import { DocFooter, DocHeader } from '../components/PrintDoc';
import { useWindows } from '../components/Windows';
import { BlockModal } from './RoomBlocks';
import { TaskModal } from './HkTasks';

type Filter = 'all' | 'vacant' | 'occupied' | 'arrival' | 'departure' | 'dirty' | 'blocked';
type Size = 's' | 'm' | 'l';
/** Kartın ana rengi (gövde): bloke > dolu > geliş > kirli > temizleniyor/kontrol > boş. */
type Tone = 'blocked' | 'occupied' | 'departure' | 'arrival' | 'dirty' | 'cleaning' | 'inspected' | 'vacant';

function toneOf(r: RoomStatus): Tone {
  if (r.blockKind) return 'blocked';
  if (r.foStatus === 'occupied') return r.departureToday ? 'departure' : 'occupied';
  if (r.arrivalReservationId) return 'arrival';
  if (r.hkStatus === 'dirty') return 'dirty';
  if (r.hkStatus === 'cleaning') return 'cleaning';
  if (r.hkStatus === 'inspected') return 'inspected';
  return 'vacant';
}

const SIZE_KEY = 'pms-rack-size';
const readPref = <T extends string>(key: string, allowed: T[], d: T): T => { try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : d; } catch { return d; } };
const savePref = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* tarayıcı depolaması kapalı olabilir */ } };

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
const localDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');
const lc = (s?: string | null) => (s ?? '').toLocaleLowerCase('tr-TR');

export default function RackPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const windows = useWindows();
  const { can, property } = useSession();
  const status = useRoomStatus();
  const groups = useRoomGroups();
  const menu = useContextMenu();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [size, setSize] = useState<Size>(() => readPref(SIZE_KEY, ['s', 'm', 'l'], 'm'));
  const [hkRoom, setHkRoom] = useState<string | null>(null);
  const [ticketRoom, setTicketRoom] = useState<string | null>(null);
  const [blockRoom, setBlockRoom] = useState<string | null>(null);
  const [taskRoom, setTaskRoom] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  // Çoklu seçim: Ctrl+tık tek tek, Shift+tık aralık, "Seç" menüsünden toplu (tümü, bugün çıkacaklar...).
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [bulkDlg, setBulkDlg] = useState<'note' | 'charge' | 'checkout' | null>(null);

  const rooms = useMemo(() => status.data ?? [], [status.data]);
  const counts = useMemo(() => ({
    all: rooms.length,
    vacant: rooms.filter(r => r.foStatus === 'vacant' && !r.blockKind).length,
    occupied: rooms.filter(r => r.foStatus === 'occupied').length,
    arrival: rooms.filter(r => r.arrivalReservationId).length,
    departure: rooms.filter(r => r.departureToday).length,
    dirty: rooms.filter(r => r.hkStatus === 'dirty').length,
    blocked: rooms.filter(r => r.blockKind).length,
  }), [rooms]);

  // Arama: oda no, odadaki herkesin adı (ana ve ek misafirler, bugünkü geliş dahil), firma/acente.
  const needle = lc(q.trim());
  const view = rooms.filter(r => {
    if (needle && ![r.number, r.inHouseGuest, r.arrivalGuest, r.inHouseGuests, r.inHouseAccount, r.arrivalAccount].some(x => lc(x).includes(needle))) return false;
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
  const filtered = !!(q.trim() || filter !== 'all');

  // Seçim yalnız var olan odaları tutar (oda pasife alınınca/yenilenince düşer).
  const selRooms = rooms.filter(r => sel.has(r.id));
  const selectWhere = (pred: (r: RoomStatus) => boolean, add = false) =>
    setSel(prev => { const n = new Set(add ? prev : []); view.filter(pred).forEach(r => n.add(r.id)); return n; });
  const clearSel = () => { setSel(new Set()); setAnchor(null); };
  const toggle = (r: RoomStatus, range: boolean) => {
    if (range && anchor) {
      const a = view.findIndex(x => x.id === anchor), b = view.findIndex(x => x.id === r.id);
      if (a >= 0 && b >= 0) {
        setSel(prev => { const n = new Set(prev); view.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => n.add(x.id)); return n; });
        return;
      }
    }
    setSel(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; });
    setAnchor(r.id);
  };
  useEffect(() => {
    if (sel.size === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.overlay, .ctx')) clearSel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel.size]);
  const selectMenu = (e: React.MouseEvent) => menu.open(e, [
    { label: `Tümü (ekrandaki ${view.length} oda)`, icon: <CheckSquare size={14} />, onClick: () => selectWhere(() => true) },
    { label: 'Bugün çıkacaklar (C/Out günü gelenler)', icon: <LogOut size={14} />, onClick: () => selectWhere(r => r.departureToday) },
    { label: 'Bugün gelecekler', icon: <LogIn size={14} />, onClick: () => selectWhere(r => !!r.arrivalReservationId && r.foStatus !== 'occupied') },
    { label: 'Dolu odalar (konaklayan)', icon: <BedDouble size={14} />, onClick: () => selectWhere(r => r.foStatus === 'occupied') },
    { label: 'Boş odalar', onClick: () => selectWhere(r => r.foStatus === 'vacant' && !r.blockKind) },
    { label: 'Kirli odalar', icon: <Brush size={14} />, onClick: () => selectWhere(r => r.hkStatus === 'dirty') },
    { label: 'Bakiyesi olan odalar', icon: <CreditCard size={14} />, onClick: () => selectWhere(r => r.inHouseBalance != null && Number(r.inHouseBalance) > 0) },
    ...((groups.data?.length ?? 0) > 0 ? [{ label: 'Oda grubu', icon: <Tag size={14} />, children: groups.data!.map(g => ({ label: g.name, onClick: () => selectWhere(r => r.groupId === g.id) })) } as MenuItem] : []),
    { separator: true, label: '' },
    { label: 'Seçimi tersine çevir', disabled: sel.size === 0, onClick: () => setSel(prev => new Set(view.filter(r => !prev.has(r.id)).map(r => r.id))) },
    { label: 'Seçimi temizle (Esc)', icon: <X size={14} />, disabled: sel.size === 0, onClick: clearSel },
  ]);

  /** Konaklama penceresi (arkadaki rack yerinde kalır); pencere sistemi yoksa sayfaya gider. */
  /** Hesap hareketleri (masraf/tahsilat) ayrı pencerede açılır. */
  const openFolio = (id: string, action?: string) => (windows ? windows.open({ kind: 'folio', id, action }) : nav(`/reservations/${id}${action ? `?do=${action}` : ''}`));
  const openRes = (id: string, action?: string) => (windows ? windows.open({ kind: 'reservation', id, action }) : nav(`/reservations/${id}${action ? `?do=${action}` : ''}`));
  const newRes = (r: RoomStatus, walkIn: boolean) => {
    const params: Record<string, string> = walkIn ? { room: r.id } : { room: r.id, type: r.roomTypeId };
    if (windows) windows.open({ kind: walkIn ? 'walk-in' : 'new-reservation', params });
    else nav(walkIn ? `/walk-in?room=${r.id}` : `/reservations/new?room=${r.id}&type=${r.roomTypeId}`);
  };
  const bulk = async (r: RoomStatus | RoomStatus[], body: Record<string, unknown>, done: string) => {
    const list = Array.isArray(r) ? r : [r];
    try {
      await api('POST', '/api/v1/rooms/bulk-housekeeping', { roomIds: list.map(x => x.id), setNote: false, setGroup: false, ...body });
      await qc.invalidateQueries({ predicate: x => ['roomStatus', 'rooms', 'rack'].includes(String(x.queryKey[0])) });
      toast.ok(list.length === 1 ? `Oda ${list[0].number}: ${done}` : `${list.length} oda: ${done}`);
    } catch (e) { toast.error(e); }
  };

  /** Seçili odalar için toplu işlemler (seçim çubuğu ve seçili karta sağ tık). */
  const bulkItems = (): MenuItem[] => {
    const list = selRooms;
    const inhouse = list.filter(r => r.inHouseReservationId).length;
    return [
      { label: `${list.length} oda seçili${inhouse ? ` · ${inhouse} konaklayan` : ''}`, disabled: true },
      { separator: true, label: '' },
      { label: 'Oda durumu', icon: <Brush size={14} />, disabled: !can('housekeeping.update'), children: Object.entries(HK_LABEL)
        .filter(([k]) => k !== 'inspected' || can('housekeeping.inspect'))
        .map(([k, l]) => ({ label: l, onClick: () => void bulk(list, { hkStatus: k }, `durum "${l}" yapıldı.`) })) },
      { label: 'Rahatsız etmeyin (DND) işaretle', icon: <BellOff size={14} />, disabled: !can('housekeeping.update'), onClick: () => void bulk(list, { isDnd: true }, 'DND işaretlendi.') },
      { label: 'Rahatsız etmeyin kaldır', icon: <Bell size={14} />, disabled: !can('housekeeping.update'), onClick: () => void bulk(list, { isDnd: false }, 'DND kaldırıldı.') },
      { label: 'Oda durum notu yaz / sil', icon: <StickyNote size={14} />, disabled: !can('housekeeping.update'), onClick: () => setBulkDlg('note') },
      ...(can('room.manage') && (groups.data?.length ?? 0) > 0 ? [{
        label: 'Oda grubu', icon: <Tag size={14} />, children: [
          ...groups.data!.map(g => ({ label: g.name, onClick: () => void bulk(list, { setGroup: true, groupId: g.id }, `"${g.name}" grubuna alındı.`) })),
          { separator: true, label: '' },
          { label: 'Gruptan çıkar', onClick: () => void bulk(list, { setGroup: true, groupId: null }, 'gruptan çıkarıldı.') },
        ],
      } as MenuItem] : []),
      { separator: true, label: '' },
      { label: 'Toplu masraf ekle', icon: <Plus size={14} />, disabled: !inhouse || !can('folio.post'), onClick: () => setBulkDlg('charge') },
      { label: 'Toplu çıkış (bakiyesi sıfır olanlar)', icon: <LogOut size={14} />, disabled: !inhouse || !can('checkout.execute'), onClick: () => setBulkDlg('checkout') },
      { separator: true, label: '' },
      { label: 'Seçilenleri yazdır', icon: <Printer size={14} />, onClick: () => print() },
      { label: 'Seçimi temizle (Esc)', icon: <X size={14} />, onClick: clearSel },
    ];
  };

  const items = (r: RoomStatus): MenuItem[] => {
    const ih = r.inHouseReservationId;
    const ar = r.arrivalReservationId;
    const res = ih ?? ar;
    const vacant = r.foStatus === 'vacant' && !r.blockKind;
    const hkItems: MenuItem[] = Object.entries(HK_LABEL)
      .filter(([k]) => k !== 'inspected' || can('housekeeping.inspect') || r.hkStatus === 'inspected')
      .map(([k, l]) => ({ label: l, checked: r.hkStatus === k, disabled: r.hkStatus === k, onClick: () => void bulk(r, { hkStatus: k }, `durum "${l}" yapıldı.`) }));
    return [
      { label: ih ? `Folyo · ${r.inHouseGuest}` : ar ? `Rezervasyon · ${r.arrivalGuest}` : 'Folyo', icon: <FileText size={14} />, disabled: !res, onClick: () => res && openRes(res) },
      { label: 'Giriş yap (check-in)', icon: <LogIn size={14} />, disabled: !ar || !!ih || !can('checkin.execute'), onClick: () => ar && openRes(ar, 'checkin') },
      { label: 'Çıkış yap (check-out)', icon: <LogOut size={14} />, disabled: !ih || !can('checkout.execute'), onClick: () => ih && openRes(ih, 'checkout') },
      { label: 'Walk-in giriş', icon: <UserPlus size={14} />, disabled: !vacant || !!ar || !(can('checkin.execute') && can('reservation.create')), onClick: () => newRes(r, true) },
      { label: 'Bu odaya rezervasyon', icon: <ClipboardList size={14} />, disabled: !!r.blockKind || !can('reservation.create'), onClick: () => newRes(r, false) },
      { separator: true, label: '' },
      {
        label: 'Ödeme / harcama', icon: <CreditCard size={14} />, disabled: !ih, children: [
          { label: 'Tahsilat al', icon: <CreditCard size={14} />, disabled: !can('payment.create'), onClick: () => ih && openFolio(ih, 'payment') },
          { label: 'Masraf gir', icon: <Plus size={14} />, disabled: !can('folio.post'), onClick: () => ih && openFolio(ih, 'charge') },
          { label: 'Adisyon aç (restoran / bar)', icon: <Utensils size={14} />, disabled: !can('pos.order'), onClick: () => nav(`/pos?room=${encodeURIComponent(r.number)}`) },
          { label: 'Hesap hareketleri (folyo)', icon: <FileText size={14} />, onClick: () => ih && openFolio(ih) },
        ],
      },
      {
        label: 'Konaklama işlemleri', icon: <CalendarClock size={14} />, disabled: !res, children: [
          { label: 'Ek misafir ekle / yeni misafir', icon: <Users size={14} />, disabled: !can('reservation.edit'), onClick: () => res && openRes(res, 'sharer') },
          { label: 'Rezervasyonu düzenle / fiyat', icon: <Pencil size={14} />, disabled: !can('reservation.edit'), onClick: () => res && openRes(res, 'edit') },
          { label: 'Oda değişimi', icon: <ArrowRightLeft size={14} />, disabled: !ih || !can('room.change'), onClick: () => ih && openRes(ih, 'move') },
          { label: 'Uzat / kısalt', icon: <CalendarClock size={14} />, disabled: !can('reservation.edit'), onClick: () => res && openRes(res, 'extend') },
          { label: 'Uyandırma', icon: <AlarmClock size={14} />, disabled: !ih || !can('reservation.edit'), onClick: () => ih && openRes(ih, 'wakeup') },
          { label: 'Misafir isteği / hatırlatma', icon: <NotebookPen size={14} />, disabled: !can('trace.manage'), onClick: () => res && openRes(res, 'trace') },
          { label: 'Kimlik bildirimi (KBS)', icon: <ShieldCheck size={14} />, disabled: !ih || !can('kbs.manage'), onClick: () => ih && windows?.open({ kind: 'reservation', id: ih, kbs: true }) },
          { label: 'Rezervasyonu iptal et', icon: <XCircle size={14} />, danger: true, disabled: !ar || !!ih || !can('reservation.cancel'), onClick: () => ar && openRes(ar, 'cancel') },
        ],
      },
      { separator: true, label: '' },
      { label: 'Oda durumu', icon: <Brush size={14} />, disabled: !can('housekeeping.update'), children: [
        ...hkItems,
        { separator: true, label: '' },
        { label: r.isDnd ? 'Rahatsız etmeyin: kaldır' : 'Rahatsız etmeyin (DND)', icon: r.isDnd ? <Bell size={14} /> : <BellOff size={14} />, onClick: () => void bulk(r, { isDnd: !r.isDnd }, r.isDnd ? 'DND kaldırıldı.' : 'DND işaretlendi.') },
      ] },
      { label: 'Oda durum notu yaz', icon: <StickyNote size={14} />, disabled: !can('housekeeping.update'), onClick: () => setHkRoom(r.id) },
      ...(can('room.manage') && (groups.data?.length ?? 0) > 0 ? [{
        label: 'Oda grubu', icon: <Tag size={14} />, children: [
          ...groups.data!.map(g => ({ label: g.name, checked: r.groupId === g.id, onClick: () => void bulk(r, { setGroup: true, groupId: g.id }, `"${g.name}" grubuna alındı.`) })),
          { separator: true, label: '' },
          { label: 'Gruptan çıkar', disabled: !r.groupId, onClick: () => void bulk(r, { setGroup: true, groupId: null }, 'gruptan çıkarıldı.') },
        ],
      } as MenuItem] : []),
      { label: 'Kat hizmeti görevi', icon: <Brush size={14} />, disabled: !can('housekeeping.assign'), onClick: () => setTaskRoom(r.id) },
      { label: 'Arıza kaydı aç', icon: <Wrench size={14} />, disabled: !can('maintenance.report'), onClick: () => setTicketRoom(r.id) },
      { label: 'Odayı satışa kapat (blokaj)', icon: <Lock size={14} />, disabled: !can('maintenance.manage') || !!ih, onClick: () => setBlockRoom(r.id) },
      { separator: true, label: '' },
      {
        label: 'Listeler', icon: <List size={14} />, children: [
          { label: 'Beklenen gelişler', icon: <LogIn size={14} />, onClick: () => nav('/reservations?view=arrivals') },
          { label: 'Beklenen çıkışlar', icon: <LogOut size={14} />, onClick: () => nav('/reservations?view=departures') },
          { label: 'Konaklayanlar', icon: <BedDouble size={14} />, onClick: () => nav('/reservations?view=inhouse') },
          { label: 'Blokaj çizelgesi', icon: <CalendarRange size={14} />, onClick: () => nav('/blokaj') },
          { label: 'Oda durumları (kat hizmetleri)', icon: <Brush size={14} />, onClick: () => nav('/housekeeping') },
        ],
      },
    ];
  };

  const setZoom = (s: Size) => { setSize(s); savePref(SIZE_KEY, s); };
  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); };
  // Süzgeç düğmelerindeki renk noktası kart rengini gösterir (ayrı açıklama şeridi yok).
  const DOT: Partial<Record<Filter, string>> = { vacant: 'vacant', occupied: 'occupied', arrival: 'arrival', departure: 'departure', dirty: 'dirty', blocked: 'blocked' };
  const F = (k: Filter, label: string) => <button className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{DOT[k] && <i className={`fdot tone-${DOT[k]}`} />}{label} ({counts[k]})</button>;

  const tile = (r: RoomStatus) => {
    const t = toneOf(r);
    const names = (r.inHouseGuests ?? r.inHouseGuest ?? r.arrivalGuest ?? '').split(' · ').filter(Boolean);
    return (
      <div key={r.id} className={`room-tile tone-${t}${sel.has(r.id) ? ' selected' : ''}`} title={tileTitle(r)} aria-selected={sel.has(r.id)}
        style={r.groupColor ? ({ '--grp': r.groupColor } as React.CSSProperties) : undefined}
        onClick={e => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); toggle(r, e.shiftKey); return; }
          menu.open(e, sel.has(r.id) && sel.size > 1 ? bulkItems() : items(r));
        }}
        onContextMenu={e => menu.open(e, sel.has(r.id) && sel.size > 1 ? bulkItems() : items(r))}
        onDoubleClick={() => { const id = r.inHouseReservationId ?? r.arrivalReservationId; if (id) openRes(id); }}>
        <div className="rt-head">
          <span className="rt-no">{r.number}</span>
          <span className="rt-icons">
            {r.isVip && <Crown size={13} />}{r.isDnd && <BellOff size={13} />}{r.openTickets > 0 && <Wrench size={13} />}{r.hkNote && <StickyNote size={13} />}
          </span>
        </div>
        <div className="rt-body">
          <div className="rt-type">{r.roomTypeCode}{r.floor ? ` · ${r.floor}. kat` : ''}</div>
          {r.foStatus === 'occupied' || r.arrivalReservationId ? <>
            {!r.inHouseGuest && <div className="rt-tag">Geliş{r.arrivalEta ? ` · ${r.arrivalEta.slice(0, 5)}` : ''}</div>}
            {names.slice(0, 3).map(n => <div key={n} className="rt-guest">{n}</div>)}
            {names.length > 3 && <div className="rt-more">+{names.length - 3} kişi</div>}
            {(r.inHouseAccount ?? r.arrivalAccount) && <div className="rt-acc">{r.inHouseAccount ?? r.arrivalAccount}</div>}
            <div className="rt-dates">
              {r.inHouseGuest ? `${r.inHouseCheckedInAt ? `${fmtDate(localDate(r.inHouseCheckedInAt))} ${hhmm(r.inHouseCheckedInAt)}` : ''}` : ''} → {fmtDate(r.inHouseDeparture ?? r.arrivalDeparture)}
            </div>
            {r.inHouseBalance != null && Number(r.inHouseBalance) !== 0 && <div className={`rt-bal ${Number(r.inHouseBalance) > 0 ? 'due' : ''}`}>Bakiye {fmtMoney(r.inHouseBalance, r.inHouseCurrency)}</div>}
            {(r.inHouseNote ?? r.arrivalNote) && <div className="rt-note">{r.inHouseNote ?? r.arrivalNote}</div>}
          </> : r.blockKind ? <div className="rt-note">{BLOCK_LABEL[r.blockKind]}{r.blockReason ? `: ${r.blockReason}` : ''}</div>
            : r.hkNote ? <div className="rt-note">{r.hkNote}</div> : null}
        </div>
        <div className="rt-foot">
          <span className={`rt-hk hk-${r.hkStatus}`}>{r.blockKind ? BLOCK_LABEL[r.blockKind] : HK_LABEL[r.hkStatus]}</span>
          {r.groupName && <span className="rt-grp">{r.groupName}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="page rack-page">
      <div className="rack-tools">
        <div className="rack-search">
          <Search size={15} />
          <input className="input" placeholder="Kişi ara: ad soyad, oda no, firma" value={q} onChange={e => setQ(e.target.value)} autoFocus data-enter="keep" />
          {q && <button className="btn sm ghost" onClick={() => setQ('')} aria-label="Aramayı temizle">×</button>}
        </div>
        <div className="seg">{F('all', 'Tümü')}{F('vacant', 'Boş')}{F('occupied', 'Dolu')}{F('arrival', 'Geliş')}{F('departure', 'Çıkış')}{F('dirty', 'Kirli')}{F('blocked', 'Bloke')}</div>
        <button className="btn sm" onClick={selectMenu} title="Odaları toplu seç (Ctrl+tık tek tek, Shift+tık aralık)"><CheckSquare size={14} /> Seç</button>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{fmtDate(property?.businessDate)} · {view.length} / {rooms.length} oda</span>
        <div className="seg" title="Kart boyutu">
          <button className={size === 's' ? 'active' : ''} onClick={() => setZoom('s')} aria-label="Küçült"><Minus size={14} /></button>
          <button className={size === 'm' ? 'active' : ''} onClick={() => setZoom('m')}>Normal</button>
          <button className={size === 'l' ? 'active' : ''} onClick={() => setZoom('l')} aria-label="Büyült"><Plus size={14} /></button>
        </div>
        <button className="btn icon" onClick={print} disabled={view.length === 0} title={sel.size ? 'Seçili odaları yazdır' : 'Yazdır'}><Printer /></button>
      </div>
      {sel.size > 0 && (
        <div className="rack-selbar">
          <CheckSquare size={15} />
          <b>{selRooms.length} oda seçili</b>
          <span className="muted">{selRooms.map(r => r.number).slice(0, 12).join(', ')}{selRooms.length > 12 ? ' …' : ''}</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>Ctrl+tık ekle/çıkar · Shift+tık aralık · Esc temizle</span>
          <button className="btn sm primary" onClick={e => menu.open(e, bulkItems())}>Toplu işlemler</button>
          <button className="btn sm" onClick={clearSel}><X size={14} /> Temizle</button>
        </div>
      )}

      {status.isLoading ? <Spinner /> : status.error ? <ErrorBox error={status.error} /> : rooms.length === 0 ? (
        <Empty icon={<BedDouble />} title="Henüz oda tanımlanmamış" text="Odaları Yönetim → Oda ve Oda Tipleri ekranından ekleyin." action={can('room.manage') ? <button className="btn primary" onClick={() => nav('/settings/rooms')}>Oda tanımla</button> : undefined} />
      ) : view.length === 0 ? <Empty title={needle ? `"${q.trim()}" ile eşleşen oda veya misafir yok` : 'Bu filtreye uyan oda yok'} /> : (
        <div className={`rack-grid size-${size}`}>{view.map(tile)}</div>
      )}


      {menu.node}
      {hkRoom && <HkStatusModal roomId={hkRoom} onClose={() => setHkRoom(null)} />}
      {ticketRoom && <TicketModal roomId={ticketRoom} onClose={() => setTicketRoom(null)} />}
      {blockRoom && <BlockModal roomId={blockRoom} onClose={() => setBlockRoom(null)} />}
      {taskRoom && <TaskModal roomId={taskRoom} onClose={() => setTaskRoom(null)} />}
      {bulkDlg === 'note' && <BulkNoteModal rooms={selRooms} onClose={() => setBulkDlg(null)} />}
      {bulkDlg === 'charge' && <BulkChargeModal rooms={selRooms} onClose={() => setBulkDlg(null)} />}
      {bulkDlg === 'checkout' && <BulkCheckoutModal rooms={selRooms} onClose={() => setBulkDlg(null)} />}
      {printing && createPortal(<RackPrint rooms={sel.size ? selRooms : view} filtered={filtered || sel.size > 0} />, document.getElementById('print-root')!)}
    </div>
  );
}

function tileTitle(r: RoomStatus) {
  return [r.inHouseGuests ?? r.inHouseGuest ?? r.arrivalGuest, r.inHouseAccount ?? r.arrivalAccount, r.inHouseNote ?? r.arrivalNote, r.hkNote && `Kat notu: ${r.hkNote}`, r.blockReason, r.groupName && `Grup: ${r.groupName}`]
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
              <td>{r.inHouseGuests ?? r.inHouseGuest ?? (r.arrivalGuest ? `Geliş: ${r.arrivalGuest}` : '')}</td>
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
