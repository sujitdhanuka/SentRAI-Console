/**
 * Redacts hardcoded secrets from any text before it leaves the box (e.g. into an
 * LLM prompt). Fail-safe by design: over-redaction is acceptable, leaking a live
 * credential is not. Mirrors the secret classes the codebase scanner detects.
 */

// Assignment form: keep the key *name* (useful context) but mask the value.
const ASSIGNMENT_RE =
  /\b(api[_-]?key|secret[_-]?key|secret|password|passwd|db[_-]?pass|access[_-]?token|token|bearer)\b(\s*[:=]\s*)(["'`]?)[^\s"'`]{6,}\3/gi;

// Standalone secret shapes (masked whole).
const STANDALONE_RES: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}\b/g, // OpenAI/Anthropic-style keys
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key id
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub token
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, // JWT
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
];

const MASK = '‹redacted-secret›';

export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text.replace(ASSIGNMENT_RE, (_m, key, sep) => `${key}${sep}${MASK}`);
  for (const re of STANDALONE_RES) out = out.replace(re, MASK);
  return out;
}
