import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// One version number: the console shows the version declared in its package.json
// (kept equal to the server's APP_VERSION in src/common/build.ts).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

// base '/dashboard/' — the built app is served by the NestJS console at /dashboard
// (outDir goes into public/dashboard, which the deploy already ships).
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: '/dashboard/',
  build: { outDir: '../public/dashboard', emptyOutDir: true },
  server: {
    port: 5199,
    strictPort: false,
    proxy: { '/api': { target: process.env.VITE_API ?? 'http://localhost:8002', changeOrigin: true } },
  },
});
