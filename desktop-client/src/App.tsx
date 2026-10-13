import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useSession } from './lib/session';
import { api, ApiError } from './lib/api';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { FirstConnectPage, ConnectionSettingsPage } from './pages/Connection';
import { ForcedPasswordPage, LoginPage, SetupWizard } from './pages/Auth';
import { MobileApp } from './pages/Mobile';

/** Android/iOS: telefon arayüzü (kat hizmetleri). Masaüstü menüsü telefonda kullanılmaz. */
const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);

const Dashboard = lazy(() => import('./pages/Dashboard'));
const RackPage = lazy(() => import('./pages/Rack'));
const BlokajPage = lazy(() => import('./pages/Blokaj'));
const ReservationList = lazy(() => import('./pages/Reservations'));
const ReservationNew = lazy(() => import('./pages/ReservationForm').then(m => ({ default: m.ReservationNewPage })));
const WalkInPage = lazy(() => import('./pages/ReservationForm').then(m => ({ default: m.WalkInPage })));
const ReservationDetail = lazy(() => import('./pages/ReservationDetail'));
const Groups = lazy(() => import('./pages/Groups'));
const Availability = lazy(() => import('./pages/Availability'));
const Guests = lazy(() => import('./pages/Guests'));
const GuestDetail = lazy(() => import('./pages/GuestDetail'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Cashier = lazy(() => import('./pages/Cashier'));
const ExchangeRates = lazy(() => import('./pages/ExchangeRates'));
const Stock = lazy(() => import('./pages/Stock'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const Pos = lazy(() => import('./pages/Pos'));
const SetPos = lazy(() => import('./pages/settings/PosSettings'));
const Allotments = lazy(() => import('./pages/Allotments'));
const Housekeeping = lazy(() => import('./pages/Housekeeping'));
const HkTasks = lazy(() => import('./pages/HkTasks'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const RoomBlocks = lazy(() => import('./pages/RoomBlocks'));
const NightAudit = lazy(() => import('./pages/NightAudit'));
const Reports = lazy(() => import('./pages/Reports'));
const Kbs = lazy(() => import('./pages/Kbs'));
const Wakeups = lazy(() => import('./pages/Wakeups'));
const AccountPage = lazy(() => import('./pages/Account'));
const SetProperty = lazy(() => import('./pages/settings/Property'));
const SetRooms = lazy(() => import('./pages/settings/Rooms'));
const SetRates = lazy(() => import('./pages/settings/Rates'));
const SetFinance = lazy(() => import('./pages/settings/Finance'));
const SetUsers = lazy(() => import('./pages/settings/Users'));
const SetDevices = lazy(() => import('./pages/settings/Devices'));
const SetBackup = lazy(() => import('./pages/settings/Backup'));
const SetPrinters = lazy(() => import('./pages/settings/Printers'));
const SetIntegrations = lazy(() => import('./pages/settings/Integrations'));
const SetImport = lazy(() => import('./pages/settings/Import'));
const SetAudit = lazy(() => import('./pages/settings/Audit'));

type Stage = 'loading' | 'no-server' | 'unreachable' | 'setup' | 'ready';

export function App() {
  const { client, me, outdated, reloadClient } = useSession();
  const [stage, setStage] = useState<Stage>('loading');
  const [message, setMessage] = useState('');
  const [showConn, setShowConn] = useState(false);

  const probe = useCallback(async () => {
    if (!client) return;
    if (!client.activeServer) { setStage('no-server'); return; }
    setStage('loading');
    try {
      const s = await api<{ setupRequired: boolean }>('GET', '/api/v1/setup/status');
      setStage(s.setupRequired ? 'setup' : 'ready');
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Sunucuya bağlanılamadı.');
      setStage('unreachable');
    }
  }, [client]);
  useEffect(() => { void probe(); }, [probe]);

  if (!client || stage === 'loading') return <div className="auth-wrap"><div className="auth-panel" style={{ gridColumn: '1 / -1' }}><Spinner label="Sunucuya bağlanılıyor…" /></div></div>;
  if (stage === 'no-server') return <FirstConnectPage onConnected={() => void reloadClient()} />;
  if (showConn) {
    return (
      <div style={{ height: '100vh', overflow: 'auto', background: 'var(--bg)' }}>
        <div style={{ padding: 16 }}><button className="btn" onClick={() => { setShowConn(false); void probe(); }}>← Geri</button></div>
        <ConnectionSettingsPage />
      </div>
    );
  }
  if (outdated) {
    return (
      <div className="auth-wrap"><div className="auth-panel" style={{ gridColumn: '1 / -1' }}><div className="auth-box stack">
        <h2>İstemci güncellemesi gerekli</h2>
        <p>Bu bilgisayardaki PMS Client sürümü ({client.version}) sunucuyla uyumlu değil. Sunucu bilgisayarındaki kurulum klasöründen veya sistem yöneticinizden güncel PMS Client kurulum dosyasını alın.</p>
      </div></div></div>
    );
  }
  if (stage === 'unreachable') {
    return (
      <div className="auth-wrap"><div className="auth-panel" style={{ gridColumn: '1 / -1' }}><div className="auth-box stack">
        <h2>Sunucuya ulaşılamıyor</h2>
        <p className="muted" style={{ margin: 0 }}>{client.activeServer?.name} ({client.activeServer?.host}:{client.activeServer?.port})</p>
        <div className="error-box">{message}</div>
        <p style={{ margin: 0 }}>Sunucu bilgisayarının açık olduğundan ve bu bilgisayarla aynı ağda bulunduğundan emin olun.</p>
        <div className="row">
          <button className="btn primary" onClick={() => void probe()}><RefreshCw /> Yeniden dene</button>
          <button className="btn" onClick={() => setShowConn(true)}><Settings2 /> Sunucu bağlantısı ayarları</button>
        </div>
      </div></div></div>
    );
  }
  if (stage === 'setup') return <SetupWizard onDone={() => void probe()} />;
  if (!me) return <LoginPage onSettings={() => setShowConn(true)} />;
  if (me.mustChangePassword) return <ForcedPasswordPage />;
  if (IS_MOBILE) return <MobileApp />;

  return (
    <Layout>
      <Suspense fallback={<div className="empty"><Loader2 className="spin" /></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rack" element={<RackPage />} />
          <Route path="/blokaj" element={<BlokajPage />} />
          <Route path="/reservations" element={<ReservationList />} />
          <Route path="/reservations/new" element={<ReservationNew />} />
          <Route path="/reservations/:id" element={<ReservationDetail />} />
          <Route path="/walk-in" element={<WalkInPage />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<Groups />} />
          <Route path="/guests" element={<Guests />} />
          <Route path="/guests/:id" element={<GuestDetail />} />
          <Route path="/companies" element={<Accounts kind="companies" />} />
          <Route path="/agencies" element={<Accounts kind="agencies" />} />
          <Route path="/cashier" element={<Cashier />} />
          <Route path="/exchange-rates" element={<ExchangeRates />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/settings/pos" element={<SetPos />} />
          <Route path="/allotments" element={<Allotments />} />
          <Route path="/housekeeping" element={<Housekeeping />} />
          <Route path="/housekeeping/tasks" element={<HkTasks />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/maintenance/blocks" element={<RoomBlocks />} />
          <Route path="/night-audit" element={<NightAudit />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:name" element={<Reports />} />
          <Route path="/kbs" element={<Kbs />} />
          <Route path="/wakeups" element={<Wakeups />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings/property" element={<SetProperty />} />
          <Route path="/settings/rooms" element={<SetRooms />} />
          <Route path="/settings/rates" element={<SetRates />} />
          <Route path="/settings/finance" element={<SetFinance />} />
          <Route path="/settings/users" element={<SetUsers />} />
          <Route path="/settings/devices" element={<SetDevices />} />
          <Route path="/settings/backup" element={<SetBackup />} />
          <Route path="/settings/printers" element={<SetPrinters />} />
          <Route path="/settings/integrations" element={<SetIntegrations />} />
          <Route path="/settings/import" element={<SetImport />} />
          <Route path="/settings/audit" element={<SetAudit />} />
          <Route path="/settings/connection" element={<ConnectionSettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
