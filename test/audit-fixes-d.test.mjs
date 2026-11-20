// Katselmus 15.11. ilta, sessio D: #12 (yksi hidas asiakas pysäytti kaikki) ja #14 (ilmoittautuminen ei todistanut
// numeron omistusta). Oikeat store- ja kanavamoduulit, väliaikaiset kannat, simuloitu Meta-lähetys ja simuloitu malli.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openWhatsAppStore, codeHash, PROCESSING_LEASE_MS } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel, workerCount } from '../server/whatsapp/channel.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-audit-d-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const settings = { phoneId: '1', verifyToken: 'v', appSecret: 's', supportContact: 'Testin tuki', orderingDemo: true };
const A = '358401000001'; const B = '358401000002'; const C = '358401000003';

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function member(store, phone, person = 'Testaaja') {
  const invitation = store.invite(phone, 'Testikeittiö', person);
  return store.pair(phone, codeHash(invitation.code));
}
const message = (id, phone, text) => ({ id, phone, text, sentAt: Date.now() });
// A model call that waits until the test releases it, per message id.
function gatedChat() {
  const gates = new Map(); const started = [];
  const gate = (id) => { if (!gates.has(id)) gates.set(id, deferred()); return gates.get(id); };
  return { started, release: (id) => gate(id).resolve(), chat: async ({ messageId, messages }) => {
    started.push(messageId); await gate(messageId).promise; return { text: `vastaus: ${messages.at(-1).content}` };
  } };
}
const sender = () => { const sent = []; return { sent, send: async (to, text, id) => { sent.push({ to, text, id }); return `out-${sent.length}`; } }; };
const until = async (check, ms = 2000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('aikakatkaisu'); await new Promise((r) => setTimeout(r, 5)); } };

test('#12: a slow customer no longer stops another customer', async () => {
  const store = openWhatsAppStore(':memory:');
  try {
    member(store, A); member(store, B);
    const model = gatedChat(); const out = sender();
    const channel = createWhatsAppChannel({ settings, store, chat: model.chat, send: out.send, concurrency: 4 });
    store.enqueue(message('a1', A, 'hidas')); store.enqueue(message('b1', B, 'nopea'));
    const slow = channel.processNext(); const fast = channel.processNext();
    model.release('b1');
    assert.equal(await fast, true);
    assert.deepEqual(out.sent.map((s) => s.id), ['b1']);
    assert.deepEqual(model.started, ['a1', 'b1']);
    model.release('a1');
    assert.equal(await slow, true);
    assert.deepEqual(out.sent.map((s) => s.id), ['b1', 'a1']);
  } finally { store.close(); }
});

test('#12: the same customer is still answered strictly in order, and the pool size is respected', async () => {
  const store = openWhatsAppStore(':memory:');
  try {
    for (const phone of [A, B, C]) member(store, phone);
    const model = gatedChat(); const out = sender();
    const channel = createWhatsAppChannel({ settings, store, chat: model.chat, send: out.send, concurrency: 2 });
    store.enqueue(message('a1', A, 'eka')); store.enqueue(message('a2', A, 'toka'));
    store.enqueue(message('b1', B, 'b')); store.enqueue(message('c1', C, 'c'));
    const first = channel.processNext(); const second = channel.processNext();
    // a2 waits for a1; two slots are taken, so c1 waits too.
    assert.deepEqual(model.started, ['a1', 'b1']);
    assert.equal(await channel.processNext(), false);
    model.release('a1'); await first;
    const third = channel.processNext();
    assert.deepEqual(model.started, ['a1', 'b1', 'a2']);
    model.release('a2'); model.release('b1'); model.release('c1');
    await Promise.all([second, third]);
    while (await channel.processNext());
    assert.deepEqual(out.sent.filter((s) => s.to === A).map((s) => s.id), ['a1', 'a2']);
    assert.equal(store.db.prepare("SELECT count(*) n FROM inbox WHERE state='done'").get().n, 4);
    assert.equal(workerCount({ WHATSAPP_CONCURRENCY: '2' }), 2);
    assert.equal(workerCount({ WHATSAPP_CONCURRENCY: '99' }), 16);
    assert.equal(workerCount({}), 4);
  } finally { store.close(); }
});

