// WhatsApp-vastaus reagoi asiakkaan viestiin eikä toista aina samaa "Joo, laitetaan!" -fraasia (Eelis 15.11.).
// Malli saa oikean tallennetun korin, mutta sen kuittaus ei voi keksiä lukuja tai väittää tilausta, hintaa tai saatavuutta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { CHOOSE_TRANSITIONS, FALLBACK_ACKNOWLEDGEMENT, groundedAcknowledgement, presentCollectingCart, selectionAcknowledgement } from '../server/whatsapp/cart-presentation.mjs';

const CAKE = 'tarvittisin 1000 littaa maitoo ja sitte kananmunii ja vaiks kermaa kans, teen kakkua keskiviikoks ni onnistuisko?';
const line = (ref, productTerm, quantity = null, extra = {}) => ({ ref, productTerm, quantity, claims: [], excludeAllergens: [], selectedProductId: null, selectedName: null, ...extra });
const cakeList = { id: 'd1', revision: 2, deliveryDate: '2026-11-18',
  lines: [line('L1', 'maito', { value: 1000, unit: 'L' }), line('L2', 'kananmuna'), line('L3', 'kerma')] };
const cakeResult = { status: 'collecting', draftId: 'd1', revision: 2,
  text: 'Luonnoksessa nyt:\n- maito 1000 l\n- kananmuna\n- kerma\n\nKuinka paljon: kananmuna, kerma?' };

test('the cart reply model sees the saved cart, date and history and can answer the actual message', async () => {
  let input;
  const ask = async ({ user, purpose }) => {
    assert.equal(purpose, 'whatsapp_cart_reply');
    input = JSON.parse(user);
    return { json: { acknowledgement: 'Kakkua keskiviikoksi 18.11., kiva! 1000 l maitoa on aika iso määrä yhteen kakkuun, onko se oikein?',
      quantityQuestion: 'Kuinka paljon laitetaan {{products}}?' } };
  };
  const history = [{ role: 'user', text: 'moi' }, { role: 'assistant', text: 'Päivää! Kerro vaan, mitä keittiöön tarvitaan.' }];
  const messages = await presentCollectingCart({ result: cakeResult, shoppingList: cakeList, previousList: null, ask, userText: CAKE, history });
  assert.deepEqual(messages, [
    'Kakkua keskiviikoksi 18.11., kiva! 1000 l maitoa on aika iso määrä yhteen kakkuun, onko se oikein?',
    'Ostoskorissasi nyt (toimitus ke 18.11.):\n- maito 1000 l\n- kananmuna\n- kerma',
    'Kuinka paljon laitetaan kananmunia ja kermaa?']);
  assert.equal(input.message, CAKE); assert.equal(input.deliveryDate, 'ke 18.11.'); assert.equal(input.next, 'quantity');
  assert.deepEqual(input.cart.map((c) => c.product), ['maito', 'kananmuna', 'kerma']);
  assert.deepEqual(input.changedLines.map((c) => c.new), [true, true, true]);
  assert.deepEqual(input.recentReplies, ['Päivää! Kerro vaan, mitä keittiöön tarvitaan.']);
});

test('an acknowledgement with invented numbers, order, price, availability or delivery claims falls back to a neutral line', async () => {
  const facts = { deliveryDate: 'ke 18.11.', cart: [{ product: 'maito', quantity: '1000 l' }, { product: 'kerma', quantity: null }] };
  for (const bad of ['Laitoin 10 l maitoa.', 'Onnistuu, toimitetaan keskiviikkona!', 'Tilaus on valmis.', 'Maito maksaa 1,40 €.',
    'Kaikki on saatavilla.', 'Joo, päivitin ostoskorin!', 'Selvä, lisäsin koriin.', 'Gluteeniton kerma on hyvä valinta.',
    'Katso https://evil.example', 'Yksi.\nKaksi.', 'Eka. Toka. Kolmas.', 'x'.repeat(241)]) {
    assert.equal(groundedAcknowledgement(bad, { facts, userText: CAKE }), '', bad);
  }
  for (const ok of ['Kakkua keskiviikoksi, kiva!', 'Selvä, maito 1000 l kirjattu keskiviikolle 18.11.', 'Katsotaan! Kerma ja kananmunat mukaan.']) {
    assert.equal(groundedAcknowledgement(ok, { facts, userText: CAKE }), ok, ok);
  }
  const messages = await presentCollectingCart({ result: cakeResult, shoppingList: cakeList, previousList: null, userText: CAKE,
    ask: async () => ({ json: { acknowledgement: 'Onnistuu! Toimitetaan keskiviikkona 50 kananmunaa.', quantityQuestion: '' } }) });
  assert.equal(messages[0], FALLBACK_ACKNOWLEDGEMENT);
  assert.doesNotMatch(messages.join('\n'), /Onnistuu|50 kananmunaa/);
});

test('an existing dialogue answer replaces the acknowledgement instead of stacking two openings', async () => {
  const messages = await presentCollectingCart({ result: cakeResult, shoppingList: cakeList, previousList: null, userText: CAKE, answered: true,
    ask: async () => ({ json: { acknowledgement: 'Kakkua keskiviikoksi, kiva!', quantityQuestion: '' } }) });
  assert.equal(messages[0].startsWith('Ostoskorissasi nyt'), true);
});

