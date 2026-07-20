import configuration from './configuration';

/** Snapshot & restore the env vars this suite mutates. */
const KEYS = [
  'NODE_ENV', 'DB_PROVIDER', 'JWT_SECRET', 'ALLOW_SERVER_FS', 'EXPOSE_DOCS',
  'ALLOW_EPHEMERAL_SQLITE', 'REQUIRE_PERSISTENT_DB', 'MYSQL_PWD', 'DB_PASSWORD', 'DB_HOST', 'DB_USER', 'DB_NAME',
];
const STRONG = 'a'.repeat(48);

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
    process.env.ALLOW_EPHEMERAL_SQLITE = 'true'; // isolate the JWT guard
    process.env.JWT_SECRET = 'CHANGE_ME_IN_PRODUCTION_secret_key_32chars';
    expect(() => configuration()).toThrow(/JWT_SECRET/);
  });

  it('accepts a strong secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_EPHEMERAL_SQLITE = 'true';
    process.env.JWT_SECRET = STRONG;
    const cfg = configuration();
    expect(cfg.jwt.secret).toHaveLength(48);
  });

  it('warns (but does not crash) in production on ephemeral SQLite', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = STRONG;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // A durability config choice must never take a live site down — warn, boot.
    expect(() => configuration()).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/DATA DURABILITY WARNING/));
    spy.mockRestore();
  });

  it('hard-fails on ephemeral SQLite only when REQUIRE_PERSISTENT_DB is opted in', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = STRONG;
    process.env.REQUIRE_PERSISTENT_DB = 'true';
    expect(() => configuration()).toThrow(/SQLite|persist|redeploy/i);
  });

  it('auto-selects the persistent MariaDB when its credentials are present', () => {
    process.env.MYSQL_PWD = 'secret';
    process.env.DB_HOST = '82.25.121.7';
    process.env.JWT_SECRET = STRONG; // MariaDB creds make it production-like
    const cfg = configuration();
    expect(cfg.db.provider).toBe('mariadb');
    expect(cfg.dbProvider).toBe('mariadb');
    expect(cfg.dbPersistent).toBe(true);
  });

  it('allows ephemeral SQLite in production only when explicitly opted in', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = STRONG;
    process.env.ALLOW_EPHEMERAL_SQLITE = 'true';
    const cfg = configuration();
    expect(cfg.db.provider).toBe('sqlite');
    expect(cfg.dbPersistent).toBe(false);
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
