// Selfplay-100:n Valion data -sarjan löydökset (15.11.2026): hiilijalanjälkeä ei verrattu (V017, V020), "mikä edullisin" sai
// vastauksen "en näe hintoja" ja "listaa vaihtoehdot hintoineen" toisti valitun yhteenvedon (V025), ja 25 kilon perunasta
// kysyttiin laktoosia (X022). Ei mallia, katalogia tai verkkoa.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-option-compare-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { createOrderingConversation, compareKind, RELIST } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');

const t0 = Date.parse('2026-11-15T10:00:00+02:00');
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const milk = { intent: 'order', deliveryDate: '2026-11-18', ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [] }] };
const DATA = [{ lineNet: 110.6, co2PerKg: 1.1, deliveryReliability: 0.98 }, { lineNet: 169.8, co2PerKg: 0.9, deliveryReliability: null }, { lineNet: 171.8, co2PerKg: null, deliveryReliability: 0.91 }];

function core(script, { data = DATA, clarify = [] } = {}) {
  let n = 0; const calls = { suggest: 0, interpret: [] };
  const tools = {
    suggest: async ({ draft }) => {
      calls.suggest += 1; const l = draft.lines[0];
      return { issues: [], lines: [{ ref: l.ref, total: 3, more: false, exact: true, clarify: calls.suggest === 1 ? clarify : [],
        options: data.map((d, i) => ({ productId: `m-${i + 1}`, name: `maito ${i + 1}`, salesUnits: 4, salesUnitLabel: 'ltk', covers: l.quantity, labels: [], cutoff: null, ...d })) }] };
    },
    quote: async ({ draft }) => ({ quoteId: 'Q1', draftId: draft.id, revision: draft.revision, expiresAt: new Date(t0 + 900_000).toISOString(), issues: [], totals: { net: 10 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 4, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10, cutoffLabel: 'ti 17.11. klo 12.00' })) }),
    submit: async () => ({ status: 'confirmed', orderId: 'AGW-1', reasons: [] }),
  };
  const store = openDraftStore(':memory:', () => t0);
  const handleTurn = createOrderingConversation({ store, tools, now: () => t0, interpretTurn: async ({ text, draft }) => {
    calls.interpret.push(text); const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] };
  } });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: t0 });
  return { say, store, calls };
}

test('vertailukysymys näytettyyn listaan saa vastauksen vaihtoehtojen tiedoista, ilman valintaa tai mallikutsua', async () => {
  const { say, store, calls } = core({ '20 l maitoa keskiviikoks': milk });
  assert.equal((await say('20 l maitoa keskiviikoks')).status, 'choosing');
  const co2 = await say('Mikä vaihtoehdoista on ympäristöystävällisin, eli pienin hiilijalanjälki?');
  assert.equal(co2.status, 'choosing');
  assert.match(co2.text, /^Hiilijalanjälki: 1\) 1,1 kg CO2e\/kg, 2\) 0,9 kg CO2e\/kg, 3\) ei tietoa\. Pienin: 2\) maito 2\.\nToimitus: ke 18\.11\./);
  assert.match(co2.text, /\n1\) maito 1, 4 laatikkoa à 5 l, yhteensä 20 l, 110,60 €\n2\) maito 2/);
  const price = await say('Mikä vaihtoehdoista tulee edullisimmaksi?');
  assert.match(price.text, /^Vaihtoehdoista edullisin on 1\) maito 1, 110,60 € \(alv 0 %\)\./);
  assert.match((await say('mikä toimitetaan varmimmin? toimitusvarmuus?')).text, /^Toimitusvarmuus: 1\) 98 %, 2\) ei tietoa, 3\) 91 %\. Paras: 1\) maito 1\./);
  assert.deepEqual(calls.interpret, ['20 l maitoa keskiviikoks']); // kysymykset koodissa
  assert.equal(store.active('c').lines[0].selectedProductId, null);
  assert.equal(calls.suggest, 1); // sama lista, ei uutta hakua
  const picked = await say('se halvin');
  assert.equal(picked.status, 'ready');
  assert.equal(store.active('c').lines[0].selectedProductId, 'm-1');
});

