import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker from '../src/index.ts';
import { pushOrderEvents } from '../publish-orders.mjs';

const token = 'test-only-' + 'b'.repeat(48);
const order = (id = 'AGW-20261114-0001', status = 'confirmed') => ({ orderId: id, channel: 'whatsapp', status, createdAt: '2026-11-14T12:00:00.000Z',
  deliveryDate: '2026-11-16', net: 74.1, lineCount: 1, lines: [{ productId: '1234', name: 'Laktoositon maito <b>', quantity: 20, unit: 'l', net: 74.1 }] });
const snapshot = (orders) => ({ version: 1, observedAt: Date.now(), totalOrders: orders.length, ledgerHead: '0'.repeat(64), orders });
const event = (o = order()) => ({ version: 1, observedAt: Date.now(), ledgerHead: '0'.repeat(64), order: o });
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return { db, prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { await null; const result = db.prepare(sql).run(...args); return { meta: { changes: result.changes } }; } }; } };
}
const post = (env, body, auth = token) => worker.fetch(new Request('https://demo.example/api/order-events', { method: 'POST',
  headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
const row = (env, id = 'AGW-20261114-0001') => env.DB.db.prepare('SELECT * FROM order_events WHERE order_id=?').get(id);

test('a confirmed order is stored once, also for concurrent retries', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token };
  try {
    const [a, b] = await Promise.all([post(env, event()), post(env, event())]);
    const results = [await a.json(), await b.json()];
    assert.deepEqual(results.map(r => r.duplicate).sort(), [false, true]);
    assert.equal((await (await post(env, event())).json()).duplicate, true);
    assert.equal(env.DB.db.prepare('SELECT count(*) n FROM order_events').get().n, 1);
    assert.deepEqual(Object.keys(row(env)).sort(), ['json', 'order_id', 'received_at']);
    // Older bots also sent an e-mail recipient: it is ignored and never stored.
    await post(env, { ...event(order('AGW-20261114-0002')), email: { to: 'testi@example.com', customerName: 'Kulma' } });
    assert.doesNotMatch(row(env, 'AGW-20261114-0002').json, /testi@example|Kulma/);
  } finally { env.DB.db.close(); }
});

test('only authenticated, confirmed and valid order events are accepted', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token };
  try {
    assert.equal((await post(env, event(), 'wrong')).status, 401);
    assert.equal((await post(env, event(order(undefined, 'pending_approval')))).status, 400);
    assert.equal((await post(env, { ...event(), observedAt: Date.now() - 400000 })).status, 400);
    assert.equal(env.DB.db.prepare('SELECT count(*) n FROM order_events').get().n, 0);
  } finally { env.DB.db.close(); }
});

test('the publisher pushes each newly confirmed order once', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token };
  const fetcher = (url, init) => worker.fetch(new Request(url, init), env);
  try {
    const known = new Set(['AGW-20261114-0001']); // baseline: confirmed before the publisher started
    const snap = snapshot([order('AGW-20261114-0001'), order('AGW-20261114-0002'), order('AGW-20261114-0003', 'pending_approval')]);
    const first = await pushOrderEvents({ url: 'https://demo.example', token, snapshot: snap, known, fetcher });
    assert.deepEqual(first.map(r => [r.orderId, r.duplicate]), [['AGW-20261114-0002', false]]);
    assert.equal((await pushOrderEvents({ url: 'https://demo.example', token, snapshot: snap, known, fetcher })).length, 0);
    assert.equal(row(env, 'AGW-20261114-0001'), undefined);
    await assert.rejects(pushOrderEvents({ url: 'http://demo.example', token, snapshot: snap, known: new Set() }), /HTTPS/);
  } finally { env.DB.db.close(); }
});
