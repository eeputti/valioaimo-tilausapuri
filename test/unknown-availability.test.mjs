// Selainkokeilu 17.11.: Valion rajapinta ei vastaa, eikä jäätelöstä ole aiempaa saatavuustietoa. Botti toisti joka päivälle
// "Saatavuutta ei saatu nyt tarkistettua … Kokeile toista päivää". Nyt se kertoo asian kerran, ei kehota vaihtamaan päivää,
// tarjoaa saatavuudeltaan tunnettuja vastaavia tuotteita, ja valinta vaihtaa rivin tuotteen ja kysyy määrän.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { guardModelText } = await import('../server/whatsapp/model-guard.mjs');

const clock = Date.parse('2026-11-15T09:00:00+02:00');
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const add = { intent: 'order', deliveryDate: '2026-11-18', ops: [{ op: 'add', productTerm: 'jäätelö', quantity: { value: 1000, unit: 'L' }, claims: [], excludeAllergens: [] }] };
const unknown = (l) => ({ issues: [{ code: 'NO_ORDERABLE_PRODUCT', ref: l.ref, availabilityUnknown: true, nextDeliveryDate: null,
  message: `En saa nyt tarkistettua saatavuutta tuotteelle ${l.productTerm}, joten en voi luvata sitä millekään päivälle.` }], lines: [] });

function engine(suggestFor) {
  const calls = { suggest: 0 };
  const tools = {
    async suggest({ draft }) { calls.suggest += 1; return suggestFor(draft.lines[0], draft); },
    async quote({ draft }) {
      return { quoteId: `Q${draft.revision}`, draftId: draft.id, revision: draft.revision, expiresAt: new Date(clock + 900_000).toISOString(), issues: [], totals: { net: 10 },
        lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: l.quantity?.value || 1, salesUnitLabel: 'kpl', covers: l.quantity, lineNet: 10 })) };
    },
    async submit() { return { status: 'confirmed', orderId: 'AGW-1', reasons: [] }; },
  };
  const script = { jäätelö: add, perjantai: { intent: 'order', deliveryDate: '2026-11-20', ops: [] }, 'nyt sit?': { intent: 'other', ops: [] },
    '10 kpl': (draft) => ({ intent: 'order', ops: [{ op: 'update', ref: draft.pending.refs[0], quantity: { value: 10, unit: 'PCS' } }] }) };
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => clock), tools, now: () => clock,
    interpretTurn: async ({ text, draft }) => { const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] }; } });
  let n = 0;
  return { calls, say: (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: clock }) };
}

// Eelis 17.11.: botti sanoo selvästi, jos tuotetta ei ole ja miksi ("tietojani on supistettu"). Tuote ilman tietoa ja korvaajaa
// jätetään pois listalta, eikä keskustelu jää odottamaan "poista X" -viestiä.
test('tuntematon saatavuus ilman vastaavia: syy kerrotaan, rivi poistetaan, ei päiväkokeiluja', async () => {
  const { say, calls } = engine(unknown);
  const first = await say('jäätelö');
  assert.match(first.text, /^Hups, jäätelölle minulla ei ole nyt hintaa eikä saatavuutta\. Tietojani on supistettu: Valion testirajapinta suljettiin/);
  assert.match(first.text, /En löytänyt korvaajaa, joten poistin rivin listalta\./);
  assert.match(first.text, /Hyvin löytyy esimerkiksi maidot ja kermat/);
  assert.doesNotMatch(first.text, /Kokeile toista päivää|Toinen päivä ei auta|poista jäätelö/);
  assert.equal(calls.suggest, 1, 'huomisen kiirekokeilu ei hae seuraavia päiviä, kun tieto puuttuu kaikilta');
  const again = await say('perjantai');
  assert.doesNotMatch(again.text, /hintaa eikä saatavuutta/, 'poistettu rivi ei palaa');
  assert.match(again.text, /Mitä tarvitset\?/);
});

