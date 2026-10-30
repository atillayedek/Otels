import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TransactionCode } from '../lib/types';

/**
 * Departman (işlem kodu) seçici: kod yazılarak veya açılan Kod / Açıklama listesinden seçilir.
 * Yazılan metin koda veya açıklamaya göre süzer; ↑ ↓ ile gezilir, Enter seçer, Esc kapatır.
 */
export function CodePicker({ codes, value, onChange, autoFocus }: { codes: TransactionCode[]; value: string; onChange: (id: string) => void; autoFocus?: boolean }) {
  const sel = codes.find(c => c.id === value);
  const [text, setText] = useState(sel?.code ?? '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(sel?.code ?? ''); }, [sel?.code]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setText(sel?.code ?? ''); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, sel?.code]);

  const needle = text.trim().toLocaleLowerCase('tr-TR');
  const typed = open && needle && needle !== sel?.code.toLocaleLowerCase('tr-TR');
  const list = typed ? codes.filter(c => c.code.toLocaleLowerCase('tr-TR').startsWith(needle) || c.name.toLocaleLowerCase('tr-TR').includes(needle)) : codes;
  const pick = (c: TransactionCode) => { onChange(c.id); setText(c.code); setOpen(false); };

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi(h => Math.min(list.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setText(sel?.code ?? ''); }
    else if (e.key === 'Enter' && open) {
      // Liste açıkken Enter seçimi yapar; kapalıyken sonraki alana geçiş (Enter ile gezinme) çalışır.
      e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
      if (list[hi]) pick(list[hi]);
    }
  };

  return (
    <div className="cpick" ref={box}>
      <div className="cpick-in">
        <input ref={input} className="input" value={text} autoFocus={autoFocus} data-enter={open ? 'keep' : undefined}
          onChange={e => { setText(e.target.value); setOpen(true); setHi(0); }} onFocus={e => e.target.select()} onKeyDown={key} />
        <button type="button" tabIndex={-1} className="cpick-btn" onClick={() => { setOpen(o => !o); setHi(Math.max(0, list.findIndex(c => c.id === value))); input.current?.focus(); }}><ChevronDown size={14} /></button>
      </div>
      {open && (
        <div className="cpick-pop">
          <table>
            <thead><tr><th>Kod</th><th>Açıklama</th></tr></thead>
            <tbody>
              {list.map((c, i) => (
                <tr key={c.id} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); pick(c); }}>
                  <td>{c.code}</td><td>{c.name}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={2} className="muted">Eşleşen departman yok</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
