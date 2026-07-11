import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options';

// Standalone DataSource for the TypeORM CLI (migration:generate / run / revert).
dotenv.config();

export default new DataSource(
  buildDataSourceOptions({
    provider: (process.env.DB_PROVIDER ?? 'sqlite') as 'sqlite' | 'mariadb',
    sqlitePath: process.env.SQLITE_PATH ?? './dev.db',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USER ?? 'sentrai',
    password: process.env.DB_PASSWORD ?? 'sentrai',
    database: process.env.DB_NAME ?? 'sentrai_compliance',
    synchronize: false,
  }),
);
