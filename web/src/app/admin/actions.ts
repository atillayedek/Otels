'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentAdmin, supabaseServer } from '@/lib/supabase/server';

export type FormMsg = { error?: string; ok?: string } | null;

export async function signIn(_prev: FormMsg, fd: FormData): Promise<FormMsg> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { error: 'E-posta ve parola girin.' };

  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429) return { error: 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' };
    return { error: 'E-posta veya parola hatalı.' };
  }
  if (!(await currentAdmin())) {
    await sb.auth.signOut();
    return { error: 'Bu hesabın yönetim paneline erişim yetkisi yok.' };
  }
  redirect('/admin');
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/admin/giris');
}

const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['yeni', 'iletisime_gecildi', 'teklif_verildi', 'kazanildi', 'iptal']),
});

export async function updateStatus(_prev: FormMsg, fd: FormData): Promise<FormMsg> {
  if (!(await currentAdmin())) return { error: 'Oturumunuz sona erdi. Yeniden giriş yapın.' };
  const parsed = statusSchema.safeParse({ id: fd.get('id'), status: fd.get('status') });
  if (!parsed.success) return { error: 'Geçersiz durum.' };
  const sb = await supabaseServer();
  const { data, error } = await sb.from('pre_orders').update({ status: parsed.data.status }).eq('id', parsed.data.id).select('id');
  if (error || !data?.length) return { error: 'Durum güncellenemedi. Hata kodu: A500' };
  revalidatePath(`/admin/${parsed.data.id}`);
  revalidatePath('/admin');
  return { ok: 'Durum güncellendi.' };
}

const noteSchema = z.object({
  id: z.uuid(),
  body: z.string().trim().min(1, 'Not boş olamaz.').max(4000, 'Not en fazla 4000 karakter olabilir.'),
});

export async function addNote(_prev: FormMsg, fd: FormData): Promise<FormMsg> {
  if (!(await currentAdmin())) return { error: 'Oturumunuz sona erdi. Yeniden giriş yapın.' };
  const parsed = noteSchema.safeParse({ id: fd.get('id'), body: fd.get('body') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Geçersiz not.' };
  const sb = await supabaseServer();
  const { error } = await sb.from('pre_order_notes').insert({ pre_order_id: parsed.data.id, body: parsed.data.body, author_email: '' });
  if (error) return { error: 'Not kaydedilemedi. Hata kodu: A501' };
  revalidatePath(`/admin/${parsed.data.id}`);
  return { ok: 'Not eklendi.' };
}
