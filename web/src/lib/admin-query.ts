import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STATUS_LABELS } from './site';

export const PAGE_SIZE = 25;

export interface PreOrderRow {
  id: string;
  reference: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  hotel_name: string;
  city: string;
  phone: string;
  email: string;
  room_count: number | null;
  client_count: number | null;
  current_software: string;
  current_software_other: string | null;
  server_os: string;
  needs_migration: boolean;
  message: string | null;
  kvkk_accepted_at: string;
  status: string;
}

export const ROW_COLUMNS =
  'id, reference, created_at, updated_at, full_name, hotel_name, city, phone, email, room_count, client_count, current_software, current_software_other, server_os, needs_migration, message, kvkk_accepted_at, status';

export interface ListFilter { status?: string; q?: string }

export function parseFilter(sp: Record<string, string | string[] | undefined>): ListFilter & { page: number } {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? '';
  const status = one('durum');
  const page = Math.max(1, Math.min(10000, Number.parseInt(one('sayfa'), 10) || 1));
  return { status: status in STATUS_LABELS ? status : undefined, q: one('ara').trim().slice(0, 80) || undefined, page };
}

/** PostgREST "or" filtresinde özel anlamı olan karakterler aramadan çıkarılır. */
function safeTerm(q: string) {
  return q.replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFilter<T extends { eq: any; or: any }>(query: T, f: ListFilter): T {
  let q = query;
  if (f.status) q = q.eq('status', f.status);
  const term = f.q ? safeTerm(f.q) : '';
  if (term) {
    const p = `%${term}%`;
    q = q.or(['reference', 'hotel_name', 'full_name', 'email', 'phone', 'city'].map(c => `${c}.ilike.${p}`).join(','));
  }
  return q;
}

export async function statusCounts(sb: SupabaseClient) {
  const entries = await Promise.all(
    Object.keys(STATUS_LABELS).map(async s => {
      const { count } = await sb.from('pre_orders').select('id', { count: 'exact', head: true }).eq('status', s);
      return [s, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, number>;
}
