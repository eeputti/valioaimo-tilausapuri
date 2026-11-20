// Tilaukset näkyvät vain tilaajalle: botin henkilökohtainen tilauslinkki (server/whatsapp/checkout.mjs) avaa tilauksen,
// demomaksun ja agentin jäljen Workerissa. Julkista tilauslistaa ei ole. Muistissa oleva D1, ei verkkoa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker, { MAX_OWN_LINKS } from '../src/index.ts';
import { orderLinkToken as workerToken } from '../src/demo-payment.ts';
import { orderLinkToken as botToken, withDemoCheckout } from '../../../server/whatsapp/checkout.mjs';

const origin = 'https://demo.example', token = 'personal-orders-' + 's'.repeat(40), secret = 'personal-webchat-' + 'w'.repeat(40);
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return { db, prepare(sql) { let args = []; return { bind(...values) { args = values; return this; },
    async first() { return db.prepare(sql).get(...args) || null; }, async run() { await null; return { meta: { changes: db.prepare(sql).run(...args).changes } }; } }; } };
}
const order = (orderId, createdAt, name = 'Maito') => ({ orderId, channel: 'whatsapp', status: 'confirmed', createdAt, deliveryDate: '2026-11-18', net: 12.5, lineCount: 1,
  lines: [{ productId: '1234', name, quantity: 5, unit: 'l', net: 12.5 }] });
