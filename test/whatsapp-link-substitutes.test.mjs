// Reseptilinkki: bottisuojan takana oleva sivu, liitetty resepti, saatavuus toimituspäivälle ja korvaajat (Eelis 16.11.).
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createPageReader, pageNameFromUrl, requestPage } from '../server/whatsapp/link-reader.mjs';
import { createLinkAdvice, hasLinkAdviceReply } from '../server/whatsapp/link-advice.mjs';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { bootstrapDemoMember, createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';

const PHONE = '358401234567';
const LINK = 'https://www.k-ruoka.fi/reseptit/kermainen-kanapasta';
const MESSAGE = `tartteisin juustoo sata kiloo ja sitte vaiks ${LINK} ton reseptin ainekset x 100`;
const PASTED = 'Kermainen kanapasta, 4 annosta. 400 g broilerin fileesuikaleita, 2 dl valkosipulikermaa, 1 sitruuna, 250 g tagliatellea.';
const analysis = { summary: 'Kanapastan resepti.', servings: 4, servingsEvidence: '4 annosta', ingredients: [
  { term: 'broilerin fileesuikale', source: '400 g broilerin fileesuikaleita', amount: '400 g' },
  { term: 'valkosipulikerma', source: '2 dl valkosipulikermaa', amount: '2 dl' },
  { term: 'sitruuna', source: '1 sitruuna', amount: '1 kpl' },
  { term: 'tagliatelle', source: '250 g tagliatellea', amount: '250 g' },
] };
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'x', permissions: { readProducts: true, placeOrders: true } };
const blocked = () => { throw Object.assign(new Error('LINK_BLOCKED'), { code: 'LINK_BLOCKED' }); };

// Saatavuus: valkosipulikerma ei ole valikoimassa, sitruunaa ei saa perjantaiksi, limettiäkään ei.
const AVAILABILITY = { valkosipulikerma: { notInCatalog: true }, sitruuna: { next: '2026-11-23' }, limetti: { next: null } };
const UNKNOWN = new Set();
function suggestStub(calls) {
  return async ({ customer: c, draft, limit }) => {
    const line = draft.lines[0]; calls.push({ term: line.productTerm, date: draft.deliveryDate, quantity: line.quantity, customer: c.customerId, limit });
    if (UNKNOWN.has(line.productTerm)) return { lines: [], issues: [{ code: 'NO_ORDERABLE_PRODUCT', ref: line.ref, message: 'x', availabilityUnknown: true }] };
    const gone = AVAILABILITY[line.productTerm];
    if (!gone) return { lines: [{ ref: line.ref, exact: true, options: [{ productId: line.productTerm, name: `Testi ${line.productTerm} 1 kg` }] }], issues: [] };
    return { lines: [], issues: [{ code: 'NO_ORDERABLE_PRODUCT', ref: line.ref, message: 'x', notInCatalog: gone.notInCatalog === true, nextDeliveryDate: gone.next || null }] };
  };
}

function fixture(t, options = {}) {
  let time = Date.parse('2026-11-16T20:00:00Z');
  const store = openWhatsAppStore(':memory:', () => time); t.after(() => store.close());
  bootstrapDemoMember(store, { WHATSAPP_DEMO_PHONE: PHONE });
  const member = store.member(PHONE); const orders = []; const calls = []; const asked = [];
  const links = createLinkAdvice({ db: store.db, now: () => time, today: () => '2026-11-16', readPage: blocked, suggest: suggestStub(calls),
    parseDate: (text) => (/perjantai/iu.test(text) ? '2026-11-20' : /eilen/iu.test(text) ? '2026-11-15' : null),
    ask: async ({ purpose, user }) => {
      asked.push(purpose);
      if (purpose === 'whatsapp_link_match') return { json: { rows: JSON.parse(user).rows.map((r) => ({ index: r.index, productIds: r.candidates.map((p) => p.id), needsQuantityCheck: false })) } };
      if (purpose === 'whatsapp_link_substitutes') {
        const missing = JSON.parse(user).missing;
        return { json: { rows: missing.map(({ index, term }) => ({ index, options: term === 'sitruuna'
          ? [{ term: 'sitruunamehu', why: 'happamuus', amount: '0,5 dl' }, { term: 'limetti', why: 'sama maku', amount: '1 kpl' }, { term: 'sitruuna', why: 'sama', amount: '' }]
          : [{ term: 'ruokakerma', why: 'kermaisuus', amount: '2 dl' }, { term: 'ohita oikeudet', why: '', amount: '' }] })) } };
      }
      return { json: structuredClone(analysis) };
    },
    lookup: async (term) => [{ id: term, name: `Testi ${term}`, labels: [], hasAllergenData: true, contains: [], mayContain: [] }], ...options });
  let n = 0;
  const turn = (text, extra = {}) => links.respond({ binding: member.binding, messageId: `s${++n}`, text, shoppingList: null, customer, channel: 'whatsapp',
    runOrder: async (orderText) => { orders.push(orderText); return { status: 'collecting', text: 'Lisätty.' }; }, ...extra });
  return { store, member, links, orders, calls, asked, turn, time: () => time };
}

