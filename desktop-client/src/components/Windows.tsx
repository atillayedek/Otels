import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Copy, Loader2, Minus, Square, X } from 'lucide-react';
import { PageErrorBoundary } from './PageErrorBoundary';

/**
 * Masaüstü pencereleri: rezervasyon/folyo, misafir kartı, yeni rezervasyon ve walk-in, arkadaki ekranın (ör. Oda Rack)
 * üzerinde taşınabilir, büyütülüp küçültülebilir pencereler olarak açılır. Arkadaki ekran yerinde kalır.
 */
export type WinSpec =
  | { kind: 'reservation'; id: string; action?: string; kbs?: boolean }
  | { kind: 'guest'; id: string }
  | { kind: 'folio'; id: string; action?: string }
  | { kind: 'new-reservation'; params?: Record<string, string> }
  | { kind: 'walk-in'; params?: Record<string, string> }
  | { kind: 'cash-sale' };

interface Win { key: string; spec: WinSpec; title: string; x: number; y: number; w: number; h: number; z: number; max: boolean; min: boolean }

interface WinApi { open: (spec: WinSpec) => void; close: (key: string) => void }
const WinCtx = createContext<WinApi | null>(null);
/** Pencerenin içindeki ekran için: başlığı değiştirme ve kapatma. Pencere dışında null. */
interface WinSelf { key: string; close: () => void; setTitle: (t: string) => void; open: (spec: WinSpec) => void }
const SelfCtx = createContext<WinSelf | null>(null);

const ReservationWin = lazy(() => import('../pages/FolioDetail').then(m => ({ default: m.FolioDetailView })));
const FolioWin = lazy(() => import('../pages/FolioDetail').then(m => ({ default: m.FolioLinesView })));
const GuestWin = lazy(() => import('../pages/GuestDetail').then(m => ({ default: m.GuestView })));
const NewResWin = lazy(() => import('../pages/ReservationForm').then(m => ({ default: m.ReservationNewWindow })));
const CashSaleWin = lazy(() => import('../pages/CashSale').then(m => ({ default: m.CashSaleView })));

const SIZE: Record<WinSpec['kind'], [number, number]> = { reservation: [1040, 720], folio: [1080, 640], guest: [1000, 680], 'new-reservation': [1180, 780], 'walk-in': [1180, 780], 'cash-sale': [620, 600] };
const TITLE: Record<WinSpec['kind'], string> = { reservation: 'Folyo Detayı', folio: 'Hesap Hareketleri', guest: 'Misafir kartı', 'new-reservation': 'Yeni rezervasyon', 'walk-in': 'Walk-in', 'cash-sale': 'Peşin Satış' };

let seq = 0;
const keyOf = (s: WinSpec) => (s.kind === 'reservation' || s.kind === 'guest' || s.kind === 'folio' ? `${s.kind}:${s.id}` : s.kind === 'cash-sale' ? s.kind : `${s.kind}:${++seq}`);

export function WindowsProvider({ children }: { children: ReactNode }) {
  const [wins, setWins] = useState<Win[]>([]);
  const z = useRef(40);
  const top = () => ++z.current;

  const open = useCallback((spec: WinSpec) => {
    const key = keyOf(spec);
    setWins(ws => {
      const found = ws.find(w => w.key === key);
      // Aynı kayıt zaten açıksa öne getirilir (istenen işlem varsa yeniden açılır).
      if (found) return ws.map(w => w.key === key ? { ...w, spec, min: false, z: top() } : w);
      const [dw, dh] = SIZE[spec.kind];
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(dw, vw - 40), h = Math.min(dh, vh - 70);
      const off = (ws.length % 6) * 26;
      return [...ws, { key, spec, title: TITLE[spec.kind], w, h, x: Math.max(10, (vw - w) / 2 + off - 60), y: Math.max(10, (vh - h) / 2 + off - 40), z: top(), max: false, min: false }];
    });
  }, []);
  const close = useCallback((key: string) => setWins(ws => ws.filter(w => w.key !== key)), []);
  const patch = useCallback((key: string, p: Partial<Win>) => setWins(ws => ws.map(w => w.key === key ? { ...w, ...p } : w)), []);
  const focus = useCallback((key: string) => setWins(ws => ws.map(w => w.key === key ? { ...w, z: top(), min: false } : w)), []);

  const api = useMemo(() => ({ open, close }), [open, close]);
  return (
    <WinCtx.Provider value={api}>
      <TaskbarCtx.Provider value={{ wins, focus, patch }}>
        {children}
      </TaskbarCtx.Provider>
      {createPortal(
        <div className="win-layer">
          {wins.map(w => <WindowFrame key={w.key} w={w} api={api} patch={patch} focus={focus} />)}
        </div>,
        document.body,
      )}
    </WinCtx.Provider>
  );
}

