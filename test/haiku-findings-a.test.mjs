// Haiku-mittauksen 16.11. löydökset A1–A3 ja V019 (docs/parallel/haiku-quality-2026-11-16.md, korjaukset docs/parallel/haiku-fixes-a.md).
// Ei mallikutsuja: malli korvataan kiinteällä vastauksella, tuotteet tulevat oikeasta katalogista.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = fs.existsSync(path.join(ROOT, 'data/catalog.json')) ? false : 'data/catalog.json puuttuu (rajoitettu aineisto)';
process.env.AIMO_LEARNED = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-haiku-a-')), 'learned.json');
const { createModelInterpreter, slangOf } = await import('../server/order-conversation/interpret.mjs');
const { factProducts, factsReply, namedInMessage } = await import('../server/whatsapp/product-facts.mjs');

const draft = { deliveryDate: null, lines: [], offered: {}, pending: null };
const modelSaying = (ops) => createModelInterpreter({ fallback: async () => ({ intent: 'other', ops: [] }),
  ask: async (call) => ({ json: { intent: 'order', deliveryDate: '', ops: ops(call) } }) });
const add = (productTerm, value) => ({ op: 'add', ref: '', productTerm, quantityValue: value, quantityUnit: 'KG', quantityBasis: '', addClaims: [], removeClaims: [], excludeAllergens: [], option: 0 });

test('A1 slangi: "jauhis" on jauhelihaa myös mallitulkissa', async () => {
  assert.deepEqual(await slangOf('6 kg jauhista'), [{ word: 'jauhista', means: 'jauheliha' }]);
  let seen;
  const r = await modelSaying((call) => { seen = call.user; return [add('jauho', 6)]; })({ text: '6 kg jauhista', draft, today: '2026-11-16' });
  assert.equal(r.ops[0].productTerm, 'jauheliha', 'malli luki jauhis-sanan jauhoksi');
  assert.match(seen, /"slang":\[\{"word":"jauhista","means":"jauheliha"\}\]/, 'mallille kerrotaan slangisanan merkitys');
  // Ostajan itse kirjoittama jauho säilyy samassa viestissä.
  const both = await modelSaying(() => [add('jauho', 2), add('jauheliha', 3)])({ text: '2 kg jauhoja ja 3 kg jauhista', draft, today: '2026-11-16' });
  // Pelkkä "jauho" on vehnäjauhoa (WhatsApp-koe 17.11.: ruis- ja ohrajauho tulivat ensin).
  assert.deepEqual(both.ops.map((o) => o.productTerm), ['vehnäjauho', 'jauheliha']);
  const plain = await modelSaying(() => [add('maito', 5)])({ text: '5 kg maitoa', draft, today: '2026-11-16' });
  assert.equal(plain.ops[0].productTerm, 'maito');
});

test('murre: räätikäsloora on lanttulaatikko ja räätikkä lanttu myös mallitulkissa', async () => {
  assert.deepEqual(await slangOf('5 kg räätikäslooraa jouluksi'), [{ word: 'räätikäslooraa', means: 'lanttulaatikko' }]);
  assert.deepEqual(await slangOf('3 kg räätikkää'), [{ word: 'räätikkää', means: 'lanttu' }]);
  let seen;
  const r = await modelSaying((call) => { seen = call.user; return [add('räätikäsloora', 5)]; })({ text: '5 kg räätikäslooraa jouluksi', draft, today: '2026-11-18' });
  assert.equal(r.ops[0].productTerm, 'lanttulaatikko', 'murresana jäi hakusanaksi');
  assert.match(seen, /"means":"lanttulaatikko"/, 'mallille kerrotaan murresanan merkitys');
});

