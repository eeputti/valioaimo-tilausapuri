// Eeliksen vaatimus 15.11.2026: toimituspäivä kysytään ensin (16.11. alkaen samassa viestissä puuttuvat määrät), tuotevaihtoehdot näytetään yksi rivi kerrallaan
// numeroituna (1, 2, 3) ja seuraava numero hakee lisää samalle päivälle toimitettavia vaihtoehtoja ilman toistoja.
// Oikeat tuotetyökalut ja keskustelumoottori injektoidulla haulla ja käsikirjoitetulla tulkilla: ei mallia, katalogia tai verkkoa.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-date-first-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createRuleInterpreter } = await import('../server/order-conversation/interpret.mjs');
const { presentCollectingCart } = await import('../server/whatsapp/cart-presentation.mjs');
const { createOrderingDialogue, sameFamily } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };

// Synteettinen valikoima. Haun järjestyksessä halvin muna on kuudentena, joten ensimmäinen sivu nostaa sen kolmen joukkoon.
const EGGS = [['E1', 'Kieku', 13.9], ['E2', 'Munax', 14.5], ['E3', 'Pihapiiri', 15.2], ['E4', 'Kartano', 15.9], ['E5', 'Hyvä', 16.4],
  ['E6', 'Edullinen', 12.4], ['E7', 'Luomu', 19.9], ['E8', 'Vapaa', 21.0]];
const CREAM = [['K1', 'Valio', 11.0], ['K2', 'Arla', 9.5]];
const egg = ([id, brand, net], date) => ({ id, name: `${brand} M10 kananmuna`, brand, qty: 5, unitLabel: 'ras', price: net / 5, labels: [],
  availability: { deliveryDate: date, stock: 100 }, quantityExplanation: { providedItems: 50, text: '5 rasiaa × 10 munaa = 50 munaa' } });
const cream = ([id, brand, net], date) => ({ id, name: `${brand} kuohukerma 1 l`, brand, qty: 5, unitLabel: 'ltk', litres: 1, price: net / 5, labels: [], availability: { deliveryDate: date, stock: 40 } });

function setup(script = {}, interpret = null) {
  let t = Date.parse('2026-11-14T08:00:00Z'); let n = 0;
  const calls = { search: [], interpret: [], quote: [] };
  const tools = createOrderingTools({
    now: () => t, product: () => ({ hasAllergenData: true, contains: [], mayContain: [] }), buyer: (id) => (id === 'b1' ? { id } : null),
    // Vain valitulle päivälle toimitettavat palautetaan, kuten storefront-haun tarkka saatavuusehto.
    search: async (line, deliveryDate) => {
      calls.search.push({ term: line.productTerm, deliveryDate });
      if (/kananmun/.test(line.productTerm)) return EGGS.map((e) => egg(e, deliveryDate));
      if (/kerma/.test(line.productTerm)) return CREAM.map((c) => cream(c, deliveryDate));
      return [];
    },
    requestQuote: async (buyer, input) => { calls.quote.push(input); return { quoteId: `Q${calls.quote.length}`, needs: input.needs.map((need) => ({ ref: need.ref, excluded: [], options: [{ kind: 'exact', deliveryDate: input.deliveryDate,
      expiresAt: new Date(t + 900_000).toISOString(), cutoff: null, cutoffLabel: null, offer: `jws-${need.ref}`,
      lines: [{ productId: need.candidates[0], name: `Tuote ${need.candidates[0]}`, quantity: 5, salesUnitLabel: 'ras', covers: need.quantity.value, unitPriceNet: 2, lineNet: 10, vatRate: 14, availability: { stockKnown: true } }] }] })) }; },
    placeOrder: async () => ({ status: 'confirmed', orderId: 'AGW-1', deliveryDate: MONDAY, totals: { net: 20 }, reasons: [] }),
  });
  const store = openDraftStore(':memory:', () => t);
  const handleTurn = createOrderingConversation({ store, tools, now: () => t, interpretTurn: async (input) => {
    calls.interpret.push(input.text);
    if (interpret) return interpret(input);
    const r = script[input.text]; return typeof r === 'function' ? r(input.draft) : r || { intent: 'other', ops: [] };
  } });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'conv', customer, text, receivedAt: t });
  return { say, calls, store, tools };
}
const eggs50 = { op: 'add', productTerm: 'kananmunat', quantity: { value: 50, unit: 'PCS', basis: 'items' }, claims: [], excludeAllergens: [] };
const refOf = (draft, term) => draft.lines.find((l) => l.productTerm === term).ref;

