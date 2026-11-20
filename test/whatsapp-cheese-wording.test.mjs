// Puhelinkuva 17.11. klo 21.48: "3 kg juustoa sunnuntaiksi" sai vastauksen "En saa nyt tarkistettua saatavuutta: juusto …
// Näiden vastaavien tuotteiden saatavuus on tiedossa:", yhden vaihtoehdon ja "Vastaa 1." Eelis: taivuta ("saatavuutta
// juustolle"), "näiden" ei sovi yhteen tuotteeseen, ja laktoosittomuus pitää näkyä. Paikallisessa kokeessa valitsija tarjosi
// lisäksi jogurtin tilalle kaurajuomaa ja juustolle kirnuvoita perustelulla "Ei sovi juuston tilalle".
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { allative } = await import('../server/fi-words.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createNearbyPicker, clearNearbyMemo } = await import('../server/order-tools/nearby.mjs');
const { selectionAcknowledgement, CHOOSE_TRANSITIONS } = await import('../server/whatsapp/cart-presentation.mjs');

test('tuotesana taivutetaan allatiiviin, tuntematon kirjoitetaan "tuotteelle X"', () => {
  const cases = { juusto: 'juustolle', maito: 'maidolle', voi: 'voille', jogurtti: 'jogurtille', kananmunat: 'kananmunille',
    'maustamaton jogurtti': 'maustamattomalle jogurtille', 'laktoositon kerma': 'laktoosittomalle kermalle',
    'gluteeniton leipä': 'gluteenittomalle leivälle', 'tavallinen maito': 'tavalliselle maidolle', 'kanan rintafilee': 'kanan rintafileelle',
    maitorahka: 'maitorahkalle', 'Emmental-juusto': 'Emmental-juustolle', vehnäjauho: 'vehnäjauhoille', tagliatelle: 'tuotteelle tagliatelle',
    'tuore tryffeli': 'tuotteelle tuore tryffeli' };
  for (const [term, want] of Object.entries(cases)) assert.equal(allative(term), want, term);
});

const clock = Date.parse('2026-11-17T21:48:00+02:00');
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const emmental = { productId: '476660', name: 'Valio Emmental punaleima e2,5 kg raaste', salesUnits: 2, salesUnitLabel: 'kpl', covers: { value: 5, unit: 'KG' },
  unitPriceNet: 23.49, lineNet: 46.98, labels: ['FREE_FROM_LACTOSE'], lactoseFree: true, replaceTerm: 'emmental-juusto' };
function engine(options) {
  const tools = {
    async suggest({ draft }) {
      const l = draft.lines[0];
      return { issues: [], lines: [{ ref: l.ref, total: options.length, more: false, exact: false, availabilityUnknown: true, alternatives: true, clarify: [], options }] };
    },
    async quote() { return { issues: [{ code: 'X', message: 'ei käytössä' }] }; },
    async submit() { return { status: 'rejected', reasons: [] }; },
  };
  const add = { intent: 'order', deliveryDate: '2026-11-22', ops: [{ op: 'add', productTerm: 'juusto', quantity: { value: 3, unit: 'KG' }, claims: [], excludeAllergens: [] }] };
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => clock), tools, now: () => clock, interpretTurn: async () => add });
  return (text) => handleTurn({ messageId: 'm1', conversationId: 'c', customer, text, receivedAt: clock });
}

test('juusto, saatavuus tuntematon, yksi vastaava: taivutettu otsikko, "Tämän", laktoositon näkyy ja kysytään käykö', async () => {
  const r = await engine([emmental])('moi tarviin 3 kg juustoo sunnuntaiks');
  assert.equal(r.status, 'choosing');
  assert.match(r.text, /Hups, juustolle minulla ei ole nyt hintaa eikä saatavuutta\. Tietojani on supistettu: [^\n]+\nTämä löytyy tilalle \(tarve 3 kg\):\n1\) /);
  assert.doesNotMatch(r.text, /saatavuutta: juusto|Näiden vastaavien|Näistä voit valita/);
  assert.match(r.text, /1\) Valio Emmental punaleima e2,5 kg raaste \(laktoositon\), /);
  assert.match(r.text, /Tarve on 3 kg; tämä myyntierä kattaa 5 kg\./);
  assert.match(r.text, /Vastaa 1, jos tämä käy\. Muuten kirjoita "poista juusto"\./);
  assert.doesNotMatch(r.text, /Jos mikään näistä ei käy|\nVastaa 1\.$/);
});

