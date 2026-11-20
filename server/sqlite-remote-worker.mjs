// Turso-kutsujen taustasäie server/sqlite.mjs:lle. Vastaa jokaiseen pyyntöön täsmälleen kerran ja herättää pääsäikeen.
import { workerData } from 'node:worker_threads';

const { port, authToken } = workerData;
const signal = new Int32Array(workerData.signal);
const clients = new Map();
const transactions = new Map();
let nextId = 1;

// node:sqlite-kannan asetuksia, joilla ei ole merkitystä Turson etäkannassa.
const LOCAL_PRAGMA = /\bPRAGMA\s+(journal_mode|busy_timeout|synchronous|wal_autocheckpoint)\b[^;]*;?/gi;
const TX_BEGIN = /^\s*BEGIN(\s+(IMMEDIATE|DEFERRED|EXCLUSIVE))?(\s+TRANSACTION)?\s*;?\s*$/i;
const TX_COMMIT = /^\s*(COMMIT|END)(\s+TRANSACTION)?\s*;?\s*$/i;
const TX_ROLLBACK = /^\s*ROLLBACK(\s+TRANSACTION)?\s*;?\s*$/i;

async function connect(url) {
  // Etäkannalle verkkoasiakas (ei natiivikirjastoa), paikalliselle file:-osoitteelle Node-asiakas.
  const { createClient } = url.startsWith('file:') ? await import('@libsql/client') : await import('@libsql/client/web');
  return createClient({ url, authToken: url.startsWith('file:') ? undefined : authToken || undefined, intMode: 'number' });
}

const plain = (value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value);
function rows(result) {
  return result.rows.map((row) => {
    const object = {};
    result.columns.forEach((column, i) => { object[column] = plain(row[i]); });
    return object;
  });
}

async function handle({ op, id, url, sql, args, mode }) {
  if (op === 'open') {
    const handle = nextId++;
    clients.set(handle, await connect(url));
    return handle;
  }
  const client = clients.get(id);
  if (!client) throw new Error('Tietokantayhteys on suljettu.');
  if (op === 'close') {
    await transactions.get(id)?.rollback().catch(() => {});
    transactions.delete(id);
    client.close();
    clients.delete(id);
    return null;
  }
  const tx = transactions.get(id);
  if (op === 'exec') {
    const script = sql.replace(LOCAL_PRAGMA, '').trim();
    const begin = TX_BEGIN.exec(script);
    if (begin) {
      if (tx) throw Object.assign(new Error('cannot start a transaction within a transaction'), { code: 'SQLITE_ERROR' });
      // BEGIN IMMEDIATE/EXCLUSIVE varaa kirjoituksen heti, pelkkä BEGIN vasta tarvittaessa kuten SQLitessä.
      transactions.set(id, await client.transaction(begin[2] && !/DEFERRED/i.test(begin[2]) ? 'write' : 'deferred'));
      return null;
    }
    if (TX_COMMIT.test(script) || TX_ROLLBACK.test(script)) {
      if (!tx) throw Object.assign(new Error('cannot commit - no transaction is active'), { code: 'SQLITE_ERROR' });
      transactions.delete(id);
      if (TX_COMMIT.test(script)) await tx.commit(); else await tx.rollback();
      return null;
    }
    if (script) await (tx || client).executeMultiple(script);
    return null;
  }
  if (op === 'query') {
    const result = await (tx || client).execute({ sql, args: (args || []).map((v) => (v === undefined ? null : v)) });
    if (mode === 'run') return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    const list = rows(result);
    return mode === 'get' ? list[0] : list;
  }
  throw new Error(`Tuntematon tietokantapyyntö: ${op}`);
}

port.on('message', async (message) => {
  let reply;
  try { reply = { ok: true, value: await handle(message) }; }
  catch (err) { reply = { ok: false, message: err.message, code: err.code || err.rawCode || 'SQLITE_ERROR' }; }
  port.postMessage(reply);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
