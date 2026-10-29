import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Görünüm ayarları (tema, renkler, simgeler, yazı boyutu, rack ve blokaj renkleri). Bu bilgisayarda saklanır;
 * her resepsiyon bilgisayarı kendi görünümünü seçebilir. Ayar yoksa/okunamazsa varsayılan tema kullanılır.
 */
export interface RackColors { vacant: string; occupied: string; dirty: string; arrival: string; departure: string; blocked: string; inspected: string; cleaning: string }
export interface BlokajColors { confirmed: string; tentative: string; checked_in: string; checked_out: string; block: string }
export type BlokajColorBy = 'status' | 'account' | 'balance' | 'roomType';
export interface Appearance {
  preset: string;
  primary: string;
  accent: string;
  nav: string;
  bg: string;
  pattern: 'none' | 'dots' | 'grid' | 'gradient' | 'lines';
  iconStyle: 'tinted' | 'solid' | 'plain' | 'mono';
  iconSize: 'm' | 'l';
  fontScale: 'sm' | 'md' | 'lg';
  radius: 'square' | 'soft' | 'round';
  rack: RackColors;
  blokaj: BlokajColors;
  blokajBy: BlokajColorBy;
  blokajLabel: 'guest' | 'guestAccount' | 'guestPax';
  blokajWidth: 's' | 'm' | 'l';
}

export const DEFAULT_RACK: RackColors = {
  vacant: '#ffffff', occupied: '#16a34a', dirty: '#dc2626', arrival: '#2563eb', departure: '#f59e0b', blocked: '#64748b', inspected: '#0d9488', cleaning: '#0284c7',
};
export const DEFAULT_BLOKAJ: BlokajColors = { confirmed: '#2563eb', tentative: '#ca8a04', checked_in: '#16a34a', checked_out: '#64748b', block: '#475569' };

export interface Preset { id: string; name: string; primary: string; accent: string; nav: string; bg: string }
/** Hazır temalar: ana renk (düğmeler), vurgu (seçili menü), menü ve sayfa arka planı. */
export const PRESETS: Preset[] = [
  { id: 'ferrolit', name: 'Ferrolit Grafit', primary: '#22262e', accent: '#c2461a', nav: '#22262e', bg: '#f4f6fa' },
  { id: 'gece', name: 'Gece Mavisi', primary: '#1e3a8a', accent: '#2563eb', nav: '#172554', bg: '#f1f5fb' },
  { id: 'okyanus', name: 'Okyanus', primary: '#0e7490', accent: '#0891b2', nav: '#083344', bg: '#f0f9fb' },
  { id: 'orman', name: 'Orman', primary: '#166534', accent: '#16a34a', nav: '#14301f', bg: '#f3f8f4' },
  { id: 'bordo', name: 'Bordo', primary: '#881337', accent: '#be123c', nav: '#3b0a18', bg: '#fbf3f5' },
  { id: 'mor', name: 'Lavanta', primary: '#5b21b6', accent: '#7c3aed', nav: '#2e1065', bg: '#f6f4fd' },
  { id: 'gumus', name: 'Gümüş (açık menü)', primary: '#334155', accent: '#2563eb', nav: '#e2e8f0', bg: '#f8fafc' },
  { id: 'kum', name: 'Kum', primary: '#78350f', accent: '#d97706', nav: '#44260c', bg: '#faf6ef' },
  { id: 'deniz', name: 'Ofis Mavi (açık menü)', primary: '#1d4ed8', accent: '#1d4ed8', nav: '#dbeafe', bg: '#f5f8ff' },
  { id: 'kontrast', name: 'Yüksek Kontrast', primary: '#000000', accent: '#b91c1c', nav: '#000000', bg: '#ffffff' },
];

export const DEFAULT_APPEARANCE: Appearance = {
  preset: 'ferrolit', primary: PRESETS[0].primary, accent: PRESETS[0].accent, nav: PRESETS[0].nav, bg: PRESETS[0].bg,
  pattern: 'none', iconStyle: 'tinted', iconSize: 'm', fontScale: 'md', radius: 'soft',
  rack: DEFAULT_RACK, blokaj: DEFAULT_BLOKAJ, blokajBy: 'status', blokajLabel: 'guest', blokajWidth: 'm',
};

const KEY = 'ferrolit.appearance.v1';
const HEX = /^#[0-9a-f]{6}$/i;

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const v = JSON.parse(raw) as Partial<Appearance>;
    const color = (x: unknown, d: string) => (typeof x === 'string' && HEX.test(x) ? x : d);
    const pick = <T extends string>(x: unknown, allowed: readonly T[], d: T): T => (allowed.includes(x as T) ? (x as T) : d);
    const d = DEFAULT_APPEARANCE;
    return {
      preset: typeof v.preset === 'string' ? v.preset : d.preset,
      primary: color(v.primary, d.primary), accent: color(v.accent, d.accent), nav: color(v.nav, d.nav), bg: color(v.bg, d.bg),
      pattern: pick(v.pattern, ['none', 'dots', 'grid', 'gradient', 'lines'] as const, d.pattern),
      iconStyle: pick(v.iconStyle, ['tinted', 'solid', 'plain', 'mono'] as const, d.iconStyle),
      iconSize: pick(v.iconSize, ['m', 'l'] as const, d.iconSize),
      fontScale: pick(v.fontScale, ['sm', 'md', 'lg'] as const, d.fontScale),
      radius: pick(v.radius, ['square', 'soft', 'round'] as const, d.radius),
      rack: Object.fromEntries(Object.entries(DEFAULT_RACK).map(([k, dv]) => [k, color((v.rack as Record<string, unknown> | undefined)?.[k], dv)])) as unknown as RackColors,
      blokaj: Object.fromEntries(Object.entries(DEFAULT_BLOKAJ).map(([k, dv]) => [k, color((v.blokaj as Record<string, unknown> | undefined)?.[k], dv)])) as unknown as BlokajColors,
      blokajBy: pick(v.blokajBy, ['status', 'account', 'balance', 'roomType'] as const, d.blokajBy),
      blokajLabel: pick(v.blokajLabel, ['guest', 'guestAccount', 'guestPax'] as const, d.blokajLabel),
      blokajWidth: pick(v.blokajWidth, ['s', 'm', 'l'] as const, d.blokajWidth),
    };
  } catch { return DEFAULT_APPEARANCE; }
}