test('suggest sivuttaa: halvin ensimmäisellä sivulla, seuraavat ilman toistoja samalle päivälle ja loppu kerrotaan', async () => {
  const { tools } = setup();
  const draft = { id: 'd1', revision: 1, deliveryDate: MONDAY, lines: [{ ref: 'L1', productTerm: 'kananmunat', quantity: { value: 50, unit: 'PCS', basis: 'items' }, claims: [], excludeAllergens: [] }] };
  const page = async (seen = []) => tools.suggest({ customer, draft, exclude: seen.length ? { L1: seen } : {} });
  const p1 = await page();
  assert.deepEqual(p1.lines[0].options.map((o) => o.productId), ['E1', 'E2', 'E6']);
  assert.equal(p1.lines[0].more, true);
  assert.equal(p1.lines[0].total, 8);
  const p2 = await page(['E1', 'E2', 'E6']);
  assert.deepEqual(p2.lines[0].options.map((o) => o.productId), ['E3', 'E4', 'E5']); // ensimmäiseltä sivulta syrjäytynyt E3 ei katoa
  assert.equal(p2.lines[0].more, true);
  assert.equal(p2.lines[0].shownBefore, 3);
  const p3 = await page(['E1', 'E2', 'E6', 'E3', 'E4', 'E5']);
  assert.deepEqual(p3.lines[0].options.map((o) => o.productId), ['E7', 'E8']);
  assert.equal(p3.lines[0].more, false);
  assert.ok([...p1.lines[0].options, ...p2.lines[0].options, ...p3.lines[0].options].every((o) => o.deliveryDate === MONDAY));
  const p4 = await page(EGGS.map(([id]) => id));
  assert.equal(p4.lines.length, 0);
  assert.deepEqual(p4.issues.map((i) => [i.code, i.ref]), [['NO_MORE_OPTIONS', 'L1']]);
  assert.match(p4.issues[0].message, /Muita vaihtoehtoja päivälle ma 16\.11\. ei löytynyt: kananmunat\./);
  const two = await tools.suggest({ customer, draft, limit: 2 });
  assert.equal(two.lines[0].options.length, 2);
  assert.ok(two.lines[0].options.some((o) => o.productId === 'E6'));
});

