import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import worker from '../src/index.ts';
import { parseSnapshot, MAX_BODY_BYTES } from '../src/protocol.ts';
import { readSnapshot, publishOnce } from '../publish-orders.mjs';

const sample = (now = Date.now()) => ({ version: 1, observedAt: now, totalOrders: 1, ledgerHead: '0'.repeat(64), orders: [{
  orderId: 'AGW-20261114-0001', channel: 'whatsapp', status: 'confirmed', createdAt: '2026-11-14T12:00:00.000Z',
  deliveryDate: '2026-11-16', net: 29.8, lineCount: 1, lines: [{ productId: '1234', name: 'Laktoositon maito', quantity: 20, unit: 'l', net: 29.8 }],
}] });
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return { db, prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: result.changes } }; } }; } };
}
const token = 'test-only-' + 'a'.repeat(48);
const req = (payload, auth = token) => new Request('https://demo.example/api/sync', { method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

test('the authenticated publisher reaches the public endpoint; retries preserve one snapshot and older writes cannot replace it', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token };
  try {
    const now = Date.now(), snapshot = sample(now);
    const fetcher = (url, init) => worker.fetch(new Request(url, init), env);
    const first = await publishOnce({ url: 'https://demo.example', token, snapshot, fetcher });
    assert.equal(first.updated, true);
    assert.equal((await publishOnce({ url: 'https://demo.example', token, snapshot, fetcher })).updated, false);
    const old = sample(now - 1); old.orders[0].status = 'rejected';
    assert.equal((await (await worker.fetch(req(old), env)).json()).updated, false);
    // Tilannekuva tallentuu, mutta julkinen lista ei näytä kenenkään tilauksia: kukin näkee vain omansa (/api/my-orders).
    const stored = () => JSON.parse(env.DB.db.prepare('SELECT json FROM demo_snapshot').get().json);
    const current = await (await worker.fetch(new Request('https://demo.example/api/orders'), env)).json();
    assert.deepEqual(current.orders, []); assert.equal(current.personal, true); assert.ok(current.receivedAt);
    assert.equal(stored().orders[0].status, 'confirmed');
    assert.equal(env.DB.db.prepare('SELECT count(*) n FROM demo_snapshot').get().n, 1);
    const updated = sample(now + 1); updated.orders[0].status = 'pending_approval';
    await worker.fetch(req(updated), env);
    assert.equal(stored().orders[0].status, 'pending_approval');
  } finally { env.DB.db.close(); }
});

test('public callers cannot write or access pairing, gateway or chat routes; invalid and oversized payloads cannot change stored orders', async () => {
  const env = { DB: d1(), SYNC_TOKEN: token };
  try {
    assert.equal((await worker.fetch(req(sample(), 'wrong'), env)).status, 401);
    assert.equal((await worker.fetch(req(sample()), { ...env, SYNC_TOKEN: '' })).status, 401);
    for (const route of ['/demo/chat', '/v1/orders', '/api/reset', '/webhooks/whatsapp']) assert.equal((await worker.fetch(new Request('https://demo.example' + route, { method: 'POST' }), env)).status, 404);
    const duplicate = sample(); duplicate.orders.push(duplicate.orders[0]); duplicate.totalOrders++;
    assert.equal((await worker.fetch(req(duplicate), env)).status, 400);
    assert.equal((await worker.fetch(req(sample(Date.now() - 400000)), env)).status, 400);
    assert.equal((await worker.fetch(req(' '.repeat(MAX_BODY_BYTES + 1)), env)).status, 400);
    assert.equal(env.DB.db.prepare('SELECT count(*) n FROM demo_snapshot').get().n, 0);
    const privateFields = sample(); privateFields.phone = 'SECRET_PHONE'; privateFields.orders[0].apiKey = 'SECRET_KEY'; privateFields.orders[0].buyerReference = 'SECRET_REFERENCE';
    assert.equal((await worker.fetch(req(privateFields), env)).status, 200);
    const output = await (await worker.fetch(new Request('https://demo.example/api/orders'), env)).text();
    assert.doesNotMatch(output, /SECRET_/);
  } finally { env.DB.db.close(); }
});

