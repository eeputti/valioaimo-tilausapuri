// Kopioi paikalliset SQLite-kannat Tursoon. Aja vain, kun Macin WhatsApp-palvelin ja julkaisija on pysäytetty,
// jotta kannoilla on yksi kirjoittaja. Ei korvaa etäkannan tietoja: ei-tyhjä taulu keskeyttää siirron.
// Käyttö: TURSO_AUTH_TOKEN=… node deploy/vercel/migrate.mjs paikallinen.db=libsql://kanta.turso.io [...]
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openSqlite } from '../../server/sqlite.mjs';

const BATCH = 100;
const ifMissing = (sql) => sql.replace(/^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/i, (m, unique = '', kind) => `CREATE ${unique}${kind} IF NOT EXISTS `);
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function digest(db, table, columns) {
  const hash = crypto.createHash('sha256');
  for (const row of db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY rowid`).all()) {
    hash.update(JSON.stringify(columns.map((c) => (row[c] instanceof Uint8Array ? Buffer.from(row[c]).toString('base64') : row[c]))));
  }
  return hash.digest('hex');
}

function copy(localFile, remoteUrl) {
  const src = new DatabaseSync(localFile, { readOnly: true });
  const dst = openSqlite(remoteUrl);
  try {
    const objects = src.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC, rowid").all();
    const tables = objects.filter((o) => o.type === 'table').map((o) => o.name);
    for (const o of objects) dst.exec(ifMissing(o.sql));
    for (const table of tables) {
      const existing = dst.prepare(`SELECT count(*) n FROM ${quote(table)}`).get().n;
      if (existing) throw new Error(`${remoteUrl} ${table}: etäkannassa on jo ${existing} riviä, siirto keskeytetty.`);
    }
    const report = [];
    dst.exec('BEGIN IMMEDIATE');
    try {
      for (const table of tables) {
        const columns = src.prepare(`PRAGMA table_info(${quote(table)})`).all().map((c) => c.name);
        const rows = src.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY rowid`).all();
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const values = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
          dst.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES ${values}`).run(...chunk.flatMap((r) => columns.map((c) => r[c])));
        }
        report.push({ table, columns, rows: rows.length });
      }
      dst.exec('COMMIT');
    } catch (err) { dst.exec('ROLLBACK'); throw err; }
    for (const r of report) {
      const remoteRows = dst.prepare(`SELECT count(*) n FROM ${quote(r.table)}`).get().n;
      if (remoteRows !== r.rows || digest(src, r.table, r.columns) !== digest(dst, r.table, r.columns))
        throw new Error(`${r.table}: etäkannan sisältö ei täsmää paikalliseen.`);
    }
    return report.map(({ table, rows }) => ({ table, rows }));
  } finally { src.close(); dst.close(); }
}

const pairs = process.argv.slice(2).map((arg) => arg.split('='));
if (!pairs.length || pairs.some((p) => p.length !== 2 || !/^libsql:\/\//.test(p[1]) && !/^file:/.test(p[1]))) {
  console.error('Käyttö: TURSO_AUTH_TOKEN=… node deploy/vercel/migrate.mjs paikallinen.db=libsql://kanta.turso.io [...]');
  process.exit(1);
}
for (const [local, remote] of pairs) {
  const result = copy(local, remote);
  const label = remote.startsWith('file:') ? remote.split('/').pop() : new URL(remote).hostname.split('.')[0];
  console.log(`${label}: ${result.map((r) => `${r.table} ${r.rows}`).join(', ')} (täsmää)`);
}
