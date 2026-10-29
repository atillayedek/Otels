import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { queryClient, SessionProvider } from './lib/session';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { App } from './App';
import { AppearanceProvider } from './lib/appearance';
import { installEnterNavigation } from './lib/enterNav';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import './styles/app.css';

// Geliştirmede Tauri kabuğu yoksa (tarayıcı) API köprüsü yüklenir; üretim derlemesine girmez.
if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window && (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke)) {
  await import('./lib/devBrowserBridge');
}

// Formlarda Enter bir sonraki kutucuğa geçer (resepsiyonda Tab yerine Enter kullanılır).
installEnterNavigation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
      <ToastProvider>
        <ConfirmProvider>
          <SessionProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </SessionProvider>
        </ConfirmProvider>
      </ToastProvider>
      </AppearanceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
