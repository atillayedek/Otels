import { useQueryClient } from '@tanstack/react-query';
import { LogOut, RefreshCw } from 'lucide-react';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { Empty } from '../components/ui';
import { MobilePos } from '../components/MobilePos';

/** Ferrolit Restoran (garson tableti / telefonu): yalnız adisyon ekranı. Otelin PMS sunucusuna bağlanır, aynı yetkileri kullanır. */
export function RestaurantApp() {
  const { me, property, connected, can, logout } = useSession();
  const qc = useQueryClient();
  return (
    <div className="m-shell">
      <header className="m-top">
        <div><b>{property?.name} · Restoran</b><small>{me?.fullName} · İş günü {fmtDate(property?.businessDate)}</small></div>
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? 'Bağlı' : 'Bağlantı yok'} />
        <button className="btn ghost icon" aria-label="Yenile" onClick={() => void qc.invalidateQueries()}><RefreshCw /></button>
        <button className="btn ghost icon" aria-label="Çıkış" onClick={() => void logout()}><LogOut /></button>
      </header>
      {!connected && <div className="banner danger">Sunucu bağlantısı yok; yeniden bağlanılıyor…</div>}
      <main className="m-main">
        {can('pos.view') ? <MobilePos /> : <Empty title="Bu uygulama için yetkiniz yok" text="Ferrolit Restoran, restoran/bar yetkisi olan kullanıcılar içindir." />}
      </main>
    </div>
  );
}
