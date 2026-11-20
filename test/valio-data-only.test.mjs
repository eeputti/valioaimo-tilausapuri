// Eelis 15.11.: kaikki asiakkaan näkemä tuotetieto tulee Valion datasta (katalogi ja Valion API). Malli saa vain muotoilla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { factKinds, factProducts, factsReply, withoutProductClaims, countryName } from '../server/whatsapp/product-facts.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { storefrontCartProjection } from '../server/storefront-whatsapp-sync.mjs';
import { isValioAsset, isValioProductImage } from '../server/image-cache.mjs';

// Katalogin kentät samassa muodossa kuin scripts/build-catalog.mjs ne tuottaa.
const KERMA = { id: '900001', name: 'Valio kuohukerma 1 l', contains: ['AM'], hasAllergenData: true, labels: ['FREE_FROM_LACTOSE'], country: 'fi', temp: 'chilled', ingredients: 'KERMA, stabilointiaine (karrageeni)' };
const PASTA = { id: '900002', name: 'Testi tagliatelle 6 kg', contains: ['AE', 'AW'], mayContain: ['AY'], hasAllergenData: true, labels: [], country: 'it', temp: 'ambient', ingredients: `durumVEHNÄJAUHO, KANANMUNA ${'x'.repeat(200)}` };
const TOMAATTI = { id: '900003', name: 'TOMAATTI 6 KG LTK', contains: [], hasAllergenData: false, country: undefined, temp: null };
const CATALOG = new Map([KERMA, PASTA, TOMAATTI].map((p) => [p.id, p]));
const product = (id) => CATALOG.get(String(id)) || null;

test('fact questions are recognised per kind; usage questions are not fact questions', () => {
  assert.deepEqual(factKinds('Onko Valion kuohukerma laktoositon?'), ['allergens', 'labels']);
  assert.deepEqual(factKinds('mistä maasta tää peruna on?'), ['origin']);
  assert.deepEqual(factKinds('miten kermaa säilytetään?'), ['storage']);
  assert.deepEqual(factKinds('mitä se sisältää?'), ['allergens', 'ingredients']);
  assert.deepEqual(factKinds('mihin käyttöön ruokakerma sopii?'), []);
  assert.deepEqual(factKinds('mitä kasviksia lohikeittoon?'), []);
});

test('the reply lists only catalogue fields and says when Valio data is missing', async () => {
  const text = await factsReply([KERMA], ['allergens', 'labels', 'ingredients', 'origin', 'storage']);
  assert.match(text, /^Valion tuotetiedoista:\n\*Valio kuohukerma 1 l\* \(tuotenro 900001\):/);
  assert.match(text, /- Allergeenit: maito\n/); assert.match(text, /- Merkinnät: laktoositon\n/);
  assert.match(text, /- Pääainesosat: KERMA, stabilointiaine \(karrageeni\)\n/); assert.match(text, /- Alkuperämaa: Suomi\n/);
  assert.match(text, /- Lämpötilaluokka: kylmä\. Tarkempaa säilytysohjetta ei ole Valion tuotetiedoissa/);
  const pasta = await factsReply([PASTA], ['allergens', 'ingredients', 'origin']);
  assert.match(pasta, /Allergeenit: kananmuna, gluteeniviljat\n- Voi sisältää: soija/);
  assert.match(pasta, /… \(lyhennetty\)/); assert.match(pasta, /Alkuperämaa: Italia/);
  const missing = await factsReply([TOMAATTI], ['allergens', 'ingredients', 'origin', 'storage', 'labels']);
  for (const row of ['Allergeenit: ei Valion tuotetiedoissa, tarkista pakkauksesta', 'Ainesosat: ei Valion tuotetiedoissa', 'Alkuperämaa: ei Valion tuotetiedoissa', 'Säilytys: ei Valion tuotetiedoissa', 'Merkinnät: ei merkintöjä']) {
    assert.ok(missing.includes(row), row);
  }
  assert.equal(countryName('zy'), 'maakoodi ZY'); assert.equal(countryName(''), null);
  assert.equal(await factsReply([], ['allergens']), null); assert.equal(await factsReply([KERMA], []), null);
});

