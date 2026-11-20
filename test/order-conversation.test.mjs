import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-order-conversation-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createRuleInterpreter, createModelInterpreter } = await import('../server/order-conversation/interpret.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const L = { value: 20, unit: 'L' };

// Testityökalut ja käsikirjoitettu tulkki: keskustelun säännöt ilman katalogia, mallia tai gatewayta.
function setup({ script = {}, over = {}, file = ':memory:' } = {}) {
  let t = Date.parse('2026-11-14T08:00:00Z'); let n = 0;
  const calls = { suggest: 0, quote: [], submit: [] };
  const tools = {
    suggest: async ({ draft }) => { calls.suggest += 1; return { issues: [], lines: draft.lines.map((l) => ({ ref: l.ref, total: 2, clarify: l.productTerm === 'maito' && !l.claims.length ? ['FREE_FROM_LACTOSE'] : [],
      options: [1, 2].map((i) => ({ productId: `${l.productTerm}-${i}`, name: `${l.productTerm} ${i}`, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 * i })) })) }; },
    quote: async ({ draft }) => { calls.quote.push(structuredClone(draft)); return { quoteId: `Q${calls.quote.length}`, draftId: draft.id, revision: draft.revision, expiresAt: new Date(t + 900_000).toISOString(), issues: [], totals: { net: 20 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10, cutoffLabel: 'su 15.11. klo 12.00' })) }; },
    submit: async (args) => { calls.submit.push(structuredClone(args)); return { status: 'confirmed', orderId: 'AGW-1', deliveryDate: args.draft.deliveryDate, totals: { net: 20 }, reasons: [] }; },
    ...over,
  };
  const store = openDraftStore(file, () => t);
  const handleTurn = createOrderingConversation({ store, tools, now: () => t,
    interpretTurn: async ({ text, draft }) => { const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] }; } });
  const say = (text, extra = {}) => handleTurn({ messageId: extra.messageId || `m${++n}`, conversationId: 'conv', customer: 'customer' in extra ? extra.customer : customer, text, receivedAt: t });
  return { say, calls, store, tick: (ms) => { t += ms; } };
}
// Vaihtoehdot näytetään yksi rivi kerrallaan: kahden rivin valinta on kaksi peräkkäistä vastausta.
const pick = async (say, ...numbers) => { let r; for (const n of numbers) r = await say(String(n)); return r; };
const add = (productTerm, quantity = null, claims = []) => ({ op: 'add', productTerm, quantity, claims, excludeAllergens: [] });
const ref = (draft, term) => draft.lines.find((l) => l.productTerm === term).ref;
const ready = {
  'maitoa ja kermaa': { intent: 'order', deliveryDate: '2026-11-16', ops: [add('maito', L, ['FREE_FROM_LACTOSE']), add('kerma', { value: 5, unit: 'L' })] },
  '1 2': (d) => ({ intent: 'order', ops: [{ op: 'select', ref: ref(d, 'maito'), option: 1 }, { op: 'select', ref: ref(d, 'kerma'), option: 2 }] }),
  'maitoa 30': (d) => ({ intent: 'order', ops: [{ op: 'update', ref: ref(d, 'maito'), quantity: { value: 30, unit: 'L' } }] }),
};

