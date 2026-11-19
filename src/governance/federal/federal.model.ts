/**
 * Federal-vendor support (E3.8, US M-25-22 and M-25-21 contract terms): the
 * no-training attestation rules and the column filter for the full
 * organisation data export.
 */

/** Columns never written to an export, whatever the table. */
const SECRET_COLUMN = /(password|secret|apikey|api_key|token(?!s(in|out))|privatekey|encrypted)/i;

export function isSecretColumn(name: string): boolean {
  if (/^tokens(in|out)$/i.test(name)) return false;
  return SECRET_COLUMN.test(name);
}

/** Strip secret columns and credentials embedded in URLs from one row. */
export function scrubRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isSecretColumn(k)) continue;
    // A webhook `url` can carry its token in the path (Slack-style), so only its host and first path segment are kept.
    out[k] = typeof v === 'string' && k === 'url' ? scrubUrl(v, true) : typeof v === 'string' && /url$/i.test(k) ? scrubUrl(v) : v;
  }
  return out;
}

export function scrubUrl(u: string, maskPath = false): string {
  try {
    const x = new URL(u);
    const parts = x.pathname.split('/').filter(Boolean);
    const longPath = maskPath && parts.length > 1;
    if (!x.username && !x.password && !x.search && !longPath) return u;
    x.username = '';
    x.password = '';
    x.search = x.search ? '?redacted' : '';
    if (longPath) x.pathname = `/${parts[0]}/redacted`;
    return x.toString();
  } catch {
    return u;
  }
}

export interface AttestationLike { providerId: string; noTraining: boolean; revokedAt: Date | null; expiresAt: Date | null; endpoint?: string }

/** What an attestation is bound to: the provider's host and model (a change of either is a different service). */
export function providerEndpoint(p: { baseUrl: string; model: string }): string {
  let host = p.baseUrl;
  try {
    host = new URL(p.baseUrl).host.toLowerCase();
  } catch {
    /* keep the raw value */
  }
  return `${host}|${p.model}`.slice(0, 500);
}

export function attestationCurrent(r: AttestationLike, now = new Date(), currentEndpoint?: string): boolean {
  if (!r.noTraining || r.revokedAt || (r.expiresAt && r.expiresAt <= now)) return false;
  return currentEndpoint === undefined || r.endpoint === currentEndpoint;
}

/**
 * Provider ids with a current no-training attestation. With `endpoints`
 * (provider id → current host and model), an attestation counts only while
 * the provider still points where it pointed when attested.
 */
export function attestedProviders(rows: AttestationLike[], now = new Date(), endpoints?: Map<string, string>): string[] {
  return [...new Set(rows.filter((r) => attestationCurrent(r, now, endpoints ? endpoints.get(r.providerId) ?? '\u0000' : undefined)).map((r) => r.providerId))];
}