test('a selected cart product is the subject of "onko se laktoositon?" before search hits', () => {
  const shoppingList = { lines: [{ ref: 'L1', productTerm: 'kerma', selectedProductId: '900001' }, { ref: 'L2', productTerm: 'pasta', selectedProductId: null }] };
  assert.deepEqual(factProducts({ query: '', hits: [{ id: '900002' }], shoppingList, product }).map((p) => p.id), ['900001', '900002']);
  assert.deepEqual(factProducts({ query: 'tagliatelle', hits: [{ id: '900002' }], shoppingList, product }).map((p) => p.id), ['900002']);
  // Hakuosuma luetaan katalogista, ei mallille annetusta kevennetystä kopiosta.
  assert.equal(factProducts({ query: 'kerma', hits: [{ id: '900001', name: 'muokattu' }], product })[0].ingredients, KERMA.ingredients);
});

test('model sentences that state allergens, origin, storage or ingredients are dropped; questions stay', () => {
  assert.equal(withoutProductClaims('Kuohukerma sopii vaahdotukseen. Se on laktoositonta ja suomalaista. Säilyy avattuna viikon.'), 'Kuohukerma sopii vaahdotukseen.');
  assert.equal(withoutProductClaims('Tarvitsetko laktoositonta vaihtoehtoa?'), 'Tarvitsetko laktoositonta vaihtoehtoa?');
  assert.equal(withoutProductClaims('Lohikeittoon sopii maustamaton ruokakerma.'), 'Lohikeittoon sopii maustamaton ruokakerma.');
});

function dialogue({ advice, lookup = async () => [{ id: '900001', name: 'Valio kuohukerma 1 l', contains: ['AM'] }], shoppingList = null }) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE members (binding TEXT PRIMARY KEY); CREATE TABLE turns (binding TEXT)');
  const seen = [];
  const ask = async ({ purpose, user }) => {
    seen.push({ purpose, user: JSON.parse(user) });
    if (purpose === 'whatsapp_dialogue') return { json: { route: 'chat', text: 'Valio kuohukerma on suomalaista ja laktoositonta.', lookupQuery: 'kuohukerma', suggestionTerm: '', openCart: false } };
    return { json: { text: advice, suggestionTerm: '', addQuestion: '' } };
  };
  const d = createOrderingDialogue({ db, ask, lookup, product, timeOf: () => Date.parse('2026-11-15T12:00:00+02:00') });
  let n = 0;
  const turn = (text) => d.respond({ binding: 'b1', messageId: `m${++n}`, text, runOrder: async () => { throw new Error('ei tilausmoottoria tuotekysymykseen'); }, getShoppingList: () => shoppingList });
  return { turn, seen };
}

test('a WhatsApp product question is answered from Valio data, never from product claims the model wrote', async () => {
  const f = dialogue({ advice: 'Kuohukerma sopii vaahdotukseen. Se on valmistettu suomalaisesta maidosta ja on gluteeniton.' });
  const reply = await f.turn('Onko Valion kuohukerma laktoositon ja mistä maasta se on?');
  // Pelkkä tuotetietokysymys: Valion tiedot ovat koko vastaus, ja kyllä/ei vastataan suoraan (Haiku-mittaus 16.11. A2).
  assert.equal(reply.messages.length, 1);
  assert.match(reply.messages[0], /\*Valio kuohukerma 1 l\* \(tuotenro 900001\): Kyllä, tuote on laktoositon: merkitty laktoosittomaksi\./);
  assert.match(reply.messages[0], /Allergeenit: maito/); assert.match(reply.messages[0], /Merkinnät: laktoositon/); assert.match(reply.messages[0], /Alkuperämaa: Suomi/);
  // Käyttötapakysymyksessä mallin neuvo jää tuotetietojen eteen.
  const usage = await dialogue({ advice: 'Kuohukerma sopii vaahdotukseen. Se on gluteeniton.' }).turn('Onko Valion kuohukerma laktoositon ja mihin se sopii?');
  assert.equal(usage.messages[0], 'Kuohukerma sopii vaahdotukseen.');
  assert.doesNotMatch(reply.text, /gluteeniton|valmistettu suomalaisesta/);
  // Neuvontamalli saa vain tuotteen nimen, ei allergeeni- tai merkintätietoja, joita se voisi muotoilla väärin.
  const facts = f.seen.find((x) => x.purpose === 'whatsapp_product_advice').user.facts;
  assert.deepEqual(facts, [{ name: 'Valio kuohukerma 1 l', brand: null, unitLabel: null }]);
});

