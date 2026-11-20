import test from 'node:test';
import assert from 'node:assert/strict';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';

test('reviewing a numbered product list keeps its choices stable; only an explicit more request changes the page', async () => {
  const now = () => Date.parse('2026-11-15T09:00:00Z'); const store = openDraftStore(':memory:', now);
  const customer = { customerId: 'customer', buyerId: 'buyer', bindingVersion: 'binding', deliverySites: [{ id: 'kitchen', label: 'Test kitchen' }], permissions: { readProducts: true, placeOrders: true } };
  const options = (ids) => ids.map((productId) => ({ productId, name: `Maito ${productId}`, salesUnits: 10, salesUnitLabel: 'kpl', covers: { value: 10, unit: 'L' }, lineNet: 10, labels: [] }));
  const first = options(['A', 'B', 'C']); const second = options(['D', 'E', 'F']); const searches = []; const interpreted = [];
  const handle = createOrderingConversation({ store, now,
    interpretTurn: async ({ text, draft }) => {
      interpreted.push(text);
      if (text === 'aloitus') return { intent: 'order', deliveryDate: '2026-11-20', ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 10, unit: 'L' } }, { op: 'diet', addClaims: [], excludeAllergens: [] }] };
      // A real model sometimes interpreted the browser review command as pagination. It must not run.
      return { intent: 'show', ops: [{ op: 'more', ref: draft.lines[0].ref }] };
    },
    tools: {
      suggest: async ({ draft, exclude = {} }) => { const ref = draft.lines[0].ref; searches.push(exclude); return { lines: [{ ref, options: exclude[ref]?.length ? second : first, more: true, clarify: [] }], issues: [] }; },
      quote: async ({ draft }) => ({ quoteId: 'Q', expiresAt: '2026-11-16T12:00:00Z', issues: [], totals: { net: 10 }, lines: draft.lines.map((line) => ({ ref: line.ref, name: line.selectedName, salesUnits: 10, salesUnitLabel: 'kpl', lineNet: 10 })) }),
      submit: async () => { throw new Error('Review cannot submit'); },
    },
  });
  let seq = 0; const say = (text) => handle({ customer, conversationId: 'conversation', messageId: `m${++seq}`, text });
  try {
    const initial = await say('aloitus'); assert.equal(initial.status, 'choosing');
    const before = store.active('conversation');
    const reviewed = await say('näytä'); assert.equal(reviewed.text, initial.text);
    assert.equal(store.active('conversation').revision, before.revision);
    assert.deepEqual(store.active('conversation').offered.L1.map((option) => option.productId), ['A', 'B', 'C']);
    assert.equal(searches.length, 1); assert.deepEqual(interpreted, ['aloitus']);
    const more = await say('4'); assert.match(more.text, /Maito D/);
    assert.deepEqual(searches[1].L1, ['A', 'B', 'C']);
    assert.equal((await say('näytä')).text, more.text);
    const ready = await say('2'); assert.equal(ready.status, 'ready');
    assert.equal(store.active('conversation').lines[0].selectedProductId, 'E');
    assert.deepEqual(interpreted, ['aloitus']);
  } finally { store.close(); }
});