test('päivä ensin ja puuttuvat määrät samassa viestissä, ruokavalintaa kysytään vasta relevanttien ehdokkaiden perusteella', async () => {
  const { say, calls, store } = setup({ script: {
    'maitoa ja kermaa': { intent: 'order', ops: [add('maito'), add('kerma')] },
    maanantaiksi: { intent: 'order', deliveryDate: '2026-11-16', ops: [] },
    '20 l maitoa': (d) => ({ intent: 'order', ops: [{ op: 'update', ref: ref(d, 'maito'), quantity: L }] }),
    'kermaa 5 l': (d) => ({ intent: 'order', ops: [{ op: 'update', ref: ref(d, 'kerma'), quantity: { value: 5, unit: 'L' } }] }),
    pähkinätön: { intent: 'order', ops: [{ op: 'diet', addClaims: [], excludeAllergens: ['AN', 'AP', 'keksitty'] }] },
    huomenna: { intent: 'order', deliveryDate: '2026-11-13', ops: [] },
  } });
  assert.match((await say('moi')).text, /tilausapuri/);
  const a = await say('maitoa ja kermaa');
  assert.equal(a.status, 'collecting');
  assert.match(a.text, /\n\nMille päivälle toimitus\?[^\n]*\nKuinka paljon: maito, kerma\?$/);
  assert.doesNotMatch(a.text, /allergioita|gluteeniton|pähkinätön/);
  const asked = store.active('conv');
  assert.deepEqual(asked.pending, { kind: 'checklist', asks: ['date', 'quantity'], refs: [ref(asked, 'maito'), ref(asked, 'kerma')] });
  assert.equal(calls.suggest, 0); // tuotteita ei haeta ennen päivää
  const b = await say('maanantaiksi');
  assert.match(b.text, /Kuinka paljon: maito, kerma\?$/);
  assert.doesNotMatch(b.text, /Mille päivälle/);
  assert.doesNotMatch(b.text, /Onko allergioita/);
  await say('20 l maitoa');
  const c = await say('kermaa 5 l');
  assert.match(c.text, /Maito: haluatko laktoositonta vai käykö tavallinen/);
  assert.doesNotMatch(c.text, /Kuinka paljon/);
  assert.equal(calls.suggest, 1); // kohdennettu kysymys perustuu haun todellisiin vaihtoehtoihin
  const d = await say('pähkinätön');
  assert.equal(d.status, 'choosing');
  assert.match(d.text, /Toimitus: ma 16\.11\.\nHinnat alv 0 %\nHuomioitu: pähkinätön, ei maapähkinää\n/);
  assert.deepEqual(store.active('conv').diet, { known: true, claims: [], excludeAllergens: ['AN', 'AP'] });
  assert.match(d.text, /\*Maito 20 l:\*\n1\) maito 1, 2 laatikkoa à 10 l, yhteensä 20 l, 10,00 €\n2\) maito 2, 2 laatikkoa à 10 l, yhteensä 20 l, 20,00 €\nVastaa 1 tai 2\.\nSen jälkeen valitaan kerma\.$/);
  assert.doesNotMatch((await say('näytä')).text, /Onko allergioita/); // ei kysytä toista kertaa
  const past = await say('huomenna');
  assert.match(past.text, /Toimituspäivän pitää olla tuleva päivä/);
  assert.equal(past.revision, d.revision);
});

test('maitovaihtoehtojen relevanttiin tarkennukseen ei riittää ja päätös säilyy', async () => {
  const { say, calls, store } = setup({ script: {
    'nyt tarvii 1000 litraa maitoo ku on juhlat keskiviikkona': { intent: 'order', deliveryDate: '2026-11-18', ops: [add('maito', { value: 1000, unit: 'L' })] },
    ei: { intent: 'order', ops: [{ op: 'diet', addClaims: [], excludeAllergens: [] }] },
    'kaikki laktoosittomana': { intent: 'order', ops: [{ op: 'diet', addClaims: ['FREE_FROM_LACTOSE'], excludeAllergens: [] }] },
    1: (d) => ({ intent: 'order', ops: [{ op: 'select', ref: d.lines[0].ref, option: 1 }] }),
  } });
  const a = await say('nyt tarvii 1000 litraa maitoo ku on juhlat keskiviikkona');
  assert.match(a.text, /- maito 1000 l\n\nMaito: haluatko laktoositonta/);
  assert.doesNotMatch(a.text, /Mille päivälle|Kuinka paljon/);
  assert.equal(calls.suggest, 1);
  const b = await say('ei');
  assert.equal(b.status, 'choosing');
  assert.equal(b.revision, a.revision + 1);
  assert.deepEqual(store.active('conv').lines[0].answeredClaims, ['FREE_FROM_LACTOSE']);
  assert.doesNotMatch(b.text, /Huomioitu/);
  const ready1 = await say('1');
  assert.equal(ready1.status, 'ready');
  // Ruokavalion muutos yhteenvedon jälkeen purkaa valinnat ja hyväksynnän.
  const c = await say('kaikki laktoosittomana');
  assert.equal(c.status, 'choosing');
  assert.equal(c.revision, ready1.revision + 1);
  assert.match(c.text, /Huomioitu: laktoositon\n/);
  assert.equal(store.active('conv').lines[0].selectedProductId, null);
  const ready2 = await say('1');
  assert.match(ready2.text, /Huomioitu: laktoositon\n\n\*Tuotteet\*\n- maito 1/);
  assert.deepEqual(calls.quote.at(-1).diet, { known: true, claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [] });
});

