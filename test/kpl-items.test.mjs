// "10 kpl" on kappaleita kaikille tuotteille, ei vain munille (selainkokeilu 17.11.): leivoslaatikko 30x60g ja "10 kpl"
// näytti "10 laatikkoa, 555,50 €". Nyt 10 kpl leivoksia on yksi 30 leivoksen laatikko, ja ylijäämä kerrotaan.
// Pakkaussanat ("2 laatikkoa") ovat edelleen myyntieriä, ja tuntematonta pakkauksen kappalemäärää ei arvata.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-kpl-items-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { itemsPerSalesUnit, quantityBasisFor } = await import('../server/itemQuantities.mjs');
const { unitSizeFor } = await import('../server/gateway/quantity.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createRuleInterpreter, basisFromText } = await import('../server/order-conversation/interpret.mjs');
const { understand } = await import('../server/aimo/understand.mjs');

const LEIVOS = { name: 'Elonen KP Vadelma-valkosuklaaleivos 30x60g', category: '41760', salesUnit: 'KI', baseUnit: 'ST', perSales: 30 };
const HILLO = { name: '6 x Saarioinen Vadelmahillo 500g', category: '22350', salesUnit: 'KI', baseUnit: 'PRK', perSales: 6 };

test('pakkauksen kappaleet Valion yksikkömuunnoksesta, nimi vain vahvistaa', () => {
  assert.deepEqual(itemsPerSalesUnit(LEIVOS), { value: 30, source: 'unit-conversion' });
  assert.deepEqual(itemsPerSalesUnit(HILLO), { value: 6, source: 'unit-conversion' });
  assert.equal(itemsPerSalesUnit({ ...LEIVOS, perSales: 24 }), null, 'nimi 30x ja muunnos 24 ristiriidassa: ei arvata');
  assert.deepEqual(itemsPerSalesUnit({ name: 'Lihapasteija laktoositon 60x90g', salesUnit: 'KI', baseUnit: 'KI', perSales: 1 }), { value: 60, source: 'product-name' });
  assert.equal(itemsPerSalesUnit({ name: 'Herkkusieni 2KG/LTK', salesUnit: 'KI', baseUnit: 'KG', perSales: 2 }), null, 'laatikon kilot eivät ole kappaleita');
  assert.equal(itemsPerSalesUnit({ name: 'Sekalaiset leivokset', salesUnit: 'KI', baseUnit: 'KI', perSales: 1 }), null, 'laatikon sisältö tuntematon');
  assert.deepEqual(itemsPerSalesUnit({ name: 'Valio voi 500 g', salesUnit: 'ST', baseUnit: 'ST', perSales: 1 }), { value: 1, source: 'sales-unit' });
  assert.equal(itemsPerSalesUnit({ name: 'Keitetty kananmuna 1,5kg', category: '10590', salesUnit: 'ST' }), null, 'munien määrä vain ilmoitetusta munamäärästä');
  assert.equal(unitSizeFor({ name: 'Kanan fileesuikale', salesUnit: 'KG' }, null, 'PCS', 'items').value, 1, 'kilotavara: kilot kysytään ytimessä');
  assert.equal(unitSizeFor({ name: 'Kananmuna irto', category: '10590', salesUnit: 'KG' }, null, 'PCS', 'items'), null, 'kilomunat eivät tule munamäärälle');
});

test('kpl ja paljas luku ovat kappaleita kaikille tuotteille, pakkaussanat myyntieriä', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, () => {
  const q = (t) => understand(t).items[0].quantity;
  assert.deepEqual(q('10 kpl leivoksia'), { value: 10, unit: 'PCS', basis: 'items' });
  assert.deepEqual(q('10 leivosta'), { value: 10, unit: 'PCS', basis: 'items' });
  assert.equal(q('2 laatikkoa leivoksia').basis ?? 'sales', 'sales');
  assert.equal(q('12 purkkia hilloa').basis ?? 'sales', 'sales');
  assert.deepEqual(q('100 kananmunaa'), { value: 100, unit: 'PCS', basis: 'items' });
  assert.equal(q('100 rasiaa kananmunia').basis ?? 'sales', 'sales');
  assert.equal(quantityBasisFor({ quantity: { value: 3, unit: 'PCS' }, attributes: {} }, 'kpl'), 'items');
  assert.equal(quantityBasisFor({ quantity: { value: 3, unit: 'PCS' }, attributes: {} }, 'pkt'), 'sales');
  // Mallitulkki jätti basisin tyhjäksi: viestin sana luvun perässä ratkaisee.
  for (const [text, basis] of [['10 kpl', 'items'], ['10', 'items'], ['10 leivosta', 'items'], ['2 laatikkoa', 'sales'], ['3 pkt', 'sales'], ['5 säkkiä sipulia', 'sales']]) assert.equal(basisFromText(text), basis, text);
});

const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const NOW = Date.parse('2026-11-15T09:00:00+02:00');
function setup(optionsFor) {
  const asked = [];
  const tools = {
    suggest: async ({ draft }) => ({ issues: [], lines: draft.lines.map((l) => { asked.push(structuredClone(l.quantity)); return { ref: l.ref, total: 3, clarify: [], exact: true, more: false, options: optionsFor(l) }; }) }),
    quote: async () => ({ ok: false, issues: [{ code: 'QUOTE_FAILED', message: 'Ei tarjousta tässä testissä.' }] }), submit: async () => { throw new Error('ei tilausta'); },
  };
  const store = openDraftStore(':memory:', () => NOW);
  const handleTurn = createOrderingConversation({ store, tools, now: () => NOW, interpretTurn: createRuleInterpreter({ understand }) });
  let n = 0;
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'conv', customer, text, receivedAt: NOW });
  return { say, asked, list: () => store.active('conv') };
}
const box = (id, name, perBox, need, price) => {
  const units = Math.ceil(need / perBox);
  return { productId: id, name, salesUnits: units, salesUnitLabel: 'ltk', covers: { value: units * perBox, unit: 'PCS' }, lineNet: +(units * price).toFixed(2), unitPriceNet: price };
};

