import { invoke } from '@tauri-apps/api/core';

/** Sunucunun döndürdüğü kullanıcıya gösterilebilir hata. Teknik ayrıntı yoktur; errorId sunucu logundaki kayıtla eşleşir. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errorId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() { return this.status === 0; }
}

interface RawResponse { status: number; body: unknown }

type Listener = (e: ApiError) => void;
const listeners = new Set<Listener>();
/** 401 / 426 / ağ hatası gibi genel durumları uygulama düzeyinde dinlemek için. */
export function onApiError(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }

function toError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { code?: string; message?: string; errorId?: string; details?: unknown };
  const message = b.message ?? (status === 0 ? 'Sunucuya bağlanılamadı.' : `İşlem tamamlanamadı (${status}).`);
  return new ApiError(status, b.code ?? 'error', message, b.errorId, b.details);
}

/** Yeni bir işlem anahtarı. Aynı form gönderimi tekrarlandığında (çift tıklama, yeniden deneme) aynı anahtar kullanılmalıdır. */
export const newKey = () => crypto.randomUUID();

export interface CallOptions { key?: string }

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, opts: CallOptions = {}): Promise<T> {
  let res: RawResponse;
  try {
    res = await invoke<RawResponse>('api_request', { method, path, body: body ?? null, idempotencyKey: opts.key ?? null });
  } catch (e) {
    const err = new ApiError(0, 'network', typeof e === 'string' ? e : 'Sunucuya bağlanılamadı.');
    listeners.forEach(l => l(err));
    throw err;
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const err = toError(res.status, res.body);
  listeners.forEach(l => l(err));
  throw err;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T = { id: string }>(path: string, body?: unknown, key?: string) => api<T>('POST', path, body, { key });
export const put = <T = { id: string }>(path: string, body?: unknown, key?: string) => api<T>('PUT', path, body, { key });
export const del = <T = { id: string }>(path: string) => api<T>('DELETE', path);

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function upload<T>(path: string, filePath: string, fields: Record<string, string>): Promise<T> {
  let res: RawResponse;
  try {
    res = await invoke<RawResponse>('api_upload', { path, filePath, fields });
  } catch (e) {
    throw new ApiError(0, 'network', typeof e === 'string' ? e : 'Dosya gönderilemedi.');
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  throw toError(res.status, res.body);
}

export async function download(path: string, savePath: string): Promise<string> {
  let res: RawResponse;
  try {
    res = await invoke<RawResponse>('api_download', { path, savePath });
  } catch (e) {
    throw new ApiError(0, 'network', typeof e === 'string' ? e : 'Dosya indirilemedi.');
  }
  if (res.status === 200) return res.body as string;
  throw toError(res.status, res.body);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.errorId && e.status >= 500 ? `${e.message} Hata kodu: ${e.errorId}` : e.message;
  return 'Beklenmeyen bir hata oluştu.';
}
