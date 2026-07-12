import { maskDict, maskValue } from './dpdp';

describe('PII masking (DPDP + GDPR patterns)', () => {
  it('masks India-specific identifiers embedded in strings', () => {
    const masked = maskDict({
      note: 'Customer PAN ABCDE1234F called from 9876543210 about aadhaar 1234 5678 9012',
    });
    expect(masked.note).not.toContain('ABCDE1234F');
    expect(masked.note).not.toContain('9876543210');
    expect(masked.note).toContain('[PAN_MASKED]');
    expect(masked.note).toContain('[AADHAAR_MASKED]');
  });

  it('masks GDPR-relevant identifiers: emails and IBANs', () => {
    const masked = maskDict({ note: 'Contact jane.doe@bank.eu, account DE89370400440532013000' });
    expect(masked.note).toContain('[EMAIL_MASKED]');
    expect(masked.note).toContain('[IBAN_MASKED]');
    expect(masked.note).not.toContain('jane.doe@bank.eu');
  });

  it('masks credential fields by key, at any nesting depth', () => {
    const masked = maskDict({ auth: { password: 'supersecret1', api_key: 'ak-12345678' }, name: 'ok' });
    expect(masked.auth.password).not.toBe('supersecret1');
    expect(masked.auth.password).toContain('*');
    expect(masked.auth.api_key).toContain('*');
    expect(masked.name).toBe('ok');
  });

  it('masks short values entirely', () => {
    expect(maskValue('pan', 'abcd')).toBe('****');
  });
});
