import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, normalizeCases, inspectBasket, inspectResult, redact, withQuantityEvidence, diagnoseDeadEnds } from '../eval/whatsapp-profiles-100.mjs';
import { summarize } from '../scripts/whatsapp-profiles-eval.mjs';

const basket = (profile) => ({ deliveryDate: profile.date, diet: { claims: [], excludeAllergens: [] }, lines: profile.lines.map((l) => ({
  productTerm: l.term, quantity: { value: l.value, unit: l.unit }, claims: l.claim ? [l.claim] : [], excludeAllergens: l.allergen ? [l.allergen] : [],
})) });

test('100 synthetic profiles cover 20 journeys and 5 buyer personas with independent goals', () => {
  assert.equal(PROFILES.length, 100); assert.equal(new Set(PROFILES.map((p) => p.id)).size, 100);
  assert.equal(new Set(PROFILES.map((p) => p.route)).size, 20);
  assert.equal(new Set(PROFILES.map((p) => p.persona.person)).size, 5);
  for (const profile of PROFILES) assert.deepEqual(inspectBasket(profile, basket(profile)), []);
});

test('state checker catches extra items, wrong units, duplicate lines, lost constraints and changed dates', () => {
  const profile = PROFILES.find((p) => p.route === 'milk-allergy');
  const bad = basket(profile); bad.deliveryDate = '2026-11-16'; bad.lines[0].excludeAllergens = [];
  bad.lines[0].quantity.unit = 'KG'; bad.lines.push({ productTerm: 'sokeri' });
  assert.deepEqual(inspectBasket(profile, bad).sort(), ['allergen:kaura', 'delivery_date', 'quantity:kaura', 'unexpected:sokeri']);
  bad.lines.push(structuredClone(bad.lines[0])); assert.ok(inspectBasket(profile, bad).includes('duplicate:kaura'));
});

test('a nice reply or a link alone does not pass end-to-end completion', () => {
  const profile = PROFILES[0];
  const r = { finalBasket: basket(profile), turns: [], linkOpened: true, reviewed: false, confirmed: false, orderCount: 0 };
  assert.deepEqual(inspectResult(profile, r), ['review_not_reached', 'demo_order_not_confirmed']);
  r.reviewed = true; r.confirmed = true; r.orderCount = 1;
  assert.deepEqual(inspectResult(profile, r), []);
  r.prematureOrders = true; r.duplicateOrders = true;
  assert.deepEqual(inspectResult(profile, r), ['order_before_browser_confirmation', 'duplicate_order']);
});

test('unavailable products need an explanation and must never become an order', () => {
  const profile = PROFILES.find((p) => p.blocked);
  const r = { finalBasket: basket(profile), turns: [], orderCount: 0, blockReason: 'Tuotetta ei löydy.' };
  assert.deepEqual(inspectResult(profile, r), []);
  r.orderCount = 1; assert.ok(inspectResult(profile, r).includes('blocked_profile_ordered'));
});

test('metrics count outcomes and redact capability URLs', () => {
  assert.equal(redact('Avaa https://profiles.invalid/whatsapp/cart#secret'), 'Avaa [korilinkki]');
  assert.equal(summarize([{ failures: ['quantity:maito'], basketFailures: ['quantity:maito'] }]).correctBaskets, 0);
});

test('missing delivery date is requested before other details', () => {
  const profile = PROFILES.find((p) => p.requireDateFirst);
  const r = { finalBasket: basket(profile), turns: [{ assistant: 'Mille päivälle toimitus? Kuinka paljon maitoa?' }], linkOpened: true, reviewed: true, confirmed: true, orderCount: 1 };
  assert.ok(inspectResult(profile, r).includes('delivery_not_asked_first'));
  r.turns[0].assistant = 'Mille päivälle toimitus?';
  assert.deepEqual(inspectResult(profile, r), []);
});

test('only exact catalog-proven physical equivalence can replace a requested volume', () => {
  const profile = PROFILES.find((p) => p.route === 'milk');
  const list = basket(profile); list.lines[0].quantity = { value: profile.lines[0].value, unit: 'PCS', basis: 'sales' };
  list.lines[0].selectedProductId = 'synthetic-1l';
  assert.deepEqual(inspectBasket(profile, withQuantityEvidence(list, () => ({ litres: 1 }))), []);
  assert.ok(inspectBasket(profile, withQuantityEvidence(list, () => ({ litres: 5 }))).includes('quantity:maito'));
});

test('completion does not hide repeated answered questions or contradictory link advice', () => {
  const profile = PROFILES.find((p) => p.preferenceAlreadyGiven);
  const r = { finalBasket: basket(profile), turns: [{ assistant: 'Maito: haluatko laktoositonta vai käykö tavallinen?' },
    { assistant: 'Korilinkkiä ei valitettavasti saa tässä kanavassa auki.' }], linkOpened: true, reviewed: true, confirmed: true, orderCount: 1 };
  assert.deepEqual(inspectResult(profile, r), ['preference_asked_again', 'cart_link_capability_denied']);
});

test('dead ends retain the exact turn and redacted evidence without flagging completed orders', () => {
  const r = { hitTurnLimit: true, turns: Array.from({ length: 3 }, () => ({ assistant: 'En ymmärtänyt. Avaa https://profiles.invalid/#secret', list: null })) };
  const reasons = new Set(diagnoseDeadEnds(r).map((item) => item.reason));
  assert.deepEqual([...reasons].sort(), ['fallback', 'no_progress', 'repeated_reply', 'turn_limit']);
  assert.ok(diagnoseDeadEnds(r).every((item) => !item.reply.includes('secret')));
  r.confirmed = true; assert.deepEqual(diagnoseDeadEnds(r), []);
});

test('external human-authored cases validate goals and map every declared restriction', () => {
  const input = { id: 'D01', persona: { business: 'Synteettinen keittiö', person: 'Ostaja', style: 'lyhyt' }, first: 'Kaurajuomaa', moves: [],
    date: '2026-11-20', lines: [{ term: 'kaurajuoma', value: 2, unit: 'L', need: 'maidoton ja gluteeniton, ei pähkinää' }], outcome: 'order', answers: '2 l', trap: 'Älä unohda maitoallergiaa.' };
  const [profile] = normalizeCases([input], { productExists: () => true });
  assert.deepEqual(profile.lines[0].claims, ['FREE_FROM_GLUTEN']);
  assert.deepEqual(profile.lines[0].allergens, ['AM', 'AN']);
  assert.match(profile.goal, /maitoallergiaa/);
  assert.throws(() => normalizeCases([input], { productExists: () => false }), /catalog does not verify/);
  assert.throws(() => normalizeCases([input, input]), /duplicate/);
  assert.throws(() => normalizeCases([{ ...input, date: '2026-02-31' }]), /Invalid date/);
  assert.throws(() => normalizeCases([{ ...input, lines: [{ term: 'maito', value: 2, unit: 'L', need: 'tuntematon-rajoite' }] }]), /Unrecognized dietary/);
  assert.throws(() => normalizeCases([{ ...input, lines: [{ term: 'maito', value: 2, unit: 'L', need: 'maidoton ja tuntematon-rajoite' }] }]), /Unrecognized dietary/);
});
