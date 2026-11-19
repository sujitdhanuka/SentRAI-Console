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
 * 1.2.3 — Read-only evaluation access: a SEED_DEMO_TENANT boot toggle that
 *         self-provisions the Meridian demo tenant + a read-only "judge"
 *         (VIEWER) account on the host, and a global ViewerReadOnlyGuard that
 *         makes the VIEWER tier read-only across every controller (closing the
 *         gap where projects/inventory/compliance had no @Roles guard).
 * 1.2.4 — Make demo provisioning host-independent & observable: the seed logic
 *         is now the in-process DemoSeedService (compiled into dist/, demo repo
 *         under public/), exposed at POST /api/v1/admin/seed-demo (ADMIN-only)
 *         so an operator triggers it live from their session — no scripts/
 *         folder, no shell, no password. The SEED_DEMO_TENANT boot toggle uses
 *         the same service instead of spawning a script.
 * 1.2.5 — Fix the seeder under Passenger/proxy hosting (Hostinger): there is no
 *         reachable 127.0.0.1:$PORT, so self-calls to localhost failed ("fetch
 *         failed"). The seed now drives the app through its public origin,
 *         derived from the triggering request (x-forwarded-proto/host), so it
 *         round-trips back in through the proxy. DEMO_SEED_BASE_URL / PUBLIC_URL
 *         override it (and enable the boot toggle on such hosts).
 *
 * 1.8.0 — Governance release (Phases 0 to 3 of the governance plan), dark
 *         behind GOVERNANCE_V2 and one flag per epic: corrected compliance
 *         codes, framework pack engine with Australia and US packs, risk
 *         register, impact assessments, AIMS workspace, corrective actions,
 *         document control, accountability, model validation, fair lending,
 *         vendors, training, data register, Statement of Applicability,
 *         disclosures, incident extensions, TEVV, energy, AI security,
 *         engagement records and federal-vendor controls. Users and projects
 *         can be assigned to and moved between organisations. The coverage
 *         disclosure follows the evaluation path the deployment runs, and the
 *         on-screen help covers every Governance tab.
 *
 * The label was held at 1.2.2 through the 1.2.3–1.2.5 builds (by request) so
 * the dashboard, /health and the award evidence pack reported one number. It
 * moves to 1.8.0 by request; every place that shows or declares the version
 * reads it from here or from the package.json files, which carry the same
 * number.
 */
export const APP_VERSION = '1.8.0';
export const BUILD_TAG = '1.8.0';