test('päivä ja puuttuvat määrät kysytään ensin samassa viestissä, ja vaihtoehdot yksi rivi kerrallaan numeroituna lisähakuineen', async () => {
  const { say, calls, store } = setup({
    'tarvis 50 kananmunaa ja kermaa': { intent: 'order', ops: [eggs50, { op: 'add', productTerm: 'kerma', quantity: null, claims: [], excludeAllergens: [] }] },
    maanantaiksi: { intent: 'order', deliveryDate: MONDAY, ops: [] },
    'kermaa 5 l': (d) => ({ intent: 'order', ops: [{ op: 'update', ref: refOf(d, 'kerma'), quantity: { value: 5, unit: 'L' } }] }),
  });
  const first = await say('tarvis 50 kananmunaa ja kermaa');
  assert.equal(first.status, 'collecting');
  assert.match(first.text, /^Luonnoksessa nyt:\n- kananmunat 50 kpl\n- kerma\n\nMille päivälle toimitus\?[^\n]*\nKuinka paljon: kerma\?$/);
  assert.doesNotMatch(first.text, /laktoos|allergi|\d\)/i); // ei ruokavaliota tai vaihtoehtoja ennen päivää
  assert.equal(calls.search.length, 0);
  assert.deepEqual(store.active('conv').pending, { kind: 'checklist', asks: ['date', 'quantity'], refs: [refOf(store.active('conv'), 'kerma')] });

  const dated = await say('maanantaiksi');
  assert.match(dated.text, /Kuinka paljon: kerma\?/);
  assert.doesNotMatch(dated.text, /Mille päivälle/);
  assert.equal(calls.search.length, 0);

  const options = await say('kermaa 5 l');
  assert.equal(options.status, 'choosing');
  assert.equal(options.text, [
    'Toimitus: ma 16.11.',
    'Hinnat alv 0 %',
    '*Kananmunat 50 kpl:*',
    '1) Kieku M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 13,90 €',
    '2) Munax M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 14,50 €',
    '3) Edullinen M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 12,40 €',
    'Vastaa 1, 2 tai 3.',
    'Jos haluat muita vaihtoehtoja, vastaa 4.', // lisävaihtoehdot omalla rivillään (Eelis 18.11.)
    'Sen jälkeen valitaan kerma.',
  ].join('\n'));
  assert.ok(calls.search.every((c) => c.deliveryDate === MONDAY && c.term === 'kananmunat')); // kermaa ei vielä haeta
  const asked = calls.interpret.length;

  const more = await say('4');
  assert.equal(calls.interpret.length, asked); // numero ratkaistaan koodissa
  assert.match(more.text, /1\) Pihapiiri M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 15,20 €\n2\) Kartano M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 15,90 €\n3\) Hyvä M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 16,40 €\nVastaa 1, 2 tai 3\.\nJos haluat muita vaihtoehtoja, vastaa 4\./);
  assert.doesNotMatch(more.text, /Kieku|Munax|Edullinen/);
  assert.equal(more.revision, options.revision); // selaaminen ei muuta luonnosta

  const last = await say('näytä lisää');
  assert.match(last.text, /1\) Luomu M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 19,90 €\n2\) Vapaa M10 kananmuna, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 21,00 €\nVastaa 1 tai 2\./);
  assert.doesNotMatch(last.text, /Näytä lisää/);

  const searches = calls.search.length;
  const wrong = await say('7');
  assert.match(wrong.text, /Valitse numero näytetyistä vaihtoehdoista: kananmunat\./);
  assert.match(wrong.text, /1\) Luomu M10 kananmuna/); // sama lista, numerot eivät vaihdu
  assert.equal(calls.search.length, searches);
  // Seuraava numero ilman lisäriviä: kerrotaan, ettei lisää ole, eikä haeta uudelleen.
  const noMore = await say('3');
  assert.match(noMore.text, /^Muita vaihtoehtoja päivälle ma 16\.11\. ei löytynyt: kananmunat\.\n\nToimitus: ma 16\.11\./);
  assert.match(noMore.text, /1\) Luomu M10 kananmuna[^\n]*\n2\) Vapaa M10 kananmuna[^\n]*\nVastaa 1 tai 2\./);
  assert.equal(calls.search.length, searches);

  const none = await say('onko muita?');
  assert.match(none.text, /Muita vaihtoehtoja päivälle ma 16\.11\. ei löytynyt: kananmunat\./);
  assert.match(none.text, /1\) Luomu M10 kananmuna[^\n]*\n2\) Vapaa M10 kananmuna[^\n]*\nVastaa 1 tai 2\./);
  assert.doesNotMatch(none.text, /Näytä lisää/);

  const creamList = await say('1');
  assert.equal(store.active('conv').lines[0].selectedProductId, 'E7'); // numero viittasi viimeksi näytettyyn listaan
  assert.match(creamList.text, /\*Kerma 5 l:\*\n1\) Valio kuohukerma 1 l, 5 laatikkoa, yhteensä 5 l, 11,00 €\n2\) Arla kuohukerma 1 l, 5 laatikkoa, yhteensä 5 l, 9,50 €\nVastaa 1 tai 2\.$/);
  assert.doesNotMatch(creamList.text, /Kananmunat 50 kpl:/);

  const summary = await say('halvin');
  assert.equal(summary.status, 'ready');
  assert.deepEqual(calls.quote.at(-1).needs.map((need) => need.candidates[0]), ['E7', 'K2']);
  assert.equal(calls.interpret.length, asked); // 4, näytä lisää, numerot, muita ja halvin ilman tulkkia
});

