import { useCallback, useRef, useState, type ReactNode } from 'react';
import { newKey } from '../lib/api';
import { useToast } from './ui';

export function PageHead({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {sub && <span className="sub">{sub}</span>}
      {children}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/**
 * Sunucuya yazan işlem: tek işlem anahtarı (çift tıklama/yeniden denemede aynı kalır), meşgul durumu ve hata.
 * Başarılı olunca anahtar yenilenir. Hata kullanıcıya bildirim olarak da gösterilir.
 * run() başarıda işlemin sonucunu (sonuç yoksa true), hatada veya iptalde undefined döndürür.
 */
export function useAction<A extends unknown[], R>(fn: (key: string, ...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); silentError?: boolean } = {}) {
  const toast = useToast();
  const key = useRef(newKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      const r = await fn(key.current, ...args);
      key.current = newKey();
      if (opts.success) toast.ok(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      // Değer döndürmeyen işlemlerde de başarı, undefined'dan ayırt edilebilsin.
      return (r === undefined ? true : r) as R;
    } catch (e) {
      setError(e);
      if (!opts.silentError) toast.error(e);
      return undefined;
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, busy]);
  return { run, busy, error, reset: () => setError(null) };
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => <div key={i} className="kv-row"><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}
    </dl>
  );
}

export function Stat({ label, value, foot, accent, onClick }: { label: string; value: ReactNode; foot?: ReactNode; accent?: string; onClick?: () => void }) {
  return (
    <div className={`kpi ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      {accent && <span className="accent" style={{ background: accent }} />}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
