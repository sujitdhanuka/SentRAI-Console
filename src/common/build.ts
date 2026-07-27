/**
 * A human-readable build marker, bumped on meaningful releases. Exposed by the
 * public /api/v1/auth/bootstrap-status diagnostic and /health so an operator
 * (or support) can confirm from the outside which build is actually running on
 * a host.
 *
 * 1.1.0 — Gap-Remediation Roadmap: all 5 pillars (Alignment, Control,
 *         Visibility, Security, Societal). Additive over the v1.0.0 baseline.
 * 1.1.1 — Dependency security patch: brace-expansion→5.0.8, js-yaml(3.x
 *         chain)→4.3.0, file-type→21.3.2 via npm overrides.
 * 1.2.0 — Evidence & reporting release: scan detection-evidence panel,
 *         inventory kind filter, drawer board-approval line, line-accurate
 *         SARIF + in-console viewer, hash-chained audit ledger, incident
 *         ledger events, public grievance form, board governance report,
 *         Google Analytics.
 * 1.2.1 — Security: migrate to NestJS 11 (+ Express 5), clearing the last
 *         Hostinger-flagged CVE (@nestjs/core CVE-2026-35515). Landing route
 *         adapted to Express 5 (readFile+send; @Get() root).
 * 1.2.2 — Security: purge the last two lockfile advisories —
 *         brace-expansion@1.1.16 (dev-only, via minimatch@3) by overriding
 *         minimatch→^10; js-yaml@5.2.1 (via @nestjs/swagger) by overriding
 *         js-yaml@^5→^5.2.2. Lockfile now reports 0 vulnerabilities.
 */
export const APP_VERSION = '1.2.2';
export const BUILD_TAG = '1.2.2';
