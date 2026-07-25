import { detectSecrets, redactSecrets } from './secret-patterns';

describe('secret-patterns · detectSecrets', () => {
  it('detects an assignment-form secret and masks the value', () => {
    const found = detectSecrets('api_key = "q7HgSuperSecret9t66"\n');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].masked_value).not.toContain('SuperSecret');
    expect(found[0].masked_value).toMatch(/\*{4,}/);
  });

  it('detects provider keys, AWS keys, GitHub tokens and JWTs', () => {
    const src = [
      'const a = "sk-abcdefghijklmnop1234567890"',
      'aws = "AKIAIOSFODNN7EXAMPLE"',
      'gh = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      'jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghijKLMno"',
    ].join('\n');
    const types = detectSecrets(src).map((f) => f.type);
    expect(types).toEqual(expect.arrayContaining(['Provider API Key', 'AWS Access Key', 'GitHub Token', 'JWT']));
  });

  it('reports nothing for clean source', () => {
    expect(detectSecrets('const total = price * quantity;\n')).toEqual([]);
  });
});

describe('secret-patterns · redactSecrets', () => {
  it('masks the value but keeps the assignment key name', () => {
    const out = redactSecrets('password = "hunter2hunter2"');
    expect(out).toContain('password');
    expect(out).not.toContain('hunter2hunter2');
    expect(out).toContain('‹redacted-secret›');
  });

  it('masks a standalone AWS key entirely', () => {
    const out = redactSecrets('key AKIAIOSFODNN7EXAMPLE here');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});
