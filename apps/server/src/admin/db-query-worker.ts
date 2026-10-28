// Runs one read-only console query off the main thread so it can be stopped after the time limit
// (node:sqlite has no interrupt()). Read-only file open + an authorizer that only allows reads.
import { constants, DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

type Input = { file: string; sql: string; maxRows: number };
const { file, sql, maxRows } = workerData as Input;

const READ_OK = new Set([
  constants.SQLITE_SELECT,
  constants.SQLITE_READ,
  constants.SQLITE_FUNCTION,
  constants.SQLITE_RECURSIVE,
]);

try {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 2000 });
  db.setAuthorizer((code, _a1, a2) => {
    if (code === constants.SQLITE_FUNCTION && a2 && /^load_extension$/i.test(a2))
      return constants.SQLITE_DENY;
    return READ_OK.has(code) ? constants.SQLITE_OK : constants.SQLITE_DENY;
  });
  const stmt = db.prepare(sql);
  stmt.setReturnArrays(true);
  const columns = stmt.columns().map((c) => ({ name: c.name, table: c.table, column: c.column }));
  const rows: unknown[][] = [];
  let truncated = false;
  for (const row of stmt.iterate() as Iterable<unknown[]>) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(
      row.map((v) =>
        v instanceof Uint8Array
          ? `<${v.byteLength} bytes>`
          : typeof v === 'bigint'
            ? v.toString()
            : v,
      ),
    );
  }
  db.close();
  parentPort?.postMessage({ ok: true, columns, rows, truncated });
} catch (e) {
  const err = e as { message?: string; code?: string; name?: string };
  parentPort?.postMessage({
    ok: false,
    // Never an empty message: fall back to the error code/name.
    error: err?.message?.trim() || err?.code || err?.name || String(e) || 'unknown error',
  });
}
