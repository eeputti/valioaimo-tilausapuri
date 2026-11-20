import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-storefront-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
const { orderableProduct, validDeliveryDate, searchStorefront, reviewStorefront } = await import('../server/storefront.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const date = '2026-11-16';
const p = { id: 'test', name: 'Kerma', salesUnit: 'ST', litres: 1, lot: 0.01 };
const quote = (avail = {}, price = {}) => ({ avail: { status: 'ok', date, amount: 100, closingTime: '2026-11-15T17:00:00+02:00', ...avail }, price: { net: 2, vatRate: 13.5, ...price } });
const assess = (q, quantity = { value: 20, unit: 'L' }) => orderableProduct(p, q, date, quantity);

test('haku hyväksyy pyydetyksi päiväksi ehtivän toimituksen, avoimen tilausajan ja tuoreen saatavuuden', () => {
  assert.equal(assess(quote()).ok, true);
  // Rajapinta ilmoittaa aikaisimman toimituspäivän: aikaisempi päivä ehtii myös pyydetyksi päiväksi.
  assert.equal(assess(quote({ date: '2026-11-15' })).ok, true);
  for (const avail of [
    { status: 'out' }, { status: 'late', date: '2026-11-17' }, { status: 'unknown' }, { status: 'blocked' },
    { date: '2026-11-17' }, { date: null }, { stale: true },
    { closingTime: '2026-11-14T09:00:00+02:00' },
  ]) assert.equal(assess(quote(avail)).ok, false, JSON.stringify(avail));
  for (const price of [{ error: true }, { stale: true }, { net: null }, { net: NaN }]) assert.equal(assess(quote({}, price)).ok, false);
});

test('pyydetty määrä pyöristyy myyntieriin ja riittämätön saldo karsitaan', () => {
  assert.equal(assess(quote(), { value: 20.2, unit: 'L' }).product.qty, 21);
  assert.equal(assess(quote({ amount: 20 }), { value: 20.2, unit: 'L' }).code, 'INSUFFICIENT_STOCK');
  assert.equal(assess(quote({ amount: null })).product.availability.stock, null);
  assert.equal(assess(quote(), { value: 5, unit: 'KG' }).code, 'UNIT_NOT_CONVERTIBLE');
  const bulk = orderableProduct({ ...p, kg: 20 }, quote({}, { net: 37.35, comparison: 7.47, comparisonUnit: 'KG' }), date, { value: 10, unit: 'KG' });
  assert.equal(bulk.product.qty, 2, 'vertailuhinta osoittaa 5 kg:n myyntiyksikön');
});

test('virheellistä päivämäärää ei normalisoida toiseksi päiväksi', () => {
  assert.equal(validDeliveryDate(date), true);
  for (const d of ['2026-02-30', '2026-13-01', '16.11.2026', null]) assert.equal(validDeliveryDate(d), false);
});

test('ostoslista palauttaa vain hinnoitellut ja riittävät tuotteet ja säilyttää ruokavalion', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const r = await searchStorefront('20 l laktoositonta maitoa 16.11.2026', { llm: false });
  assert.equal(r.deliveryDate, date);
  assert.ok(r.cards[0].list.length > 0);
  for (const p of r.cards[0].list) {
    assert.equal(p.availability.deliveryDate, date);
    assert.equal(p.availability.status, 'ok');
    assert.ok(p.labels.includes('FREE_FROM_LACTOSE'));
    assert.ok(p.availability.stock == null || p.availability.stock >= p.qty);
    assert.ok(Number.isFinite(p.price));
  }
  assert.equal(r.cards[0].total, r.cards[0].list.length);
  const review = await reviewStorefront([{ id: r.cards[0].list[0].id, qty: 999999 }], date);
  // Valittu tuote voi ilmoittaa tuntemattoman saldon; silloin se kerrotaan avoimesti.
  if (r.cards[0].list[0].availability.stock != null) assert.equal(review.ok, false);
});

test('puuttuva ruokavalio-osuma ei palauta ehtoja rikkovaa lähiosumaa', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const r = await searchStorefront('vegaanista maitoa 20 l 16.11.2026', { llm: false });
  for (const p of r.cards.flatMap((c) => c.list)) assert.ok(p.labels.includes('VEGAN'));
});

test('korin osasaldon korvaaja kattaa koko tarpeen, eikä osatoimitus katoa laskennasta', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const r = await reviewStorefront([{ id: '460131', qty: 10 }], date);
  assert.equal(r.ok, false);
  const line = r.lines[0];
  assert.equal(line.code, 'INSUFFICIENT_STOCK');
  assert.equal(line.availability.stock, 6);
  assert.ok(line.alternatives.length > 0);
  for (const a of line.alternatives) {
    assert.ok(a.qty >= 10, 'koko 10 kg:n tarve korvataan, ei vain puuttuvaa 4 kg:aa');
    assert.equal(a.availability.deliveryDate, date);
    assert.ok(a.availability.stock == null || a.availability.stock >= a.qty);
    assert.ok(!a.why.some((s) => s.startsWith('Alkuperäistä saadaan')));
  }
});

test('puuttuvan kerman korvaaja säilyttää laktoosittomuuden ja näyttää pakkauskoon muutoksen', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const r = await reviewStorefront([{ id: '465193', qty: 10 }], date);
  assert.equal(r.ok, false);
  assert.ok(r.lines[0].alternatives.length > 0);
  for (const a of r.lines[0].alternatives) {
    assert.ok(a.labels.includes('FREE_FROM_LACTOSE'));
    assert.ok(a.warnings.length > 0);
    assert.equal(a.substituteFor.id, '465193');
  }
});

test('munamäärä muuttuu hakutuloksessa pakkauksiksi, mutta korin tarkistus ei jaa määrää uudestaan', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const r = await searchStorefront('100 kananmunaa 16.11.2026', { llm: false });
  const p = r.cards[0].list[0];
  assert.ok(p.quantityExplanation.providedItems >= 100);
  assert.ok(p.qty < 100);
  const review = await reviewStorefront([{ id: p.id, qty: p.qty }], date);
  assert.equal(review.ok, true);
  assert.equal(review.lines[0].product.qty, p.qty);
});

test('hintajärjestys pitää tuoreen kurkun ennen kurkkusalaatteja', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const r = await searchStorefront('5 kg kurkkua 16.11.2026', { llm: false });
  assert.match(r.cards[0].list[0].name, /^kurkku/i);
  assert.ok(!/salaatti/i.test(r.cards[0].list[0].name));
});
