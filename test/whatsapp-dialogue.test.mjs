import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createOrderingDialogue, isFreshStart } from '../server/whatsapp/dialogue.mjs';
import { normalizeOrderUnits, presentCollectingCart } from '../server/whatsapp/cart-presentation.mjs';
import { createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { createRuleInterpreter } from '../server/order-conversation/interpret.mjs';
import { shoppingListView } from '../server/shopping-list/index.mjs';
import { understand } from '../server/aimo/understand.mjs';

const ready = { status: 'ready', draftId: 'draft-1', revision: 2, text: '*Tilausluonnos*\nMaito 5 l, 12,34 €\n\nVahvista vastaamalla *TILAA*.' };
function fixture(t, ask) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const ordered = []; const orderOptions = []; const looked = [];
  // Kiinteä yöaika: tervehdys on neutraali 'Moi!' eikä testi riipu seinäkellosta.
  const options = { db: store.db, ask, timeOf: () => Date.parse('2026-11-15T02:30:00+02:00'), lookup: async (query) => { looked.push(query); return [{ name: 'Valio kuohukerma', contains: ['AM'] }]; } };
  const dialogue = createOrderingDialogue(options);
  let seq = 0;
  const turn = (text, extra = {}) => dialogue.respond({ binding: 'one', messageId: `m${++seq}`, text,
    runOrder: async (input, options) => { ordered.push(input); orderOptions.push(options); return ready; }, ...extra });
  return { store, dialogue, options, ordered, orderOptions, looked, turn };
}
const plan = (route, extra = {}) => ({ json: { route, text: '', lookupQuery: '', suggestionTerm: '', ...extra } });

test('a model greeting uses the requested brand tone without touching the shopping list, and replay is persistent', async (t) => {
  let calls = 0;
  const f = fixture(t, async ({ system }) => { calls++; assert.match(system, /Valio Aimon/); return plan('chat', { text: 'Hei! Kootaan keittiön ostoslista kuntoon. Mitä tarvitaan?' }); });
  const result = await f.turn('Moi');
  // Neutraali "Moi" saa kellonajan mukaisen tervehdyksen (testiajon kellosta), mallin oma "Hei!" korvataan.
  // Ensimmäinen tervehdys: apuri esittäytyy digitaalisena tilausapurina (persona.mjs).
  assert.match(result.text, /^(?:Huomenta|Päivää|Iltaa|Moi)! Olen Valio Aimon digitaalinen tilausapuri\. Kootaan keittiön ostoslista kuntoon\. Mitä tarvitaan\?$/); assert.equal(f.ordered.length, 0);
  const reopened = createOrderingDialogue(f.options);
  assert.deepEqual(await reopened.respond({ binding: 'one', messageId: 'm1', text: 'Moi' }), result);
  assert.equal(calls, 1);
});

test('product advice uses catalogue facts and a separate question; only the accepted quantity adds an item', async (t) => {
  const f = fixture(t, async ({ purpose, user }) => {
    if (purpose === 'whatsapp_dialogue') return plan('chat', { lookupQuery: 'kuohukerma' });
    assert.equal(purpose, 'whatsapp_product_advice');
    assert.equal(JSON.parse(user).facts[0].name, 'Valio kuohukerma');
    return { text: 'Kuohukerma sopii vaahdotukseen ja täyteläisiin kastikkeisiin.' };
  });
  const advice = await f.turn('Mihin kuohukerma sopii?');
  assert.equal(advice.messages.length, 2); assert.deepEqual(f.looked, ['kuohukerma']);
  assert.equal(f.ordered.length, 0);
  await f.turn('joo 5 litraa');
  assert.deepEqual(f.ordered, ['Lisää ostoslistalle kuohukerma 5 litraa']);
});

