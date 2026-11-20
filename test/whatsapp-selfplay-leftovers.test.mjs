// Selfplay-100:n 200 personan ajon (e3b70e1) ytimen ja dialogin jäännökset (15.11.2026): valitus ilman asiakaspalvelua (X085),
// puuttuva tuote pudotettiin sanomatta ja kamelinmaidosta kysyttiin laktoosia (S036, S056), ja ilman tuotteita ensimmäinen
// vastaus ei kysynyt päivää (X044 "60", S030 "sitä samaa ku viimeks"). Ei mallia, katalogia tai verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { createOrderingConversation, REPEAT_LAST } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');

const t0 = Date.parse('2026-11-15T10:00:00+02:00');
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const add = (productTerm, value, unit, date) => ({ intent: 'order', ...(date ? { deliveryDate: date } : {}), ops: [{ op: 'add', productTerm, quantity: { value, unit }, claims: [], excludeAllergens: [] }] });

function core(script, { inexact = [] } = {}) {
  let n = 0;
  const tools = {
    suggest: async ({ draft }) => {
      const l = draft.lines[0]; const exact = !inexact.includes(l.productTerm);
      return { issues: [], lines: [{ ref: l.ref, total: 2, more: false, exact, clarify: ['FREE_FROM_LACTOSE'],
        options: [1, 2].map((i) => ({ productId: `${l.productTerm}-${i}`, name: `${l.productTerm} ${i}`, salesUnits: 4, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 * i, labels: [], cutoff: null })) }] };
    },
    quote: async ({ draft }) => ({ quoteId: 'Q1', draftId: draft.id, revision: draft.revision, expiresAt: new Date(t0 + 900_000).toISOString(), issues: [], totals: { net: 10 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 4, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10, cutoffLabel: 'su 15.11. klo 12.00' })) }),
    submit: async () => ({ status: 'confirmed', orderId: 'AGW-7', reasons: [] }),
  };
  const store = openDraftStore(':memory:', () => t0);
  const handleTurn = createOrderingConversation({ store, tools, now: () => t0, interpretTurn: async ({ text, draft }) => {
    const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] };
  } });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: t0 });
  return { say, store };
}

test('ilman tuotteita ensimmäinen vastaus kysyy päivän, ja "sama ku viimeks" kopioi edellisen tilauksen', async () => {
  const { say, store } = core({ '20 l maitoa ke': add('maito', 20, 'L', '2026-11-18') });
  assert.match((await say('60')).text, /^Olen Valio Aimon digitaalinen tilausapuri\. Mille päivälle toimitus, ja mitä tarvitset\?/);
  assert.match((await say('sitä samaa ku viimeks')).text, /^En löydä aiempaa tilausta tästä keskustelusta\. Mille päivälle toimitus/);
  // Mallitulkki voi palauttaa show- tai order-intentin ilman muutoksia: vastaus kysyy silti päivän.
  const shown = core({ 'sitä samaa ku viimeks': { intent: 'show', ops: [] }, 'mitä listalla on?': { intent: 'show', ops: [] } });
  assert.match((await shown.say('sitä samaa ku viimeks')).text, /^En löydä aiempaa tilausta tästä keskustelusta\. Mille päivälle toimitus/);
  assert.match((await shown.say('mitä listalla on?')).text, /^Luonnos on tyhjä\. Mille päivälle toimitus/);
  // Tilataan kerran, sitten sama uudelleen: rivit ja valinta kopioituvat, päivä kysytään ensin.
  await say('20 l maitoa ke');
  await say('1'); // laktoosittomuus
  await say('1'); // tuote
  assert.equal((await say('TILAA')).status, 'confirmed');
  const again = await say('sitä samaa ku viimeks');
  assert.equal(again.status, 'collecting');
  assert.match(again.text, /^Kopioin edellisen tilauksen AGW-7 tuotteet\. Hinnat ja saatavuus tarkistetaan uudelle toimituspäivälle\.\nLuonnoksessa nyt:\n- maito 20 l \(laktoositon\): maito 1\n\nMille päivälle toimitus\?/);
  assert.equal(store.active('c').lines[0].selectedProductId, 'maito-1');
  for (const text of ['sama ku viimeks', 'samat kuin viime kerralla', 'samanlainen tilaus kuin edellinen', 'toista viime tilaus']) assert.ok(REPEAT_LAST.test(text), text);
  for (const text of ['20 l maitoa', 'sama määrä maitoa', 'samaa maitoa 20 l']) assert.ok(!REPEAT_LAST.test(text), text);
});

