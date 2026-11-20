// Itsepeli V033 (17.11.2026, TYOLOKI): maitoallergiselle lapselle ("5 l jäätelöä, lapsella maitoallergia") näytettiin ensimmäisenä
// halvin jäätelö, jolta allergeenitieto puuttuu ("tarkista itse"), vaikka allergeenivapaaksi todennettuja vaihtoehtoja oli.
// Koko tilauksen allergiakiellossa tuote ilman allergeenitietoa sallitaan yhä (tuoreilla kasviksilla tietoa ei ole), mutta vain
// silloin, kun todennettua vaihtoehtoa ei ole: muuten se jää "Näytä lisää" -sivulle. Ei mallia, katalogia eikä verkkoa.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = fs.existsSync(path.join(ROOT, 'data/catalog.json')) ? false : 'data/catalog.json puuttuu (rajoitettu aineisto)';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-diet-allergy-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_LOOP_MINUTES: '', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { createOrderingTools } = await import('../server/order-tools/index.mjs');

const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', permissions: { readProducts: true, placeOrders: true } };
const products = {
  nodata: { hasAllergenData: false, contains: [] }, // "Mansikkajäätelö Maidoton", ei allergeenitietoa
  vegan1: { hasAllergenData: true, contains: ['AY'] },
  vegan2: { hasAllergenData: true, contains: [] },
  milk: { hasAllergenData: true, contains: ['AM'] },
  carrot1: { hasAllergenData: false, contains: [] },
  carrot2: { hasAllergenData: false, contains: [] },
  puree: { hasAllergenData: true, contains: [] }, // porkkanasose: tieto on, ei maitoa
};
const option = (id, price) => ({ id, name: `jäätelö ${id}`, qty: 1, unitLabel: 'kpl', litres: 5, price, labels: [], availability: { deliveryDate: '2026-11-18', stock: 50 } });
const tools = (found) => createOrderingTools({ product: (id) => products[id], buyer: (id) => ({ id }), search: async () => found, requestQuote: async () => ({ needs: [] }), placeOrder: async () => ({}) });
const draftOf = (term, diet) => ({ id: 'd1', revision: 1, deliveryDate: '2026-11-18', diet: { known: true, claims: [], excludeAllergens: diet },
  lines: [{ ref: 'L1', productTerm: term, quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: [] }] });

test('V033: maitoallergiassa todennetut vaihtoehdot ensin, tuote ilman allergeenitietoa vasta lisäsivulla', async () => {
  const t = tools([option('nodata', 9.62), option('vegan1', 11.61), option('vegan2', 12.84), option('milk', 8)]);
  const s = await t.suggest({ customer, draft: draftOf('jäätelö', ['AM']) });
  assert.deepEqual(s.lines[0].options.map((o) => o.productId), ['vegan1', 'vegan2'], 'halvin tuote ilman allergeenitietoa oli ensimmäinen');
  assert.equal(s.lines[0].more, true, 'tuote ilman tietoa jää lisäsivulle');
  const more = await t.suggest({ customer, draft: draftOf('jäätelö', ['AM']), exclude: { L1: ['vegan1', 'vegan2'] } });
  assert.deepEqual(more.lines[0].options.map((o) => o.productId), ['nodata']);
  assert.match(more.lines[0].options[0].warning, /allergeenitieto puuttuu/);
});

test('V033: kun kiellettyä allergeenia ei ole haun tuotteissa (tuoreet kasvikset), tuote ilman tietoa näytetään varoituksella kuten ennen', async () => {
  const s = await tools([option('carrot1', 3), option('carrot2', 4), option('puree', 5)]).suggest({ customer, draft: draftOf('porkkana', ['AM']) });
  assert.deepEqual(s.lines[0].options.map((o) => o.productId), ['carrot1', 'carrot2', 'puree'], 'tuoreet porkkanat eivät väisty porkkanasoseen tieltä');
  assert.ok(s.lines[0].options.slice(0, 2).every((o) => /allergeenitieto puuttuu/.test(o.warning)));
  // Ilman allergiakieltoa järjestys on ennallaan: halvin ensin.
  const open = await tools([option('nodata', 9.62), option('vegan1', 11.61)]).suggest({ customer, draft: draftOf('jäätelö', []) });
  assert.equal(open.lines[0].options[0].productId, 'nodata');
});

