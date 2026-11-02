import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useWindows, type WinSpec } from './Windows';

/** Üst çubuktaki bir düğmenin hızlı menüsü: işlemler ve o bölüme ait raporlar. */
export interface HoverItem { label: string; to?: string; win?: WinSpec; perm?: string | string[]; report?: boolean }

export const QUICK_HOVER: Record<string, HoverItem[]> = {
  '/rack': [
    { label: 'Oda Rack', to: '/rack' },
    { label: 'Blokaj çizelgesi', to: '/blokaj' },
    { label: 'Oda durumları (kat hizmetleri)', to: '/housekeeping', perm: 'housekeeping.view' },
    { label: 'Kullanımdaki kartlar', to: '/key-cards' },
    { label: 'Stop sale ve satış takvimi', to: '/sales-calendar' },
    { label: 'Boş oda listesi', to: '/reports/vacant-rooms', perm: 'report.view', report: true },
    { label: 'Oda durum raporu', to: '/reports/room-status', perm: 'report.view', report: true },
    { label: 'Oda değişim raporu', to: '/reports/room-moves', perm: 'report.view', report: true },
  ],
  '/reservations/new': [
    { label: 'Yeni rezervasyon', to: '/reservations/new', win: { kind: 'new-reservation' }, perm: 'reservation.create' },
    { label: 'Rezervasyon listesi', to: '/reservations?view=all' },
    { label: 'Grup rezervasyonları', to: '/groups' },
    { label: 'Acente kontenjanları', to: '/allotments' },
    { label: 'Stop sale ve satış takvimi', to: '/sales-calendar' },
    { label: 'Şirketler', to: '/companies' },
    { label: 'Acenteler', to: '/agencies' },
    { label: 'Fiyat planları', to: '/settings/rates', perm: 'rate.manage' },
    { label: 'No-show ve iptaller', to: '/reports/no-show-cancel', perm: 'report.view', report: true },
    { label: 'Satış kanalı üretimi', to: '/reports/channel_production', perm: 'report.view', report: true },
  ],
  '/reservations?view=arrivals': [
    { label: 'Beklenen gelişler', to: '/reservations?view=arrivals' },
    { label: 'Walk-in', to: '/walk-in', win: { kind: 'walk-in' }, perm: ['checkin.execute', 'reservation.create'] },
    { label: 'Geliş listesi', to: '/reports/arrivals', perm: 'report.view', report: true },
    { label: 'Polis listesi', to: '/reports/police-list', perm: 'kbs.manage', report: true },
    { label: 'Kimlik bildirimi (KBS)', to: '/kbs', perm: 'kbs.manage' },
  ],
  '/reservations?view=departures': [
    { label: 'Beklenen çıkışlar', to: '/reservations?view=departures' },
    { label: 'Çıkış listesi', to: '/reports/departures', perm: 'report.view', report: true },
    { label: 'Açık folyo bakiyeleri', to: '/reports/folio-balances', perm: 'financial_report.view', report: true },
  ],
  '/reservations?view=inhouse': [
    { label: 'Konaklayanlar', to: '/reservations?view=inhouse' },
    { label: 'Misafir kartları', to: '/guests', perm: 'guest.view' },
    { label: 'Misafir yorumları', to: '/feedback', perm: 'feedback.manage' },
    { label: 'Misafir hatırlatmaları', to: '/traces', perm: 'trace.manage' },
    { label: 'Konaklayan misafirler', to: '/reports/inhouse', perm: 'report.view', report: true },
    { label: 'Misafir listesi (ek misafirler dahil)', to: '/reports/guest-list', perm: 'report.view', report: true },
    { label: 'Uyruğa göre konaklama', to: '/reports/nationality', perm: 'report.view', report: true },
  ],
  '/cashier': [
    { label: 'Kasa vardiyası', to: '/cashier', perm: 'cashier.manage' },
    { label: 'Peşin satış (Alt+6)', to: '/cash-sale', win: { kind: 'cash-sale' }, perm: ['folio.post', 'payment.create'] },
    { label: 'Döviz kurları', to: '/exchange-rates' },
    { label: 'Şirketler (cari tahsilat)', to: '/companies' },
    { label: 'Kasa raporu', to: '/reports/cashier', perm: 'financial_report.view', report: true },
    { label: 'Kasa hareketleri', to: '/reports/cash-movements', perm: 'financial_report.view', report: true },
    { label: 'Tahsilat detayı', to: '/reports/payments', perm: 'financial_report.view', report: true },
    { label: 'Kesilen faturalar', to: '/reports/invoices', perm: 'financial_report.view', report: true },
    { label: 'Şirket cari', to: '/reports/company-ledger', perm: 'financial_report.view', report: true },
  ],
  '/housekeeping': [
    { label: 'Oda durumları', to: '/housekeeping' },
    { label: 'Görevler', to: '/housekeeping/tasks' },
    { label: 'Kayıp eşya', to: '/lost-found', perm: 'lost_found.manage' },
    { label: 'Arıza kayıtları', to: '/maintenance', perm: 'maintenance.view' },
    { label: 'Boş oda listesi', to: '/reports/vacant-rooms', perm: 'report.view', report: true },
    { label: 'Bekleyen görevler', to: '/reports/pending-tasks', perm: 'report.view', report: true },
    { label: 'Oda kat görevlisi raporu', to: '/reports/hk-attendants', perm: 'report.view', report: true },
    { label: 'Uyuşmazlık raporu', to: '/reports/room-discrepancy', perm: 'report.view', report: true },
    { label: 'Operasyon raporu', to: '/reports/operations', perm: 'report.view', report: true },
    { label: 'Kat hizmetleri görev raporu', to: '/reports/housekeeping', perm: 'report.view', report: true },
    { label: 'Kayıp bulundu raporu', to: '/reports/lost-found', perm: 'report.view', report: true },
  ],
  '/night-audit': [
    { label: 'Gece denetimi', to: '/night-audit', perm: 'night_audit.execute' },
    { label: 'Gece denetimi geçmişi', to: '/reports/night-audit', perm: 'report.view', report: true },
    { label: 'Doluluk, ADR ve RevPAR', to: '/reports/occupancy', perm: 'financial_report.view', report: true },
  ],
};

