import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Save, ShieldCheck, Wifi } from 'lucide-react';
import { api, get, post } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { PageHead, useAction } from '../../components/common';
import { Badge, Empty, ErrorBox, Field, Spinner, useConfirm, useToast } from '../../components/ui';

interface WifiAttempt { at: string; nasIp?: string; mac?: string; usernameMasked?: string; accepted: boolean; reason: string; guestName?: string; roomNumber?: string }
interface WifiSession { startedAt: string; stoppedAt?: string; updatedAt: string; guestName?: string; roomNumber?: string; mac?: string; framedIp?: string; nasIp: string; inputBytes: number; outputBytes: number }
interface WifiState {
  enabled: boolean; sharedSecret?: string; allowedClients: string[]; passwordMode: 'room' | 'last_name'; includeSharers: boolean; graceHours: number;
  authPort: number; acctPort: number; status: string; lastRequestAt?: string; addresses: string[]; attempts: WifiAttempt[]; activeSessions: WifiSession[];
}

const REASON: Record<string, string> = {
  ok: 'Kabul edildi', not_in_house: 'Bu kimlik numarasıyla konaklayan misafir yok', wrong_password: 'Şifre uyuşmadı', locked: 'Çok fazla hatalı deneme (10 dk kilit)',
  bad_username: 'Kullanıcı adı geçersiz', disabled: 'Wi-Fi girişi kapalı', unsupported_method: 'Cihaz desteklenmeyen yöntem gönderdi (PAP/CHAP olmalı)',
};
const mb = (b: number) => `${(b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;

/** Misafir Wi-Fi girişi: otelin hotspot cihazı misafirin yazdığı kimlik no ve oda numarasını RADIUS ile PMS'e sorar. */
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
  const [showSecret, setShowSecret] = useState(false);
  const [tUser, setTUser] = useState('');
  const [tPass, setTPass] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; reason: string; guestName?: string; roomNumber?: string; validUntil?: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['wifi'] });

  const save = useAction(async () => {
    await api('PUT', '/api/v1/wifi', {
      enabled, passwordMode: mode, includeSharers: sharers, graceHours: Number(grace),
      allowedClients: clients.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean),
    });
    await refresh();
    setTimeout(() => void refresh(), 3000); // sunucu dinlemeye birkaç saniye içinde başlar
  }, { success: 'Wi-Fi giriş ayarları kaydedildi.' });
  const rotate = useAction(async (key: string) => { await post('/api/v1/wifi/secret', {}, key); await refresh(); }, { success: 'Yeni ortak anahtar oluşturuldu. Hotspot cihazına da girin.' });
  const test = useAction(async () => setResult(await post('/api/v1/wifi/test', { userName: tUser, password: tPass })));
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.info('Kopyalandı.'); } catch { toast.error('Panoya kopyalanamadı.'); } };
  const server = s.addresses[0] ?? 'SUNUCU_IP';
  const passLabel = mode === 'room' ? 'oda numaranız' : 'soyadınız';

  return (
    <div className="page">
      <PageHead title="Wi-Fi Girişi" sub="Misafirler otelin internetine kimlik numarası ve oda numarasıyla girer" />

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-head"><h3><Wifi size={16} /> Durum ve giriş kuralı</h3></div><div className="card-body stack">
          <div className="row" style={{ gap: 8 }}>
            {(() => {
              const listening = s.status.startsWith('Dinliyor'), starting = s.enabled && s.status === 'Kapalı';
              return <Badge color={!s.enabled ? 'gray' : listening ? 'green' : starting ? 'gray' : 'red'}>{!s.enabled ? 'Kapalı' : listening ? 'Açık' : starting ? 'Başlatılıyor' : 'Hata'}</Badge>;
            })()}
            <span className="muted" style={{ fontSize: 12.5 }}>{s.enabled ? s.status : 'Açmak için aşağıdaki kutuyu işaretleyip kaydedin.'}{s.enabled && s.lastRequestAt ? ` · son istek ${fmtDateTime(s.lastRequestAt)}` : ''}</span>
          </div>
          <label className="check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Misafir Wi-Fi girişini PMS ile doğrula</label>
          <div className="form-grid">
            <Field label="Kullanıcı adı" className="span-2"><input className="input" value="T.C. kimlik no (yabancılar: pasaport no)" disabled /></Field>
            <Field label="Şifre" className="span-2"><select className="input" value={mode} onChange={e => setMode(e.target.value as 'room' | 'last_name')}>
              <option value="room">Oda numarası</option><option value="last_name">Soyadı</option></select></Field>
            <Field label="Çıkıştan sonra ek süre (saat)" className="span-2" hint="İnternet, çıkış günü otelin çıkış saatine bu süre eklenene kadar açık kalır.">
              <input className="input num" value={grace} onChange={e => setGrace(e.target.value.replace(/\D/g, ''))} maxLength={2} /></Field>
            <Field label="Ek misafirler" className="span-2"><label className="check" style={{ height: 32 }}><input type="checkbox" checked={sharers} onChange={e => setSharers(e.target.checked)} /> Odadaki ek misafirler de kendi kimlik numarasıyla girebilir</label></Field>
            <Field label="İzin verilen hotspot cihazları (IP)" className="span-4" hint="Her satıra bir IP. Boş bırakılırsa yerel ağdaki cihazlar ortak anahtarla sorabilir; cihazın IP'sini yazmanız önerilir.">
              <textarea className="input mono" rows={2} value={clients} onChange={e => setClients(e.target.value)} placeholder="192.168.1.1" /></Field>
          </div>
          <ErrorBox error={save.error} />
          <div><button className="btn primary" disabled={save.busy || grace === ''} onClick={() => void save.run()}><Save /> Kaydet</button></div>
        </div></div>

        <div className="card"><div className="card-head"><h3><ShieldCheck size={16} /> Hotspot cihazına girilecek bilgiler</h3></div><div className="card-body stack">
          {!s.sharedSecret ? <Empty title="Önce girişi açıp kaydedin" text="Ortak anahtar ilk kayıtta oluşturulur." /> : <>
            <table className="dt"><tbody>
              <tr><td>RADIUS sunucusu (PMS sunucu IP)</td><td className="mono">{s.addresses.join(', ') || '—'}</td></tr>
              <tr><td>Doğrulama portu (authentication)</td><td className="mono">{s.authPort}</td></tr>
              <tr><td>Oturum kaydı portu (accounting)</td><td className="mono">{s.acctPort}</td></tr>
              <tr><td>Ortak anahtar (shared secret)</td><td className="mono">
                {showSecret ? s.sharedSecret : '••••••••••••••••'}{' '}
                <button className="btn sm ghost" onClick={() => setShowSecret(v => !v)} aria-label="Göster/gizle">{showSecret ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button className="btn sm ghost" onClick={() => void copy(s.sharedSecret!)} aria-label="Kopyala"><Copy size={14} /></button></td></tr>
              <tr><td>Kimlik doğrulama yöntemi</td><td>PAP veya CHAP</td></tr>
            </tbody></table>
            <div className="info-box" style={{ fontSize: 12.5 }}>
              Cihazın hotspot (captive portal) ayarında <b>RADIUS ile doğrulama</b> ve <b>RADIUS oturum kaydını (accounting)</b> açın, ara güncellemeyi 5–15 dakika yapın.
              Örnek (MikroTik RouterOS; profil adı cihazınızdakiyle aynı olmalı):
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{`/radius add service=hotspot address=${server} secret=${showSecret ? s.sharedSecret : '<ortak anahtar>'} authentication-port=${s.authPort} accounting-port=${s.acctPort}
/ip hotspot profile set [find] use-radius=yes radius-accounting=yes radius-interim-update=10m`}</pre>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>Sunucu bilgisayarının Windows güvenlik duvarında UDP {s.authPort} ve {s.acctPort} kurulumda yalnız özel/etki alanı ağı için açılır.</div>
            <div><button className="btn sm" disabled={rotate.busy} onClick={async () => { if (await confirm({ title: 'Ortak anahtarı yenile', message: 'Yeni anahtar hotspot cihazına da girilene kadar misafirler internete giremez.', confirmText: 'Yenile', danger: true })) void rotate.run(); }}><KeyRound /> Anahtarı yenile</button></div>
          </>}
        </div></div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-head"><h3>Misafire söylenecek</h3></div><div className="card-body">
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>Wi-Fi'ye bağlanınca açılan giriş sayfasında<br />
            <b>Kullanıcı adı:</b> T.C. kimlik numaranız (yabancı misafirler: pasaport numarası)<br />
            <b>Şifre:</b> {passLabel}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Yalnız giriş yapılmış (konaklayan) misafirler bağlanabilir; kimlik numarası misafir kartına doğru girilmiş olmalıdır.</div>
        </div></div>
        <div className="card"><div className="card-head"><h3>Misafir bilgilerini dene</h3></div><div className="card-body stack">
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

      <div className="card" style={{ marginBottom: 14 }}><div className="card-head"><h3>Açık oturumlar ({s.activeSessions.length})</h3></div><div className="card-body">
        {s.activeSessions.length === 0 ? <Empty title="Açık oturum yok" text="Hotspot cihazı oturum kaydı (accounting) gönderdiğinde burada görünür." /> : (
          <div className="table-wrap" style={{ maxHeight: 320 }}><table className="dt">
            <thead><tr><th>Başlangıç</th><th>Oda</th><th>Misafir</th><th>Cihaz (MAC)</th><th>İç IP</th><th style={{ textAlign: 'right' }}>İndirilen</th><th>Son güncelleme</th></tr></thead>
            <tbody>{s.activeSessions.map((x, i) => <tr key={i}><td>{fmtDateTime(x.startedAt)}</td><td>{x.roomNumber}</td><td>{x.guestName}</td><td className="mono">{x.mac}</td><td className="mono">{x.framedIp}</td><td className="num">{mb(x.outputBytes)}</td><td className="muted">{fmtDateTime(x.updatedAt)}</td></tr>)}</tbody>
          </table></div>)}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Geçmiş oturumlar: Raporlar → Sistem → Wi-Fi Oturumları.</div>
      </div></div>

      <div className="card"><div className="card-head"><h3>Son giriş denemeleri</h3></div><div className="card-body">
        {s.attempts.length === 0 ? <Empty title="Henüz deneme yok" /> : (
          <div className="table-wrap" style={{ maxHeight: 320 }}><table className="dt">
            <thead><tr><th>Zaman</th><th>Sonuç</th><th>Kullanıcı adı</th><th>Misafir / oda</th><th>Cihaz (MAC)</th><th>Hotspot</th></tr></thead>
            <tbody>{s.attempts.map((a, i) => <tr key={i}><td>{fmtDateTime(a.at)}</td><td>{a.accepted ? <Badge color="green">Kabul</Badge> : <Badge color="red">{REASON[a.reason] ?? a.reason}</Badge>}</td>
              <td className="mono">{a.usernameMasked}</td><td>{a.guestName ? `${a.guestName} · ${a.roomNumber ?? ''}` : ''}</td><td className="mono">{a.mac}</td><td className="mono">{a.nasIp}</td></tr>)}</tbody>
          </table></div>)}
      </div></div>
    </div>
  );
}
