// Katselmoinnin (docs/parallel/code-audit-2026-11-15-ilta.md) tilaus- ja hintaviat #6, #7, #15 ja #24 (gatewayn puoli).
// Väliaikaiset kannat ja avaimet, simuloitu toimittajarajapinta. Ei Meta-, Valio- tai mallikutsuja.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const run = promisify(execFile);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-audit-b-'));
const catalog = path.join(dir, 'catalog.json');
fs.writeFileSync(catalog, JSON.stringify([
  { id: '460013', name: 'Testimaito 1 l', category: 'fixture', salesUnit: 'PCE', perSales: 1, litres: 1, step: 1, contains: [], mayContain: [], labels: [], temp: 'chilled', reliability: 0.99 },
]));
const privateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const baseEnv = { AIMO_CATALOG: catalog, VALIO_API_KEY: 'isolated-fixture', VALIO_API_BASE: 'https://supplier.invalid', ANTHROPIC_API_KEY: '',
  DEMO_NOW: '2026-11-14T10:00:00+02:00', GATEWAY_PRIVATE_KEY_PEM: privateKey, VALIO_FALLBACK: '' };
Object.assign(process.env, baseEnv, { AIMO_DB: path.join(dir, 'prices.db'), GATEWAY_DB: path.join(dir, 'gateway.db') });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const helper = new URL('./helpers/audit-b-orders.mjs', import.meta.url).pathname;
async function child(mode, env) {
  const { stdout } = await run(process.execPath, ['--disable-warning=ExperimentalWarning', helper, mode], { env: { ...process.env, ...baseEnv, ...env }, timeout: 60_000 });
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

function assertRace(r) {
  // #6: kaksi ostajaa yhtä aikaa → eri numerot, molemmat tallessa omalla ostajallaan, uusinta palauttaa oman tilauksen.
  const [a, b] = r.twoBuyers;
  assert.notEqual(a.orderId, b.orderId);
  assert.equal(a.status, 'confirmed'); assert.equal(b.status, 'confirmed');
  assert.equal(r.stored[a.orderId].buyerId, a.buyerId);
  assert.equal(r.stored[b.orderId].buyerId, b.buyerId);
  assert.equal(r.retryA.orderId, a.orderId); assert.equal(r.retryA.buyerId, a.buyerId); assert.equal(r.retryA.duplicate, true);
  // Sama tarjous kahdella avaimella: yksi vahvistuu, toinen hylätään kertakäyttöisyyden vuoksi.
  const statuses = r.sameOffer.map((o) => o.status).sort();
  assert.deepEqual(statuses, ['confirmed', 'rejected']);
  assert.ok(r.sameOffer.find((o) => o.status === 'rejected').reasons.includes('OFFER_ALREADY_USED'));
  // Sama pyyntö kahdesti: yksi tilaus, toinen on sen kopio.
  assert.equal(r.sameRequest[0].orderId, r.sameRequest[1].orderId);
  assert.deepEqual(r.sameRequest.map((o) => o.duplicate).sort(), [false, true]);
  // Kantaan jäi täsmälleen yksi rivi jokaista eri tilausnumeroa kohden.
  const ids = new Set([...r.twoBuyers, ...r.sameOffer, ...r.sameRequest].map((o) => o.orderId));
  assert.equal(ids.size, 5);
  for (const id of ids) assert.ok(r.stored[id], `${id} tallessa`);
}

test('#6 samanaikaiset tilaukset: node:sqlite-kanta', async () => {
  assertRace(await child('race', { GATEWAY_DB: path.join(dir, 'race-local.db'), AIMO_DB: path.join(dir, 'race-local-prices.db'), AUDIT_B_TAG: 'local' }));
});

test('#6 samanaikaiset tilaukset: Turso/libsql-polku (file:-osoite saman taustasäikeen kautta kuin libsql://)', async () => {
  assertRace(await child('race', { GATEWAY_DB: `file:${path.join(dir, 'race-remote.db')}`, AIMO_DB: path.join(dir, 'race-remote-prices.db'), AUDIT_B_TAG: 'remote' }));
});

test('#6 kaksi prosessia samassa kannassa: kaikki numerot eri, kaikki tilaukset tallessa', async () => {
  const gatewayFile = path.join(dir, 'shared.db');
  const results = await Promise.all(['p1', 'p2', 'p3'].map((tag) => child('burst', { GATEWAY_DB: gatewayFile, AIMO_DB: path.join(dir, `shared-${tag}-prices.db`), AUDIT_B_TAG: tag, AUDIT_B_COUNT: '4' })));
  const placed = results.flatMap((r) => r.placed);
  assert.equal(placed.length, 12);
  assert.equal(new Set(placed.map((o) => o.orderId)).size, 12);
  const db = new DatabaseSync(gatewayFile, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n, 12);
    // Päätösketju on yhä yksi ehjä ketju, vaikka kolme prosessia kirjoitti siihen yhtä aikaa.
    let prev = '0'.repeat(64);
    for (const row of db.prepare('SELECT * FROM ledger ORDER BY seq').all()) {
      assert.equal(row.prev_hash, prev);
      prev = crypto.createHash('sha256').update(`${prev}|${row.ts}|${row.actor}|${row.type}|${row.buyer_id || ''}|${row.order_id || ''}|${row.quote_id || ''}|${row.payload}`).digest('hex');
      assert.equal(row.hash, prev);
    }
  } finally { db.close(); }
});

