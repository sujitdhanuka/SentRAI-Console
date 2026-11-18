/**
 * Central runtime configuration, loaded from environment variables.
 * Mirrors src/sentrai/config.py (Settings) and the JWT constants from
 * api/middleware/auth.py.
 */
import { FeatureFlags, getFeatureFlags } from '../common/feature-flags';

export interface AppConfig {
  port: number;
  corsOrigins: string[];
  appName: string;
  /** Canonical public origin (no trailing slash) used for absolute URLs in
   *  sitemap.xml / robots.txt. Override per environment with PUBLIC_URL. */
  publicUrl: string;

  db: {
    provider: 'sqlite' | 'mariadb';
    sqlitePath: string;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    synchronize: boolean;
  };

  // Safe (secret-free) DB descriptor for the public bootstrap diagnostic, so an
  // operator can confirm from the outside whether data lands in the persistent
  // MariaDB or a disposable SQLite file.
  dbProvider: 'sqlite' | 'mariadb';
  dbPersistent: boolean;

  jwt: {
    secret: string;
    algorithm: 'HS256';
    accessTokenExpireMinutes: number; // 8 hours, matches Python ACCESS_TOKEN_EXPIRE_MINUTES
    refreshTokenExpireDays: number; // 30 days
  };

  neo4j: {
    uri: string;
    user: string;
    password: string;
  };

  // DPDP Act — fields masked in audit logs and responses
  dpdpPiiFields: string[];

  // Drift monitoring thresholds
  psiWarningThreshold: number;
  psiAlertThreshold: number;
  accuracyDropAlertPct: number;

  // Inventory semi-annual update enforcement (days)
  inventoryUpdateSlaDays: number;

  // Governance feature flags (GOVERNANCE_V2 master switch, default off).
  featureFlags: FeatureFlags;

  // Outbound webhook for governance notifications (breaker trips, overdue
  // incidents, staleness, plan soft limits). Unset = log-only.
  webhookUrl: string | null;

  // EU AI Act high-risk functional areas (comma-separated env override)
  euAiActHighRiskDomains: string[];

  // Allow browsing/scanning arbitrary server filesystem paths. Dangerous on
  // shared/hosted deployments (arbitrary directory read). Defaults OFF in
  // production; hosted users onboard code via ZIP upload instead.
  allowServerFs: boolean;

  // Expose Swagger UI at /docs. Defaults OFF in production to avoid publishing
  // the full API surface to unauthenticated visitors.
  exposeDocs: boolean;

  // True when NODE_ENV=production or DB_PROVIDER=mariadb.
  productionLike: boolean;

  // Bootstrap admin. In production the password must come from the environment,
  // or a strong one is generated and logged once — never the dev default.
  seedAdmin: {
    email: string;
    password: string | null;
    reset: boolean;
  };

  // AI-assisted model-description summariser. Off-box by default: the 'heuristic'
  // provider runs fully locally (no network). Switch to 'anthropic' only with an
  // explicit key — that sends a secret-masked snippet to Claude. See SummarizerService.
  aiSummarizer: {
    provider: 'heuristic' | 'anthropic';
    model: string;
    apiKey: string | null;
    baseUrl: string;
    maxSnippetChars: number;
  };

