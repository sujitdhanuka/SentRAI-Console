/**
 * A human-readable build marker, bumped on meaningful releases. Exposed by the
 * public /api/v1/auth/bootstrap-status diagnostic and /health so an operator
 * (or support) can confirm from the outside which build is actually running on
 * a host.
 *
 * 1.1.0 — Gap-Remediation Roadmap: all 5 pillars (Alignment, Control,
 *         Visibility, Security, Societal). Additive over the v1.0.0 baseline.
 */
export const BUILD_TAG = '1.1.0';
