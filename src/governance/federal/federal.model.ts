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
    out[k] = typeof v === 'string' && /url$/i.test(k) ? scrubUrl(v) : v;
  }
  return out;
}

export function scrubUrl(u: string): string {
  try {
    const x = new URL(u);
    if (!x.username && !x.password && !x.search) return u;
    x.username = '';
    x.password = '';
    x.search = x.search ? '?redacted' : '';
    return x.toString();
  } catch {
    return u;
  }
}

export interface AttestationLike { providerId: string; noTraining: boolean; revokedAt: Date | null; expiresAt: Date | null }

/** Provider ids with a current no-training attestation. */
export function attestedProviders(rows: AttestationLike[], now = new Date()): string[] {
  return [...new Set(rows.filter((r) => r.noTraining && !r.revokedAt && (!r.expiresAt || r.expiresAt > now)).map((r) => r.providerId))];
}