test('a product missing from Valio data is reported missing instead of being described', async () => {
  const f = dialogue({ advice: 'Strutsinmunat ovat yleensä ulkomaisia ja säilyvät kylmässä.', lookup: async () => [] });
  const reply = await f.turn('Mistä maasta strutsinmuna on?');
  assert.match(reply.text, /En löytänyt Valion tuotetiedoista tuotetta haulla "kuohukerma"/);
  assert.doesNotMatch(reply.text, /ulkomaisia|säilyvät/);
});

test('the signed cart page projection carries only quote fields from Valio: name, price, VAT, unit and Valio comparison price', () => {
  const list = { id: 'd1', revision: 2, buyerId: 'b', companyName: 'Keittiö', deliveryDate: '2026-11-18', status: 'review' };
  const quote = { issues: [], lines: [
    { productId: '900001', name: 'Valio kuohukerma 1 l', salesUnits: 3, salesUnitLabel: 'kpl', unitPriceNet: 2.97, vatRate: 13.5, covers: { value: 3, unit: 'L' }, comparisonPrice: 2.97, comparisonUnit: 'L' },
    { productId: '900002', name: 'Testi tagliatelle 6 kg', salesUnits: 1, salesUnitLabel: 'ltk', unitPriceNet: 30.48, vatRate: null, covers: { value: 6, unit: 'KG' }, comparisonPrice: null, comparisonUnit: null },
  ] };
  const cart = storefrontCartProjection(list, quote);
  assert.deepEqual(cart.lines[0], { id: '900001', name: 'Valio kuohukerma 1 l', qty: 3, price: 2.97, vat: 13.5, taxUnknown: false, unit: 'kpl',
    requested: { value: 3, unit: 'L' }, image: '/img/900001', comparison: { value: 2.97, unit: 'L' } });
  assert.equal(cart.lines[1].comparison, null); assert.equal(cart.lines[1].taxUnknown, true);
});

test('only Valio photos of the same product are shown', () => {
  assert.ok(isValioProductImage({ file: '1.jpg', source: 'valioaimo.fi' }));
  assert.ok(isValioProductImage({ file: '1.jpg', source: 'valio.fi' }));
  for (const source of ['valioaimo.fi (lähin vastaava)', 'valio.fi (lähin vastaava)', 'Open Food Facts (CC BY-SA)', 'fixture', undefined]) assert.ok(!isValioProductImage({ file: '1.jpg', source }), source);
  assert.ok(!isValioProductImage({ miss: 1, source: 'valioaimo.fi' }));
  assert.ok(isValioAsset({ source: 'https://imgfly.scarabresearch.com/w_400/https://api.valioaimo.fi/medias/x.jpg' }));
  assert.ok(isValioAsset({ source: 'https://www.valio.fi/cdn-cgi/image/format=auto/https://cdn-wp.valio.fi/x.png' }));
  assert.ok(!isValioAsset({ source: 'https://cdn.s-cloud.fi/v1/x.webp' }));
  assert.ok(!isValioAsset({ source: 'https://imgfly.scarabresearch.com/w_400/https://evil.example/x.jpg' }));
});
