// Eelis 17.11.2026: "tä ei tajunnu mikä on huomenna". Pilvibotin demokello piti sen sunnuntaissa 15.11., joten tiistaina
// "huomiseksi" oli ma 16.11. Botti käyttää nyt oikeaa päivää. Malli saa kalenterin viikonpäivineen, ja jos sen päivä ei ole
// mikään viestissä mainituista, käytetään sääntöjen päivää. Ei mallia eikä verkkoa: kello annetaan testissä.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-real-date-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.DEMO_NOW;
delete process.env.DEMO_NOW_LOOP_MINUTES;
const { helsinkiCalendar } = await import('../server/gateway/clock.mjs');
const { understand, deliveryDatesIn } = await import('../server/aimo/understand.mjs');
const { createModelInterpreter, createRuleInterpreter } = await import('../server/order-conversation/interpret.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Ti 17.11.2026 klo 0.20 Helsingin aikaa (UTC+2), kun Eelis kirjoitti viestinsä.
const TUESDAY_NIGHT = Date.parse('2026-11-16T22:20:00Z');
const draft = () => ({ deliveryDate: null, lines: [], offered: {}, pending: null });

test('kalenteri alkaa Helsingin tästä päivästä ja kertoo viikonpäivän sekä huomisen', () => {
  const cal = helsinkiCalendar(new Date(TUESDAY_NIGHT), 8);
  assert.equal(cal[0], '2026-11-17 tiistai tänään');
  assert.equal(cal[1], '2026-11-18 keskiviikko huomenna');
  assert.equal(cal[2], '2026-11-19 torstai ylihuomenna');
  assert.equal(cal[3], '2026-11-20 perjantai');
  assert.equal(cal[6], '2026-11-23 maanantai');
  // UTC:ssä on vielä maanantai 16.11., mutta Helsingissä tiistai.
  assert.notEqual(new Date(TUESDAY_NIGHT).toISOString().slice(0, 10), '2026-11-17');
});

test('säännöt lukevat suhteelliset päivät oikeasta päivästä', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  const now = new Date(TUESDAY_NIGHT);
  const day = (text) => understand(text, { now }).deliveryDate;
  assert.equal(day('20 kananmunaa huomiseksi'), '2026-11-18');
  assert.equal(day('maitoa 10 l huomenna'), '2026-11-18');
  assert.equal(day('voita 5 kg ylihuomiseksi'), '2026-11-19');
  assert.equal(day('kermaa perjantaiks'), '2026-11-20');
  assert.equal(day('maitoa tiistaiksi'), '2026-11-24', 'tänään tiistaina "tiistaiksi" on ensi viikon tiistai');
  assert.deepEqual(deliveryDatesIn('huomenna on juhlat, tarvitaan voita perjantaiksi', { now }), ['2026-11-18', '2026-11-20']);
  assert.deepEqual(deliveryDatesIn('20 l maitoa', { now }), []);
});

test('malli saa kalenterin, ja väärin laskettu päivä korjataan viestin päiväksi', async () => {
  const seen = [];
  const answer = { intent: 'order', deliveryDate: '', ops: [] };
  const interpret = createModelInterpreter({
    ask: async ({ user }) => { seen.push(user); return { json: answer }; },
    fallback: async () => { throw new Error('ei varapolkua'); },
    datesIn: deliveryDatesIn,
  });
  const turn = (text, modelDate) => { answer.deliveryDate = modelDate; return interpret({ text, draft: draft(), today: '2026-11-17', now: TUESDAY_NIGHT }); };

  // Demokellon aikainen virhe: malli luuli tiistain huomista maanantaiksi.
  assert.equal((await turn('20 kananmunaa huomiseksi', '2026-11-16')).deliveryDate, '2026-11-18');
  assert.match(seen[0], /2026-11-18 keskiviikko huomenna/);
  assert.match(seen[0], /2026-11-17 tiistai tänään/);
  // Oikea mallin päivä säilyy, myös kun viestissä on kaksi päivää.
  assert.equal((await turn('huomenna on juhlat, tarvitaan voita perjantaiksi', '2026-11-20')).deliveryDate, '2026-11-20');
  assert.equal((await turn('kermaa perjantaiks', '2026-11-21')).deliveryDate, '2026-11-20');
  // Kun malli ei löytänyt toimituspäivää, sitä ei keksitä sanasta "huomenna".
  assert.equal((await turn('kiitos, puhutaan huomenna', '')).deliveryDate, null);
  // Viestissä ei päivää: mallin päivä (esim. vastaus "samalle päivälle") säilyy.
  assert.equal((await turn('samalle päivälle kuin viimeksi', '2026-11-19')).deliveryDate, '2026-11-19');
});

test('keskustelu tiistaiyönä: "huomiseksi" on ke 18.11. ja haku tehdään sille päivälle', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const t = TUESDAY_NIGHT;
  const searched = [];
  const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
  const tools = createOrderingTools({
    now: () => t, product: () => ({ hasAllergenData: true, contains: [], mayContain: [] }), buyer: (id) => (id === 'b1' ? { id } : null),
    search: async (line, deliveryDate) => {
      searched.push(deliveryDate);
      return [{ id: 'E1', name: 'Kieku M10 kananmuna', brand: 'Kieku', qty: 2, unitLabel: 'ras', price: 2, labels: [],
        availability: { deliveryDate, stock: 100 }, quantityExplanation: { providedItems: 20, text: '2 rasiaa × 10 munaa = 20 munaa' } }];
    },
    requestQuote: async () => { throw new Error('ei tarjousta tässä testissä'); },
    placeOrder: async () => { throw new Error('ei tilausta tässä testissä'); },
  });
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => t), tools, now: () => t, interpretTurn: createRuleInterpreter({ understand }) });
  const r = await handleTurn({ messageId: 'm1', conversationId: 'conv', customer, text: 'moi tarviin 20 kananmunaa huomiseksi', receivedAt: t });
  assert.ok(searched.length, 'tuotteet haettiin');
  assert.ok(searched.every((d) => d === '2026-11-18'), `haku päivälle ${searched.join(', ')}`);
  assert.match(r.text, /ke 18\.11\./);
  assert.doesNotMatch(r.text, /16\.11\./);
});
