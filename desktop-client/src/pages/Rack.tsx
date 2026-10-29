import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, ArrowRightLeft, BedDouble, BellOff, Bell, Brush, CalendarClock, CalendarRange, ClipboardList, CreditCard, Crown, FileText, Layers, List, Lock, LogIn, LogOut,
  Minus, NotebookPen, Pencil, Plus, Printer, Search, ShieldCheck, StickyNote, Tag, UserPlus, Users, Utensils, Wrench, XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useRoomGroups, useRoomStatus, useRoomTypes } from '../lib/queries';
import { useSession } from '../lib/session';
import { BLOCK_LABEL, fmtDate, fmtDateTime, fmtMoney, HK_LABEL } from '../lib/format';
import type { RoomStatus } from '../lib/types';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Spinner, useContextMenu, useToast, type MenuItem } from '../components/ui';
import { HkStatusModal, TicketModal } from '../components/RoomActions';
import { DocFooter, DocHeader } from '../components/PrintDoc';
import { useWindows } from '../components/Windows';
import { BlockModal } from './RoomBlocks';
import { TaskModal } from './HkTasks';

type Filter = 'all' | 'vacant' | 'occupied' | 'arrival' | 'departure' | 'dirty' | 'blocked';
type Size = 's' | 'm' | 'l';
type Layout = 'floor' | 'flow';
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
const LAYOUT_KEY = 'pms-rack-layout';
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
  const types = useRoomTypes();
  const groups = useRoomGroups();
  const menu = useContextMenu();
  const [filter, setFilter] = useState<Filter>('all');
  const [typeId, setTypeId] = useState('');
  const [floor, setFloor] = useState('');
  const [groupId, setGroupId] = useState('');
  const [account, setAccount] = useState('');
  const [inDate, setInDate] = useState('');
  const [outDate, setOutDate] = useState('');
  const [q, setQ] = useState('');
  const [size, setSize] = useState<Size>(() => readPref(SIZE_KEY, ['s', 'm', 'l'], 'm'));
  const [layout, setLayout] = useState<Layout>(() => readPref(LAYOUT_KEY, ['floor', 'flow'], 'floor'));
  const [hkRoom, setHkRoom] = useState<string | null>(null);
  const [ticketRoom, setTicketRoom] = useState<string | null>(null);
  const [blockRoom, setBlockRoom] = useState<string | null>(null);
  const [taskRoom, setTaskRoom] = useState<string | null>(null);
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
  const tones = useMemo(() => {
    const m: Record<Tone, number> = { vacant: 0, occupied: 0, departure: 0, arrival: 0, dirty: 0, cleaning: 0, inspected: 0, blocked: 0 };
    for (const r of rooms) m[toneOf(r)]++;
    return m;
  }, [rooms]);

  // Arama: oda no, odadaki herkesin adı (ana ve ek misafirler, bugünkü geliş dahil), firma/acente.
  const needle = lc(q.trim());
  const view = rooms.filter(r => {
    if (typeId && r.roomTypeId !== typeId) return false;
    if (floor && r.floor !== floor) return false;
    if (groupId && (groupId === '-' ? !!r.groupId : r.groupId !== groupId)) return false;
    if (account && r.inHouseAccount !== account && r.arrivalAccount !== account) return false;
    if (inDate && localDate(r.inHouseCheckedInAt) !== inDate && !(r.arrivalReservationId && property?.businessDate === inDate)) return false;
    if (outDate && r.inHouseDeparture !== outDate && r.arrivalDeparture !== outDate) return false;
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
  const filtered = !!(typeId || floor || groupId || account || inDate || outDate || q.trim() || filter !== 'all');
  const byFloor = useMemo(() => {
    const m = new Map<string, RoomStatus[]>();
    for (const r of view) { const k = r.floor ?? ''; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.entries()];
  }, [view]);

  /** Konaklama penceresi (arkadaki rack yerinde kalır); pencere sistemi yoksa sayfaya gider. */
  const openRes = (id: string, action?: string) => (windows ? windows.open({ kind: 'reservation', id, action }) : nav(`/reservations/${id}${action ? `?do=${action}` : ''}`));
  const newRes = (r: RoomStatus, walkIn: boolean) => {
    const params: Record<string, string> = walkIn ? { room: r.id } : { room: r.id, type: r.roomTypeId };
    if (windows) windows.open({ kind: walkIn ? 'walk-in' : 'new-reservation', params });
    else nav(walkIn ? `/walk-in?room=${r.id}` : `/reservations/new?room=${r.id}&type=${r.roomTypeId}`);
  };
  const bulk = async (r: RoomStatus, body: Record<string, unknown>, done: string) => {
    try {
      await api('POST', '/api/v1/rooms/bulk-housekeeping', { roomIds: [r.id], setNote: false, setGroup: false, ...body });
      await qc.invalidateQueries({ predicate: x => ['roomStatus', 'rooms', 'rack'].includes(String(x.queryKey[0])) });
      toast.ok(`Oda ${r.number}: ${done}`);
    } catch (e) { toast.error(e); }
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
          { label: 'Tahsilat al', icon: <CreditCard size={14} />, disabled: !can('payment.create'), onClick: () => ih && openRes(ih, 'payment') },
          { label: 'Masraf gir', icon: <Plus size={14} />, disabled: !can('folio.post'), onClick: () => ih && openRes(ih, 'charge') },
          { label: 'Adisyon aç (restoran / bar)', icon: <Utensils size={14} />, disabled: !can('pos.order'), onClick: () => nav(`/pos?room=${encodeURIComponent(r.number)}`) },
          { label: 'Hesap hareketleri (folyo)', icon: <FileText size={14} />, onClick: () => ih && openRes(ih) },
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
  const setLay = (l: Layout) => { setLayout(l); savePref(LAYOUT_KEY, l); };
  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); };
  const F = (k: Filter, label: string) => <button className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label} ({counts[k]})</button>;

  const tile = (r: RoomStatus) => {
    const t = toneOf(r);
    const names = (r.inHouseGuests ?? r.inHouseGuest ?? r.arrivalGuest ?? '').split(' · ').filter(Boolean);
    return (
      <div key={r.id} className={`room-tile tone-${t}`} title={tileTitle(r)}
        style={r.groupColor ? ({ '--grp': r.groupColor } as React.CSSProperties) : undefined}
        onClick={e => menu.open(e, items(r))} onContextMenu={e => menu.open(e, items(r))}
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
      <PageHead title="Oda Rack" sub={`İş günü ${fmtDate(property?.businessDate)} · gösterilen ${view.length} / ${rooms.length} oda`} actions={<>
        <div className="seg" title="Yerleşim">
          <button className={layout === 'floor' ? 'active' : ''} onClick={() => setLay('floor')} title="Her kat bir satır"><Layers size={14} /> Kat kat</button>
          <button className={layout === 'flow' ? 'active' : ''} onClick={() => setLay('flow')} title="Odalar art arda">Akış</button>
        </div>
        <div className="seg" title="Kart boyutu">
          <button className={size === 's' ? 'active' : ''} onClick={() => setZoom('s')} aria-label="Küçült"><Minus size={14} /></button>
          <button className={size === 'm' ? 'active' : ''} onClick={() => setZoom('m')}>Normal</button>
          <button className={size === 'l' ? 'active' : ''} onClick={() => setZoom('l')} aria-label="Büyült"><Plus size={14} /></button>
        </div>
        <button className="btn" onClick={print} disabled={view.length === 0}><Printer /> Yazdır</button>
        {can('checkin.execute') && can('reservation.create') && <button className="btn" onClick={() => (windows ? windows.open({ kind: 'walk-in' }) : nav('/walk-in'))}><UserPlus /> Walk-in</button>}
        {can('reservation.create') && <button className="btn primary" onClick={() => (windows ? windows.open({ kind: 'new-reservation' }) : nav('/reservations/new'))}><ClipboardList /> Yeni rezervasyon</button>}
      </>} />

      <div className="rack-tools">
        <div className="rack-search">
          <Search size={15} />
          <input className="input" placeholder="Kişi ara: ad soyad, oda no, firma" value={q} onChange={e => setQ(e.target.value)} autoFocus data-enter="keep" />
          {q && <button className="btn sm ghost" onClick={() => setQ('')} aria-label="Aramayı temizle">×</button>}
        </div>
        <div className="seg">{F('all', 'Tümü')}{F('vacant', 'Boş')}{F('occupied', 'Dolu')}{F('arrival', 'Geliş')}{F('departure', 'Çıkış')}{F('dirty', 'Kirli')}{F('blocked', 'Bloke')}</div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12, gap: 10 }}>
        <select className="input" style={{ width: 160 }} value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">Tüm oda tipleri</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select>
        {floors.length > 0 && <select className="input" style={{ width: 110 }} value={floor} onChange={e => setFloor(e.target.value)}><option value="">Tüm katlar</option>{floors.map(f => <option key={f} value={f}>{f}. kat</option>)}</select>}
        {(groups.data?.length ?? 0) > 0 && <select className="input" style={{ width: 150 }} value={groupId} onChange={e => setGroupId(e.target.value)}>
          <option value="">Tüm oda grupları</option>{groups.data!.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}<option value="-">Grubu olmayanlar</option>
        </select>}
        <select className="input" style={{ width: 190 }} value={account} onChange={e => setAccount(e.target.value)} title="Şirket veya acente">
          <option value="">Tüm firma / acenteler</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="row muted" style={{ gap: 6, fontSize: 12.5 }}>Giriş <input type="date" className="input" style={{ width: 150 }} value={inDate} onChange={e => setInDate(e.target.value)} /></label>
        <label className="row muted" style={{ gap: 6, fontSize: 12.5 }}>Çıkış <input type="date" className="input" style={{ width: 150 }} value={outDate} onChange={e => setOutDate(e.target.value)} /></label>
        {filtered && <button className="btn sm ghost" onClick={() => { setFilter('all'); setTypeId(''); setFloor(''); setGroupId(''); setAccount(''); setInDate(''); setOutDate(''); setQ(''); }}>Filtreleri temizle</button>}
      </div>

      {status.isLoading ? <Spinner /> : status.error ? <ErrorBox error={status.error} /> : rooms.length === 0 ? (
        <Empty icon={<BedDouble />} title="Henüz oda tanımlanmamış" text="Odaları Yönetim → Oda ve Oda Tipleri ekranından ekleyin." action={can('room.manage') ? <button className="btn primary" onClick={() => nav('/settings/rooms')}>Oda tanımla</button> : undefined} />
      ) : view.length === 0 ? <Empty title={needle ? `"${q.trim()}" ile eşleşen oda veya misafir yok` : 'Bu filtreye uyan oda yok'} /> : layout === 'floor' && floors.length > 0 ? (
        <div className={`rack-floors size-${size}`}>
          {byFloor.map(([f, list]) => (
            <div key={f} className="rack-floor">
              <div className="rf-label">{f ? <>{f}<small>. kat</small></> : '—'}</div>
              <div className="rack-row">{list.map(tile)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`rack-grid size-${size}`}>{view.map(tile)}</div>
      )}

      {/* Oda durum bilgileri: her rengin anlamı ve kaç oda olduğu */}
      {rooms.length > 0 && (
        <div className="rack-legend">
          {([['vacant', 'Boş (temiz)'], ['occupied', 'Dolu'], ['departure', 'Bugün çıkış'], ['arrival', 'Geliş bekleniyor'], ['dirty', 'Kirli (boş)'], ['cleaning', 'Temizleniyor'], ['inspected', 'Kontrol edildi'], ['blocked', 'Bloke / arızalı']] as [Tone, string][]).map(([k, l]) => (
            <button key={k} className={`rl-item tone-${k}`} onClick={() => setFilter(k === 'vacant' ? 'vacant' : k === 'occupied' ? 'occupied' : k === 'departure' ? 'departure' : k === 'arrival' ? 'arrival' : k === 'dirty' ? 'dirty' : k === 'blocked' ? 'blocked' : 'all')} title={`${l}: ${tones[k]} oda`}>
              <i />{l}<b>{tones[k]}</b>
            </button>
          ))}
          <span className="rl-sep" />
          <span className="rl-hint">Kartın alt şeridi temizlik durumunu gösterir (<span className="hk-chip hk-dirty">Kirli</span> <span className="hk-chip hk-clean">Temiz</span> <span className="hk-chip hk-inspected">Kontrol edildi</span> <span className="hk-chip hk-cleaning">Temizleniyor</span>) · sol çizgi oda grubunun rengidir · renkler Görünüm ayarından değiştirilir.</span>
        </div>
      )}

      {menu.node}
      {hkRoom && <HkStatusModal roomId={hkRoom} onClose={() => setHkRoom(null)} />}
      {ticketRoom && <TicketModal roomId={ticketRoom} onClose={() => setTicketRoom(null)} />}
      {blockRoom && <BlockModal roomId={blockRoom} onClose={() => setBlockRoom(null)} />}
      {taskRoom && <TaskModal roomId={taskRoom} onClose={() => setTaskRoom(null)} />}
      {printing && createPortal(<RackPrint rooms={view} filtered={filtered} />, document.getElementById('print-root')!)}
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
