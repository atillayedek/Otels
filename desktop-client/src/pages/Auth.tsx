import { useEffect, useMemo, useState } from 'react';
import { LogIn, KeyRound, Settings2 } from 'lucide-react';
import { api, errorText, newKey } from '../lib/api';
import { useSession } from '../lib/session';
import { PRODUCT_NAME, SUPPORT_EMAIL } from '../lib/product';
import { ErrorBox, Field } from '../components/ui';
import { fmtDate } from '../lib/format';

function AuthFrame({ children, side }: { children: React.ReactNode; side?: React.ReactNode }) {
  const { client } = useSession();
  return (
    <div className="auth-wrap">
      <div className="auth-side">
        <div><img src="/logo.svg" width={48} alt="" /></div>
        <div>
          <h1>{PRODUCT_NAME}</h1>
          {side ?? <p>Otelinizin kendi sunucusunda çalışan yönetim sistemi. Tüm veriler otelin içinde kalır; internet bağlantısı gerekmez.</p>}
        </div>
        <small style={{ color: '#aab1bd' }}>Sunucu: {client?.activeServer ? `${client.activeServer.name} · ${client.activeServer.host}` : '-'} · Sürüm {client?.version}<br />Destek: {SUPPORT_EMAIL}</small>
      </div>
      <div className="auth-panel"><div className="auth-box">{children}</div></div>
    </div>
  );
}

export function LoginPage({ onSettings }: { onSettings: () => void }) {
  const { login } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(username, password); }
    catch (err) { setError(err); setPassword(''); }
    finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <form className="stack" onSubmit={submit}>
        <h2>Oturum aç</h2>
        <p className="muted" style={{ margin: 0 }}>Kullanıcı adınız ve parolanızla giriş yapın.</p>
        <Field label="Kullanıcı adı"><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" /></Field>
        <Field label="Parola"><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <ErrorBox error={error} />
        <button className="btn primary" style={{ height: 38 }} disabled={busy || !username || !password}><LogIn /> {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
        <button type="button" className="btn ghost" onClick={onSettings}><Settings2 /> Sunucu bağlantısı ayarları</button>
      </form>
    </AuthFrame>
  );
}

export function ChangePasswordForm({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) { setError('Yeni parolalar aynı değil.'); return; }
    setBusy(true);
    setError(null);
    try { await api('POST', '/api/v1/auth/change-password', { currentPassword: current, newPassword: next }); onDone(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {forced && <div className="info-box">Güvenliğiniz için ilk girişte parolanızı değiştirmeniz gerekiyor.</div>}
      <Field label="Mevcut parola"><input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus /></Field>
      <Field label="Yeni parola" hint="En az 10 karakter; harf ve rakam içermeli."><input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} /></Field>
      <Field label="Yeni parola (tekrar)"><input className="input" type="password" value={again} onChange={e => setAgain(e.target.value)} /></Field>
      {error && <div className="error-box">{error}</div>}
      <button className="btn primary" disabled={busy || !current || !next}><KeyRound /> Parolayı değiştir</button>
    </form>
  );
}

export function ForcedPasswordPage() {
  const { refreshMe, logout } = useSession();
  return (
    <AuthFrame>
      <h2>Parola değişikliği</h2>
      <ChangePasswordForm forced onDone={() => void refreshMe()} />
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => void logout()}>Çıkış</button>
    </AuthFrame>
  );
}

const STEPS = ['Hoş geldiniz', 'Otel bilgileri', 'Yönetici hesabı', 'Özet'];