test('tavalliset kananmunat eivät laukaise yleistä ruokavaliolomaketta', async () => {
  const { say, store } = setup({ script: {
    munia: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('kananmuna', { value: 50, unit: 'PCS', basis: 'items' })] },
  } });
  const reply = await say('munia');
  assert.equal(reply.status, 'choosing');
  assert.doesNotMatch(reply.text, /laktoosi|gluteeni|allergioita|pähkinä/i);
  assert.equal(store.active('conv').diet.known, false);
  assert.equal(store.active('conv').pending.kind, 'choose');
});

test('tuotekohtaisen laktoosikysymyksen kyllä koskee vain kysyttyä maitoa, ei kananmunia', async () => {
  const { say, store } = setup({ script: {
    tuotteet: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('maito', L), add('kananmuna', { value: 50, unit: 'PCS', basis: 'items' })] },
  } });
  const question = await say('tuotteet');
  assert.match(question.text, /Maito: haluatko laktoositonta/);
  assert.deepEqual(store.active('conv').pending.refs, ['L1']);
  assert.equal((await say('joo')).status, 'choosing');
  const draft = store.active('conv');
  assert.deepEqual(draft.lines[0].claims, ['FREE_FROM_LACTOSE']);
  assert.deepEqual(draft.lines[1].claims, []); assert.deepEqual(draft.diet.claims, []);
});

test('ei väliä vastaa relevanttiin kysymykseen pysyvästi ja säilyttää muut tuotteet', async () => {
  const { say, store } = setup({ script: {
    tuotteet: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('maito', L), add('kananmuna', { value: 50, unit: 'PCS', basis: 'items' })] },
  } });
  await say('tuotteet');
  assert.equal((await say('ei väliä')).status, 'choosing');
  const shown = await say('näytä');
  assert.equal(shown.status, 'choosing'); assert.doesNotMatch(shown.text, /haluatko/);
  assert.deepEqual(store.active('conv').lines[0].answeredClaims, ['FREE_FROM_LACTOSE']);
  assert.equal(store.active('conv').lines.length, 2);
});

test('syvä mallitulkki muuntaa alkuperäisen DL/G-yksikön ja saa kysymyksen sekä vaihtoehtojen hinnat', async () => {
  let request;
  const interpret = createModelInterpreter({ fallback: () => { throw new Error('must use model'); }, ask: async (args) => {
    request = args;
    return { json: { intent: 'order', deliveryDate: '', ops: [
      { op: 'update', ref: 'L1', quantityValue: 5, quantityUnit: 'DL' },
      { op: 'update', ref: 'L2', quantityValue: 500, quantityUnit: 'G' },
    ] } };
  } });
  const result = await interpret({ text: '5 desii ja puoli kiloa', today: '2026-11-15',
    context: { history: [{ role: 'assistant', text: 'Kuinka paljon kermaa ja voita?' }], lastReply: 'Kuinka paljon kermaa ja voita?' },
    draft: { lines: [{ ref: 'L1', productTerm: 'kerma', claims: [], excludeAllergens: [] }],
      offered: { L1: [{ name: 'Ruokakerma', lineNet: 5.37, productId: 'hidden-id' }] }, pending: null } });
  assert.deepEqual(result.ops.map((o) => o.quantity), [{ value: 0.5, unit: 'L' }, { value: 0.5, unit: 'KG' }]);
  assert.equal(request.tier, 'deep'); assert.equal(request.timeoutMs, 60000);
  assert.match(request.user, /Kuinka paljon kermaa ja voita/); assert.match(request.user, /5.37/); assert.doesNotMatch(request.user, /hidden-id/);
});

