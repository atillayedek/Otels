import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, BedDouble, Brush, Building2, CalendarRange, ChevronRight, ClipboardList, CreditCard, FileSpreadsheet, Gauge, LayoutGrid, LogOut,
  Moon, PanelLeftClose, PanelLeftOpen, PlaneLanding, PlaneTakeoff, Search, Settings, ShieldCheck, Tags, Users, Wrench, AlarmClock, Wallet, UserPlus,
  Utensils, Package, Calculator, LifeBuoy,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { fmtDate } from '../lib/format';
import { SupportModal } from './Support';

interface NavItem { to: string; label: string; perm?: string | string[] }
interface NavGroup { label: string; icon: ReactNode; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'Gösterge Paneli', icon: <Gauge size={17} />, items: [{ to: '/', label: 'Genel Durum', perm: 'dashboard.view' }] },
  {
    label: 'Rezervasyon', icon: <CalendarRange size={17} />, items: [
      { to: '/reservations/new', label: 'Yeni Rezervasyon', perm: 'reservation.create' },
      { to: '/reservations?view=all', label: 'Rezervasyon Listesi', perm: 'reservation.view' },
      { to: '/groups', label: 'Grup Rezervasyonları', perm: 'reservation.view' },
      { to: '/allotments', label: 'Acente Kontenjanları', perm: 'reservation.view' },
      { to: '/availability', label: 'Fiyat ve Doluluk', perm: 'reservation.view' },
      { to: '/companies', label: 'Şirketler', perm: 'reservation.view' },
      { to: '/agencies', label: 'Acenteler', perm: 'reservation.view' },
      { to: '/settings/rates', label: 'Fiyat Planları', perm: 'rate.manage' },
    ],
  },
  {
    label: 'Resepsiyon', icon: <BedDouble size={17} />, items: [
      { to: '/rack', label: 'Oda Rack', perm: 'reservation.view' },
      { to: '/blokaj', label: 'Blokaj (Zaman Çizelgesi)', perm: 'reservation.view' },
      { to: '/reservations?view=arrivals', label: 'Beklenen Gelişler', perm: 'reservation.view' },
      { to: '/reservations?view=departures', label: 'Beklenen Çıkışlar', perm: 'reservation.view' },
      { to: '/reservations?view=inhouse', label: 'Konaklayanlar', perm: 'reservation.view' },
      { to: '/walk-in', label: 'Walk-in', perm: ['checkin.execute', 'reservation.create'] },
      { to: '/wakeups', label: 'Uyandırmalar', perm: 'reservation.view' },
      { to: '/kbs', label: 'Kimlik Bildirimi (KBS)', perm: 'kbs.manage' },
    ],
  },
  { label: 'Misafirler', icon: <Users size={17} />, items: [{ to: '/guests', label: 'Misafir Kartları', perm: 'guest.view' }] },
  {
    label: 'Ön Kasa', icon: <Wallet size={17} />, items: [
      { to: '/cashier', label: 'Kasa Vardiyası', perm: 'cashier.manage' },
      { to: '/exchange-rates', label: 'Döviz Kurları', perm: 'folio.view' },
      { to: '/reports/folio-balances', label: 'Açık Folyolar', perm: 'financial_report.view' },
      { to: '/reports/company-ledger', label: 'Şirket Cari', perm: 'financial_report.view' },
      { to: '/settings/finance', label: 'İşlem Kodları ve Ödeme Tipleri', perm: 'settings.manage' },
    ],
  },
  {
    label: 'Kat Hizmetleri', icon: <Brush size={17} />, items: [
      { to: '/housekeeping', label: 'Oda Durumları', perm: 'housekeeping.view' },
      { to: '/housekeeping/tasks', label: 'Görevler', perm: 'housekeeping.view' },
    ],
  },
  {
    label: 'Teknik Servis', icon: <Wrench size={17} />, items: [
      { to: '/maintenance', label: 'Arıza Kayıtları', perm: 'maintenance.view' },
      { to: '/maintenance/blocks', label: 'Oda Blokajları', perm: 'maintenance.view' },
    ],
  },
  {
    label: 'Restoran / Bar', icon: <Utensils size={17} />, items: [
      { to: '/pos', label: 'Satış Ekranı (Adisyon)', perm: 'pos.view' },
      { to: '/settings/pos', label: 'Menü ve Satış Noktaları', perm: 'pos.manage' },
    ],
  },
  {
    label: 'Stok ve Satın Alma', icon: <Package size={17} />, items: [
      { to: '/stock', label: 'Stok', perm: 'stock.view' },
      { to: '/purchase-orders', label: 'Satın Alma Siparişleri', perm: 'purchase.manage' },
    ],
  },
  {
    label: 'Muhasebe', icon: <Calculator size={17} />, items: [
      { to: '/accounting', label: 'Fişler ve Hesap Planı', perm: 'accounting.view' },
      { to: '/reports/trial_balance', label: 'Mizan', perm: 'accounting.view' },
      { to: '/reports/account_statement', label: 'Hesap Ekstresi', perm: 'accounting.view' },
    ],
  },
  { label: 'Gün Sonu', icon: <Moon size={17} />, items: [{ to: '/night-audit', label: 'Gece Denetimi', perm: 'night_audit.execute' }] },
  { label: 'Raporlar', icon: <BarChart3 size={17} />, items: [{ to: '/reports', label: 'Tüm Raporlar', perm: 'report.view' }] },
  {
    label: 'Yönetim', icon: <Settings size={17} />, items: [
      { to: '/settings/property', label: 'Tesis Bilgileri', perm: 'settings.manage' },
      { to: '/settings/rooms', label: 'Oda ve Oda Tipleri', perm: 'room.manage' },
      { to: '/settings/users', label: 'Kullanıcılar ve Roller', perm: 'user.manage' },
      { to: '/settings/devices', label: 'Cihazlar ve Oturumlar', perm: 'device.manage' },
      { to: '/settings/backup', label: 'Yedekleme', perm: 'backup.manage' },
      { to: '/settings/import', label: 'Veri Aktarım Merkezi', perm: 'migration.manage' },
      { to: '/settings/printers', label: 'Yazıcılar', perm: 'printer.manage' },
      { to: '/settings/audit', label: 'Denetim Kayıtları', perm: 'audit.view' },
      { to: '/settings/connection', label: 'Sunucu Bağlantısı' },
    ],
  },
];