test('an optional addition is grounded, separate from the exact summary, and yes cannot confirm an order', async (t) => {
  const f = fixture(t, async () => plan('order', { suggestionTerm: 'kahvi' }));
  const result = await f.turn('se halvin maito');
  assert.equal(result.messages[0], ready.text); assert.match(result.messages[1], /kahvi/);
  assert.deepEqual(f.ordered, ['se halvin maito']);
  await f.turn('joo');
  assert.equal(f.ordered.at(-1), 'Lisää ostoslistalle kahvi');
  assert.notEqual(f.ordered.at(-1), 'TILAA');
});

test('declining a suggestion preserves the list and explicit TILAA bypasses the conversational model', async (t) => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return plan('order', { suggestionTerm: 'kahvi' }); });
  await f.turn('halvin'); await f.turn('ei kiitos');
  assert.equal(f.ordered.length, 1);
  const before = calls;
  await f.turn('TILAA', { runOrder: async (input) => { assert.equal(input, 'TILAA'); return { status: 'confirmed', text: 'Tallennettu demoon.' }; } });
  assert.equal(calls, before);
});

test('model failure preserves canonical list and required questions as separate messages', async (t) => {
  const f = fixture(t, async () => { throw new Error('provider unavailable'); });
  const canonical = 'Luonnoksessa nyt:\n- maito 5 l\n\nMille päivälle toimitus?';
  const result = await f.turn('5 l maitoa', { runOrder: async () => ({ status: 'collecting', text: canonical }) });
  assert.equal(result.messages.join('\n\n'), canonical);
  assert.equal(result.messages.length, 2);
});

test('revoked identity never receives generated advice, and dietary lists do not get unverified extras', async (t) => {
  const f = fixture(t, async () => plan('chat', { text: 'Tuotetietoja' }));
  assert.equal((await f.turn('Moi', { allowed: () => false })).status, 'error');
  const g = fixture(t, async () => plan('order', { suggestionTerm: 'voi' }));
  const restricted = await g.turn('halvin', { runOrder: async () => ({ ...ready, text: ready.text + '\nHuomioitu: maidoton' }) });
  assert.equal(restricted.messages.length, 1); assert.deepEqual(g.looked, []);
});

test('revoking the number clears conversational history and cached model replies immediately', async (t) => {
  const f = fixture(t, async () => plan('chat', { text: 'Hei!' }));
  await f.turn('Moi');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM wa_dialogue').get().n, 1);
  f.store.revoke('358401234567');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM wa_dialogue').get().n, 0);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM wa_dialogue_results').get().n, 0);
});

test('fresh starts accept everyday Finnish but never a partial removal, negation or question about instructions', () => {
  for (const text of ['tyhjää kaikki', 'Tyhjennä koko ostoslista!', 'nollaa kaikki', 'aloitetaan alusta', 'alotetaanko alusta?', 'voitko tyhjentää listan', 'moi, tyhjää kaikki pliis']) assert.equal(isFreshStart(text), true, text);
  for (const text of ['moi', 'älä tyhjennä kaikkea', 'miten voin tyhjentää listan?', 'poista maito', 'tyhjennä maito', 'tyhjää kaikki paitsi voi']) assert.equal(isFreshStart(text), false, text);
});

