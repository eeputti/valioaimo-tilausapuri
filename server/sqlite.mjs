// Yksi tapa avata SQLite-kanta. Tavallinen tiedostopolku (tai :memory:) avautuu node:sqlite-kannaksi kuten ennen.
// libsql://-, https://- tai file:-osoite avautuu Turso-kannaksi samalla synkronisella rajapinnalla
// (prepare → get/all/run/iterate, exec, close), jotta palvelin voi ajaa pilvessä ilman paikallista levyä.
//
// Synkronisuus: kutsut tehdään taustasäikeessä (@libsql/client), ja pääsäie odottaa vastausta
// Atomics.wait-kutsulla. Pääsäie on kutsun ajan pysähdyksissä kuten node:sqlite-kannassakin, joten
// BEGIN … COMMIT -välin koodi ei lomitu muun työn kanssa. Transaktiot ovat Turson kirjoitustransaktioita.
import { DatabaseSync } from 'node:sqlite';
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';

export const isRemoteDatabase = (filename) => /^(libsql|https?|wss?|file):/i.test(String(filename || ''));

export function openSqlite(filename, options) {
  if (isRemoteDatabase(filename)) return new RemoteDatabase(String(filename));
  return options ? new DatabaseSync(filename, options) : new DatabaseSync(filename);
}

const TIMEOUT_MS = Number(process.env.AIMO_SQLITE_TIMEOUT_MS) || 30_000;
let bridge;

function startBridge() {
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL('./sqlite-remote-worker.mjs', import.meta.url), {
    workerData: { port: port2, signal: signal.buffer, authToken: process.env.TURSO_AUTH_TOKEN || '' },
    transferList: [port2],
  });
  worker.unref();
  worker.on('error', (err) => { console.error('[sqlite] Turso-säie pysähtyi:', err.message); bridge = null; });
  return { port: port1, signal, worker };
}

function call(message) {
  bridge ||= startBridge();
  const { port, signal } = bridge;
  Atomics.store(signal, 0, 0);
  port.postMessage(message);
  if (Atomics.wait(signal, 0, 0, TIMEOUT_MS) === 'timed-out') {
    bridge.worker.terminate();
    bridge = null;
    throw Object.assign(new Error('Tietokantakutsu aikakatkaistiin.'), { code: 'SQLITE_TIMEOUT' });
  }
  const reply = receiveMessageOnPort(port)?.message;
  if (!reply) throw new Error('Tietokantakutsun vastaus puuttuu.');
  if (!reply.ok) throw Object.assign(new Error(reply.message), { code: reply.code });
  return reply.value;
}

class RemoteStatement {
  #db; #sql;
  constructor(db, sql) { this.#db = db; this.#sql = sql; }
  get(...args) { return this.#db.query(this.#sql, args, 'get'); }
  all(...args) { return this.#db.query(this.#sql, args, 'all'); }
  run(...args) { return this.#db.query(this.#sql, args, 'run'); }
  iterate(...args) { return this.all(...args)[Symbol.iterator](); }
}

class RemoteDatabase {
  #id;
  constructor(url) { this.#id = call({ op: 'open', url }); }
  prepare(sql) { return new RemoteStatement(this, sql); }
  exec(sql) { call({ op: 'exec', id: this.#id, sql }); }
  query(sql, args, mode) { return call({ op: 'query', id: this.#id, sql, args, mode }); }
  close() { if (this.#id != null) call({ op: 'close', id: this.#id }); this.#id = null; }
}
