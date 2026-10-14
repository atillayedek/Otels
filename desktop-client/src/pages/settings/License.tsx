import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useLicense } from '../../lib/queries';
import { SUPPORT_EMAIL } from '../../lib/product';
import { Kv, PageHead, useAction } from '../../components/common';
import { Badge, ErrorBox, Field, Spinner } from '../../components/ui';

const STATE: Record<string, { label: string; color: 'green' | 'blue' | 'orange' | 'red' }> = {
  licensed: { label: 'Lisanslı', color: 'green' }, trial: { label: 'Deneme sürümü', color: 'blue' },
  trial_expired: { label: 'Deneme süresi doldu', color: 'red' }, expired: { label: 'Lisans süresi doldu', color: 'red' }, invalid: { label: 'Geçersiz lisans', color: 'red' },
};
const MODULES: Record<string, string> = { restaurant: 'Restoran / Adisyon', stock: 'Stok ve Satın Alma', accounting: 'Muhasebe' };

export default function LicensePage() {
  const qc = useQueryClient();
  const lic = useLicense();
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const install = useAction(async () => {
    await api('POST', '/api/v1/license', { content: text.trim() });
    setText('');
    await qc.invalidateQueries({ queryKey: ['license'] });
  }, { success: 'Lisans yüklendi.' });
  const readFile = (f?: File) => { if (f) void f.text().then(t => setText(t.trim())); };

  if (lic.isLoading) return <div className="page"><Spinner /></div>;
  if (lic.error) return <div className="page"><ErrorBox error={lic.error} /></div>;
  const l = lic.data!;
  const st = STATE[l.state] ?? { label: l.state, color: 'orange' as const };
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title="Lisans" sub="Ferrolit PMS ürün lisansı" />
      <div className="split">
        <div className="card">
          <div className="card-head"><h3><ShieldCheck size={16} /> Lisans durumu</h3><span className="spacer" /><Badge color={st.color}>{st.label}</Badge></div>
          <div className="card-body stack">
            <div className={l.restricted ? 'error-box' : l.state === 'trial' ? 'warn-box' : 'ok-box'}>{l.message}</div>
            <Kv items={[
              ['Lisans no', l.licenseId ?? '—'],
              ['Müşteri', l.customer ?? '—'],
              ['Otel', l.hotel ?? '—'],
              ['Vergi no', l.taxNumber ?? 'Bağlı değil'],
              ['Oda sınırı', l.maxRooms ? `${l.maxRooms} oda (aktif ${l.activeRooms})` : l.state === 'trial' ? `Sınırsız (deneme) · aktif ${l.activeRooms}` : '—'],
              ['Ek modüller', l.state === 'trial' ? 'Tümü (deneme)' : l.modules.length ? l.modules.map(m => MODULES[m] ?? m).join(', ') : 'Yok (yalnız otel yönetimi)'],
              ['Geçerlilik', l.state === 'trial' ? `Deneme bitişi ${fmtDate(l.trialEndsAt)}` : l.expiresAt ? fmtDate(l.expiresAt) : l.licenseId ? 'Süresiz' : '—'],
              ['Destek ve güncelleme', l.supportUntil ? fmtDate(l.supportUntil) : '—'],
            ]} />
            <div className="muted" style={{ fontSize: 12 }}>
              Lisans süresi dolsa bile veriler kilitlenmez: kayıtlara erişim, çıkış, tahsilat, gece denetimi, raporlar ve yedekleme çalışır; yalnız yeni rezervasyon,
              giriş ve adisyon açılamaz. Lisans ve destek için: {SUPPORT_EMAIL}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3><KeyRound size={16} /> Lisans yükle</h3></div>
          <div className="card-body stack">
            <div className="muted" style={{ fontSize: 12 }}>TSDMR Digital Studio'dan aldığınız <b>.lisans</b> dosyasını seçin veya içeriğini yapıştırın. Lisans vergi numarasına bağlıysa önce
              Yönetim → Tesis Bilgileri'nde vergi numarasını doğru girin.</div>
            <input ref={fileRef} type="file" accept=".lisans,.txt" style={{ display: 'none' }} onChange={e => readFile(e.target.files?.[0])} />
            <button className="btn" onClick={() => fileRef.current?.click()}><FileUp /> Lisans dosyası seç</button>
            <Field label="Lisans metni">
              <textarea className="input mono" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="TSDMR-LISANS-1.…" style={{ fontSize: 11, wordBreak: 'break-all' }}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]); }} />
            </Field>
            <ErrorBox error={install.error} />
            <div className="row"><span className="spacer" /><button className="btn primary" disabled={!text.trim() || install.busy} onClick={() => void install.run()}><Upload /> Lisansı yükle</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