test('reset clears only this conversation and persists a new order session; retry cannot clear a newer list', async (t) => {
  const f = fixture(t, async () => plan('order', { suggestionTerm: 'kahvi' }));
  await f.turn('se halvin maito');
  f.store.db.prepare('INSERT INTO turns(binding,role,content,created) VALUES(?,?,?,?)').run('one', 'assistant', 'Vanha maitolista 50 l', Date.now());
  f.store.db.prepare('INSERT INTO wa_dialogue VALUES(?,?,?)').run('other', '{"history":["other customer"]}', Date.now());
  const reset = await f.turn('tyhjää kaikki');
  assert.match(reset.text, /ostoslista on tyhjä/);
  assert.equal(f.ordered.at(-1), 'aloita alusta');
  assert.equal(f.orderOptions.at(-1).operation, 'reset');
  const state = JSON.parse(f.store.db.prepare("SELECT json FROM wa_dialogue WHERE binding='one'").get().json);
  assert.equal(state.epoch, 'm2'); assert.equal(state.lastOrder, undefined); assert.equal(state.pendingSuggestion, undefined);
  assert.equal(state.suggested, undefined); assert.equal(state.history.length, 2);
  assert.equal(f.store.history('one').length, 0);
  assert.equal(f.store.db.prepare("SELECT json FROM wa_dialogue WHERE binding='other'").get().json, '{"history":["other customer"]}');
  await f.turn('5 kg voita'); assert.equal(f.orderOptions.at(-1).epoch, 'm2');
  const before = f.store.db.prepare("SELECT json FROM wa_dialogue WHERE binding='one'").get().json;
  const reopened = createOrderingDialogue(f.options);
  assert.deepEqual(await reopened.respond({ binding: 'one', messageId: 'm2', text: 'tyhjää kaikki' }), reset);
  assert.equal(f.store.db.prepare("SELECT json FROM wa_dialogue WHERE binding='one'").get().json, before);
});

test('greetings never replay the old offer even if the model fails or routes the greeting to ordering', async (t) => {
  for (const ask of [async () => plan('order'), async () => { throw new Error('model unavailable'); }]) {
    const f = fixture(t, ask);
    await f.turn('5 l maitoa'); const before = f.ordered.length;
    const greeting = await f.turn('moi');
    assert.match(greeting.text, /^(?:Huomenta|Päivää|Iltaa|Moi)! /); assert.doesNotMatch(greeting.text, /12,34|Tilausluonnos/);
    assert.equal(f.ordered.length, before);
  }
});

test('a pure greeting gives the model no old list or history to repeat and preserves the actual shopping list', async (t) => {
  const f = fixture(t, async ({ user }) => {
    const input = JSON.parse(user);
    if (input.message !== 'moi') return plan('order');
    assert.equal(input.history, undefined); assert.equal(input.shoppingList, undefined); assert.equal(input.pendingSuggestion, undefined);
    return plan('chat', { text: 'Moi! Mitä tarvitset keittiöön?' });
  });
  await f.turn('50 l maitoa'); const before = f.ordered.length;
  assert.equal((await f.turn('moi')).text, 'Moi! Mitä tarvitset keittiöön?');
  assert.equal(f.ordered.length, before);
  assert.equal(JSON.parse(f.store.db.prepare("SELECT json FROM wa_dialogue WHERE binding='one'").get().json).lastOrder.text, ready.text);
});

test('the model can recognize a conversational fresh start while a partial deletion stays a line edit', async (t) => {
  const f = fixture(t, async () => plan('reset'));
  await f.turn('heitetääs tää vanha lista pois ja alotetaan uus');
  assert.equal(f.ordered.at(-1), 'aloita alusta');
  const g = fixture(t, async () => plan('order'));
  await g.turn('tyhjennä maito');
  assert.equal(g.ordered.at(-1), 'Poista maito');
});

function cartFixture(t, copy = { acknowledgement: 'Joo, laitetaan!', quantityQuestion: 'Kuinka paljon laitetaan {{products}}?' }) {
  const store = openWhatsAppStore(':memory:');
  const drafts = openDraftStore(':memory:');
  const member = { phone: '358401234567', company: 'Testikeittiö', person: 'Testaaja', binding: 'cart-test' };
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run(member.phone, member.company, member.person, member.binding);
  const calls = [];
  const ask = async (args) => {
    calls.push({ ...args, input: JSON.parse(args.user) });
    if (args.purpose === 'whatsapp_cart_reply') {
      if (copy instanceof Error) throw copy;
      return { json: copy };
    }
    return plan('order');
  };
  const handleTurn = createOrderingConversation({ store: drafts, now: () => Date.parse('2026-11-14T10:00:00Z'),
    interpretTurn: createRuleInterpreter({ understand }), tools: { suggest() { throw new Error('All missing details must be collected first'); } } });
  const bridge = createDemoOrderingChat({ store, phoneId: 'test-phone', loadOrdering: async () => ({ handleTurn,
    dialogue: createOrderingDialogue({ db: store.db, ask }),
    getShoppingList: ({ conversationId, customer }) => shoppingListView(drafts.active(conversationId), customer),
    close: () => drafts.close(),
  }) });
  t.after(async () => { await bridge.close(); store.close(); });
  let seq = 0;
  const turn = (text, messageId = `cart-${++seq}`) => bridge.chat({ member, messageId, messages: [{ content: text }] });
  return { turn, calls, list: () => bridge.getShoppingList(member) };
}