/** İlk kurulum: sunucu ekranındaki tek kullanımlık kurulum kodu olmadan tamamlanamaz. */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [zones, setZones] = useState<string[]>([]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [f, setF] = useState({
    setupCode: '', hotelName: '', legalName: '', taxOffice: '', taxNumber: '', address: '', city: '', phone: '', email: '',
    timeZone: 'Europe/Istanbul', currency: 'TRY', businessDate: today, adminUsername: '', adminFullName: '', adminPassword: '', adminPassword2: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    // Saat dilimi listesi yalnız kurulum sonrası yetkiyle alınabilir; kurulumda yaygın değerler sunulur.
    setZones(['Europe/Istanbul', 'Europe/Nicosia', 'Asia/Baku', 'Europe/Berlin', 'Europe/London', 'UTC']);
  }, []);

  const canNext = [
    true,
    f.hotelName.trim().length > 0 && f.timeZone && /^[A-Z]{3}$/.test(f.currency) && f.businessDate,
    /^[a-z0-9._-]{3,40}$/.test(f.adminUsername) && f.adminFullName.trim() && f.adminPassword.length >= 10 && f.adminPassword === f.adminPassword2 && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(f.adminPassword) && /\d/.test(f.adminPassword),
    f.setupCode.trim().length >= 10,
  ][step];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { adminPassword2: _, ...body } = f;
      void _;
      await api('POST', '/api/v1/setup', { ...body, setupCode: f.setupCode.trim().toUpperCase() }, { key });
      onDone();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <AuthFrame side={<p>Sunucu hazır. Bu kısa sihirbazla otel bilgilerini ve ilk yönetici hesabını oluşturun. Odalar, kullanıcılar ve fiyatlar sonrasında Yönetim menüsünden tanımlanır; eski programınızdaki veriler Veri Aktarım Merkezi'nden alınabilir.</p>}>
      <h2>İlk kurulum</h2>
      <div className="steps">{STEPS.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}</div>
      {step === 0 && (
        <div className="stack">
          <p style={{ margin: 0 }}>Bu sunucuda henüz otel tanımlı değil. Kurulum sonunda sistem boş başlar; örnek veya deneme kaydı oluşturulmaz.</p>
          <div className="info-box">Son adımda, sunucu bilgisayarındaki <b>PMS Server Manager</b> ekranında görünen <b>kurulum kodu</b> istenecektir.</div>
        </div>
      )}
      {step === 1 && (
        <div className="form-grid">
          <Field label="Otel adı" required className="span-4"><input className="input" value={f.hotelName} onChange={set('hotelName')} autoFocus /></Field>
          <Field label="Ticari unvan" className="span-4"><input className="input" value={f.legalName} onChange={set('legalName')} /></Field>
          <Field label="Vergi dairesi" className="span-2"><input className="input" value={f.taxOffice} onChange={set('taxOffice')} /></Field>
          <Field label="Vergi no" className="span-2"><input className="input" value={f.taxNumber} onChange={set('taxNumber')} /></Field>
          <Field label="Şehir" className="span-2"><input className="input" value={f.city} onChange={set('city')} /></Field>
          <Field label="Telefon" className="span-2"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Saat dilimi" required className="span-2"><select className="input" value={f.timeZone} onChange={set('timeZone')}>{zones.map(z => <option key={z}>{z}</option>)}</select></Field>
          <Field label="Para birimi" required><select className="input" value={f.currency} onChange={set('currency')}>{['TRY', 'EUR', 'USD', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Başlangıç iş günü" required hint="Gece denetimi bu tarihten ilerler."><input className="input" type="date" value={f.businessDate} onChange={set('businessDate')} /></Field>
        </div>
      )}
      {step === 2 && (
        <div className="form-grid">
          <Field label="Ad soyad" required className="span-4"><input className="input" value={f.adminFullName} onChange={set('adminFullName')} autoFocus /></Field>
          <Field label="Kullanıcı adı" required className="span-4" hint="Küçük harf, rakam, nokta, tire (3–40 karakter)"><input className="input" value={f.adminUsername} onChange={e => setF(s => ({ ...s, adminUsername: e.target.value.toLowerCase() }))} /></Field>
          <Field label="Parola" required className="span-2" hint="En az 10 karakter, harf ve rakam"><input className="input" type="password" value={f.adminPassword} onChange={set('adminPassword')} /></Field>
          <Field label="Parola (tekrar)" required className="span-2"><input className="input" type="password" value={f.adminPassword2} onChange={set('adminPassword2')} /></Field>
        </div>
      )}
      {step === 3 && (
        <div className="stack">
          <div className="card"><div className="card-body" style={{ lineHeight: 1.8 }}>
            <b>{f.hotelName}</b><br />Saat dilimi: {f.timeZone} · Para birimi: {f.currency} · İş günü: {fmtDate(f.businessDate)}<br />Yönetici: {f.adminFullName} ({f.adminUsername})
          </div></div>
          <Field label="Kurulum kodu" required hint="Sunucu bilgisayarında PMS Server Manager → Durum ekranında görünür."><input className="input mono" value={f.setupCode} onChange={e => setF(s => ({ ...s, setupCode: e.target.value.toUpperCase() }))} placeholder="XXXXX-XXXXX" autoFocus /></Field>
          {error && <div className="error-box">{error}</div>}
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        {step > 0 && <button className="btn" onClick={() => setStep(s => s - 1)} disabled={busy}>Geri</button>}
        <span className="spacer" />
        {step < 3 && <button className="btn primary" disabled={!canNext} onClick={() => setStep(s => s + 1)}>İleri</button>}
        {step === 3 && <button className="btn primary" disabled={!canNext || busy} onClick={() => void submit()}>{busy ? 'Kuruluyor…' : 'Kurulumu tamamla'}</button>}
      </div>
      <ErrorBox error={null} />
    </AuthFrame>
  );
}
