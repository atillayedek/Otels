import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/supabase/server';
import { LogoMark } from '@/components/Logo';
import { SITE } from '@/lib/site';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Yönetim girişi', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await currentAdmin()) redirect('/admin');
  return (
    <div className="container">
      <div className="auth-card card elev">
        <div className="brand" style={{ marginBottom: 18 }}><LogoMark /><span>{SITE.product}<small>Yönetim paneli</small></span></div>
        <h1 style={{ fontSize: '1.5rem' }}>Giriş yap</h1>
        <LoginForm />
      </div>
    </div>
  );
}
