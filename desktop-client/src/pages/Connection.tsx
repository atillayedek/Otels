import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, Loader2, Plug, Radar, Server, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Badge, Empty, ErrorBox, Field, useConfirm, useToast } from '../components/ui';
import type { DiscoveredServer, ProbeResult, ServerEntry, TestResult } from '../lib/types';
import { useSession } from '../lib/session';

function groupFp(fp: string) { return fp.match(/.{1,4}/g)?.join(' ') ?? fp; }

/**
 * Sunucu bağlantısı: LAN'da otomatik bulma, ad/IP + port ile ekleme, sertifika parmak izi onayı ve bağlantı testi.
 * İlk açılışta (kayıtlı sunucu yoksa) tam ekran, sonrasında Yönetim → Sunucu Bağlantısı'nda kullanılır.
 */
export function ConnectionPanel({ onConnected }: { onConnected?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { reloadClient } = useSession();
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [found, setFound] = useState<DiscoveredServer[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [tests, setTests] = useState<Record<string, TestResult | 'running'>>({});

  const reload = async () => {
    const [list, active] = await invoke<[ServerEntry[], string | null]>('list_servers');
    setServers(list);
    setActiveId(active);
  };
  useEffect(() => { void reload(); }, []);

  const scan = async () => {
    setScanning(true);
    setFound(null);
    try { setFound(await invoke<DiscoveredServer[]>('discover_servers')); }
    catch (e) { toast.error(String(e)); }
    finally { setScanning(false); }
  };
  useEffect(() => { void scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doProbe = async (h: string, p: number, suggestedName?: string) => {
    setError(null);
    setProbe(null);
    setProbing(true);
    try {
      const r = await invoke<ProbeResult>('probe_server', { host: h, port: p });
      setProbe(r);
      setHost(h);
      setPort(String(p));
      setName(suggestedName ?? r.info.hotelName ?? r.info.serverName);
    } catch (e) { setError(typeof e === 'string' ? new Error(e) : e); }
    finally { setProbing(false); }
  };

  const entryFromProbe = (): ServerEntry => ({
    id: '', name: name.trim() || host, host: host.trim(), port: Number(port), caPem: probe!.caPem, caFingerprint: probe!.caFingerprint, addedAt: new Date().toISOString(),
  });

  const test = async (entry: ServerEntry) => {
    const key = entry.id || 'new';
    setTests(t => ({ ...t, [key]: 'running' }));
    try { const r = await invoke<TestResult>('test_connection', { entry }); setTests(t => ({ ...t, [key]: r })); return r; }
    catch (e) { const r: TestResult = { ok: false, message: String(e), latencyMs: 0, compatible: false, databaseReady: false, setupRequired: false }; setTests(t => ({ ...t, [key]: r })); return r; }
  };

  const save = async () => {
    const entry = entryFromProbe();
    const r = await test(entry);
    if (!r.ok && !r.setupRequired) return;
    const saved = await invoke<ServerEntry>('save_server', { entry, makeActive: true });
    toast.ok(`"${saved.name}" sunucusu kaydedildi ve etkinleştirildi.`);
    setProbe(null);
    setHost('');
    await reload();
    await reloadClient();
    onConnected?.();
  };

  const activate = async (s: ServerEntry) => {
    await invoke('set_active_server', { id: s.id });
    await reload();
    await reloadClient();
    toast.ok(`Etkin sunucu: ${s.name}`);
    onConnected?.();
  };

  const remove = async (s: ServerEntry) => {
    if (!await confirm({ title: 'Sunucu bağlantısını kaldır', message: `"${s.name}" bağlantısı bu bilgisayardan kaldırılacak. Sunucudaki verilere dokunulmaz.`, danger: true, confirmText: 'Kaldır' })) return;
    await invoke('remove_server', { id: s.id });
    await reload();
    await reloadClient();
  };

  const TestView = ({ k }: { k: string }) => {
    const t = tests[k];
    if (!t) return null;
    if (t === 'running') return <div className="info-box row"><Loader2 size={14} className="spin" /> Bağlantı test ediliyor…</div>;
    return (
      <div className={t.ok ? 'ok-box' : t.setupRequired && t.databaseReady ? 'info-box' : 'error-box'}>
        <div className="row">{t.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<b>{t.ok ? 'Bağlantı başarılı' : t.setupRequired && t.databaseReady ? 'Sunucuya ulaşıldı — ilk kurulum bekliyor' : 'Bağlantı kurulamadı'}</b></div>
        <div style={{ marginTop: 4 }}>{t.message}</div>
        {t.serverVersion && <div className="muted" style={{ marginTop: 2 }}>Sunucu sürümü {t.serverVersion} · Veritabanı {t.databaseReady ? 'hazır' : 'kullanılamıyor'} · Yanıt {t.latencyMs} ms{t.hotelName ? ` · ${t.hotelName}` : ''}</div>}
      </div>
    );
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-head"><Server size={16} /><h3>Kayıtlı sunucular</h3></div>
        <div className="card-body stack">
          {servers.length === 0 && <Empty title="Henüz sunucu bağlantısı yok" text="Aşağıdan ağdaki sunucuyu seçin veya adres girin." />}
          {servers.map(s => (
            <div key={s.id} className="stack" style={{ gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <div className="row wrap">
                <b>{s.name}</b><span className="muted mono">{s.host}:{s.port}</span>
                {s.id === activeId && <Badge color="green">Etkin</Badge>}
                <span className="spacer" />
                <button className="btn sm" onClick={() => void test(s)}><Plug /> Bağlantıyı test et</button>
                {s.id !== activeId && <button className="btn sm primary" onClick={() => void activate(s)}>Bu sunucuyu kullan</button>}
                <button className="btn sm ghost icon" title="Kaldır" onClick={() => void remove(s)}><Trash2 /></button>
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}><ShieldCheck size={12} /> Sertifika parmak izi: <span className="mono">{groupFp(s.caFingerprint)}</span></div>
              <TestView k={s.id} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Radar size={16} /><h3>Ağdaki sunucular</h3><div className="right"><button className="btn sm" onClick={() => void scan()} disabled={scanning}>{scanning ? <Loader2 className="spin" /> : <Radar />} Yeniden tara</button></div></div>
        <div className="card-body stack">
          {scanning && <div className="muted row"><Loader2 size={14} className="spin" /> Yerel ağ taranıyor…</div>}
          {found && found.length === 0 && <div className="muted">Ağda yanıt veren PMS sunucusu bulunamadı. Sunucu açık değilse veya güvenlik duvarı yayınları engelliyorsa adresi aşağıya elle girin.</div>}
          {found?.map(f => (
            <div key={f.hostname} className="row wrap">
              <b>{f.name}</b><span className="muted">{f.hostname} · {[f.replyFrom, ...f.addresses.filter(a => a !== f.replyFrom)].join(', ')} · port {f.httpsPort} · sürüm {f.version}</span>
              <span className="spacer" />
              <button className="btn sm primary" disabled={probing} onClick={() => void doProbe(f.replyFrom === '127.0.0.1' ? '127.0.0.1' : f.replyFrom, f.httpsPort, f.name)}>Seç</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Plug size={16} /><h3>Adres ile bağlan</h3></div>
        <div className="card-body stack">
          <div className="form-grid">
            <Field label="Sunucu adı veya IP adresi" required className="span-2" hint="Örnek: HOTEL-SERVER veya 192.168.1.20">
              <input className="input" value={host} onChange={e => { setHost(e.target.value); setProbe(null); }} placeholder="192.168.1.20" />
            </Field>
            <Field label="Port" required hint="Sunucu Yöneticisi ekranında yazar (varsayılan 443)">
              <input className="input" value={port} onChange={e => { setPort(e.target.value.replace(/\D/g, '')); setProbe(null); }} />
            </Field>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={!host.trim() || !port || probing} onClick={() => void doProbe(host.trim(), Number(port))}>
                {probing ? <Loader2 className="spin" /> : <Plug />} Sunucuyu bul
              </button>
            </div>
          </div>
          <ErrorBox error={error} />
          {probe && (
            <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="row wrap"><b>{probe.info.hotelName ?? 'Kurulumu tamamlanmamış sunucu'}</b><span className="muted">{probe.info.serverName} · sürüm {probe.info.version}</span></div>
              <div className={probe.fingerprintMatchesServer ? 'info-box' : 'error-box'}>
                <b>Güvenlik doğrulaması</b><br />
                Sunucu sertifika parmak izi: <span className="mono">{groupFp(probe.caFingerprint)}</span><br />
                {probe.fingerprintMatchesServer
                  ? 'Bu değeri sunucu bilgisayarındaki "PMS Server Manager" ekranındaki parmak iziyle karşılaştırın. Aynıysa kaydedin.'
                  : 'Uyarı: Sunucunun bildirdiği parmak izi ile alınan sertifika eşleşmiyor. Bağlantıyı kaydetmeyin; ağ yöneticinize başvurun.'}
              </div>
              <div className="form-grid">
                <Field label="Bağlantı adı" className="span-2"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
              </div>
              <TestView k="new" />
              <div className="row">
                <button className="btn" onClick={() => void test(entryFromProbe())}>Bağlantıyı test et</button>
                <button className="btn primary" disabled={!probe.fingerprintMatchesServer} onClick={() => void save()}><CheckCircle2 /> Parmak izi aynı, kaydet ve bağlan</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConnectionSettingsPage() {
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head"><h1>Sunucu Bağlantısı</h1><span className="sub">Bu bilgisayarın bağlandığı PMS sunucusu</span></div>
      <ConnectionPanel />
    </div>
  );
}

export function FirstConnectPage({ onConnected }: { onConnected: () => void }) {
  return (
    <div className="auth-wrap">
      <div className="auth-side">
        <div><img src="/logo.svg" width={48} alt="" /></div>
        <div>
          <h1>TSDMR Otel PMS</h1>
          <p>Bu bilgisayarı otelinizin PMS sunucusuna bağlayın. Sunucu aynı yerel ağdaysa otomatik bulunur; bulunamazsa sunucu adını veya IP adresini girin. İnternet bağlantısı gerekmez.</p>
        </div>
        <small style={{ color: '#bfdbfe' }}>TSDMR Digital Studio</small>
      </div>
      <div className="auth-panel" style={{ alignItems: 'flex-start', overflow: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <h2 style={{ marginBottom: 12 }}>Sunucuya bağlan</h2>
          <ConnectionPanel onConnected={onConnected} />
        </div>
      </div>
    </div>
  );
}
