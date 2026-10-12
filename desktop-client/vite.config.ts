import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri istemcisi: sabit port, ağ isteği yok (tüm API çağrıları Rust katmanından).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'chrome110', outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
});
