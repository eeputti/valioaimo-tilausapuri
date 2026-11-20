// Tilausluonnosten pysyvä tallennus (TYONJAKO.md, henkilö 2). Oma kanta: ei WhatsApp-jonon eikä demotilausten tauluja.
// Luonnos ja viestin tulos tallennetaan samassa transaktiossa, joten sama webhook-viesti ei muuta luonnosta kahdesti.
import { openSqlite, isRemoteDatabase } from '../sqlite.mjs';
import fs from 'node:fs';
import path from 'node:path';

export function openDraftStore(filename = ':memory:', now = Date.now) {
  const local = filename !== ':memory:' && !isRemoteDatabase(filename);
  if (local) fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = openSqlite(filename);
  if (local) fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, state TEXT NOT NULL, json TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS drafts_active ON drafts(conversation, state);
    CREATE TABLE IF NOT EXISTS turn_results (message_id TEXT PRIMARY KEY, conversation TEXT NOT NULL, json TEXT NOT NULL, created INTEGER NOT NULL);`);
  return {
    close: () => db.close(),
    /** Keskustelun avoin luonnos tai null. */
    active(conversation) {
      const row = db.prepare("SELECT json FROM drafts WHERE conversation=? AND state='active' ORDER BY updated DESC LIMIT 1").get(conversation);
      return row ? JSON.parse(row.json) : null;
    },
    /** Viimeisin tästä keskustelusta tilattu luonnos, jotta toistuva TILAA ei näytä tyhjää luonnosta. */
    lastOrdered(conversation) {
      const row = db.prepare("SELECT json FROM drafts WHERE conversation=? AND state='ordered' ORDER BY updated DESC LIMIT 1").get(conversation);
      return row ? JSON.parse(row.json) : null;
    },
    get(id) { const row = db.prepare('SELECT json FROM drafts WHERE id=?').get(id); return row ? JSON.parse(row.json) : null; },
    result(messageId) { const row = db.prepare('SELECT json FROM turn_results WHERE message_id=?').get(messageId); return row ? JSON.parse(row.json) : null; },
    /** state: active | ordered | cancelled */
    save(conversation, draft, messageId, result) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (draft) db.prepare('INSERT INTO drafts(id,conversation,state,json,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,json=excluded.json,updated=excluded.updated')
          .run(draft.id, conversation, draft.state || 'active', JSON.stringify(draft), now());
        db.prepare('INSERT OR REPLACE INTO turn_results(message_id,conversation,json,created) VALUES(?,?,?,?)').run(messageId, conversation, JSON.stringify(result), now());
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    },
    /** Rajattu säilytys: viestitulokset 7 päivää, kesken jääneet luonnokset 7 päivää, suljetut 30 päivää. */
    prune() {
      db.prepare('DELETE FROM turn_results WHERE created<?').run(now() - 7 * 86400_000);
      db.prepare("DELETE FROM drafts WHERE (state='active' AND updated<?) OR (state<>'active' AND updated<?)").run(now() - 7 * 86400_000, now() - 30 * 86400_000);
    },
  };
}
