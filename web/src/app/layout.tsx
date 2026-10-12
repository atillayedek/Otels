import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { SITE } from '@/lib/site';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.product} — Otelinizin kendi sunucusunda çalışan PMS`, template: `%s · ${SITE.product}` },
  description: SITE.description,
  applicationName: SITE.product,
  authors: [{ name: SITE.studio }],
  openGraph: { type: 'website', locale: 'tr_TR', siteName: SITE.product, title: SITE.product, description: SITE.description },
};

export const viewport: Viewport = { themeColor: '#1d4ed8', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