// Loput samassa prosessissa: simuloitu toimittaja, jonka hinnan ja virheen voi vaihtaa kesken testin.
const { requestQuote, placeOrder } = await import('../server/gateway/service.mjs');
const { orders, wipeGateway } = await import('../server/gateway/store.mjs');
const { DEFAULT_MANDATE } = await import('../server/gateway/mandate.mjs');
const { clearApiCache, resetApiBreaker } = await import('../server/valioApi.mjs');
const supplier = { price: 2, down: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://supplier.invalid/api/'), 'ei ulkoisia kutsuja');
  if (supplier.down) throw new Error('supplier down');
  const body = JSON.parse(init.body);
  const products = body.products.map((productId) => (String(url).endsWith('/availability')
    ? { productId, salesBlock: false, logisticModel: 'Stock', closingTime: '2026-11-21T12:00:00+02:00', scheduleLines: [{ availableDate: body.requestedDate, availableAmount: 500, salesBlock: false, salesUnit: 'PCE' }] }
    : { productId, quantity: 1, error: false, netPriceFound: true, catalogPrice: { value: supplier.price, valueWithTax: supplier.price * 1.135 }, tax: { taxRate: 13.5 } }));
  return new Response(JSON.stringify({ products }), { status: 200, headers: { 'content-type': 'application/json' } });
};
test.after(() => { globalThis.fetch = realFetch; });
const reset = () => { supplier.price = 2; supplier.down = false; process.env.VALIO_FALLBACK = ''; delete process.env.FALLBACK_PRICE_MAX_AGE_HOURS; clearApiCache(); resetApiBreaker(); };
const buyer = (id) => ({ id, name: id, mandate: { ...DEFAULT_MANDATE, approval: 'autonomous' } });
const need = (qty = 2) => [{ ref: 'milk', candidates: ['460013'], quantity: { value: qty, unit: 'PCS', basis: 'sales' }, allowSubstitutes: false }];
const offer = async (b, date = '2026-11-18', qty = 2) => (await requestQuote(b, { deliveryDate: date, needs: need(qty) })).needs[0].options[0];

