// WhatsApp-kokeen 17.11. avoimet löydökset (docs/evaluations/whatsapp-chaos-20261117.md), toinen korjauskierros.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-chaos-2-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
const { boxSize } = await import('../server/catalog.mjs');
const { compareKind, invalidDate, popularityCounts, repeatFactor } = await import('../server/order-conversation/index.mjs');
const { bigQuantities } = await import('../server/whatsapp/dialogue.mjs');
const { guardModelText } = await import('../server/whatsapp/model-guard.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const CATALOG = new URL('../data/catalog.json', import.meta.url);
const date = '2026-11-16';
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', personName: 'Testi', permissions: { readProducts: true, placeOrders: true } };
const draftOf = (line) => ({ id: 'd1', revision: 1, deliveryDate: date, lines: [{ ref: 'a', claims: [], excludeAllergens: [], ...line }] });
const option = (id, extra = {}) => ({ id, name: `Tuote ${id}`, qty: 1, unitLabel: 'ltk', price: 10, labels: [], availability: { deliveryDate: date, stock: 50 }, ...extra });
const tools = (found, extra = {}) => createOrderingTools({ now: () => Date.parse('2026-11-14T08:00:00Z'), product: () => ({ hasAllergenData: true, contains: [] }),
  buyer: (id) => ({ id }), search: async () => found, requestQuote: async () => ({}), placeOrder: async () => ({}), ...extra });

test('laatikon paino nimestä, kun nimen kappalemäärä on laatikon kappalemäärä (voi 4x5 kg ei ole 0,08 kg)', () => {
  const voi = { name: 'Valio voi 4x5 kg HYLA®', salesUnit: 'KI', perSales: 4, kg: 0.08 };
  boxSize(voi); assert.equal(voi.kg, 20);
  for (const p of [
    { name: 'Salliselta Kuivahiiva ruokaleivälle 20x500g', salesUnit: 'PAK', perSales: 1, kg: 0.5 }, // pakkaus, ei laatikko
    { name: 'Happy Chef Porsaan ulkofile-leike 40x180g', salesUnit: 'KI', perSales: 1, kg: 0.18 }, // laatikon kappalemäärä ei täsmää
    { name: 'Valio Eila voi 4x5 kg laktoositon', salesUnit: 'ST', perSales: 1, kg: 20 }, // jo oikein
    { name: 'Leivos 30x60g', salesUnit: 'KI', perSales: 30, kg: 1.8 }, // jo oikein
  ]) { const before = p.kg; boxSize(p); assert.equal(p.kg, before, p.name); }
});

test('oikea katalogi: 500 kg voita on 25 laatikkoa à 20 kg', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  for (const id of ['476731', '464205']) assert.equal(loadCatalog().get(id).kg, 20, id);
});

test('kiloina pyydetty tuote ei ole saman nimisen maun juoma (suklaa ≠ suklaakaurajuoma), pelkkä mitan ero ei pudota', async () => {
  const drink = option('1', { name: '18x Oatly Kaurajuoma Suklaa 2,5dl', litres: 4.5, match: 1 });
  const bar = option('2', { name: 'Fazer tumma leivontasuklaa 2 kg', kg: 2, qty: 2, match: 0 });
  const s = await tools([drink, bar]).suggest({ customer, draft: draftOf({ productTerm: 'suklaa', quantity: { value: 3, unit: 'KG' } }) });
  assert.deepEqual(s.lines[0].options.map((o) => o.productId), ['2']);
  // Jäätelö kiloina litroina myytävästä tuotteesta: tuote itse (match 0), joten se jää vaihtoehdoksi.
  const ice = option('3', { name: 'Jäätelö vanilja 5 l', litres: 5, match: 0 });
  const t = await tools([ice]).suggest({ customer, draft: draftOf({ productTerm: 'jäätelö', quantity: { value: 5, unit: 'KG' } }) });
  assert.deepEqual(t.lines[0].options.map((o) => o.productId), ['3']);
});

