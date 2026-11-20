// Kesken jäänyt ostoskori (Eelis 17.11.): tauon jälkeen uusi viesti ei mene hiljaa vanhaan koriin, vaan apuri näyttää vanhan
// korin ja kysyy "Lisätäänkö tämä vanhaan ostoskoriin?". Oikea tilausmoottori, sääntötulkki ja WhatsApp-silta; tuotetyökalut ja
// dialogimallin reititys ovat testin omia, joten testi ei tee malli-, Valio- tai Meta-kutsuja.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createOrderingDialogue, staleCartChoice, staleCartMinutes } from '../server/whatsapp/dialogue.mjs';
import { CHOOSE_TRANSITIONS } from '../server/whatsapp/cart-presentation.mjs';
import { createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { createRuleInterpreter } from '../server/order-conversation/interpret.mjs';
import { shoppingListView } from '../server/shopping-list/index.mjs';
import { understand } from '../server/aimo/understand.mjs';

const START = Date.parse('2026-11-14T10:00:00+02:00'); // la 14.11.
const HOUR = 3600_000;

function fixture(t, { ask = defaultAsk, staleAfterMs } = {}) {
  const store = openWhatsAppStore(':memory:');
  let clock = START;
  const drafts = openDraftStore(':memory:', () => clock);
  const member = { phone: '358401234567', company: 'Testikeittiö', person: 'Testaaja', binding: 'stale-test' };
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run(member.phone, member.company, member.person, member.binding);
  const tools = {
    suggest: async ({ draft }) => ({ issues: [], lines: draft.lines.map((l) => ({ ref: l.ref, total: 2, clarify: [], exact: true,
      options: [1, 2].map((i) => ({ productId: `${l.productTerm}-${i}`, name: `${l.productTerm} ${i}`, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 * i })) })) }),
    quote: async ({ draft }) => ({ quoteId: 'Q1', expiresAt: new Date(clock + 900_000).toISOString(), issues: [], totals: { net: 20 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 })) }),
    submit: async () => { throw new Error('tilausta ei tehdä tässä testissä'); },
  };
  const handleTurn = createOrderingConversation({ store: drafts, tools, now: () => clock, interpretTurn: createRuleInterpreter({ understand }) });
  const calls = [];
  const dialogue = createOrderingDialogue({ db: store.db, now: () => clock, timeOf: () => clock,
    ask: ask && (async (args) => { calls.push(args.purpose); return ask(args); }), ...(staleAfterMs !== undefined ? { staleAfterMs } : {}) });
  const bridge = createDemoOrderingChat({ store, phoneId: 'test-phone', loadOrdering: async () => ({ handleTurn, dialogue,
    getShoppingList: ({ conversationId, customer }) => shoppingListView(drafts.active(conversationId), customer),
    close: () => drafts.close(),
  }) });
  t.after(async () => { await bridge.close(); store.close(); });
  let seq = 0;
  const turn = (text, extra = {}) => bridge.chat({ member, messageId: `m${++seq}`, messages: [{ content: text }], receivedAt: clock, ...extra });
  return { turn, calls, store, list: () => bridge.getShoppingList(member), wait: (ms) => { clock += ms; } };
}
// Dialogimalli: kysymys on chat-reitti, muu viesti tilausmuutos. Korin kuittausmalli ei kirjoita mitään (koodin varateksti).
async function defaultAsk({ purpose, user }) {
  if (purpose === 'whatsapp_dialogue') {
    const { message } = JSON.parse(user);
    return { json: { route: /\?/.test(message || '') ? 'chat' : 'order', text: /\?/.test(message || '') ? 'Hyvä kysymys.' : '', lookupQuery: '', suggestionTerm: '', openCart: false } };
  }
  return { json: { acknowledgement: '', quantityQuestion: '', route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false } };
}
async function oldCart(f) {
  await f.turn('20 l maitoa ja 5 kg voita perjantaiksi');
  const before = await f.list();
  assert.deepEqual(before.lines.map((l) => l.productTerm), ['maito', 'voi']);
  return before;
}

