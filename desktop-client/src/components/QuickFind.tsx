import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, Search, User } from 'lucide-react';
import { get, qs } from '../lib/api';
import type { GuestListItem, Paged, ReservationListItem } from '../lib/types';
import { fmtDate, fmtMoney, STATUS_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import { useOpenGuest, useOpenReservation } from './Windows';

function popStyle(el: HTMLElement | null): React.CSSProperties {
  const r = el?.getBoundingClientRect();
  if (!r) return {};
  return { top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 420, window.innerWidth - 428)) };
}

type Hit = { kind: 'res'; r: ReservationListItem } | { kind: 'guest'; g: GuestListItem };

// Konaklayan önce, sonra yaklaşan rezervasyonlar, en sonda geçmiş/iptal kayıtları.
const RANK: Record<string, number> = { checked_in: 0, confirmed: 1, tentative: 1, checked_out: 2, no_show: 3, cancelled: 3 };

/**
 * Hızlı bul (Ctrl+K): oda no, misafir adı veya rezervasyon no yazılır; Enter ilk sonucu açar.
 * Rezervasyon folyo penceresinde, misafir kartı kendi penceresinde açılır; arkadaki ekran yerinde kalır.
 */
export function QuickFind() {
  const { can } = useSession();
  const openRes = useOpenReservation();
  const openGuest = useOpenGuest();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 200); return () => clearTimeout(t); }, [text]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyK') { e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true); }
    };
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', click); };
  }, []);

  const enabled = term.length >= 2 || /^\d+$/.test(term);
  const res = useQuery({
    queryKey: ['quickfind', 'res', term], enabled: enabled && can('reservation.view'), staleTime: 10_000,
    queryFn: () => get<Paged<ReservationListItem>>(`/api/v1/reservations${qs({ q: term, view: 'all', pageSize: 100 })}`),
  });
  const guests = useQuery({
    queryKey: ['quickfind', 'guest', term], enabled: enabled && term.length >= 2 && !/^\d+$/.test(term) && can('guest.view'), staleTime: 10_000,
    queryFn: () => get<Paged<GuestListItem>>(`/api/v1/guests${qs({ q: term, pageSize: 5 })}`),
  });

  const resHits = [...(res.data?.items ?? [])]
    .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || (a.status === 'checked_out' ? b.departure.localeCompare(a.departure) : a.arrival.localeCompare(b.arrival)))
    .slice(0, 8);
  const hits: Hit[] = [...resHits.map(r => ({ kind: 'res' as const, r })), ...(guests.data?.items ?? []).map(g => ({ kind: 'guest' as const, g }))];
  const go = (h: Hit) => { setOpen(false); setText(''); input.current?.blur(); if (h.kind === 'res') openRes(h.r.id); else openGuest(h.g.id); };

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(hits.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[hi]) go(hits[hi]); }
  };

  if (!can('reservation.view') && !can('guest.view')) return null;
  const loading = enabled && (res.isFetching || guests.isFetching);
  return (
    <div className="qf" ref={box}>
      <Search size={15} className="qf-ic" />
      <input ref={input} className="qf-in" value={text} placeholder="Oda, misafir, rez. no… (Ctrl+K)" data-enter="keep"
        onChange={e => { setText(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onKeyDown={key} />
      {open && enabled && createPortal(
        // Açık pencerelerin üstünde görünsün diye liste gövdeye, arama kutusunun altına konumlanır.
        <div className="qf-pop" ref={pop} style={popStyle(box.current)}>
          {hits.length === 0 ? <div className="qf-empty">{loading ? 'Aranıyor…' : 'Sonuç bulunamadı'}</div> : hits.map((h, i) => (
            <button key={h.kind === 'res' ? h.r.id : h.g.id} type="button" className={`qf-row ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); go(h); }}>
              {h.kind === 'res' ? <>
                <span className={`qf-room s-${h.r.status}`}>{h.r.roomNumber ?? <BedDouble size={14} />}</span>
                <span className="qf-main"><b>{h.r.guestName}</b><small>{h.r.reservationNumber} · {fmtDate(h.r.arrival)} – {fmtDate(h.r.departure)}{h.r.companyName || h.r.agencyName ? ` · ${h.r.companyName ?? h.r.agencyName}` : ''}</small></span>
                <span className="qf-side"><small>{STATUS_LABEL[h.r.status] ?? h.r.status}</small>{Number(h.r.balance) !== 0 && <small>{fmtMoney(h.r.balance, h.r.currency)}</small>}</span>
              </> : <>
                <span className="qf-room guest"><User size={14} /></span>
                <span className="qf-main"><b>{h.g.firstName} {h.g.lastName}</b><small>Misafir kartı{h.g.phone ? ` · ${h.g.phone}` : ''}{h.g.stayCount ? ` · ${h.g.stayCount} konaklama` : ''}</small></span>
              </>}
            </button>
          ))}
          <div className="qf-foot">↑ ↓ seç · Enter aç · Esc kapat</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