test('tuotevalinta tulee vain näytetyistä vaihtoehdoista ja TILAA tallentaa juuri hyväksytyn version kerran', async () => {
  const { say, calls } = setup({ script: { ...ready,
    '9 9': (d) => ({ intent: 'order', ops: d.lines.map((l) => ({ op: 'select', ref: l.ref, option: 9, productId: 'keksitty' })) }) } });
  const options = await say('maitoa ja kermaa');
  assert.equal(options.status, 'choosing');
  const bad = await say('9 9');
  assert.equal(bad.status, 'choosing');
  assert.match(bad.text, /Valitse numero näytetyistä vaihtoehdoista/);
  assert.equal(bad.revision, options.revision);
  const summary = await pick(say, 1, 2);
  assert.equal(summary.status, 'ready');
  assert.match(summary.text, /^\*Tilausluonnos\*\nToimitus: ma 16\.11\.\n\n\*Tuotteet\*\n/);
  assert.match(summary.text, /\nYhteensä: 20,00 € \(alv 0 %\)\n/);
  assert.match(summary.text, /TILAA/);
  assert.deepEqual(calls.quote[0].lines.map((l) => l.selectedProductId), ['maito-1', 'kerma-2']);
  // Pelkkä myöntävä sana ei ole tilauslupa.
  assert.match((await say('joo')).text, /Vahvista tilaus vastaamalla \*TILAA\*/);
  assert.equal(calls.submit.length, 0);
  const done = await say('Tilaa!', { messageId: 'sama' });
  assert.equal(done.status, 'confirmed');
  assert.match(done.text, /Tilaus AGW-1 on tallennettu/);
  assert.match(done.text, /oikeaa Valio-tilausta ei lähetetty/);
  const sent = calls.submit[0];
  assert.deepEqual(sent.approval, { draftId: done.draftId, revision: summary.revision, quoteId: 'Q1' });
  assert.equal(sent.idempotencyKey, `wa-${done.draftId}-r${summary.revision}`);
  // Sama webhook-viesti ja uusi TILAA-viesti: ei toista tilausta.
  assert.deepEqual(await say('Tilaa!', { messageId: 'sama' }), done);
  assert.match((await say('tilaa')).text, /Tilaus AGW-1 on jo tallennettu/);
  assert.equal(calls.submit.length, 1);
});

test('määrän muutos kasvattaa revisiota, mitätöi hyväksynnän ja vaatii uuden yhteenvedon', async () => {
  const { say, calls } = setup({ script: ready });
  await say('maitoa ja kermaa');
  const first = await pick(say, 1, 2);
  const changed = await say('maitoa 30');
  assert.equal(changed.status, 'ready');
  assert.equal(changed.revision, first.revision + 1);
  assert.match(changed.text, /yhteensä 30 l/);
  assert.equal(calls.quote.length, 2);
  assert.equal(calls.quote[1].lines[0].selectedProductId, 'maito-1'); // valinta säilyy, tarjous tarkistetaan uudelleen
  await say('tilaa');
  assert.deepEqual(calls.submit[0].approval, { draftId: changed.draftId, revision: changed.revision, quoteId: 'Q2' });
});

