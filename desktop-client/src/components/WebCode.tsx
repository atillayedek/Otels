import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { get } from '../lib/api';

/**
 * Kullanıcıya özel web giriş kodu (MFA): otel web sitesindeki yönetim girişinde parolayla birlikte istenir.
 * Kod 10 saniyede bir değişir; yalnız düğmeye basınca görünür (omuz üstünden okunmasın), pencere kapanınca istek durur.
 */
export function WebCodeButton() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setCode(null); return; }
    let alive = true;
    let timer = 0;
    const load = async () => {
      try {
        const r = await get<{ code: string; remaining: number }>('/api/v1/auth/mfa');
        if (!alive) return;
        setCode(r.code); setLeft(r.remaining); setErr(false);
        timer = window.setTimeout(load, r.remaining * 1000 + 150);
      } catch {
        if (alive) { setErr(true); timer = window.setTimeout(load, 3000); }
      }
    };
    void load();
    const tick = window.setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000);
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); document.removeEventListener('mousedown', away); };
  }, [open]);

  return (
    <div className="webcode" ref={box}>
      <button className="btn ghost icon" onClick={() => setOpen(o => !o)} title="Web giriş kodu" aria-expanded={open}><KeyRound /></button>
      {open && (
        <div className="webcode-pop" role="dialog" aria-label="Web giriş kodu">
          <div className="webcode-title">Web giriş kodu</div>
          <div className="webcode-code" aria-live="polite">{err ? '— — —' : code ? `${code.slice(0, 3)} ${code.slice(3)}` : '…'}</div>
          <div className="webcode-bar"><i style={{ width: `${(left / 10) * 100}%` }} /></div>
          <div className="webcode-note">{left} sn sonra yenilenir. Otel web sitesindeki yönetim girişinde parolanızla birlikte bu kodu girin. Kod size özeldir, kimseyle paylaşmayın.</div>
        </div>
      )}
    </div>
  );
}
