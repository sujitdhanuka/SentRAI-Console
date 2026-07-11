// Runs before the e2e suite is imported — forces an isolated in-memory SQLite DB.
process.env.DB_PROVIDER = 'sqlite';
process.env.SQLITE_PATH = ':memory:';
process.env.DB_SYNCHRONIZE = 'true';
process.env.JWT_SECRET = 'test-secret';
process.env.CORS_ORIGINS = 'http://localhost';