test('tauon jälkeen uusi tuote ei mene hiljaa vanhaan koriin: vanha kori näytetään ja kysytään, lisätäänkö siihen', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  const before = await oldCart(f);
  f.wait(3 * HOUR);
  const asked = await f.turn('10 l kermaa');
  assert.deepEqual(asked.messages, [
    'Edellinen ostoskorisi jäi kesken (toimitus pe 20.11.):\n- maito 20 l\n- voi 5 kg',
    'Lisätäänkö tämä vanhaan ostoskoriin?\n1) kyllä, lisätään vanhaan\n2) ei, aloitetaan uusi tilaus',
  ]);
  const untouched = await f.list();
  assert.equal(untouched.id, before.id); assert.equal(untouched.revision, before.revision); // mitään ei lisätty ennen vastausta
  const kept = await f.turn('1');
  const after = await f.list();
  assert.equal(after.id, before.id);
  assert.deepEqual(after.lines.map((l) => [l.productTerm, l.quantity.value]), [['maito', 20], ['voi', 5], ['kerma', 10]]);
  assert.equal(kept.messages[0], 'Selvä, jatketaan vanhaa ostoskoria. Listalle tuli kerma 10 l.');
  // Siirtymä valintaan omana viestinään ennen vaihtoehtoja (Eelis 17.11.).
  assert.ok(CHOOSE_TRANSITIONS.includes(kept.messages[1]), kept.messages[1]);
  assert.match(kept.messages.at(-1), /\*Maito 20 l:\*\n1\) maito 1/);
});

test('vastaus "uusi" aloittaa uuden korin ja vie odottaneen viestin siihen; vanha kori suljetaan', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  const before = await oldCart(f);
  f.wait(5 * HOUR);
  await f.turn('10 l kermaa');
  const fresh = await f.turn('aloitetaan uusi');
  const after = await f.list();
  assert.notEqual(after.id, before.id);
  assert.deepEqual(after.lines.map((l) => l.productTerm), ['kerma']);
  assert.equal(after.deliveryDate, null);
  assert.match(fresh.messages[0], /^Selvä, aloitetaan uusi tilaus\./u);
  assert.match(fresh.text, /Mille päivälle/u); // uuden korin päivä kysytään, vanhaa ei peritä
});

test('pelkkä tervehdys tauon jälkeen saa "No moikka!" ja kysymyksen; "2" tyhjentää ja kysyy mitä tarvitaan', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  const before = await oldCart(f);
  f.wait(26 * HOUR);
  const hello = await f.turn('moro');
  assert.equal(hello.messages[0], 'No moikka! Edellinen ostoskorisi jäi kesken (toimitus pe 20.11.):\n- maito 20 l\n- voi 5 kg');
  assert.equal(hello.messages[1], 'Jatketaanko sitä vai aloitetaanko uusi tilaus?\n1) jatketaan vanhaa\n2) aloitetaan uusi tilaus');
  assert.equal((await f.list()).id, before.id);
  const two = await f.turn('2');
  assert.equal(two.text, 'Selvä, aloitetaan uusi tilaus. Mitä tilattais?');
  assert.equal(await f.list(), null);
});

test('"1" ilman odottavaa viestiä näyttää vanhan korin seuraavan vaiheen', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  await oldCart(f);
  f.wait(3 * HOUR);
  await f.turn('moi');
  const one = await f.turn('jatketaan vanhaa');
  assert.match(one.messages[0], /^Selvä, jatketaan vanhaa ostoskoria\./u);
  assert.match(one.text, /\*Maito 20 l:\*/u);
});

test('epäselvä vastaus kysyy uudelleen eikä muuta koria; mukana tullut määrä säilyy odottavassa viestissä', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  const before = await oldCart(f);
  f.wait(3 * HOUR);
  await f.turn('10 l kermaa');
  const again = await f.turn('mitä tarkoitat');
  assert.match(again.text, /^Vastaa vielä 1 tai 2/u);
  assert.equal((await f.list()).revision, before.revision);
  await f.turn('ja 3 kg juustoa');
  await f.turn('kyllä');
  assert.deepEqual((await f.list()).lines.map((l) => l.productTerm), ['maito', 'voi', 'kerma', 'juusto']);
});