test('ruokavaatimuksen muutos purkaa tuotevalinnan eikä tilaa vanhalla tuotteella', async () => {
  const { say, calls } = setup({ script: { ...ready,
    'kerma laktoosittomana': (d) => ({ intent: 'order', ops: [{ op: 'update', ref: ref(d, 'kerma'), addClaims: ['FREE_FROM_LACTOSE', 'KEKSITTY'] }] }) } });
  await say('maitoa ja kermaa'); await pick(say, 1, 2);
  const again = await say('kerma laktoosittomana');
  assert.equal(again.status, 'choosing');
  assert.match(again.text, /Kerma 5 l \(laktoositon\)/);
  assert.doesNotMatch(again.text, /KEKSITTY/);
  const early = await say('tilaa');
  assert.match(early.text, /Vahvistettavaa yhteenvetoa ei vielä ole/);
  assert.equal(calls.submit.length, 0);
});

test('epäonnistunut tarjous tai tilaus ei tuota onnistumiskuittausta ja luonnos säilyy', async () => {
  let quoteOk = false;
  const { say, calls, store } = setup({ script: ready, over: {
    quote: async ({ draft }) => (quoteOk ? { quoteId: 'Q1', revision: draft.revision, expiresAt: '2026-11-14T09:00:00Z', issues: [], totals: { net: 20 }, lines: [] }
      : { quoteId: null, issues: [{ code: 'NOT_DELIVERABLE', message: 'Ei tilattavissa: kerma.', ref: draft.lines[1].ref }], lines: [], totals: null }),
    submit: async (args) => { calls.submit.push(args); return { status: 'rejected', orderId: null, reasons: [{ code: 'OFFER_STALE', message: 'Hinta on muuttunut.' }] }; },
  } });
  await say('maitoa ja kermaa');
  const failed = await pick(say, 1, 2);
  assert.notEqual(failed.status, 'ready');
  assert.match(failed.text, /Kerma 2 ei käy\. Jätin sen pois vaihtoehdoista\.\nTilausta ei ole tehty\./); // tuote nimetään, ei sama lista uudelleen
  assert.match(failed.text, /\*Kerma 5 l:\*/); // ostaja valitsee uudelleen, mitään ei vaihdeta hiljaa
  assert.equal(store.active('conv').lines[1].selectedProductId, null);
  assert.equal(store.active('conv').lines[0].selectedProductId, 'maito-1');
  quoteOk = true;
  assert.equal((await say('näytä')).status, 'choosing');
  await say('jotain muuta'); // tuntematon viesti: ei muutoksia
  const s = setup({ script: ready, over: { submit: async () => ({ status: 'rejected', orderId: null, reasons: [{ code: 'OFFER_STALE', message: 'Hinta on muuttunut.' }] }) } });
  await s.say('maitoa ja kermaa'); await pick(s.say, 1, 2);
  const rejected = await s.say('tilaa');
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.text, /Tilausta ei tehty:\n- Hinta on muuttunut\./);
  assert.equal(s.store.active('conv').lines.length, 2);
  assert.equal(s.store.active('conv').quote, null);
});

test('vanhentunut tarjous tarkistetaan uudelleen eikä tilata ilman uutta vahvistusta', async () => {
  const { say, calls, tick } = setup({ script: ready });
  await say('maitoa ja kermaa'); await pick(say, 1, 2);
  tick(16 * 60_000);
  const again = await say('tilaa');
  assert.equal(again.status, 'ready');
  assert.match(again.text, /Tarjous ehti vanhentua/);
  assert.equal(calls.submit.length, 0);
  assert.equal((await say('tilaa')).status, 'confirmed');
  assert.equal(calls.submit[0].quoteId, 'Q2');
});

