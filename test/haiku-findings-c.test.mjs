// Haiku-laatumittauksen (docs/parallel/haiku-quality-2026-11-16.md) keskusteluviat C1–C7: oikeiden itsepelien
// (X066, X079, S018, S050, S070, S090, V025, R04) vuorot testityökaluilla, ilman mallia, katalogia tai verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { guardModelText } = await import('../server/whatsapp/model-guard.mjs');
const { groundedAcknowledgement } = await import('../server/whatsapp/cart-presentation.mjs');

const at = (hhmm, day = '2026-11-15') => Date.parse(`${day}T${hhmm}:00+02:00`);
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const add = (productTerm, quantity, date, claims = []) => ({ intent: 'order', ...(date ? { deliveryDate: date } : {}), ops: [{ op: 'add', productTerm, quantity, claims, excludeAllergens: [] }] });
const option = (term, i, extra = {}) => ({ productId: `${term}-${i}`, name: `${term} ${i}`, salesUnits: 5, salesUnitLabel: 'kpl', lineNet: 10 * i, labels: [], ...extra });

// options(line, draft) palauttaa rivin vaihtoehdot; null = ei tilattavaa tälle päivälle.
function engine({ script = {}, options, clock = at('09:00'), next = {} } = {}) {
  const calls = { suggest: [], submit: 0 };
  const tools = {
    async suggest({ draft, exclude }) {
      calls.suggest.push({ date: draft.deliveryDate, ref: draft.lines[0]?.ref, exclude });
      const l = draft.lines[0];
      let list = options(l, draft);
      if (!list) return { issues: [{ code: 'NO_ORDERABLE_PRODUCT', ref: l.ref, message: `Ei tilattavaa tuotetta päivälle: ${l.productTerm}.`, nextDeliveryDate: next[draft.deliveryDate] || null }], lines: [{ ref: l.ref, options: [] }] };
      const shown = exclude?.[l.ref] || [];
      list = list.filter((o) => !shown.includes(o.productId));
      if (!list.length) return { issues: [{ code: 'NO_MORE_OPTIONS', ref: l.ref, message: `Muita vaihtoehtoja ei löytynyt: ${l.productTerm}.` }], lines: [{ ref: l.ref, options: [] }] };
      return { issues: [], lines: [{ ref: l.ref, total: list.length, more: list.length > 3, clarify: [], exact: true, options: list.slice(0, 3).map((o) => ({ ...o, covers: l.quantity })) }] };
    },
    async quote({ draft }) {
      return { quoteId: `Q${draft.revision}`, draftId: draft.id, revision: draft.revision, expiresAt: new Date(clock + 900_000).toISOString(), issues: [], totals: { net: 10 },
        lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 5, salesUnitLabel: 'kpl', covers: l.quantity, lineNet: 10 })) };
    },
    async submit() { calls.submit += 1; return { status: 'confirmed', orderId: 'AGW-1', reasons: [] }; },
  };
  const store = openDraftStore(':memory:', () => clock);
  let n = 0;
  const handleTurn = createOrderingConversation({ store, tools, now: () => clock,
    interpretTurn: async ({ text, draft }) => { const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] }; } });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: clock });
  return { say, store, calls };
}

test('C1: lisävaihtoehtojen numero kuuluu vastausohjeeseen', async () => {
  const { say } = engine({ script: { kerma: add('ruokakerma', { value: 5, unit: 'L' }, '2026-11-18') },
    options: (l) => [1, 2, 3, 4, 5].map((i) => option(l.productTerm, i)) });
  const first = await say('kerma');
  assert.doesNotMatch(first.text, /Näytä lisää/);
  assert.match(first.text, /\n3\) [^\n]+\nVastaa 1, 2 tai 3\.\nJos haluat muita vaihtoehtoja, vastaa 4\.$/);
  const more = await say('4'); // viimeinen sivu: kaksi vaihtoehtoa, ei lisäriviä
  assert.match(more.text, /Vastaa 1 tai 2\.$/);
  assert.doesNotMatch(more.text, /Näytä lisää/);
});

