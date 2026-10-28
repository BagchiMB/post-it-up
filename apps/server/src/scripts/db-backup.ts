// On-demand backup: npm run db:backup -w apps/server  →  DATA_DIR/backups/app-<UTC stamp>-manual.db
// Safe while the server runs (SQLite VACUUM INTO). Does not migrate anything.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.ts';
import { backupDatabase, listBackups, schemaVersion } from '../migrations.ts';

const file = path.join(config.dataDir, 'app.db');
const out = (line: string) => process.stdout.write(`${line}\n`);
const fail = (line: string) => process.stderr.write(`${line}\n`);

if (!existsSync(file)) {
  fail(`No database at ${file} (DATA_DIR=${config.dataDir}).`);
  process.exit(1);
}
const db = new DatabaseSync(file, { readOnly: true });
try {
  const backup = backupDatabase(db, config.dataDir, 'manual');
  out(`Backed up schema v${schemaVersion(db)} to ${backup}`);
  out(`${listBackups(config.dataDir).length} backup(s) kept in ${path.dirname(backup)}`);
} catch (e) {
  fail(`Backup failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
