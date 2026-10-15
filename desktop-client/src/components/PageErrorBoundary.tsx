import { Component, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

/**
 * Bir ekranda beklenmeyen bir hata oluşursa yalnız o ekran hata mesajı gösterir; menü ve diğer ekranlar çalışmaya devam eder.
 * Ekran değişince (key) sıfırlanır.
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) { console.error('Ekran hatası:', error); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty stack" style={{ maxWidth: 560, margin: '48px auto', textAlign: 'center' }}>
        <AlertTriangle size={32} />
        <h3 style={{ margin: 0 }}>Bu ekran açılırken bir hata oluştu</h3>
        <p className="muted" style={{ margin: 0 }}>Menüden başka bir ekrana geçebilir veya bu ekranı yeniden açabilirsiniz. Sorun sürerse
          Sunucu Yöneticisi'nden destek paketi oluşturup destek ekibine iletin.</p>
        <div className="error-box mono" style={{ textAlign: 'left', fontSize: 12 }}>{error.message}</div>
        <div><button className="btn primary" onClick={() => this.setState({ error: null })}><RefreshCw /> Yeniden dene</button></div>
      </div>
    );
  }
}
