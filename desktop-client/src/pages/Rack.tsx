import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, ArrowRightLeft, BedDouble, BellOff, Bell, Brush, CalendarClock, CalendarRange, CheckSquare, ClipboardList, CreditCard, Crown, FileText, List, Lock, LogIn, LogOut,
  Minus, NotebookPen, Pencil, Plus, Printer, Search, ShieldCheck, StickyNote, Tag, UserPlus, Users, Utensils, Wrench, X, XCircle,
} from 'lucide-react';
import { BulkChargeModal, BulkCheckoutModal, BulkNoteModal } from '../components/RackBulk';
import { save } from '@tauri-apps/plugin-dialog';
import { api, download, get, newKey } from '../lib/api';
import { useRoomGroups } from '../lib/queries';
import { useSession } from '../lib/session';
import { BLOCK_LABEL, fmtDate, fmtDateTime, fmtMoney, HK_LABEL } from '../lib/format';
import type { RoomStatus } from '../lib/types';
import { Empty, ErrorBox, Spinner, useConfirm, useContextMenu, useToast, type MenuItem } from '../components/ui';
import { HkStatusModal, TicketModal } from '../components/RoomActions';
import { DocFooter, DocHeader } from '../components/PrintDoc';
import { useWindows } from '../components/Windows';
import { BlockModal } from './RoomBlocks';
import { TaskModal } from './HkTasks';
import { useSessionState } from '../lib/sessionState';

type Filter = 'all' | 'vacant' | 'occupied' | 'arrival' | 'departure' | 'dirty' | 'blocked';
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

const COLS_KEY = 'pms-rack-cols';
// Kart boyutu: bir satırdaki oda sayısı. Çok küçültünce (çok sütun) kutuda yalnız oda no ve durum kalır.
const COLS_MIN = 4, COLS_MAX = 40, COLS_DEFAULT = 10;
const AUTO_KEY = 'pms-rack-auto';
/** Otomatik boyut: tüm odalar görünür alana sığacak en büyük kutu (kutu genişliği ~44–180 px). Kat planında kat başlıkları da hesaba katılır. */
function fitCols(width: number, height: number, floorCounts: number[], headerH: number) {
  const gapOf = (c: number) => Math.max(2, Math.min(8, 80 / c));
  // Kutu en az ~44 px kalır (oda no okunur); sığmıyorsa sayfa kaydırılır.
  const start = Math.max(COLS_MIN, Math.ceil(width / 180));
  const end = Math.max(start, Math.min(COLS_MAX, Math.floor(width / 48)));
  for (let c = start; c <= end; c++) {
    const g = gapOf(c), tw = (width - (c - 1) * g) / c, th = tw * 150 / 118;
    const total = floorCounts.reduce((sum, n) => { const rows = Math.ceil(n / c); return sum + rows * th + Math.max(0, rows - 1) * g + headerH; }, 0);
    if (total <= height) return c;
  }
  return end;
}
const readCols = () => { try { const n = Number(localStorage.getItem(COLS_KEY)); return n >= COLS_MIN && n <= COLS_MAX ? Math.round(n) : COLS_DEFAULT; } catch { return COLS_DEFAULT; } };
const LAYOUT_KEY = 'pms-rack-layout';
const COLOR_KEY = 'pms-rack-color';
/** Grup rengi üzerinde okunur yazı rengi (açık zeminde koyu, koyu zeminde beyaz). */
const textOn = (hex: string) => { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#0f172a' : '#ffffff'; };
const readPref = <T extends string>(key: string, allowed: T[], d: T): T => { try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : d; } catch { return d; } };
const savePref = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* tarayıcı depolaması kapalı olabilir */ } };

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
const localDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');
const lc = (s?: string | null) => (s ?? '').toLocaleLowerCase('tr-TR');

