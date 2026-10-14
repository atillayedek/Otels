import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri istemcisi: sabit port, ağ isteği yok (tüm API çağrıları Rust katmanından).
// --mode restaurant: TSDMR Restoran (garson uygulaması) arayüzü; ayrı .env dosyası gerekmez.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_MODE': JSON.stringify(mode === 'restaurant' ? 'restaurant' : 'pms') },
  clearScreen: false,
  // Yalnız geliştirme: arayüzü tarayıcıda yerel test sunucusuna (scripts/test-env.ps1) bağlamak için (bkz. src/lib/devBrowserBridge.ts).
  server: { port: 5173, strictPort: true, proxy: { '/__pms': { target: 'https://127.0.0.1:18443', secure: false, changeOrigin: true, rewrite: p => p.replace(/^\/__pms/, '') } } },
  build: { target: 'chrome110', outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
}));
