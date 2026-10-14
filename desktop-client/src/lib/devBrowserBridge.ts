/**
 * YALNIZ GELİŞTİRME: Arayüzü Tauri kabuğu olmadan, Vite geliştirme sunucusunda tarayıcıda çalıştırmak için köprü.
 * Tauri komutlarını (api_request vb.) yakalar ve Vite proxy'si (/__pms → yerel test sunucusu) üzerinden iletir.
 * Üretim derlemesine girmez: main.tsx bu dosyayı yalnız import.meta.env.DEV iken ve Tauri yokken yükler.
 */
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';

const deviceId = (() => {
  const k = 'pms-dev-device-id';
  let v = sessionStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); sessionStorage.setItem(k, v); }
  return v;
})();
let token: string | null = sessionStorage.getItem('pms-dev-token');

const server = { id: 'dev', name: 'Test sunucusu', host: '127.0.0.1', port: 18443, ca_pem: '', ca_fingerprint: 'dev', added_at: new Date().toISOString() };

async function call(method: string, path: string, body: unknown, key: string | null) {
  const headers: Record<string, string> = { 'X-PMS-Device-Id': deviceId, 'X-PMS-Hostname': 'TARAYICI-DEV', 'X-PMS-Client-Version': '1.0.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  if (body !== null && body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/__pms' + path, { method, headers, body: body === null || body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  // Tauri katmanıyla (net.rs api_request) aynı: token saklanır, arayüze yalnız kullanıcı bilgisi döner.
  if (path === '/api/v1/auth/login' && res.status === 200 && json && typeof json === 'object') {
    const j = json as { token?: string; user?: unknown };
    token = j.token ?? null;
    if (token) sessionStorage.setItem('pms-dev-token', token);
    json = j.user ?? null;
  }
  if (path.startsWith('/api/v1/auth/logout') || res.status === 401) { token = null; sessionStorage.removeItem('pms-dev-token'); }
  return { status: res.status, body: json };
}

mockIPC(async (cmd, args) => {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (cmd) {
    case 'api_request': return call(String(a.method), String(a.path), a.body ?? null, (a.idempotencyKey as string | null) ?? null);
    case 'client_info': return { device_id: deviceId, hostname: 'TARAYICI-DEV', version: '1.0.0', active_server: server, deviceId, activeServer: server };
    case 'list_servers': return [[server], server.id];
    case 'realtime_start': setTimeout(() => void emit('pms-connection', { connected: true }), 50); return null;
    case 'realtime_stop': case 'set_active_server': case 'remove_server': return null;
    case 'save_server': return server;
    case 'discover_servers': return [];
    case 'probe_server': case 'test_connection': return { ok: true };
    default:
      if (cmd.startsWith('plugin:')) return null;
      throw `Geliştirme köprüsünde desteklenmeyen komut: ${cmd}`;
  }
}, { shouldMockEvents: true });
console.info('[dev] Tarayıcı köprüsü etkin: API çağrıları /__pms üzerinden test sunucusuna gidiyor.');
