import test from 'node:test';
import assert from 'node:assert/strict';
import { isCartHandoff, replyWithCartLink, withCartHandoffHint } from '../server/whatsapp/cart-handoff.mjs';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { createCartLink } from '../server/whatsapp/cart-link.mjs';

const list = { id: 'draft-1', revision: 3, status: 'review', lines: [{ productTerm: 'maito', quantity: { value: 5, unit: 'L' } }] };
const ready = { status: 'ready', draftId: list.id, revision: list.revision,
  text: '*Tilausluonnos*, toimitus ke 18.11.\n1. Maito: 5 l, 12,34 €\nYhteensä 12,34 € (alv 0 %)\n\nVahvista vastaamalla *TILAA*. Voit vielä muuttaa määriä.' };
const url = 'https://example.test/whatsapp/cart#signed-cart';

test('ordinary Finnish acknowledgements and direct cart requests are accepted, edits and questions are not', () => {
  for (const text of ['ok', 'okei!', 'joo', 'kyllä', 'juu', 'jep', 'selvä', 'sopii', 'ok kiitos', 'joo sopii', '👍', 'ok 👍',
    'avaa ostoskori', 'näytä korini', 'linkki koriin', 'laita linkki', 'lähetä linkki ostoskoriin', 'TILAA', 'joo tilaa']) {
    assert.equal(isCartHandoff(text), true, text);
  }
  for (const text of ['ei', 'en hyväksy', 'älä tilaa', 'ok mutta maitoa 10 l', 'joo 5 l', 'mikä kori?', 'ok?', 'tilaa 5 l maitoa', 'moi', '', null]) {
    assert.equal(isCartHandoff(text), false, String(text));
  }
});