/**
 * Üst çubuk düğmesinin üzerinde kısa süre durunca o bölümün hızlı menüsü açılır (tıklama düğmenin kendi işini yapar).
 * Menü fare menüden çıkınca kapanır; ekranı kaplamaz.
 */
export function useQuickHover() {
  const nav = useNavigate();
  const windows = useWindows();
  const { can } = useSession();
  const [open, setOpen] = useState<{ key: string; x: number; y: number } | null>(null);
  const openT = useRef<number>();
  const closeT = useRef<number>();
  useEffect(() => () => { window.clearTimeout(openT.current); window.clearTimeout(closeT.current); }, []);

  const bind = (key: string) => QUICK_HOVER[key] ? {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      window.clearTimeout(closeT.current);
      const r = e.currentTarget.getBoundingClientRect();
      openT.current = window.setTimeout(() => setOpen({ key, x: r.left, y: r.bottom + 4 }), 350);
    },
    onMouseLeave: () => { window.clearTimeout(openT.current); closeT.current = window.setTimeout(() => setOpen(null), 220); },
    onClick: () => { window.clearTimeout(openT.current); setOpen(null); },
  } : {};

  const allowed = (p?: string | string[]) => !p || (Array.isArray(p) ? p.every(x => can(x)) : can(p));
  const items = open ? QUICK_HOVER[open.key].filter(i => allowed(i.perm)) : [];
  const actions = items.filter(i => !i.report);
  const reports = items.filter(i => i.report);
  const go = (i: HoverItem) => { setOpen(null); if (i.win && windows) windows.open(i.win); else if (i.to) nav(i.to); };
  const node = open && items.length > 0 && createPortal(
    <div className="qh-pop" style={{ left: Math.min(open.x, window.innerWidth - 260), top: open.y }}
      onMouseEnter={() => window.clearTimeout(closeT.current)} onMouseLeave={() => { closeT.current = window.setTimeout(() => setOpen(null), 180); }}>
      {actions.map(i => <button key={i.label} onClick={() => go(i)}>{i.label}</button>)}
      {reports.length > 0 && <><div className="qh-sep">Raporlar</div>{reports.map(i => <button key={i.label} className="rep" onClick={() => go(i)}>{i.label}</button>)}</>}
    </div>, document.body);
  return { bind, node };
}
