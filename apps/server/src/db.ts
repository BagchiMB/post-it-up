import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { config } from './config.ts';
import { log, logError } from './log.ts';
import { prepareDatabase, tightenPermissions } from './migrations.ts';

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Bring the schema up to date (append-only migrations in migrations.ts): refuses a database from a
// newer server, and backs up to DATA_DIR/backups before migrating; if that backup fails, stop.
try {
  const { from, to, backup } = prepareDatabase(db, config.dataDir);
  if (from !== to) {
    log(`database migrated v${from} → v${to}${backup ? ` (backup: ${backup})` : ''}`);
  }
} catch (e) {
  logError('FATAL', e);
  db.close();
  process.exit(1);
}

// User data stays owner-only (DATA_DIR + backups 0700, database/key/backup files 0600).
const tightened = tightenPermissions(config.dataDir);
if (tightened.length) {
  log(`tightened permissions to owner-only on ${tightened.length} path(s) in ${config.dataDir}`);
}

type Row = Record<string, unknown>;

export const one = <T = Row>(sql: string, ...params: SQLInputValue[]) =>
  db.prepare(sql).get(...params) as T | undefined;
export const all = <T = Row>(sql: string, ...params: SQLInputValue[]) =>
  db.prepare(sql).all(...params) as T[];
export const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
