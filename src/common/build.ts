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
 */
export const BUILD_TAG = '1.1.1';
