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
export const DASHBOARD_DIR = join(PUBLIC_DIR, 'dashboard');
export const INDEX_HTML = join(PUBLIC_DIR, 'index.html');
export const LANDING_HTML = join(PUBLIC_DIR, 'landing.html');
/**
 * Per-project codebase workspaces for uploaded code. Defaults to a `workspaces`
 * dir under the process cwd, but is overridable via WORKSPACES_DIR so hosts
 * with a read-only app root (or a separate persistent volume) can point it at a
 * writable, persistent location.
 */
export const WORKSPACES_DIR = process.env.WORKSPACES_DIR?.trim() || join(process.cwd(), 'workspaces');
export const HELP_MD = join(DOCS_DIR, 'HELP.md');

/** The public 2-minute product walkthrough, served at /demo (page) + /demo.mp4. */
export const DEMO_MP4 = join(PUBLIC_DIR, 'media', 'sentrai-demo.mp4');

/**
 * The standalone CI gate runner, served publicly at /api/v1/ci/gate.mjs so any
 * pipeline (incl. private repos that can't reference a cross-repo Action) can
 * `curl … | node` it without vendoring a copy. Read from public/ (which is
 * always deployed) first, then the repo's ci-integration/ copy (dev / full
 * checkouts) — hosts that deploy only dist/ + public/ still serve it.
 */
export const GATE_SCRIPT_CANDIDATES = [
  join(PUBLIC_DIR, 'ci-gate.mjs'),
  join(process.cwd(), 'ci-integration', 'sentrai-gate.mjs'),
];
