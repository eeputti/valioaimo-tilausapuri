// Eeliksen vaatimus 15.11.2026 klo 01.25: tervehdys seuraa Helsingin kellonaikaa ja asiakkaan tyyliä, ja kiireinen
// tilaus kertoo työkalujen tilausaikarajan ja aikaisimman toimituspäivän lupaamatta muuta. Ei mallia, katalogia tai verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { greetingFor, withGreeting, createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { createOrderingConversation, withoutClockWords } = await import('../server/order-conversation/index.mjs');
const fs = await import('node:fs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');

// Marraskuussa Helsinki on UTC+2.
const at = (hhmm, day = '2026-11-15') => Date.parse(`${day}T${hhmm}:00+02:00`);

test('tervehdys seuraa Helsingin kellonaikaa, peilaa arkisen tervehdyksen eikä sano väärää vuorokaudenaikaa', () => {
  assert.equal(greetingFor('huomenta', at('06:30')), 'Huomenta!');
  assert.equal(greetingFor('huomenta', at('15:00')), 'Päivää!'); // asiakkaan väärä vuorokaudenaika ei toistu
  assert.equal(greetingFor('hyvää iltaa', at('20:00')), 'Iltaa!');
  assert.equal(greetingFor('iltaa', at('08:00')), 'Huomenta!');
  assert.equal(greetingFor('päivää', at('02:00')), 'Moi!'); // yöllä neutraali
  for (const [hhmm, word] of [['04:59', 'Moi!'], ['05:00', 'Huomenta!'], ['09:59', 'Huomenta!'], ['10:00', 'Päivää!'], ['16:59', 'Päivää!'], ['17:00', 'Iltaa!'], ['21:59', 'Iltaa!'], ['22:00', 'Moi!']]) {
    assert.equal(greetingFor('hyvää päivää', at(hhmm)), word, hhmm);
  }
  assert.equal(greetingFor('Morjes, tarviis maitoa', at('23:30')), 'Morjes!');
  assert.equal(greetingFor('moro', at('12:00')), 'No moikka!'); // rento moro saa iloisen vastauksen (Eelis 17.11.)
  // Neutraali moi/hei ei ole tyyli vaan tervehdys: kellonajan mukainen vastaus (pilotin X093–X100).
  assert.equal(greetingFor('Moi!', at('07:30')), 'Huomenta!');
  assert.equal(greetingFor('moi', at('14:00')), 'Päivää!');
  assert.equal(greetingFor('hei, tarviis tilata', at('19:30')), 'Iltaa!');
  assert.equal(greetingFor('moi', at('02:30')), 'Moi!');
  assert.equal(greetingFor('moikka', at('12:00')), 'No moikka!');
  assert.equal(greetingFor('terve', at('08:00')), 'Terve!');
  // Palvelimen aikavyöhyke ei vaikuta: sama hetki UTC-merkinnällä.
  assert.equal(greetingFor('hyvää päivää', Date.parse('2026-11-15T03:30:00Z')), 'Huomenta!');
  assert.equal(withGreeting('Iltaa!', 'Hyvää huomenta! mitä tarvitset?'), 'Iltaa! Mitä tarvitset?');
  assert.equal(withGreeting(null, 'Huomenta! Kauramaito sopii kahviin.'), 'Kauramaito sopii kahviin.');
  assert.equal(withGreeting(null, 'Heinäkuussa tilaus toimii samoin.'), 'Heinäkuussa tilaus toimii samoin.');
});

test('apuri tervehtii vain asiakkaan tervehdykseen, viestin vastaanottohetken mukaan, eikä mallin väärä tervehdys jää', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const plans = { huomenta: { route: 'chat', text: 'Huomenta! Mitä keittiöön tarvitaan?' }, 'mikä kerma sopii kastikkeeseen?': { route: 'chat', text: 'Hyvää huomenta! Ruokakerma sopii kastikkeisiin.' } };
  const asked = [];
  const dialogue = createOrderingDialogue({ db: store.db, now: () => at('03:00'), ask: async ({ user }) => {
    const input = JSON.parse(user); asked.push(input);
    return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...(plans[input.message] || {}) } };
  } });
  const ready = { status: 'collecting', draftId: 'd1', revision: 1, text: 'Luonnoksessa nyt:\n- kananmunat 50 kpl\n\nMille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.' };
  let n = 0;
  const say = (text, receivedAt, extra = {}) => dialogue.respond({ binding: 'one', messageId: `g${++n}`, text, receivedAt, runOrder: async () => ready, ...extra });
  const evening = await say('huomenta', at('20:15'));
  // klo 20.15 vastaanotettu, ei mallin "Huomenta". Ensimmäinen tervehdys esittäytyy (persona.mjs).
  assert.equal(evening.text, 'Iltaa! Olen Valio Aimon digitaalinen tilausapuri. Mitä keittiöön tarvitaan?');
  assert.equal(asked[0].greeting, 'Iltaa!');
  assert.match(asked[0].task, /Koodi aloittaa vastauksen tervehdyksellä "Iltaa!"/);
  const order = await say('50 kananmunaa', at('20:16'));
  assert.match(order.messages[0], /^Luonnoksessa nyt:|^Joo/); // ei tervehdystä joka viestiin
  const question = await say('mikä kerma sopii kastikkeeseen?', at('20:17'));
  assert.equal(question.text, 'Ruokakerma sopii kastikkeisiin.'); // mallin väärä vuorokaudenaika poistetaan
  const morning = await say('Morjes!', at('07:40'));
  assert.match(morning.text, /^Morjes! /);
  // Ilman vastaanottohetkeä käytetään dialogin kelloa (demokello): klo 03.00 neutraali.
  assert.match((await say('hyvää päivää', undefined)).text, /^Moi! /);
  // Selainkorissa ei tervehditä.
  assert.doesNotMatch((await say('moi', at('12:00'), { inCart: true })).text, /^Moi!/);
});

