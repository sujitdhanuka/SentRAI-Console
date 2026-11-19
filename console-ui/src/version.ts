/** Injected by vite.config.ts from console-ui/package.json (same number as the server's APP_VERSION). */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