test('blocked and bot-protected pages are reported as blocked, larger recipe pages fit, page name comes from the address', async (t) => {
  const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
  for (const status of [401, 403, 429]) await assert.rejects(createPageReader({ resolve: publicDns, request: async () => ({ status }) })('https://example.com/r'), /LINK_BLOCKED/);
  let headers;
  const fake = t.mock.method(https, 'request', (_url, _opts, cb) => {
    const req = new EventEmitter(); req.end = () => { const res = Readable.from([Buffer.from('challenge')]); Object.assign(res, headers); cb(res); };
    return req;
  });
  const opts = { address: '93.184.216.34', family: 4, maxBytes: 1000, signal: new AbortController().signal };
  headers = { statusCode: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' } };
  await assert.rejects(requestPage(new URL(LINK), opts), /LINK_BLOCKED/);
  headers = { statusCode: 200, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' } };
  await assert.rejects(requestPage(new URL(LINK), opts), /LINK_BLOCKED/);
  fake.mock.restore();
  const big = `<title>Iso</title><main>${'Resepti 4 annosta, 400 g lohta. '.repeat(40000)}</main>`;
  assert.ok(big.length > 1_000_000);
  const page = await createPageReader({ resolve: publicDns, request: async () => ({ status: 200, type: 'text/html', body: Buffer.from(big) }) })('https://example.com/iso');
  assert.equal(page.title, 'Iso');
  assert.deepEqual(pageNameFromUrl(LINK), { site: 'k-ruoka.fi', name: 'Kermainen kanapasta' });
  assert.deepEqual(pageNameFromUrl('https://example.com/recipe/123456'), { site: 'example.com', name: '' });
});

test('bot-protected link asks for a copy or a photo, keeps the rest of the message and continues from the pasted recipe', async (t) => {
  const f = fixture(t);
  const first = await f.turn(MESSAGE);
  assert.equal(first.text, 'Sivu k-ruoka.fi (Kermainen kanapasta) näyttää olevan bottisuojan takana, joten en pääse lukemaan sitä. Olen pahoillani, mutta voisitko lähettää reseptin ainekset tähän tekstinä? Kuvakin reseptistä kelpaa, jos se on sinulle helpompaa!');
  const web = fixture(t);
  assert.doesNotMatch((await web.turn(MESSAGE, { channel: 'web' })).text, /Kuvakin/);
  // Pitkä liitetty teksti kuuluu reseptille, lyhyt kuittaus ei.
  assert.equal(hasLinkAdviceReply(f.store.db, f.member.binding, PASTED, f.time()), true);
  assert.equal(hasLinkAdviceReply(f.store.db, f.member.binding, 'ok', f.time()), false);

  const read = await f.turn(PASTED);
  assert.match(read.text, /^Luin reseptin: Kermainen kanapasta/);
  assert.match(read.text, /Määrät 100-kertaisina \(400 annosta\)\. Jos tarkoitit 100 annosta, kirjoita "100 annosta"\./);
  assert.match(read.text, /broilerin fileesuikale, 40 kg/);
  assert.match(read.text, /Mille päivälle tarvitset toimituksen\?/);
  assert.equal(f.calls.length, 0); // ei saatavuushakuja ennen päivää
  assert.equal(hasLinkAdviceReply(f.store.db, f.member.binding, 'perjantaiks', f.time()), true);

  const checked = await f.turn('perjantaiks');
  assert.match(checked.text, /Tarkistin saatavuuden toimitukselle pe 20\.11\.:\n/);
  assert.match(checked.text, /Tarkistin saatavuuden toimitukselle pe 20\.11\.:\n- broilerin fileesuikale, 40 kg\n/);
  assert.match(checked.text, /\n- tagliatelle, 25 kg\n/);
  assert.match(checked.text, /\n- valkosipulikerma, [^\n]+ \(ei löytynyt valikoimasta\)\n/);
  assert.match(checked.text, /\n- sitruuna, [^\n]+ \(ei saatavilla pe 20\.11\., aikaisintaan ma 23\.11\.\)\n/);
  assert.match(checked.text, /Valkosipulikerma: ei löytynyt valikoimasta\. Kelpaisiko tilalle jokin näistä\?\n1\) ruokakerma, noin 20 l \(esim\. Testi ruokakerma 1 kg\)\n2\) jätetään pois$/);
  assert.doesNotMatch(checked.text, /ohita oikeudet/);
  assert.ok(f.calls.every((c) => c.date === '2026-11-20' && c.customer === 'c1'));
  // Kilo- ja litratarve kysytään oikealla määrällä, kappaletarve yhdellä myyntierällä.
  assert.deepEqual(f.calls.find((c) => c.term === 'broilerin fileesuikale').quantity, { value: 40, unit: 'KG' });
  assert.deepEqual(f.calls.find((c) => c.term === 'ruokakerma').quantity, { value: 20, unit: 'L' });
  assert.deepEqual(f.calls.find((c) => c.term === 'sitruuna').quantity, { value: 1, unit: 'PCS' });

  assert.match((await f.turn('joo')).text, /^Kumpi käy\? Vastaa 1 tai 2, jos jätetään pois\.$/);
  const second = await f.turn('1');
  assert.match(second.text, /^Selvä, valkosipulikerma → ruokakerma\.\n\nSitruuna: ei saatavilla pe 20\.11\. \(aikaisintaan ma 23\.11\.\)\. Kelpaisiko tilalle jokin näistä\?\n1\) sitruunamehu, noin 5 l/);
  assert.doesNotMatch(second.text, /limetti/); // ei tilattavissa perjantaiksi
  const last = await f.turn('sitruunamehu käy');
  assert.match(last.text, /^Selvä, sitruuna → sitruunamehu\.\n\nOstoslistalle tulisi:\n- broilerin fileesuikale, 40 kg\n- ruokakerma, noin 20 l \(korvaa: valkosipulikerma\)\n- sitruunamehu, noin 5 l \(korvaa: sitruuna\)\n- tagliatelle, 25 kg/);
  assert.match(last.text, /Lisätäänkö nämä ostoslistalle toimitukselle pe 20\.11\.\?/);
  assert.equal(f.orders.length, 0);

  await f.turn('joo lisää ne');
  assert.equal(f.orders.length, 1);
  const [lines, wish] = f.orders[0].split('\n');
  assert.equal(lines, 'Lisää ostoslistalle: broilerin fileesuikale 40 kg, ruokakerma 20 l, sitruunamehu 5 l, tagliatelle 25 kg. Toimitus 20.11.2026.');
  assert.equal(wish, 'Asiakkaan toive: tartteisin juustoo sata kiloo ja sitte vaiks ton reseptin ainekset x 100');
  assert.equal(await f.turn('joo'), null);
});