test('A2 kyllä/ei-kysymykseen vastataan suoraan Valion tiedoista', { skip }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const reply = (id, q, kinds = ['allergens']) => factsReply([cat.get(id)], kinds, q);
  assert.match(await reply('463480', 'Onko HK Coleslaw 3 kg munaton?'), /\(tuotenro 463480\): Ei, tuote ei ole munaton: sisältää kananmunaa\./);
  assert.match(await reply('468319', 'Onko Oatly iKaffe 0,5L gluteeniton?', ['allergens', 'labels']), /: Ei, tuote ei ole gluteeniton: sisältää gluteeniviljoja \(kaura\)\./);
  assert.match(await reply('463480', 'Sisältääkö HK Coleslaw 3 kg sinappia?'), /: Kyllä, tuote sisältää sinappia\./);
  const kerma = [...cat.products].find((p) => p.hasAllergenData && p.labels?.includes('FREE_FROM_LACTOSE') && (p.contains || []).includes('AM'));
  assert.match(await factsReply([kerma], ['allergens', 'labels'], 'Onko tämä laktoositon?'), /: Kyllä, tuote on laktoositon: merkitty laktoosittomaksi\./);
  assert.match(await reply('460896', 'Onko APPELSIINI JAFFA suomalainen?', ['origin']), /: Ei, tuote ei ole suomalainen: alkuperämaa Israel\./);
  assert.match(await reply('460896', 'Onko APPELSIINI JAFFA munaton?'), /: En voi sanoa, onko tuote munaton: allergeenitieto puuttuu/);
  assert.doesNotMatch(await reply('463480', 'Mitä HK Coleslaw 3 kg sisältää?'), /\): (Kyllä|Ei)/, 'avoimeen kysymykseen ei kyllä/ei-vastausta');
  // Säilytys: vastaus nimeää ominaisuuden, eikä sulatetun tai avatun säilytykseen vastata (sitä ei ole Valion tiedoissa).
  assert.match(await reply('460896', 'Pitääkö APPELSIINI JAFFA laittaa pakkaseen?', ['storage']), /: Ei tarvitse pakastaa: lämpötilaluokka kuiva\./);
  assert.doesNotMatch(await reply('460896', 'Voiko APPELSIINI JAFFA säilyttää sulatettuna pakkasessa?', ['storage']), /\): (Kyllä|Ei)/);
  assert.match(await reply('468319', 'Sisältääkö Oatly iKaffe 0,5L maitoa?'), /: Ei, tuote ei sisällä maitoa: sitä ei ole merkitty tuotteen allergeeneihin\./);
});

test('A2 vain kysytty tuote: ei kysymättömiä tuotteita, ja tuntematon tuote ei löydy', { skip }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const product = (id) => cat.get(String(id)) || null;
  const ids = (o) => factProducts({ product, ...o }).map((p) => p.id);
  // HK Suomipekoni osuu vain merkkiin, ei kysyttyyn coleslawiin.
  const suomipekoni = cat.products.find((p) => /suomipekoni/i.test(p.name));
  assert.deepEqual(ids({ query: 'HK Coleslaw', message: 'Onko HK Coleslaw 3 kg munaton?', hits: [{ id: '463480' }, { id: suomipekoni.id }] }), ['463480']);
  // Gluteeniton-sana ei tee jauhoseoksesta kysyttyä tuotetta.
  const seos = cat.products.find((p) => /sunnuntai.*gluteeniton.*jauhoseos/i.test(p.name));
  assert.deepEqual(ids({ query: 'Oatly iKaffe gluteeniton', message: 'Onko Oatly iKaffe 0,5L gluteeniton?', hits: [{ id: seos.id }, { id: '468319' }] }), ['468319']);
  assert.deepEqual(ids({ query: 'kaurajuoma kahviin', message: 'Onko Barista Deluxe Kauramaito gluteeniton?', hits: [{ id: seos.id }] }), [], 'kysymätön tuote ei korvaa puuttuvaa');
  // Viestiin kirjoitettu tuotenimi on APPELSIINI JAFFA, ei Hartwall Jaffa -virvoitusjuoma.
  const named = await namedInMessage('Mistä maasta APPELSIINI JAFFA tulee?');
  assert.deepEqual(named.map((p) => p.id), ['460896']);
  assert.deepEqual(ids({ query: 'Jaffa', message: 'Mistä maasta APPELSIINI JAFFA tulee?', hits: [...named, { id: '476897' }] }), ['460896']);
});

