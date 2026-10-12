import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase ortam değişkenleri tanımlı değil (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).');
  return { url, key };
}

/** Oturum çerezlerini okuyan/yazan sunucu istemcisi. Yalnız publishable anahtar kullanılır; yetki RLS ile sınırlıdır. */
export async function supabaseServer() {
  const { url, key } = env();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Component içinden çağrıldığında çerez yazılamaz; oturum yenilemesini proxy yapar.
        }
      },
    },
  });
}

/** Oturumu olan ve admin_users tablosunda kayıtlı kullanıcıyı döndürür; değilse null. */
export async function currentAdmin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  return data ? { id: user.id, email: user.email ?? '' } : null;
}