// Kiire: käsikirjoitettu tulkki ja työkalut, joiden saatavuus riippuu päivästä.
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
function rush(script, { orderable = (date) => date >= '2026-11-16', cutoff = (date) => `${addDays(date, -1)}T12:00:00` } = {}) {
  const t = at('10:00'); const calls = { suggest: [] }; let n = 0;
  const tools = {
    suggest: async ({ draft }) => {
      calls.suggest.push(draft.deliveryDate);
      const l = draft.lines[0];
      if (!orderable(draft.deliveryDate)) return { lines: [], issues: [{ code: 'NO_ORDERABLE_PRODUCT', message: `Ei tilattavaa tuotetta päivälle ${draft.deliveryDate}: ${l.productTerm}.`, ref: l.ref }] };
      return { issues: [], lines: [{ ref: l.ref, total: 2, more: false, clarify: [], exact: true, options: [1, 2].map((i) => ({ productId: `${l.productTerm}-${i}`, name: `${l.productTerm} ${i}`,
        salesUnits: 5, salesUnitLabel: 'ras', covers: l.quantity, lineNet: 10 * i, deliveryDate: draft.deliveryDate, cutoff: cutoff(draft.deliveryDate), labels: [] })) }] };
    },
    quote: async ({ draft }) => ({ quoteId: 'Q1', draftId: draft.id, revision: draft.revision, expiresAt: new Date(t + 900_000).toISOString(), issues: [], totals: { net: 10 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 5, salesUnitLabel: 'ras', covers: l.quantity, lineNet: 10, cutoffLabel: 'su 15.11. klo 12.00' })) }),
    submit: async () => ({ status: 'confirmed', orderId: 'AGW-1', reasons: [] }),
  };
  const store = openDraftStore(':memory:', () => t);
  const handleTurn = createOrderingConversation({ store, tools, now: () => t, interpretTurn: async ({ text }) => script[text] || { intent: 'other', ops: [] } });
  const say = (text) => handleTurn({ messageId: `r${++n}`, conversationId: 'c', customer, text, receivedAt: t });
  return { say, calls, store };
}
function addDays(iso, k) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
const eggs = (date) => ({ intent: 'order', ...(date ? { deliveryDate: date } : {}), ops: [{ op: 'add', productTerm: 'kananmunat', quantity: { value: 50, unit: 'PCS', basis: 'items' }, claims: [], excludeAllergens: [] }] });

test('tänään ei enää ehdi: kerrotaan aikaisin toimituspäivä ja tilausaikaraja, päivän vaihto numerolla', async () => {
  // Tulkki saa viestin ilman kellonaikaa (avain), kiire ja toive luetaan alkuperäisestä viestistä.
  const { say, calls, store } = rush({ 'tänään 50 kananmunaa': eggs('2026-11-15') });
  const offer = await say('tänään 50 kananmunaa ennen klo 7');
  assert.equal(offer.status, 'collecting');
  assert.equal(offer.text, ['Tänään ei enää ehdi: kananmunat. Aikaisin toimitettava päivä on ma 16.11.', 'Vaihdetaanko koko tilauksen toimitus päivälle ma 16.11.?',
    '1) kyllä, ma 16.11.', '2) ei, pidetään su 15.11.'].join('\n'));
  assert.deepEqual(calls.suggest, ['2026-11-15', '2026-11-16']); // aikaisin päivä haettiin työkaluista
  assert.equal(store.active('c').deliveryDate, '2026-11-15'); // päivää ei vaihdeta ilman lupaa
  const options = await say('1');
  assert.equal(store.active('c').deliveryDate, '2026-11-16');
  assert.match(options.text, /\*Kananmunat 50 kpl:\*\n1\) kananmunat 1, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 10,00 €/);
  assert.match(options.text, /Huomiselle ehtii tilata su 15\.11\. klo 12\.00 asti\./);
  assert.match(options.text, /Toivoit toimitusta "ennen klo 7": kellonaikaa en näe tilausjärjestelmästä, joten en voi luvata sitä\. Toimituspäivä on ma 16\.11\.(?!\.)/);
  const summary = await say('1');
  assert.equal(summary.status, 'ready');
  assert.match(summary.text, /Tilaus pitää tehdä viimeistään su 15\.11\. klo 12\.00\.\nToivoit toimitusta "ennen klo 7"/);
});

