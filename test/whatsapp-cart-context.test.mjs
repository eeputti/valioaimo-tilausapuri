import test from 'node:test';
import assert from 'node:assert/strict';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';

test('the same ordering bridge distinguishes WhatsApp from the already open browser cart', async () => {
  const store = openWhatsAppStore(':memory:');
  const invite = store.invite('358000003001', 'Synthetic cart context', 'Tester'); store.pair('358000003001', codeHash(invite.code));
  const member = store.member('358000003001'); const calls = [];
  const list = { id: 'synthetic-draft', revision: 4, lines: [] };
  const ordering = createDemoOrderingChat({ store, phoneId: '999000333', loadOrdering: async () => ({
    getShoppingList: () => list, close() {}, dialogue: { respond: async (input) => { calls.push(input); return { text: 'Synthetic reply', status: 'collecting' }; } },
  }) });
  try {
    const input = { member, messageId: 'context-wa', messages: [{ role: 'user', content: 'avaa kori' }], cartLinkAvailable: true };
    await ordering.chat(input);
    await ordering.chat({ ...input, messageId: 'context-browser', expectedList: { id: list.id, revision: list.revision } });
    assert.deepEqual(calls.map(({ canOpenCart, inCart }) => ({ canOpenCart, inCart })), [
      { canOpenCart: true, inCart: false }, { canOpenCart: false, inCart: true },
    ]);
  } finally { await ordering.close(); store.close(); }
});

test('browser cart context preserves a question answer and a real selection without a false link denial', async () => {
  const store = openWhatsAppStore(':memory:'); let calls = 0; let capabilities;
  const list = { id: 'draft', revision: 2, lines: [{ ref: 'L1', productTerm: 'maito', quantity: { value: 10, unit: 'L' }, claims: [], excludeAllergens: [] }] };
  const dialogue = createOrderingDialogue({ db: store.db, ask: async (input) => {
    capabilities = JSON.parse(input.user).capabilities;
    return { json: { route: 'order', text: 'Tuotteet eroavat pakkauskooltaan ja hinnaltaan. Korilinkkiä ei valitettavasti saa tässä kanavassa auki.', openCart: true, lookupQuery: '', suggestionTerm: '' } };
  } });
  try {
    const result = await dialogue.respond({ binding: 'synthetic-binding', messageId: 'browser-choice', text: 'Valitse 1, miksi vaihtoehdot pitää valita? Lähetä korilinkki.',
      inCart: true, getShoppingList: () => list, runOrder: async (text) => { calls++; assert.match(text, /Valitse 1/); return { status: 'ready', text: 'Oikea tarkistettava yhteenveto.', draftId: list.id, revision: list.revision }; } });
    assert.equal(calls, 1);
    assert.deepEqual(capabilities, { cartLink: false, browserCart: true });
    assert.match(result.text, /Tuotteet eroavat pakkauskooltaan ja hinnaltaan/);
    assert.match(result.text, /Olet jo ostoskorissa/);
    assert.match(result.text, /Oikea tarkistettava yhteenveto/);
    assert.doesNotMatch(result.text, /ei valitettavasti saa/);
    assert.equal(result.status, 'ready'); assert.equal(result.cartRequested, undefined);
  } finally { store.close(); }
});

test('a browser-only cart help request does not create an order or request another link', async () => {
  const store = openWhatsAppStore(':memory:');
  const dialogue = createOrderingDialogue({ db: store.db, ask: async () => ({ json: { route: 'cart', text: '', openCart: true, lookupQuery: '', suggestionTerm: '' } }) });
  try {
    const result = await dialogue.respond({ binding: 'synthetic', messageId: 'browser-help', text: 'Mistä avaan ostoskorin?', inCart: true,
      getShoppingList: () => ({ id: 'draft', revision: 2, lines: [] }), runOrder: async () => { throw new Error('Cart help must not run an order'); } });
    assert.match(result.text, /tässä näkymässä/);
    assert.equal(result.cartRequested, false);
  } finally { store.close(); }
});