export default function RackPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const windows = useWindows();
  const { can, property } = useSession();
  // Rack tarihi: boş = iş günü (canlı durum); ileri tarih seçilince o günün doluluğu (odası atanmış rezervasyonlar ve blokajlar).
  const [day, setDay] = useState('');
  const bd = property?.businessDate ?? '';
  const future = !!day && !!bd && day > bd;
  const status = useQuery({ queryKey: ['roomStatus', future ? day : 'today'],
    queryFn: () => get<RoomStatus[]>(`/api/v1/rooms/status${future ? `?date=${day}` : ''}`) });
  const groups = useRoomGroups();
  const menu = useContextMenu();
  const [filter, setFilter] = useSessionState<Filter>('rack.filter', 'all');
  const [q, setQ] = useSessionState('rack.q', '');
  // Arama alanı (AmonRa'daki alan seçimi gibi): tümü veya yalnız oda no / misafir / firma / kat / oda tipi.
  const [field, setField] = useSessionState<'all' | 'room' | 'guest' | 'account' | 'floor' | 'type' | 'resno'>('rack.field', 'all');
  // AmonRa rack süzgeçleri: firma/acente ve çıkış tarihi (boş = hepsi)
  const [acc, setAcc] = useState('');
  const [dep, setDep] = useState('');
  const [cols, setColsState] = useState<number>(readCols);
  // Otomatik (varsayılan): pencere büyüyüp küçüldükçe kutular tüm odaları ekrana sığdıracak şekilde kendiliğinden ayarlanır.
  const [auto, setAuto] = useState<boolean>(() => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } });
  const [autoCols, setAutoCols] = useState(COLS_DEFAULT);
  const areaRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Rack: odalar sıralı tek akış; Otel Planı: odalar kat kat (kat bilgisi olmayanlar en sonda).
  const [layout, setLayout] = useState<'rack' | 'plan'>(() => readPref(LAYOUT_KEY, ['rack', 'plan'], 'rack'));
  // Kutu rengi: oda grubu (varsayılan; grubu olan oda tamamen grup rengine boyanır, grubu olmayan durum rengini korur) veya oda durumu.
  const [colorMode, setColorMode] = useState<'status' | 'group'>(() => readPref(COLOR_KEY, ['status', 'group'], 'group'));
  const [hkRoom, setHkRoom] = useState<string | null>(null);
  const [ticketRoom, setTicketRoom] = useState<string | null>(null);
  const [blockRoom, setBlockRoom] = useState<string | null>(null);
  const [taskRoom, setTaskRoom] = useState<string | null>(null);
  const [printing, setPrinting] = useState<false | 'rooms' | 'names'>(false);
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
    if (needle) {
      const by = { room: [r.number], guest: [r.inHouseGuest, r.arrivalGuest, r.inHouseGuests], account: [r.inHouseAccount, r.arrivalAccount], floor: [r.floor], type: [r.roomTypeCode], resno: [r.reservationNumbers] };
      const hay = field === 'all' ? Object.values(by).flat() : by[field];
      // Oda ve kat alanında tam eşleşme (101 yazınca 1101 gelmesin); diğerlerinde içerir.
      if (!hay.some(x => field === 'room' || field === 'floor' ? lc(x) === needle : lc(x).includes(needle))) return false;
    }
    if (acc && (r.inHouseAccount ?? r.arrivalAccount) !== acc) return false;
    if (dep && (r.inHouseDeparture ?? r.arrivalDeparture) !== dep) return false;
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
  const filtered = !!(q.trim() || filter !== 'all' || acc || dep);
  const accounts = useMemo(() => [...new Set(rooms.map(r => r.inHouseAccount ?? r.arrivalAccount).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'tr')), [rooms]);
  const departures = useMemo(() => [...new Set(rooms.map(r => r.inHouseDeparture ?? r.arrivalDeparture).filter((x): x is string => !!x))].sort(), [rooms]);

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
  const newRes = (r: RoomStatus, walkIn: boolean, arrival?: string) => {
    const params: Record<string, string> = walkIn ? { room: r.id } : { room: r.id, type: r.roomTypeId, ...(arrival ? { arrival } : {}) };
    if (windows) windows.open({ kind: walkIn ? 'walk-in' : 'new-reservation', params });
    else nav(walkIn ? `/walk-in?room=${r.id}` : `/reservations/new?room=${r.id}&type=${r.roomTypeId}${arrival ? `&arrival=${arrival}` : ''}`);
  };
  // Odaya oda ücreti bas: bu gecenin oda ücreti gece denetimini beklemeden folyoya yazılır (gece denetimi aynı geceyi tekrar yazmaz).
  const postRoomCharge = async (r: RoomStatus) => {
    if (!r.inHouseReservationId) return;
    if (!await confirm({ title: `Oda ${r.number} · oda ücreti`, message: `${r.inHouseGuest ?? ''} için ${fmtDate(bd)} gecesinin oda ücreti şimdi folyoya yazılacak. Gece denetimi bu geceyi tekrar yazmaz.`, confirmText: 'Oda ücretini bas' })) return;
    try {
      const x = await api<{ amount: string }>('POST', `/api/v1/reservations/${r.inHouseReservationId}/room-charge`, undefined, { key: newKey() });
      await qc.invalidateQueries({ predicate: q => ['roomStatus', 'rooms', 'rack', 'folios', 'reservations', 'dashboard'].includes(String(q.queryKey[0])) });
      toast.ok(`Oda ${r.number}: oda ücreti basıldı (${fmtMoney(String(x.amount), r.inHouseCurrency)}).`);
    } catch (e) { toast.error(e); }
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
    // İleri tarih görünümünde yalnız o tarihe uygun işlemler: rezervasyonu açma, o tarihten başlayan rezervasyon, blokaj.
    if (future) return [
      { label: ih ? `Rezervasyon · ${r.inHouseGuest}` : ar ? `Rezervasyon · ${r.arrivalGuest}` : 'Rezervasyon yok', icon: <FileText size={14} />, disabled: !res, onClick: () => res && openRes(res) },
      { label: `${fmtDate(day)} girişli rezervasyon`, icon: <ClipboardList size={14} />, disabled: !!r.blockKind || !!ar || !can('reservation.create'), onClick: () => newRes(r, false, day) },
      { label: 'Odayı satışa kapat (blokaj)', icon: <Lock size={14} />, disabled: !can('maintenance.manage'), onClick: () => setBlockRoom(r.id) },
    ];
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
          { label: r.departureToday ? 'Oda ücreti bas (bugün çıkış)' : 'Oda ücreti bas (bu gece)', icon: <BedDouble size={14} />, disabled: !can('folio.post') || r.departureToday, onClick: () => void postRoomCharge(r) },
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

  const manual = () => { setAuto(false); savePref(AUTO_KEY, '0'); };
  const turnAuto = () => { setAuto(true); savePref(AUTO_KEY, '1'); };
  const setCols = (n: number | ((c: number) => number)) => setColsState(c => {
    const v = Math.min(COLS_MAX, Math.max(COLS_MIN, Math.round(typeof n === 'function' ? n(c) : n)));
    savePref(COLS_KEY, String(v));
    return v;
  });
  // Ctrl + fare tekerleği ile kartları büyüt/küçült (sayfa yakınlaştırması yerine).
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setAuto(a => { if (a) { savePref(AUTO_KEY, '0'); setColsState(effRef.current); } return false; });
      setCols(c => c + (e.deltaY > 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const effCols = auto ? autoCols : cols;
  const effRef = useRef(effCols);
  effRef.current = effCols;
  useEffect(() => {
    if (!auto) return;
    const area = areaRef.current;
    if (!area) return;
    const scroller = (area.closest('.main, .win-body') as HTMLElement | null) ?? document.documentElement;
    const calc = () => {
      const sr = scroller.getBoundingClientRect(), ar = area.getBoundingClientRect();
      const height = scroller.clientHeight - (ar.top - sr.top + scroller.scrollTop) - 30;
      const counts = layout === 'plan'
        ? [...view.reduce((m, r) => m.set(r.floor?.trim() || '', (m.get(r.floor?.trim() || '') ?? 0) + 1), new Map<string, number>()).values()]
        : [view.length];
      setAutoCols(fitCols(area.clientWidth, Math.max(120, height), counts, layout === 'plan' ? 48 : 0));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(scroller);
    ro.observe(area);
    return () => ro.disconnect();
  }, [auto, layout, view]);
  const print = (mode: 'rooms' | 'names' = 'rooms') => { setPrinting(mode); setTimeout(() => { window.print(); setPrinting(false); }, 80); };
  // Dosyaya aktar: sunucudaki rapor çıktısı (Excel/CSV) doğrudan seçilen konuma kaydedilir.
  const exportFile = async (report: 'room-status' | 'inhouse', format: 'xlsx' | 'csv') => {
    const path = await save({ defaultPath: `${report === 'inhouse' ? 'konaklayanlar' : 'oda-listesi'}-${bd}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path) return;
    try { await download(`/api/v1/reports/${report}/export?format=${format}`, path); toast.ok('Dosya kaydedildi.', path); } catch (e) { toast.error(e); }
  };
  const printMenu = (e: React.MouseEvent) => menu.open(e, [
    { label: sel.size ? `Oda listesi (seçili ${sel.size} oda)` : 'Oda listesi', icon: <Printer size={14} />, onClick: () => print('rooms') },
    { label: sel.size ? `İsim listesi (seçili ${sel.size} oda)` : 'İsim listesi (konaklayanlar, soyada göre)', icon: <Users size={14} />, onClick: () => print('names') },
    { separator: true, label: '' },
    { label: 'Oda listesini Excel dosyasına aktar', icon: <FileText size={14} />, disabled: !can('report.view'), onClick: () => void exportFile('room-status', 'xlsx') },
    { label: 'Konaklayan listesini Excel dosyasına aktar', icon: <FileText size={14} />, disabled: !can('report.view'), onClick: () => void exportFile('inhouse', 'xlsx') },
    { label: 'Konaklayan listesini CSV olarak aktar', icon: <FileText size={14} />, disabled: !can('report.view'), onClick: () => void exportFile('inhouse', 'csv') },
  ]);
  // Süzgeç düğmelerindeki renk noktası kart rengini gösterir (ayrı açıklama şeridi yok).
  const DOT: Partial<Record<Filter, string>> = { vacant: 'vacant', occupied: 'occupied', arrival: 'arrival', departure: 'departure', dirty: 'dirty', blocked: 'blocked' };
  const F = (k: Filter, label: string) => <button className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{DOT[k] && <i className={`fdot tone-${DOT[k]}`} />}{label} ({counts[k]})</button>;

  const tile = (r: RoomStatus) => {
    const t = toneOf(r);
    const names = (r.inHouseGuests ?? r.inHouseGuest ?? r.arrivalGuest ?? '').split(' · ').filter(Boolean);
    return (
      <div key={r.id} className={`room-tile tone-${t}${sel.has(r.id) ? ' selected' : ''}${colorMode === 'group' && r.groupColor ? ' grp-fill' : ''}`} title={tileTitle(r)} aria-selected={sel.has(r.id)}
        style={r.groupColor ? ({ '--grp': r.groupColor, ...(colorMode === 'group' ? { '--tone': r.groupColor, '--tone-text': textOn(r.groupColor) } : {}) } as React.CSSProperties) : undefined}
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
    <div className="page rack-page" ref={pageRef}>
      <div className="rack-tools">
        <div className="seg" title="Kutu rengi: oda durumuna göre veya oda grubuna göre">
          <button className={colorMode === 'status' ? 'active' : ''} onClick={() => { setColorMode('status'); savePref(COLOR_KEY, 'status'); }}>Durum rengi</button>
          <button className={colorMode === 'group' ? 'active' : ''} onClick={() => { setColorMode('group'); savePref(COLOR_KEY, 'group'); }}>Grup rengi</button>
        </div>
        <div className="seg" title="Görünüm">
          <button className={layout === 'rack' ? 'active' : ''} onClick={() => { setLayout('rack'); savePref(LAYOUT_KEY, 'rack'); }}>Rack</button>
          <button className={layout === 'plan' ? 'active' : ''} onClick={() => { setLayout('plan'); savePref(LAYOUT_KEY, 'plan'); }}>Otel Planı</button>
        </div>
        <div className="rack-search">
          <Search size={15} />
          <select className="rack-field" value={field} onChange={e => setField(e.target.value as typeof field)} title="Arama alanı">
            <option value="all">Tümü</option><option value="room">Oda no</option><option value="guest">Misafir</option>
            <option value="account">Firma</option><option value="floor">Kat</option><option value="type">Oda tipi</option><option value="resno">Rez. no</option>
          </select>
          <input className="input" placeholder={field === 'all' ? 'Kişi ara: ad soyad, oda no, firma' : 'Ara…'} value={q} onChange={e => setQ(e.target.value)} autoFocus data-enter="keep" />
          {q && <button className="btn sm ghost" onClick={() => setQ('')} aria-label="Aramayı temizle">×</button>}
        </div>
        <select className="input sm rack-sel" value={acc} onChange={e => setAcc(e.target.value)} title="Firma / acente">
          <option value="">Tüm firmalar</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input sm rack-sel" value={dep} onChange={e => setDep(e.target.value)} title="Çıkış tarihi">
          <option value="">Tüm çıkışlar</option>{departures.map(d => <option key={d} value={d}>Çıkış {fmtDate(d)}</option>)}
        </select>
        <div className="seg">{F('all', 'Tümü')}{F('vacant', 'Boş')}{F('occupied', 'Dolu')}{F('arrival', 'Geliş')}{F('departure', 'Çıkış')}{F('dirty', 'Kirli')}{F('blocked', 'Bloke')}</div>
        <button className="btn sm" onClick={selectMenu} title="Odaları toplu seç (Ctrl+tık tek tek, Shift+tık aralık)"><CheckSquare size={14} /> Seç</button>
        <span className="spacer" />
        <span className="rack-day" title="Rack tarihi: ileri bir tarih seçince o günün doluluğu görünür">
          <input type="date" className="input sm" min={bd} value={day || bd} onChange={e => setDay(e.target.value > bd ? e.target.value : '')} />
          {future && <button className="btn sm ghost" onClick={() => setDay('')}>Bugün</button>}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>{view.length} / {rooms.length} oda</span>
        <div className="seg rack-zoom" title="Kart boyutu (Ctrl + fare tekerleği ile de değişir)">
          <button onClick={() => { manual(); setCols(effCols + 1); }} disabled={effCols >= COLS_MAX} aria-label="Küçült"><Minus size={14} /></button>
          <input type="range" min={COLS_MIN} max={COLS_MAX} value={COLS_MIN + COLS_MAX - effCols} onChange={e => { manual(); setCols(COLS_MIN + COLS_MAX - Number(e.target.value)); }} aria-label="Kart boyutu" />
          <button onClick={() => { manual(); setCols(effCols - 1); }} disabled={effCols <= COLS_MIN} aria-label="Büyült"><Plus size={14} /></button>
          <button className={auto ? 'active' : ''} onClick={turnAuto} title="Kutular pencere boyutuna göre kendiliğinden büyür/küçülür; tüm odalar ekrana sığar">Otomatik</button>
        </div>
        <button className="btn icon" onClick={printMenu} disabled={view.length === 0} title="Önizle / yazdır: oda listesi, isim listesi, dosyaya aktar"><Printer /></button>
      </div>
      {future && <div className="info-box rack-future"><b>{fmtDate(day)}</b> tarihli görünüm: o gece odasında kalacak (odası atanmış) rezervasyonlar dolu, o gün gelecekler geliş, blokajlar bloke görünür. Giriş/çıkış ve tahsilat işlemleri yalnız bugünün görünümünde yapılır.</div>}
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
        <div ref={areaRef}>{layout === 'plan' ? <FloorPlan rooms={view} cols={effCols} tile={tile} />
          : <div className="rack-grid" style={{ '--cols': effCols } as React.CSSProperties}>{view.map(tile)}</div>}</div>
      )}


      {menu.node}
      {hkRoom && <HkStatusModal roomId={hkRoom} onClose={() => setHkRoom(null)} />}
      {ticketRoom && <TicketModal roomId={ticketRoom} onClose={() => setTicketRoom(null)} />}
      {blockRoom && <BlockModal roomId={blockRoom} onClose={() => setBlockRoom(null)} />}
      {taskRoom && <TaskModal roomId={taskRoom} onClose={() => setTaskRoom(null)} />}
      {bulkDlg === 'note' && <BulkNoteModal rooms={selRooms} onClose={() => setBulkDlg(null)} />}
      {bulkDlg === 'charge' && <BulkChargeModal rooms={selRooms} onClose={() => setBulkDlg(null)} />}
      {bulkDlg === 'checkout' && <BulkCheckoutModal rooms={selRooms} onClose={() => setBulkDlg(null)} />}
      {printing && createPortal(printing === 'names'
        ? <NamePrint rooms={sel.size ? selRooms : view} filtered={filtered || sel.size > 0} />
        : <RackPrint rooms={sel.size ? selRooms : view} filtered={filtered || sel.size > 0} />, document.getElementById('print-root')!)}
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

/** İsim listesi: odadaki herkes (ana ve ek misafirler) soyada göre sıralı; resepsiyonda misafir aramak için basılı liste. */
function NamePrint({ rooms, filtered }: { rooms: RoomStatus[]; filtered: boolean }) {
  const { property } = useSession();
  const people = rooms.filter(r => r.inHouseReservationId)
    .flatMap(r => (r.inHouseGuests ?? r.inHouseGuest ?? '').split(' · ').filter(Boolean).map(name => {
      const parts = name.trim().split(/\s+/);
      return { last: parts.length > 1 ? parts[parts.length - 1] : name, first: parts.slice(0, -1).join(' '), room: r };
    }))
    .sort((a, b) => a.last.localeCompare(b.last, 'tr') || a.first.localeCompare(b.first, 'tr'));
  return (
    <div className="doc folio-doc report-doc dense">
      <DocHeader kind="İsim Listesi" no={`İş günü ${fmtDate(property?.businessDate)}`} lines={[`${people.length} kişi${filtered ? ' · filtre uygulandı' : ''}`]} />
      <table className="fd-table">
        <thead><tr><th>Soyadı</th><th>Adı</th><th>Oda</th><th>Tip</th><th>Firma / acente</th><th>Çıkış</th></tr></thead>
        <tbody>{people.map((p, i) => (
          <tr key={i}><td><b>{p.last}</b></td><td>{p.first}</td><td>{p.room.number}</td><td>{p.room.roomTypeCode}</td>
            <td>{p.room.inHouseAccount ?? ''}</td><td>{fmtDate(p.room.inHouseDeparture)}</td></tr>
        ))}</tbody>
      </table>
      <DocFooter note={`${people.length} kişi listelendi.`} />
    </div>
  );
}

/** Otel planı: odalar katlarına göre satır satır; her katın doluluk özeti başlıkta. */
function FloorPlan({ rooms, cols, tile }: { rooms: RoomStatus[]; cols: number; tile: (r: RoomStatus) => React.ReactNode }) {
  const floors = new Map<string, RoomStatus[]>();
  for (const r of rooms) {
    const k = r.floor?.trim() || '';
    if (!floors.has(k)) floors.set(k, []);
    floors.get(k)!.push(r);
  }
  const keys = [...floors.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'tr', { numeric: true })));
  return (
    <div className="floor-plan">
      {keys.map(k => {
        const list = floors.get(k)!;
        const occ = list.filter(r => r.foStatus === 'occupied').length;
        return (
          <section key={k || '-'} className="fp-floor">
            <header><b>{k ? `${k}. kat` : 'Kat bilgisi yok'}</b><span className="muted">{list.length} oda · {occ} dolu · {list.length - occ} boş</span></header>
            <div className="rack-grid" style={{ '--cols': cols } as React.CSSProperties}>{list.map(tile)}</div>
          </section>
        );
      })}
    </div>
  );
}