function save(a: Appearance) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* depolama kapalı olabilir; görünüm bu oturumda geçerli kalır */ }
}

/* ---------------------------------------------------------------- Renk hesapları */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
/** İki rengi karıştırır (t: 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
/** WCAG göreli parlaklığı; açık zeminde koyu yazı seçmek için. */
export function luminance(c: string) {
  const ch = rgb(c).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export const isLight = (c: string) => luminance(c) > 0.45;
/** Zemin rengine göre okunaklı yazı rengi. */
export const textOn = (c: string) => (isLight(c) ? '#0f172a' : '#ffffff');

function apply(a: Appearance) {
  const r = document.documentElement;
  const s = r.style;
  const lightNav = isLight(a.nav);
  s.setProperty('--primary', a.primary);
  s.setProperty('--primary-600', mix(a.primary, '#000000', 0.25));
  s.setProperty('--primary-50', mix(a.accent, '#ffffff', 0.92));
  s.setProperty('--primary-100', mix(a.accent, '#ffffff', 0.8));
  s.setProperty('--on-primary', textOn(a.primary));
  s.setProperty('--accent', a.accent);
  s.setProperty('--on-accent', textOn(a.accent));
  s.setProperty('--nav', a.nav);
  s.setProperty('--nav-2', mix(a.nav, lightNav ? '#000000' : '#000000', lightNav ? 0.06 : 0.22));
  s.setProperty('--nav-hover', mix(a.nav, lightNav ? '#000000' : '#ffffff', lightNav ? 0.08 : 0.1));
  s.setProperty('--nav-line', mix(a.nav, lightNav ? '#000000' : '#ffffff', lightNav ? 0.14 : 0.16));
  s.setProperty('--nav-text', lightNav ? '#334155' : mix(a.nav, '#ffffff', 0.78));
  s.setProperty('--nav-strong', lightNav ? '#0f172a' : '#ffffff');
  s.setProperty('--nav-muted', lightNav ? '#64748b' : mix(a.nav, '#ffffff', 0.55));
  s.setProperty('--bg', a.bg);
  for (const [k, v] of Object.entries(a.rack)) {
    s.setProperty(`--rk-${k}`, v);
    s.setProperty(`--rk-${k}-soft`, mix(v, '#ffffff', 0.84));
    s.setProperty(`--rk-${k}-text`, textOn(v));
  }
  for (const [k, v] of Object.entries(a.blokaj)) {
    s.setProperty(`--bk-${k}`, v);
    s.setProperty(`--bk-${k}-soft`, mix(v, '#ffffff', 0.82));
    s.setProperty(`--bk-${k}-text`, mix(v, '#000000', 0.45));
  }
  r.dataset.pattern = a.pattern;
  r.dataset.icons = a.iconStyle;
  r.dataset.iconSize = a.iconSize;
  r.dataset.font = a.fontScale;
  r.dataset.radius = a.radius;
}

interface Ctx { a: Appearance; set: (p: Partial<Appearance>) => void; reset: () => void; applyPreset: (p: Preset) => void }
const AppearanceCtx = createContext<Ctx | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [a, setA] = useState<Appearance>(load);
  useEffect(() => { apply(a); save(a); }, [a]);
  const set = useCallback((p: Partial<Appearance>) => setA(s => ({ ...s, ...p })), []);
  const reset = useCallback(() => setA(DEFAULT_APPEARANCE), []);
  const applyPreset = useCallback((p: Preset) => setA(s => ({ ...s, preset: p.id, primary: p.primary, accent: p.accent, nav: p.nav, bg: p.bg })), []);
  const value = useMemo(() => ({ a, set, reset, applyPreset }), [a, set, reset, applyPreset]);
  return <AppearanceCtx.Provider value={value}>{children}</AppearanceCtx.Provider>;
}

export function useAppearance() {
  const c = useContext(AppearanceCtx);
  if (!c) throw new Error('AppearanceProvider eksik');
  return c;
}

/** Firma/acente gibi metinlerden sabit, ayırt edilebilir renk (blokajda "firmaya göre" renklendirme). */
export function colorFor(text: string | undefined | null) {
  if (!text) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const palette = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#be123c', '#4d7c0f', '#0f766e', '#9333ea', '#c2410c'];
  return palette[h % palette.length];
}