test('the real saved cart gets a natural acknowledgement, exact bullet rows and one question for only the missing quantities', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = cartFixture(t);
  await f.turn('50 l maitoa, kananmunia ja kermaa');
  await f.turn('ei');
  const result = await f.turn('maanantaiksi', 'details');
  assert.deepEqual(result.messages, ['Joo, laitetaan!', 'Ostoskorissasi nyt (toimitus ma 16.11.):\n- maito 50 l\n- kananmuna\n- kerma',
    'Kuinka paljon laitetaan kananmunia ja kermaa?']);
  const list = await f.list();
  assert.equal(list.lines[0].quantity.value, 50); assert.equal(list.lines[1].quantity, null); assert.equal(list.lines[2].quantity, null);
  const copyCall = f.calls.filter((c) => c.purpose === 'whatsapp_cart_reply').at(-1);
  assert.equal(copyCall.input.missingQuantityCount, 2); assert.equal(copyCall.tier, 'deep');
  // Kuittauksen malli näkee oikean tallennetun korin, päivän ja seuraavan kysymyksen, ei pelkkää muutoslippua.
  assert.equal(copyCall.input.deliveryDate, 'ma 16.11.'); assert.equal(copyCall.input.next, 'quantity');
  assert.deepEqual(copyCall.input.cart, [{ product: 'maito', quantity: '50 l' }, { product: 'kananmuna', quantity: null }, { product: 'kerma', quantity: null }]);
  const router = f.calls.filter((c) => c.purpose === 'whatsapp_dialogue').at(-1);
  assert.equal(router.input.shoppingList.lines[0].quantity.value, 50);
  assert.match(router.input.lastOrderReply, /Mille päivälle toimitus/); assert.equal(router.tier, 'deep'); // päivä kysyttiin ensin assert.ok(router.timeoutMs >= 45000);
  const before = f.calls.length;
  assert.deepEqual(await f.turn('maanantaiksi', 'details'), result);
  assert.equal(f.calls.length, before);
});

test('a natural follow-up fills quantities in the same cart, and show does not pretend to update anything', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = cartFixture(t);
  await f.turn('50 l maitoa, kananmunia ja kermaa');
  const before = await f.list();
  const result = await f.turn('kananmunia 100 kpl ja kermaa 5 dl');
  const after = await f.list();
  assert.equal(after.id, before.id); assert.ok(after.revision > before.revision);
  assert.deepEqual(after.lines.map((line) => [line.productTerm, line.quantity.value, line.quantity.unit]),
    [['maito', 50, 'L'], ['kananmuna', 100, 'PCS'], ['kerma', 0.5, 'L']]);
  assert.match(result.text, /- kerma 0,5 l/); assert.doesNotMatch(result.text, /Kuinka paljon|Paljonko/);
  assert.match(result.text, /Mille päivälle toimitus/); assert.doesNotMatch(result.text, /allergioita/);
  const shown = await f.turn('näytä');
  assert.equal(shown.messages[0].startsWith('Ostoskorissasi nyt:'), true);
  assert.doesNotMatch(shown.text, /laitetaan!|päivitin/); assert.equal((await f.list()).revision, after.revision);
});

