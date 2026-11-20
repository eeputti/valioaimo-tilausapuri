import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { registerDemoPayment, describeDemoPayment, handleDemoPayment } from '../src/demo-payment.ts';

const id = 'AGW-20261114-0001';
const origin = 'https://demo.example';
const now = Date.parse('2026-11-14T12:00:00Z');
const order = { orderId: id, channel: 'whatsapp', status: 'confirmed', createdAt: new Date(now).toISOString(), deliveryDate: '2026-11-18', net: 74.1, lineCount: 1,
  lines: [{ productId: '1234', name: 'Maito <script>', quantity: 20, unit: 'l', net: 74.1 }] };
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) || null; },
    async run() { await null; return { meta: { changes: db.prepare(sql).run(...values).changes } }; } }; } };
  db.prepare('INSERT INTO order_events VALUES(?,?,?)').run(id, now, JSON.stringify({ order }));
  const env = { DB, SYNC_TOKEN: 'test-only-' + 'k'.repeat(48), DEMO_PAYMENTS_ENABLED: 'true' };
  const paid = [];
  const onPaid = orderId => { assert.equal(orderId, id); paid.push(orderId); };
  const request = (capability, action, options = {}) => new Request(`${origin}/api/demo-payments/${id}`, {
    method: action === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${capability}`, ...(action === undefined ? {} : { origin, 'content-type': 'application/json' }), ...options.headers },
    ...(action === undefined ? {} : { body: JSON.stringify(action) }),
  });
  const token = async () => (await describeDemoPayment(env, id, origin)).url.split('.').at(-1);
  return { db, env, onPaid, request, token, paid };
}

test('a stored demo order waits for payment; cancelling does nothing; retried successes keep the first paid time', async () => {
  const s = setup();
  try {
    const [first, again] = await Promise.all([registerDemoPayment(s.env, id, now), registerDemoPayment(s.env, id, now + 10)]);
    assert.equal(first.created_at, again.created_at);
    assert.equal(first.amount_net_cents, 7410);
    const token = await s.token();
    const view = await (await handleDemoPayment(s.request(token), s.env, now, s.onPaid)).json();
    assert.equal(view.order.deliveryDate, '2026-11-18');
    assert.equal(view.payment.status, 'pending');
    const cancelled = await (await handleDemoPayment(s.request(token, { simulate: 'cancel' }), s.env, now + 100, s.onPaid)).json();
    assert.equal(cancelled.status, 'pending'); assert.equal(s.paid.length, 0);
    const results = await Promise.all([101, 102, 103].map(t => handleDemoPayment(s.request(token, { simulate: 'success' }), s.env, now + t, s.onPaid)));
    for (const result of results) assert.equal((await result.json()).status, 'paid');
    const paidAt = s.db.prepare('SELECT paid_at FROM demo_payments').get().paid_at;
    await handleDemoPayment(s.request(token, { simulate: 'success' }), s.env, now + 1000, s.onPaid);
    assert.equal(s.db.prepare('SELECT paid_at FROM demo_payments').get().paid_at, paidAt);
  } finally { s.db.close(); }
});

test('capabilities are order-specific; forged, expired, cross-origin and amount-changing requests cannot pay', async () => {
  const s = setup();
  try {
    await registerDemoPayment(s.env, id, now);
    const token = await s.token();
    const forged = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    assert.equal((await handleDemoPayment(s.request(forged, { simulate: 'success' }), s.env, now, s.onPaid)).status, 404);
    assert.equal((await handleDemoPayment(s.request(token, { simulate: 'success' }, { headers: { origin: 'https://other.example' } }), s.env, now, s.onPaid)).status, 403);
    assert.equal((await handleDemoPayment(s.request(token, { simulate: 'success', amount: 0 }), s.env, now, s.onPaid)).status, 400);
    assert.equal((await handleDemoPayment(s.request(token, { simulate: 'success' }, { headers: { 'content-type': 'text/plain' } }), s.env, now, s.onPaid)).status, 400);
    assert.equal((await handleDemoPayment(s.request(token, { simulate: 'success' }), s.env, now + 86400_000, s.onPaid)).status, 410);
    const other = new Request(`${origin}/api/demo-payments/AGW-20261114-0002`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await handleDemoPayment(other, s.env, now, s.onPaid)).status, 404);
    assert.equal(s.paid.length, 0);
    assert.equal(s.db.prepare('SELECT status FROM demo_payments').get().status, 'pending');
  } finally { s.db.close(); }
});

test('disabled demo payments and absent totals create no payment; an existing one stays', async () => {
  const s = setup();
  try {
    s.env.DEMO_PAYMENTS_ENABLED = 'false';
    assert.equal(await registerDemoPayment(s.env, id, now), null);
    s.env.DEMO_PAYMENTS_ENABLED = 'true';
    s.db.prepare('UPDATE order_events SET json=?').run(JSON.stringify({ order: { ...order, net: null } }));
    // #25: puuttuva summa ei saa jumittaa reittiä: maksua ei luoda.
    assert.equal(await registerDemoPayment(s.env, id, now), null);
    s.db.prepare('UPDATE order_events SET json=?').run(JSON.stringify({ order }));
    await registerDemoPayment(s.env, id, now);
    s.env.DEMO_PAYMENTS_ENABLED = 'false';
    assert.equal(s.db.prepare('SELECT status FROM demo_payments').get().status, 'pending');
  } finally { s.db.close(); }
});
