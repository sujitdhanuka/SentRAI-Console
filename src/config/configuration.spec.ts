import configuration from './configuration';

/** Snapshot & restore the env vars this suite mutates. */
const KEYS = ['NODE_ENV', 'DB_PROVIDER', 'JWT_SECRET', 'ALLOW_SERVER_FS', 'EXPOSE_DOCS'];

describe('configuration security guards', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('allows the dev fallback secret outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => configuration()).not.toThrow();
  });

  it('refuses to boot in production without a strong JWT secret', () => {
    process.env.DB_PROVIDER = 'mariadb'; // production-like
    expect(() => configuration()).toThrow(/JWT_SECRET/);
  });

  it('refuses the in-repo default secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'CHANGE_ME_IN_PRODUCTION_secret_key_32chars';
    expect(() => configuration()).toThrow(/JWT_SECRET/);
  });

  it('accepts a strong secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(48);
    const cfg = configuration();
    expect(cfg.jwt.secret).toHaveLength(48);
  });

  it('disables server FS access and docs by default in production', () => {
    process.env.DB_PROVIDER = 'mariadb';
    process.env.JWT_SECRET = 'b'.repeat(48);
    const cfg = configuration();
    expect(cfg.allowServerFs).toBe(false);
    expect(cfg.exposeDocs).toBe(false);
  });

  it('enables server FS access and docs by default in development', () => {
    process.env.NODE_ENV = 'development';
    const cfg = configuration();
    expect(cfg.allowServerFs).toBe(true);
    expect(cfg.exposeDocs).toBe(true);
  });
});