test('C2: sanallinen kielto päivänsiirtoon pitää päivän eikä toista kysymystä, ja tilausaikaan vastataan aikaisimman päivän tiedoista', async () => {
  // X066: su klo 19.30, maanantain tilausaika mennyt, tiistaille ehtii ma klo 12 asti.
  const script = { '5 kg voita maanantaiks': add('voi', { value: 5, unit: 'KG' }, '2026-11-16'),
    'Ei käy ti, tarvin ehdottomasti maanantaiks': { intent: 'order', deliveryDate: '2026-11-16', ops: [] },
    'ei, maanantaina pitää olla': { intent: 'order', ops: [] },
    'mikä on viimeinen tilausaika?': { intent: 'other', ops: [] } };
  for (const answer of ['Ei käy ti, tarvin ehdottomasti maanantaiks', 'ei, maanantaina pitää olla']) {
    const { say, store } = engine({ script, clock: at('19:30'),
      options: (l, d) => (d.deliveryDate === '2026-11-16' ? null : [1, 2].map((i) => option(l.productTerm, i, { cutoff: '2026-11-16T12:00:00+02:00' }))) });
    const offer = await say('5 kg voita maanantaiks');
    assert.match(offer.text, /Vaihdetaanko koko tilauksen toimitus päivälle ti 17\.11\.\?/);
    const kept = await say(answer);
    assert.doesNotMatch(kept.text, /Vaihdetaanko/, answer);
    assert.match(kept.text, /Aikaisin toimitettava päivä on ti 17\.11\./, answer);
    assert.equal(store.active('c').deliveryDate, '2026-11-16');
    assert.deepEqual(store.active('c').keptDates, ['2026-11-16']);
    const deadline = await say('mikä on viimeinen tilausaika?');
    assert.match(deadline.text, /^Huomiselle \(ma 16\.11\.\) ei enää ehdi tilata\. Aikaisin toimitettava päivä on ti 17\.11\., ja sille ehtii tilata ma 16\.11\. klo 12\.00 asti\./);
    assert.doesNotMatch(deadline.text, /en saanut tilausaikarajaa|Vaihdetaanko/);
    // Haiku-otos X064: ei kahta pistettä päivämäärän perässä eikä aikaisinta päivää kahdesti samassa viestissä.
    for (const reply of [kept, deadline]) assert.doesNotMatch(reply.text, /\d\.\./, reply.text);
    assert.equal(deadline.text.split('Aikaisin toimitettava päivä on ti 17.11.').length - 1, 1, deadline.text);
    assert.match(deadline.text, /Kirjoita "ti 17\.11\.", jos se käy\. Tilausta ei ole tehty\.$/);
  }
});

test('C4: "vaihda tavalliseen" avaa laktoosittoman valinnan ja näyttää vain tavalliset; muuten muutoksesta ei puhuta', async () => {
  const jogurtti = (l) => [option(l.productTerm, 1, { name: 'Valio luonnonjogurtti 1 kg laktoositon', labels: ['FREE_FROM_LACTOSE'] }),
    option(l.productTerm, 2, { name: 'Valio maustamaton jogurtti 1 kg' }), option(l.productTerm, 3, { name: 'Arla jogurtti 1 kg' })];
  const { say, store } = engine({ script: { jogurtti: add('jogurtti', { value: 5, unit: 'KG' }, '2026-11-19') }, options: jogurtti });
  await say('jogurtti');
  assert.equal((await say('1')).status, 'ready');
  const msg = 'Hei, en tarvitse laktoositonta, tavallinen käy kyllä. Mutta tuo luonnoksessa oli laktoositon Valio, eli vaihda tavalliseen jogurttiin 5 kg';
  const switched = await say(msg);
  assert.equal(switched.status, 'choosing');
  assert.doesNotMatch(switched.text, /laktoositon/i); // laktoositon vaihtoehto ei ole listalla eikä kysymystä toisteta
  assert.match(switched.text, /1\) Valio maustamaton jogurtti 1 kg/);
  assert.equal(store.active('c').lines[0].selectedProductId, null);
  assert.equal((await say('1')).status, 'ready');
  assert.equal(store.active('c').lines[0].selectedName, 'Valio maustamaton jogurtti 1 kg');
  // Jos tavallista ei ole, se sanotaan ja kaikki vaihtoehdot näytetään.
  const only = engine({ script: { jogurtti: add('jogurtti', { value: 5, unit: 'KG' }, '2026-11-19') },
    options: (l) => [option(l.productTerm, 1, { name: 'Valio jogurtti laktoositon', labels: ['FREE_FROM_LACTOSE'] })] });
  await only.say('jogurtti'); await only.say('1');
  const none = await only.say('vaihda tavalliseen');
  assert.match(none.text, /Tavallista \(ei laktoositonta\) vaihtoehtoa ei löytynyt: jogurtti\./);
});