test('#7 hylkäyksen jälkeen sama avain uudella tarjouksella tekee tilauksen, saman pyynnön uusinta ei tuplaa', async () => {
  reset();
  const b = buyer('idem-7');
  const key = 'wa-draft-123-r4';
  const first = await offer(b);
  supplier.price = 2.5; // hinta muuttuu tarjouksen jälkeen → tuore tarkistus hylkää
  const rejected = await placeOrder(b, { offers: [first.offer], idempotencyKey: key });
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.reasons.some((r) => r.code === 'OFFER_STALE'));
  // Ennen korjausta: "näytä" + TILAA samalla avaimella palautti vanhan hylätyn tilauksen ikuisesti.
  const second = await offer(b);
  const confirmed = await placeOrder(b, { offers: [second.offer], idempotencyKey: key });
  assert.equal(confirmed.status, 'confirmed');
  assert.notEqual(confirmed.orderId, rejected.orderId);
  assert.equal(confirmed.duplicate, undefined);
  const retry = await placeOrder(b, { offers: [second.offer], idempotencyKey: key });
  assert.equal(retry.orderId, confirmed.orderId); assert.equal(retry.duplicate, true);
  const lateRetryOfFirst = await placeOrder(b, { offers: [first.offer], idempotencyKey: key });
  assert.equal(lateRetryOfFirst.orderId, rejected.orderId, 'myöhässä tullut ensimmäisen pyynnön uusinta palauttaa sen oman hylkäyksen');
  // Vahvistetun tilauksen avain uudella sisällöllä ei tilaa toista kertaa (kadonnut vastaus + uusi tarjous).
  const third = await offer(b);
  await assert.rejects(placeOrder(b, { offers: [third.offer], idempotencyKey: key }), (err) => err.status === 409 && err.code === 'IDEMPOTENCY_KEY_REUSED' && err.detail.orderId === confirmed.orderId);
  assert.equal(orders.list(b.id).filter((o) => o.status === 'confirmed').length, 1);
});

test('#7 vanha tallenne ilman sormenjälkeä: vahvistettu palautuu kuten ennen, hylätty ei estä uutta yritystä', async () => {
  reset();
  const b = buyer('idem-legacy');
  const legacy = (orderId, key, status) => orders.save({ orderId, buyerId: b.id, idempotencyKey: key, status, createdAt: '2026-11-14T08:00:00.000Z', reasons: [], history: [], lines: [], totals: null, offers: [] });
  legacy('AGW-20261114-9001', 'legacy-confirmed', 'confirmed');
  legacy('AGW-20261114-9002', 'legacy-rejected', 'rejected');
  const o1 = await offer(b);
  const same = await placeOrder(b, { offers: [o1.offer], idempotencyKey: 'legacy-confirmed' });
  assert.equal(same.orderId, 'AGW-20261114-9001'); assert.equal(same.duplicate, true);
  const fresh = await placeOrder(b, { offers: [o1.offer], idempotencyKey: 'legacy-rejected' });
  assert.equal(fresh.status, 'confirmed'); assert.notEqual(fresh.orderId, 'AGW-20261114-9002');
  assert.ok(Number(fresh.orderId.slice(-4)) > 9002, 'numerointi jatkuu suurimmasta olemassa olevasta');
});

test('#24 gatewayn nollaus ei palauta tilausnumeroita alkuun', async () => {
  reset();
  const b = buyer('wipe-24');
  const before = await placeOrder(b, { offers: [(await offer(b)).offer], idempotencyKey: 'wipe-before' });
  wipeGateway();
  const after = await placeOrder(b, { offers: [(await offer(b)).offer], idempotencyKey: 'wipe-after' });
  assert.equal(after.status, 'confirmed');
  assert.ok(Number(after.orderId.slice(-4)) > Number(before.orderId.slice(-4)), `${after.orderId} > ${before.orderId}`);
});