test('annettua päivää ei kysytä uudelleen ja päivän vaihto hakee vaihtoehdot alusta uudelle päivälle', async () => {
  const { say, calls, store } = setup({
    '50 kananmunaa maanantaiksi': { intent: 'order', deliveryDate: MONDAY, ops: [eggs50] },
    'eiku tiistaiksi': { intent: 'order', deliveryDate: TUESDAY, ops: [] },
  });
  const first = await say('50 kananmunaa maanantaiksi');
  assert.equal(first.status, 'choosing');
  assert.doesNotMatch(first.text, /Mille päivälle/);
  assert.match(first.text, /Vastaa 1, 2 tai 3\.\nJos haluat muita vaihtoehtoja, vastaa 4\.$/);
  await say('4');
  assert.deepEqual(store.active('conv').seen.L1, ['E1', 'E2', 'E6', 'E3', 'E4', 'E5']);
  const moved = await say('eiku tiistaiksi');
  assert.match(moved.text, /^Toimitus: ti 17\.11\.\nHinnat alv 0 %\n\*Kananmunat 50 kpl:\*\n1\) Kieku/);
  assert.equal(calls.search.at(-1).deliveryDate, TUESDAY);
  assert.deepEqual(store.active('conv').seen.L1, ['E1', 'E2', 'E6']);
  const cheapest = await say('se halvin');
  assert.equal(store.active('conv').lines[0].selectedProductId, 'E6');
  assert.equal(cheapest.status, 'ready');
});

test('WhatsApp kuittaa mainitut tuotteet ja kysyy päivän ja puuttuvat määrät samassa lauseessa', async () => {
  const text = 'Luonnoksessa nyt:\n- kananmunat 50 kpl\n- kerma\n\nMille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.\nKuinka paljon: kerma?';
  const shoppingList = { id: 'd1', revision: 2, deliveryDate: null, lines: [{ productTerm: 'kananmunat', quantity: { value: 50, unit: 'PCS' } }, { productTerm: 'kerma', quantity: null }] };
  const messages = await presentCollectingCart({ result: { status: 'collecting', draftId: 'd1', revision: 2, text }, shoppingList, previousList: null, ask: null, userText: 'tarvis 50 kananmunaa ja kermaa' });
  assert.deepEqual(messages, ['Selvä, kirjasin ylös!', 'Ostoskorissasi nyt:\n- kananmunat 50 kpl\n- kerma',
    'Mille päivälle tarvitset toimituksen, ja kuinka paljon laitetaan kermaa? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.']);
  // Kun kaikilla riveillä on määrä, kysytään vain päivä kuten ennenkin.
  const dateOnly = await presentCollectingCart({ result: { status: 'collecting', draftId: 'd1', revision: 2,
    text: 'Luonnoksessa nyt:\n- kananmunat 50 kpl\n\nMille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.' },
  shoppingList: { ...shoppingList, lines: [shoppingList.lines[0]] }, previousList: null, ask: null, userText: 'tarvis 50 kananmunaa' });
  assert.equal(dateOnly.at(-1), 'Mille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.');
  // Päivän jälkeen sama esitys kysyy puuttuvan määrän tavalliseen tapaan.
  const after = await presentCollectingCart({ result: { status: 'collecting', draftId: 'd1', revision: 3, text: 'Luonnoksessa nyt:\n- kananmunat 50 kpl\n- kerma\n\nKuinka paljon: kerma?' },
    shoppingList: { ...shoppingList, revision: 3, deliveryDate: MONDAY }, previousList: shoppingList, ask: null, userText: 'maanantaiksi' });
  assert.equal(after.at(-1), 'Kuinka paljon laitetaan kermaa?');
});