test('the local reader publishes every WhatsApp member (#13), browser demo only explicitly, the old scope on request, and leaves both databases unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-public-orders-'));
  const gatewayFile = path.join(dir, 'gateway.db'), whatsappFile = path.join(dir, 'whatsapp.db');
  const db = new DatabaseSync(gatewayFile), members = new DatabaseSync(whatsappFile);
  try {
    db.exec('CREATE TABLE ledger(seq INTEGER PRIMARY KEY,ts TEXT,actor TEXT,type TEXT,buyer_id TEXT,order_id TEXT,quote_id TEXT,payload TEXT,prev_hash TEXT,hash TEXT); CREATE TABLE orders(id TEXT,buyer_id TEXT,created_at TEXT,json TEXT)');
    members.exec('CREATE TABLE members(phone TEXT,binding TEXT,person TEXT)');
    members.prepare('INSERT INTO members VALUES(?,?,?)').run('358401234567', 'selected', 'PRIVATE_PERSON');
    members.prepare('INSERT INTO members VALUES(?,?,?)').run('358409876543', 'other', 'PRIVATE_OTHER');
    members.prepare('INSERT INTO members VALUES(?,?,?)').run('358000000001', 'browser', 'PRIVATE_BROWSER');
    for (const [index, binding] of ['selected', 'other', 'browser'].entries()) {
      const order = { ...sample().orders[0], orderId: `AGW-20261114-000${index + 1}`, buyerId: `whatsapp-demo-${binding}`,
        buyerName: 'PRIVATE_PERSON', apiKey: 'PRIVATE_KEY', buyerReference: 'PRIVATE_REF', idempotencyKey: 'PRIVATE_IDEMPOTENCY',
        totals: { net: 29.8 }, lines: [{ productId: '1234', name: 'Maito', quantity: 20, salesUnitLabel: 'l', lineNet: 29.8 }] };
      db.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(order.orderId, order.buyerId, order.createdAt, JSON.stringify(order));
    }
    const files = [gatewayFile, whatsappFile].map(file => fs.readFileSync(file));
    const snapshot = readSnapshot({ gatewayFile, whatsappFile, phone: '+358401234567' });
    // Jokainen vahvistettu WhatsApp-tilaus saa maksulinkin, joten myös muiden liittyneiden jäsenten tilaukset julkaistaan.
    assert.deepEqual(snapshot.orders.map(o => [o.orderId, o.channel]).sort(), [['AGW-20261114-0001', 'whatsapp'], ['AGW-20261114-0002', 'whatsapp']]);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_|35840|selected|buyerId|apiKey|idempotency/);
    const narrow = readSnapshot({ gatewayFile, whatsappFile, phone: '358401234567', onlyDemoPhone: true });
    assert.deepEqual(narrow.orders.map(o => o.orderId), ['AGW-20261114-0001']);
    const withBrowser = readSnapshot({ gatewayFile, whatsappFile, phone: '358401234567', includeBrowserDemo: true });
    assert.equal(withBrowser.orders.length, 3);
    assert.equal(withBrowser.orders.find(o => o.orderId.endsWith('0003')).channel, 'browser-demo');
    [gatewayFile, whatsappFile].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), files[index]));
    const prev = '0'.repeat(64), fields = ['2026-11-14', 'gateway', 'ORDER_CONFIRMED', null, null, null, '{}'];
    const digest = crypto.createHash('sha256').update(`${prev}|${fields.map(v => v || '').join('|')}`).digest('hex');
    db.prepare('INSERT INTO ledger VALUES(1,?,?,?,?,?,?,?,?,?)').run(...fields, prev, digest);
    assert.equal(readSnapshot({ gatewayFile, whatsappFile, phone: '358401234567' }).ledgerHead, digest);
    db.prepare("UPDATE ledger SET payload='tampered'").run();
    assert.throws(() => readSnapshot({ gatewayFile, whatsappFile, phone: '358401234567' }), /päätösketjun/);
  } finally { db.close(); members.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('projection validation rejects invalid numbers and transport refuses cleartext or redirected uploads', async () => {
  const bad = sample(); bad.orders[0].lines[0].net = -1;
  assert.throws(() => parseSnapshot(bad), /luku/);
  await assert.rejects(publishOnce({ url: 'http://demo.example', token, snapshot: sample() }), /HTTPS/);
  let redirected;
  await publishOnce({ url: 'https://demo.example', token, snapshot: sample(), fetcher: async (_url, init) => { redirected = init.redirect; return Response.json({ ok: true }); } });
  assert.equal(redirected, 'error');
});