test('#15 tuore tarkistus ei hyväksy välimuistihintaa hiljaa: merkintä ikärajan sisällä, esto sen yli', async () => {
  reset();
  const b = buyer('price-15');
  const quote = await requestQuote(b, { deliveryDate: '2026-11-18', needs: need() });
  assert.equal(quote.priceOrigin, 'live'); assert.equal(quote.priceSource, 'Valio Aimo Junction API (live)');
  const o = quote.needs[0].options[0];
  assert.equal(o.lines[0].priceSource, 'live'); assert.equal(o.flags.includes('PRICE_NOT_LIVE'), false);
  supplier.down = true; // rajapinta ei vastaa tilaushetkellä: välimuistin hinta on sama, mutta sitä ei ole tarkistettu juuri nyt
  const marked = await placeOrder(b, { offers: [o.offer], idempotencyKey: 'price-stale-ok' });
  assert.equal(marked.status, 'confirmed');
  assert.equal(marked.priceSource, 'stale'); assert.equal(marked.priceCheckedLive, false);
  assert.match(marked.priceFetchedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(marked.reasons.some((r) => r.code === 'PRICE_NOT_LIVE' && r.severity === 'info'));
  assert.equal(marked.lines[0].priceSource, 'stale');
  assert.ok(marked.notifications.some((n) => n.kind === 'fyi'), 'hyväksyjä saa tiedon');

  supplier.down = false; clearApiCache();
  const o2 = await offer(b);
  supplier.down = true; process.env.FALLBACK_PRICE_MAX_AGE_HOURS = '0.000001';
  await new Promise((resolve) => setTimeout(resolve, 20));
  const tooOld = await placeOrder(b, { offers: [o2.offer], idempotencyKey: 'price-stale-too-old' });
  assert.equal(tooOld.status, 'rejected');
  assert.ok(tooOld.reasons.some((r) => r.code === 'PRICE_TOO_OLD' && r.detail.priceSource === 'stale'));
});

test('#15 viimeisin tunnettu hinta (VALIO_FALLBACK=last-known): tarjouksen otsikko, rivi, lippu ja tilaus kertovat sen', async () => {
  reset();
  process.env.VALIO_FALLBACK = 'last-known';
  const b = buyer('price-last-known');
  await offer(b, '2026-11-18'); // oikea vastaus talteen
  supplier.down = true;
  const quote = await requestQuote(b, { deliveryDate: '2026-11-19', needs: need() });
  const o = quote.needs[0].options[0];
  assert.ok(o, 'viimeisin tunnettu hinta kelpaa tarjoukseen ikärajan sisällä');
  assert.equal(quote.priceOrigin, 'last-known');
  assert.doesNotMatch(quote.priceSource, /live/);
  assert.equal(o.lines[0].priceSource, 'last-known'); assert.equal(o.lines[0].priceCurrent, false);
  assert.ok(o.flags.includes('PRICE_NOT_LIVE'));
  assert.equal(o.priceSource, 'last-known');
  const order = await placeOrder(b, { offers: [o.offer], idempotencyKey: 'price-last-known-1' });
  assert.equal(order.status, 'confirmed');
  assert.equal(order.priceSource, 'last-known');
  assert.ok(order.reasons.some((r) => r.code === 'PRICE_NOT_LIVE'));

  process.env.FALLBACK_PRICE_MAX_AGE_HOURS = '0.000001';
  await new Promise((resolve) => setTimeout(resolve, 20));
  const old = await requestQuote(b, { deliveryDate: '2026-11-20', needs: need() });
  assert.equal(old.needs[0].options.length, 0);
  assert.ok(old.needs[0].excluded.some((e) => e.code === 'PRICE_TOO_OLD'));

  // Suljetun testirajapinnan demo: "none" poistaa ikärajan, joten sama vanha hinta kelpaa taas merkittynä.
  process.env.FALLBACK_PRICE_MAX_AGE_HOURS = 'none';
  const kept = await requestQuote(b, { deliveryDate: '2026-11-20', needs: need() });
  assert.ok(kept.needs[0].options.length > 0, 'none: vanha viimeisin tunnettu hinta ei vanhene');
  assert.equal(kept.priceOrigin, 'last-known');
});