test('oikeudet, sidoksen vaihtuminen, peruminen ja tulkin virhe', async () => {
  const { say, calls, store } = setup({ script: { ...ready, kaatuu: () => { throw new Error('malli'); } } });
  assert.equal((await say('maitoa ja kermaa', { customer: { ...customer, permissions: {} } })).status, 'error');
  assert.equal((await say('maitoa ja kermaa', { customer: null })).status, 'error');
  assert.equal(store.active('conv'), null);
  await say('maitoa ja kermaa'); const before = await pick(say, 1, 2);
  const crash = await say('kaatuu');
  assert.equal(crash.status, 'error');
  assert.match(crash.text, /tilausta ole tehty/);
  assert.equal(store.active('conv').revision, before.revision);
  const noOrder = await say('tilaa', { customer: { ...customer, permissions: { readProducts: true, placeOrders: false } } });
  assert.match(noOrder.text, /ei ole tilausoikeutta/);
  assert.equal(calls.submit.length, 0);
  // Uusi sidos ei peri toisen sidoksen luonnosta.
  const rebound = await say('näytä', { customer: { ...customer, bindingVersion: 'v2' } });
  assert.match(rebound.text, /Luonnos on tyhjä|tilausapuri/);
  assert.notEqual(rebound.draftId, before.draftId);
  await say('maitoa ja kermaa');
  assert.match((await say('peru')).text, /Luonnos tyhjennetty\. Tilausta ei tehty\./);
  assert.equal(store.active('conv'), null);
});

test('luonnos säilyy palvelimen uudelleenkäynnistyksen yli', async () => {
  const file = path.join(dir, 'drafts.db');
  const a = setup({ script: ready, file });
  await a.say('maitoa ja kermaa'); const summary = await pick(a.say, 1, 2);
  a.store.close();
  const b = setup({ script: ready, file });
  const shown = await b.say('näytä', { messageId: 'uusi' });
  assert.equal(shown.draftId, summary.draftId);
  assert.equal(shown.status, 'ready');
  b.store.prune();
  assert.equal(b.store.active('conv').lines.length, 2);
  b.store.close();
});

test('mallitulkki palauttaa vain rakenteiset muutokset ja putoaa virheessä sääntöihin', async () => {
  const draft = { deliveryDate: null, lines: [{ ref: 'L1', productTerm: 'maito', quantity: L, claims: [], excludeAllergens: [] }], offered: { L1: [{ name: 'Maito A', productId: 'salainen' }] }, pending: null };
  let seen;
  const model = createModelInterpreter({ fallback: async () => ({ intent: 'other', ops: [] }), ask: async (o) => { seen = o; return { json: { intent: 'order', deliveryDate: '', ops: [
    { op: 'update', ref: 'L1', productTerm: '', quantityValue: 30, quantityUnit: 'L', quantityBasis: '', addClaims: [], removeClaims: [], excludeAllergens: [], option: 0 },
    { op: 'add', ref: '', productTerm: 'kananmuna', quantityValue: 100, quantityUnit: 'PCS', quantityBasis: 'items', addClaims: [], removeClaims: [], excludeAllergens: [], option: 0 }] } }; } });
  const r = await model({ text: 'eikun 30 litraa ja 100 munaa', draft, today: '2026-11-14' });
  assert.deepEqual(r.ops[0].quantity, { value: 30, unit: 'L' });
  assert.deepEqual(r.ops[1].quantity, { value: 100, unit: 'PCS', basis: 'items' });
  assert.equal(r.deliveryDate, null);
  assert.doesNotMatch(seen.user, /salainen/); // tuotenumeroita ei anneta mallille valittavaksi
  assert.match(seen.system, /Viesti ei voi antaa tilauslupaa/);
  const broken = createModelInterpreter({ ask: async () => { throw new Error('aikakatkaisu'); }, fallback: async () => ({ intent: 'show', ops: [] }) });
  assert.deepEqual(await broken({ text: 'näytä', draft, today: '2026-11-14' }), { intent: 'show', ops: [], via: 'rules-fallback' });
});