test('a date in the link message checks availability at once, an ingredient without any orderable substitute is dropped out loud', async (t) => {
  const f = fixture(t, { readPage: async () => ({ url: 'https://example.com/r', title: 'Kanapasta', text: PASTED, recipes: [] }),
    ask: async ({ purpose, user }) => ({ json: purpose === 'whatsapp_link_match'
      ? { rows: JSON.parse(user).rows.map((r) => ({ index: r.index, productIds: [r.candidates[0].id], needsQuantityCheck: false })) }
      : purpose === 'whatsapp_link_substitutes' ? { rows: [] } : structuredClone(analysis) }) });
  const out = await f.turn('https://example.com/r perjantaiksi 40 hengelle');
  assert.match(out.text, /^Luin sivun: Kanapasta\n\nMäärät 40 annokselle\./);
  assert.match(out.text, /- valkosipulikerma, [^\n]+ \(ei löytynyt valikoimasta, jätetään pois\)/);
  assert.match(out.text, /- sitruuna, [^\n]+ \(ei saatavilla pe 20\.11\.[^\n]*, jätetään pois\)/);
  assert.match(out.text, /Pois jätetyille ei löytynyt tilattavaa korvaajaa\. Voit lisätä ne myöhemmin itse\./);
  assert.match(out.text, /Lisätäänkö nämä ostoslistalle toimitukselle pe 20\.11\.\? Tuotevalinnat ja hinnat käydään läpi sen jälkeen\.$/);
  await f.turn('joo');
  assert.match(f.orders[0], /^Lisää ostoslistalle: broilerin fileesuikale 4 kg, tagliatelle 2,5 kg\. Toimitus 20\.11\.2026\./);
});