/** Kullanıcının yetkili olduğu ilk ekran (gösterge paneli yetkisi olmayan roller için açılış sayfası). */
export function firstAllowedRoute(can: (p: string) => boolean): string | null {
  for (const g of NAV) for (const i of g.items) {
    const ok = !i.perm || (Array.isArray(i.perm) ? i.perm.every(can) : can(i.perm));
    if (ok && i.to !== '/settings/connection') return i.to;
  }
  return null;
}

/** Üst menü sayaçları için genel durum özetinin kullanılan alanları. */
interface QuickCounts { arrivalsExpected: number; arrivalsCheckedIn: number; departuresExpected: number; departuresCheckedOut: number; vacantDirty: number; pendingWakeups: number; kbsPending: number }

/** Üst menü: her modülün kendi rengi var; bekleyen iş sayıları rozet olarak görünür. */
const QUICK: { to: string; label: string; icon: ReactNode; perm: string | string[]; tone: string; badge?: (c: QuickCounts) => number }[] = [
  { to: '/', label: 'Durum', icon: <Gauge />, perm: 'dashboard.view', tone: '#4f46e5' },
  { to: '/rack', label: 'Rack', icon: <LayoutGrid />, perm: 'reservation.view', tone: '#2563eb' },
  { to: '/blokaj', label: 'Blokaj', icon: <CalendarRange />, perm: 'reservation.view', tone: '#0284c7' },
  { to: '/availability', label: 'Fiyat/Doluluk', icon: <Tags />, perm: 'reservation.view', tone: '#0d9488' },
  { to: '/reservations/new', label: 'Rezervasyon', icon: <ClipboardList />, perm: 'reservation.create', tone: '#7c3aed' },
  { to: '/walk-in', label: 'Walk-in', icon: <UserPlus />, perm: ['checkin.execute', 'reservation.create'], tone: '#c026d3' },
  { to: '/reservations?view=arrivals', label: 'Gelişler', icon: <PlaneLanding />, perm: 'reservation.view', tone: '#16a34a', badge: c => c.arrivalsExpected - c.arrivalsCheckedIn },
  { to: '/reservations?view=departures', label: 'Çıkışlar', icon: <PlaneTakeoff />, perm: 'reservation.view', tone: '#ea580c', badge: c => c.departuresExpected - c.departuresCheckedOut },
  { to: '/reservations?view=inhouse', label: 'Konaklayan', icon: <BedDouble />, perm: 'reservation.view', tone: '#9333ea' },
  { to: '/cashier', label: 'Ön Kasa', icon: <CreditCard />, perm: 'cashier.manage', tone: '#059669' },
  { to: '/pos', label: 'Adisyon', icon: <Utensils />, perm: 'pos.view', tone: '#d97706' },
  { to: '/housekeeping', label: 'Kat Hiz.', icon: <Brush />, perm: 'housekeeping.view', tone: '#0891b2', badge: c => c.vacantDirty },
  { to: '/wakeups', label: 'Uyandırma', icon: <AlarmClock />, perm: 'reservation.view', tone: '#e11d48', badge: c => c.pendingWakeups },
  { to: '/night-audit', label: 'Gün Sonu', icon: <Moon />, perm: 'night_audit.execute', tone: '#334155' },
  { to: '/reports', label: 'Raporlar', icon: <FileSpreadsheet />, perm: 'report.view', tone: '#475569' },
];

const initials = (name?: string) => (name ?? '').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toLocaleUpperCase('tr-TR')).join('') || '?';

