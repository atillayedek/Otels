import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { errorText } from '../lib/api';
import { fmtMoney, parseMoney } from '../lib/format';

/* ---------------------------------------------------------------- Bildirim */
interface ToastItem { id: number; kind: 'info' | 'success' | 'error'; text: string; sub?: string }
const ToastCtx = createContext<{ push: (kind: ToastItem['kind'], text: string, sub?: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], text: string, sub?: string) => {
    const id = Date.now() + Math.random();
    setItems(i => [...i, { id, kind, text, sub }]);
    setTimeout(() => setItems(i => i.filter(t => t.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts">
        {items.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <div>{t.text}{t.sub && <small>{t.sub}</small>}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx)!;
  return useMemo(() => ({
    ok: (text: string, sub?: string) => ctx.push('success', text, sub),
    info: (text: string) => ctx.push('info', text),
    error: (e: unknown) => ctx.push('error', typeof e === 'string' ? e : errorText(e)),
  }), [ctx]);
}

/* ---------------------------------------------------------------- Modal */
export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' | 'xl' }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost icon close" onClick={onClose} aria-label="Kapat"><X /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- Onay */
interface ConfirmOpts { title: string; message: ReactNode; confirmText?: string; danger?: boolean; requireText?: string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => { setTyped(''); setState({ ...o, resolve }); }), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => close(false)} footer={<>
          <button className="btn" onClick={() => close(false)}>Vazgeç</button>
          <button className={`btn ${state.danger ? 'danger' : 'primary'}`} disabled={!!state.requireText && typed !== state.requireText} onClick={() => close(true)}>
            {state.confirmText ?? 'Onayla'}
          </button>
        </>}>
          <div className="stack">
            <div>{state.message}</div>
            {state.requireText && (
              <Field label={`Onaylamak için "${state.requireText}" yazın`}>
                <input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
              </Field>
            )}
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------------------------------------------------------------- Form alanları */
export function Field({ label, required, hint, children, className }: { label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Para girişi: kullanıcı "1.250,50" yazar, değer sunucuya "1250.50" metni olarak gider. */
export function MoneyInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(value ? fmtMoney(value) : '');
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setText(value ? fmtMoney(value) : ''); last.current = value; } }, [value]);
  return (
    <input className="input num" inputMode="decimal" placeholder={placeholder ?? '0,00'} value={text} autoFocus={autoFocus}
      onChange={e => { setText(e.target.value); const p = parseMoney(e.target.value) ?? ''; last.current = p; onChange(p); }}
      onBlur={() => { const p = parseMoney(text); if (p) setText(fmtMoney(p)); }} />
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error-box">{errorText(error)}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="empty"><Loader2 className="spin" />{label && <div>{label}</div>}</div>;
}

export function Empty({ title, text, icon, action }: { title: string; text?: string; icon?: ReactNode; action?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox />}<b>{title}</b>{text && <div>{text}</div>}{action && <div style={{ marginTop: 10 }}>{action}</div>}</div>;
}

export function Badge({ color, children }: { color?: string; children: ReactNode }) {
  return <span className={`badge ${color ?? ''}`}>{children}</span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs">
      {items.map(i => (
        <button key={i.key} className={value === i.key ? 'active' : ''} onClick={() => onChange(i.key)}>
          {i.label}{i.count !== undefined && <span className="badge">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Sağ tık menüsü */
export interface MenuItem { label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; separator?: boolean; children?: MenuItem[]; checked?: boolean; hint?: string; shortcut?: string }

const ITEM_H = 31;
const menuHeight = (items: MenuItem[]) => items.reduce((h, i) => h + (i.separator ? 9 : ITEM_H), 12);

function CtxList({ items, close, flip, className, style }: { items: MenuItem[]; close: () => void; flip: boolean; className?: string; style?: React.CSSProperties }) {
  const [sub, setSub] = useState<{ idx: number; up: boolean } | null>(null);
  return (
    <div className={`ctx ${className ?? ''}`} style={style} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
      {items.map((i, idx) => i.separator ? <div className="sep" key={idx} /> : (
        <div key={idx} className="ctx-item" onMouseEnter={e => {
          if (!i.children?.length || i.disabled) { setSub(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          setSub({ idx, up: r.top + menuHeight(i.children) > window.innerHeight - 8 });
        }}>
          <button disabled={i.disabled} className={`${i.danger ? 'danger' : ''} ${i.children ? 'has-sub' : ''}`} title={i.hint}
            onClick={() => { if (i.children) return; close(); i.onClick?.(); }}>
            {i.checked !== undefined ? <span className="ctx-check">{i.checked ? <CheckCircle2 size={14} /> : null}</span> : i.icon}
            <span className="ctx-label">{i.label}</span>
            {i.shortcut && <kbd className="ctx-key">{i.shortcut}</kbd>}
            {i.children && <ChevronRight size={14} className="ctx-arrow" />}
          </button>
          {sub?.idx === idx && i.children && (
            <CtxList items={i.children} close={close} flip={flip} className={`sub ${flip ? 'left' : ''} ${sub.up ? 'up' : ''}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', key); window.removeEventListener('resize', close); };
  }, [menu]);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.max(6, Math.min(e.clientY, window.innerHeight - menuHeight(items) - 10));
    setMenu({ x, y, items });
  };
  const node = menu && createPortal(
    <CtxList items={menu.items} close={() => setMenu(null)} flip={menu.x > window.innerWidth - 520} style={{ left: menu.x, top: menu.y }} />,
    document.body,
  );
  return { open, node, close: () => setMenu(null) };
}

/* ---------------------------------------------------------------- Tablo */
export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null | undefined;
  align?: 'right' | 'center';
  width?: number | string;
  filter?: boolean;
}

/** Filtre satırlı, sıralanabilir yoğun tablo (ElektraWeb/AmonRa liste düzeni). Filtreleme yüklenmiş sayfa üzerinde yapılır. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, onRowContext, selectedKey, empty, footer, maxHeight, rowClass }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; onRowContext?: (e: React.MouseEvent, r: T) => void;
  selectedKey?: string; empty?: ReactNode; footer?: ReactNode; maxHeight?: string; rowClass?: (r: T) => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const hasFilters = columns.some(c => c.filter);
  const val = (c: Column<T>, r: T) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) as string | number | null | undefined;
  const view = useMemo(() => {
    let v = rows;
    for (const [k, f] of Object.entries(filters)) {
      if (!f) continue;
      const col = columns.find(c => c.key === k)!;
      const needle = f.toLocaleLowerCase('tr-TR');
      v = v.filter(r => String(val(col, r) ?? '').toLocaleLowerCase('tr-TR').includes(needle));
    }
    if (sort) {
      const col = columns.find(c => c.key === sort.key)!;
      v = [...v].sort((a, b) => {
        const x = val(col, a), y = val(col, b);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const nx = Number(x), ny = Number(y);
        if (!Number.isNaN(nx) && !Number.isNaN(ny) && typeof x !== 'string' || (/^-?\d+(\.\d+)?$/.test(String(x)) && /^-?\d+(\.\d+)?$/.test(String(y)))) return (nx - ny) * sort.dir;
        return String(x).localeCompare(String(y), 'tr') * sort.dir;
      });
    }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, sort, columns]);
  return (
    <div className="table-wrap" style={{ maxHeight }}>
      <table className="dt">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className="sortable" style={{ width: c.width, textAlign: c.align }} onClick={() => setSort(s => s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}>
                {c.header}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
          {hasFilters && (
            <tr className="filters">
              {columns.map(c => (
                <th key={c.key}>{c.filter && <input className="input sm" value={filters[c.key] ?? ''} onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))} />}</th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {view.map(r => (
            <tr key={rowKey(r)} className={`${onRowClick ? 'clickable' : ''} ${selectedKey === rowKey(r) ? 'selected' : ''} ${rowClass?.(r) ?? ''}`}
              onClick={() => onRowClick?.(r)} onContextMenu={onRowContext ? e => onRowContext(e, r) : undefined} onDoubleClick={() => onRowClick?.(r)}>
              {columns.map(c => <td key={c.key} style={{ textAlign: c.align }} className={c.align === 'right' ? 'num' : ''}>{c.render ? c.render(r) : String(val(c, r) ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      {view.length === 0 && (empty ?? <Empty title="Kayıt bulunmuyor" />)}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Önceki</button>
      <span className="muted">{page} / {pages}</span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sonraki</button>
    </div>
  );
}

export function Money({ value, currency, colored }: { value?: string | null; currency?: string; colored?: boolean }) {
  if (value === undefined || value === null) return null;
  const cls = colored ? (value.startsWith('-') ? 'amount-neg' : /^0+(\.0+)?$/.test(value) ? '' : 'amount-pos') : '';
  return <span className={`num ${cls}`}>{fmtMoney(value, currency)}</span>;
}