test('kaksi vastaavaa: "Tässä korvaajia", ohje kaikille ja numerot; nimessä jo laktoositon ei toistu', async () => {
  const rahka = { ...emmental, productId: '477044', name: 'Valio maitorahka 5 kg laktoositon', covers: { value: 5, unit: 'KG' }, lineNet: 16.03, salesUnits: 1 };
  const r = await engine([emmental, rahka])('juustoa 3 kg');
  assert.match(r.text, /\nTässä korvaajia \(tarve \d+ kg\):\n1\) /);
  assert.match(r.text, /2\) Valio maitorahka 5 kg laktoositon, 1 kpl/);
  assert.doesNotMatch(r.text, /laktoositon \(laktoositon\)/);
  assert.match(r.text, /Jos mikään näistä ei käy, kirjoita "poista juusto"\.\nVastaa 1 tai 2\./);
});

test('vastaavien valitsija: fits=false ei kelpaa, vaikka malli listaa sen (kirnuvoi juustolle)', async () => {
  clearNearbyMemo();
  const calls = [];
  const pick = createNearbyPicker({ enabled: () => true, ask: async (a) => {
    calls.push(a);
    return { json: { role: 'juusto ruoanvalmistukseen', picks: [
      { id: '476660', term: 'emmental-raaste', reason: 'Juustoa samaan käyttöön.', fits: true },
      { id: '476740', term: 'kirnuvoi', reason: 'Ei sovi juuston tilalle, koska kyse on rasvasta.', fits: false }] } };
  } });
  const picks = await pick({ term: 'juusto', quantity: { value: 3, unit: 'KG' }, candidates: [{ id: '476660', name: 'Emmental' }, { id: '476740', name: 'Kirnuvoi' }] });
  assert.deepEqual(picks.map((x) => x.id), ['476660']);
  assert.equal(calls[0].tier, 'deep');
  assert.equal(calls[0].schema.properties.picks.items.required.includes('fits'), true);
  assert.match(calls[0].system, /juoma ei korvaa lusikoitavaa/);
});

test('siirtymäviesti ei toistu, kun jokin tuote on jo valittu (voin laktoosivastaus maidon valinnan jälkeen)', () => {
  const lines = [{ ref: 'r1', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, selectedProductId: '1', selectedName: 'Valio rasvaton maito 1 l ESL' },
    { ref: 'r2', productTerm: 'voi', quantity: { value: 5, unit: 'KG' } }];
  const prev = { id: 'd', revision: 4, status: 'needs_clarification', lines };
  const now = { id: 'd', revision: 5, status: 'needs_product_selection', lines };
  const out = selectionAcknowledgement({ previousList: prev, shoppingList: now, status: 'choosing' });
  assert.equal(out.length, 1);
  assert.equal(CHOOSE_TRANSITIONS.includes(out[0]), false);
  // Ensimmäinen kerta (mitään ei ole vielä valittu): siirtymä näytetään kuten ennen.
  const fresh = selectionAcknowledgement({ previousList: { ...prev, lines: lines.map(({ selectedProductId, selectedName, ...l }) => l) },
    shoppingList: { ...now, lines: lines.map(({ selectedProductId, selectedName, ...l }) => l) }, status: 'choosing' });
  assert.equal(CHOOSE_TRANSITIONS.includes(fresh[0]), true);
});

test('kaksi tuotetta ilman saatavuustietoa: yksi lause ja molempien poisto-ohje', async () => {
  const { mergeUnavailable } = await import('../server/order-conversation/index.mjs');
  const msg = (t) => `Hups, ${allative(t)} minulla ei ole nyt hintaa eikä saatavuutta.`;
  assert.deepEqual(mergeUnavailable([msg('banaani'), msg('omena')]),
    ['Hups, banaaneille ja omenoille minulla ei ole nyt hintaa eikä saatavuutta.']);
  assert.deepEqual(mergeUnavailable([msg('juusto')]), [msg('juusto')]);
});