test('choosing and ready replies say what was just picked, added or moved, without a model', () => {
  const before = { id: 'd1', revision: 4, deliveryDate: '2026-11-18', lines: [line('L1', 'maito', { value: 1000, unit: 'L' }), line('L2', 'kananmuna', { value: 50, unit: 'PCS' })] };
  const picked = { ...before, revision: 5, lines: [line('L1', 'maito', { value: 1000, unit: 'L' }, { selectedProductId: 'P2', selectedName: 'Valio kevytmaito 1 l laktoositon UHT' }), before.lines[1]] };
  assert.deepEqual(selectionAcknowledgement({ previousList: before, shoppingList: picked, status: 'choosing' }), ['Selvä, valitaan Valio kevytmaito 1 l laktoositon UHT.']);
  const added = { ...before, revision: 6, lines: [...before.lines, line('L3', 'kerma', { value: 2, unit: 'L' })] };
  // Lisäyksen jälkeen siirtymä valintaan omana viestinään (Eelis 17.11.).
  const transition = (out, first) => { assert.equal(out.length, first ? 2 : 1); if (first) assert.equal(out[0], first); assert.ok(CHOOSE_TRANSITIONS.includes(out.at(-1)), out.at(-1)); };
  transition(selectionAcknowledgement({ previousList: before, shoppingList: added, status: 'choosing' }), 'Listalle tuli kerma 2 l.');
  const moved = { ...before, revision: 7, deliveryDate: '2026-11-17' };
  assert.deepEqual(selectionAcknowledgement({ previousList: before, shoppingList: moved, status: 'ready' }), ['Toimituspäivä nyt ti 17.11.']);
  const claimOnly = { ...before, revision: 3, lines: [{ ...before.lines[0], claims: ['FREE_FROM_LACTOSE'] }, before.lines[1]] };
  transition(selectionAcknowledgement({ previousList: before, shoppingList: claimOnly, status: 'choosing' }));
  // Jo valintavaiheessa ollut kori ei toista siirtymää.
  assert.deepEqual(selectionAcknowledgement({ previousList: { ...before, status: 'needs_product_selection' }, shoppingList: claimOnly, status: 'choosing' }), ['Selvä! Tässä sopivat vaihtoehdot:']);
  // Auki olevan valintalistan päivänvaihto ("perjantai?") tai määrän muutos kuitataan ilman toistuvaa siirtymää (17.11.).
  const open = { ...before, status: 'needs_product_selection' };
  assert.deepEqual(selectionAcknowledgement({ previousList: open, shoppingList: { ...before, revision: 8, deliveryDate: '2026-11-20' }, status: 'choosing' }), ['Toimituspäivä nyt pe 20.11.']);
  assert.deepEqual(selectionAcknowledgement({ previousList: open, shoppingList: { ...before, revision: 9, lines: [line('L1', 'maito', { value: 500, unit: 'L' }), before.lines[1]] }, status: 'choosing' })[0].replace(/^(?:Joo|Selvä|Okei), nyt /u, ''), 'maito 500 l.');
  // Uusi tuote kesken valinnan saa siirtymän, jotta seuraavan tuotteen lista ei näytä lisätyn tuotteen vaihtoehdoilta.
  transition(selectionAcknowledgement({ previousList: open, shoppingList: added, status: 'choosing' }), 'Listalle tuli kerma 2 l.');
  assert.equal(selectionAcknowledgement({ previousList: before, shoppingList: before, status: 'choosing' }), null);
  assert.equal(selectionAcknowledgement({ previousList: before, shoppingList: picked, status: 'collecting' }), null);
  for (const text of [selectionAcknowledgement({ previousList: before, shoppingList: picked, status: 'choosing' }),
    selectionAcknowledgement({ previousList: before, shoppingList: added, status: 'choosing' })]) assert.doesNotMatch(text.join(' '), /päivitin|lisäsin/iu);
});

test('selecting an option in WhatsApp names the chosen product before the next list instead of a fixed phrase', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  const before = { id: 'd1', revision: 4, deliveryDate: '2026-11-18', lines: [line('L1', 'maito', { value: 1000, unit: 'L' }), line('L2', 'kananmuna', { value: 50, unit: 'PCS' })] };
  const after = { ...before, revision: 5, lines: [{ ...before.lines[0], selectedProductId: 'P2', selectedName: 'Valio kevytmaito 1 l laktoositon UHT' }, before.lines[1]] };
  let current = before;
  const dialogue = createOrderingDialogue({ db: store.db,
    ask: async ({ purpose }) => ({ json: purpose === 'whatsapp_dialogue' ? { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false } : {} }) });
  const reply = await dialogue.respond({ binding: 'b1', messageId: 'm1', text: '2 on hyvä', getShoppingList: () => current,
    runOrder: async () => { current = after; return { status: 'choosing', draftId: 'd1', revision: 5,
      text: 'Toimitus ke 18.11., hinnat alv 0 %.\n*Kananmuna 50 kpl:*\n1) Kieku M10, 5 rasiaa (50 munaa), 12,35 €\nVastaa 1.' }; } });
  assert.equal(reply.messages[0], 'Selvä, valitaan Valio kevytmaito 1 l laktoositon UHT.');
  assert.match(reply.messages[1], /^Toimitus ke 18\.11\./);
  assert.doesNotMatch(reply.text, /päivitin ostoskorin/);
});
