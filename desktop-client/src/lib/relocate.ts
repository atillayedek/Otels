import { invoke } from '@tauri-apps/api/core';
import type { DiscoveredServer, ServerEntry } from './types';

/**
 * Sunucuya ulaşılamıyorsa ağda aynı sunucuyu arar: aynı sertifika (CA) parmak izine sahip sunucu başka bir adresten yanıt verirse
 * (modem sunucuya yeni IP vermiş olabilir) kayıtlı adres güncellenir. Parmak izi aynı olmadıkça hiçbir adres kabul edilmez;
 * böylece ağdaki başka bir cihaz kendini sunucu gibi gösteremez. Adres değiştiyse true döner.
 */
export async function relocateServer(active: ServerEntry): Promise<boolean> {
  let found: DiscoveredServer[];
  try { found = await invoke<DiscoveredServer[]>('discover_servers'); } catch { return false; }
  const fp = active.caFingerprint.toUpperCase();
  const match = found.find(d => (d.caFingerprint ?? '').toUpperCase() === fp);
  if (!match) return false;
  const host = match.replyFrom || match.addresses[0];
  if (!host || (host === active.host && match.httpsPort === active.port)) return false;
  await invoke('save_server', { entry: { ...active, host, port: match.httpsPort }, makeActive: true });
  return true;
}
