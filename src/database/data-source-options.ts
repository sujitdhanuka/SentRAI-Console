import { DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

export interface DbSettings {
  provider: 'sqlite' | 'mariadb';
  sqlitePath: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
}

/**
 * Builds TypeORM connection options from DB settings, choosing the driver at
 * runtime: better-sqlite3 locally, mysql2 (MariaDB) in production. One entity
 * set + one migration set serve both engines.
 */
export function buildDataSourceOptions(db: DbSettings): DataSourceOptions {
  const common = {
    entities: ALL_ENTITIES,
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: db.synchronize,
    logging: false as const,
  };

  if (db.provider === 'mariadb') {
    return {
      type: 'mysql', // mysql2 driver speaks the MariaDB protocol
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.database,
      charset: 'utf8mb4',
      ...common,
    };
  }

  return {
    type: 'better-sqlite3',
    database: db.sqlitePath,
    ...common,
  };
}