test('C5: "valitse ensimmäinen sopiva" valitsee näytetyn listan ykkösen ja koskee myöhemmin näytettävää riviä', async () => {
  const opts = (l) => [1, 2, 3].map((i) => option(l.productTerm, i));
  const both = { intent: 'order', deliveryDate: '2026-11-20', ops: [
    { op: 'add', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [] },
    { op: 'add', productTerm: 'jauheliha', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [] }] };
  // S018: maidon numero ja jauhelihalle valtuutus samassa viestissä.
  const s018 = 'Valitse 1, Valio maito. Jauhelihaan 5 kg, ensimmäinen sopiva vaihtoehto.';
  const { say, store } = engine({ script: { tilaus: both, [s018]: (d) => ({ intent: 'order', ops: [{ op: 'select', ref: d.lines[0].ref, option: 1 }] }) }, options: opts });
  assert.match((await say('tilaus')).text, /\*Maito 20 l:\*/);
  const ready = await say(s018);
  assert.equal(ready.status, 'ready');
  assert.match(ready.text, /Valitsin ensimmäisen sopivan vaihtoehdon: Jauheliha 5 kg: jauheliha 1/);
  assert.deepEqual(store.active('c').lines.map((l) => l.selectedName), ['maito 1', 'jauheliha 1']);
  // Pelkkä valtuutus näytettyyn listaan valitsee sen ykkösen.
  const one = engine({ script: { tilaus: both }, options: opts });
  await one.say('tilaus');
  const picked = await one.say('valitse sä ensimmäinen sopiva');
  assert.equal(one.store.active('c').lines[0].selectedName, 'maito 1');
  assert.match(picked.text, /\*Jauheliha 5 kg:\*/); // seuraavaa riviä ei valita ilman lupaa
});

function dialogue(t, { plan = {}, history = [] } = {}) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const asked = []; const ordered = [];
  const d = createOrderingDialogue({ db: store.db, now: () => at('19:30'), ask: async ({ user }) => {
    asked.push(JSON.parse(user)); return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...plan } };
  } });
  let n = 0;
  const say = (text, reply = { status: 'collecting', draftId: 'd1', revision: 1, text: 'Luonnoksessa nyt:\n- jogurtti 5 kg\n\nMille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.' }, list = null) =>
    d.respond({ binding: 'one', messageId: `d${++n}`, text, receivedAt: at('19:30'), getShoppingList: () => list,
      runOrder: async (input) => { ordered.push(input); return typeof reply === 'function' ? reply(input) : reply; } });
  return { say, asked, ordered };
}

test('C3: epämääräinen avaus kysyy päivän ja tuotteet ilman mallia', async (t) => {
  const empty = { status: 'collecting', draftId: 'd0', revision: 0, text: 'Luonnos on tyhjä. Mille päivälle toimitus, ja mitä tarvitset? Esim. "20 l laktoositonta maitoa ja 5 kg voita maanantaiksi".' };
  for (const opener of ['tarvis vähän kaikkee keittiöön', 'hei, voisitteko auttaa tilauksen kanssa', 'no niin, taas loppu tavarat']) {
    const f = dialogue(t, { plan: { route: 'chat', text: 'Joo, katsotaan! Kerro vaan, mitä tarvitset.' } });
    const r = await f.say(opener, empty);
    assert.match(r.text, /Mille päivälle toimitus, ja mitä tarvitset\?/, opener);
    assert.doesNotMatch(r.text, /Luonnos on tyhjä|Kerro vaan/, opener);
    assert.equal(f.asked.length, 0, opener); // ei mallikutsua
    assert.deepEqual(f.ordered, ['näytä'], opener); // tilausmoottori kertoo luonnoksen tilan (myös jo annetun päivän)
  }
  // Tuote viestissä: tavallinen polku.
  const f = dialogue(t, { plan: { route: 'order', text: '' } });
  await f.say('tarvis maitoa 20 l');
  assert.equal(f.asked.length, 1);
});

test('C6: tervehdys vain keskustelun alussa tai pelkkään tervehdykseen, ei kesken keskustelun', async (t) => {
  const f = dialogue(t);
  const first = await f.say('Hei! tarvitsisimme 5 kiloa jogurttia');
  assert.match(first.text, /^Iltaa! /);
  const middle = await f.say('Hei, en tarvitse laktoositonta, tavallinen käy kyllä');
  assert.doesNotMatch(middle.text, /^(?:Iltaa|Huomenta|Päivää|Moi)!/);
  const hello = await f.say('moi');
  assert.match(hello.text, /^Iltaa!/); // pelkkä tervehdys saa vastauksen
});

test('C7: mallin lupaus palata asiaan myöhemmin pudotetaan', () => {
  const v025 = 'Kirjasin 20 l maitoa keskiviikoksi 18.11. Edullisimman vaihtoehdon katson, kun tuotteet on tarkistettu, joten palaan siihen sitten.';
  assert.deepEqual(guardModelText(v025), { text: 'Kirjasin 20 l maitoa keskiviikoksi 18.11.', blocked: ['claim'] });
  for (const text of ['Palaan asiaan myöhemmin.', 'Otan sinuun yhteyttä huomenna.', 'Ilmoitan sinulle heti kun tiedän.', 'Kerron myöhemmin tarkemmin.']) {
    assert.equal(guardModelText(text).text, '', text);
  }
  for (const text of ['Kerro määrä, niin lisään sen.', 'Palautetta voi antaa asiakaspalveluun.', 'Kerron tilausajan, kun tuotteet on valittu.']) {
    assert.equal(guardModelText(text).text, text, text);
  }
  assert.equal(groundedAcknowledgement(v025, { facts: { lines: [{ term: 'maito', quantity: '20 l' }], date: '18.11.' }, userText: '20 l maitoa keskiviikoks' }), '');
});

