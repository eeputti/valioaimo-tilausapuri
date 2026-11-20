// Miksi juuri nämä vaihtoehdot: suggest tallentaa jokaiselle näytetylle vaihtoehdolle syyn (pick) ja rivin luvut (pool).
// Oikea katalogi, ei mallikutsuja eikä verkkoa: hinnat ja saatavuus simuloidaan (VALIO_API_KEY tyhjä), kannat ovat väliaikaisia.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-option-reasons-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
const { explainPicks, PICK_CODES } = await import('../server/order-tools/why.mjs');

const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 1, permissions: { readProducts: true } };
const draftFor = (productTerm, value, unit) => ({ id: 'd', deliveryDate: '2026-11-16', diet: { known: true, claims: [], excludeAllergens: [] },
  lines: [{ ref: 'L1', productTerm, quantity: { value, unit }, claims: [], excludeAllergens: [] }] });

test('peruna 2 kg: jokainen näytetty kertoo sijansa ja syynsä, ja rivin luvut täsmäävät', { skip: !fs.existsSync(CATALOG) && 'katalogi puuttuu' }, async () => {
  const tools = createOrderingTools();
  const line = (await tools.suggest({ customer, draft: draftFor('peruna', 2, 'KG') })).lines[0];
  assert.equal(line.options.length, 3);
  for (const o of line.options) {
    assert.ok(o.pick.codes.every((c) => PICK_CODES.includes(c)), o.pick.codes.join());
    assert.ok(o.pick.codes.includes('REQUESTED'), `${o.name}: tuore peruna on pyydettyä tuotetta`);
    assert.ok(Number.isInteger(o.pick.place) && o.pick.place >= 1);
    assert.deepEqual(o.pool, line.options[0].pool, 'sama pool jokaisella vaihtoehdolla');
  }
  const { pool } = line.options[0];
  assert.equal(pool.shown, 3);
  assert.equal(pool.suitable, line.total);
  assert.ok(pool.orderable >= pool.suitable && pool.suitable >= pool.requested && pool.requested >= 3, JSON.stringify(pool));
  assert.equal(pool.more, line.more);
  assert.equal(pool.nextPage, false);
  // Halvin tarpeen kattava on merkitty, ja sitä ei näytetä kalliimpana kuin muita parhaan ryhmän tavallisia.
  const cheapest = line.options.filter((o) => o.pick.codes.includes('CHEAPEST'));
  assert.equal(cheapest.length, 1);
  assert.equal(cheapest[0].lineNet, Math.min(...line.options.map((o) => o.lineNet)));

  // Näytä lisää: seuraavat järjestyksessä, ei halvin-merkintää, sija jatkuu ensimmäisen sivun jälkeen.
  const next = (await tools.suggest({ customer, draft: draftFor('peruna', 2, 'KG'), exclude: { L1: line.options.map((o) => o.productId) } })).lines[0];
  for (const o of next.options) {
    assert.ok(o.pick.codes.includes('NEXT_PAGE'));
    assert.ok(!o.pick.codes.includes('CHEAPEST'));
  }
  assert.equal(next.options[0].pool.nextPage, true);
});

test('explainPicks: nosto halvimpana, väärä tyyppi, maustettu ja liian iso erä', () => {
  const p = (id, extra = {}) => ({ id, name: `Tuote ${id}`, price: 1, qty: 1, ...extra });
  const a = p('a'), b = p('b'), c = p('c', { requested: false }), d = p('d', { substituteFor: { id: 'x', name: 'X' } });
  const scored = [
    { o: a, group: 0, regular: true, known: true, oversize: false },
    { o: b, group: 0, regular: false, known: true, oversize: true },
    { o: c, group: 1, regular: false, known: false, oversize: false },
    { o: d, group: 0, regular: true, known: true, oversize: false },
  ];
  const why = explainPicks({ found: [a, b, c, d, p('e')], fit: [a, b, c, d], scored, first: scored, top: [a, b, d], cheapest: d, seen: new Set(),
    onTerm: (o) => o !== c, pricey: (o) => (o === b ? 1 : 0), more: true, size: 2 });
  assert.deepEqual(why(a), { place: 1, codes: ['REQUESTED'] });
  assert.deepEqual(why(b), { place: 2, codes: ['REQUESTED', 'SPECIAL', 'PRICEY_LAST', 'OVERSIZE'] });
  assert.deepEqual(why(c), { place: 3, codes: ['OTHER_PRODUCT', 'OTHER_TYPE', 'SIZE_UNKNOWN'] });
  assert.deepEqual(why(d), { place: 4, codes: ['SUBSTITUTE', 'REQUESTED', 'CHEAPEST', 'CHEAPEST_ADDED'] }, 'ei ollut kahden ensimmäisen joukossa');
  assert.deepEqual(why.pool, { orderable: 5, suitable: 4, requested: 3, shown: 3, more: true, nextPage: false });
  // Kuratoitu tuotetyyppi: haku ei kerro requested-tietoa, eikä nimen sanavertailu yksin riitä väitteeksi.
  const egg = p('e');
  const curated = explainPicks({ found: [a, egg], fit: [a, egg], scored: [{ o: a, group: 0, regular: true, known: true }, { o: egg, group: 0, regular: true, known: true }],
    first: [], top: [a, egg], cheapest: a, seen: new Set(['z']), onTerm: (o) => o === a, pricey: () => 0, more: false, size: 3 });
  assert.deepEqual(curated(egg).codes, ['NEXT_PAGE']);
  // Yksikään ei ole pyydettyä tuotetta: kaikki ovat lähimpiä.
  const none = explainPicks({ found: [a], fit: [a], scored: [{ o: a, group: 0, regular: true, known: true }], first: [{ o: a }], top: [a], cheapest: a, seen: new Set(),
    onTerm: () => false, pricey: () => 0, more: false, size: 3 });
  assert.deepEqual(none(a).codes, ['NEAREST', 'CHEAPEST']);
});
