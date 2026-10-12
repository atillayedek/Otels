import Link from 'next/link';
import { SITE } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container row">
        <div>
          <b style={{ color: 'var(--text)' }}>{SITE.product}</b> · {SITE.studio}
          {SITE.contactEmail && <> · <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a></>}
        </div>
        <nav aria-label="Alt menü">
          <Link href="/urun">Ürün</Link>
          <Link href="/nasil-calisir">Nasıl çalışır</Link>
          <Link href="/on-siparis">Ön sipariş</Link>
          <Link href="/kvkk">KVKK aydınlatma metni</Link>
        </nav>
        <div>© {new Date().getFullYear()} {SITE.studio}</div>
      </div>
    </footer>
  );
}