test('ennen listaa kysytty vertailu vastataan, kun vaihtoehdot näytetään tarkennuksen jälkeen', async () => {
  const q = '20 l maitoa keskiviikoks. Mikä vaihtoehdoista on ympäristöystävällisin, eli pienin hiilijalanjälki?';
  const { say } = core({ [q]: milk }, { clarify: ['FREE_FROM_LACTOSE'] });
  const first = await say(q);
  assert.match(first.text, /Maito: haluatko laktoositonta vai käykö tavallinen\?/);
  assert.doesNotMatch(first.text, /Hiilijalanjälki/);
  const list = await say('2');
  assert.equal(list.status, 'choosing');
  assert.match(list.text, /^Hiilijalanjälki: 1\) 1,1 kg CO2e\/kg/);
  assert.doesNotMatch((await say('3')).text, /Hiilijalanjälki/); // valinnan jälkeen ei toisteta
});

test('valitun rivin vaihtoehdot näytetään pyynnöstä uudelleen, ja uusi numero vaihtaa valinnan', async () => {
  const { say, store } = core({ '20 l maitoa keskiviikoks': milk });
  await say('20 l maitoa keskiviikoks');
  assert.equal((await say('1')).status, 'ready');
  const again = await say('Määrä ja päivä on ok, mut onks toi luomu oikeesti halvin? Listaa vaihtoehdot hintoineen tai vaihda suoraan halvimpaan tavalliseen maitoon.');
  assert.equal(again.status, 'choosing');
  assert.match(again.text, /^Vaihtoehdoista edullisin on 1\) maito 1, 110,60 €/);
  assert.match(again.text, /\n1\) maito 1, .*\n2\) maito 2, .*\n3\) maito 3, .*\nVastaa 1, 2 tai 3\.\nJos haluat muita vaihtoehtoja, vastaa 4\./);
  assert.equal(store.active('c').lines[0].selectedProductId, null);
  assert.equal((await say('2')).status, 'ready');
  assert.equal(store.active('c').lines[0].selectedProductId, 'm-2');
  assert.match((await say('näytä vaihtoehdot')).text, /\n1\) maito 1/);
});

test('samassa viestissä tehty valinta säilyy, ja ilman tietoa tai tasatilanteessa se sanotaan', async () => {
  const pick = 'ykkönen, mut onks se halvin?';
  const { say, store } = core({ '20 l maitoa keskiviikoks': milk, [pick]: (d) => ({ intent: 'order', ops: [{ op: 'select', ref: d.lines[0].ref, option: 1 }] }) });
  await say('20 l maitoa keskiviikoks');
  assert.equal((await say(pick)).status, 'ready');
  assert.equal(store.active('c').lines[0].selectedProductId, 'm-1');
  const same = core({ '20 l maitoa keskiviikoks': milk }, { data: DATA.map((d) => ({ ...d, co2PerKg: 1.1 })) });
  await same.say('20 l maitoa keskiviikoks');
  assert.match((await same.say('mikä on ympäristöystävällisin?')).text, /^Hiilijalanjälki: 1\) 1,1 kg CO2e\/kg, 2\) 1,1 kg CO2e\/kg, 3\) 1,1 kg CO2e\/kg\. Arvo on kaikille sama\./);
  const none = core({ '20 l maitoa keskiviikoks': milk }, { data: DATA.map((d) => ({ ...d, co2PerKg: null })) });
  await none.say('20 l maitoa keskiviikoks');
  assert.match((await none.say('mikä on ympäristöystävällisin?')).text, /^Hiilijalanjälkitietoa ei ole näille vaihtoehdoille/);
  // Valintakomennot eivät ole kysymyksiä.
  for (const text of ['se halvin', 'Ja sit se halvin vaihtoehto.', '20 l maitoa huomiseks', 'kiitos']) assert.equal(compareKind(text), null, text);
  for (const text of ['näytä vaihtoehdot', 'onks halvempia?', 'Listaa ne maitovaihtoehdot numeroituna hintoineen']) assert.ok(RELIST.test(text), text);
});

