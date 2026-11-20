// Katselmuksen 15.11. löydös #16: kiertävä demokello (DEMO_NOW_LOOP_MINUTES) kerrytti päivärajaa kierroksesta toiseen,
// ja kellon palatessa alkuun vanhentunut tarjous oli taas voimassa. Kello luetaan moduulin latautuessa, joten ympäristö ja
// Date.now kiinnitetään ennen tuontia. Simuloidut hinnat (VALIO_API_KEY tyhjä), väliaikaiset kannat.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = fs.existsSync(path.join(ROOT, 'data/catalog.json')) ? false : 'data/catalog.json puuttuu (rajoitettu aineisto)';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-audit-a-clock-'));
const ANCHOR = Date.parse('2026-11-16T20:00:00Z');
const LOOP = 420 * 60_000;
const realNow = Date.now;
let fake = ANCHOR;
Date.now = () => fake;
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_LOOP_MINUTES: '420', DEMO_NOW_ANCHOR: new Date(ANCHOR).toISOString(),
  GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'), AIMO_LEARNED: path.join(dir, 'learned.json'),
  GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => { Date.now = realNow; fs.rmSync(dir, { recursive: true, force: true }); });

const { clock } = await import('../server/gateway/clock.mjs');
const CLEAN = '461246'; // allergeeniton tuote katalogissa
const STOCK = '473622'; // Kivikylän Sooci kanaliemi 1 l: Stock-tuote, simuloidusti tilattavissa ma 16.11.

test('#16 kierroksen numero kasvaa oikeasta ajasta, demoaika palaa alkuun', () => {
  fake = ANCHOR;
  assert.equal(clock.looping, true);
  assert.equal(clock.cycle(), 0);
  const start = clock.now().toISOString();
  fake = ANCHOR + LOOP - 1; assert.equal(clock.cycle(), 0);
  fake = ANCHOR + LOOP; assert.equal(clock.cycle(), 1);
  assert.equal(clock.now().toISOString(), start, 'demoaika on kierroksen alussa sama');
  assert.equal(clock.today(), '2026-11-15');
});

test('#16 päiväraja laskee vain saman kierroksen tilaukset', { skip }, async () => {
  const { evaluateMandate, DEFAULT_MANDATE } = await import('../server/gateway/mandate.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  fake = ANCHOR + 2 * LOOP + 60_000;
  const buyer = { id: 'audit-a-cycle', mandate: { ...DEFAULT_MANDATE, approval: 'autonomous', maxDayNet: 100 } };
  const draft = { lines: [{ productId: CLEAN }], totals: { net: 20 }, deliveryDate: '2026-11-16', substitutions: [] };
  const save = (n, extra) => orders.save({ orderId: `AGW-T-${n}`, buyerId: buyer.id, idempotencyKey: `audit-a-${n}`, status: 'confirmed', createdAt: clock.now().toISOString(), totals: { net: 90 }, ...extra });
  save(1, {}); // vanha tilaus ilman kierrostietoa
  save(2, { clockCycle: clock.cycle() - 1 }); // edellinen kierros, sama demopäivä
  assert.equal(evaluateMandate(buyer, draft).status, 'confirmed', 'aiempien kierrosten tilaukset eivät kuluta tämän kierroksen rajaa');
  save(3, { clockCycle: clock.cycle() });
  const capped = evaluateMandate(buyer, draft);
  assert.equal(capped.status, 'pending_approval');
  assert.ok(capped.reasons.some((r) => r.code === 'SPEND_CAP_DAY'));
  fake += LOOP;
  assert.equal(evaluateMandate(buyer, draft).status, 'confirmed', 'seuraavalla kierroksella raja on taas vapaa');
});

test('#16 edellisen kierroksen tarjous ei herää henkiin, ja tilaus saa kierroksen', { skip }, async () => {
  const { seedBuyers } = await import('../server/gateway/mandate.mjs');
  const { buyers } = await import('../server/gateway/store.mjs');
  const { requestQuote, placeOrder } = await import('../server/gateway/service.mjs');
  seedBuyers();
  const buyer = buyers.byId('nordic-hotels');
  fake = ANCHOR + 5 * LOOP + 60_000; // demoaika su 9.01, tilausaika (su 12.00) ei ole mennyt
  const quote = () => requestQuote(buyer, { deliveryDate: '2026-11-16', maxOptions: 1, needs: [{ ref: 'n1', candidates: [STOCK], quantity: { value: 1, unit: 'PCS' }, allowSubstitutes: false }] });
  const q = await quote();
  const offer = q.needs[0].options[0]?.offer;
  assert.ok(offer, JSON.stringify(q.needs[0].excluded));
  fake += LOOP; // täsmälleen kierros myöhemmin: demoaika on sama, joten tarjous näyttäisi voimassa olevalta
  const stale = await placeOrder(buyer, { offers: [offer], idempotencyKey: 'audit-a-stale-offer' });
  assert.equal(stale.status, 'rejected');
  assert.ok(stale.reasons.some((r) => r.code === 'OFFER_EXPIRED'), JSON.stringify(stale.reasons));
  const fresh = await placeOrder(buyer, { offers: [(await quote()).needs[0].options[0].offer], idempotencyKey: 'audit-a-fresh-offer' });
  assert.notEqual(fresh.status, 'rejected', JSON.stringify(fresh.reasons));
  assert.equal(fresh.clockCycle, clock.cycle());
});

test('#16 WhatsAppin tallennettu tarjous vanhenee, kun kello on kiertänyt alkuun', async () => {
  const { createOrderingTools } = await import('../server/order-tools/index.mjs');
  let t = Date.parse('2026-11-15T14:00:00Z');
  const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', permissions: { readProducts: true, placeOrders: true } };
  let placed = 0;
  const tools = createOrderingTools({ now: () => t, product: () => ({ hasAllergenData: true, contains: [] }), buyer: (id) => ({ id }), search: async () => [],
    requestQuote: async (b, input) => ({ quoteId: 'Q1', needs: input.needs.map((n) => ({ ref: n.ref, excluded: [], options: [{ kind: 'exact', deliveryDate: input.deliveryDate, expiresAt: new Date(t + 900_000).toISOString(), offer: 'jws',
      lines: [{ productId: n.candidates[0], name: 'Tuote', quantity: 1, salesUnitLabel: 'kpl', covers: 1, unitPriceNet: 5, lineNet: 5, vatRate: 13.5, availability: { stockKnown: true } }] }] })) }),
    placeOrder: async () => { placed += 1; return { status: 'confirmed', orderId: 'AGW-1', reasons: [] }; } });
  const draft = { id: 'd1', revision: 1, deliveryDate: '2026-11-16', diet: { claims: [], excludeAllergens: [] }, lines: [{ ref: 'L1', productTerm: 'liemi', quantity: { value: 1, unit: 'PCS' }, claims: [], excludeAllergens: [], selectedProductId: '1' }] };
  const q = await tools.quote({ customer, draft });
  t -= 6 * 3600_000; // demokello palasi kierroksen alkuun: nyt on aiemmin kuin tarjous tallennettiin
  const r = await tools.submit({ customer, draft, quoteId: q.quoteId, approval: { draftId: 'd1', revision: 1, quoteId: q.quoteId }, idempotencyKey: 'wa-d1-r1' });
  assert.equal(r.reasons[0].code, 'QUOTE_EXPIRED');
  assert.equal(placed, 0);
});
