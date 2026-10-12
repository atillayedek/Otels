'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { preOrderSchema, readForm, type PreOrderState } from '@/lib/preorder';

const GENERIC = 'Talebiniz şu anda kaydedilemedi. Lütfen biraz sonra tekrar deneyin.';

export async function submitPreOrder(_prev: PreOrderState, fd: FormData): Promise<PreOrderState> {
  const values = readForm(fd);

  // Bot tuzağı: görünmeyen alan doldurulmuşsa ya da form çok hızlı gönderilmişse kayıt yapılmaz.
  const startedAt = Number(fd.get('started_at') ?? 0);
  if (String(fd.get('website') ?? '') !== '' || !startedAt || Date.now() - startedAt < 2500) {
    return { status: 'error', message: 'Form doğrulanamadı. Sayfayı yenileyip tekrar deneyin.', values };
  }

  const parsed = preOrderSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? 'form');
      errors[k] ??= issue.message;
    }
    return { status: 'invalid', errors, values };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const salt = process.env.CLIENT_KEY_SALT;
  if (!url || !key || !salt || salt.length < 32) {
    console.error('pre_order: sunucu yapılandırması eksik');
    return { status: 'error', message: `${GENERIC} Hata kodu: W501`, values };
  }

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  const clientKeyHash = createHash('sha256').update(`${salt}:${ip}`).digest('hex');

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc('submit_pre_order', { p: parsed.data, p_client_key_hash: clientKeyHash });

  if (error) {
    if (error.message.includes('rate_limited')) {
      return { status: 'error', message: 'Kısa süre içinde çok sayıda talep gönderildi. Lütfen daha sonra tekrar deneyin.', values };
    }
    if (error.code === '23514' || error.code === '22023' || error.code === '22P02') {
      return { status: 'error', message: 'Bazı bilgiler geçersiz. Lütfen alanları kontrol edin. Hata kodu: W422', values };
    }
    console.error('pre_order: kayıt hatası', error.code);
    return { status: 'error', message: `${GENERIC} Hata kodu: W500`, values };
  }

  return { status: 'ok', reference: String(data) };
}
