// Eelis 17.11.: "spagettia, 2 kg kanafilettä ja valkosipulikastiketta" kysyi vain "Kuinka paljon: spagetti, valkosipulikastike?".
// Nyt puuttuvat määrät arvioidaan annetusta määrästä, syy kerrotaan, ja "joo" kirjaa arvion. Mallin luvut tarkistetaan koodissa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMissingQuantities, estimateMessage, estimateOrderText, presentCollectingCart } from '../server/whatsapp/cart-presentation.mjs';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';

const line = (ref, productTerm, quantity = null) => ({ ref, productTerm, quantity, claims: [], excludeAllergens: [], selectedProductId: null });
const list = { id: 'd1', revision: 3, deliveryDate: '2026-11-20', lines: [line('L1', 'spagetti'), line('L2', 'kanafilee', { value: 2, unit: 'KG' }), line('L3', 'valkosipulikastike')] };
const good = { applies: true, anchor: 'kanafilee', dishPartitive: 'kanaspagettia', portions: 15,
  estimates: [{ product: 'spagetti', value: 1.4, unit: 'KG' }, { product: 'valkosipulikastike', value: 1.9, unit: 'L' }] };
const asker = (estimate, ack = { acknowledgement: '', quantityQuestion: 'Kuinka paljon laitetaan {{products}}?' }) => async ({ purpose }) => ({ json: purpose === 'whatsapp_quantity_estimate' ? estimate : ack });

test('arvio kertoo syyn ja suhteuttaa puuttuvat määrät annettuun määrään', async () => {
  const e = await estimateMissingQuantities({ ask: asker(good), shoppingList: list, userText: 'tarviin spagettia, 2 kg kanafilettä ja valkosipulikastiketta perjantaiksi' });
  assert.deepEqual(e.estimates, [{ productTerm: 'spagetti', quantity: { value: 1.4, unit: 'KG' } }, { productTerm: 'valkosipulikastike', quantity: { value: 1.9, unit: 'L' } }]);
  assert.equal(estimateMessage(e), 'Näille ei ollut määrää: spagetti ja valkosipulikastike. Arvioin ne annetusta määrästä (kanafilee 2 kg riittää noin 15 annokseen kanaspagettia):\n- spagetti 1,4 kg\n- valkosipulikastike 1,9 l\nKäykö? Vastaa joo, niin kirjaan nämä määrät, tai kerro omat.');
  assert.equal(estimateOrderText(e), 'spagetti 1,4 kg ja valkosipulikastike 1,9 l');
});

test('mallin epäilyttävä tai puutteellinen arvio hylätään, jolloin kysytään tavallisesti', async () => {
  const bad = [
    { ...good, applies: false },
    { ...good, anchor: 'lohi' }, // ei ostoskorissa
    { ...good, portions: 0 },
    { ...good, dishPartitive: '13 annosta' },
    { ...good, estimates: [{ product: 'spagetti', value: 1000, unit: 'KG' }, good.estimates[1]] }, // 67 kg annosta kohden
    { ...good, estimates: [good.estimates[0]] }, // kastike puuttuu
    { ...good, estimates: [...good.estimates, { product: 'parmesaani', value: 0.3, unit: 'KG' }] }, // keksitty tuote
  ];
  for (const estimate of bad) assert.equal(await estimateMissingQuantities({ ask: asker(estimate), shoppingList: list, userText: 'x' }), null, JSON.stringify(estimate));
  // Ilman yhtäkään annettua määrää ei ole mistä suhteuttaa: mallia ei kysytä.
  let calls = 0;
  const none = { ...list, lines: [line('L1', 'spagetti'), line('L3', 'valkosipulikastike')] };
  assert.equal(await estimateMissingQuantities({ ask: async () => { calls += 1; return { json: good }; }, shoppingList: none, userText: 'x' }), null);
  assert.equal(calls, 0);
});

test('ostoskorin viesti näyttää arvion määräkysymyksen tilalla ja palauttaa sen dialogille', async () => {
  const result = { status: 'collecting', draftId: 'd1', revision: 3, text: 'Luonnoksessa nyt:\n- spagetti\n- kanafilee 2 kg\n- valkosipulikastike\n\nKuinka paljon: spagetti, valkosipulikastike?' };
  const out = await presentCollectingCart({ result, shoppingList: list, previousList: null, ask: asker(good), userText: 'tarviin spagettia, 2 kg kanafilettä ja valkosipulikastiketta perjantaiksi' });
  assert.match(out.at(-1), /^Näille ei ollut määrää: spagetti ja valkosipulikastike\./);
  assert.doesNotMatch(out.join('\n'), /Kuinka paljon/);
  assert.deepEqual(out.estimate, { listId: 'd1', revision: 3, orderText: 'spagetti 1,4 kg ja valkosipulikastike 1,9 l' });
  const plain = await presentCollectingCart({ result, shoppingList: list, previousList: null, ask: asker({ ...good, applies: false }), userText: 'x' });
  assert.match(plain.at(-1), /laitetaan/); assert.doesNotMatch(plain.at(-1), /Näille ei ollut määrää/);
  assert.equal(plain.estimate, undefined);
});

test('"joo" kirjaa arvioidut määrät tilausmoottorille ilman dialogimallia; muuttunut lista ei käytä vanhaa arviota', async (t) => {
  const wa = openWhatsAppStore(':memory:'); t.after(() => wa.close());
  wa.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  let current = list; const ordered = []; let planCalls = 0;
  const ask = async (input) => {
    if (input.purpose === 'whatsapp_dialogue') { planCalls += 1; return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false } }; }
    return asker(good)(input);
  };
  const dialogue = createOrderingDialogue({ db: wa.db, ask, timeOf: () => Date.parse('2026-11-17T10:00:00+02:00') });
  const collecting = { status: 'collecting', draftId: 'd1', revision: 3, text: 'Luonnoksessa nyt:\n- spagetti\n- kanafilee 2 kg\n- valkosipulikastike\n\nKuinka paljon: spagetti, valkosipulikastike?' };
  const run = (text) => { ordered.push(text); return collecting; };
  const turn = (messageId, text) => dialogue.respond({ binding: 'one', messageId, text, runOrder: async (input) => run(input), getShoppingList: () => current });
  const first = await turn('m1', 'tarviin spagettia, 2 kg kanafilettä ja valkosipulikastiketta perjantaiksi');
  assert.match(first.text, /Näille ei ollut määrää/);
  const calls = planCalls;
  await turn('m2', 'joo');
  assert.equal(ordered.at(-1), 'spagetti 1,4 kg ja valkosipulikastike 1,9 l');
  assert.equal(planCalls, calls, 'hyväksyntä ei kysy dialogimallia');
  // Uusi arvio näytetään, mutta lista muuttuu ennen vastausta: "joo" ei kirjaa vanhaa arviota.
  await turn('m3', 'tarviin spagettia, 2 kg kanafilettä ja valkosipulikastiketta perjantaiksi');
  current = { ...list, revision: 4 };
  await turn('m4', 'joo');
  assert.notEqual(ordered.at(-1), 'spagetti 1,4 kg ja valkosipulikastike 1,9 l');
});