test('tuntematon saatavuus ja vastaavat tuotteet: rehellinen otsikko, valinta vaihtaa tuotteen ja kysyy määrän', async () => {
  const alt = { productId: '470792', name: 'PH7 MARJAMOUSSE LEIVOS PAKASTE', salesUnits: 1, salesUnitLabel: 'laatikko', covers: null, lineNet: 58.66, labels: [],
    replaceTerm: 'leivos', askQuantity: true };
  const { say } = engine((l) => (l.productTerm === 'jäätelö'
    ? { issues: [], lines: [{ ref: l.ref, total: 1, more: false, exact: false, availabilityUnknown: true, alternatives: true, clarify: [], options: [alt] }] }
    : unknown(l)));
  const shown = await say('jäätelö');
  assert.equal(shown.status, 'choosing');
  assert.match(shown.text, /Hups, jäätelölle minulla ei ole nyt hintaa eikä saatavuutta\. Tietojani on supistettu: [^\n]+\nTämä löytyy tilalle \(tarve 1000 l\):\n1\) /);
  assert.match(shown.text, /1\) Ph7 marjamousse leivos pakaste, 1 laatikko, 58,66 €/i);
  assert.match(shown.text, /määrä kysytään valinnan jälkeen/);
  assert.doesNotMatch(shown.text, /Tarkkaa osumaa ei löytynyt/);
  const picked = await say('1');
  assert.match(picked.text, /- leivos: PH7 MARJAMOUSSE LEIVOS PAKASTE/i);
  assert.match(picked.text, /Kuinka paljon: leivos\?/);
  const ready = await say('10 kpl');
  assert.equal(ready.status, 'ready');
});

test('mallin vapaasta tekstistä pudotetaan sisäinen sana tilausmoottori', () => {
  const r = guardModelText('Joo, tarkistetaan perjantai 20.11. toimitukselle. Jäätelön saatavuus selviää tilausmoottorista.');
  assert.equal(r.text, 'Joo, tarkistetaan perjantai 20.11. toimitukselle.');
  assert.deepEqual(r.blocked, ['jargon']);
});

test('pelkkä päivävastaus valintalistan aikana menee tilausmoottorille ilman dialogimallia ("perjantai?")', async (t) => {
  const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
  const { createOrderingDialogue, isDateOnly } = await import('../server/whatsapp/dialogue.mjs');
  for (const text of ['perjantai?', 'entä perjantaiksi', 'pe 20.11.', 'huomiseks sit', 'käykö keskiviikko?']) assert.equal(isDateOnly(text), true, text);
  for (const text of ['perjantaina tarvitaan 10 l maitoa', 'miksi perjantai?', 'millo saa jäätelöö?', 'pe']) assert.equal(isDateOnly(text), false, text);
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  let asked = 0; const ordered = [];
  // Malli kysyisi tarkennusta ("Tarkoitatko toimitusta perjantaille 20.11.?"), mutta sitä ei kutsuta.
  const dialogue = createOrderingDialogue({ db: store.db, timeOf: () => clock,
    ask: async () => { asked += 1; return { json: { route: 'chat', text: 'Tarkoitatko toimitusta perjantaille 20.11.?', lookupQuery: '', suggestionTerm: '', openCart: false } }; } });
  const choosing = { status: 'choosing', draftId: 'd1', revision: 3, text: 'Toimitus pe 20.11., hinnat alv 0 %.\n*Jäätelö 1000 l:*\n1) Leivos, 1 laatikko, 58,66 €\nVastaa 1.' };
  const r = await dialogue.respond({ binding: 'one', messageId: 'm1', text: 'perjantai?', runOrder: async (input) => { ordered.push(input); return choosing; } });
  assert.equal(asked, 0);
  assert.deepEqual(ordered, ['perjantai?']);
  assert.doesNotMatch(r.text, /Tarkoitatko/);
  assert.match(r.text, /Toimitus pe 20\.11\./);
});