export function Layout({ children }: { children: ReactNode }) {
  const { me, property, connected, dbAvailable, client, can: canOne, logout } = useSession();
  const can = (p?: string | string[]) => !p || (Array.isArray(p) ? p.every(canOne) : canOne(p));
  const [collapsed, setCollapsed] = useState(false);
  const [support, setSupport] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string[]>(['Resepsiyon', 'Rezervasyon']);
  const loc = useLocation();
  const nav = useNavigate();
  const here = loc.pathname + loc.search;
  // Sayaçlar genel durum özetinden gelir; gerçek zamanlı değişikliklerde ('dashboard' anahtarı) kendiliğinden yenilenir.
  const counts = useQuery({ queryKey: ['dashboard'], queryFn: () => get<QuickCounts>('/api/v1/dashboard'), enabled: can('dashboard.view'), refetchInterval: 60_000 });

  const groups = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr-TR');
    return NAV.map(g => ({ ...g, items: g.items.filter(i => can(i.perm) && (!needle || i.label.toLocaleLowerCase('tr-TR').includes(needle))) }))
      .filter(g => g.items.length > 0);
  }, [q, canOne]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><img src="/logo.svg" alt="" /><span>TSDMR Otel PMS<small>{property?.name}</small></span></div>
        <div className="menu-search"><Search size={14} /><input placeholder="Menüde ara" value={q} onChange={e => setQ(e.target.value)} /></div>
        <nav className="nav">
          {groups.map(g => {
            const isOpen = q !== '' || open.includes(g.label) || collapsed;
            if (g.items.length === 1 && g.items[0].label === 'Genel Durum') {
              return <NavLink key={g.label} to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>{g.icon}<span className="nav-label">{g.label}</span></NavLink>;
            }
            return (
              <div key={g.label} className={`nav-group ${isOpen ? 'open' : ''}`}>
                <button onClick={() => setOpen(o => o.includes(g.label) ? o.filter(x => x !== g.label) : [...o, g.label])} title={g.label}>
                  {g.icon}<span className="nav-label">{g.label}</span><ChevronRight size={14} className="chev" />
                </button>
                {isOpen && !collapsed && (
                  <div className="nav-sub">
                    {g.items.map(i => <a key={i.to} href="#" className={here === i.to ? 'active' : ''} onClick={e => { e.preventDefault(); nav(i.to); }}>{i.label}</a>)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div style={{ padding: 8, borderTop: '1px solid #334155' }}>
          <button className="btn ghost" style={{ color: '#cbd5e1', width: '100%', justifyContent: 'flex-start' }} onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}<span className="nav-label">Menüyü daralt</span>
          </button>
        </div>
      </aside>

      <header className="topbar">
        <div className="quick">
          {QUICK.filter(i => can(i.perm)).map(i => {
            const n = i.badge && counts.data ? Math.max(0, i.badge(counts.data)) : 0;
            const active = here === i.to || (i.to !== '/' && loc.pathname === i.to.split('?')[0] && !i.to.includes('?'));
            return (
              <button key={i.to} className={active ? 'active' : ''} style={{ '--tone': i.tone } as CSSProperties} onClick={() => nav(i.to)}
                title={n ? `${i.label}: ${n} bekleyen` : i.label}>
                <span className="qi">{i.icon}{n > 0 && <em>{n > 99 ? '99+' : n}</em>}</span><span className="ql">{i.label}</span>
              </button>
            );
          })}
        </div>
        <div className="top-right">
          <div className="bizdate" title="Gece denetimiyle bir sonraki güne geçer"><CalendarRange /><span><small>İş günü</small><b>{fmtDate(property?.businessDate)}</b></span></div>
          <button className="btn ghost icon" onClick={() => setSupport(true)} title="Yardım ve destek"><LifeBuoy /></button>
          <button className="user-chip" onClick={() => nav('/account')} title="Hesabım"><span className="avatar">{initials(me?.fullName)}</span><span className="who"><b>{me?.fullName}</b><small><ShieldCheck size={11} /> {me?.username}</small></span></button>
          <button className="btn ghost icon" onClick={() => void logout()} title="Oturumu kapat"><LogOut /></button>
        </div>
      </header>
      {support && <SupportModal onClose={() => setSupport(false)} />}

      <main className="main">
        {!connected && <div className="banner danger"><span className="dot off" />Sunucu bağlantısı kesildi. Otomatik olarak yeniden bağlanılıyor… Bağlantı kurulana kadar yapılan işlemler kaydedilmez.</div>}
        {!dbAvailable && <div className="banner warning">Veritabanı bağlantısı geçici olarak kullanılamıyor. Yeni işlem kabul edilmiyor.</div>}
        {children}
      </main>

      <footer className="statusbar">
        <span><span className={`dot ${connected ? 'on' : 'off'}`} />{connected ? 'Bağlı' : 'Bağlantı yok'}</span><span className="sep" />
        <span><Building2 size={12} /> {client?.activeServer ? `${client.activeServer.name} (${client.activeServer.host}:${client.activeServer.port})` : '-'}</span><span className="sep" />
        <span>Kullanıcı: {me?.username}</span><span className="sep" />
        <span>İş günü: {fmtDate(property?.businessDate)}</span><span className="sep" />
        <span>Cihaz: {client?.hostname}</span>
        <span className="spacer" />
        <span>TSDMR Digital Studio · İstemci {client?.version}</span>
      </footer>
    </div>
  );
}
