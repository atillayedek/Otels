'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NAV, SITE } from '@/lib/site';
import { LogoMark } from './Logo';

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <a className="skip" href="#icerik">İçeriğe geç</a>
      <div className="container bar">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <LogoMark />
          <span>{SITE.product}<small>{SITE.studio}</small></span>
        </Link>
        <button className="btn ghost sm menu-btn" aria-label={open ? 'Menüyü kapat' : 'Menüyü aç'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? <X /> : <Menu />}
        </button>
        <nav className={`site-nav ${open ? 'open' : ''}`} aria-label="Ana menü">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className={path === n.href ? 'active' : ''} onClick={() => setOpen(false)}>{n.label}</Link>
          ))}
          <Link href="/on-siparis" className="btn primary sm" style={{ color: '#fff', marginLeft: 6 }} onClick={() => setOpen(false)}>Ön sipariş ver</Link>
        </nav>
      </div>
    </header>
  );
}
