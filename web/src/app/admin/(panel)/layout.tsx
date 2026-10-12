import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { currentAdmin } from '@/lib/supabase/server';
import { LogoMark } from '@/components/Logo';
import { SITE } from '@/lib/site';
import { signOut } from '../actions';

export const metadata: Metadata = { title: 'Yönetim paneli', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/giris');
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="container bar">
          <Link href="/admin" className="brand"><LogoMark size={28} /><span>{SITE.product}<small>Ön sipariş yönetimi</small></span></Link>
          <span style={{ marginLeft: 'auto', fontSize: 14, color: '#94a3b8' }}>{admin.email}</span>
          <form action={signOut}>
            <button className="btn sm ghost" style={{ color: '#e2e8f0' }}><LogOut /> Çıkış</button>
          </form>
        </div>
      </header>
      <main className="admin-main"><div className="container">{children}</div></main>
    </div>
  );
}
