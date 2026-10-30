import { useState, type ReactNode } from 'react';
import { BedDouble, CalendarRange, Check, ClipboardList, Gauge, Moon, RotateCcw, SlidersHorizontal, UserPlus } from 'lucide-react';
import { DEFAULT_BLOKAJ, DEFAULT_RACK, PRESETS, textOn, useAppearance, type Appearance, type BlokajColors, type RackColors } from '../lib/appearance';
import { Modal } from './ui';

const RACK_LABEL: Record<keyof RackColors, string> = {
  vacant: 'Boş (temiz)', occupied: 'Dolu', dirty: 'Kirli', arrival: 'Geliş bekleniyor', departure: 'Bugün çıkış', blocked: 'Bloke / arızalı', inspected: 'Kontrol edildi', cleaning: 'Temizleniyor',
};
const BLOKAJ_LABEL: Record<keyof BlokajColors, string> = { confirmed: 'Onaylı', tentative: 'Opsiyon', checked_in: 'Konaklıyor', checked_out: 'Çıkış yaptı', block: 'Oda blokajı' };

function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, ReactNode][] }) {
  return <div className="seg">{items.map(([k, l]) => <button key={k} type="button" className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ap-color">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      <span>{label}</span>
      <code>{value.toUpperCase()}</code>
    </label>
  );
}

type Tab = 'theme' | 'colors' | 'rack' | 'icons';
const TABS: [Tab, string][] = [['theme', 'Hazır temalar'], ['colors', 'Renkler'], ['rack', 'Rack ve Blokaj'], ['icons', 'Simge ve yazı']];

function Presets() {
  const { a, applyPreset } = useAppearance();
  return (
    <div className="ap-presets">
      {PRESETS.map(p => (
        <button key={p.id} type="button" className={`ap-preset ${a.preset === p.id ? 'active' : ''}`} onClick={() => applyPreset(p)}>
          <span className="ap-sw" style={{ background: p.bg }}>
            <i style={{ background: p.nav }} /><b style={{ background: p.primary }} /><em style={{ background: p.accent }} />
          </span>
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Üst çubuktaki palet düğmesinin hızlı menüsü: tek tıkla tema, yazı ve simge boyutu; ayrıntılar için tüm ayarlar. */
export function QuickLook({ onMore, onClose }: { onMore: () => void; onClose: () => void }) {
  const { a, set, applyPreset } = useAppearance();
  return (
    <>
      <div className="ql-backdrop" onMouseDown={onClose} />
      <div className="ql-pop" role="dialog" aria-label="Hızlı görünüm">
        <div className="ql-title">Tema</div>
        <div className="ql-sw">
          {PRESETS.map(p => (
            <button key={p.id} type="button" title={p.name} className={a.preset === p.id ? 'active' : ''} onClick={() => applyPreset(p)}
              style={{ background: `linear-gradient(135deg, ${p.nav} 0 50%, ${p.primary} 50% 100%)` }}>{a.preset === p.id && <Check size={13} />}</button>
          ))}
        </div>
        <div className="ql-title">Yazı boyutu</div>
        <Seg value={a.fontScale} onChange={v => set({ fontScale: v })} items={[['sm', 'Küçük'], ['md', 'Normal'], ['lg', 'Büyük']]} />
        <div className="ql-title">Simge boyutu</div>
        <Seg value={a.iconSize} onChange={v => set({ iconSize: v })} items={[['m', 'Normal'], ['l', 'Büyük']]} />
        <button type="button" className="btn sm" style={{ marginTop: 12, width: '100%' }} onClick={() => { onClose(); onMore(); }}><SlidersHorizontal /> Tüm görünüm ayarları…</button>
      </div>
    </>
  );
}

/** Tema, renk, simge ve yazı ayarları. Değişiklikler anında uygulanır ve bu bilgisayarda saklanır. */
export function AppearanceModal({ onClose }: { onClose: () => void }) {
  const { a, set, reset } = useAppearance();
  const [tab, setTab] = useState<Tab>('theme');
  const custom = (p: Partial<Appearance>) => set({ ...p, preset: 'custom' });
  return (
    <Modal title="Görünüm" size="xl" onClose={onClose} footer={<>
      <button className="btn" onClick={reset}><RotateCcw /> Varsayılana dön</button>
      <span className="spacer" />
      <button className="btn primary" onClick={onClose}><Check /> Tamam</button>
    </>}>
      <div className="ap-tabs">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="ap-grid">
        <section>
          {tab === 'theme' && <>
            <Presets />
            <div className="field" style={{ marginTop: 12 }}><label>Yazı boyutu</label><Seg value={a.fontScale} onChange={v => set({ fontScale: v })} items={[['sm', 'Küçük'], ['md', 'Normal'], ['lg', 'Büyük']]} /></div>
          </>}
          {tab === 'colors' && <>
            <div className="ap-colors">
              <ColorRow label="Tema rengi (düğmeler)" value={a.primary} onChange={v => custom({ primary: v })} />
              <ColorRow label="Vurgu rengi (seçili menü)" value={a.accent} onChange={v => custom({ accent: v })} />
              <ColorRow label="Menü arka planı" value={a.nav} onChange={v => custom({ nav: v })} />
              <ColorRow label="Sayfa arka planı" value={a.bg} onChange={v => custom({ bg: v })} />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Arka plan deseni</label>
              <Seg value={a.pattern} onChange={v => set({ pattern: v })} items={[['none', 'Düz'], ['gradient', 'Geçişli'], ['dots', 'Noktalı'], ['grid', 'Kareli'], ['lines', 'Çizgili']]} />
            </div>
          </>}
          {tab === 'rack' && <>
            <h4>Oda Rack renkleri</h4>
            <div className="ap-colors">
              {(Object.keys(RACK_LABEL) as (keyof RackColors)[]).map(k => (
                <ColorRow key={k} label={RACK_LABEL[k]} value={a.rack[k]} onChange={v => set({ rack: { ...a.rack, [k]: v } })} />
              ))}
            </div>
            <button type="button" className="btn sm ghost" onClick={() => set({ rack: DEFAULT_RACK })}><RotateCcw /> Rack renklerini sıfırla</button>
            <h4>Blokaj renkleri</h4>
            <div className="ap-colors">
              {(Object.keys(BLOKAJ_LABEL) as (keyof BlokajColors)[]).map(k => (
                <ColorRow key={k} label={BLOKAJ_LABEL[k]} value={a.blokaj[k]} onChange={v => set({ blokaj: { ...a.blokaj, [k]: v } })} />
              ))}
            </div>
            <button type="button" className="btn sm ghost" onClick={() => set({ blokaj: DEFAULT_BLOKAJ })}><RotateCcw /> Blokaj renklerini sıfırla</button>
          </>}
          {tab === 'icons' && (
            <div className="stack" style={{ gap: 12 }}>
              <div className="field"><label>Üst menü simge stili</label>
                <Seg value={a.iconStyle} onChange={v => set({ iconStyle: v })} items={[['tinted', 'Renkli kutu'], ['solid', 'Dolgulu'], ['plain', 'Sade renkli'], ['mono', 'Tek renk']]} />
              </div>
              <div className="field"><label>Simge boyutu</label><Seg value={a.iconSize} onChange={v => set({ iconSize: v })} items={[['m', 'Normal'], ['l', 'Büyük']]} /></div>
              <div className="field"><label>Yazı boyutu</label><Seg value={a.fontScale} onChange={v => set({ fontScale: v })} items={[['sm', 'Küçük'], ['md', 'Normal'], ['lg', 'Büyük']]} /></div>
              <div className="field"><label>Köşeler</label><Seg value={a.radius} onChange={v => set({ radius: v })} items={[['square', 'Köşeli'], ['soft', 'Yumuşak'], ['round', 'Yuvarlak']]} /></div>
            </div>
          )}
        </section>

        <section>
          <h4>Önizleme</h4>
          <div className="ap-preview" style={{ background: a.bg }}>
            <div className="ap-pnav" style={{ background: a.nav, color: textOn(a.nav) }}>
              <span>Ferrolit</span><b style={{ background: a.accent, color: textOn(a.accent) }}>Oda Rack</b><span>Rezervasyon</span><span>Ön Kasa</span>
            </div>
            <div className="ap-pbody">
              <div className="ap-pquick">
                {[[<Gauge key="g" />, '#4f46e5'], [<BedDouble key="b" />, '#2563eb'], [<CalendarRange key="c" />, '#0284c7'], [<ClipboardList key="r" />, '#7c3aed'], [<UserPlus key="w" />, '#c026d3'], [<Moon key="m" />, '#334155']].map(([ic, tone], i) => (
                  <span key={i} className="qi" style={{ '--tone': tone } as React.CSSProperties}>{ic}</span>
                ))}
              </div>
              <div className="ap-ptiles">
                {(['vacant', 'occupied', 'dirty', 'arrival', 'blocked'] as const).map(k => (
                  <div key={k} className={`ap-tile k-${k}`}><span>{101 + ['vacant', 'occupied', 'dirty', 'arrival', 'blocked'].indexOf(k)}</span><small>{RACK_LABEL[k]}</small></div>
                ))}
              </div>
              <button type="button" className="btn primary sm">Kaydet</button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
