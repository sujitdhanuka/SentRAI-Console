/**
 * Redacts hardcoded secrets from any text before it leaves the box (e.g. into an
 * LLM prompt). Delegates to the unified secret-pattern library (Pillar 4) so the
 * redactor and the codebase scanner share exactly one pattern set — a credential
 * either flags is a credential the other masks. Fail-safe by design:
 * over-redaction is acceptable, leaking a live credential is not.
 */
export { redactSecrets } from '../common/secret-patterns';