  // At-rest encryption for per-org AI provider API keys. Prefer a dedicated
  // APP_ENCRYPTION_KEY; falls back to the JWT secret (dedicated=false) so
  // existing deployments keep working — but then rotating the JWT secret
  // orphans stored provider keys, so production logs a warning.
  encryption: {
    key: string;
    dedicated: boolean;
  };
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const DEV_FALLBACK_SECRET = 'CHANGE_ME_IN_PRODUCTION_secret_key_32chars';

/**
 * Choose the database engine. An explicit DB_PROVIDER wins; otherwise, if
 * MariaDB credentials are present, prefer the persistent database — so a host
 * that only sets MYSQL_PWD + DB_HOST never silently falls back to a disposable
 * SQLite file that is wiped on every redeploy.
 */
function resolveDbProvider(): 'sqlite' | 'mariadb' {
  const explicit = (process.env.DB_PROVIDER ?? '').toLowerCase();
  if (explicit === 'mariadb' || explicit === 'mysql') return 'mariadb';
  if (explicit === 'sqlite') return 'sqlite';
  const hasMariaCreds = Boolean((process.env.MYSQL_PWD || process.env.DB_PASSWORD) && process.env.DB_HOST);
  return hasMariaCreds ? 'mariadb' : 'sqlite';
}

/**
 * A deployment is treated as "production" when NODE_ENV=production OR it runs
 * against MariaDB (the hosted DB) — either way, weak secrets are refused.
 */
function isProductionLike(): boolean {
  return process.env.NODE_ENV === 'production' || resolveDbProvider() === 'mariadb';
}

/**
 * A production deployment on ephemeral SQLite loses all data on every redeploy
 * (the file lives in the app directory). Flag it LOUDLY — but do NOT crash the
 * app by default: a data-durability config choice must never take a live site
 * down. Operators who want a hard guarantee opt in with REQUIRE_PERSISTENT_DB.
 */
function checkDbDurabilityInProduction(provider: 'sqlite' | 'mariadb'): void {
  if (provider === 'mariadb') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (bool(process.env.ALLOW_EPHEMERAL_SQLITE, false)) return; // intentional (mounted volume)
  const message =
    'production is using SQLite, whose file is wiped on every redeploy — data will NOT persist. ' +
    'Point the app at the persistent database: set DB_PROVIDER=mariadb with DB_HOST, DB_USER, DB_NAME ' +
    'and MYSQL_PWD (or DB_PASSWORD). If SQLITE_PATH is on a mounted volume, set ALLOW_EPHEMERAL_SQLITE=true.';
  if (bool(process.env.REQUIRE_PERSISTENT_DB, false)) {
    throw new Error(`FATAL: ${message}`);
  }
  // eslint-disable-next-line no-console
  console.error(`⚠️  DATA DURABILITY WARNING: ${message}`);
}

/**
 * Resolves the JWT secret and fails fast in production if it is missing, the
 * in-repo dev fallback, or too short to resist brute-forcing. A forgeable JWT
 * secret means anyone can mint admin tokens, so this must never silently pass.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? process.env.SENTRAI_JWT_SECRET;
  if (isProductionLike()) {
    if (!secret || secret === DEV_FALLBACK_SECRET || secret.length < 32) {
      throw new Error(
        'FATAL: JWT_SECRET must be set to a strong value (>=32 chars) in production. ' +
          'Refusing to start with a missing or default secret. Generate one with: ' +
          "node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
      );
    }
    return secret;
  }
  return secret ?? DEV_FALLBACK_SECRET;
}

export default (): AppConfig => {
  const dbProvider = resolveDbProvider();
  // Surface (don't crash on) an ephemeral-SQLite production, so a durability
  // config choice never silently loses data — nor takes the site down.
  checkDbDurabilityInProduction(dbProvider);

  return {
  port: parseInt(process.env.PORT ?? '8000', 10),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:8000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  appName: 'RBI SentrAI Compliance Service',
  publicUrl: (process.env.PUBLIC_URL ?? 'https://sentraiconsole.com').replace(/\/+$/, ''),

  db: {
    provider: dbProvider,
    sqlitePath: process.env.SQLITE_PATH ?? './dev.db',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USER ?? 'sentrai',
    // MYSQL_PWD is the conventional MySQL/MariaDB client env var — supported so
    // hosts (e.g. Hostinger hPanel) can keep the secret out of app-specific vars.
    password: process.env.DB_PASSWORD ?? process.env.MYSQL_PWD ?? 'sentrai',
    database: process.env.DB_NAME ?? 'sentrai_compliance',
    // On a persistent MariaDB, schema changes here are additive (new tables /
    // nullable columns). Removing an entity column would drop it — don't.
    synchronize: bool(process.env.DB_SYNCHRONIZE, true),
  },

  dbProvider,
  dbPersistent: dbProvider === 'mariadb',

  jwt: {
    secret: resolveJwtSecret(),
    algorithm: 'HS256',
    accessTokenExpireMinutes: 60 * 8,
    refreshTokenExpireDays: 30,
  },

  neo4j: {
    uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: process.env.NEO4J_USER ?? 'neo4j',
    password: process.env.NEO4J_PASSWORD ?? 'password',
  },

  dpdpPiiFields: [
    'pan',
    'aadhaar',
    'mobile',
    'email',
    'account_number',
    'customer_id',
    'ip_address',
    'device_id',
  ],

  psiWarningThreshold: parseFloat(process.env.PSI_WARNING_THRESHOLD ?? '0.10'),
  psiAlertThreshold: parseFloat(process.env.PSI_ALERT_THRESHOLD ?? '0.20'),
  accuracyDropAlertPct: parseFloat(process.env.ACCURACY_DROP_ALERT_PCT ?? '0.05'),
  inventoryUpdateSlaDays: parseInt(process.env.INVENTORY_UPDATE_SLA_DAYS ?? '180', 10),
  featureFlags: getFeatureFlags(),

  webhookUrl: process.env.WEBHOOK_URL?.trim() || null,

  euAiActHighRiskDomains: (
    process.env.EU_AI_ACT_HIGH_RISK_DOMAINS ??
    'credit_underwriting,loan_decisioning,fund_movement,credit_scoring,insurance_pricing'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Off by default in production unless explicitly opted in.
  allowServerFs: bool(process.env.ALLOW_SERVER_FS, !isProductionLike()),
  exposeDocs: bool(process.env.EXPOSE_DOCS, !isProductionLike()),
  productionLike: isProductionLike(),

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@sentrai.local',
    password: process.env.SEED_ADMIN_PASSWORD?.trim() || null,
    reset: bool(process.env.SEED_ADMIN_RESET, false),
  },

  aiSummarizer: {
    // 'heuristic' = local, no network (the shipped default / stub). Set
    // AI_SUMMARIZER_PROVIDER=anthropic + ANTHROPIC_API_KEY to send a masked
    // snippet to Claude. baseUrl lets a bank point at a VPC/Bedrock endpoint.
    provider: (process.env.AI_SUMMARIZER_PROVIDER?.trim() as 'heuristic' | 'anthropic')
      || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'heuristic'),
    model: process.env.AI_SUMMARIZER_MODEL?.trim() || 'claude-sonnet-5',
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    baseUrl: process.env.AI_SUMMARIZER_BASE_URL?.trim() || 'https://api.anthropic.com',
    maxSnippetChars: parseInt(process.env.AI_SUMMARIZER_MAX_SNIPPET_CHARS ?? '4000', 10),
  },

  encryption: resolveEncryptionKey(),
  };
};

/** Dedicated APP_ENCRYPTION_KEY preferred; JWT secret as compatible fallback. */
function resolveEncryptionKey(): { key: string; dedicated: boolean } {
  const dedicated = process.env.APP_ENCRYPTION_KEY?.trim();
  if (dedicated && dedicated.length >= 16) return { key: dedicated, dedicated: true };
  if (isProductionLike()) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] APP_ENCRYPTION_KEY is not set — AI provider keys will be encrypted with a key ' +
        'derived from the JWT secret. This works, but rotating JWT_SECRET will orphan stored ' +
        "provider keys. Set a dedicated APP_ENCRYPTION_KEY: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return { key: resolveJwtSecret(), dedicated: false };
}
