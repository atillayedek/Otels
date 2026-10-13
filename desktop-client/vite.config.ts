import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri istemcisi: sabit port, ağ isteği yok (tüm API çağrıları Rust katmanından).
// --mode restaurant: TSDMR Restoran (garson uygulaması) arayüzü; ayrı .env dosyası gerekmez.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_MODE': JSON.stringify(mode === 'restaurant' ? 'restaurant' : 'pms') },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'chrome110', outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
}));
