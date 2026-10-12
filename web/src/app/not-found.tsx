import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container" style={{ padding: '96px 16px', textAlign: 'center' }}>
      <h1>Sayfa bulunamadı</h1>
      <p className="muted">Aradığınız sayfa kaldırılmış ya da adresi değişmiş olabilir.</p>
      <Link href="/" className="btn primary">Ana sayfaya dön</Link>
    </div>
  );
}