test('ok returns only a link to the same reviewed draft without changing the list', async () => {
  const before = structuredClone(list); let calls = 0;
  for (const text of ['ok', 'okei', 'sopii', 'joo', 'kyllä']) {
    const result = await replyWithCartLink({ text, shoppingList: list, lastOrder: ready,
      cartHandoff: async ({ shoppingList }) => { calls++; assert.equal(shoppingList, list); return url; } });
    assert.equal(result.status, 'ready'); assert.equal(result.draftId, list.id); assert.equal(result.revision, list.revision);
    assert.match(result.text, /https:\/\/example\.test\/whatsapp\/cart#signed-cart/);
    assert.match(result.text, /vahvista tilaus siellä/); assert.doesNotMatch(result.text, /TILAA|on tallennettu|on vahvistettu/);
  }
  assert.equal(calls, 5); assert.deepEqual(list, before);
});

test('short yes keeps a pending clarification, suggestion or changed cart out of the handoff', async () => {
  let calls = 0;
  const base = { text: 'ok', shoppingList: list, lastOrder: ready, cartHandoff: async () => { calls++; return url; } };
  for (const overrides of [{ pendingSuggestion: 'kahvi' }, { shoppingList: { ...list, status: 'needs_details' } },
    { shoppingList: { ...list, status: 'needs_product_selection' } }, { lastOrder: { ...ready, revision: 2 } },
    { lastOrder: { ...ready, draftId: 'other-draft' } }, { lastOrder: null }, { shoppingList: null }, { shoppingList: { ...list, lines: [] } }]) {
    assert.equal(await replyWithCartLink({ ...base, ...overrides }), null);
  }
  assert.equal(calls, 0);
});

test('an incomplete list never gets a link, even when asked directly; a complete list opens on a direct request or legacy TILAA', async () => {
  // Eelis 15.11. klo 2.00: linkki vasta valmiiseen tilaukseen, keskeneräisessä keskustelu opastaa loppuun.
  let calls = 0;
  for (const status of ['needs_details', 'needs_product_selection']) for (const text of ['avaa kori', 'laita kori', 'TILAA', 'ok']) {
    assert.equal(await replyWithCartLink({ text, shoppingList: { ...list, status }, lastOrder: ready, cartHandoff: async () => { calls += 1; return url; } }), null, `${status} ${text}`);
  }
  assert.equal(calls, 0);
  for (const text of ['avaa kori', 'TILAA']) {
    const result = await replyWithCartLink({ text, shoppingList: list, pendingSuggestion: 'kahvi', cartHandoff: async () => url });
    assert.equal(result.status, 'ready'); assert.match(result.text, /Tässä linkki/);
  }
});

test('failed, absent or invalid links never fall through to an order command', async () => {
  for (const cartHandoff of [async () => { throw new Error('offline'); }, async () => null, async () => 'http://example.test/cart',
    async () => 'javascript:alert(1)', async () => 'https://user:password@example.test/cart']) {
    const result = await replyWithCartLink({ text: 'TILAA', shoppingList: list, lastOrder: ready, cartHandoff });
    assert.match(result.text, /Ostoskorilinkki ei nyt avaudu/); assert.equal(result.status, 'ready');
  }
});

test('ready copy asks for ok while preserving all quote facts, edit hints and message boundaries', () => {
  const original = { ...ready, messages: [ready.text, 'Tarvitsetko myös kahvia?'] };
  const result = withCartHandoffHint(original);
  assert.match(result.text, /Vastaa \*ok\*/); assert.doesNotMatch(result.text, /TILAA/);
  assert.equal(result.text.split('\n\n')[0], ready.text.split('\n\n')[0]);
  assert.match(result.text, /Voit vielä muuttaa määriä/); assert.equal(result.messages[1], original.messages[1]);
  assert.equal(original.messages[0], ready.text);
  for (const text of ['Ole hyvä! Luonnos odottaa vahvistusta: vastaa *TILAA*, kun haluat tilata.',
    'Vahvista tilaus vastaamalla *TILAA*. Muuten luonnos jää odottamaan.', 'Vahvista valmis tilaus vastaamalla *TILAA*.']) {
    const rewritten = withCartHandoffHint({ ...ready, text }).text;
    assert.doesNotMatch(rewritten, /TILAA|Muuten luonnos/); assert.match(rewritten, /linkin ostoskoriin/);
  }
  for (const status of ['collecting', 'choosing', 'error', 'confirmed', 'pending_approval']) {
    const untouched = { ...ready, status }; assert.equal(withCartHandoffHint(untouched), untouched);
  }
});

test('the actual WhatsApp cart wrapper handles ok and legacy TILAA without submitting, and keeps browser confirmation available', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  const member = { phone: '358401234567', company: 'Testikeittiö', person: 'Testaaja', binding: 'ok-link-test' };
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run(member.phone, member.company, member.person, member.binding);
  createOrderingDialogue({ db: store.db, ask: null });
  const state = { lastOrder: ready };
  store.db.prepare('INSERT INTO wa_dialogue VALUES(?,?,?)').run(member.binding, JSON.stringify(state), Date.now());
  let chats = 0; let submits = 0;
  const ordering = {
    async getShoppingList() { return list; },
    async chat(args) {
      chats++;
      if (args.messages.at(-1).content === 'TILAA') {
        submits++;
        return { status: 'confirmed', text: 'Tallennettu demoon.' };
      }
      return { ...ready, messages: [ready.text] };
    },
  };
  const cart = createCartLink({ store, ordering, baseUrl: 'https://example.test', secret: 'synthetic-test-secret' });
  const args = (text) => ({ member, messageId: text, messages: [{ role: 'user', content: text }] });
  const summary = await cart.chat(args('näytä'));
  assert.match(summary.text, /Vastaa \*ok\*/); assert.doesNotMatch(summary.text, /TILAA/);
  const before = chats;
  for (const text of ['ok', 'okei', 'joo', 'sopii', 'TILAA']) {
    const reply = await cart.chat(args(text));
    assert.match(reply.text, /https:\/\/example\.test\/whatsapp\/cart#/);
    assert.equal(chats, before, 'acknowledgement must bypass model and order submission');
    assert.equal(submits, 0);
  }
  const browser = await ordering.chat({ ...args('TILAA'), expectedList: { id: list.id, revision: list.revision } });
  assert.equal(browser.status, 'confirmed'); assert.equal(submits, 1);
});
