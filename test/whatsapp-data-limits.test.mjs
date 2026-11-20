// Eelis 17.11.2026: Valion testirajapinta suljettiin, ja botilla on hinta ja saatavuus vain noin 900 tuotteelle. Botti sanoo
// selvästi, jos tuotetta ei ole ja miksi ("tietojani on supistettu"), eikä keskustelu jumitu puuttuvaan tuotteeseen.
// Paikallinen koe 17.11.: "8 kg broilerin rintafileetä ja 5 kg pastaa" jäi odottamaan "poista broilerin rintafileetä" -viestiä,
// vaikka kanan rintafileillä on hinta, ja "mitä tuotteita teillä on?" sai vain "Kerro vaan, mitä tarvitset".
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { isAssortmentQuestion, assortmentReply, noDataFor } = await import('../server/data-limits.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingTools } = await import('../server/order-tools/index.mjs');

test('kysymys valikoimasta tunnistetaan, tuotekysymys ei', () => {
  for (const t of ['mitä tuotteita teillä on?', 'mitä teiltä voi tilata?', 'mitä teillä on?', 'Mitä valikoimaa teillä on', 'mitä voin tilata?', 'millaisia tuotteita löytyy?', 'mitä kaikkea teiltä saa?'])
    assert.equal(isAssortmentQuestion(t), true, t);
  for (const t of ['mitä tarvitsen lohikeittoon?', 'mitä eroa noil on?', 'mitä maksaa maito?', 'mitä voin tehdä?', 'mitä 20 l maitoa maksaa', 'onko teillä laktoositonta maitoa?'])
    assert.equal(isAssortmentQuestion(t), false, t);
  assert.match(assortmentReply(), /Tietojani on supistettu: Valion testirajapinta suljettiin/);
  assert.match(assortmentReply(), /Hyvin löytyy esimerkiksi maidot ja kermat/);
  assert.equal(noDataFor(['jogurtti', 'banaani']), 'Hups, jogurtille ja banaaneille minulla ei ole nyt hintaa eikä saatavuutta.');
});

test('valikoimakysymykseen vastataan ilman mallia, kun tiedot ovat supistetut', async () => {
  const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE members (binding TEXT PRIMARY KEY); CREATE TABLE turns (binding TEXT)');
  const asked = [];
  const d = createOrderingDialogue({ db, timeOf: () => Date.parse('2026-11-17T12:00:00+02:00'),
    ask: async ({ purpose }) => { asked.push(purpose); return { json: { route: 'chat', text: 'Kerro vaan, mitä tarvitset.', lookupQuery: '', suggestionTerm: '', openCart: false } }; } });
  const say = (text, n) => d.respond({ binding: 'b1', messageId: `m${n}`, text, runOrder: async () => { throw new Error('ei tilausmoottoria'); }, getShoppingList: () => null });
  const before = process.env.VALIO_FALLBACK;
  try {
    process.env.VALIO_FALLBACK = 'last-known';
    const r = await say('mitä tuotteita teillä on?', 1);
    assert.match(r.text, /^Heh, rehellinen vastaus: valikoimani on nyt pieni\. Tietojani on supistettu/);
    assert.deepEqual(asked, [], 'ei mallikutsua');
    delete process.env.VALIO_FALLBACK;
    const live = await say('mitä teiltä voi tilata?', 2);
    assert.doesNotMatch(live.text, /supistettu/, 'oikean rajapinnan kanssa ei puhuta supistetuista tiedoista');
  } finally { if (before === undefined) delete process.env.VALIO_FALLBACK; else process.env.VALIO_FALLBACK = before; }
});

const clock = Date.parse('2026-11-17T12:00:00+02:00');
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const pasta = { productId: 'p1', name: 'Barilla Mezze Penne Tricolore pasta 5 kg', salesUnits: 1, salesUnitLabel: 'pussi', covers: { value: 5, unit: 'KG' }, unitPriceNet: 17.12, lineNet: 17.12, labels: [] };

function engine() {
  const tools = {
    async suggest({ draft }) {
      const l = draft.lines[0];
      if (l.productTerm === 'broilerin rintafilee') return { lines: [], issues: [{ code: 'NO_ORDERABLE_PRODUCT', ref: l.ref, availabilityUnknown: true, nextDeliveryDate: null, message: noDataFor([l.productTerm]) }] };
      return { issues: [], lines: [{ ref: l.ref, total: 1, more: false, exact: true, clarify: [], options: [pasta] }] };
    },
    async quote({ draft }) {
      return { quoteId: `Q${draft.revision}`, draftId: draft.id, revision: draft.revision, expiresAt: new Date(clock + 900_000).toISOString(), issues: [], totals: { net: 17.12 },
        lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 1, salesUnitLabel: 'pussi', covers: l.quantity, lineNet: 17.12 })) };
    },
    async submit() { return { status: 'confirmed', orderId: 'AGW-1', reasons: [] }; },
  };
  const add = { intent: 'order', deliveryDate: '2026-11-19', ops: [
    { op: 'add', productTerm: 'broilerin rintafilee', quantity: { value: 8, unit: 'KG' }, claims: [], excludeAllergens: [] },
    { op: 'add', productTerm: 'pasta', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [] }] };
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => clock), tools, now: () => clock,
    interpretTurn: async ({ text }) => (text === 'tilaus' ? add : { intent: 'other', ops: [] }) });
  let n = 0;
  return (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: clock });
}