test('#12: the running pool answers others while one turn is slow, and keeps "typing" alive for both', async () => {
  const store = openWhatsAppStore(':memory:');
  try {
    member(store, A); member(store, B); member(store, C);
    const model = gatedChat(); const out = sender(); const typed = [];
    const channel = createWhatsAppChannel({ settings, store, chat: model.chat, send: out.send, concurrency: 1, typingRefreshMs: 20,
      typing: async (id) => { typed.push(id); } });
    store.enqueue(message('a1', A, 'hidas'));
    channel.start();
    await until(() => model.started.includes('a1'));
    // The pool is full: b1 waits, and its sender still sees "typing" while it waits.
    store.enqueue(message('b1', B, 'odottaa'));
    await until(() => typed.filter((id) => id === 'a1').length >= 3);
    await until(() => typed.includes('b1'), 3000);
    assert.equal(model.started.includes('b1'), false);
    model.release('a1'); model.release('b1');
    await until(() => out.sent.length === 2);
    // A finished job wakes the pool at once: no 500 ms timer wait between customers.
    store.enqueue(message('c1', C, 'c')); model.release('c1');
    await until(() => out.sent.length === 3, 1000);
    await channel.stop();
    assert.deepEqual(out.sent.map((s) => s.id), ['a1', 'b1', 'c1']);
  } finally { store.close(); }
});

test('#12: a restart in the middle of a turn finishes it once and keeps the order', async () => {
  const file = path.join(dir, 'restart.db');
  const before = openWhatsAppStore(file);
  member(before, A); member(before, B);
  const stuck = gatedChat();
  const crashed = createWhatsAppChannel({ settings, store: before, chat: stuck.chat, send: async () => { throw new Error('ei saa lähettää'); } });
  before.enqueue(message('a1', A, 'eka')); before.enqueue(message('a2', A, 'toka')); before.enqueue(message('b1', B, 'b'));
  void crashed.processNext(); void crashed.processNext();
  assert.deepEqual(stuck.started, ['a1', 'b1']);
  // The process dies here: a1 and b1 stay "processing" in the database.
  const after = openWhatsAppStore(file);
  try {
    after.recover();
    const out = sender();
    const restarted = createWhatsAppChannel({ settings, store: after, chat: async ({ messageId }) => ({ text: `uusi ${messageId}` }), send: out.send });
    while (await restarted.processNext());
    // Oldest first, and a2 only after a1: each interrupted turn is answered exactly once.
    assert.deepEqual(out.sent.map((s) => s.id), ['a1', 'a2', 'b1']);
    assert.deepEqual(after.db.prepare('SELECT id, state, attempts FROM inbox ORDER BY rowid').all().map((r) => [r.id, r.state, r.attempts]),
      [['a1', 'done', 2], ['a2', 'done', 1], ['b1', 'done', 2]]);
  } finally { after.close(); before.close(); }
});

