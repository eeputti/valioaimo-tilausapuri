import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker from '../src/index.ts';
import { publishOnce, pushOrderEvents, orderEventKey } from '../publish-orders.mjs';
import { orderLinkToken } from '../src/demo-payment.ts';

test('publisher → hosted order → demo payment → one confirmation, including cancellation and concurrent retries', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) {
    let params = [];
    return { bind(...values) { params = values; return this; }, async first() { return db.prepare(sql).get(...params) || null; },
      async run() { await null; return { meta: { changes: db.prepare(sql).run(...params).changes } }; } };
  } };
  const notices = [], origin = 'https://demo.example', token = 'isolated-checkout-' + 'a'.repeat(40);
  const env = { DB, SYNC_TOKEN: token, WEBCHAT_SECRET: 'isolated-webchat-' + 'w'.repeat(40), DEMO_PAYMENTS_ENABLED: 'true' };
  // Hyväksytty maksu pyytää botilta kiitosviestin ctx.waitUntilissa.
  const fetcher = (url, init) => worker.fetch(new Request(url, init), env, { waitUntil(p) { notices.push(p); } });
  const order = { orderId: 'AGW-20261115-0001', status: 'confirmed', channel: 'whatsapp', createdAt: new Date().toISOString(),
    deliveryDate: '2026-11-18', net: 29.8, lineCount: 1, lines: [{ productId: '1234', name: 'Maito', quantity: 20, unit: 'l', net: 29.8 }] };
  const snapshot = { version: 1, observedAt: Date.now(), totalOrders: 1, ledgerHead: '0'.repeat(64), orders: [order] };
  const known = new Set();
  try {
    await publishOnce({ url: origin, token, snapshot, fetcher });
    const publish = () => pushOrderEvents({ url: origin, token, snapshot, known, fetcher });
    const pushed = await publish();
    assert.equal(pushed[0].orderId, order.orderId);
    assert.equal(known.has(orderEventKey(order)), true); // tilauksen ilmentymä: numero + luontiaika (#24)
    assert.deepEqual(await publish(), []);

    const publicText = await (await fetcher(`${origin}/api/orders`)).text();
    assert.doesNotMatch(publicText, /SYNC_TOKEN|AGW-/);
    // Botti antoi tilaajalle oman linkin; vain sillä tilaus löytyy omista tilauksista.
    const own = await orderLinkToken(env, order.orderId, order.createdAt);
    const mine = (links) => fetcher(`${origin}/api/my-orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ links }) }).then((r) => r.json());
    assert.deepEqual((await mine([{ orderId: order.orderId, token: 'A'.repeat(43) }])).orders, []);
    const ownText = JSON.stringify(await mine([{ orderId: order.orderId, token: own }]));
    const hosted = JSON.parse(ownText).orders[0];
    assert.equal(hosted.demoPayment.status, 'pending');
    const link = new URL(hosted.demoPayment.url), [id, capability] = link.hash.slice(1).split('.');
    assert.equal(id, order.orderId);
    const payment = (simulate, extra = {}) => fetcher(`${origin}/api/demo-payments/${id}`, {
      method: simulate ? 'POST' : 'GET', headers: { authorization: `Bearer ${capability}`, ...(simulate ? { origin, 'content-type': 'application/json' } : {}), ...extra },
      ...(simulate ? { body: JSON.stringify({ simulate }) } : {}),
    });
    assert.equal((await (await payment()).json()).payment.amountNetCents, 2980);
    assert.equal((await payment('success', { origin: 'https://another.example' })).status, 403);
    assert.equal((await (await payment('cancel')).json()).status, 'pending');
    assert.equal(notices.length, 0);
    const [first, retry] = await Promise.all([payment('success'), payment('success')]);
    for (const response of [first, retry]) assert.equal((await response.json()).status, 'paid');
    const paidAt = db.prepare('SELECT paid_at FROM demo_payments').get().paid_at;
    assert.equal((await (await payment('success')).json()).status, 'paid');
    assert.equal(db.prepare('SELECT paid_at FROM demo_payments').get().paid_at, paidAt);
    assert.equal(db.prepare('SELECT count(*) n FROM order_events').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM demo_payments').get().n, 1);
    assert.equal((await mine([{ orderId: order.orderId, token: own }])).orders[0].demoPayment.status, 'paid');
  } finally { db.close(); }
});
