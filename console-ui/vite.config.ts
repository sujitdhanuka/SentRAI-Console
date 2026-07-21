import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/dashboard/' — the built app is served by the NestJS console at /dashboard
// (outDir goes into public/dashboard, which the deploy already ships).
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: { outDir: '../public/dashboard', emptyOutDir: true },
  server: {
    port: 5199,
    strictPort: false,
    proxy: { '/api': { target: process.env.VITE_API ?? 'http://localhost:8002', changeOrigin: true } },
  },
});
