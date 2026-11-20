// WhatsApp 18.11. klo 9.39: ääniviesti "500 kiloa … bileet olis viikon päästä keskiviikkona, niin toimitus about lauantaina".
// Apuri vastasi "Bileet keskiviikkona 25.11. ovat ennen lauantain 28.11. toimitusta … vai bileisiin keskiviikkona 2.12.?",
// vaikka lähin lauantai on 21.11. Samalla Eelis antoi pohjan selkeämmälle vaihtoehtolistalle ja tilausluonnokselle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { deliveryDateCue, deliveryDatesIn, understand } = await import('../server/aimo/understand.mjs');
const { createModelInterpreter, createRuleInterpreter } = await import('../server/order-conversation/interpret.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { withCartHandoffHint } = await import('../server/whatsapp/cart-handoff.mjs');
const { createOrderingDialogue, isFreshStart } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { voiceProblem } = await import('../server/whatsapp/voice.mjs');

const WED = new Date('2026-11-18T09:40:00+02:00');
const VOICE = 'Joo, lisätään. Pystytkö sä laittaa sitä about, silleen, tarvisin 500 kiloa, niin tää menis isoihin bileisiin ja nähä bileet olis tarkotus olla viikon päästä keskiviikkona, niin toimitus about silleen varmaan lauantaina.';

test('toimituspäivä on lähin lauantai, ei bileiden keskiviikko eikä seuraavan viikon lauantai', () => {
  assert.deepEqual(deliveryDateCue(VOICE, { now: WED }), { delivery: '2026-11-21', events: ['2026-11-25'] });
  assert.deepEqual(deliveryDatesIn('eiku siis viikon päästä keskiviikkona etkö tajua?', { now: WED }), ['2026-11-25']);
  // "on" on myös englannin etuliite ("on monday"): se ei saa niellä sanaa "viikon".
  assert.deepEqual(deliveryDatesIn('juhlat on viikon päästä torstaina', { now: WED }), ['2026-11-26']);
  assert.deepEqual(deliveryDatesIn('100 l milk on monday', { now: WED }), ['2026-11-23']);
  assert.equal(deliveryDateCue('bileet lauantaina, toimitus perjantaina', { now: WED }).delivery, '2026-11-20');
  // Sama lause sisältää sekä toimituksen että tapahtuman: ei ratkaista sanoista.
  assert.equal(deliveryDateCue('toimitus ennen bileitä lauantaina', { now: WED }).delivery, null);
  assert.equal(deliveryDateCue('20 l maitoa perjantaiksi', { now: WED }).delivery, null);
});

test('sääntötulkki käyttää samaa toimituspäivää', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'paikallinen katalogi puuttuu' }, () => {
  assert.equal(understand(VOICE, { now: WED }).deliveryDate, '2026-11-21');
});

test('mallitulkin väärä päivä korjataan asiakkaan nimeämään toimituspäivään', async () => {
  const draft = { lines: [], offered: {}, pending: null };
  for (const wrong of ['2026-11-28', '2026-11-25', '']) {
    const interpret = createModelInterpreter({ datesIn: deliveryDatesIn, dateCue: deliveryDateCue, fallback: async () => ({ intent: 'other', ops: [] }),
      ask: async () => ({ json: { intent: 'order', deliveryDate: wrong, ops: [{ op: 'add', ref: '', productTerm: 'lanttulaatikko', quantity: 500, quantityUnit: 'KG', claims: [], excludeAllergens: [], option: 0 }] } }) });
    const r = await interpret({ text: VOICE, draft, today: '2026-11-18', now: WED.getTime() });
    assert.equal(r.deliveryDate, '2026-11-21', `malli: ${wrong || 'tyhjä'}`);
  }
});

const clock = WED.getTime();
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', companyName: 'Koekeittiö', deliverySites: [], permissions: { readProducts: true, placeOrders: true } };
const option = (productId, brand, name, salesUnits, kg, lineNet) => ({ productId, brand, name, salesUnits, salesUnitLabel: 'kpl', covers: { value: kg, unit: 'KG' }, unitPriceNet: lineNet / salesUnits, lineNet, labels: [] });
function engine({ rules = false } = {}) {
  const options = [option('A1', 'Saarioinen', 'Saarioinen maksalaatikko laktoositon 2,7 kg', 186, 502.2, 2293.38), option('A2', 'Feelia F', 'Feelia F nakki-perunasoselaatikko 2,5 kg', 200, 500, 2542)];
  const tools = {
    async suggest({ draft }) {
      const l = draft.lines[0];
      return { issues: [], lines: [{ ref: l.ref, total: 3, more: true, exact: false, clarify: [], options }] };
    },
    async quote({ draft }) {
      const l = draft.lines[0];
      const o = options.find((x) => x.productId === l.selectedProductId);
      return { issues: [], lines: [{ ref: l.ref, productId: o.productId, name: o.name, salesUnits: o.salesUnits, salesUnitLabel: 'kpl', covers: o.covers, lineNet: o.lineNet,
        cutoff: '2026-11-20T10:00:00Z' }], totals: { net: o.lineNet } };
    },
    async submit() { return { status: 'rejected', reasons: [] }; },
  };
  const add = { intent: 'order', deliveryDate: '2026-11-21', ops: [{ op: 'add', productTerm: 'lanttulaatikko', quantity: { value: 500, unit: 'KG' }, claims: [], excludeAllergens: [] }] };
  let n = 0;
  // Poisto sääntötulkilla ilman katalogia: jäsennin ei tunne sanaa, joten rivi löytyy vihjeen sanasta sellaisenaan.
  const ruleTurn = createRuleInterpreter({ understand: () => ({ items: [] }) });
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => clock), tools, now: () => clock,
    interpretTurn: async (input) => (/lanttu/.test(input.text) ? add : rules ? ruleTurn(input) : { intent: 'other', ops: [] }) });
  return (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: clock });
}

