/**
 * The one canonical secret-pattern library (Roadmap Pillar 4 — Security).
 *
 * Previously the codebase scanner and the LLM redactor each carried their own
 * partial secret regexes. This unifies them: a single, richer pattern set that
 * both `detectSecrets` (for the scanner's findings) and `redactSecrets` (for the
 * pre-LLM redactor) consume — so a credential the scanner flags is also a
 * credential we mask before any text leaves the box, and vice versa. Fail-safe:
 * over-detection is acceptable; leaking a live credential is not.
 */

export type SecretSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

interface SecretPattern {
  id: string;
  label: string;
  severity: SecretSeverity;
  re: RegExp;
  /** When set, the secret value is this capture group and only it is masked
   *  (the assignment key name is kept as useful context). */
  valueGroup?: number;
}

/**
 * Order matters only for the assignment forms (more specific first). Standalone
 * shapes are position-independent. Every `re` carries the global flag via
 * normalisation below, so callers can iterate matches safely.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  // ── Assignment forms: key = "value" — keep the key, mask the value ──────────
  {
    id: 'generic_assignment', label: 'Generic Secret Key', severity: 'HIGH', valueGroup: 2,
    re: /\b(api[_-]?key|secret[_-]?key|secret|password|passwd|db[_-]?pass|access[_-]?token|auth[_-]?token|client[_-]?secret|token)\b\s*[:=]\s*["'`]([A-Za-z0-9_\-.]{8,})["'`]/gi,
  },
  {
    id: 'bearer_token', label: 'Bearer API Token', severity: 'HIGH', valueGroup: 1,
    re: /\bbearer\s+([A-Za-z0-9_\-.]{15,})\b/gi,
  },
  // ── Standalone credential shapes: the whole match is the secret ─────────────
  { id: 'private_key', label: 'Private Key (PEM)', severity: 'CRITICAL', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { id: 'aws_access_key', label: 'AWS Access Key', severity: 'HIGH', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'stripe_live', label: 'Stripe Live Key', severity: 'CRITICAL', re: /\b(?:sk|rk|pk)_live_[0-9A-Za-z]{16,}\b/g },
  { id: 'provider_key', label: 'Provider API Key', severity: 'HIGH', re: /\b(?:sk|pk|rk)-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}\b/g },
  { id: 'github_token', label: 'GitHub Token', severity: 'HIGH', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { id: 'google_api_key', label: 'Google API Key', severity: 'HIGH', re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: 'slack_token', label: 'Slack Token', severity: 'HIGH', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: 'jwt', label: 'JWT', severity: 'MEDIUM', re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
];

const MASK = '‹redacted-secret›';

const withGlobal = (re: RegExp): RegExp => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');

const lineOf = (content: string, index: number): number => {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++;
  return n;
};

/** Mask a value, preserving a few edge characters as a fingerprint. */
export function maskSecretValue(v: string): string {
  return v.length > 8 ? v.slice(0, 4) + '********' + v.slice(-4) : '********';
}

export interface SecretFinding {
  type: string;
  masked_value: string;
  line: number;
  severity: SecretSeverity;
}

/**
 * Detect hardcoded secrets in source. Deduped by type+line so overlapping
 * patterns don't double-report the same credential. Returns the scanner's
 * `{ type, masked_value, line }` shape plus a severity.
 */
export function detectSecrets(content: string): SecretFinding[] {
  if (!content) return [];
  const out: SecretFinding[] = [];
  const seen = new Set<string>();
  for (const p of SECRET_PATTERNS) {
    const re = withGlobal(p.re);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const value = p.valueGroup !== undefined ? m[p.valueGroup] : m[0];
      if (!value) { if (m.index === re.lastIndex) re.lastIndex++; continue; }
      const line = lineOf(content, m.index);
      const key = `${p.label}:${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ type: p.label, masked_value: maskSecretValue(value), line, severity: p.severity });
      }
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    }
  }
  return out;
}

/**
 * Redact every secret from text before it leaves the box (e.g. into an LLM
 * prompt). Assignment forms keep their key name; standalone shapes are masked
 * whole. Uses the same pattern set as detection.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const p of SECRET_PATTERNS) {
    const re = withGlobal(p.re);
    if (p.valueGroup !== undefined) {
      out = out.replace(re, (full, ...groups) => {
        const value = groups[p.valueGroup! - 1];
        return typeof value === 'string' ? full.replace(value, MASK) : full;
      });
    } else {
      out = out.replace(re, MASK);
    }
  }
  return out;
}
