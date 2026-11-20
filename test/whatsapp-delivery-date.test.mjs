import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-delivery-date-'));
process.env.AIMO_DB = path.join(dir, 'prices.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.AIMO_CATALOG = path.join(dir, 'catalog.json');
process.env.VALIO_API_KEY = 'isolated-fixture';
process.env.VALIO_API_BASE = 'https://supplier.invalid';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
process.env.GATEWAY_PRIVATE_KEY_PEM = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
fs.writeFileSync(process.env.AIMO_CATALOG, JSON.stringify([
  { id: '460013', name: 'Testimaito 1 l', category: 'fixture', salesUnit: 'PCE', perSales: 1, litres: 1, step: 1,
    contains: [], mayContain: [], labels: [], temp: 'chilled', reliability: 0.99 },
]));

const { requestQuote, placeOrder } = await import('../server/gateway/service.mjs');
const { DEFAULT_MANDATE } = await import('../server/gateway/mandate.mjs');
const { verifyOffer } = await import('../server/gateway/signing.mjs');
const { clearApiCache } = await import('../server/valioApi.mjs');

test('supplier earliest availability preserves the customer date through signed offer and order', async (t) => {
  const originalFetch = globalThis.fetch;
  let availableDate = '2026-11-16';
  const requestedDates = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://supplier.invalid/api/'), 'no external supplier requests');
    const body = JSON.parse(init.body); requestedDates.push(body.requestedDate);
    const products = body.products.map((productId) => String(url).endsWith('/availability')
      ? { productId, salesBlock: false, logisticModel: 'Stock', closingTime: '2026-11-20T12:00:00+02:00',
        scheduleLines: [{ availableDate, availableAmount: 100, salesBlock: false, salesUnit: 'PCE' }] }
      : { productId, quantity: 1, error: false, netPriceFound: true,
        catalogPrice: { value: 2, valueWithTax: 2.27 }, tax: { taxRate: 13.5 } });
    return new Response(JSON.stringify({ products }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); });
  const buyer = { id: 'delivery-fixture', name: 'Testikeittiö', mandate: { ...DEFAULT_MANDATE, approval: 'autonomous' } };
  const input = { deliveryDate: '2026-11-18', needs: [{ ref: 'milk', candidates: ['460013'], quantity: { value: 2, unit: 'PCS', basis: 'sales' }, allowSubstitutes: false }] };

  for (const [earliest, expected, status] of [
    ['2026-11-16', '2026-11-18', 'confirmed'],
    ['2026-11-18', '2026-11-18', 'confirmed'],
    ['2026-11-20', '2026-11-20', 'pending_approval'],
  ]) {
    await t.test(`earliest ${earliest}, requested 18 November`, async () => {
      availableDate = earliest; clearApiCache();
      const quote = await requestQuote(buyer, input);
      const option = quote.needs[0].options[0];
      assert.equal(option.deliveryDate, expected);
      assert.equal(option.lines[0].availability.deliveryDate, earliest, 'supplier availability stays factual');
      const signed = verifyOffer(option.offer);
      assert.equal(signed.ok, true);
      assert.equal(signed.payload.deliveryDate, expected);
      assert.equal(signed.payload.requested.deliveryDate, '2026-11-18');
      assert.equal(option.flags.includes('DELIVERY_DATE_SHIFT'), earliest > '2026-11-18');
      const order = await placeOrder(buyer, { offers: [option.offer], idempotencyKey: `delivery-${earliest}` });
      assert.equal(order.deliveryDate, expected);
      assert.equal(order.requestedDeliveryDate, '2026-11-18');
      assert.equal(order.status, status);
    });
  }

  await t.test('fresh availability cannot move beyond the signed delivery date without a new offer', async () => {
    availableDate = '2026-11-16'; clearApiCache();
    const quote = await requestQuote(buyer, input);
    availableDate = '2026-11-20';
    const order = await placeOrder(buyer, { offers: [quote.needs[0].options[0].offer], idempotencyKey: 'delivery-became-late' });
    assert.equal(order.status, 'rejected');
    assert.ok(order.reasons.some((r) => r.code === 'OFFER_STALE'));
  });
  assert.ok(requestedDates.length > 0);
  assert.ok(requestedDates.every((date) => date === '2026-11-18'));
});