test('lisäidea: ei saman tuotteen varianttia, enintään kerran luonnosta kohden, ja vaihtoehtovastaukset ohittavat dialogimallin', async (t) => {
  assert.equal(sameFamily('ruokakerma', ['kerma']), true);
  assert.equal(sameFamily('kananmunat', ['kananmuna']), true);
  assert.equal(sameFamily('tilli', ['kerma', 'lohi']), false);
  assert.equal(sameFamily('voileipäkeksi', ['voi']), false);
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const asked = []; let term = 'ruokakerma';
  const dialogue = createOrderingDialogue({ db: store.db, lookup: async () => [{ name: 'tuote' }],
    ask: async ({ purpose }) => { asked.push(purpose); return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: term, openCart: false } }; } });
  const ready = (draftId) => ({ status: 'ready', draftId, revision: 4, text: '*Tilausluonnos*\nKerma 5 l, 9,50 €\n\nVahvista vastaamalla *TILAA*.' });
  let seq = 0; let next = ready('d1');
  const turn = (text) => dialogue.respond({ binding: 'one', messageId: `w${++seq}`, text, runOrder: async () => next,
    getShoppingList: () => ({ id: next.draftId, revision: next.revision, lines: [{ productTerm: 'kerma' }, { productTerm: 'lohi' }] }) });
  const variant = await turn('lohikeittoon kermaa 5 l');
  assert.equal(variant.messages.length, 1); // ruokakerma kerman rinnalla ei ole idea
  term = 'tilli';
  const again = await turn('ja vielä se kerma');
  assert.equal(again.messages.length, 1); // sama luonnos sai jo ideointimahdollisuuden
  next = ready('d2');
  const fresh = await turn('uusi lista: kermaa 5 l lohikeittoon');
  assert.match(fresh.messages.at(-1), /^Tarvitsetko ostoslistalle myös tilli\?/);
  const before = asked.length;
  next = { status: 'choosing', draftId: 'd2', revision: 5, text: 'Toimitus: ma 16.11.\nHinnat alv 0 %\n*Kerma 5 l:*\n1) A\n2) B\n3) C\nVastaa 1, 2 tai 3.\nJos haluat muita vaihtoehtoja, vastaa 4.' };
  for (const text of ['4', 'näytä lisää', 'onko muita?', 'halvin', 'se halvin', '2']) await turn(text);
  assert.equal(asked.length, before); // numero, lisää ja halvin eivät odota dialogimallia
});

