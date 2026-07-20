import { ColumnType, ValueTransformer } from 'typeorm';

/**
 * Column type for a large JSON payload, chosen per database engine:
 *  - MariaDB/MySQL: `mediumtext` (16 MB). The default `text` is only 64 KB, which
 *    a big codebase scan result overruns → truncated → corrupt → crashes reads.
 *  - SQLite (dev/test): `text` — SQLite has no practical text limit and does not
 *    support `mediumtext`.
 * Resolved from the environment at import time (mirrors config's resolveDbProvider),
 * which is correct because a deployment runs against a single engine.
 */
export function largeJsonColumnType(): ColumnType {
  const explicit = (process.env.DB_PROVIDER ?? '').toLowerCase();
  if (explicit === 'sqlite') return 'text';
  if (explicit === 'mariadb' || explicit === 'mysql') return 'mediumtext';
  const hasMariaCreds = Boolean((process.env.MYSQL_PWD || process.env.DB_PASSWORD) && process.env.DB_HOST);
  return hasMariaCreds ? 'mediumtext' : 'text';
}

/**
 * A resilient JSON column transformer. Unlike TypeORM's built-in `simple-json`
 * (which throws on read if the stored text is malformed), this returns `null`
 * when a value can't be parsed — so a truncated or corrupt column can never
 * crash a query (e.g. a large scan result that overran a too-small column).
 *
 * Pair it with a large column type (`mediumtext`/`longtext` on MariaDB) so big
 * payloads are stored intact rather than silently truncated in the first place.
 */
export const safeJsonTransformer: ValueTransformer = {
  to: (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  },
  from: (value: string | null): unknown => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value; // already deserialized by the driver
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
};
