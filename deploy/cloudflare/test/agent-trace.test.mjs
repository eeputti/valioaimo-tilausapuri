import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../src/index.ts';
import { parseAgentTrace } from '../src/agent-trace.ts';
import { readAgentTrace, redact } from '../trace-reader.mjs';
import { publishOnce, pushOrderEvents, pushAgentTraces } from '../publish-orders.mjs';
import { orderLinkToken } from '../src/demo-payment.ts';

const ORDER_ID = 'AGW-20261115-0042', BINDING = '0d0cfd68-702b-4f72-a5eb-b6085df8cbd5', PHONE = '358401234567', DRAFT = 'WD-41ca9bd5-8d55-4daa-b93f-e2ea5e0002bb';
const CONVERSATION = `1445585741976990:whatsapp-demo-${BINDING}`;
const t = (s) => Date.parse(`2026-11-15T14:${s}Z`);

// Synthetic copies of the three stores the publisher reads (same columns as the real schemas).
function fixture(dir, { orderCreatedAt = '2026-11-15T14:55:36.140Z' } = {}) {
  const files = { gatewayFile: path.join(dir, 'gateway.db'), whatsappFile: path.join(dir, 'whatsapp.db'), draftFile: path.join(dir, 'drafts.db') };
  const w = new DatabaseSync(files.whatsappFile);
  w.exec(`CREATE TABLE members (phone TEXT PRIMARY KEY, company TEXT NOT NULL, person TEXT NOT NULL, binding TEXT NOT NULL);
    CREATE TABLE inbox (id TEXT PRIMARY KEY, phone TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, binding TEXT, received INTEGER NOT NULL, sent_at INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, reply TEXT, reply_id TEXT, error TEXT);
    CREATE TABLE reply_parts (message_id TEXT NOT NULL, part INTEGER NOT NULL, text TEXT NOT NULL, reply_id TEXT, PRIMARY KEY(message_id,part));`);
  w.prepare('INSERT INTO members VALUES(?,?,?,?)').run(PHONE, 'Testikeittiö Oy', 'Private Person', BINDING);
  w.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358409999999', 'Other Oy', 'Other Person', 'other-binding');
  const msg = (id, sec, text, reply, kind = 'text', phone = PHONE) => w.prepare("INSERT INTO inbox(id,phone,text,kind,binding,received,sent_at,state,reply) VALUES(?,?,?,?,?,?,?,'done',?)")
    .run(id, phone, text, kind, BINDING, t(sec), t(sec), reply);
  msg('wamid.old', '40:00', 'vanha viesti toisesta luonnoksesta', 'vanha vastaus');
  msg('wamid.hi', '52:33', 'no terve!', 'No terve! Kerro vaan, mitä tarvitset.');
  msg('wamid.pair', '52:40', 'hash-of-code', 'Yhdistetty.', 'pair');
  msg('wamid.m1', '52:56', 'tarvittisin 1000 litraa maitoo, soita 040 123 4567 tai eelis@example.com', 'Joo, laitetaan!');
  w.prepare('INSERT INTO reply_parts VALUES(?,?,?,?)').run('wamid.m1', 0, 'Joo, laitetaan!', 'r1');
  w.prepare('INSERT INTO reply_parts VALUES(?,?,?,?)').run('wamid.m1', 1, 'Ostoskorissasi nyt:\n- maito 1000 l', 'r2');
  msg('wamid.m2', '53:45', '1', 'Valitse maito: 1) Valio kevytmaito');
  msg('wamid.ok', '54:54', 'ok!', 'Tässä linkki ostoskoriisi:\nhttps://mind.trycloudflare.com/whatsapp/cart#eyJiaW5kaW5nIjoiMGQwY.secret');
  msg('wamid.otherphone', '53:00', 'toisen numeron viesti', 'ei kuulu', 'text', '358409999999');
  w.close();

  const d = new DatabaseSync(files.draftFile);
  d.exec(`CREATE TABLE drafts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, state TEXT NOT NULL, json TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE turn_results (message_id TEXT PRIMARY KEY, conversation TEXT NOT NULL, json TEXT NOT NULL, created INTEGER NOT NULL);`);
  const option = (productId, name, lineNet) => ({ productId, name, brand: 'Valio', salesUnits: 1000, salesUnitLabel: 'kpl', covers: { value: 1000, unit: 'L' }, unitPriceNet: lineNet / 1000,
    lineNet, deliveryDate: '2026-11-18', cutoff: '2026-11-15T17:00:00+0200', stock: null, labels: ['FREE_FROM_LACTOSE'], co2PerKg: 1.1, deliveryReliability: 1, why: null, warning: null });
  const draft = { id: DRAFT, state: 'ordered', revision: 2, customerId: 'cust-private', bindingVersion: 3, deliveryDate: '2026-11-18', deliverySiteId: 'site-1',
    diet: { known: true, claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [] },
    lines: [{ ref: 'L1', productTerm: 'maito', quantity: { value: 1000, unit: 'L' }, claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [], selectedProductId: '464201', selectedName: 'Valio kevytmaito 1 l laktoositon UHT', selectedWarning: null }],
    offered: { L1: [option('463335', 'Valio Eila 3 % maitojuoma 1 l laktoositon', 1400), option('464201', 'Valio kevytmaito 1 l laktoositon UHT', 1560)] },
    seen: { L1: ['463335', '464201'] }, quote: { quoteId: 'Q-final', revision: 2 }, orderId: ORDER_ID, orderStatus: 'confirmed' };
  d.prepare('INSERT INTO drafts VALUES(?,?,?,?,?)').run(DRAFT, CONVERSATION, 'ordered', JSON.stringify(draft), t('55:36'));
  const tr = (id, sec, result) => d.prepare('INSERT INTO turn_results VALUES(?,?,?,?)').run(id, CONVERSATION, JSON.stringify(result), t(sec));
  tr('wamid.old', '40:01', { status: 'ready', text: 'vanha', draftId: 'WD-older', revision: 4 });
  tr('wamid.m1', '52:58', { status: 'collecting', text: 'Joo', draftId: DRAFT, revision: 1 });
  tr('wamid.m2', '53:47', { status: 'choosing', text: 'Valitse', draftId: DRAFT, revision: 2 });
  tr(`cart:${BINDING}:a`, '55:33', { status: 'ready', text: '*Tilausluonnos* yhteensä 1560,00 €', draftId: DRAFT, revision: 2 });
  tr(`cart:${BINDING}:b`, '55:36', { status: 'confirmed', text: `Tilaus ${ORDER_ID} on tallennettu.`, draftId: DRAFT, revision: 2, orderId: ORDER_ID });
  d.close();

  const g = new DatabaseSync(files.gatewayFile);
  g.exec(`CREATE TABLE quotes (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, idem_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, buyer_id TEXT, order_id TEXT, quote_id TEXT, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);`);
  const buyer = `whatsapp-demo-${BINDING}`;
  const quote = { quoteId: 'Q-final', buyerId: buyer, createdAt: '2026-11-15T14:55:33.070Z', deliveryDate: '2026-11-18', needs: [{ ref: 'L1', requested: { quantity: { value: 1000, unit: 'L' }, candidates: 1, rank: 'price' },
    options: [{ optionId: 'OFR-1', kind: 'exact', lines: [{ productId: '464201', gtin: '6408430011667', name: 'Valio kevytmaito 1 l laktoositon UHT', quantity: 1000, salesUnitLabel: 'kpl', unitPriceNet: 1.56, lineNet: 1560, vatRate: 13.5,
      availability: { logisticModel: 'Stock', stock: null, stockKnown: false, deliveryDate: '2026-11-16' }, closingTime: '2026-11-15T17:00:00+0200', allergens: ['AM'], deliveryReliability: 1, co2PerKg: 1.1, priceSource: 'live' }],
      totals: { net: 1560, vat: 210.6, gross: 1770.6 }, deliveryDate: '2026-11-18', cutoffLabel: 'su 15.11. klo 17.00', flags: ['STOCK_UNKNOWN'], mandatePreview: { status: 'confirmed', reasons: [] },
      expiresAt: '2026-11-15T15:00:00.000Z', offer: 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJzZWNyZXQifQ.c2lnbmF0dXJl' }] }] };
  g.prepare('INSERT INTO quotes VALUES(?,?,?,?)').run('Q-early', buyer, '2026-11-15T14:54:45.078Z', '{}');
  g.prepare('INSERT INTO quotes VALUES(?,?,?,?)').run('Q-final', buyer, quote.createdAt, JSON.stringify(quote));
  g.prepare('INSERT INTO quotes VALUES(?,?,?,?)').run('Q-other', 'whatsapp-demo-other-binding', quote.createdAt, '{}');
  const order = { orderId: ORDER_ID, buyerId: buyer, buyerName: 'Private Buyer Name', idempotencyKey: 'wa-secret-idem', buyerReference: `whatsapp:${DRAFT}`, requestedBy: 'Private Person',
    createdAt: orderCreatedAt, deliveryDate: '2026-11-18', requestedDeliveryDate: '2026-11-18', cutoffLabel: 'su 15.11. klo 17.00', status: 'confirmed',
    lines: [{ productId: '464201', gtin: '6408430011667', quantity: 1000, salesUnit: 'ST', salesUnitLabel: 'kpl', unitPriceNet: 1.56, vatRate: 13.5, lineNet: 1560, name: 'Valio kevytmaito 1 l laktoositon UHT', allergens: ['AM'] }],
    totals: { net: 1560, vat: 210.6, gross: 1770.6 }, offers: [{ offerId: 'OFR-1', quoteId: 'Q-final', kind: 'exact' }], commit: { simulated: true } };
  g.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(ORDER_ID, buyer, 'wa-secret-idem', 'confirmed', order.createdAt, JSON.stringify(order));
  const ledger = (type, actor, payload, { quote = null, orderId = null } = {}) => g.prepare('INSERT INTO ledger(ts,actor,type,buyer_id,order_id,quote_id,payload,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('2026-11-15T14:55:34.000Z', actor, type, buyer, orderId, quote, JSON.stringify(payload), '0'.repeat(64), 'ab'.repeat(32));
  ledger('QUOTE_REQUESTED', `agent:${buyer}`, { deliveryDate: '2026-11-18', needs: [{ ref: 'L1', quantity: { value: 1000, unit: 'L' }, candidates: 1 }], productsPriced: 1, priceSource: 'live' }, { quote: 'Q-final' });
  ledger('OFFER_ISSUED', 'gateway', { offerId: 'OFR-1', kind: 'exact', net: 1560, lines: ['464201 × 1000 kpl'], flags: ['STOCK_UNKNOWN'], expiresAt: '2026-11-15T15:00:00.000Z' }, { quote: 'Q-final' });
  ledger('QUOTE_REQUESTED', 'agent:whatsapp-demo-other-binding', { deliveryDate: '2026-11-19', needs: [], productsPriced: 0 }, { quote: 'Q-other' });
  ledger('ORDER_RECEIVED', `agent:${buyer}`, { offers: 1, idempotencyKey: 'wa-secret-idem', buyerReference: `whatsapp:${DRAFT}` }, { orderId: ORDER_ID });
  ledger('OFFER_VERIFIED', 'gateway', { offers: ['OFR-1'], failures: [], algorithm: 'EdDSA (Ed25519)' }, { orderId: ORDER_ID });
  ledger('MANDATE_EVALUATED', 'policy', { approvalLevel: 'exceptions', outcome: 'confirmed', reasons: [] }, { orderId: ORDER_ID });
  ledger('ORDER_CONFIRMED', 'gateway', { net: 1560, reasons: [] }, { orderId: ORDER_ID });
  g.close();
  return files;
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-trace-'));

test('trace reader copies only the conversation, interpretation, options and gateway checks of one order', () => {
  const dir = tempDir();
  try {
    const now = Date.now();
    const trace = readAgentTrace({ orderId: ORDER_ID, ...fixture(dir), ledgerHead: 'c'.repeat(64), now });
    const text = JSON.stringify(trace);
    for (const secret of [PHONE, BINDING, 'Private Person', 'Private Buyer Name', 'wa-secret-idem', DRAFT, 'cust-private', 'trycloudflare', 'eyJ', 'wamid', 'eelis@example', '040 123 4567', 'Testikeittiö Oy', 'toisen numeron', 'vanha viesti', 'hash-of-code', 'gtin', 'whatsapp-demo-'])
      assert.doesNotMatch(text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), secret);
    assert.deepEqual(trace.turns.map((x) => [x.source, x.customer || x.action, x.revision]), [
      ['whatsapp', 'no terve!', null],
      ['whatsapp', 'tarvittisin 1000 litraa maitoo, soita [numero] tai [sähköposti]', 1],
      ['whatsapp', '1', 2],
      ['whatsapp', 'ok!', null],
      ['cart', 'Tarkisti ostoskorin', 2],
      ['cart', 'Vahvisti demotilauksen ostoskorisivulla', 2],
    ]);
    assert.deepEqual(trace.turns[1].replies, ['Joo, laitetaan!', 'Ostoskorissasi nyt:\n- maito 1000 l']);
    assert.equal(trace.turns[3].replies[0], 'Tässä linkki ostoskoriisi:\n[linkki]');
    assert.deepEqual(trace.understood.lines[0].quantity, { value: 1000, unit: 'L' });
    assert.deepEqual(trace.options[0].shown.map((o) => [o.productId, o.selected]), [['463335', false], ['464201', true]]);
    assert.equal(trace.quotes.count, 2);
    assert.equal(trace.quotes.final.needs[0].options[0].signed, true);
    assert.equal(trace.quotes.final.needs[0].options[0].lines[0].priceSource, 'live');
    assert.deepEqual(trace.ledger.events.map((e) => [e.type, e.actor]), [['QUOTE_REQUESTED', 'agent'], ['OFFER_ISSUED', 'gateway'], ['ORDER_RECEIVED', 'agent'],
      ['OFFER_VERIFIED', 'gateway'], ['MANDATE_EVALUATED', 'policy'], ['ORDER_CONFIRMED', 'gateway']]);
    assert.deepEqual(trace.ledger.events[2].detail, { offers: 1 });
    assert.deepEqual(trace.ledger.events[3].detail, { offers: 1, failures: 0, algorithm: 'EdDSA (Ed25519)' });
    assert.equal(trace.order.net, 1560);
    assert.equal(readAgentTrace({ orderId: 'AGW-20261115-9999', ...fixture(tempDir()), now }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Worker refuses links, numbers and private fields even from the publisher', () => {
  const now = Date.now();
  const base = { version: 1, orderId: ORDER_ID, observedAt: now, order: {}, understood: {}, quotes: {}, ledger: {}, options: [],
    turns: [{ at: '2026-11-15T14:52:56.000Z', source: 'whatsapp', customer: 'maitoa', action: null, replies: ['Joo'], status: null, revision: null }] };
  assert.equal(parseAgentTrace(base, now).orderId, ORDER_ID);
  const bad = [
    { ...base, turns: [{ ...base.turns[0], replies: ['https://x.trycloudflare.com/whatsapp/cart#eyJ'] }] },
    { ...base, turns: [{ ...base.turns[0], customer: 'soita +358 40 123 4567' }] },
    { ...base, order: { phone: '1' } },
    { ...base, ledger: { events: [{ detail: { idempotencyKey: 'x' } }] } },
    { ...base, observedAt: now - 3600_000 },
    { ...base, orderId: 'AGW-1' },
    { ...base, turns: [] },
  ];
  for (const value of bad) assert.throws(() => parseAgentTrace(value, now));
  assert.equal(redact('soita 0401234567, sivu https://a.b/c ja AGW-20261115-0008 sekä 1560,00 €'), 'soita [numero], sivu [linkki] ja AGW-20261115-0008 sekä 1560,00 €');
});

test('publisher → order → demo payment link → "Katso, mitä agentti näki" trace, readable only with that link', async () => {
  const dir = tempDir();
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) {
    let params = [];
    return { bind(...values) { params = values; return this; }, async first() { return db.prepare(sql).get(...params) || null; },
      async run() { await null; return { meta: { changes: db.prepare(sql).run(...params).changes } }; } };
  } };
  const origin = 'https://demo.example', token = 'isolated-trace-' + 'a'.repeat(40);
  const env = { DB, SYNC_TOKEN: token, WEBCHAT_SECRET: 'isolated-webchat-' + 'w'.repeat(40), DEMO_PAYMENTS_ENABLED: 'true' };
  const fetcher = (url, init) => worker.fetch(new Request(url, init), env);
  try {
    const files = fixture(dir, { orderCreatedAt: new Date(Date.now() - 60_000).toISOString() });
    const order = { orderId: ORDER_ID, status: 'confirmed', channel: 'whatsapp', createdAt: new Date(Date.now() - 60_000).toISOString(), deliveryDate: '2026-11-18', net: 1560, lineCount: 1,
      lines: [{ productId: '464201', name: 'Valio kevytmaito 1 l laktoositon UHT', quantity: 1000, unit: 'kpl', net: 1560 }] };
    const fresh = { ...order, orderId: 'AGW-20261115-0043', createdAt: new Date().toISOString() };
    const browser = { ...order, orderId: 'AGW-20261115-0044', channel: 'browser-demo' };
    const snapshot = { version: 1, observedAt: Date.now(), totalOrders: 3, ledgerHead: 'c'.repeat(64), orders: [fresh, order, browser] };
    await publishOnce({ url: origin, token, snapshot, fetcher });
    await pushOrderEvents({ url: origin, token, snapshot: { ...snapshot, orders: [order] }, known: new Set(), fetcher });

    const read = (orderId) => readAgentTrace({ orderId, ...files, ledgerHead: snapshot.ledgerHead });
    const known = new Set();
    const pushed = await pushAgentTraces({ url: origin, token, snapshot, known, read, fetcher });
    // The just-confirmed order waits until its cart turn has been stored; an order without a stored conversation is skipped once.
    assert.deepEqual(pushed.map((p) => [p.orderId, p.skipped || null]), [[ORDER_ID, null], ['AGW-20261115-0044', 'conversation_missing']]);
    assert.equal(pushed[0].turns, 6);
    assert.deepEqual(await pushAgentTraces({ url: origin, token, snapshot, known, read, fetcher }), []);
    await assert.rejects(pushAgentTraces({ url: origin, token: 'wrong-token-'.repeat(4), snapshot, known: new Set(), read, fetcher }), /HTTP 401/);

    const publicOrders = await (await fetcher(`${origin}/api/orders`)).text();
    assert.doesNotMatch(publicOrders, /no terve|turns|ostoskorisivulla|AGW-/);
    // Tilaajan oma linkki avaa myös agentin jäljen.
    const id = ORDER_ID, capability = await orderLinkToken(env, ORDER_ID, order.createdAt);
    const traceRead = (auth) => fetcher(`${origin}/api/agent-traces/${id}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
    assert.equal((await traceRead()).status, 404);
    assert.equal((await traceRead('A'.repeat(43))).status, 404);
    const response = await traceRead(capability);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { trace } = await response.json();
    assert.equal(trace.orderId, ORDER_ID);
    assert.equal(trace.turns[5].action, 'Vahvisti demotilauksen ostoskorisivulla');

    // An older observation never replaces a newer one; a newer one does.
    const stored = () => db.prepare('SELECT observed_at FROM agent_traces').get().observed_at;
    const first = stored();
    const post = (body) => fetcher(`${origin}/api/agent-traces`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await (await post({ ...trace, observedAt: first - 1000 })).json()).updated, false);
    assert.equal(stored(), first);
    assert.equal((await (await post({ ...trace, observedAt: first + 1000 })).json()).updated, true);
    assert.equal((await post({ ...trace, observedAt: first + 2000, order: { phone: PHONE } })).status, 400);
    assert.equal((await fetcher(`${origin}/api/agent-traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    // No payment link → no trace, even when one is stored.
    assert.equal((await fetcher(`${origin}/api/agent-traces/AGW-20261115-0043`, { headers: { authorization: `Bearer ${capability}` } })).status, 404);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
