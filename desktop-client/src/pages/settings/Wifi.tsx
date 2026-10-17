import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, Eye, EyeOff, FileText, KeyRound, Plug, Printer, RefreshCw, Save, ShieldCheck, Wifi } from 'lucide-react';
import { api, del, get, post } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { PageHead, useAction } from '../../components/common';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, useConfirm, useToast } from '../../components/ui';
import { DocFooter, DocHeader } from '../../components/PrintDoc';

interface WifiAttempt { at: string; nasIp?: string; mac?: string; usernameMasked?: string; accepted: boolean; reason: string; guestName?: string; roomNumber?: string }
interface WifiSession { startedAt: string; stoppedAt?: string; updatedAt: string; guestName?: string; roomNumber?: string; mac?: string; framedIp?: string; nasIp: string; inputBytes: number; outputBytes: number }
interface WifiState {
  enabled: boolean; sharedSecret?: string; allowedClients: string[]; passwordMode: 'room' | 'last_name'; includeSharers: boolean; graceHours: number;
  providerName?: string; apiKeyHint?: string; apiKeyCreatedAt?: string; httpsPort: number; caFingerprint?: string;
  authPort: number; acctPort: number; status: string; lastRequestAt?: string; addresses: string[]; attempts: WifiAttempt[]; activeSessions: WifiSession[];
}