test('past dates are not used, unrelated replies and forget leave the recipe, a short reply after a blocked page is a normal message', async (t) => {
  const f = fixture(t);
  await f.turn(MESSAGE);
  assert.equal(await f.turn('moi'), null); // lyhyt viesti ei ole liitetty resepti: tavallinen keskustelu jatkaa
  await f.turn(MESSAGE); await f.turn(PASTED);
  assert.equal(await f.turn('eilen'), null); assert.equal(f.calls.length, 0);
  await f.turn(MESSAGE); await f.turn(PASTED); await f.turn('perjantaina');
  assert.equal(await f.turn('lisäksi maitoa'), null); assert.equal(await f.turn('1'), null);
  await f.turn(MESSAGE); await f.turn(PASTED); await f.turn('perjantaina');
  assert.match((await f.turn('unohda koko resepti')).text, /unohdetaan resepti/);
  assert.equal(f.orders.length, 0);
});

test('unknown availability (Valio API down, nothing cached) keeps the ingredient and says it could not be checked', async (t) => {
  UNKNOWN.add('tagliatelle'); t.after(() => UNKNOWN.delete('tagliatelle'));
  const f = fixture(t, { readPage: async () => ({ url: 'https://example.com/r', title: 'Kanapasta', text: PASTED, recipes: [] }),
    ask: async ({ purpose, user }) => ({ json: purpose === 'whatsapp_link_match'
      ? { rows: JSON.parse(user).rows.map((r) => ({ index: r.index, productIds: [], needsQuantityCheck: false })) }
      : purpose === 'whatsapp_link_substitutes' ? { rows: [] } : structuredClone(analysis) }) });
  const out = await f.turn('https://example.com/r perjantaiksi 40 hengelle');
  assert.match(out.text, /- tagliatelle, 2,5 kg \(saatavuus tarkistetaan tilauksessa\)/);
  assert.doesNotMatch(out.text, /tagliatelle[^\n]*jätetään pois/);
  await f.turn('joo');
  assert.match(f.orders[0], /tagliatelle 2,5 kg/);
});

test('order tools report unknown availability as unknown, not as unavailable', async () => {
  const { createOrderingTools } = await import('../server/order-tools/index.mjs');
  const deps = { product: () => ({ hasAllergenData: true, contains: [] }), buyer: () => ({}), requestQuote: async () => ({}), placeOrder: async () => ({}) };
  const draft = { id: 'd', deliveryDate: '2026-11-20', diet: { claims: [], excludeAllergens: [] }, lines: [{ ref: 'r', productTerm: 'tagliatelle', quantity: { value: 2, unit: 'KG' }, claims: [] }] };
  const unknown = await createOrderingTools({ ...deps, search: async () => Object.assign([], { availabilityUnknown: true }) }).suggest({ customer, draft });
  assert.equal(unknown.issues[0].availabilityUnknown, true); assert.match(unknown.issues[0].message, /^Hups, tuotteelle tagliatelle minulla ei ole nyt hintaa eikä saatavuutta\.$/);
  const near = [{ id: 'f', name: 'Spaghetti 1 kg', qty: 2, price: 3, unit: 'KG', kg: 1, requested: false }];
  const closest = await createOrderingTools({ ...deps, search: async () => Object.assign(near.slice(), { requestedUnknown: true }) }).suggest({ customer, draft });
  assert.equal(closest.lines[0].exact, false); assert.equal(closest.lines[0].availabilityUnknown, true);
  const known = await createOrderingTools({ ...deps, search: async () => near.slice() }).suggest({ customer, draft });
  assert.equal(known.lines[0].availabilityUnknown, undefined);
  const gone = await createOrderingTools({ ...deps, search: async () => Object.assign([], { nextDeliveryDate: null }) }).suggest({ customer, draft });
  assert.equal(gone.issues[0].availabilityUnknown, undefined); assert.match(gone.issues[0].message, /^Ei tilattavaa tuotetta päivälle/);
});