function WindowFrame({ w, api, patch, focus }: { w: Win; api: WinApi; patch: (k: string, p: Partial<Win>) => void; focus: (k: string) => void }) {
  const self = useMemo<WinSelf>(() => ({
    key: w.key, close: () => api.close(w.key), setTitle: (t: string) => patch(w.key, { title: t }), open: api.open,
  }), [w.key, api, patch]);

  const drag = (e: React.MouseEvent) => {
    if (w.max || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
    const move = (m: MouseEvent) => patch(w.key, {
      x: Math.min(window.innerWidth - 120, Math.max(-w.w + 160, ox + m.clientX - sx)),
      y: Math.min(window.innerHeight - 60, Math.max(0, oy + m.clientY - sy)),
    });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const resize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
    const move = (m: MouseEvent) => patch(w.key, { w: Math.max(520, ow + m.clientX - sx), h: Math.max(320, oh + m.clientY - sy) });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const s = w.spec;
  const style: React.CSSProperties = w.max ? { zIndex: w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z };
  return (
    <div className={`win ${w.max ? 'max' : ''} ${w.min ? 'min' : ''}`} style={style} onMouseDown={() => focus(w.key)} role="dialog" aria-label={w.title}>
      <div className="win-head" onMouseDown={drag} onDoubleClick={() => patch(w.key, { max: !w.max })}>
        <span className="win-title">{w.title}</span>
        <button className="win-btn" title="Simge durumuna küçült" onClick={() => patch(w.key, { min: true })}><Minus size={14} /></button>
        <button className="win-btn" title={w.max ? 'Önceki boyut' : 'Tam ekran'} onClick={() => patch(w.key, { max: !w.max })}>{w.max ? <Copy size={13} /> : <Square size={12} />}</button>
        <button className="win-btn close" title="Kapat" onClick={() => api.close(w.key)}><X size={15} /></button>
      </div>
      <div className="win-body">
        <SelfCtx.Provider value={self}>
          <PageErrorBoundary>
            <Suspense fallback={<div className="empty"><Loader2 className="spin" /></div>}>
              {s.kind === 'reservation' && <ReservationWin id={s.id} initialAction={s.action} kbs={s.kbs} />}
              {s.kind === 'guest' && <GuestWin id={s.id} />}
              {s.kind === 'folio' && <FolioWin id={s.id} action={s.action} />}
              {(s.kind === 'new-reservation' || s.kind === 'walk-in') && <NewResWin mode={s.kind === 'walk-in' ? 'walkin' : 'new'} params={s.params} />}
              {s.kind === 'cash-sale' && <CashSaleWin />}
            </Suspense>
          </PageErrorBoundary>
        </SelfCtx.Provider>
      </div>
      {!w.max && <div className="win-grip" onMouseDown={resize} />}
    </div>
  );
}

const TaskbarCtx = createContext<{ wins: Win[]; focus: (k: string) => void; patch: (k: string, p: Partial<Win>) => void } | null>(null);

/** Durum çubuğunda açık pencereler: tıklayınca öne gelir, simge durumundaysa geri açılır. */
export function WindowTaskbar() {
  const c = useContext(TaskbarCtx);
  if (!c || c.wins.length === 0) return null;
  const topZ = Math.max(...c.wins.filter(w => !w.min).map(w => w.z), 0);
  return (
    <div className="win-tasks">
      {c.wins.map(w => (
        <button key={w.key} className={`${w.min ? 'min' : ''} ${w.z === topZ && !w.min ? 'active' : ''}`} title={w.title}
          onClick={() => (w.z === topZ && !w.min ? c.patch(w.key, { min: true }) : c.focus(w.key))}>{w.title}</button>
      ))}
    </div>
  );
}

/** Pencere açar. Sağlayıcı yoksa (ör. telefon arayüzü) null döner; çağıran sayfa geçişine düşer. */
export const useWindows = () => useContext(WinCtx);
/** Rezervasyonu/folyoyu pencerede açar (arkadaki ekran yerinde kalır); pencere sistemi yoksa sayfaya gider. */
export function useOpenReservation() {
  const w = useContext(WinCtx);
  const nav = useNavigate();
  return useCallback((id: string, action?: string) => (w ? w.open({ kind: 'reservation', id, action }) : nav(`/reservations/${id}${action ? `?do=${action}` : ''}`)), [w, nav]);
}
/** Misafir kartını pencerede açar. */
export function useOpenGuest() {
  const w = useContext(WinCtx);
  const nav = useNavigate();
  return useCallback((id: string) => (w ? w.open({ kind: 'guest', id }) : nav(`/guests/${id}`)), [w, nav]);
}
/** İçinde bulunulan pencere (pencere dışında null). */
export const useWinSelf = () => useContext(SelfCtx);
