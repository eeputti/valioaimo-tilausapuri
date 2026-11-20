import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { registerDemoPayment, describeDemoPayment, handleDemoPayment } from '../src/demo-payment.ts';
import { notifyOrderPaid } from '../src/order-paid.ts';

const id = 'AGW-20261120-0001';
const origin = 'https://demo.example';
const now = Date.parse('2026-11-20T12:00:00Z');
const order = { orderId: id, channel: 'whatsapp', status: 'confirmed', createdAt: new Date(now).toISOString(), deliveryDate: '2026-11-24', net: 20, lineCount: 1,
  lines: [{ productId: '1234', name: 'Maito', quantity: 20, unit: 'l', net: 20 }] };
const secret = 'test-only-' + 'w'.repeat(40);
function setup(backendUrl = 'https://bot.example') {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) || null; },
    async run() { return { meta: { changes: db.prepare(sql).run(...values).changes } }; } }; } };
  db.prepare('INSERT INTO order_events VALUES(?,?,?)').run(id, now, JSON.stringify({ order }));
  if (backendUrl) db.prepare("INSERT INTO landing_settings(key,value) VALUES('bot_backend_url',?)").run(backendUrl);
  return { db, env: { DB, SYNC_TOKEN: 'test-only-' + 'k'.repeat(48), DEMO_PAYMENTS_ENABLED: 'true', WEBCHAT_SECRET: secret } };
}
const pay = (capability, simulate) => new Request(`${origin}/api/demo-payments/${id}`, { method: 'POST',
  headers: { authorization: `Bearer ${capability}`, origin, 'content-type': 'application/json' }, body: JSON.stringify({ simulate }) });

test('only an accepted payment asks the bot for the WhatsApp thank-you', async () => {
  const s = setup();
  try {
    await registerDemoPayment(s.env, id, now);
    const token = (await describeDemoPayment(s.env, id, origin)).url.split('.').at(-1);
    const calls = [];
    const onPaid = (orderId) => calls.push(orderId);
    await handleDemoPayment(pay(token, 'cancel'), s.env, now + 1, onPaid);
    assert.equal(calls.length, 0);
    const paid = await (await handleDemoPayment(pay(token, 'success'), s.env, now + 2, onPaid)).json();
    assert.equal(paid.status, 'paid');
    assert.deepEqual(calls, [id]);
  } finally { s.db.close(); }
});

test('the Worker calls the bot with the shared secret and retries once after a server error', async () => {
  const s = setup();
  try {
    const seen = [];
    const responses = [new Response('{}', { status: 503 }), new Response('{"ok":true}', { status: 200 })];
    const fake = async (url, init) => { seen.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) }); return responses.shift(); };
    assert.equal(await notifyOrderPaid(s.env, id, fake), 'notified');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url, 'https://bot.example/webchat/api/order-paid');
    assert.equal(seen[0].auth, `Bearer ${secret}`);
    assert.deepEqual(seen[0].body, { orderId: id });
    const rejected = [];
    assert.equal(await notifyOrderPaid(s.env, id, async () => { rejected.push(1); return new Response('{}', { status: 404 }); }), 'failed');
    assert.equal(rejected.length, 1);
  } finally { s.db.close(); }
  const none = setup(null);
  try { assert.equal(await notifyOrderPaid(none.env, id, async () => assert.fail('no backend, no call')), 'no_backend'); }
  finally { none.db.close(); }
});