test('tuote ilman tietoa ja korvaajaa jätetään pois, muut jatkuvat yhteenvetoon asti', async () => {
  const say = engine();
  const shown = await say('tilaus');
  assert.equal(shown.status, 'choosing');
  assert.match(shown.text, /^Hups, broilerin rintafileelle minulla ei ole nyt hintaa eikä saatavuutta\. Tietojani on supistettu: [^\n]+ En löytänyt korvaajaa, joten poistin rivin listalta\./);
  assert.match(shown.text, /\*Pasta 5 kg:\*\n1\) /);
  assert.doesNotMatch(shown.text, /Sen jälkeen valitaan|poista broilerin/);
  const ready = await say('1');
  assert.equal(ready.status, 'ready');
  assert.doesNotMatch(ready.text, /broiler/i);
});

test('broilerin rintafilee haetaan uudelleen kana-sanalla, kun broilerin tuotteilla ei ole tietoa', async () => {
  const seen = [];
  const kana = [{ id: 'k1', name: 'Kariniemen Kananpojan rintafilee maustamaton 4,4 kg', qty: 2, price: 33.88, unit: 'KG', kg: 4.4, requested: true }];
  const search = async (line) => { seen.push(line.productTerm); return line.productTerm === 'kanan rintafilee' ? kana.slice() : Object.assign([], { availabilityUnknown: true }); };
  const tools = createOrderingTools({ search, product: () => ({ hasAllergenData: true, contains: [] }), buyer: () => ({}), requestQuote: async () => ({}), placeOrder: async () => ({}) });
  const draft = { id: 'd', deliveryDate: '2026-11-19', diet: { claims: [], excludeAllergens: [] }, lines: [{ ref: 'r', productTerm: 'broilerin rintafilee', quantity: { value: 8, unit: 'KG' }, claims: [] }] };
  const r = await tools.suggest({ customer, draft });
  assert.deepEqual(seen, ['broilerin rintafilee', 'kanan rintafilee']);
  assert.equal(r.lines[0].options[0].productId, 'k1');
  assert.deepEqual(r.issues, []);
});

test('mallin tuotesana perusmuotoon: "broilerin rintafileetä" ei näy listalla partitiivina', async () => {
  const { baseForm } = await import('../server/order-conversation/interpret.mjs');
  assert.equal(await baseForm('maustamatonta jogurtti'), 'maustamaton jogurtti');
  assert.equal(await baseForm('Valio Oltermanni'), 'Valio Oltermanni');
  assert.equal(await baseForm(''), '');
});

test('partitiivi perusmuotoon oikealla sanastolla', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'paikallinen katalogi puuttuu' }, async () => {
  const { baseForm } = await import('../server/order-conversation/interpret.mjs');
  assert.equal(await baseForm('broilerin rintafileetä'), 'broilerin rintafilee');
  assert.equal(await baseForm('maustamatonta jogurttia'), 'maustamaton jogurtti');
  assert.equal(await baseForm('perunoita'), 'peruna');
  assert.equal(await baseForm('kahvimaitoa'), 'kahvimaito');
});