test('päivän vaihdosta kieltäytyminen pitää päivän eikä tarjoa samaa uudelleen; kaukainen päivä ei käynnistä hakua seuraaville päiville', async () => {
  const { say, calls, store } = rush({ 'tänään 50 kananmunaa': eggs('2026-11-15'), näytä: { intent: 'show', ops: [] } });
  await say('tänään 50 kananmunaa');
  const kept = await say('2');
  assert.equal(store.active('c').deliveryDate, '2026-11-15');
  assert.match(kept.text, /Ei tilattavaa tuotetta päivälle 2026-11-15: kananmunat\./);
  assert.doesNotMatch(kept.text, /Vaihdetaanko/);
  assert.doesNotMatch((await say('näytä')).text, /Vaihdetaanko/);
  const far = rush({ '50 kananmunaa ensi viikon perjantaiksi': eggs('2026-11-27') }, { orderable: () => false });
  const none = await far.say('50 kananmunaa ensi viikon perjantaiksi');
  assert.match(none.text, /Kokeile toista päivää/);
  assert.deepEqual(far.calls.suggest, ['2026-11-27']);
});

test('kiire ilman päivää: päivä kysytään silti ensin, kiireen huomioiva kysymys', async () => {
  const { say, calls } = rush({ '50 kananmunaa': eggs(null) }); // tulkki saa viestin ilman "heti"-sanaa
  const first = await say('heti 50 kananmunaa');
  assert.match(first.text, /\n\nMille päivälle toimitus\? Jos on kiire, kirjoita esim\. "huomenna", niin katson aikaisimman päivän, jolle ehtii\.$/);
  assert.equal(calls.suggest.length, 0);
});

test('huomiseksi ehtii: vaihtoehtojen yllä tilausaikaraja, ei päivän vaihtoa', async () => {
  const { say } = rush({ 'huomiseksi 50 kananmunaa': eggs('2026-11-16') });
  const r = await say('huomiseksi 50 kananmunaa');
  assert.equal(r.status, 'choosing');
  assert.match(r.text, /Huomiselle ehtii tilata su 15\.11\. klo 12\.00 asti\.\nVastaa 1 tai 2\.$/);
  assert.doesNotMatch(r.text, /Toivoit toimitusta|Vaihdetaanko/);
});

test('kellonaika- ja kiiresanat eivät päädy tulkille tuotesanaksi, päiväsanat säilyvät', async () => {
  const cases = [['tänään 50 kananmunaa ennen klo 7', 'tänään 50 kananmunaa'], ['huomenna aamulla 20 l maitoa', 'huomenna 20 l maitoa'],
    ['20 l maitoa klo 7 mennessä', '20 l maitoa'], ['huomiseks aamuks 5 kg voita', 'huomiseks 5 kg voita'], ['50 kananmunaa ennen kello 7.30 huomenna', '50 kananmunaa huomenna'],
    ['heti 20 l maitoa', '20 l maitoa'], ['kiireesti 5 kg voita huomiseksi', '5 kg voita huomiseksi'], ['nyt heti, 3 kg juustoa', '3 kg juustoa'],
    ['aamupuuro 5 kg', 'aamupuuro 5 kg'], ['kiire!', 'kiire!']];
  for (const [text, cleaned] of cases) assert.equal(withoutClockWords(text), cleaned, text);
  // Oikea sääntötulkki, kun paikallinen katalogi on olemassa: ennen korjausta "kananmuna enne", "aamu maito" ja "eesti voi".
  if (!fs.existsSync(new URL('../data/catalog.json', import.meta.url))) return;
  const { understand } = await import('../server/aimo/understand.mjs');
  for (const [text, term] of [['tänään 50 kananmunaa ennen klo 7', 'kananmuna'], ['huomenna aamulla 20 l maitoa', 'maito'], ['kiireesti 5 kg voita huomiseksi', 'voi']]) {
    assert.deepEqual(understand(withoutClockWords(text), { now: new Date(at('10:00')) }).items.map((i) => i.productTerm), [term], text);
  }
});