test('rivi ilman tilattavaa tuotetta ei ole "Sen jälkeen valitaan" -listassa, vaan sille kerrotaan vaihtoehdot (spagetti pe 20.11.)', async () => {
  const opt = (name, i) => ({ productId: `${name}-${i}`, name: `${name} ${i}`, salesUnits: 1, salesUnitLabel: 'kpl', lineNet: 10 * i, labels: [] });
  const script = { 'spagettia kanaa ja kastiketta': { intent: 'order', deliveryDate: '2026-11-20', ops: ['spagetti', 'kanafilee', 'valkosipulikastike'].map((productTerm) => ({ op: 'add', productTerm, quantity: { value: 2, unit: 'KG' }, claims: [], excludeAllergens: [] })) } };
  const store = openDraftStore(':memory:', () => clock);
  const tools = {
    async suggest({ draft, exclude }) {
      const l = draft.lines[0];
      if (l.productTerm === 'spagetti') return { issues: [{ code: 'NO_ORDERABLE_PRODUCT', ref: l.ref, nextDeliveryDate: null, message: `Ei tilattavaa tuotetta päivälle pe 20.11.: ${l.productTerm}.` }], lines: [] };
      const shown = exclude?.[l.ref] || [];
      const list = [1, 2, 3, 4, 5].map((i) => opt(l.productTerm, i)).filter((o) => !shown.includes(o.productId));
      return { issues: [], lines: [{ ref: l.ref, total: list.length, more: list.length > 3, exact: true, clarify: [], options: list.slice(0, 3).map((o) => ({ ...o, covers: l.quantity })) }] };
    },
    async quote() { return { issues: [], lines: [] }; }, async submit() { return { status: 'confirmed', orderId: 'X' }; },
  };
  const handleTurn = createOrderingConversation({ store, tools, now: () => clock, interpretTurn: async ({ text }) => script[text] || { intent: 'other', ops: [] } });
  let n = 0; const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: clock });
  const first = await say('spagettia kanaa ja kastiketta');
  assert.match(first.text, /Ei tilattavaa tuotetta päivälle pe 20\.11\.: spagetti\./);
  assert.match(first.text, /\*Kanafilee 2 kg:\*/);
  assert.match(first.text, /Sen jälkeen valitaan valkosipulikastike\./);
  assert.doesNotMatch(first.text, /valitaan[^.\n]*spagetti/);
  assert.match(first.text, /Spagetti jää ilman tuotetta tälle päivälle\. Vaihda päivä tai tuote, tai poista se kirjoittamalla "poista spagetti"\./);
  // "Näytä lisää" samalle riville ei palauta spagettia valittavien listaan.
  const more = await say('näytä lisää');
  assert.doesNotMatch(more.text, /valitaan[^.\n]*spagetti/);
});

test('valmiin tuotteen (jäätelö) tilalle ei tarjota raaka-ainetta, raaka-aineen tilalle kelpaa raaka-aine', async (t) => {
  const { existsSync } = await import('node:fs');
  if (!existsSync(new URL('../data/catalog.json', import.meta.url))) { t.skip('katalogi puuttuu'); return; }
  const { knownAlternatives } = await import('../server/storefront.mjs');
  // 466172 jäätelö (418xx), 470792 marjamousse-leivos (41763), 473427 pakastemustikka (41740, raaka-aine).
  const seen = [];
  const pick = async ({ candidates }) => { seen.push(candidates.map((c) => c.id)); return []; };
  const item = { productTerm: 'jäätelö', quantity: { value: 1000, unit: 'L' }, claims: [], excludeAllergens: [] };
  await knownAlternatives(item, '2026-11-20', { unknownIds: ['466172'], knownIds: ['470792', '473427'], pick });
  assert.deepEqual(seen.at(-1), ['470792']);
  await knownAlternatives({ ...item, productTerm: 'mustikka', quantity: { value: 5, unit: 'KG' } }, '2026-11-20', { unknownIds: ['465273'], knownIds: ['470792', '473427'], pick });
  assert.ok(seen.at(-1).includes('473427'));
});
