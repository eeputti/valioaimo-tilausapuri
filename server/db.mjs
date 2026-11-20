// Persistent API cache used by product lookup. AIMO_DB keeps its existing configuration name.
import { openSqlite } from './sqlite.mjs';
import path from 'node:path';
import { ROOT } from './catalog.mjs';

const db = openSqlite(process.env.AIMO_DB || path.join(ROOT, 'data', 'aimo.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS api_cache (key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, json TEXT NOT NULL);
`);
const get = db.prepare('SELECT value FROM kv WHERE key = ?');
const set = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
export const kv = {
  get(key, fallback = null) { const row = get.get(key); return row ? JSON.parse(row.value) : fallback; },
  set(key, value) { set.run(key, JSON.stringify(value)); },
};
const cacheGet = db.prepare('SELECT fetched_at, json FROM api_cache WHERE key = ?');
const cacheSet = db.prepare('INSERT INTO api_cache (key, fetched_at, json) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json');
// Avaimet ovat muotoa <tila>:<laji>:<päivä>:<tuote>, esim. live:price:2026-11-16:464201. Tuotetunnus on numeerinen.
const cacheLatest = db.prepare('SELECT key, fetched_at, json FROM api_cache WHERE key LIKE ? ORDER BY fetched_at DESC LIMIT 1');
const cacheAll = db.prepare('SELECT key, fetched_at, json FROM api_cache WHERE key LIKE ?');
export const apiCache = {
  get(key) { const row = cacheGet.get(key); return row ? { fetchedAt: row.fetched_at, value: JSON.parse(row.json) } : null; },
  /**
   * Usean avaimen rivit yhdellä kyselyllä (500 avainta kyselyä kohden): Map(key -> {fetchedAt, value}). Pilvessä (Turso) jokainen
   * kysely on oma verkkokierroksensa, joten hinnat ja saatavuudet luetaan näin tuotteittaisten kyselyjen sijaan. Rikkinäinen rivi ohitetaan.
   */
  getMany(keys) {
    const out = new Map(); const list = [...new Set(keys)];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      for (const row of db.prepare(`SELECT key, fetched_at, json FROM api_cache WHERE key IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) {
        try { out.set(row.key, { fetchedAt: row.fetched_at, value: JSON.parse(row.json) }); } catch { /* rikkinäinen rivi ohitetaan */ }
      }
    }
    return out;
  },
  set(key, value) { cacheSet.run(key, Date.now(), JSON.stringify(value)); },
  /** Tuotteen uusin tallennettu arvo mille tahansa päivälle, esim. latest('live:price', '464201'). */
  latest(prefix, id) {
    if (!/^\d{1,20}$/.test(String(id))) return null;
    const row = cacheLatest.get(`${prefix}:%:${id}`);
    return row ? { key: row.key, fetchedAt: row.fetched_at, value: JSON.parse(row.json) } : null;
  },
  /** Jokaisen tuotteen uusin arvo yhdellä kyselyllä: Map(tuote -> {key, fetchedAt, value}). Pilvessä yksi kantakutsu. */
  latestAll(prefix) {
    const out = new Map();
    for (const row of cacheAll.all(`${prefix}:%`)) {
      const id = row.key.split(':').at(-1);
      if (!/^\d{1,20}$/.test(id) || (out.get(id)?.fetchedAt ?? -1) > row.fetched_at) continue;
      try { out.set(id, { key: row.key, fetchedAt: row.fetched_at, value: JSON.parse(row.json) }); } catch { /* rikkinäinen rivi ohitetaan */ }
    }
    return out;
  },
};
export function wipeApiCache() { db.exec('DELETE FROM api_cache;'); }