test('maustamaton-ehto rajaa maustetut pois, eikä halvimman nosto tuo maustettua kärkeen', async () => {
  const cream = (id, name, net) => ({ id, name, brand: 'Valio', qty: 2, unitLabel: 'kpl', litres: 1, price: net / 2, labels: [], availability: { deliveryDate: MONDAY, stock: 9 } });
  const list = [cream('R1', 'Valio ruokakerma 15 % 1 l', 6.0), cream('R2', 'Valio ruokakerma 10 % 1 l', 6.4), cream('R3', 'Valio Keittiön ruokakerma kolme sipulia 1 l', 3.9),
    cream('R4', 'Valio ruokakerma valkosipuli 1 l', 4.2), cream('R5', 'Valio ruokakerma 20 % 1 l', 6.9)];
  const tools = createOrderingTools({ search: async () => list, product: () => ({ hasAllergenData: true, contains: ['AM'] }), buyer: () => null,
    requestQuote: async () => ({}), placeOrder: async () => ({}), now: () => 0 });
  const draft = (productTerm) => ({ id: 'd', revision: 1, deliveryDate: MONDAY, lines: [{ ref: 'L1', productTerm, quantity: { value: 2, unit: 'L' }, claims: [], excludeAllergens: [] }] });
  // Oikean itsekeskustelun tapaus: maustamaton ruokakerma tarjosi ensin halvimman sipulikerman.
  const plain = await tools.suggest({ customer, draft: draft('maustamaton ruokakerma') });
  assert.deepEqual(plain.lines[0].options.map((o) => o.productId), ['R1', 'R2', 'R5']);
  assert.equal(plain.lines[0].more, false);
  const next = await tools.suggest({ customer, draft: draft('maustamaton ruokakerma'), exclude: { L1: ['R1', 'R2', 'R5'] } });
  assert.equal(next.issues[0].code, 'NO_MORE_OPTIONS'); // maustettuja ei tarjota lisäsivullakaan
  // Ilman ehtoa maustetut jäävät perustuotteiden jälkeen seuraavalle sivulle.
  const any = await tools.suggest({ customer, draft: draft('ruokakerma') });
  assert.deepEqual(any.lines[0].options.map((o) => o.productId), ['R1', 'R2', 'R5']);
  assert.equal(any.lines[0].more, true);
  const flavours = await tools.suggest({ customer, draft: draft('ruokakerma'), exclude: { L1: ['R1', 'R2', 'R5'] } });
  assert.deepEqual(flavours.lines[0].options.map((o) => o.productId).sort(), ['R3', 'R4']);
  // Kokonaan maustettu valikoima: ehtoa ei ohiteta, vaan puute kerrotaan.
  const onlyFlavoured = createOrderingTools({ search: async () => [list[2], list[3]], product: () => ({ hasAllergenData: true, contains: ['AM'] }), buyer: () => null,
    requestQuote: async () => ({}), placeOrder: async () => ({}), now: () => 0 });
  const none = await onlyFlavoured.suggest({ customer, draft: draft('maustamaton ruokakerma') });
  assert.equal(none.lines.length, 0);
  assert.match(none.issues[0].message, /Maustamatonta vaihtoehtoa ei löytynyt päivälle ma 16\.11\.: maustamaton ruokakerma\./);
});

test('jos yksikään vaihtoehto ei ole pyydetty tuote, lista sanoo sen eikä esitä lähimpiä tarkkoina osumina', async () => {
  const quail = { id: 'Q1', name: 'Viiriäisen munat 18 kpl', brand: 'Kartano', qty: 2, unitLabel: 'ras', price: 4, labels: [], availability: { deliveryDate: MONDAY, stock: 9 } };
  const tools = createOrderingTools({ search: async (line) => (/strutsi/.test(line.productTerm) ? [quail] : [egg(EGGS[0], MONDAY)]),
    product: () => ({ hasAllergenData: true, contains: ['AE'] }), buyer: () => null, requestQuote: async () => ({}), placeOrder: async () => ({}), now: () => 0 });
  const line = (productTerm) => ({ ref: 'L1', productTerm, quantity: { value: 6, unit: 'PCS', basis: 'items' }, claims: [], excludeAllergens: [] });
  assert.equal((await tools.suggest({ customer, draft: { id: 'd', revision: 1, deliveryDate: MONDAY, lines: [line('strutsinmuna')] } })).lines[0].exact, false);
  assert.equal((await tools.suggest({ customer, draft: { id: 'd', revision: 1, deliveryDate: MONDAY, lines: [line('kananmunat')] } })).lines[0].exact, true);
  const store = openDraftStore(':memory:', () => 0);
  const handleTurn = createOrderingConversation({ store, tools, now: () => Date.parse('2026-11-14T08:00:00Z'),
    interpretTurn: async () => ({ intent: 'order', deliveryDate: MONDAY, ops: [{ op: 'add', productTerm: 'strutsinmuna', quantity: { value: 6, unit: 'PCS', basis: 'items' }, claims: [], excludeAllergens: [] }] }) });
  const r = await handleTurn({ messageId: 's1', conversationId: 'c', customer, text: '6 strutsinmunaa maanantaiksi', receivedAt: 0 });
  assert.match(r.text, /Strutsinmunille ei valitettavasti löytynyt osumaa\.\nTässä korvaaja \(tarve 6 kpl\):\n1\) Viiriäisen munat 18 kpl/);
  const again = await handleTurn({ messageId: 's2', conversationId: 'c', customer, text: '5', receivedAt: 0 });
  assert.match(again.text, /Strutsinmunille ei valitettavasti löytynyt osumaa\./); // sama merkintä myös uudelleen näytetyssä listassa
});

