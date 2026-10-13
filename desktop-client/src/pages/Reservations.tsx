import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Crown, FileText, LogIn, LogOut, Printer, Search } from 'lucide-react';
import { get, qs } from '../lib/api';
import type { Paged, Reservation, ReservationListItem } from '../lib/types';
import { fmtDate, STATUS_BADGE, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead } from '../components/common';
import { Badge, DataTable, Empty, ErrorBox, Money, Pager, Tabs, useContextMenu, useToast, type Column } from '../components/ui';
import { CheckInModal, CheckOutModal } from '../components/ReservationActions';

type View = 'all' | 'arrivals' | 'departures' | 'inhouse';
const TITLES: Record<View, string> = { all: 'Rezervasyon Listesi', arrivals: 'Beklenen Gelişler', departures: 'Beklenen Çıkışlar', inhouse: 'Konaklayanlar' };

export default function ReservationsPage() {
  const nav = useNavigate();
  const toast = useToast();
  const menu = useContextMenu();
  const { can, property } = useSession();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) || 'all';
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [checkIn, setCheckIn] = useState<Reservation | null>(null);
  const [checkOut, setCheckOut] = useState<Reservation | null>(null);
  useEffect(() => { const t = setTimeout(() => { setTerm(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [view, status, from, to]);

  const list = useQuery({
    queryKey: ['reservations', view, term, status, from, to, page],
    queryFn: () => get<Paged<ReservationListItem>>(`/api/v1/reservations${qs({ view, q: term, status, from, to, page, pageSize: 100 })}`),
  });

  const open = async (id: string, act: 'in' | 'out') => {
    try {
      const r = await get<Reservation>(`/api/v1/reservations/${id}`);
      if (act === 'in') setCheckIn(r); else setCheckOut(r);
    } catch (e) { toast.error(e); }
  };

  const rowMenu = (e: React.MouseEvent, r: ReservationListItem) => menu.open(e, [
    { label: 'Aç', icon: <FileText size={14} />, onClick: () => nav(`/reservations/${r.id}`) },
    ...((r.status === 'confirmed' || r.status === 'tentative') && r.arrival <= (property?.businessDate ?? '') && can('checkin.execute') ? [{ label: 'Giriş yap', icon: <LogIn size={14} />, onClick: () => void open(r.id, 'in') }] : []),
    ...(r.status === 'checked_in' && can('checkout.execute') ? [{ label: 'Çıkış yap', icon: <LogOut size={14} />, onClick: () => void open(r.id, 'out') }] : []),
  ]);

  const cols: Column<ReservationListItem>[] = [
    { key: 'reservationNumber', header: 'Rez. No', width: 110, filter: true, render: r => <span className="mono">{r.reservationNumber}</span> },
    { key: 'guestName', header: 'Misafir', filter: true, render: r => <>{r.guestIsVip && <Crown size={12} color="var(--warning)" />} {r.guestName}</> },
    { key: 'roomNumber', header: 'Oda', width: 70, filter: true },
    { key: 'roomTypeCode', header: 'Tip', width: 70, filter: true },
    { key: 'arrival', header: 'Giriş', width: 95, render: r => fmtDate(r.arrival) },
    { key: 'departure', header: 'Çıkış', width: 95, render: r => fmtDate(r.departure) },
    { key: 'pax', header: 'Kişi', width: 60, value: r => `${r.adults}+${r.children}` },
    { key: 'account', header: 'Şirket / Acente', filter: true, value: r => r.companyName ?? r.agencyName ?? '' },
    { key: 'nightlyRate', header: 'Gecelik', align: 'right', width: 110, render: r => <Money value={r.nightlyRate} currency={r.currency} /> },
    { key: 'balance', header: 'Bakiye', align: 'right', width: 110, render: r => <Money value={r.balance} colored /> },
    { key: 'status', header: 'Durum', width: 110, value: r => STATUS_LABEL[r.status], render: r => <Badge color={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
  ];

  return (
    <div className="page">
      <PageHead title={TITLES[view]} sub={`İş günü ${fmtDate(property?.businessDate)}`} actions={<>
        <button className="btn" onClick={() => nav(`/reports/${view === 'arrivals' ? 'arrivals' : view === 'departures' ? 'departures' : 'inhouse'}`)}><Printer /> Rapor</button>
        {can('reservation.create') && <button className="btn primary" onClick={() => nav('/reservations/new')}><ClipboardList /> Yeni rezervasyon</button>}
      </>} />
      <Tabs value={view} onChange={v => setSp({ view: v })} items={[
        { key: 'all', label: 'Tümü' }, { key: 'arrivals', label: 'Gelişler' }, { key: 'departures', label: 'Çıkışlar' }, { key: 'inhouse', label: 'Konaklayanlar' },
      ]} />
      <div className="toolbar">
        <Search size={15} className="muted" />
        <input className="input" style={{ width: 260 }} placeholder="Rez. no, misafir, oda, şirket" value={q} onChange={e => setQ(e.target.value)} />
        {view === 'all' && <>
          <select className="input" style={{ width: 140 }} value={status} onChange={e => setStatus(e.target.value)}><option value="">Tüm durumlar</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="muted">Tarih</span>
          <input type="date" className="input" style={{ width: 145 }} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className="input" style={{ width: 145 }} value={to} onChange={e => setTo(e.target.value)} />
        </>}
        <span className="count">{list.data ? `${list.data.total} kayıt` : ''}</span>
      </div>
      {list.error ? <ErrorBox error={list.error} /> : (
        <DataTable rows={list.data?.items ?? []} columns={cols} rowKey={r => r.id} onRowClick={r => nav(`/reservations/${r.id}`)} onRowContext={rowMenu} maxHeight="calc(100vh - 290px)"
          empty={list.isLoading ? <Empty title="Yükleniyor…" /> : <Empty title={term || status || from || to ? 'Bu filtreye uyan rezervasyon yok' : view === 'arrivals' ? 'Bugün beklenen geliş bulunmuyor.' : view === 'departures' ? 'Bugün beklenen çıkış bulunmuyor.' : view === 'inhouse' ? 'Konaklayan misafir bulunmuyor.' : 'Henüz rezervasyon bulunmuyor.'} />} />
      )}
      {list.data && <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {menu.node}
      {checkIn && <CheckInModal reservation={checkIn} onClose={() => setCheckIn(null)} />}
      {checkOut && <CheckOutModal reservation={checkOut} onClose={() => setCheckOut(null)} />}
    </div>
  );
}