test('10 kpl leivoksia: yksi 30 leivoksen laatikko ja ylijäämä kerrotaan', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const f = setup((l) => [box('472410', LEIVOS.name, 30, l.quantity.value, 55.55)]);
  const r = await f.say('10 kpl vadelma-valkosuklaaleivoksia tiistaiksi');
  assert.deepEqual(f.asked.at(-1), { value: 10, unit: 'PCS', basis: 'items' });
  assert.equal(r.status, 'choosing');
  assert.match(r.text, /1 laatikko.*30 kpl/u);
  assert.match(r.text, /55,55 €/u);
  assert.doesNotMatch(r.text, /10 laatikkoa|555,50/u);
  assert.match(r.text, /Tarve on 10 kpl; tämä myyntierä kattaa 30 kpl\./u);
});

test('12 kpl hilloa: kaksi kuuden purkin laatikkoa; "2 laatikkoa" pysyy myyntierinä', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const f = setup((l) => [l.quantity.basis === 'items' ? box('H1', HILLO.name, 6, l.quantity.value, 18) : { ...box('H1', HILLO.name, 1, l.quantity.value, 18), covers: null }]);
  const r = await f.say('12 kpl vadelmahilloa tiistaiksi');
  assert.match(r.text, /2 laatikkoa à 6 kpl, yhteensä 12 kpl, 36,00 €/u);
  const g = setup((l) => [{ ...box('H1', HILLO.name, 1, l.quantity.value, 18), covers: null }]);
  await g.say('2 laatikkoa vadelmahilloa tiistaiksi');
  assert.equal(g.asked.at(-1).basis ?? 'sales', 'sales');
});

test('vastaava tuote valittu ja määrä kysytty: vastaus "10 kpl" on kappaleita, ei laatikoita', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  // Jäätelön tilalle tarjottu leivos (eri mittayksikkö): hinta yhdestä laatikosta, määrä kysytään valinnan jälkeen.
  const f = setup((l) => (l.quantity?.unit === 'L' ? [{ ...box('472410', LEIVOS.name, 1, 1, 55.55), covers: null, askQuantity: true, replaceTerm: 'vadelma-valkosuklaaleivos' }]
    : [box('472410', LEIVOS.name, 30, l.quantity.value, 55.55)]));
  await f.say('1000 l jäätelöä tiistaiksi');
  await f.say('1');
  assert.equal(f.list().lines[0].quantity, null);
  await f.say('10 kpl');
  assert.deepEqual(f.list().lines[0].quantity, { value: 10, unit: 'PCS', basis: 'items' });
});

test('pakkauksen kappalemäärä tuntematon: hinta yhdestä myyntierästä, määrä kysytään myyntierinä', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const f = setup((l) => (l.quantity?.basis === 'sales' ? [{ ...box('X1', 'Sekalaiset leivokset', 1, l.quantity.value, 40), covers: null }]
    : [{ ...box('X1', 'Sekalaiset leivokset', 1, 1, 40), covers: null, askQuantity: true, countUnknown: true }]));
  const r = await f.say('10 kpl leivoksia tiistaiksi');
  assert.match(r.text, /yhdestä myyntierästä/u);
  const s = await f.say('1');
  assert.match(s.text, /Pakkauksen kappalemäärää ei ole Valion tiedoissa: Sekalaiset leivokset\. Kerro, montako laatikkoa laitetaan\./u);
  assert.equal(f.list().lines[0].quantity, null);
  await f.say('2');
  assert.deepEqual(f.list().lines[0].quantity, { value: 2, unit: 'PCS', basis: 'sales' });
});

test('oikea katalogi ja simuloidut hinnat: 10 kpl Elosen leivoksia on yksi laatikko', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const p = loadCatalog().get('472410');
  assert.ok(p, 'tuote 472410 katalogissa');
  assert.equal(unitSizeFor(p, null, 'PCS', 'items').value, 30);
});
