// server/sqlite.mjs: sama synkroninen rajapinta node:sqlite-kannalle ja Turso-yhteydelle (tässä libsql:n file:-osoite,
// joka kulkee saman taustasäikeen ja @libsql/clientin kautta kuin pilven libsql://-osoite).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSqlite, isRemoteDatabase } from '../server/sqlite.mjs';
import { openWhatsAppStore, PROCESSING_LEASE_MS } from '../server/whatsapp/store.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-sqlite-remote-'));
const url = (name) => `file:${path.join(dir, name)}`;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('osoite valitsee etäkannan, tiedostopolku ja :memory: pysyvät node:sqlite-kantoina', () => {
  assert.equal(isRemoteDatabase('libsql://aimo-whatsapp.turso.io'), true);
  assert.equal(isRemoteDatabase('file:/tmp/x.db'), true);
  assert.equal(isRemoteDatabase('/Users/x/data/whatsapp.db'), false);
  assert.equal(isRemoteDatabase(':memory:'), false);
  assert.equal(openSqlite(':memory:').constructor.name, 'DatabaseSync');
});

test('prepare/get/all/run/iterate, exec ja transaktiot toimivat kuten node:sqlite', () => {
  const db = openSqlite(url('basic.db'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, n INTEGER)');
  const insert = db.prepare('INSERT INTO t(name,n) VALUES(?,?)');
  assert.deepEqual(insert.run('a', 1), { changes: 1, lastInsertRowid: 1 });
  insert.run('b', 2);
  assert.deepEqual(db.prepare('SELECT name,n FROM t WHERE id=?').get(2), { name: 'b', n: 2 });
  assert.equal(db.prepare('SELECT * FROM t WHERE id=?').get(99), undefined);
  assert.deepEqual(db.prepare('SELECT name FROM t ORDER BY id').all().map((r) => r.name), ['a', 'b']);
  assert.deepEqual([...db.prepare('SELECT n FROM t ORDER BY id').iterate()].map((r) => r.n), [1, 2]);

  db.exec('BEGIN IMMEDIATE');
  insert.run('c', 3);
  db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT count(*) n FROM t').get().n, 2);
  db.exec('PRAGMA busy_timeout=3000; BEGIN');
  insert.run('d', 4);
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT count(*) n FROM t').get().n, 3);

  assert.throws(() => db.prepare('INSERT INTO t(id,name) VALUES(1,?)').run('dup'), /UNIQUE|constraint/i);
  assert.throws(() => db.exec('COMMIT'), /no transaction/);
  db.close();
  // Toinen yhteys näkee samat tiedot (pilvessä toinen prosessi).
  const again = openSqlite(url('basic.db'));
  assert.equal(again.prepare('SELECT count(*) n FROM t').get().n, 3);
  again.close();
});

test('WhatsApp-jono etäkannassa: atominen varaus, järjestys ja keskeytyneen käsittelyn palautus', () => {
  let clock = 1_000_000;
  const now = () => clock;
  const a = openWhatsAppStore(url('whatsapp.db'), now);
  const b = openWhatsAppStore(url('whatsapp.db'), now);
  const invitation = a.invite('+358401111111', 'Ravintola A', 'Anna');
  assert.ok(invitation.code);
  for (const id of ['m1', 'm2']) assert.equal(a.enqueue({ id, phone: '358401111111', text: `viesti ${id}`, sentAt: clock }), true);
  assert.equal(a.enqueue({ id: 'm1', phone: '358401111111', text: 'uusinta', sentAt: clock }), false);

  const first = a.next();
  assert.equal(first.id, 'm1');
  // Toinen prosessi ei saa samaa viestiä eikä saman numeron seuraavaa ennen kuin ensimmäinen on valmis.
  assert.equal(b.next(), null);
  a.saveReply(first, 'vastaus 1', null);
  a.finish(first.id, 'done', 'wamid.1');
  const second = b.next();
  assert.equal(second.id, 'm2');

  // Käsittely keskeytyy (pilvikutsu aikakatkaistaan): vasta aikarajan jälkeen viesti palaa jonoon.
  assert.equal(a.recoverStale(), 0);
  clock += PROCESSING_LEASE_MS + 1;
  assert.equal(a.recoverStale(), 1);
  const retried = a.next();
  assert.equal(retried.id, 'm2');
  assert.equal(retried.attempts, 2);
  a.close(); b.close();
});

test('tilausluonnoksen transaktio etäkannassa', () => {
  const store = openDraftStore(url('drafts.db'));
  assert.ok(store);
  const remote = openSqlite(url('drafts.db'));
  const tables = remote.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  assert.ok(tables.includes('drafts') && tables.includes('turn_results'));
  remote.close();
});