test('suosituin asiakkaidemme tilauksista tulee ensimmäiselle sivulle ja merkitään, halvin pysyy mukana', async () => {
  const found = ['1', '2', '3', '4', '5'].map((id, i) => option(id, { litres: 10, price: 5 + i }));
  const counts = new Map([['5', 4], ['2', 1]]);
  const s = await tools(found, { popularity: async () => counts }).suggest({ customer, draft: draftOf({ productTerm: 'maito', quantity: { value: 10, unit: 'L' } }) });
  const ids = s.lines[0].options.map((o) => o.productId);
  assert.ok(ids.includes('5') && ids.includes('1'), ids.join());
  assert.equal(s.lines[0].options.find((o) => o.productId === '5').popular, true);
  assert.equal(s.lines[0].options.find((o) => o.productId === '1').orderedCount, 0);
  // Ilman suosittuustietoa järjestys ja kentät ennallaan.
  const plain = await tools(found).suggest({ customer, draft: draftOf({ productTerm: 'maito', quantity: { value: 10, unit: 'L' } }) });
  assert.equal(plain.lines[0].options.some((o) => 'orderedCount' in o || o.popular), false);
  // Laskenta: vain vahvistetut tilaukset, tuote kerran tilausta kohden.
  const orders = [{ status: 'confirmed', lines: [{ productId: '5', quantity: 2 }, { productId: '5', quantity: 1 }] }, { status: 'confirmed', lines: [{ productId: '5', quantity: 1 }] }, { status: 'rejected', lines: [{ productId: '5', quantity: 1 }] }];
  assert.deepEqual([...popularityCounts(orders)], [['5', 2]]);
  for (const q of ['mikä näistä on suosituin?', 'mitä muut keittiöt yleensä tilaa', 'mitä tilataan eniten']) assert.equal(compareKind(q), 'popular', q);
});

test('"sama ku viimeks mut tuplana": kerroin määriin; tuotteen oma "10 x 2 kg" ei ole kerroin', () => {
  assert.equal(repeatFactor('sama ku viimeks mut tuplana'), 2);
  assert.equal(repeatFactor('sama kuin viimeksi x3'), 3);
  assert.equal(repeatFactor('sama ku viimeks mut puolet'), 0.5);
  assert.equal(repeatFactor('sama kuin viimeksi'), 1);
  assert.equal(repeatFactor('sama ku viimeks, 10 x 2 kg voita'), 1);
});

test('mahdoton päivämäärä kerrotaan, desimaaliluku ei ole päivämäärä', () => {
  assert.equal(invalidDate('31.2.'), '31.2.');
  assert.equal(invalidDate('32.11.'), '32.11.');
  for (const t of ['18.11.', 'pe 20.11.', '29.2.', '1.75 l maitoa', '2.13 kg', 'kaksi kiloa']) assert.equal(invalidDate(t), null, t);
});

test('hyvin iso määrä varmistetaan kerran', () => {
  const prev = { id: 'd', lines: [{ ref: 'L1', productTerm: 'maito', quantity: { value: 15, unit: 'L' } }] };
  const cur = { id: 'd', lines: [prev.lines[0], { ref: 'L2', productTerm: 'vehnäjauho', quantity: { value: 12000, unit: 'KG' } }, { ref: 'L3', productTerm: 'voi', quantity: { value: 50, unit: 'KG' } }] };
  const big = bigQuantities(prev, cur);
  assert.deepEqual(big.map((b) => b.label), ['vehnäjauho 12 000 kg']);
  assert.deepEqual(bigQuantities(prev, cur, big.map((b) => b.key)), []);
  assert.deepEqual(bigQuantities(cur, cur), []); // muuttumaton rivi ei kysy uudelleen
});

test('malli ei lupaa kykyä, jota apurilla ei ole', () => {
  assert.equal(guardModelText('Joo, pidetään ke 18.11. Voin kysyä asiakaspalvelusta, onko pikatoimitusta mahdollista.').text, 'Joo, pidetään ke 18.11.');
  assert.equal(guardModelText('Joo, voidaan yrittää: kokonainen norjalainen lohifilee.').text, '');
  for (const ok of ['Tarkistan vielä maidon: tarkoitatko 30 vai 10?', 'Asiakaspalvelu auttaa pikatoimituksissa.', 'Voin auttaa ostoslistan kanssa.']) assert.equal(guardModelText(ok).text, ok);
});
