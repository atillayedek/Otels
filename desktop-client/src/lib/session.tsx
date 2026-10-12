import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { api, onApiError, ApiError } from './api';
import type { ClientInfo, Me, Property } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, e) => !(e instanceof ApiError) || (e.isNetwork && count < 2),
    },
  },
});

/** Sunucudan gelen değişiklik konusu → yeniden yüklenecek sorgu grupları. Polling yoktur; yalnız WebSocket bildirimi. */
const TOPIC_KEYS: Record<string, string[]> = {
  rooms: ['rooms', 'roomStatus', 'rack', 'dashboard', 'hk'],
  reservations: ['reservations', 'reservation', 'rack', 'dashboard', 'roomStatus', 'guest'],
  availability: ['availability', 'rack', 'dashboard'],
  folios: ['folio', 'folios', 'reservation', 'reservations', 'dashboard', 'accounts', 'guest'],
  cashier: ['cashier', 'dashboard'],
  guests: ['guests', 'guest'],
  companies: ['accounts'],
  agencies: ['accounts'],
  housekeeping: ['hk', 'roomStatus', 'dashboard'],
  maintenance: ['tickets', 'blocks', 'roomStatus', 'dashboard'],
  business_date: ['property', 'dashboard', 'rack', 'reservations', 'nightAudit'],
  property: ['property'],
  settings: ['settings'],
  rates: ['ratePlans', 'ratePrices'],
  kbs: ['kbs', 'dashboard'],
  wakeups: ['wakeups', 'dashboard'],
  documents: ['documents'],
  imports: ['imports', 'import'],
};

interface SessionValue {
  client?: ClientInfo;
  me?: Me;
  property?: Property;
  connected: boolean;
  dbAvailable: boolean;
  outdated: boolean;
  can: (perm: string) => boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  reloadClient: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [client, setClient] = useState<ClientInfo>();
  const [me, setMe] = useState<Me>();
  const [property, setProperty] = useState<Property>();
  const [connected, setConnected] = useState(false);
  const [dbAvailable, setDbAvailable] = useState(true);
  const [outdated, setOutdated] = useState(false);

  const reloadClient = useCallback(async () => setClient(await invoke<ClientInfo>('client_info')), []);
  useEffect(() => { void reloadClient(); }, [reloadClient]);

  const loadProperty = useCallback(async () => {
    try { setProperty(await api<Property>('GET', '/api/v1/property')); } catch { /* yetki/bağlantı hatası üst katmanda gösterilir */ }
  }, []);

  useEffect(() => onApiError(e => {
    if (e.status === 401) { setMe(undefined); setConnected(false); }
    if (e.status === 426) setOutdated(true);
    if (e.status === 503 && e.code === 'db_unavailable') setDbAvailable(false);
    if (e.status === 403 && e.code === 'must_change_password') setMe(m => (m ? { ...m, mustChangePassword: true } : m));
  }), []);

  useEffect(() => {
    const unsubs = [
      listen<{ connected: boolean }>('pms-connection', ev => {
        setConnected(ev.payload.connected);
        if (ev.payload.connected) { setDbAvailable(true); void qc.invalidateQueries(); }
      }),
      listen<{ type: string; topic?: string }>('pms-realtime', ev => {
        const topic = ev.payload.topic;
        if (ev.payload.type !== 'change' || !topic) return;
        const keys = TOPIC_KEYS[topic] ?? [topic];
        void qc.invalidateQueries({ predicate: q => keys.includes(String(q.queryKey[0])) });
        if (topic === 'business_date' || topic === 'property') void loadProperty();
      }),
      listen('pms-session-revoked', () => { setMe(undefined); setConnected(false); }),
    ];
    return () => { unsubs.forEach(p => void p.then(u => u())); };
  }, [qc, loadProperty]);

  const afterLogin = useCallback(async (user: Me) => {
    setMe(user);
    if (!user.mustChangePassword) {
      await loadProperty();
      await invoke('realtime_start');
    }
  }, [loadProperty]);

  const login = useCallback(async (username: string, password: string) => {
    const info = await invoke<ClientInfo>('client_info');
    const user = await api<Me>('POST', '/api/v1/auth/login', {
      username, password, deviceId: info.deviceId, deviceName: info.hostname, deviceKind: 'client', clientVersion: info.version,
    });
    await afterLogin(user);
    return user;
  }, [afterLogin]);

  const logout = useCallback(async () => {
    try { await api('POST', '/api/v1/auth/logout'); } catch { /* oturum zaten kapalı olabilir */ }
    await invoke('realtime_stop');
    qc.clear();
    setMe(undefined);
    setProperty(undefined);
    setConnected(false);
  }, [qc]);

  const refreshMe = useCallback(async () => { await afterLogin(await api<Me>('GET', '/api/v1/auth/me')); }, [afterLogin]);

  const value = useMemo<SessionValue>(() => ({
    client, me, property, connected, dbAvailable, outdated,
    can: (p: string) => !!me?.permissions.includes(p),
    login, logout, refreshMe, reloadClient,
  }), [client, me, property, connected, dbAvailable, outdated, login, logout, refreshMe, reloadClient]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider eksik');
  return v;
}