test('puuttuvasta tuotteesta ei kysytä laktoosia, ja poisto kerrotaan selvästi', async () => {
  const { say } = core({
    'äkkiä 5 kg kahvia ja 5 l kamelinmaitoa perjantaiksi': (d) => ({ intent: 'order', deliveryDate: '2026-11-20', ops: [
      { op: 'add', productTerm: 'kahvi', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [] },
      { op: 'add', productTerm: 'kamelinmaito', quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: [] }] }),
    'jos ei oo, poista se': (d) => ({ intent: 'order', ops: [{ op: 'remove', ref: d.lines.find((l) => l.productTerm === 'kamelinmaito').ref }] }),
  }, { inexact: ['kamelinmaito'] });
  await say('äkkiä 5 kg kahvia ja 5 l kamelinmaitoa perjantaiksi');
  await say('2'); // kahvi: tavallinen käy
  const camel = await say('1'); // kahvi valittu, seuraavaksi kamelinmaito
  assert.equal(camel.status, 'choosing');
  assert.doesNotMatch(camel.text, /laktoositonta vai/);
  assert.match(camel.text, /Kamelinmaidolle ei valitettavasti löytynyt osumaa\.\nTässä korvaajia \(tarve 5 l\):/);
  const removed = await say('jos ei oo, poista se');
  assert.match(removed.text, /^Pyydettyä tuotetta ei löytynyt tilattavana, joten poistin listalta: kamelinmaito\.\n/);
  assert.equal(removed.status, 'ready');
  assert.equal(removed.removedNote, 'Pyydettyä tuotetta ei löytynyt tilattavana, joten poistin listalta: kamelinmaito.');
});

test('tavallinen poisto kerrotaan, koko listan poisto ei', async () => {
  const { say } = core({
    '1 kg hiivaa ja 1 kg tryffeliä ma': (d) => ({ intent: 'order', deliveryDate: '2026-11-16', ops: [
      { op: 'add', productTerm: 'hiiva', quantity: { value: 1, unit: 'KG' }, claims: [], excludeAllergens: [] },
      { op: 'add', productTerm: 'tuore tryffeli', quantity: { value: 1, unit: 'KG' }, claims: [], excludeAllergens: [] }] }),
    'ei käy, poista tryffelit': (d) => ({ intent: 'order', ops: [{ op: 'remove', ref: d.lines.find((l) => l.productTerm === 'tuore tryffeli').ref }] }),
    'poista kaikki': (d) => ({ intent: 'order', ops: d.lines.map((l) => ({ op: 'remove', ref: l.ref })) }),
  });
  await say('1 kg hiivaa ja 1 kg tryffeliä ma');
  await say('2');
  await say('1');
  const r = await say('ei käy, poista tryffelit');
  assert.match(r.text, /^Poistin listalta: tuore tryffeli\.\n/);
  assert.doesNotMatch((await say('poista kaikki')).text, /Poistin listalta/);
});

function dialogueFixture(t, { plan, order, supportContact } = {}) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const ordered = [];
  const dialogue = createOrderingDialogue({ db: store.db, supportContact, now: () => t0,
    ask: async () => ({ json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...plan } }) });
  let n = 0;
  const say = (text) => dialogue.respond({ binding: 'one', messageId: `d${++n}`, text, receivedAt: t0, canOpenCart: true,
    runOrder: async (input) => { ordered.push(input); return { status: 'collecting', draftId: 'd1', revision: 2, text: 'Luonnos on tyhjä.', ...order }; } });
  return { say, ordered };
}

test('valitus vanhentuneesta tai pilaantuneesta tuotteesta saa asiakaspalvelun yhteystiedon', async (t) => {
  for (const text of ['Maito oli vanhentunutta kun se tuli, ei kiva.', 'jogurtti oli pilaantunut', 'toimitus myöhästyi taas', 'kermaa puuttui toimituksesta']) {
    const f = dialogueFixture(t, { plan: { route: 'chat', text: 'Voi harmi, pahoittelut!' }, supportContact: 'Testin ylläpito' });
    const r = await f.say(text);
    assert.equal(r.messages.at(-1), 'Asiakaspalvelu: Testin ylläpito', text);
  }
  const f = dialogueFixture(t, { plan: { route: 'order' }, supportContact: 'Testin ylläpito' });
  assert.doesNotMatch((await f.say('20 l maitoa, puuttuuko vielä jotain?')).text, /Asiakaspalvelu:/);
});

test('dialogi ohjaa "sama ku viimeks" tilausmoottorille ja pitää poiston linkin edellä', async (t) => {
  const repeat = dialogueFixture(t, { plan: { route: 'chat', text: 'Tässä keskustelussa ei näy edellistä tilaustasi.' } });
  const r = await repeat.say('sitä samaa ku viimeks');
  assert.deepEqual(repeat.ordered, ['sitä samaa ku viimeks']);
  assert.doesNotMatch(r.text, /ei näy edellistä/);
  const link = dialogueFixture(t, { plan: { route: 'order', text: 'Totta, toi on suklaapatukka.', openCart: true },
    order: { status: 'ready', text: 'Poistin listalta: tuore tryffeli.\n*Tilausluonnos*', removedNote: 'Poistin listalta: tuore tryffeli.' } });
  const out = await link.say('ei toi oo tryffeli, poista se. ok, laita kori');
  assert.equal(out.cartRequested, true);
  assert.equal(out.conversationAnswer, 'Totta, toi on suklaapatukka.\nPoistin listalta: tuore tryffeli.');
});