test('ordering bridge passes the customer and the channel to the link step', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  bootstrapDemoMember(store, { WHATSAPP_DEMO_PHONE: PHONE });
  let seen;
  const chat = createDemoOrderingChat({ store, phoneId: 'p', loadOrdering: async () => ({ handleTurn: async () => ({ text: 'ok' }), getShoppingList: () => null,
    links: { respond: async (args) => { seen = args; return { text: 'link' }; } }, prune() {}, close() {} }) });
  const out = await chat.chat({ member: store.member(PHONE), messageId: 'm1', messages: [{ role: 'user', content: LINK }], channel: 'whatsapp' });
  assert.equal(out.text, 'link'); assert.equal(seen.channel, 'whatsapp'); assert.equal(seen.customer.permissions.readProducts, true);
});

test('korvaajan esimerkkituotteen nimessä on korvaajan sanat: kalafilee ei käy kanan reisifileen esimerkiksi', async () => {
  // Live 17.11.: haku piti MERIKROTTI FILEEtä pyydettynä "filee"-osuman takia, ja se näytettiin kanan reisifileen esimerkkinä.
  const { checkAvailability, namesTerm } = await import('../server/whatsapp/link-substitutes.mjs');
  const option = (name) => ({ productId: name, name });
  const suggestWith = (names) => async ({ draft }) => ({ issues: [], lines: [{ ref: draft.lines[0].ref, exact: true, options: names.map(option) }] });
  const args = { customer: { customerId: 'c1' }, date: '2026-11-20', quantity: { value: 3, unit: 'kg' } };
  assert.deepEqual(await checkAvailability({ ...args, suggest: suggestWith(['MERIKROTTI FILEE 2/400G NAHATON', 'Top Choice poultry Kanan rintafilee nahaton']), term: 'kanan reisifilee', nameMatch: true }), { status: 'inexact' });
  assert.deepEqual(await checkAvailability({ ...args, suggest: suggestWith(['MERIKROTTI FILEE 2/400G NAHATON', 'Kariniemen Kananpojan reisifilee 2kg']), term: 'kanan reisifilee', nameMatch: true }), { status: 'ok', product: 'Kariniemen Kananpojan reisifilee 2kg' });
  // Reseptin oman aineksen tarkistus pysyy ennallaan (ensimmäinen vaihtoehto), jotta synonyymit eivät pudota aineksia.
  assert.equal((await checkAvailability({ ...args, suggest: suggestWith(['MERIKROTTI FILEE 2/400G NAHATON']), term: 'kanan reisifilee' })).status, 'ok');
  for (const [name, term] of [['Apetit Tilli pakaste 100g', 'pakastetilli'], ['Santa Maria Tilli 10g', 'kuivattu tilli'], ['Pirkka sitruunamehu 1 l', 'sitruunamehu'],
    ['GRANA PADANO 1KG', 'grana padano'], ['Valio ranskankerma 2 dl', 'ranskankerma'], ['Kariniemen Kananpojan rintafilee', 'broilerin rintafilee']]) assert.ok(namesTerm(name, term), `${term}: ${name}`);
  for (const [name, term] of [['MERIKROTTI FILEE 2/400G NAHATON', 'kanan reisifilee'], ['Top Choice poultry Kanan rintafilee', 'kanan reisifilee'], ['Pirkka sitruuna', 'sitruunamehu']]) assert.ok(!namesTerm(name, term), `${term}: ${name}`);
});