test('A2 dialogi: pelkkä tuotetietokysymys ilman mallin irrallista avauslausetta, tuntematon tuote kerrotaan', { skip }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
  const { loadCatalog, publicProduct } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const suomipekoni = cat.products.find((p) => /suomipekoni/i.test(p.name));
  const make = (hits, lookupQuery) => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE members (binding TEXT PRIMARY KEY); CREATE TABLE turns (binding TEXT)');
    const d = createOrderingDialogue({ db, lookup: async () => hits, product: (id) => cat.get(String(id)) || null, timeOf: () => Date.parse('2026-11-15T12:00:00+02:00'),
      ask: async ({ purpose }) => (purpose === 'whatsapp_dialogue' ? { json: { route: 'chat', text: 'Katsotaan.', lookupQuery, suggestionTerm: '', openCart: false } }
        : { json: { text: 'Tarkista ne sieltä ennen ostopäätöstä.', suggestionTerm: '', addQuestion: '' } }) });
    return (text) => d.respond({ binding: 'b1', messageId: 'm1', text, runOrder: async () => { throw new Error('ei tilausmoottoria tuotekysymykseen'); }, getShoppingList: () => null });
  };
  const r = await make([publicProduct(cat.get('463480')), publicProduct(suomipekoni)], 'HK Coleslaw')('Onko HK Coleslaw 3 kg munaton?');
  assert.equal(r.messages.length, 1, r.messages.join(' | '));
  assert.match(r.messages[0], /HK Coleslaw 3 kg\* \(tuotenro 463480\): Ei, tuote ei ole munaton: sisältää kananmunaa\./);
  assert.doesNotMatch(r.text, /Suomipekoni|Tarkista ne sieltä/);
  const none = await make([publicProduct(suomipekoni)], 'Barista Deluxe kauramaito')('Onko Barista Deluxe kauramaito munaton?');
  assert.match(none.text, /En löytänyt Valion tuotetiedoista tuotetta/);
  assert.doesNotMatch(none.text, /Suomipekoni/);
});

test('A3 ja V019: allergeenikoodi ei näy ostajalle, eikä vertailu väitä tuntematonta arvoa samaksi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-haiku-a-conv-'));
  Object.assign(process.env, { AIMO_DB: path.join(dir, 'k.db'), GATEWAY_DB: path.join(dir, 'g.db'), VALIO_API_KEY: '', ANTHROPIC_API_KEY: '' });
  const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
  const { openDraftStore } = await import('../server/order-conversation/store.mjs');
  const t0 = Date.parse('2026-11-15T10:00:00+02:00');
  const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
  const data = [{ lineNet: 10, co2PerKg: 1.1 }, { lineNet: 12, co2PerKg: 1.1 }, { lineNet: 14, co2PerKg: null }];
  const tools = {
    suggest: async ({ draft }) => { const l = draft.lines[0]; return { issues: [], lines: [{ ref: l.ref, total: 3, more: false, exact: true, clarify: [],
      options: data.map((x, i) => ({ productId: `p${i + 1}`, name: `makaroni ${i + 1}`, salesUnits: 2, salesUnitLabel: 'pss', covers: l.quantity, labels: [], cutoff: null, ...x })) }] }; },
    quote: async () => ({ issues: [{ code: 'X', message: 'ei käytössä' }] }), submit: async () => ({ status: 'rejected', reasons: [] }),
  };
  const add = { intent: 'order', deliveryDate: '2026-11-18', ops: [{ op: 'add', productTerm: 'makaroni', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: ['AW', 'UW'] }] };
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => t0), tools, now: () => t0, interpretTurn: async ({ text }) => (text === 'co2' ? { intent: 'other', ops: [] } : add) });
  let n = 0;
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: t0 });
  const list = await say('5 kg makaronia ilman vehnää ja gluteenia keskiviikoks');
  assert.doesNotMatch(list.text, /\b(AW|UW)\b|ei allergeeneja/, list.text);
  assert.match(list.text, /ei gluteeniviljoja/);
  const co2 = await say('mikä on ympäristöystävällisin?');
  assert.match(co2.text, /3\) ei tietoa\. Arvo on sama niillä, joilta tieto löytyy\./, co2.text);
  fs.rmSync(dir, { recursive: true, force: true });
});