test('a failed or ungrounded copy model cannot change rows, invent quantities or claim order success', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  for (const copy of [new Error('model unavailable'), { acknowledgement: 'Tilaus lähetetty, kaikki varmasti saatavilla!', quantityQuestion: 'Laitetaanko kermaa 50 l?' }]) {
    const f = cartFixture(t, copy);
    const result = await f.turn('50 l maitoa, kananmunia ja kermaa');
    assert.equal(result.messages[0], 'Selvä, kirjasin ylös!');
    assert.match(result.messages[1], /- maito 50 l\n- kananmuna\n- kerma$/);
    // Päivä ja puuttuvat määrät samassa lauseessa; mallin keksimä kysymys ei kelpaa, vaan käytetään vakiomuotoa.
    assert.equal(result.messages[2], 'Mille päivälle tarvitset toimituksen, ja kuinka paljon laitetaan kananmunia ja kermaa? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.');
    assert.doesNotMatch(result.text, /Kuinka paljon:/);
    assert.doesNotMatch(result.text, /kermaa 50|lähetetty|saatavilla/);
  }
});

test('cart presentation preserves notes, errors, offers and confirmation instructions verbatim', async () => {
  const result = { status: 'collecting', draftId: 'd1', revision: 1, text: 'Luonnoksessa nyt:\n- maito\n\nKuinka paljon: maito?' };
  const shoppingList = { id: 'd1', revision: 1, lines: [{ ref: 'L1', productTerm: 'maito', quantity: null }] };
  const ask = async () => { throw new Error('not called'); };
  for (const status of ['ready', 'confirmed', 'pending_approval', 'error', 'rejected', 'choosing']) {
    assert.equal(await presentCollectingCart({ result: { ...result, status }, shoppingList, ask }), null);
  }
  assert.equal(await presentCollectingCart({ result: { ...result, text: 'Tarkista määrä: maito.\n' + result.text }, shoppingList, ask }), null);
  assert.equal(await presentCollectingCart({ result, shoppingList: { ...shoppingList, revision: 2 }, ask }), null);
});

test('quantity questions for arbitrary product labels stay grammatical and preserve the engine text', async () => {
  const result = { status: 'collecting', draftId: 'd1', revision: 1,
    text: 'Luonnoksessa nyt:\n- laktoositon ruokakerma\n\nKuinka paljon: laktoositon ruokakerma?' };
  const shoppingList = { id: 'd1', revision: 1, lines: [{ ref: 'L1', productTerm: 'laktoositon ruokakerma', quantity: null }] };
  const messages = await presentCollectingCart({ result, shoppingList,
    ask: async () => ({ json: { acknowledgement: 'Selvä, laktoositon ruokakerma kirjattu.', quantityQuestion: 'Paljonko tarvitset näitä: {{products}}?' } }) });
  assert.equal(messages[0], 'Selvä, laktoositon ruokakerma kirjattu.');
  // Yksi tuote ilman partitiivia: ei "näitä:"-muotoa (WhatsApp-koe 17.11.: "Paljonko tarvitset näitä: jogurtti?").
  assert.equal(messages.at(-1), 'Kuinka paljon tarvitset tuotetta laktoositon ruokakerma?');
});

test('a conversational question receives the current saved cart and can clarify without mutating the order', async (t) => {
  const current = { id: 'draft-1', revision: 3, deliveryDate: '2026-11-18',
    lines: [{ ref: 'L1', productTerm: 'maito', quantity: { value: 30, unit: 'L' } },
      { ref: 'L2', productTerm: 'kerma', quantity: { value: 0.5, unit: 'L' } }] };
  const f = fixture(t, async ({ purpose, user, tier }) => {
    const input = JSON.parse(user);
    if (input.message !== 'kananmunat huomiseks, onnistuuks?') return plan('order');
    assert.equal(purpose, 'whatsapp_dialogue'); assert.equal(tier, 'deep');
    assert.deepEqual(input.shoppingList, current); assert.match(input.lastOrderReply, /Tilausluonnos/);
    return plan('chat', { text: 'Nykyinen kori on keskiviikolle. Siirretäänkö koko kori huomiselle vai haluatko kananmunille erillisen tilauksen?' });
  });
  await f.turn('50 l maitoa');
  const before = f.ordered.length;
  const result = await f.turn('kananmunat huomiseks, onnistuuks?', { getShoppingList: () => current });
  assert.match(result.text, /koko kori huomiselle/); assert.equal(f.ordered.length, before);
});