test('V023: toimitusvarmuuskysymys tunnistetaan molemmissa sanajärjestyksissä, ja koodi vastaa vaihtoehtojen tiedoista', async () => {
  const { compareKind } = await import('../server/order-conversation/index.mjs');
  for (const q of ['Mikä näistä toimitetaan varmimmin?', 'mikä näistä toimitetaan varmimmin', 'mikä näistä varmimmin toimitetaan?', 'mikä tulee varmimmin perille?',
    'mikä tulee perille varmimmin?', 'kumpi toimitetaan luotettavimmin?', 'mikä on toimitusvarmin?']) assert.equal(compareKind(q), 'reliability', q);
  for (const q of ['toimitus varmasti maanantaina', 'onko varmasti laktoositon?', '5 kg voita perjantaiksi']) assert.equal(compareKind(q), null, q);
  const { say } = engine({ script: { maito: add('maito', { value: 20, unit: 'L' }, '2026-11-18', ['FREE_FROM_LACTOSE']) },
    options: (l) => [1, 2, 3].map((i) => option(l.productTerm, i, { deliveryReliability: [0.9, 0.99, 0.95][i - 1] })) });
  await say('maito');
  const reply = await say('Mikä näistä toimitetaan varmimmin?');
  assert.equal(reply.status, 'choosing');
  assert.match(reply.text, /^Toimitusvarmuus: 1\) 90 %, 2\) 99 %, 3\) 95 %\. Paras: 2\) maito 2\./);
});

test('X064: aikaisimman päivän hyväksyntä merkitsee tilauksen kiireelliseksi, joten vaihtoehtojen alla näkyy uuden päivän tilausaikaraja', async () => {
  const script = { '20 l maitoa maanantaiks': add('maito', { value: 20, unit: 'L' }, '2026-11-16', ['FREE_FROM_LACTOSE']),
    'Joo ok, tilaa sitten ti 17.11.': { intent: 'order', deliveryDate: '2026-11-17', ops: [] } };
  for (const answer of ['1', 'Joo ok, tilaa sitten ti 17.11.']) {
    const { say, store } = engine({ script, clock: at('14:00'),
      options: (l, d) => (d.deliveryDate === '2026-11-16' ? null : [1, 2].map((i) => option(l.productTerm, i, { cutoff: '2026-11-16T12:00:00+02:00' }))) });
    assert.match((await say('20 l maitoa maanantaiks')).text, /Vaihdetaanko koko tilauksen toimitus päivälle ti 17\.11\.\?/);
    const options = await say(answer);
    assert.equal(options.status, 'choosing', answer);
    assert.equal(store.active('c').deliveryDate, '2026-11-17', answer);
    assert.match(options.text, /Päivälle ti 17\.11\. ehtii tilata ma 16\.11\. klo 12\.00 asti\./, answer);
  }
});

test('X041: epäselvä ensiviesti määrillä saa päiväkysymyksen mallin tarkennuksen perään', async (t) => {
  const clarify = 'Joo, katsotaan! Tarkoitatko 20 maitoa ja 5 voita? Kerro vielä, montako litraa tai pakkausta maitoa tarvitset.';
  const f = dialogue(t, { plan: { route: 'chat', text: clarify } });
  const first = await f.say('🥛🥛🥛 20? 🧈 5 🙏');
  assert.match(first.text, /Kerro vielä, montako litraa/);
  assert.match(first.text, /\n\nMille päivälle toimitus\?$/);
  assert.deepEqual(f.ordered, []); // tilausmoottoria ei kutsuta tarkennukseen
  // Ei toisteta myöhemmin keskustelussa eikä silloin, kun malli jo kysyi päivää.
  const later = await f.say('20? 5');
  assert.doesNotMatch(later.text, /Mille päivälle toimitus\?$/);
  const asked = dialogue(t, { plan: { route: 'chat', text: 'Tarkoitatko 20 l maitoa? Ja mille päivälle toimitus?' } });
  const once = await asked.say('🥛 20');
  assert.equal((once.text.match(/mille päivälle/giu) || []).length, 1, once.text);
  // Pelkkä kysymys ilman määriä ei saa päiväkysymystä.
  const chat = dialogue(t, { plan: { route: 'chat', text: 'Olen Valio Aimon tilausapuri.' } });
  assert.doesNotMatch((await chat.say('kuka sä oot?')).text, /Mille päivälle/);
});