test('#12: on a libsql (Turso) database two instances never take the same job or the same number together', async () => {
  let clock = Date.now();
  const url = `file:${path.join(dir, 'turso.db')}`;
  const one = openWhatsAppStore(url, () => clock); const two = openWhatsAppStore(url, () => clock);
  try {
    member(one, A); member(one, B);
    one.enqueue(message('a1', A, 'eka')); one.enqueue(message('a2', A, 'toka')); one.enqueue(message('b1', B, 'b'));
    assert.equal(one.next().id, 'a1');
    // The other instance gets the other customer, not a1 again and not a2 before a1 is done.
    assert.equal(two.next().id, 'b1');
    assert.equal(two.next(), null);
    // A crashed instance's job comes back only after its lease.
    assert.equal(two.recoverStale(), 0);
    clock += PROCESSING_LEASE_MS + 1;
    assert.equal(two.recoverStale(), 2);
    assert.equal(two.next().id, 'a1');
    two.finish('a1', 'done');
    assert.equal(one.next().id, 'a2');
    assert.equal(two.next().id, 'b1');

    // The same parallel pool works on libsql: two customers in flight at once.
    const model = gatedChat(); const out = sender();
    const channel = createWhatsAppChannel({ settings, store: two, chat: model.chat, send: out.send, now: () => clock });
    two.finish('a2', 'done'); two.finish('b1', 'done');
    two.enqueue(message('a3', A, 'x')); two.enqueue(message('b2', B, 'y'));
    const drained = channel.drain(5000);
    await until(() => model.started.length === 2);
    model.release('a3'); model.release('b2');
    assert.equal(await drained, 2);
    assert.deepEqual(out.sent.map((s) => s.id).sort(), ['a3', 'b2']);
  } finally { one.close(); two.close(); }
});

test('#14 ja ilmoittautumisen poisto: ylläpitäjän koodi yhdistää vain oman numeron, landing-koodi on tavallinen viesti', async () => {
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const store = openWhatsAppStore(':memory:', () => clock);
  try {
    const out = sender();
    const channel = createWhatsAppChannel({ settings, store, now: () => clock, send: out.send,
      chat: async () => { throw new Error('malli ei saa käynnistyä ilman jäsenyyttä'); } });
    // Ylläpitäjän kutsu numerolle A: toisen numeron viesti samalla koodilla ei yhdistä.
    const { code } = store.invite(A, 'Ravintola A', 'Omistaja');
    store.enqueue(message('x1', C, `YHDISTA ${code}`));
    assert.equal(await channel.processNext(), true);
    assert.match(out.sent.at(-1).text, /Yhdistämiskoodi on virheellinen/);
    assert.equal(store.member(C), undefined);
    store.enqueue(message('a1', A, `YHDISTA ${code}`));
    assert.equal(await channel.processNext(), true);
    assert.match(out.sent.at(-1).text, /Testiyhteys yhdistetty: Omistaja, Ravintola A/);
    assert.equal(store.memberSource(store.member(A).binding), 'admin');

    // Etusivun vanha viestimuoto ei ole enää ilmoittautuminen: tavallinen viesti, jäsenyyttä ei synny.
    store.enqueue(message('s1', B, 'Moi! Opeta mua tilaamaan tämän kautta.\nYHDISTA K7Q2-9XPA'));
    assert.equal(store.db.prepare("SELECT kind FROM inbox WHERE id='s1'").get().kind, 'text');
    assert.equal(await channel.processNext(), true);
    assert.match(out.sent.at(-1).text, /Numeroasi ei ole yhdistetty/);
    assert.equal(store.member(B), undefined);

    // Ennen poistoa jonoon jäänyt ilmoittautumisviesti ohitetaan vastaamatta.
    const sent = out.sent.length;
    store.db.prepare("INSERT INTO inbox(id,phone,text,kind,binding,received,sent_at) VALUES('old',?,'hash','signup',NULL,?,?)").run(B, clock, clock);
    assert.equal(await channel.processNext(), true);
    assert.equal(store.db.prepare("SELECT state FROM inbox WHERE id='old'").get().state, 'cancelled');
    assert.equal(out.sent.length, sent);

    // Kuva tai ääniviesti ei ole koskaan koodi.
    store.enqueue({ id: 'm1', phone: B, sentAt: Date.now(), kind: 'image', text: 'YHDISTA ABCD-EFGH' });
    assert.equal(store.db.prepare("SELECT kind FROM inbox WHERE id='m1'").get().kind, 'image');
  } finally { store.close(); }
});
