/**
 * Enter ile bir sonraki kutucuğa geçiş (Tab yerine). Ekranda görünen, düzenlenebilir alanlar sırayla dolaşılır;
 * son alandan sonra pencerenin ana düğmesine (Kaydet / Tamam) odaklanılır, Enter'a bir daha basınca o düğme çalışır.
 * Çok satırlı metin alanlarında Enter yeni satırdır. Bileşen Enter'ı kendisi işlediyse (preventDefault) dokunulmaz.
 * Bir alanda bu davranış istenmiyorsa data-enter="keep" verilir.
 */
const FIELDS = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=color]), select, textarea';

function usable(el: Element): el is HTMLElement {
  const h = el as HTMLInputElement;
  if (h.disabled || h.readOnly || h.tabIndex < 0) return false;
  if (h.closest('[aria-hidden=true], [inert]')) return false;
  return (h as HTMLElement).offsetParent !== null || getComputedStyle(h).position === 'fixed';
}

function scope(el: HTMLElement): ParentNode {
  return el.closest('.modal, .win, .auth-box, form, .page') ?? document;
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  const t = e.target as HTMLElement | null;
  if (!t || !t.matches(FIELDS) || t.tagName === 'TEXTAREA' || t.closest('[data-enter=keep]')) return;
  const root = scope(t);
  const list = [...root.querySelectorAll(FIELDS)].filter(usable);
  const i = list.indexOf(t);
  if (i < 0) return;
  const next = list[i + 1];
  if (next) {
    e.preventDefault();
    next.focus();
    if (next instanceof HTMLInputElement && ['text', 'search', 'tel', 'email', 'number', ''].includes(next.type)) next.select();
    return;
  }
  // Son alan: pencerede ana düğme varsa ona geç (form içindeyse tarayıcının varsayılan gönderimi çalışsın).
  if (t.closest('form')) return;
  const primary = (root as Element).querySelector?.('.modal-foot .btn.primary:not(:disabled), .win-foot .btn.primary:not(:disabled)') as HTMLButtonElement | null;
  if (primary) { e.preventDefault(); primary.focus(); }
}

let installed = false;
export function installEnterNavigation() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKey);
}