test('vaihtoehdot Eeliksen pohjan mukaan: toimitus ja hinnat omilla riveillään, korvaajat, ohje ja lisävaihtoehdot', async () => {
  const say = engine();
  const r = await say('500 kg lanttulaatikkoa lauantaiksi');
  assert.equal(r.status, 'choosing');
  assert.equal(r.text, ['Toimitus: la 21.11.', 'Hinnat alv 0 %', 'Lanttulaatikolle ei valitettavasti löytynyt osumaa.', 'Tässä korvaajia (tarve 500 kg):',
    '1) Saarioinen maksalaatikko laktoositon 2,7 kg, 186 kpl, yhteensä 502,2 kg, 2293,38 €', '2) Feelia F nakki-perunasoselaatikko 2,5 kg, 200 kpl, yhteensä 500 kg, 2542,00 €',
    'Vastaa 1 tai 2.', 'Jos haluat muita vaihtoehtoja, vastaa 3.'].join('\n'));
  assert.doesNotMatch(r.text, /Varmuuden vuoksi|Tuotteiden pitää|Näytä lisää/);

  const summary = await say('1');
  assert.equal(summary.status, 'ready');
  assert.equal(summary.text, ['*Tilausluonnos*', 'Toimitus: la 21.11.', 'Koekeittiö', '', '*Tuotteet*',
    '- Saarioinen maksalaatikko laktoositon 2,7 kg: 186 kpl, yhteensä 502,2 kg (pyysit 500 kg), 2293,38 €', '', 'Yhteensä: 2293,38 € (alv 0 %)',
    'Tilaus pitää tehdä viimeistään pe 20.11. klo 12.00.', '', 'Vahvista vastaamalla *TILAA*.',
    // Korvaaja nimetään vihjeessä (E:n havainto 18.11.: "poista lanttulaatikko", vaikka rivillä oli maksalaatikko).
    'Voit vielä muuttaa, esim. "maksalaatikko 750 kg", "poista maksalaatikko" tai "tyhjennä ostoskori".'].join('\n'));
  // WhatsAppissa TILAA-rivi vaihtuu kahdeksi riviksi ok-ohjetta.
  const wa = withCartHandoffHint(summary).text;
  assert.match(wa, /\n\nVastaa \*ok\*, niin saat linkin ostoskoriin\.\nTarkistat ja vahvistat tilauksen siellä\.\nVoit vielä muuttaa, esim\./);
  // Lauseen keskellä ohje pysyy yhtenä rivinä.
  assert.equal(withCartHandoffHint({ status: 'ready', text: 'Ole hyvä! Luonnos odottaa vahvistusta: vastaa *TILAA*, kun haluat tilata.' }).text,
    'Ole hyvä! Luonnos odottaa vahvistusta: Vastaa *ok*, niin saat linkin ostoskoriin. Tarkistat ja vahvistat tilauksen siellä.');
});

test('vihjeen "poista maksalaatikko" poistaa korvaajarivin', async () => {
  const say = engine({ rules: true });
  await say('500 kg lanttulaatikkoa lauantaiksi');
  assert.match((await say('1')).text, /"poista maksalaatikko"/);
  const removed = await say('poista maksalaatikko');
  assert.match(removed.text, /^Luonnos on tyhjä\./);
  assert.doesNotMatch(removed.text, /\*Tilausluonnos\*/);
});

test('äänikerros ei lisää valinnan kuittaukseen uutta vastausohjetta', () => {
  const segments = ['Selvä, valitaan Saarioinen lanttulaatikko 2,8 kg.'];
  assert.equal(voiceProblem({ original: segments, segments, tokens: [], rewritten: ['Joo, selvä! Otetaan Saarioinen lanttulaatikko 2,8 kg. Vastaa 1, jos tämä käy.'], userText: '1' }), 'instruction');
  assert.equal(voiceProblem({ original: segments, segments, tokens: [], rewritten: ['Joo, otetaan Saarioinen lanttulaatikko 2,8 kg.'], userText: '1' }), null);
});

test('"tyhjennä ostoskori" aloittaa alusta kuten "tyhjennä lista"', () => {
  for (const text of ['tyhjennä ostoskori', 'tyhjennä kori', 'tyhjennä koko ostoskori', 'poista koko ostoskori']) assert.equal(isFreshStart(text), true, text);
  assert.equal(isFreshStart('älä tyhjennä ostoskoria'), false);
});

test('dialogimalli saa kalenterin eikä laske viikonpäiviä itse', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Koekeittiö', 'Testaaja', 'one');
  let input; let system;
  const ask = async ({ purpose, user, system: s }) => {
    if (purpose === 'whatsapp_dialogue') { input = JSON.parse(user); system = s; }
    return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false } };
  };
  const dialogue = createOrderingDialogue({ db: store.db, ask, now: () => clock, timeOf: () => clock });
  await dialogue.respond({ binding: 'one', messageId: 'm1', text: VOICE, runOrder: async () => ({ status: 'collecting', draftId: 'd1', revision: 1, text: 'Kuinka paljon?' }) });
  assert.ok(input.calendar.some((d) => d.startsWith('2026-11-21 lauantai')), JSON.stringify(input.calendar.slice(0, 4)));
  assert.match(system, /Toimitus ennen tapahtumaa on tavallista eikä ristiriita/);
  assert.match(system, /Älä koskaan ehdota tapahtuman siirtämistä/);
});
