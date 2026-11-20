import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDemoCheckout, orderLinkToken } from '../server/whatsapp/checkout.mjs';

// Henkilökohtainen tilauslinkki: testisalaisuus ja tilauksen luontiaika (oikeassa ajossa gatewayn kannasta).
const secret = 'checkout-test-secret-' + 'x'.repeat(32);
const CREATED = '2026-11-15T09:10:00.000Z';
const signing = { secret, orderCreatedAt: async (orderId) => (orderId === 'AGW-20261115-0001' ? CREATED : null) };
const personal = (orderId) => `https://demo.example/demo-payment.html#${orderId}.${orderLinkToken(secret, orderId, CREATED)}`;
import { showDemoCheckout } from '../public/whatsapp-checkout.js';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';

test('only a confirmed structured order gets its own demo payment link; retry keeps the same order', async () => {
  const args = { messageId: 'same-operation' };
  let result = { status: 'ready', text: 'Tilaus AGW-20261115-0001 ei ole vielä vahvistettu.' };
  const ordering = { chat: async input => { assert.equal(input, args); return result; }, getShoppingList() { return 'same-cart'; } };
  const checkout = withDemoCheckout(ordering, { baseUrl: 'https://demo.example/', ...signing });
  assert.equal(checkout.getShoppingList(), 'same-cart');
  for (const status of ['ready', 'pending_approval', 'error', 'rejected']) {
    result = { status, orderId: 'AGW-20261115-0001' };
    assert.equal(await checkout.chat(args), result);
  }
  result = { status: 'confirmed', orderId: 'AGW-20261115-0001', shoppingList: null };
  const first = await checkout.chat(args);
  assert.deepEqual(first.checkout, { mode: 'demo', url: personal('AGW-20261115-0001') });
  assert.match(first.checkout.url, /#AGW-20261115-0001\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await checkout.chat(args), first);
  assert.equal(result.checkout, undefined);
  result = { status: 'confirmed', text: 'AGW-20261115-0002' };
  assert.equal(await checkout.chat(args), result); // Text is never parsed into an authority.
  assert.equal(withDemoCheckout(ordering), ordering);
  // Ilman salaisuutta tai tunnettua luontiaikaa linkkiä ei voisi avata, joten maksupainiketta ei anneta.
  result = { status: 'confirmed', orderId: 'AGW-20261115-0001' };
  assert.equal((await withDemoCheckout(ordering, { baseUrl: 'https://demo.example' }).chat(args)).checkout, undefined);
  assert.equal((await withDemoCheckout(ordering, { baseUrl: 'https://demo.example', secret: 'short', orderCreatedAt: signing.orderCreatedAt }).chat(args)).checkout, undefined);
  result = { status: 'confirmed', orderId: 'AGW-20261115-0009' };
  assert.equal((await checkout.chat(args)).checkout, undefined);
  // Eri luontiaika (sama numero uudessa kannassa) antaa eri tunnisteen.
  assert.notEqual(orderLinkToken(secret, 'AGW-20261115-0001', CREATED), orderLinkToken(secret, 'AGW-20261115-0001', '2026-11-16T08:00:00.000Z'));
  for (const baseUrl of ['http://demo.example', 'https://user:pass@demo.example', 'https://demo.example/other', 'https://demo.example/?token=x', 'https://demo.example/#x']) {
    assert.throws(() => withDemoCheckout(ordering, { baseUrl }));
  }
});

test('the payment button is an explicit navigation for the same order, and rendering cannot pay or duplicate it', () => {
  const node = () => ({ hidden: true, children: [], replaceChildren(...children) { this.children = children; } });
  const container = node(), document = { createElement: node, getElementById: () => null, head: { append() {} } };
  const result = { status: 'confirmed', orderId: 'AGW-20261115-0001', checkout: { mode: 'demo', url: personal('AGW-20261115-0001') } };
  assert.equal(showDemoCheckout(result, { container, document }), true);
  assert.equal(container.hidden, false);
  assert.equal(container.children[1].textContent, 'Siirry demomaksuun');
  assert.equal(container.children[1].href, result.checkout.url);
  assert.equal(showDemoCheckout(result, { container, document }), true);
  assert.equal(container.children.length, 2);
  for (const url of ['javascript:alert(1)', 'https://demo.example/demo-payment.html#AGW-20261115-0002', 'https://demo.example/other#AGW-20261115-0001',
    'https://demo.example/demo-payment.html#AGW-20261115-0001', personal('AGW-20261115-0002'), `${personal('AGW-20261115-0001')}x`]) {
    assert.equal(showDemoCheckout({ ...result, checkout: { mode: 'demo', url } }, { container, document }), false);
  }
  assert.equal(showDemoCheckout({ ...result, status: 'pending_approval' }, { container, document }), false);
});

// Toimituspäivä viikon päähän: kiinteä päivä vanhenee, ja mennyt päivä tyhjennetään luonnoksesta ennen tilausta.
const FUTURE_DATE = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

test('the real conversation preserves the order id and approval state across both same-message and new-message retries', async () => {
  for (const status of ['confirmed', 'pending_approval']) {
    const store = openDraftStore(); let submitted = 0;
    const customer = { customerId: 'test-customer', bindingVersion: 'test-binding', permissions: { readProducts: true, placeOrders: true }, deliverySites: [{ id: 'test-site' }] };
    const draft = { id: 'test-draft', state: 'active', customerId: customer.customerId, bindingVersion: customer.bindingVersion, revision: 1,
      deliveryDate: FUTURE_DATE, deliverySiteId: 'test-site', lines: [{ ref: 'L1', productTerm: 'maito', selectedProductId: '1234', quantity: { value: 20, unit: 'L' } }],
      diet: { known: true, claims: [], excludeAllergens: [] }, quote: { quoteId: 'test-quote', revision: 1, expiresAt: '2099-01-01T00:00:00Z' } };
    store.save('test-conversation', draft, 'seed', {});
    const handleTurn = createOrderingConversation({ store, interpretTurn: async () => { throw new Error('retry must not reinterpret'); },
      tools: { async submit() { submitted++; return { status, orderId: 'AGW-20261115-0001' }; } } });
    const ordering = withDemoCheckout({ chat: args => handleTurn({ ...args, conversationId: 'test-conversation', customer, text: 'TILAA' }) }, { baseUrl: 'https://demo.example', ...signing });
    try {
      const first = await ordering.chat({ messageId: 'confirm-1' });
      assert.equal(first.status, status); assert.equal(first.orderId, 'AGW-20261115-0001');
      assert.equal(!!first.checkout, status === 'confirmed');
      const retry = await ordering.chat({ messageId: 'confirm-1' });
      assert.deepEqual(retry, first);
      const later = await ordering.chat({ messageId: 'confirm-2' });
      assert.equal(later.status, status); assert.equal(later.orderId, first.orderId);
      assert.deepEqual(later.checkout, first.checkout); assert.equal(submitted, 1);
    } finally { store.close(); }
  }
});

test('a legacy closed draft without a verified order status cannot create a payment link', async () => {
  const store = openDraftStore();
  const customer = { customerId: 'legacy-customer', bindingVersion: 'legacy-binding', permissions: { readProducts: true, placeOrders: true }, deliverySites: [{ id: 'test-site' }] };
  store.save('legacy-conversation', { id: 'legacy-draft', state: 'ordered', customerId: customer.customerId, bindingVersion: customer.bindingVersion,
    revision: 1, orderId: 'AGW-20261115-0001', lines: [{ ref: 'L1' }] }, 'legacy-message', {});
  const handleTurn = createOrderingConversation({ store, tools: {}, interpretTurn: async () => { throw new Error('not needed'); } });
  const ordering = withDemoCheckout({ chat: args => handleTurn({ ...args, conversationId: 'legacy-conversation', customer, text: 'TILAA' }) }, { baseUrl: 'https://demo.example', ...signing });
  try { assert.equal((await ordering.chat({ messageId: 'legacy-repeat' })).checkout, undefined); }
  finally { store.close(); }
});
