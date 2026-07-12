/**
 * One-shot data conversion: copies every table from the local SQLite database
 * into the production MariaDB database, preserving primary keys.
 *
 * Run ON THE HOST where the SQLite file lives (schema is created on the target
 * automatically):
 *
 *   SQLITE_PATH=./dev.db \
 *   DB_HOST=82.25.121.7 DB_PORT=3306 \
 *   DB_USER=u709389505_sentrai DB_NAME=u709389505_sentrai \
 *   MYSQL_PWD=<password> \
 *   npm run db:convert
 *
 * Safety: refuses to run if the target already contains users, unless FORCE=1.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { ALL_ENTITIES, UserEntity } from '../database/entities';

async function main(): Promise<void> {
  const sqlitePath = process.env.SQLITE_PATH ?? './dev.db';

  const source = new DataSource({
    type: 'better-sqlite3',
    database: sqlitePath,
    entities: ALL_ENTITIES,
    synchronize: false,
  });

  const target = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    username: process.env.DB_USER ?? 'sentrai',
    password: process.env.DB_PASSWORD ?? process.env.MYSQL_PWD ?? '',
    database: process.env.DB_NAME ?? 'sentrai_compliance',
    charset: 'utf8mb4',
    entities: ALL_ENTITIES,
    synchronize: true, // create the schema on the target before copying
  });

  console.log(`source: sqlite ${sqlitePath}`);
  console.log(`target: mariadb ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}/${process.env.DB_NAME}`);

  await source.initialize();
  await target.initialize();

  const existingUsers = await target.getRepository(UserEntity).count();
  if (existingUsers > 0 && process.env.FORCE !== '1') {
    console.error(
      `target already has ${existingUsers} user(s) — refusing to copy. ` +
        'Re-run with FORCE=1 to merge into the existing database anyway.',
    );
    process.exit(1);
  }

  for (const entity of ALL_ENTITIES) {
    const srcRepo = source.getRepository(entity);
    const dstRepo = target.getRepository(entity);
    const rows = await srcRepo.find();
    if (rows.length === 0) {
      console.log(`  ${dstRepo.metadata.tableName}: 0 rows (skipped)`);
      continue;
    }
    // save() upserts by primary key, so FORCE=1 re-runs are idempotent.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await dstRepo.save(rows.slice(i, i + CHUNK) as any[]);
    }
    console.log(`  ${dstRepo.metadata.tableName}: ${rows.length} rows copied`);
  }

  await source.destroy();
  await target.destroy();
  console.log('conversion complete.');
}

main().catch((e) => {
  console.error(`conversion failed: ${String(e)}`);
  process.exit(1);
});