test('laktoosia ei kysytä, kun allergeenitieto puuttuu suurimmalta osalta vaihtoehdoista (25 kg perunaa)', async () => {
  const day = '2026-11-18';
  const potato = (id, labels = []) => ({ id, name: `peruna ${id}`, qty: 1, unitLabel: 'sk', kg: 25, price: 10 + Number(id), labels, requested: true, availability: { deliveryDate: day, stock: 50 } });
  const run = async (products) => {
    const tools = createOrderingTools({ now: () => t0, buyer: (id) => ({ id }), product: (id) => products[id],
      search: async () => ['1', '2', '3', '4', '5', '6'].map((id) => potato(id, id === '1' || id === '2' ? ['FREE_FROM_LACTOSE'] : [])),
      requestQuote: async () => ({}), placeOrder: async () => ({}) });
    const s = await tools.suggest({ customer, draft: { id: 'd', revision: 1, deliveryDate: day, lines: [{ ref: 'a', productTerm: 'peruna', quantity: { value: 25, unit: 'KG' }, claims: [], excludeAllergens: [] }] } });
    return s.lines[0];
  };
  // Tuore peruna ilman allergeenitietoa, kaksi jalostettua tunnettua (toisessa maitoa): ei kysymystä.
  assert.deepEqual((await run({ 1: { hasAllergenData: true, contains: ['AM'] }, 2: { hasAllergenData: true, contains: [] } })).clarify, []);
  // Maitotuote, jonka tieto tunnetaan: kysymys säilyy.
  const dairy = Object.fromEntries(['1', '2', '3', '4', '5', '6'].map((id) => [id, { hasAllergenData: true, contains: id === '6' ? [] : ['AM'], co2: 1.1, reliability: 0.97 }]));
  const line = await run(dairy);
  assert.deepEqual(line.clarify, ['FREE_FROM_LACTOSE']);
  assert.equal(line.options[0].co2PerKg, 1.1);
  assert.equal(line.options[0].deliveryReliability, 0.97);
});

test('dialogi ohjaa vertailun tilausmoottorille eikä päästä läpi väitettä, ettei hintoja näe', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  let plan = {}; const ordered = [];
  const dialogue = createOrderingDialogue({ db: store.db, now: () => t0, ask: async () => ({ json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...plan } }) });
  let n = 0;
  const say = (text) => dialogue.respond({ binding: 'one', messageId: `d${++n}`, text, receivedAt: t0,
    runOrder: async (input) => { ordered.push(input); return { status: 'choosing', draftId: 'd1', revision: 2, text: 'Vaihtoehdoista edullisin on 1) maito 1, 110,60 € (alv 0 %).\nToimitus ke 18.11.' }; } });
  plan = { route: 'order', text: 'En näe hintoja itse, mutta vaihtoehdot eroavat pakkauskooltaan ja hinnaltaan.' };
  const r = await say('20 l maitoa keskiviikoks. Mikä vaihtoehdoista tulee edullisimmaksi?');
  assert.doesNotMatch(r.text, /En näe hintoja/);
  assert.match(r.text, /Vaihtoehdoista edullisin on 1\) maito 1/);
  assert.equal(ordered.length, 1);
  plan = { route: 'chat', text: 'Tuotekohtaisia hiilijalanjälkitietoja en pysty tästä varmistamaan. Isompi pakkaus säästää pakkausmateriaalia.' };
  const chat = await say('kumpi pakkaus kannattaa ottaa?');
  assert.equal(chat.text, 'Isompi pakkaus säästää pakkausmateriaalia.');
});
