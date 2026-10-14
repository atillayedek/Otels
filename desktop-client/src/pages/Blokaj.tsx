import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardList, Crown, FileText, LogIn, Unlink } from 'lucide-react';
import { api, get, newKey, qs } from '../lib/api';
import type { AvailabilityDay, Rack, RackBar, Reservation } from '../lib/types';
import { addDays, BLOCK_LABEL, fmtDate, fmtDay, nightsBetween, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { PageHead } from '../components/common';
import { Empty, ErrorBox, Spinner, useContextMenu, useToast } from '../components/ui';
import { CheckInModal, MoveModal } from '../components/ReservationActions';

const DAY_W = 46;
const ROOM_W = 150;
const ROW_H = 30;

export default function BlokajPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const menu = useContextMenu();
  const { property, can } = useSession();
  const bd = property?.businessDate ?? new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => addDays(bd, -2));
  const [days, setDays] = useState(21);
  const [drag, setDrag] = useState<RackBar | null>(null);
  const [dropRoom, setDropRoom] = useState<string | null>(null);
  const [move, setMove] = useState<{ res: Reservation; roomId: string } | null>(null);
  const [checkIn, setCheckIn] = useState<Reservation | null>(null);

  const to = addDays(from, days);
  const rack = useQuery({ queryKey: ['rack', from, days], queryFn: () => get<Rack>(`/api/v1/rack${qs({ from, days })}`) });
  const avail = useQuery({ queryKey: ['availability', from, to], queryFn: () => get<AvailabilityDay[]>(`/api/v1/availability${qs({ from, to })}`) });

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);
  const occ = useMemo(() => dates.map(d => {
    const rows = (avail.data ?? []).filter(a => a.date === d);
    const total = rows.reduce((s, r) => s + r.total - r.blocked, 0);
    const sold = rows.reduce((s, r) => s + r.sold, 0);
    return { d, total, sold, pct: total > 0 ? Math.round((sold / total) * 100) : 0 };
  }), [dates, avail.data]);

  const groups = useMemo(() => {
    const r = rack.data;
    if (!r) return [];
    const byType = new Map<string, { code: string; rooms: Rack['rooms'] }>();
    for (const room of r.rooms) {
      if (!byType.has(room.roomTypeId)) byType.set(room.roomTypeId, { code: room.roomTypeCode, rooms: [] });
      byType.get(room.roomTypeId)!.rooms.push(room);
    }
    return [...byType.entries()].map(([id, g]) => ({ id, ...g }));
  }, [rack.data]);

  const pos = (a: string, b: string) => {
    const start = Math.max(0, nightsBetween(from, a));
    const end = Math.min(days, nightsBetween(from, b));
    return { left: start * DAY_W, width: Math.max(0, end - start) * DAY_W - 2, visible: end > start, cutLeft: nightsBetween(from, a) < 0 };
  };

  const load = (id: string) => get<Reservation>(`/api/v1/reservations/${id}`);

  const onDrop = async (roomId: string) => {
    const bar = drag;
    setDrag(null);
    setDropRoom(null);
    if (!bar || bar.roomId === roomId) return;
    try {
      const res = await load(bar.reservationId);
      if (res.status === 'checked_in') { setMove({ res, roomId }); return; }
      if (res.status !== 'tentative' && res.status !== 'confirmed') { toast.error('Bu rezervasyonun odası değiştirilemez.'); return; }
      await api('POST', `/api/v1/reservations/${res.id}/assign-room`, { roomId, version: res.version }, { key: newKey() });
      toast.ok(`${res.reservationNumber} odaya atandı.`);
      await qc.invalidateQueries({ queryKey: ['rack'] });
    } catch (e) { toast.error(e); }
  };

  const unassign = async (bar: RackBar) => {
    try {
      const res = await load(bar.reservationId);
      await api('POST', `/api/v1/reservations/${res.id}/assign-room`, { roomId: null, version: res.version }, { key: newKey() });
      toast.ok('Oda ataması kaldırıldı.');
    } catch (e) { toast.error(e); }
  };

  const barMenu = (e: React.MouseEvent, b: RackBar) => menu.open(e, [
    { label: 'Rezervasyonu aç', icon: <FileText size={14} />, onClick: () => nav(`/reservations/${b.reservationId}`) },
    ...(b.status !== 'checked_in' && b.roomId && b.arrival <= bd && can('checkin.execute')
      ? [{ label: 'Giriş yap (check-in)', icon: <LogIn size={14} />, onClick: async () => { try { setCheckIn(await load(b.reservationId)); } catch (err) { toast.error(err); } } }] : []),
    ...(b.status !== 'checked_in' && b.roomId && can('reservation.edit') ? [{ label: 'Oda atamasını kaldır', icon: <Unlink size={14} />, onClick: () => void unassign(b) }] : []),
  ]);

  const r = rack.data;
  const width = ROOM_W + days * DAY_W;

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title="Blokaj" sub="Oda bazında zaman çizelgesi · çubuğu başka odaya sürükleyerek oda atayın" actions={<>
        <button className="btn icon" title="Geri" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft /></button>
        <input type="date" className="input" style={{ width: 150 }} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
        <button className="btn icon" title="İleri" onClick={() => setFrom(addDays(from, 7))}><ChevronRight /></button>
        <button className="btn" onClick={() => setFrom(addDays(bd, -2))}>Bugün</button>
        <select className="input" style={{ width: 110 }} value={days} onChange={e => setDays(Number(e.target.value))}>{[14, 21, 31, 45, 62].map(n => <option key={n} value={n}>{n} gün</option>)}</select>
        {can('reservation.create') && <button className="btn primary" onClick={() => nav('/reservations/new')}><ClipboardList /> Yeni rezervasyon</button>}
      </>} />

      {rack.isLoading ? <Spinner /> : rack.error ? <ErrorBox error={rack.error} /> : !r || r.rooms.length === 0 ? (
        <Empty title="Henüz oda tanımlanmamış" text="Blokaj çizelgesi için Yönetim → Oda ve Oda Tipleri ekranından oda ekleyin." />
      ) : (
        <>
          <div className="tl" style={{ maxHeight: 'calc(100vh - 250px)' }}>
            <div style={{ width }}>
              <div style={{ display: 'grid', gridTemplateColumns: `${ROOM_W}px repeat(${days}, ${DAY_W}px)`, alignItems: 'end', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="tl-room" style={{ height: 'auto', fontSize: 12, fontWeight: 500, color: 'var(--muted)', alignSelf: 'stretch' }}>Doluluk</div>
                {occ.map(o => (
                  <div key={o.d} title={`${fmtDate(o.d)}: ${o.sold}/${o.total} oda (%${o.pct})`} style={{ height: 62, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>%{o.pct}</span>
                    <div style={{ width: DAY_W - 14, height: `${Math.max(2, o.pct * 0.42)}px`, background: o.d === bd ? 'var(--primary)' : o.pct >= 90 ? 'var(--danger)' : 'var(--crystal)', borderRadius: '3px 3px 0 0' }} />
                  </div>
                ))}
              </div>
              <div className="tl-head" style={{ display: 'grid', gridTemplateColumns: `${ROOM_W}px repeat(${days}, ${DAY_W}px)` }}>
                <div className="tl-room" style={{ background: 'var(--surface-2)', fontSize: 12 }}>Oda</div>
                {dates.map(d => {
                  const f = fmtDay(d);
                  return <div key={d} className={`tl-cell ${f.weekend ? 'weekend' : ''} ${d === bd ? 'today' : ''}`} style={{ textAlign: 'center', fontSize: 10.5, lineHeight: '14px', paddingTop: 1 }}><b>{f.day}</b><br />{f.weekday}</div>;
                })}
              </div>

              {groups.map(g => (
                <div key={g.id}>
                  <div className="tl-type" style={{ width: ROOM_W }}>{g.code} · {g.rooms.length} oda</div>
                  {g.rooms.map(room => {
                    const bars = r.bars.filter(b => b.roomId === room.id);
                    const blocks = r.blocks.filter(b => b.roomId === room.id);
                    return (
                      <div key={room.id} className={dropRoom === room.id ? 'tl-row-drop' : ''} style={{ position: 'relative', display: 'grid', gridTemplateColumns: `${ROOM_W}px repeat(${days}, ${DAY_W}px)`, height: ROW_H }}
                        onDragOver={e => { if (drag) { e.preventDefault(); setDropRoom(room.id); } }}
                        onDragLeave={() => setDropRoom(d => (d === room.id ? null : d))}
                        onDrop={e => { e.preventDefault(); void onDrop(room.id); }}>
                        <div className="tl-room"><span className={`hkmark hk-${room.hkStatus}`} />{room.number}{room.isDnd && <span className="muted" style={{ fontSize: 10 }}>DND</span>}</div>
                        {dates.map(d => (
                          <div key={d} className={`tl-cell ${fmtDay(d).weekend ? 'weekend' : ''} ${d === bd ? 'today' : ''}`}
                            onDoubleClick={() => can('reservation.create') && d >= bd && nav(`/reservations/new?room=${room.id}&type=${room.roomTypeId}&arrival=${d}`)} />
                        ))}
                        {blocks.map(b => {
                          const p = pos(b.dateFrom, b.dateTo);
                          return p.visible && <div key={b.id} className="tl-bar block" style={{ left: ROOM_W + p.left, width: p.width }} title={`${BLOCK_LABEL[b.kind]}: ${b.reason}`}>{BLOCK_LABEL[b.kind]} · {b.reason}</div>;
                        })}
                        {bars.map(b => {
                          const p = pos(b.arrival, b.departure);
                          if (!p.visible) return null;
                          const movable = b.status !== 'checked_out' && (can('reservation.edit') || can('room.change'));
                          return (
                            <div key={b.reservationId} className={`tl-bar ${b.status} ${drag?.reservationId === b.reservationId ? 'dragging' : ''}`}
                              style={{ left: ROOM_W + p.left + 1, width: p.width, borderTopLeftRadius: p.cutLeft ? 0 : undefined }}
                              draggable={movable} onDragStart={() => setDrag(b)} onDragEnd={() => { setDrag(null); setDropRoom(null); }}
                              onClick={e => barMenu(e, b)} onContextMenu={e => barMenu(e, b)} onDoubleClick={() => nav(`/reservations/${b.reservationId}`)}
                              title={`${b.guestName} · ${b.reservationNumber}\n${fmtDate(b.arrival)} → ${fmtDate(b.departure)} · ${STATUS_LABEL[b.status]}\n${b.adults}+${b.children} kişi${b.companyName ? ` · ${b.companyName}` : ''}${b.agencyName ? ` · ${b.agencyName}` : ''}`}>
                              {b.isVip && <Crown size={12} />}{b.guestName}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 10 }}>
            <div className="card-head"><h3>Odası atanmamış rezervasyonlar</h3><span className="muted" style={{ fontSize: 12 }}>Odaya atamak için çizelgedeki bir oda satırına sürükleyin.</span></div>
            <div className="card-body">
              {r.unassigned.length === 0 ? <span className="muted">Bu tarih aralığında odası atanmamış rezervasyon yok.</span> : (
                <div className="row wrap">
                  {r.unassigned.map(b => (
                    <div key={b.reservationId} className={`tl-bar ${b.status}`} style={{ position: 'static', width: 'auto' }} draggable={can('reservation.edit')}
                      onDragStart={() => setDrag(b)} onDragEnd={() => { setDrag(null); setDropRoom(null); }} onDoubleClick={() => nav(`/reservations/${b.reservationId}`)}
                      onClick={e => barMenu(e, b)}>
                      {b.guestName} · {fmtDate(b.arrival)}–{fmtDate(b.departure)} · {r.rooms.find(x => x.roomTypeId === b.roomTypeId)?.roomTypeCode ?? ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="legend" style={{ marginTop: 8 }}>
            <span><i style={{ background: '#e0ebff', border: '1px solid #2563eb' }} />Onaylı</span>
            <span><i style={{ background: '#fef9c3', border: '1px solid #ca8a04' }} />Opsiyon</span>
            <span><i style={{ background: '#ede9fe', border: '1px solid #7c3aed' }} />Konaklıyor</span>
            <span><i style={{ background: '#e2e8f0', border: '1px solid #64748b' }} />Çıkış yaptı</span>
            <span>Boş hücreye çift tıklayarak o oda ve tarih için rezervasyon açabilirsiniz.</span>
          </div>
        </>
      )}
      {menu.node}
      {move && <MoveModal reservation={move.res} initialRoomId={move.roomId} onClose={() => setMove(null)} />}
      {checkIn && <CheckInModal reservation={checkIn} onClose={() => setCheckIn(null)} />}
    </div>
  );
}