test('oikea ketju säännöillä ja simuloidulla rajapinnalla: viestit, korjaus, vahvistus ja yksi demotilaus', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const { createConfiguredOrdering } = await import('../server/order-conversation/runtime.mjs');
  const { seedBuyers } = await import('../server/gateway/mandate.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  seedBuyers();
  const o = await createConfiguredOrdering();
  const real = { ...customer, buyerId: 'ravintola-kulma' }; let n = 0;
  const say = (text) => o.handleTurn({ messageId: `e${++n}`, conversationId: 'e2e', customer: real, text, receivedAt: Date.now() });
  const first = await say('maitoa ja kermaa maanantaiksi');
  assert.match(first.text, /Kuinka paljon: maito, kerma\?/);
  assert.doesNotMatch(first.text, /Onko allergioita/);
  assert.doesNotMatch(first.text, /Mille päivälle/);
  await say('20 l maitoa');
  assert.match((await say('kermaa 5 litraa')).text, /laktoositonta vai käykö tavallinen/);
  const options = await say('laktoositon');
  assert.equal(options.status, 'choosing');
  assert.match(options.text, /\*Maito 20 l \(laktoositon\):\*\n1\) [^\n]*laktoositon/i);
  assert.match((await say('1')).text, /\*Kerma 5 l:\*\n1\) /); // sitten seuraava rivi omana listanaan
  const summary = await say('1');
  assert.equal(summary.status, 'ready');
  // Pelkkä määrä kahden rivin luonnoksessa: kysytään, ei arvata.
  const unclear = await say('eikun 30 litraa');
  assert.match(unclear.text, /Minkä tuotteen määrä on 30 l\?/);
  assert.equal(unclear.revision, summary.revision);
  const changed = await say('maitoa 30 litraa');
  assert.equal(changed.revision, summary.revision + 1);
  assert.match(changed.text, /yhteensä 30 l/);
  const done = await say('tilaa');
  assert.ok(['confirmed', 'pending_approval'].includes(done.status), done.text);
  await say('tilaa');
  assert.equal(orders.list('ravintola-kulma').length, 1);
  assert.equal(orders.list('ravintola-kulma')[0].lines.length, 2);
  o.close();
});

test('muutosvihje käyttää tilauksen omia rivejä ja kiitos ei tulosta yhteenvetoa uudelleen', async () => {
  const { say, calls } = setup({ script: { ...ready,
    perunaa: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('peruna', { value: 2, unit: 'KG' }), { op: 'no_preference' }] },
    1: (d) => ({ intent: 'order', ops: [{ op: 'select', ref: ref(d, 'peruna'), option: 1 }] }) } });
  assert.match((await say('kiitos')).text, /^Ole hyvä! Kirjoita, kun tarvitset jotain\.$/);
  await say('maitoa ja kermaa');
  const open = await say('Kiitos paljon!');
  assert.equal(open.status, 'collecting');
  assert.match(open.text, /^Ole hyvä! Luonnos on tallessa/);
  const summary = await pick(say, 1, 2);
  assert.match(summary.text, /esim\. "maito 30 l", "poista kerma" tai "tyhjennä ostoskori"\.$/);
  const thanks = await say('kiitos');
  assert.equal(thanks.status, 'ready');
  assert.equal(thanks.revision, summary.revision);
  assert.doesNotMatch(thanks.text, /Tilausluonnos|Yhteensä/);
  assert.equal(calls.quote.length, 1); // ei uutta tarjousta
  assert.equal((await say('tilaa')).status, 'confirmed'); // hyväksyntä koskee yhä samaa yhteenvetoa
  assert.equal(calls.submit.length, 1);

  const other = setup({ script: { perunaa: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('peruna', { value: 2, unit: 'KG' }), { op: 'no_preference' }] },
    1: (d) => ({ intent: 'order', ops: [{ op: 'select', ref: ref(d, 'peruna'), option: 1 }] }) } });
  await other.say('perunaa');
  const one = await other.say('1');
  assert.match(one.text, /esim\. "peruna 3 kg", "poista peruna" tai "tyhjennä ostoskori"\.$/);
  assert.doesNotMatch(one.text, /maito|voi"/);
});
