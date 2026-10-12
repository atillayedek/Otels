import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Yönetim paneli için Supabase oturum çerezlerini yeniler ve oturumsuz istekleri giriş sayfasına yönlendirir. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await sb.auth.getUser();
  const isLogin = request.nextUrl.pathname === '/admin/giris';
  if (!user && !isLogin) {
    const to = request.nextUrl.clone();
    to.pathname = '/admin/giris';
    to.search = '';
    return NextResponse.redirect(to);
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = { matcher: ['/admin/:path*'] };