test('small physical units reach the interpreter as exact L/KG values and unspecified amounts stay unspecified', async (t) => {
  assert.equal(normalizeOrderUnits('no vaiks 50 kananmunaa ja sit 5 dl kermaa'), 'no vaiks 50 kananmunaa ja sit 0,5 l kermaa');
  assert.equal(normalizeOrderUnits('250 ml kermaa, 75 cl maitoa ja 1 500 g voita'), '0,25 l kermaa, 0,75 l maitoa ja 1,5 kg voita');
  assert.equal(normalizeOrderUnits('2,5dl kermaa ja 0.5 kg voita'), '0,25 l kermaa ja 0.5 kg voita');
  assert.equal(normalizeOrderUnits('kananmunia ja kermaa'), 'kananmunia ja kermaa');
  assert.equal(normalizeOrderUnits('maito 50 l ja voi 5 kg, tuotetunnus 250ml-A'), 'maito 50 l ja voi 5 kg, tuotetunnus 250ml-A');
  const f = fixture(t, async () => plan('order'));
  await f.turn('50 kananmunaa ja sit 5 dl kermaa');
  assert.equal(f.ordered[0], '50 kananmunaa ja sit 0,5 l kermaa');
});

test('a short answer with decilitres accepts the last suggested ingredient rather than losing its context', async (t) => {
  const f = fixture(t, async ({ purpose }) => purpose === 'whatsapp_dialogue'
    ? plan('chat', { lookupQuery: 'kuohukerma' }) : { text: 'Kuohukerma sopii vaahdotukseen.' });
  await f.turn('Mikä kerma sopii vaahtoon?');
  assert.equal(f.ordered.length, 0);
  await f.turn('joo 5 dl');
  assert.equal(f.ordered.at(-1), 'Lisää ostoslistalle kuohukerma 0,5 l');
});

test('one message can update the cart and receive an answer to its question', async (t) => {
  const answer = 'Vaihtoehdot eroavat pakkaukseltaan ja hinnaltaan. Voit myös pyytää valitsemaan halvimman.';
  const f = fixture(t, async () => plan('order', { text: answer, openCart: false }));
  const reply = await f.turn('kermaa 5 desii, miksi pitää valita vaihtoehto?');
  assert.equal(f.ordered[0], 'kermaa 0,5 l, miksi pitää valita vaihtoehto?');
  assert.equal(reply.messages[0], answer); assert.equal(reply.messages[1], ready.text);
});

test('advice names its recommended ingredient and a later bare amount adds that ingredient only', async (t) => {
  const f = fixture(t, async ({ purpose }) => purpose === 'whatsapp_dialogue'
    ? plan('chat', { lookupQuery: 'kerma' })
    : { json: { text: 'Lohikeittoon sopii maustamaton ruokakerma.', suggestionTerm: 'maustamaton ruokakerma', addQuestion: 'Lisätäänkö maustamatonta ruokakermaa ostoslistalle? Kerro määrä.' } });
  const reply = await f.turn('Mikä kerma sopisi lohikeittoon?');
  assert.equal(f.ordered.length, 0); assert.match(reply.messages[1], /maustamatonta ruokakermaa/);
  await f.turn('joo 2 l');
  assert.equal(f.ordered[0], 'Lisää ostoslistalle maustamaton ruokakerma 2 l');
});