const REASON: Record<string, string> = {
  ok: 'Kabul edildi', not_in_house: 'Bu kimlik numarasıyla konaklayan misafir yok', wrong_password: 'Şifre uyuşmadı', locked: 'Çok fazla hatalı deneme (10 dk kilit)',
  bad_username: 'Kullanıcı adı geçersiz', disabled: 'Wi-Fi entegrasyonu kapalı', unsupported_method: 'Cihaz desteklenmeyen yöntem gönderdi (PAP/CHAP olmalı)',
};
const mb = (b: number) => `${(b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
const groupFp = (fp?: string) => (fp ? fp.match(/.{1,4}/g)?.join(' ') ?? fp : '—');

/**
 * Wi-Fi entegrasyonu: otelin Wi-Fi (hotspot) sistemi başka bir firmaya aittir; o firma sistemini buradaki bilgilerle PMS'e bağlar.
 * Misafir giriş sayfasına kimlik no ve oda numarasını yazar; firma bunu RADIUS veya HTTP API ile PMS'e sorar.
 */
export default function WifiSettingsPage() {
  const q = useQuery({ queryKey: ['wifi'], queryFn: () => get<WifiState>('/api/v1/wifi'), refetchInterval: 15000 });
  if (q.isLoading) return <div className="page"><Spinner /></div>;
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  return <WifiForm s={q.data!} />;
}

function WifiForm({ s }: { s: WifiState }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(s.enabled);
  const [mode, setMode] = useState(s.passwordMode);
  const [sharers, setSharers] = useState(s.includeSharers);
  const [grace, setGrace] = useState(String(s.graceHours));
  const [clients, setClients] = useState(s.allowedClients.join('\n'));
  const [provider, setProvider] = useState(s.providerName ?? '');
  const [showSecret, setShowSecret] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [tUser, setTUser] = useState('');
  const [tPass, setTPass] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; reason: string; guestName?: string; roomNumber?: string; validUntil?: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['wifi'] });

  const save = useAction(async () => {
    await api('PUT', '/api/v1/wifi', {
      enabled, passwordMode: mode, includeSharers: sharers, graceHours: Number(grace), providerName: provider.trim() || null,
      allowedClients: clients.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean),
    });
    await refresh();
    setTimeout(() => void refresh(), 3000); // sunucu RADIUS dinlemeye birkaç saniye içinde başlar
  }, { success: 'Wi-Fi entegrasyon ayarları kaydedildi.' });
  const rotate = useAction(async (key: string) => { await post('/api/v1/wifi/secret', {}, key); await refresh(); }, { success: 'Yeni RADIUS ortak anahtarı oluşturuldu. Wi-Fi firmasına iletin.' });
  const createKey = useAction(async (key: string) => { const r = await post<{ apiKey: string }>('/api/v1/wifi/api-key', {}, key); setNewKey(r.apiKey); await refresh(); });
  const revokeKey = useAction(async () => { await del('/api/v1/wifi/api-key'); await refresh(); }, { success: 'API anahtarı iptal edildi.' });
  const test = useAction(async () => setResult(await post('/api/v1/wifi/test', { userName: tUser, password: tPass })));
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.info('Kopyalandı.'); } catch { toast.error('Panoya kopyalanamadı.'); } };
  const server = s.addresses[0] ?? 'SUNUCU_IP';
  const passLabel = mode === 'room' ? 'oda numaranız' : 'soyadınız';
  const listening = s.status.startsWith('Dinliyor'), starting = s.enabled && s.status === 'Kapalı';
  const apiBase = `https://${server}${s.httpsPort === 443 ? '' : `:${s.httpsPort}`}/api/v1/wifi-gateway`;

  return (
    <div className="page">
      <PageHead title="Wi-Fi Entegrasyonu" sub="Otelin Wi-Fi firması kendi sistemini buradaki bilgilerle PMS'e bağlar; misafir internete kimlik no ve oda numarasıyla girer"
        actions={<button className="btn" disabled={!s.sharedSecret} title={s.sharedSecret ? '' : 'Önce entegrasyonu açıp kaydedin'} onClick={() => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 80); }}>
          <Printer /> Wi-Fi firmasına verilecek belge</button>} />

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-head"><h3><Wifi size={16} /> Durum ve giriş kuralı</h3></div><div className="card-body stack">
          <div className="row" style={{ gap: 8 }}>
            <Badge color={!s.enabled ? 'gray' : listening ? 'green' : starting ? 'gray' : 'red'}>{!s.enabled ? 'Kapalı' : listening ? 'Açık' : starting ? 'Başlatılıyor' : 'Hata'}</Badge>
            <span className="muted" style={{ fontSize: 12.5 }}>{s.enabled ? s.status : 'Açmak için aşağıdaki kutuyu işaretleyip kaydedin.'}{s.enabled && s.lastRequestAt ? ` · son istek ${fmtDateTime(s.lastRequestAt)}` : ''}</span>
          </div>
          <label className="check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Wi-Fi firmasının sistemi misafir girişini PMS'e sorabilsin</label>
          <div className="form-grid">
            <Field label="Wi-Fi firması" className="span-4"><input className="input" value={provider} onChange={e => setProvider(e.target.value)} maxLength={120} placeholder="Firma adı ve destek telefonu" /></Field>
            <Field label="Kullanıcı adı" className="span-4"><input className="input" value="T.C. kimlik no (yabancılar: pasaport no)" disabled /></Field>
            <Field label="Şifre" className="span-2"><select className="input" value={mode} onChange={e => setMode(e.target.value as 'room' | 'last_name')}>
              <option value="room">Oda numarası</option><option value="last_name">Soyadı</option></select></Field>
            <Field label="Çıkıştan sonra ek süre (saat)" className="span-2" hint="İnternet, çıkış günü otelin çıkış saatine bu süre eklenene kadar açık kalır.">
              <input className="input num" value={grace} onChange={e => setGrace(e.target.value.replace(/\D/g, ''))} maxLength={2} /></Field>
            <Field label="Ek misafirler" className="span-4"><label className="check" style={{ height: 32 }}><input type="checkbox" checked={sharers} onChange={e => setSharers(e.target.checked)} /> Odadaki ek misafirler de kendi kimlik numarasıyla girebilir</label></Field>
            <Field label="İzin verilen Wi-Fi cihaz / sunucu IP'leri" className="span-4" hint="Her satıra bir IP. Boşsa otelin yerel ağındaki her cihaz anahtarla bağlanabilir; Wi-Fi firmasının cihaz IP'sini yazmanız önerilir.">
              <textarea className="input mono" rows={2} value={clients} onChange={e => setClients(e.target.value)} placeholder="192.168.1.1" /></Field>
          </div>
          <ErrorBox error={save.error} />
          <div><button className="btn primary" disabled={save.busy || grace === ''} onClick={() => void save.run()}><Save /> Kaydet</button></div>
        </div></div>

        <div className="card"><div className="card-head"><h3>Misafire söylenecek</h3></div><div className="card-body stack">
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>Wi-Fi'ye bağlanınca açılan giriş sayfasında<br />
            <b>Kullanıcı adı:</b> T.C. kimlik numaranız (yabancı misafirler: pasaport numarası)<br />
            <b>Şifre:</b> {passLabel}</div>
          <div className="muted" style={{ fontSize: 12 }}>Yalnız giriş yapılmış (konaklayan) misafirler bağlanabilir; kimlik numarası misafir kartına doğru girilmiş olmalıdır.</div>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <b style={{ fontSize: 13 }}>Misafir bilgilerini dene</b>
          <div className="form-grid">
            <Field label="Kullanıcı adı" className="span-2"><input className="input mono" value={tUser} onChange={e => setTUser(e.target.value)} /></Field>
            <Field label="Şifre" className="span-2"><input className="input" value={tPass} onChange={e => setTPass(e.target.value)} /></Field>
          </div>
          <div><button className="btn" disabled={test.busy || !tUser.trim()} onClick={() => void test.run()}><RefreshCw /> Dene</button></div>
          {result && (result.accepted
            ? <div className="info-box">Girebilir: <b>{result.guestName}</b> · Oda {result.roomNumber} · {fmtDateTime(result.validUntil)} tarihine kadar</div>
            : <div className="warn-box">Giremez: {REASON[result.reason] ?? result.reason}</div>)}
        </div></div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-head"><h3><ShieldCheck size={16} /> Bağlantı yöntemi 1 · RADIUS</h3></div><div className="card-body stack">
          <div className="muted" style={{ fontSize: 12.5 }}>Hotspot cihazları (MikroTik, Ruckus, UniFi, Fortinet, Cisco vb.) çoğunlukla bu yöntemle bağlanır.</div>
          {!s.sharedSecret ? <Empty title="Önce entegrasyonu açıp kaydedin" text="Ortak anahtar ilk kayıtta oluşturulur." /> : <>
            <table className="dt wrap-cells"><tbody>
              <tr><td>RADIUS sunucusu (PMS sunucu IP)</td><td className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{s.addresses.join(', ') || '—'}</td></tr>
              <tr><td>Doğrulama portu</td><td className="mono">UDP {s.authPort}</td></tr>
              <tr><td>Oturum kaydı (accounting) portu</td><td className="mono">UDP {s.acctPort}</td></tr>
              <tr><td>Ortak anahtar (shared secret)</td><td className="mono">
                {showSecret ? s.sharedSecret : '••••••••••••••••'}{' '}
                <button className="btn sm ghost" onClick={() => setShowSecret(v => !v)} aria-label="Göster/gizle">{showSecret ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button className="btn sm ghost" onClick={() => void copy(s.sharedSecret!)} aria-label="Kopyala"><Copy size={14} /></button></td></tr>
              <tr><td>Yöntem</td><td>PAP veya CHAP · yanıtlarda Message-Authenticator</td></tr>
            </tbody></table>
            <div><button className="btn sm" disabled={rotate.busy} onClick={async () => { if (await confirm({ title: 'Ortak anahtarı yenile', message: 'Yeni anahtar Wi-Fi firmasının cihazına girilene kadar misafirler internete giremez.', confirmText: 'Yenile', danger: true })) void rotate.run(); }}><KeyRound /> Anahtarı yenile</button></div>
          </>}
        </div></div>

        <div className="card"><div className="card-head"><h3><Plug size={16} /> Bağlantı yöntemi 2 · HTTP API</h3></div><div className="card-body stack">
          <div className="muted" style={{ fontSize: 12.5 }}>Wi-Fi firmasının kendi giriş sayfası veya sunucusu PMS'e doğrudan JSON istekle sorar. Her istekte <span className="mono">X-PMS-Api-Key</span> başlığı gönderilir.</div>
          <table className="dt wrap-cells"><tbody>
            <tr><td>Doğrulama</td><td className="mono" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>POST {apiBase}/verify</td></tr>
            <tr><td>Oturum bildirimi</td><td className="mono" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>POST {apiBase}/sessions</td></tr>
            <tr><td>API anahtarı</td><td>{s.apiKeyHint ? <><span className="mono">{s.apiKeyHint}</span> <span className="muted">· {fmtDateTime(s.apiKeyCreatedAt)}</span></> : <span className="muted">Oluşturulmadı</span>}</td></tr>
            <tr><td>Sunucu sertifikası</td><td style={{ whiteSpace: 'normal' }}>Otelin yerel sertifikası (SHA-256 <span className="mono" style={{ fontSize: 11 }}>{groupFp(s.caFingerprint)}</span>). Kök sertifika: <span className="mono">https://{server}{s.httpsPort === 443 ? '' : `:${s.httpsPort}`}/api/v1/system/ca.crt</span></td></tr>
          </tbody></table>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm primary" disabled={createKey.busy} onClick={async () => { if (!s.apiKeyHint || await confirm({ title: 'Yeni API anahtarı', message: 'Mevcut anahtar hemen geçersiz olur; Wi-Fi firması yeni anahtarı girene kadar HTTP ile giriş çalışmaz.', confirmText: 'Yeni anahtar oluştur', danger: true })) void createKey.run(); }}>
              <KeyRound /> {s.apiKeyHint ? 'Yeni anahtar oluştur' : 'API anahtarı oluştur'}</button>
            {s.apiKeyHint && <button className="btn sm" disabled={revokeKey.busy} onClick={async () => { if (await confirm({ title: 'API anahtarını iptal et', message: 'HTTP API ile yapılan girişler hemen durur.', confirmText: 'İptal et', danger: true })) void revokeKey.run(); }}><Ban /> İptal et</button>}
          </div>
          <ErrorBox error={createKey.error ?? revokeKey.error} />
        </div></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}><div className="card-head"><h3>Açık oturumlar ({s.activeSessions.length})</h3></div><div className="card-body">
        {s.activeSessions.length === 0 ? <Empty title="Açık oturum yok" text="Wi-Fi firmasının sistemi oturum bildirdiğinde burada görünür." /> : (
          <div className="table-wrap" style={{ maxHeight: 320 }}><table className="dt">
            <thead><tr><th>Başlangıç</th><th>Oda</th><th>Misafir</th><th>Cihaz (MAC)</th><th>İç IP</th><th style={{ textAlign: 'right' }}>İndirilen</th><th>Son güncelleme</th></tr></thead>
            <tbody>{s.activeSessions.map((x, i) => <tr key={i}><td>{fmtDateTime(x.startedAt)}</td><td>{x.roomNumber}</td><td>{x.guestName}</td><td className="mono">{x.mac}</td><td className="mono">{x.framedIp}</td><td className="num">{mb(x.outputBytes)}</td><td className="muted">{fmtDateTime(x.updatedAt)}</td></tr>)}</tbody>
          </table></div>)}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Geçmiş oturumlar: Raporlar → Sistem → Wi-Fi Oturumları.</div>
      </div></div>

      <div className="card"><div className="card-head"><h3>Son giriş denemeleri</h3></div><div className="card-body">
        {s.attempts.length === 0 ? <Empty title="Henüz deneme yok" /> : (
          <div className="table-wrap" style={{ maxHeight: 320 }}><table className="dt">
            <thead><tr><th>Zaman</th><th>Sonuç</th><th>Kullanıcı adı</th><th>Misafir / oda</th><th>Cihaz (MAC)</th><th>Wi-Fi cihazı</th></tr></thead>
            <tbody>{s.attempts.map((a, i) => <tr key={i}><td>{fmtDateTime(a.at)}</td><td>{a.accepted ? <Badge color="green">Kabul</Badge> : <Badge color="red">{REASON[a.reason] ?? a.reason}</Badge>}</td>
              <td className="mono">{a.usernameMasked}</td><td>{a.guestName ? `${a.guestName} · ${a.roomNumber ?? ''}` : ''}</td><td className="mono">{a.mac}</td><td className="mono">{a.nasIp}</td></tr>)}</tbody>
          </table></div>)}
      </div></div>

      {newKey && (
        <Modal title="API anahtarı oluşturuldu" onClose={() => setNewKey(null)} footer={<button className="btn primary" onClick={() => setNewKey(null)}>Kaydettim, kapat</button>}>
          <div className="stack">
            <div className="warn-box">Bu anahtar yalnız şimdi gösterilir; PMS anahtarın kendisini saklamaz. Kopyalayıp Wi-Fi firmasına güvenli bir yoldan iletin.</div>
            <div className="row" style={{ gap: 8 }}><input className="input mono" readOnly value={newKey} onFocus={e => e.target.select()} /><button className="btn" onClick={() => void copy(newKey)}><Copy /> Kopyala</button></div>
          </div>
        </Modal>
      )}
      {printing && createPortal(<IntegrationDoc s={s} apiBase={apiBase} server={server} />, document.getElementById('print-root')!)}
    </div>
  );
}