const call = (env, path, init = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const pushEvent = (env, o, observedAt = Date.now()) => call(env, '/api/order-events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ version: 1, observedAt, ledgerHead: '0'.repeat(64), order: o }) });
const mine = async (env, links) => (await call(env, '/api/my-orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ links }) })).json();
const payment = (env, orderId, bearer) => call(env, `/api/demo-payments/${orderId}`, { headers: { authorization: `Bearer ${bearer}` } });

test('botin linkki avaa oman tilauksen ja demomaksun; toisen tilaus, väärennetty tunniste ja pelkkä numero eivät avaa mitään', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token, WEBCHAT_SECRET: secret, DEMO_PAYMENTS_ENABLED: 'true' };
  try {
    const a = order('AGW-20261117-0001', '2026-11-17T08:00:00.000Z', 'Asiakkaan A maito');
    const b = order('AGW-20261117-0002', '2026-11-17T08:05:00.000Z', 'Asiakkaan B kerma');
    for (const o of [a, b]) assert.equal((await pushEvent(env, o)).status, 200);

    // Sama tunniste botissa (node:crypto) ja Workerissa (Web Crypto).
    const linkA = botToken(secret, a.orderId, a.createdAt), linkB = botToken(secret, b.orderId, b.createdAt);
    assert.equal(await workerToken(env, a.orderId, a.createdAt), linkA);
    // Bot wrapper puts exactly this link into the cart page's "Siirry demomaksuun" button.
    const ordering = withDemoCheckout({ chat: async () => ({ status: 'confirmed', orderId: a.orderId }) }, { baseUrl: `${origin}/`, secret, orderCreatedAt: async () => a.createdAt });
    assert.equal((await ordering.chat({})).checkout.url, `${origin}/demo-payment.html#${a.orderId}.${linkA}`);

    const view = await (await payment(env, a.orderId, linkA)).json();
    assert.deepEqual(view.order.lines.map((l) => l.name), ['Asiakkaan A maito']);
    assert.equal(view.payment.amountNetCents, 1250);
    assert.equal((await payment(env, b.orderId, linkA)).status, 404, 'A:n linkki ei avaa B:n tilausta');
    assert.equal((await payment(env, a.orderId, 'A'.repeat(43))).status, 404);
    assert.equal((await payment(env, a.orderId, botToken('wrong-secret-'.repeat(4), a.orderId, a.createdAt))).status, 404);

    const publicList = await (await call(env, '/api/orders')).json();
    assert.deepEqual(publicList.orders, []);
    assert.doesNotMatch(JSON.stringify(publicList), /AGW-|Asiakkaan/);

    // Omat tilaukset: vain ne, joiden linkki tällä selaimella on.
    const onlyA = await mine(env, [{ orderId: a.orderId, token: linkA }, { orderId: b.orderId, token: linkA }, { orderId: 'AGW-20261117-0099', token: linkA }]);
    assert.deepEqual(onlyA.orders.map((o) => o.orderId), [a.orderId]);
    assert.equal(onlyA.orders[0].demoPayment.status, 'pending');
    assert.equal(onlyA.orders[0].demoPayment.url, `${origin}/demo-payment.html#${a.orderId}.${linkA}`, 'palauttaa saman henkilökohtaisen linkin, ei maksun sisäistä tunnistetta');
    const both = await mine(env, [{ orderId: a.orderId, token: linkA }, { orderId: b.orderId, token: linkB }]);
    assert.deepEqual(both.orders.map((o) => o.orderId), [b.orderId, a.orderId], 'uusin ensin');
    assert.deepEqual((await mine(env, [])).orders, []);

    // Maksu toimii omalla linkillä, myös hyväksyntä.
    const pay = await call(env, `/api/demo-payments/${a.orderId}`, { method: 'POST', headers: { authorization: `Bearer ${linkA}`, origin, 'content-type': 'application/json' }, body: JSON.stringify({ simulate: 'success' }) });
    assert.equal((await pay.json()).status, 'paid');
    assert.equal((await mine(env, [{ orderId: a.orderId, token: linkA }])).orders[0].demoPayment.status, 'paid');
  } finally { env.DB.db.close(); }
});

test('nollauksen jälkeen samalla numerolla tullut uusi tilaus ei aukea vanhalla linkillä', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token, WEBCHAT_SECRET: secret, DEMO_PAYMENTS_ENABLED: 'true' };
  try {
    const old = order('AGW-20261117-0003', '2026-11-17T08:00:00.000Z', 'Vanha');
    await pushEvent(env, old, Date.now() - 60_000);
    const oldLink = botToken(secret, old.orderId, old.createdAt);
    const fresh = order('AGW-20261117-0003', '2026-11-17T10:30:00.000Z', 'Uusi');
    assert.equal((await (await pushEvent(env, fresh)).json()).replaced, true);
    assert.equal((await payment(env, old.orderId, oldLink)).status, 404);
    assert.deepEqual((await mine(env, [{ orderId: old.orderId, token: oldLink }])).orders, []);
    const newLink = botToken(secret, fresh.orderId, fresh.createdAt);
    assert.deepEqual((await (await payment(env, fresh.orderId, newLink)).json()).order.lines.map((l) => l.name), ['Uusi']);
  } finally { env.DB.db.close(); }
});

test('ilman WEBCHAT_SECRETia omat linkit eivät aukea; virheellinen tai liian suuri pyyntö torjutaan', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token, DEMO_PAYMENTS_ENABLED: 'true' };
  try {
    const o = order('AGW-20261117-0004', '2026-11-17T08:00:00.000Z');
    await pushEvent(env, o);
    const link = botToken(secret, o.orderId, o.createdAt);
    assert.equal((await payment(env, o.orderId, link)).status, 404);
    assert.deepEqual((await mine(env, [{ orderId: o.orderId, token: link }])).orders, []);
    const bad = (body, type = 'application/json') => call(env, '/api/my-orders', { method: 'POST', headers: { 'content-type': type }, body });
    assert.equal((await bad('{"links":"x"}')).status, 400);
    assert.equal((await bad(JSON.stringify({ links: [{ orderId: 1, token: 'x' }] }))).status, 400);
    assert.equal((await bad(JSON.stringify({ links: Array.from({ length: MAX_OWN_LINKS + 1 }, () => ({ orderId: o.orderId, token: link })) }))).status, 400);
    assert.equal((await bad('{}', 'text/plain')).status, 415);
    assert.equal((await call(env, '/api/my-orders')).status, 404, 'vain POST');
  } finally { env.DB.db.close(); }
});
