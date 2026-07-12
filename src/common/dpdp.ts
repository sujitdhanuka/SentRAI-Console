/**
 * PII masking utilities — masks personal data in payloads before they reach
 * audit sinks, ledger events, and notifications. Originally scoped to India's
 * DPDP Act 2023; now also covers common GDPR-relevant identifiers so audit
 * trails stay privacy-safe in EU deployments. Port of
 * api/middleware/dpdp_masking.py (mask_value/mask_dict), extended.
 */

const PII_FIELDS = new Set([
  'pan',
  'aadhaar',
  'mobile',
  'phone',
  'email',
  'account_number',
  'customer_id',
  'ip_address',
  'device_id',
  // Credentials must never land in an audit sink, masked or otherwise —
  // but defense in depth: mask them if they appear.
  'password',
  'new_password',
  'current_password',
  'token',
  'refresh_token',
  'access_token',
  'api_key',
  'secret',
]);

// India (DPDP Act) patterns
const AADHAAR_RE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const MOBILE_RE = /\b[6-9]\d{9}\b/g;

// GDPR-relevant patterns (EU deployments)
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

export function maskValue(key: string, value: any): any {
  if (value === null || value === undefined) return value ?? null;
  if (PII_FIELDS.has(key.toLowerCase())) {
    const s = String(value);
    if (s.length > 4) return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
    return '****';
  }
  return value;
}

export function maskDict(data: any): any {
  if (Array.isArray(data)) {
    return data.map((item) => maskDict(item));
  }
  if (data !== null && typeof data === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = maskValue(k, maskDict(v));
    }
    return out;
  }
  if (typeof data === 'string') {
    return data
      .replace(AADHAAR_RE, '[AADHAAR_MASKED]')
      .replace(PAN_RE, '[PAN_MASKED]')
      .replace(MOBILE_RE, '[MOBILE_MASKED]')
      .replace(EMAIL_RE, '[EMAIL_MASKED]')
      .replace(IBAN_RE, '[IBAN_MASKED]');
  }
  return data;
}
