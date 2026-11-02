import { useEffect, useRef, useState } from 'react';

// Liste filtreleri ve sekmeler için oturum boyunca korunan durum: kullanıcı bir kayda girip geri döndüğünde
// (veya bir işlemden sonra) arama, durum filtresi, tarih aralığı ve sayfa olduğu gibi kalır. Uygulama kapanınca sıfırlanır.
export function useSessionState<T>(key: string, initial: T | (() => T)) {
  const storageKey = `pms.view.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw != null) return JSON.parse(raw) as T;
    } catch { /* depolama kullanılamıyorsa varsayılan */ }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* yok say */ }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

// İlk açılışta değil, yalnız değerler sonradan değişince çalışır (korunan sayfa numarası açılışta sıfırlanmasın diye).
// Önceki değerlerle karşılaştırır; etkinin iki kez çalıştırılması (React geliştirme modu) yanlış tetiklemez.
export function useOnChange(fn: () => void | (() => void), deps: unknown[]) {
  const prev = useRef(deps);
  useEffect(() => {
    const changed = deps.some((d, i) => !Object.is(d, prev.current[i]));
    prev.current = deps;
    if (changed) return fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
