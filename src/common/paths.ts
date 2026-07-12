import { join } from 'path';

/**
 * Absolute path to the bundled frontend + docs assets. Resolved from the
 * process working directory so it is identical whether the app runs via
 * `npm run start`, `start:dev`, or `node dist/main` — all launched from the
 * project root (node/).
 */
export const PUBLIC_DIR = join(process.cwd(), 'public');
export const DOCS_DIR = join(PUBLIC_DIR, 'docs');
export const IMAGES_DIR = join(DOCS_DIR, 'images');
export const STATIC_DIR = join(PUBLIC_DIR, 'static');
export const INDEX_HTML = join(PUBLIC_DIR, 'index.html');
export const LANDING_HTML = join(PUBLIC_DIR, 'landing.html');
export const HELP_MD = join(DOCS_DIR, 'HELP.md');
