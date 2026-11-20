// Katselmoinnin (docs/parallel/code-audit-2026-11-15-ilta.md) Worker- ja julkaisijaviat #13, #24 ja #25.
// Muistissa oleva D1-jäljitelmä, simuloitu sähköposti, väliaikaiset SQLite-tiedostot. Ei verkkoa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../src/index.ts';
import { describeDemoPayment } from '../src/demo-payment.ts';
import { readSnapshot, pushOrderEvents, orderEventKey, RETRY_BASE_MS } from '../publish-orders.mjs';

const token = 'audit-b-only-' + 'c'.repeat(44);
const origin = 'https://demo.example';
// D1 batch on transaktio; jäljitelmä ajaa sen node:sqlite-transaktiona. withBatch=false kokeilee peräkkäistä varapolkua.
function d1({ withBatch = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const statement = (sql) => { let args = []; return { bind(...values) { args = values; return this; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { await null; return { meta: { changes: db.prepare(sql).run(...args).changes } }; },
    runSync() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; } }; };
  const DB = { db, prepare: statement };
  if (withBatch) DB.batch = async (statements) => { await null; db.exec('BEGIN'); try { const out = statements.map((s) => s.runSync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  return DB;
}
const order = (over = {}) => ({ orderId: 'AGW-20261115-0003', channel: 'whatsapp', status: 'confirmed', createdAt: '2026-11-15T09:10:00.000Z',
  deliveryDate: '2026-11-16', net: 29.8, lineCount: 1, lines: [{ productId: '1234', name: 'Vanha maito', quantity: 20, unit: 'l', net: 29.8 }], ...over });
const event = (o, observedAt = Date.now()) => ({ version: 1, observedAt, ledgerHead: '0'.repeat(64), order: o });
const post = (env, body) => worker.fetch(new Request(`${origin}/api/order-events`, { method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
const envOf = (DB) => ({ DB, SYNC_TOKEN: token, DEMO_PAYMENTS_ENABLED: 'true' });
async function paymentView(env, orderId) {
  const link = new URL((await describeDemoPayment(env, orderId, origin)).url);
  const capability = link.hash.slice(1).split('.')[1];
  return (await worker.fetch(new Request(`${origin}/api/demo-payments/${orderId}`, { headers: { authorization: `Bearer ${capability}` } }), env)).json();
}

for (const withBatch of [true, false]) {
  test(`#24 nollatun gatewayn sama tilausnumero korvaa vanhan tilauksen maksuineen ja jälkineen (${withBatch ? 'D1 batch' : 'peräkkäin'})`, async () => {
    const env = envOf(d1({ withBatch }));
    try {
      const old = order();
      assert.equal((await (await post(env, event(old, Date.now() - 60_000))).json()).duplicate, false);
      env.DB.db.prepare('INSERT INTO agent_traces(order_id,observed_at,received_at,json) VALUES(?,?,?,?)').run(old.orderId, 1, 1, '{"old":true}');
      assert.equal((await paymentView(env, old.orderId)).payment.amountNetCents, 2980);
      const oldLink = (await describeDemoPayment(env, old.orderId, origin)).url;

      // Sama tilauksen ilmentymä uudelleen: kopio, ei muutosta.
      const again = await (await post(env, event(old))).json();
      assert.equal(again.duplicate, true); assert.equal(again.replaced, false);

      // Nollauksen jälkeen gateway antoi saman numeron uudelle tilaukselle (eri luontiaika, uudempi välitys).
      const fresh = order({ createdAt: '2026-11-15T11:45:00.000Z', net: 12.4, lines: [{ productId: '5678', name: 'Uusi kerma', quantity: 2, unit: 'l', net: 12.4 }] });
      const replaced = await (await post(env, event(fresh))).json();
      assert.equal(replaced.ok, true); assert.equal(replaced.duplicate, false); assert.equal(replaced.replaced, true);
      const view = await paymentView(env, fresh.orderId);
      assert.equal(view.payment.amountNetCents, 1240, 'maksusivu näyttää uuden tilauksen summan');
      assert.equal(view.payment.status, 'pending');
      assert.deepEqual(view.order.lines.map((l) => l.name), ['Uusi kerma']);
      assert.notEqual((await describeDemoPayment(env, fresh.orderId, origin)).url, oldLink, 'vanhan tilauksen maksulinkki ei enää kelpaa');
      assert.equal(env.DB.db.prepare('SELECT count(*) n FROM agent_traces').get().n, 0, 'vanhan tilauksen jälki poistui');
      assert.match(env.DB.db.prepare('SELECT json FROM order_events').get().json, /Uusi kerma/);

      // Vanhemman tilauksen myöhässä tullut välitys ei korvaa uudempaa.
      const late = await (await post(env, event(old, Date.now() - 120_000))).json();
      assert.equal(late.ok, true); assert.equal(late.superseded, true);
      assert.equal((await paymentView(env, fresh.orderId)).payment.amountNetCents, 1240);
    } finally { env.DB.db.close(); }
  });
}

test('#25 vahvistettu tilaus ilman summaa ei jumita reittiä: tallessa, ei maksua', async () => {
  const env = envOf(d1());
  const errors = []; const realError = console.error; console.error = (line) => errors.push(String(line));
  try {
    const response = await post(env, event(order({ net: null })));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(env.DB.db.prepare('SELECT count(*) n FROM demo_payments').get().n, 0);
    assert.ok(errors.some((line) => /demo_payment_unavailable/.test(line) ));
    assert.equal((await post(env, event(order({ net: null })))).status, 200, 'uusinta ei palauta 503:a');
  } finally { console.error = realError; env.DB.db.close(); }
});

test('#25 yksi epäonnistuva tilaus ei pysäytä julkaisijan kierrosta; uusinta odottaa, pysyvä hylkäys ei toistu', async () => {
  const a = order({ orderId: 'AGW-20261115-0011' }), b = order({ orderId: 'AGW-20261115-0012' }), c = order({ orderId: 'AGW-20261115-0013' });
  const snapshot = { version: 1, observedAt: Date.now(), totalOrders: 3, ledgerHead: '0'.repeat(64), orders: [a, b, c] };
  const calls = [];
  let failA = 503;
  const fetcher = async (_url, init) => {
    const { order: o } = JSON.parse(init.body); calls.push(o.orderId);
    if (o.orderId === a.orderId && failA) return Response.json({ error: 'x' }, { status: failA });
    if (o.orderId === c.orderId) return Response.json({ error: 'Virheellinen tilaustapahtuma.' }, { status: 400 });
    return Response.json({ ok: true, duplicate: false });
  };
  const known = new Set(), failures = new Map(), t0 = 1_000_000;
  const first = await pushOrderEvents({ url: origin, token, snapshot, known, failures, fetcher, now: t0 });
  assert.deepEqual(first.map((r) => [r.orderId, r.error || 'ok']), [[a.orderId, 'HTTP 503'], [b.orderId, 'ok'], [c.orderId, 'HTTP 400']]);
  assert.equal(known.has(orderEventKey(b)), true); assert.equal(known.has(orderEventKey(a)), false);
  assert.equal(known.has(orderEventKey(c)), true, 'pysyvää 4xx-hylkäystä ei yritetä joka kierroksella');
  assert.deepEqual(await pushOrderEvents({ url: origin, token, snapshot, known, failures, fetcher, now: t0 + 1 }), [], 'odottaa ennen uusintaa');
  failA = 0;
  const later = await pushOrderEvents({ url: origin, token, snapshot, known, failures, fetcher, now: t0 + RETRY_BASE_MS });
  assert.deepEqual(later.map((r) => [r.orderId, r.error || 'ok']), [[a.orderId, 'ok']]);
  assert.deepEqual(calls, [a.orderId, b.orderId, c.orderId, a.orderId]);
  // Väärä avain koskee kaikkia tilauksia, joten se pysäyttää kierroksen edelleen.
  await assert.rejects(pushOrderEvents({ url: origin, token, snapshot: { ...snapshot, orders: [order({ orderId: 'AGW-20261115-0014' })] }, known: new Set(),
    fetcher: async () => Response.json({ error: 'no' }, { status: 401 }) }), /HTTP 401/);
});

test('#24 julkaisija välittää nollauksen jälkeen saman numeron uuden tilauksen, vaikka vanha olisi jo välitetty', async () => {
  const old = order(), fresh = order({ createdAt: '2026-11-15T11:45:00.000Z' });
  const sent = [];
  const fetcher = async (_url, init) => { sent.push(JSON.parse(init.body).order.createdAt); return Response.json({ ok: true, duplicate: false }); };
  const known = new Set();
  const snap = (o) => ({ version: 1, observedAt: Date.now(), totalOrders: 1, ledgerHead: '0'.repeat(64), orders: [o] });
  await pushOrderEvents({ url: origin, token, snapshot: snap(old), known, fetcher });
  await pushOrderEvents({ url: origin, token, snapshot: snap(old), known, fetcher });
  await pushOrderEvents({ url: origin, token, snapshot: snap(fresh), known, fetcher });
  assert.deepEqual(sent, [old.createdAt, fresh.createdAt]);
});

test('#13 julkaisija ottaa mukaan landingilta liittyneet ja kiinnitetyn ostajan WhatsApp-tilaukset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-audit-b-publish-'));
  const gatewayFile = path.join(dir, 'gateway.db'), whatsappFile = path.join(dir, 'whatsapp.db');
  const db = new DatabaseSync(gatewayFile), members = new DatabaseSync(whatsappFile);
  try {
    db.exec('CREATE TABLE ledger(seq INTEGER PRIMARY KEY,ts TEXT,actor TEXT,type TEXT,buyer_id TEXT,order_id TEXT,quote_id TEXT,payload TEXT,prev_hash TEXT,hash TEXT); CREATE TABLE orders(id TEXT,buyer_id TEXT,created_at TEXT,json TEXT)');
    members.exec('CREATE TABLE members(phone TEXT,company TEXT,person TEXT,binding TEXT)');
    const member = (phone, binding) => members.prepare('INSERT INTO members(phone,company,person,binding) VALUES(?,?,?,?)').run(phone, 'Yritys', 'PRIVATE_NAME', binding);
    member('358401111111', 'demo'); member('358402222222', 'landing'); member('358000000001', 'browser'); member('358000012345678', 'webchat');
    const put = (n, buyerId, buyerReference) => {
      const o = { orderId: `AGW-20261115-00${n}`, buyerId, buyerReference, status: 'confirmed', createdAt: `2026-11-15T09:${n}:00.000Z`, deliveryDate: '2026-11-16',
        totals: { net: 10 }, lines: [{ productId: '1', name: 'Maito', quantity: 1, salesUnitLabel: 'l', lineNet: 10 }] };
      db.prepare('INSERT INTO orders VALUES(?,?,?,?)').run(o.orderId, buyerId, o.createdAt, JSON.stringify(o));
    };
    put(21, 'whatsapp-demo-demo', 'whatsapp:d1');        // demonumero
    put(22, 'whatsapp-demo-landing', 'whatsapp:d2');     // landingilta liittynyt
    put(23, 'kahvila-aalto', 'whatsapp:d3');             // WHATSAPP_DEMO_BUYER_ID: demonumeron kiinnitetty ostaja
    put(24, 'kahvila-aalto', 'storefront:x');            // saman ostajan verkkokauppatilaus: ei WhatsAppia
    put(25, 'whatsapp-demo-browser', 'whatsapp:d5');     // selaindemo vain lipulla
    put(26, 'whatsapp-demo-webchat', 'whatsapp:d6');     // selainkeskustelu vain lipulla
    put(27, 'nordic-hotels', null);                      // ei WhatsApp-jäsen
    const snapshot = readSnapshot({ gatewayFile, whatsappFile, phone: '358401111111', demoBuyerId: 'kahvila-aalto' });
    assert.deepEqual(snapshot.orders.map((o) => o.orderId).sort(), ['AGW-20261115-0021', 'AGW-20261115-0022', 'AGW-20261115-0023']);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_|3584|kahvila|landing|buyerReference|whatsapp:/);
    const withWeb = readSnapshot({ gatewayFile, whatsappFile, phone: '358401111111', demoBuyerId: '', includeBrowserDemo: true, includeWebChat: true });
    assert.deepEqual(withWeb.orders.map((o) => [o.orderId, o.channel]).sort(), [['AGW-20261115-0021', 'whatsapp'], ['AGW-20261115-0022', 'whatsapp'], ['AGW-20261115-0025', 'browser-demo'], ['AGW-20261115-0026', 'browser-demo']]);
    assert.throws(() => readSnapshot({ gatewayFile, whatsappFile, phone: '358401111111', demoBuyerId: 'Bad Id!' }), /WHATSAPP_DEMO_BUYER_ID/);

  } finally { db.close(); members.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