test('V033 ja #4: tilauksen oma allergiakielto menee mandaatin arvioon, tuote ilman allergeenitietoa jää ihmisen hyväksyntään', { skip }, async () => {
  const { seedBuyers } = await import('../server/gateway/mandate.mjs');
  const { buyers } = await import('../server/gateway/store.mjs');
  const { requestQuote, placeOrder } = await import('../server/gateway/service.mjs');
  seedBuyers();
  const buyer = buyers.byId('nordic-hotels'); // autonominen mandaatti: ilman allergiakieltoa tilaus vahvistuisi itsestään
  const NO_DATA = '460002'; // Puljonki luumutomaattikastike: allergeenitieto puuttuu, simuloidusti tilattavissa ma 16.11.
  const offer = async () => (await requestQuote(buyer, { deliveryDate: '2026-11-16', maxOptions: 1, needs: [{ ref: 'n1', candidates: [NO_DATA], quantity: { value: 1, unit: 'PCS' }, allowSubstitutes: false }] })).needs[0].options[0].offer;
  const guarded = await placeOrder(buyer, { offers: [await offer()], idempotencyKey: 'diet-allergy-am', excludeAllergens: ['AM'] });
  assert.equal(guarded.status, 'pending_approval', 'maitoallergiaa ei voi todentaa tuotteesta ilman allergeenitietoa');
  assert.ok(guarded.reasons.some((r) => r.code === 'ALLERGEN_DATA_MISSING' && r.severity === 'approval'), JSON.stringify(guarded.reasons.map((r) => r.code)));
  assert.deepEqual(guarded.excludeAllergens, ['AM'], 'kielto näkyy tilauksella hyväksyjälle');
  const plain = await placeOrder(buyer, { offers: [await offer()], idempotencyKey: 'diet-allergy-none' });
  assert.ok(!plain.reasons.some((r) => r.code === 'ALLERGEN_DATA_MISSING'), 'ilman allergiakieltoa puuttuva tieto ei haittaa');
  // Kielto voi vain tiukentaa: virheelliset koodit ohitetaan, eikä tyhjä lista löysää mandaattia.
  const junk = await placeOrder(buyer, { offers: [await offer()], idempotencyKey: 'diet-allergy-junk', excludeAllergens: ['<script>', 42] });
  assert.ok(!junk.reasons.some((r) => r.code === 'ALLERGEN_DATA_MISSING'));
});

test('V033: WhatsAppin tilaus välittää koko tilauksen ja rivien allergiakiellot portille', async () => {
  const seen = [];
  const t = createOrderingTools({ now: () => Date.parse('2026-11-15T08:00:00Z'), product: (id) => products[id] || { hasAllergenData: false, contains: [] }, buyer: (id) => ({ id }),
    search: async () => [], placeOrder: async (b, input) => { seen.push(input); return { status: 'pending_approval', orderId: 'AGW-1', reasons: [] }; },
    requestQuote: async (b, input) => ({ quoteId: 'Q1', needs: input.needs.map((n) => ({ ref: n.ref, excluded: [], options: [{ kind: 'exact', deliveryDate: input.deliveryDate, expiresAt: '2026-11-15T09:00:00Z', offer: 'jws',
      lines: [{ productId: n.candidates[0], name: 'x', quantity: 1, salesUnitLabel: 'kpl', covers: 5, unitPriceNet: 1, lineNet: 1, vatRate: 13.5, availability: { stockKnown: true } }] }] })) }) });
  const draft = { ...draftOf('jäätelö', ['AM']), lines: [{ ref: 'L1', productTerm: 'jäätelö', quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: ['AE'], selectedProductId: 'vegan2' }] };
  const q = await t.quote({ customer, draft });
  await t.submit({ customer, draft, quoteId: q.quoteId, approval: { draftId: draft.id, revision: draft.revision, quoteId: q.quoteId }, idempotencyKey: 'wa-d1-r1' });
  assert.deepEqual(seen[0].excludeAllergens, ['AM', 'AE']);
});