test('laktoositarkennus on numeroitu kuten vaihtoehdot: 2 = tavallinen käy, ja sitten näytetään lista', async () => {
  const milk = (id, labels) => ({ id, name: `Valio maito ${id} 1 l`, brand: 'Valio', qty: 20, unitLabel: 'kpl', litres: 1, price: 1, labels, availability: { deliveryDate: MONDAY, stock: 99 } });
  const tools = createOrderingTools({ search: async () => [milk('M1', ['FREE_FROM_LACTOSE']), milk('M2', []), milk('M3', []), milk('M4', [])],
    product: () => ({ hasAllergenData: true, contains: ['AM'] }), buyer: () => null, requestQuote: async () => ({}), placeOrder: async () => ({}), now: () => 0 });
  const store = openDraftStore(':memory:', () => 0); const interpreted = [];
  const handleTurn = createOrderingConversation({ store, tools, now: () => Date.parse('2026-11-14T08:00:00Z'), interpretTurn: async ({ text }) => {
    interpreted.push(text); return { intent: 'order', deliveryDate: MONDAY, ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [] }] };
  } });
  const say = (text, id) => handleTurn({ messageId: id, conversationId: 'c', customer, text, receivedAt: 0 });
  const asked = await say('20 l maitoa maanantaiksi', 'p1');
  assert.match(asked.text, /Maito: haluatko laktoositonta vai käykö tavallinen\?\n1\) laktoositon\n2\) tavallinen käy$/);
  const options = await say('2', 'p2');
  assert.equal(options.status, 'choosing');
  assert.match(options.text, /\*Maito 20 l:\*\n1\) Valio maito/);
  assert.deepEqual(interpreted, ['20 l maitoa maanantaiksi']); // numerovastaus ilman tulkkia
});

test('ensiviestin "tavallinen käy" kirjataan, joten laktoosia ei kysytä myöhemmin', async () => {
  const rules = createRuleInterpreter({ understand: () => ({ items: [], deliveryDate: null }) });
  for (const text of ['tavallinen maito käy', 'ei tarvi olla laktoositonta', 'Tavallista käy']) {
    assert.ok((await rules({ text, draft: { lines: [], pending: null }, now: 0 })).ops.some((o) => o.op === 'no_preference'), text);
  }
  assert.ok(!(await rules({ text: 'laktoositonta maitoa', draft: { lines: [], pending: null }, now: 0 })).ops.some((o) => o.op === 'no_preference'));
  const milk = (id, labels) => ({ id, name: `Valio maito ${id} 1 l`, brand: 'Valio', qty: 20, unitLabel: 'kpl', litres: 1, price: 1, labels, availability: { deliveryDate: MONDAY, stock: 99 } });
  const tools = createOrderingTools({ search: async () => [milk('M1', ['FREE_FROM_LACTOSE']), milk('M2', []), milk('M3', []), milk('M4', [])],
    product: () => ({ hasAllergenData: true, contains: ['AM'] }), buyer: () => null, requestQuote: async () => ({}), placeOrder: async () => ({}), now: () => 0 });
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => 0), tools, now: () => Date.parse('2026-11-14T08:00:00Z'),
    interpretTurn: async () => ({ intent: 'order', deliveryDate: MONDAY, ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [] }, { op: 'no_preference' }] }) });
  const r = await handleTurn({ messageId: 't1', conversationId: 'c', customer, text: '20 l maitoa maanantaiksi, tavallinen käy', receivedAt: 0 });
  assert.equal(r.status, 'choosing');
  assert.doesNotMatch(r.text, /laktoositonta vai/);
});