test('ilman taukoa uusi tuote menee nykyiseen koriin kysymättä, ja siirtymäviesti tulee ennen vaihtoehtoja', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  await oldCart(f);
  f.wait(30 * 60_000);
  const r = await f.turn('10 l kermaa');
  assert.equal(r.messages[0], 'Listalle tuli kerma 10 l.');
  assert.ok(CHOOSE_TRANSITIONS.includes(r.messages[1]), r.messages[1]);
  assert.equal((await f.list()).lines.length, 3);
});

test('tuotekysymys, vaihtoehdon numero, kiitos tai selainkori tauon jälkeen eivät kysy korin kohtaloa', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  await oldCart(f);
  for (const text of ['onko teillä laktoositonta voita?', '1', 'kiitos']) {
    f.wait(3 * HOUR);
    const r = await f.turn(text);
    assert.doesNotMatch(r.text, /jäi kesken/u, text);
  }
  f.wait(3 * HOUR);
  const list = await f.list();
  const inCart = await f.turn('5 l kermaa', { expectedList: { id: list.id, revision: list.revision } });
  assert.doesNotMatch(inCart.text, /jäi kesken/u);
});

test('tauon jälkeinen tuotekysymys ei tee vanhasta korista tuoretta: heti perään tuleva lisäys kysyy silti', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  await oldCart(f);
  f.wait(3 * HOUR);
  assert.doesNotMatch((await f.turn('onko teillä laktoositonta voita?')).text, /jäi kesken/u);
  f.wait(60_000);
  const asked = await f.turn('3 kg juustoa');
  assert.match(asked.text, /Edellinen ostoskorisi jäi kesken[^]*Lisätäänkö tämä vanhaan ostoskoriin\?/u);
});

test('mennyt toimituspäivä: kysymys kertoo sen, ja vanhaa koria jatkettaessa päivä kysytään uudelleen', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  await oldCart(f);
  f.wait(7 * 24 * HOUR); // la 21.11., perjantai 20.11. on mennyt
  const asked = await f.turn('10 l kermaa');
  assert.match(asked.messages[0], /^Edellinen ostoskorisi jäi kesken \(toimitus oli pe 20\.11\., se päivä on jo mennyt\):/u);
  const kept = await f.turn('1');
  const list = await f.list();
  assert.equal(list.deliveryDate, null);
  assert.deepEqual(list.lines.map((l) => l.productTerm), ['maito', 'voi', 'kerma']);
  assert.match(kept.text, /Aiempi toimituspäivä pe 20\.11\. on jo mennyt, joten valitaan uusi päivä\./u);
  assert.match(kept.text, /Mille päivälle/u);
});

test('vanha tila ilman aikaleimaa ei kysy (käyttöönoton jälkeinen ensimmäinen viesti), ja 0 minuuttia ottaa kysymyksen pois', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
  const f = fixture(t);
  await oldCart(f);
  const row = f.store.db.prepare('SELECT json FROM wa_dialogue').get();
  const state = JSON.parse(row.json); delete state.lastActivity; delete state.cartActivity;
  f.store.db.prepare('UPDATE wa_dialogue SET json=?').run(JSON.stringify(state));
  f.wait(5 * HOUR);
  assert.doesNotMatch((await f.turn('10 l kermaa')).text, /jäi kesken/u);
  const g = fixture(t, { staleAfterMs: 0 });
  await oldCart(g);
  g.wait(48 * HOUR);
  assert.doesNotMatch((await g.turn('10 l kermaa')).text, /jäi kesken/u);
});

test('vastausten tunnistus ja asetus', () => {
  for (const text of ['1', '1)', 'kyllä', 'joo', 'lisää vanhaan', 'samaan koriin', 'jatketaan vanhaa', 'ei vaan vanhaan', 'ok']) assert.equal(staleCartChoice(text), 'old', text);
  for (const text of ['2', 'ei', 'uusi', 'uus tilaus', 'aloitetaan uusi', 'joo uusi', 'poista vanha', 'unohda se vanha', 'ei kiitos']) assert.equal(staleCartChoice(text), 'new', text);
  for (const text of ['mitä tarkoitat', '', 'en tiedä']) assert.equal(staleCartChoice(text), null, text);
  assert.equal(staleCartMinutes(undefined), 120); assert.equal(staleCartMinutes('30'), 30); assert.equal(staleCartMinutes('0'), 0);
  assert.equal(staleCartMinutes('abc'), 120); assert.equal(staleCartMinutes('-5'), 120);
});