/** Wi-Fi firmasına verilecek entegrasyon belgesi. Ortak anahtar içerir; API anahtarı ayrıca iletilir. */
function IntegrationDoc({ s, apiBase, server }: { s: WifiState; apiBase: string; server: string }) {
  const pass = s.passwordMode === 'room' ? 'oda numarası' : 'soyadı';
  const pre = { whiteSpace: 'pre-wrap' as const, fontSize: '8.5pt', background: '#f4f4f5', padding: '2.5mm 3mm', borderRadius: '1.5mm', margin: '1.5mm 0 3mm' };
  return (
    <div className="doc folio-doc">
      <DocHeader kind="Wi-Fi entegrasyon bilgileri" no={s.providerName || 'Wi-Fi firması'} lines={['Gizli: yalnız entegrasyonu yapan firmaya verin']} />
      <div style={{ fontSize: '9.5pt', lineHeight: 1.55 }}>
        <p><b>Kural.</b> Misafir giriş sayfasında kullanıcı adı olarak T.C. kimlik numarasını (yabancılar pasaport numarasını), şifre olarak {pass}nı yazar.
          PMS yalnız o anda otelde konaklayan (giriş yapılmış) misafiri kabul eder; izin, çıkış günü otelin çıkış saatine {s.graceHours} saat eklenene kadar geçerlidir.
          {s.includeSharers ? ' Odadaki ek misafirler de kendi kimlik numarasıyla girebilir.' : ''} Aynı cihazdan 10 dakikada 5 hatalı denemede cihaz 10 dakika kilitlenir.
          İstekler yalnız otelin yerel ağından{s.allowedClients.length ? ` ve şu IP'lerden kabul edilir: ${s.allowedClients.join(', ')}` : ' kabul edilir'}.</p>

        <h4 style={{ margin: '4mm 0 1mm' }}><FileText size={12} /> Yöntem 1 · RADIUS (RFC 2865 / 2866)</h4>
        <table className="fd-table"><tbody>
          <tr><td>Sunucu</td><td className="mono">{s.addresses.join(', ')}</td></tr>
          <tr><td>Doğrulama / oturum kaydı portu</td><td className="mono">UDP {s.authPort} / UDP {s.acctPort}</td></tr>
          <tr><td>Ortak anahtar</td><td className="mono">{s.sharedSecret}</td></tr>
          <tr><td>Yöntem</td><td>PAP veya CHAP. Access-Accept: Session-Timeout (saniye), Class, Reply-Message; yanıtlarda Message-Authenticator. Accounting Start/Interim/Stop, Accounting-On/Off desteklenir.</td></tr>
        </tbody></table>
        <div>Örnek (MikroTik RouterOS):</div>
        <pre className="mono" style={pre}>{`/radius add service=hotspot address=${server} secret=<ortak anahtar> authentication-port=${s.authPort} accounting-port=${s.acctPort}
/ip hotspot profile set [find] use-radius=yes radius-accounting=yes radius-interim-update=10m`}</pre>

        <h4 style={{ margin: '4mm 0 1mm' }}>Yöntem 2 · HTTP API (JSON)</h4>
        <div>Her istekte <span className="mono">X-PMS-Api-Key: &lt;API anahtarı&gt;</span> başlığı. Anahtar otel tarafından ayrıca iletilir. HTTPS sertifikası otelin yerel kök sertifikasıyla imzalıdır
          (SHA-256 <span className="mono">{groupFp(s.caFingerprint)}</span>; indirme: <span className="mono">{apiBase.replace('/api/v1/wifi-gateway', '')}/api/v1/system/ca.crt</span>).</div>
        <pre className="mono" style={pre}>{`POST ${apiBase}/verify
{ "userName": "12345678901", "password": "101", "mac": "AA:BB:CC:DD:EE:FF", "ip": "10.5.50.23" }
→ 200 { "accepted": true, "reason": "ok", "message": "Hoş geldiniz Ali", "guestFirstName": "Ali", "roomNumber": "101",
        "validUntil": "2026-10-20T09:00:00Z", "sessionSeconds": 86400 }
→ 200 { "accepted": false, "reason": "wrong_password", "message": "Kimlik numarası veya şifre hatalı." }
   reason: ok | not_in_house | wrong_password | locked | bad_username`}</pre>
        <pre className="mono" style={pre}>{`POST ${apiBase}/sessions
{ "sessionId": "abc-123", "event": "start", "userName": "12345678901", "mac": "AA:BB:CC:DD:EE:FF", "ip": "10.5.50.23" }
{ "sessionId": "abc-123", "event": "update", "inputBytes": 1048576, "outputBytes": 5242880 }
{ "sessionId": "abc-123", "event": "stop", "inputBytes": 2097152, "outputBytes": 9437184, "cause": "Kullanıcı çıkış yaptı" }
→ 200 { "ok": true }`}</pre>
        <div>Hata yanıtları: 401 anahtar eksik/geçersiz · 403 entegrasyon kapalı, yerel ağ dışı veya izinsiz IP · 422 geçersiz alan. Gövde: {'{ "code": "...", "message": "..." }'}</div>
      </div>
      <DocFooter note="Ortak anahtar ve API anahtarı gizlidir; yetkisiz kişilerle paylaşmayın. Anahtarlar PMS'te Yönetim → Wi-Fi Entegrasyonu ekranından yenilenebilir." />
    </div>
  );
}