test('vahvistus palauttaa rakenteisen tilaustunnuksen ja tilan, myös uusinnassa ja uudessa TILAA-viestissä', async () => {
  for (const status of ['confirmed', 'pending_approval']) {
    let submitted = 0; const t = Date.parse('2026-11-14T08:00:00Z');
    const store = openDraftStore(':memory:', () => t);
    const tools = { suggest: async () => ({ lines: [], issues: [] }),
      quote: async ({ draft }) => ({ quoteId: 'Q1', draftId: draft.id, revision: draft.revision, expiresAt: new Date(t + 900_000).toISOString(), issues: [], totals: { net: 10 },
        lines: [{ ref: 'L1', name: 'Maito', salesUnits: 2, salesUnitLabel: 'ltk', covers: { value: 20, unit: 'L' }, lineNet: 10 }] }),
      submit: async () => { submitted++; return { status, orderId: 'AGW-20261115-0001', totals: { net: 10 }, reasons: [] }; } };
    const handleTurn = createOrderingConversation({ store, tools, now: () => t, interpretTurn: async () => ({ intent: 'order', ops: [] }) });
    store.save('c', { id: 'WD-1', state: 'active', revision: 1, customerId: customer.customerId, bindingVersion: customer.bindingVersion, deliveryDate: MONDAY, deliverySiteId: 's1',
      diet: { known: true, claims: [], excludeAllergens: [] }, lines: [{ ref: 'L1', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [], selectedProductId: 'M2', selectedName: 'Maito' }],
      offered: {}, seen: {}, quote: { quoteId: 'Q1', revision: 1, expiresAt: new Date(t + 900_000).toISOString() }, pending: null, turn: 0, seq: 1 }, 'seed', {});
    const say = (messageId) => handleTurn({ messageId, conversationId: 'c', customer, text: 'TILAA', receivedAt: t });
    const first = await say('o1');
    assert.equal(first.status, status); assert.equal(first.orderId, 'AGW-20261115-0001');
    assert.deepEqual(await say('o1'), first);
    const later = await say('o2');
    assert.equal(later.status, status); assert.equal(later.orderId, first.orderId); assert.match(later.text, /on jo tallennettu\. Uutta tilausta ei tehty/);
    assert.equal(submitted, 1);
  }
  // Vanha tallennettu luonnos ilman tilaa: ei tunnusta pelkän tekstin perusteella.
  const store = openDraftStore(':memory:', () => 0);
  store.save('c', { id: 'WD-old', state: 'ordered', orderId: 'AGW-OLD', revision: 1, customerId: customer.customerId, bindingVersion: customer.bindingVersion, lines: [], diet: { known: true, claims: [], excludeAllergens: [] } }, 'seed', {});
  const legacy = await createOrderingConversation({ store, tools: {}, now: () => 0, interpretTurn: async () => ({ intent: 'order', ops: [] }) })({ messageId: 'x', conversationId: 'c', customer, text: 'TILAA', receivedAt: 0 });
  assert.equal(legacy.status, 'confirmed'); assert.equal(legacy.orderId, undefined);
});

test('yksi vastaus kattaa sekä päivän että määrän: "perjantaiks 5 kg" sääntötulkilla', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const { understand } = await import('../server/aimo/understand.mjs');
  const { say, store, calls } = setup({}, createRuleInterpreter({ understand }));
  const first = await say('tarviin voita');
  assert.match(first.text, /^Luonnoksessa nyt:\n- voi\n\nMille päivälle toimitus\?[^\n]*\nKuinka paljon: voi\?$/);
  assert.equal(calls.search.length, 0);
  await say('perjantaiks 5 kg');
  const draft = store.active('conv');
  assert.equal(draft.deliveryDate, '2026-11-20');
  assert.deepEqual(draft.lines.map((l) => [l.productTerm, l.quantity?.value, l.quantity?.unit]), [['voi', 5, 'KG']]);
});
