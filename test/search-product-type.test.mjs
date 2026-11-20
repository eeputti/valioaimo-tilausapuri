// Hakujärjestys: pyydetty tuotetyyppi ennen halvempaa väärää tuotetta (selfplay-100, koordinointitaulun viesti #152).
// Ei mallikutsuja eikä verkkoa: hinnat ja saatavuus simuloidaan (VALIO_API_KEY tyhjä), kannat ovat väliaikaisia.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-product-type-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { termTier, typeInfo, TIER } = await import('../server/aimo/match.mjs');
const { createOrderingTools, scoreOptions } = await import('../server/order-tools/index.mjs');

const tier = (name, term, extra = {}) => termTier({ name, brand: extra.brand }, { productTerm: term, ...extra.item });

test('nimen osuma erottaa tuotteen itsensä, saman pääsanan toisen tuotteen ja pelkän määritteen', () => {
  assert.equal(tier('VALKOSIPULI SOLO IRTO KIINA', 'valkosipuli'), TIER.LEAD);
  assert.equal(tier('HAPANKAALI 400G VALKOSIPULI', 'valkosipuli'), TIER.CORE, 'valkosipuli on hapankaalin maku');
  assert.equal(tier('Salliselta Valkosipuli-chili 450g', 'valkosipuli', { brand: 'Salliselta' }), TIER.PART);
  assert.equal(tier('Kalavapriikki lohifilee B-leikattu, ASC, n. 5 kg', 'lohi', { brand: 'Kalavapriikki' }), TIER.LEAD, 'lohi|filee on lohta');
  assert.equal(tier('Kalavapriikki Kirjolohifilee E-leikattu', 'lohi', { brand: 'Kalavapriikki' }), TIER.HEAD, 'kirjolohi on eri kala');
  assert.equal(tier('Gustodoro tomaattimurska 1kg', 'tomaatti', { brand: 'Gustodoro' }), TIER.PART);
  assert.equal(tier('6 x Saarioinen Spagettilihavuoka 350g', 'spagetti', { brand: 'Saarioinen' }), TIER.PART);
  assert.equal(tier('6x HK Lihaisa kinkkumakkara 250 g', 'kinkku', { brand: 'HK' }), TIER.PART);
  assert.equal(tier('Lagerblad Foods Kikherne-porkkanapihvi 50 g', 'herne', { brand: 'Lagerblad Foods' }), TIER.PART, 'väliviivayhdyssanan pääsana on viimeisenä');
  assert.equal(tier('+ GREENS 2,5KG HERNE', 'herne'), TIER.CORE);
  assert.equal(tier('Apetit Kotimainen Herne pakaste 200g', 'herne', { brand: 'Apetit' }), TIER.LEAD);
  assert.equal(tier('MAISSINJYVÄT 2,5KG PAKASTE', 'maissi'), TIER.LEAD, 'maissi|n|jyvät on maissia');
  assert.equal(tier('HK Perunasalaatti 3 kg', 'salaatti', { brand: 'HK' }), TIER.HEAD);
  // Merkkikenttä voi olla koko nimi: silloin sitä ei ohiteta.
  assert.equal(tier('Tuorehiiva 1 kg leivinhiiva', 'hiiva', { brand: 'Tuorehiiva 1 kg leivinhiiva', item: { attributes: { state: 'fresh' } } }), TIER.LEAD);
  assert.equal(tier('Salliselta kuivahiiva kahvileivälle 500g', 'hiiva', { brand: 'Salliselta' }), TIER.HEAD);
  // Hyllyhaku: "kana" on nimissä broileria tai kananpoikaa.
  assert.equal(tier('Happy Chef Broilerin rintafilee', 'kana', { brand: 'Happy Chef', item: { shelf: { names: ['broiler', 'kananpo', 'kana'] } } }), TIER.LEAD);
  assert.equal(tier('Jalostaja Stroganoff 400 g', 'kanafile', { brand: 'Jalostaja' }), TIER.NONE);
});

test('tyyppiryhmä: raaka-aine ennen valmistetta, lajike samassa ryhmässä, hyllysanan ja tilan lajike omassa', () => {
  const key = (p, item) => typeInfo(p, { productTerm: item.term, attributes: item.attributes || {}, shelf: item.shelf, categories: item.categories, productType: item.productType });
  const fresh = key({ name: 'TOMAATTI 1LK SUOMI', category: '17401' }, { term: 'tomaatti' });
  const canned = key({ name: 'BRAVO CHEF 2,5KG MURSKATTU TOMAATTI', category: '21590' }, { term: 'tomaatti' });
  assert.ok(fresh.key[1] < canned.key[1], 'tuore tomaatti ennen säilykettä');
  assert.deepEqual(key({ name: 'Valio luonnonjogurtti 1 kg', category: '10412' }, { term: 'jogurtti' }).key, key({ name: 'Arla jogurtti 5 kg', category: '10412' }, { term: 'jogurtti' }).key, 'luonnonjogurtti on jogurttia');
  const shelf = { names: ['lohi', 'lohta', 'lohesta'] };
  const lohi = key({ name: 'Kalavapriikki lohifilee', brand: 'Kalavapriikki', category: '18701' }, { term: 'lohi', shelf, categories: ['18701'] });
  const kirjolohi = key({ name: 'Kalavapriikki Kirjolohifilee', brand: 'Kalavapriikki', category: '18701' }, { term: 'lohi', shelf, categories: ['18701'] });
  assert.ok(lohi.requested && !kirjolohi.requested && lohi.key[2] < kirjolohi.key[2]);
  const kuiva = key({ name: 'Salliselta kuivahiiva', brand: 'Salliselta', category: '22660' }, { term: 'hiiva', attributes: { state: 'fresh' } });
  assert.equal(kuiva.requested, false, 'tuorehiivaa pyydettäessä kuivahiiva ei ole pyydetty tuote');
  // Kuratoitu tuotetyyppi pitää aiemman järjestyksen: avain on aina sama.
  assert.deepEqual(key({ name: 'Arla Kevytmaitojuoma', category: '10400' }, { term: 'maito', productType: 'milk' }), { key: [0, 0, 0], tier: null, requested: null });
});

test('tilausapuri järjestää haun tyyppiryhmän mukaan eikä nosta halvempaa väärää tai maustettua tuotetta', async () => {
  const opt = (id, name, price, extra = {}) => ({ id, name, brand: null, unit: 'ST', unitLabel: 'kpl', kg: 1, qty: 3, price, labels: [], typeRank: 0, match: 0, requested: true, ...extra });
  const found = [
    opt('a', 'HK Perunasalaatti 3 kg', 1.0, { typeRank: 1, match: 2, requested: false }),
    opt('c', 'LEHTISALAATTI SUOMI', 11, { match: 2 }),
    opt('b', 'SALAATTI MIX SUOMI PESTY', 12),
    opt('d', 'ROMAINE SALAATTI SUOMI', 13, { match: 1 }),
  ];
  const tools = createOrderingTools({ search: async () => found, product: () => ({ hasAllergenData: true, contains: [] }), buyer: () => ({}), requestQuote: async () => ({}), placeOrder: async () => ({}) });
  const customer = { customerId: 'c', buyerId: 'b', bindingVersion: 1, permissions: { readProducts: true } };
  const draft = { id: 'd', deliveryDate: '2026-11-17', diet: { known: true, claims: [], excludeAllergens: [] }, lines: [{ ref: 'L1', productTerm: 'salaatti', quantity: { value: 3, unit: 'KG' }, claims: [], excludeAllergens: [] }] };
  const page = (await tools.suggest({ customer, draft })).lines[0];
  assert.deepEqual(page.options.map((o) => o.productId), ['c', 'b', 'd'], 'halvin perunasalaatti ei nouse lehtisalaattien edelle');
  assert.equal(page.more, true, 'perunasalaatti jää Näytä lisää -sivulle');
  const next = (await tools.suggest({ customer, draft, exclude: { L1: ['b', 'c', 'd'] } })).lines[0];
  assert.deepEqual(next.options.map((o) => o.productId), ['a']);
  // Pelkkä saman pääsanan eri tuote (kirjolohi lohen sijaan) ei ole tarkka osuma: ostajalle kerrotaan se.
  const trout = createOrderingTools({ search: async () => [opt('k', 'Kalavapriikki Kirjolohifilee', 98, { match: 2, requested: false })], product: () => ({ hasAllergenData: true, contains: [] }), buyer: () => ({}), requestQuote: async () => ({}), placeOrder: async () => ({}) });
  assert.equal((await trout.suggest({ customer, draft: { ...draft, lines: [{ ...draft.lines[0], productTerm: 'lohi', quantity: { value: 5, unit: 'KG' } }] } })).lines[0].exact, false);

  // Makusana nimen lopussa: "HAPANKAALI 400G VALKOSIPULI" ei ole valkosipulia, vaikka se on halvempi ja tarkka määrä.
  const garlic = scoreOptions([
    opt('h', 'HAPANKAALI 400G VALKOSIPULI', 0.4, { match: 1 }), opt('s', 'VALKOSIPULI SOLO IRTO KIINA', 1.02, { unit: 'KG', qty: 1 }),
  ], { productTerm: 'valkosipuli', quantity: { value: 1, unit: 'KG' } });
  assert.deepEqual(garlic.map((x) => x.o.id), ['s', 'h']);
  assert.equal(garlic[1].regular, false);

  // Irtokilot eivät ole "kymmeniä pikkupakkauksia", ja kilotarpeessa tuntematon määrä (sipulinippu) jää tunnetun jälkeen.
  const loose = scoreOptions([
    opt('p9', 'PERUNA 900G PUSSI', 15.3, { qty: 20, kg: 0.9 }), opt('pk', 'UUNIPERUNA PESTY', 14.9, { unit: 'KG', qty: 18 }),
  ], { productTerm: 'peruna', quantity: { value: 18, unit: 'KG' } });
  assert.equal(loose[0].o.id, 'pk', '18 kg irtoperunaa on yksi toimitus, 20 pussia ei');
  const onion = scoreOptions([
    opt('n', 'SIPULI NIPPU SUOMI', 1.78, { kg: null, qty: 2 }), opt('p', 'SIPULI 1KG PUSSI HOLLANTI', 1.94, { qty: 2 }),
  ], { productTerm: 'sipuli', quantity: { value: 2, unit: 'KG' } });
  assert.deepEqual(onion.map((x) => [x.o.id, x.known]), [['p', true], ['n', false]]);
});

test('kanafilee on broilerin fileetä myös taivutettuna', { skip: !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu' }, async () => {
  process.env.AIMO_CATALOG = CATALOG;
  const { understand } = await import('../server/aimo/understand.mjs');
  for (const text of ['5 kg kanafilee', '5 kg kanafileetä']) {
    const item = understand(text).items[0];
    assert.deepEqual(item.shelf, { names: ['broiler', 'kananpo', 'kana'], must: ['file'] }, text);
    assert.deepEqual(item.categories, ['18750', '41710']);
  }
});

test('selfplay-100:n hakulöydökset: pyydetty raaka-aine kärjessä tai kerrotaan, ettei sitä ole', { skip: !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu' }, async () => {
  process.env.AIMO_CATALOG = CATALOG;
  const tools = createOrderingTools();
  const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 1, permissions: { readProducts: true } };
  const suggest = async (term, value, unit) => (await tools.suggest({ customer, draft: { id: 'd', deliveryDate: '2026-11-17', diet: { known: true, claims: [], excludeAllergens: [] },
    lines: [{ ref: 'L1', productTerm: term, quantity: { value, unit }, claims: [], excludeAllergens: [] }] } })).lines[0];
  const names = (line) => line.options.map((o) => o.name);
  const check = async (term, value, unit, ok, bad) => {
    const line = await suggest(term, value, unit);
    assert.ok(line?.options.length, `${term}: vaihtoehtoja`);
    assert.equal(line.exact, true, `${term}: pyydetty tuote löytyi`);
    for (const n of names(line)) {
      assert.match(n, ok, `${term}: ${n}`);
      if (bad) assert.doesNotMatch(n, bad, `${term}: ${n}`);
    }
    return line;
  };
  await check('kanafilee', 5, 'KG', /(broiler|kanan|kananpo).*file/i, /stroganoff|keitto|kastike|confit|ankka/i);
  await check('valkosipuli', 1, 'KG', /valkosipul/i, /hapankaali|-chili/i);
  await check('herne', 5, 'KG', /herne/i, /kikherne|pihvi|proteiini|-/i);
  await check('salaatti', 3, 'KG', /salaatti/i, /perunasalaatti|pastasalaatti|kanasalaatti|coleslaw|mexico|grilli/i);
  await check('tomaatti', 5, 'KG', /tomaatti/i, /murska|pyree|passata|paseer|kuivattu|murskattu/i);
  await check('spagetti', 5, 'KG', /spagetti/i, /lihavuoka|bolognese/i);
  await check('kinkku', 3, 'KG', /kinkku/i, /makkara/i);
  await check('lohi', 5, 'KG', /lohi/i, /kirjolohi/i);
  await check('peruna', 18, 'KG', /peruna/i, /kypsä|suikale/i);
  const yeast = await check('tuorehiiva', 1, 'KG', /tuorehiiva/i);
  // Tuoreen tilan pyyntö rajaa säilyvät kuiva-aineet pois: kuivahiivaa ei tarjota tuorehiivan tilalle edes lisäsivulla.
  if (yeast.more) {
    const next = await tools.suggest({ customer, draft: { id: 'd', deliveryDate: '2026-11-17', diet: { known: true, claims: [], excludeAllergens: [] },
      lines: [{ ref: 'L1', productTerm: 'tuorehiiva', quantity: { value: 1, unit: 'KG' }, claims: [], excludeAllergens: [] }] }, exclude: { L1: yeast.options.map((o) => o.productId) } });
    for (const o of next.lines[0]?.options || []) assert.doesNotMatch(o.name, /kuivahiiva/i);
  }
  const onion = await check('sipuli', 2, 'KG', /sipuli/i);
  assert.equal(onion.options[0].covers?.unit, 'KG', 'ensimmäinen sipulivaihtoehto kattaa kilomäärän');
  assert.ok(onion.options[0].covers.value >= 2);
  // Olemattomat tai arvatut tuotteet: lähimmät vaihtoehdot näytetään, mutta niitä ei esitetä pyydettynä tuotteena.
  for (const [term, value, unit] of [['kuukivijogurtti', 5, 'KG'], ['strutsinmuna', 10, 'PCS'], ['kamelinmaito', 5, 'L']]) assert.equal((await suggest(term, value, unit))?.exact, false, term);
});

test('vaihtoehto kertoo tilausaikarajan, ja tyhjä tulos aikaisimman tunnetun toimituspäivän', async () => {
  const { orderableProduct } = await import('../server/storefront.mjs');
  const p = { id: 'k', name: 'Kerma', salesUnit: 'ST', litres: 1, lot: 0.01 };
  const quote = { avail: { status: 'ok', date: '2026-11-16', amount: 100, closingTime: '2026-11-15T12:00:00' }, price: { net: 2, vatRate: 13.5 } };
  assert.equal(orderableProduct(p, quote, '2026-11-16', { value: 5, unit: 'L' }).product.availability.closingTime, '2026-11-15T12:00:00');
  assert.equal(orderableProduct(p, { ...quote, avail: { ...quote.avail, closingTime: undefined } }, '2026-11-16', { value: 5, unit: 'L' }).product.availability.closingTime, null);

  const option = { id: 'k', name: 'Kerma 1 l', unit: 'ST', unitLabel: 'kpl', litres: 1, qty: 5, price: 2, labels: [], availability: { deliveryDate: '2026-11-16', closingTime: '2026-11-15T12:00:00' } };
  let found = [option];
  const tools = createOrderingTools({ search: async () => found, product: () => ({ hasAllergenData: true, contains: [] }), buyer: () => ({}), requestQuote: async () => ({}), placeOrder: async () => ({}) });
  const customer = { customerId: 'c', buyerId: 'b', bindingVersion: 1, permissions: { readProducts: true } };
  const draft = { id: 'd', deliveryDate: '2026-11-16', diet: { known: true, claims: [], excludeAllergens: [] }, lines: [{ ref: 'L1', productTerm: 'kerma', quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: [] }] };
  assert.equal((await tools.suggest({ customer, draft })).lines[0].options[0].cutoff, '2026-11-15T12:00:00');
  found = Object.assign([], { nextDeliveryDate: '2026-11-18' });
  assert.deepEqual((await tools.suggest({ customer, draft })).issues.map((x) => [x.code, x.nextDeliveryDate]), [['NO_ORDERABLE_PRODUCT', '2026-11-18']]);
  found = [];
  assert.equal((await tools.suggest({ customer, draft })).issues[0].nextDeliveryDate, null, 'ilman tietoa päivää ei arvata');
});

test('oikean haun vaihtoehdoissa on tilausaikaraja', { skip: !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu' }, async () => {
  process.env.AIMO_CATALOG = CATALOG;
  const tools = createOrderingTools();
  const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 1, permissions: { readProducts: true } };
  const r = await tools.suggest({ customer, draft: { id: 'd', deliveryDate: '2026-11-17', diet: { known: true, claims: [], excludeAllergens: [] },
    lines: [{ ref: 'L1', productTerm: 'kerma', quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: [] }] } });
  assert.ok(r.lines[0].options.length);
  for (const o of r.lines[0].options) assert.match(o.cutoff, /^2026-11-1[56]T\d{2}:\d{2}/, o.name);
});

test('200 asiakkaan hakulöydökset: edam-juusto, maidoton vaniljajäätelö, tuore tryffeli ja sokerin lava', { skip: !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu' }, async () => {
  process.env.AIMO_CATALOG = CATALOG;
  const { loadCatalog } = await import('../server/catalog.mjs');
  const { understand } = await import('../server/aimo/understand.mjs');
  const tools = createOrderingTools();
  const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 1, permissions: { readProducts: true } };
  const run = (term, value, unit, extra = {}, date = '2026-11-18') => tools.suggest({ customer, draft: { id: 'd', deliveryDate: date, diet: { known: true, claims: [], excludeAllergens: [] },
    lines: [{ ref: 'L1', productTerm: term, quantity: { value, unit }, claims: [], excludeAllergens: [], ...extra }] } });

  // S031/R01: yhdysmerkkisana on kaksi sanaa, eikä "edam" katoa. Ennen: saganaki, halloumi ja salaattijuusto.
  assert.equal(understand('5 kg edam-juusto').items[0].productTerm, 'edam juusto');
  const edam = (await run('edam-juusto', 5, 'KG')).lines[0];
  assert.ok(edam.options.length && edam.exact);
  for (const o of edam.options) { assert.match(o.name, /edam/i); assert.doesNotMatch(o.name, /saganaki|halloumi|salaattijuusto/i); }

  // S048/R02: maidoton vaniljajäätelö löytyy myös nimestä "jäätelö Vanilja", ja vain tuotteet, joiden allergeenitieto
  // todistaa maidottomuuden. Ennen: ei yhtään vaihtoehtoa.
  const cat = loadCatalog();
  const vanilla = await run('vaniljajäätelö', 5, 'L', { excludeAllergens: ['AM'] }, '2026-11-20');
  const v = vanilla.lines[0];
  assert.ok(v?.options.length, JSON.stringify(vanilla.issues));
  assert.equal(v.exact, true, 'vegaaninen vaniljajäätelö on pyydetty tuote');
  for (const o of v.options) {
    const p = cat.get(o.productId);
    assert.match(o.name, /vanilj/i); assert.match(o.name, /jäätelö/i);
    assert.ok(p.hasAllergenData && !p.contains.includes('AM') && !(p.mayContain || []).includes('AM'), o.name);
  }

  // S056: tuoreiden tryffeleiden tilalle ei tarjota suklaapatukkaa, vaan kerrotaan, ettei tuotetta ole valikoimassa.
  const truffle = await run('Tuore tryffeli', 1, 'KG', {}, '2026-11-16');
  assert.equal(truffle.lines.length, 0);
  assert.deepEqual(truffle.issues.map((x) => [x.code, x.notInCatalog]), [['NO_ORDERABLE_PRODUCT', true]]);
  assert.match(truffle.issues[0].message, /Pyydettyä tuotetta ei ole valikoimassa: Tuore tryffeli/);
  // Tuore yrtti on tuore puntti, ei kuivattu mauste.
  for (const o of (await run('tuore tilli', 1, 'KG')).lines[0].options) assert.notEqual(cat.get(o.productId).temp, 'ambient', o.name);

  // X096: "325 x Dansukker Taloussokeri 1kg" on 325 kg:n lava, eikä se tule 3 kg:n tarpeen ensimmäiselle sivulle.
  const pallet = cat.products.find((p) => p.salesUnit === 'PAL' && /^325 x .*Taloussokeri/.test(p.name));
  assert.equal(pallet?.kg, 325);
  const sugar = (await run('sokeri', 3, 'KG')).lines[0];
  assert.ok(sugar.options.length);
  for (const o of sugar.options) { assert.notEqual(o.salesUnitLabel, 'lava', o.name); assert.ok(o.covers.value >= 3 && o.covers.value <= 12, `${o.name} ${o.covers.value}`); }
});

test('liian suuri erä jää tarpeen kattavien pienten pakkausten jälkeen ja pois ensimmäiseltä sivulta', async () => {
  const opt = (id, name, price, extra = {}) => ({ id, name, brand: null, unit: 'ST', unitLabel: 'kpl', kg: 1, qty: 3, price, labels: [], typeRank: 0, match: 0, requested: true, ...extra });
  const found = [
    opt('lava', '325 x Taloussokeri 1kg', 300, { unit: 'PAL', unitLabel: 'lava', kg: 325, qty: 1 }),
    opt('sakki', 'Kidesokeri 25kg', 30, { kg: 25, qty: 1, unitLabel: 'sk' }),
    opt('pussi', 'Sokeri 1kg', 1, { unitLabel: 'pss' }),
    opt('rasia', 'Sokeri 500g', 0.6, { kg: 0.5, qty: 6 }),
  ];
  const scored = scoreOptions(found, { productTerm: 'sokeri', quantity: { value: 3, unit: 'KG' } });
  assert.deepEqual(scored.map((x) => [x.o.id, x.oversize]), [['pussi', false], ['rasia', false], ['sakki', true], ['lava', true]]);
  const tools = createOrderingTools({ search: async () => found, product: () => ({ hasAllergenData: true, contains: [] }), buyer: () => ({}), requestQuote: async () => ({}), placeOrder: async () => ({}) });
  const customer = { customerId: 'c', buyerId: 'b', bindingVersion: 1, permissions: { readProducts: true } };
  const line = (await tools.suggest({ customer, draft: { id: 'd', deliveryDate: '2026-11-17', diet: { known: true, claims: [], excludeAllergens: [] },
    lines: [{ ref: 'L1', productTerm: 'sokeri', quantity: { value: 3, unit: 'KG' }, claims: [], excludeAllergens: [] }] } })).lines[0];
  assert.deepEqual(line.options.map((o) => o.productId), ['pussi', 'rasia']);
  assert.equal(line.more, true, 'säkki ja lava ovat tarjolla lisäsivulla');
});

test('yhdyssana erillisinä sanoina on pyydetty tuote kokonaisen nimen jälkeen', () => {
  const item = { productTerm: 'vaniljajäätelö', compounds: { vaniljajäätelö: ['vanilja', 'jäätelö'] } };
  assert.equal(termTier({ name: 'Suomen Jäätelö Vaniljajäätelö 5l', brand: 'Suomen Jäätelö' }, item), TIER.LEAD);
  assert.equal(termTier({ name: 'GelatoLAB-Espoo 5L jäätelö Vanilja Premium vegaaninen', brand: 'GelatoLAB-Espoo' }, item), TIER.SPLIT);
  assert.equal(termTier({ name: 'Kymppi Vanilja kerrosmämmi 130 g', brand: 'Kymppi' }, item), TIER.NONE);
  const info = typeInfo({ name: 'GelatoLAB-Espoo 5L jäätelö Vanilja', category: '41820' }, item);
  assert.equal(info.requested, true);
  assert.ok(info.key[2] > typeInfo({ name: 'Suomen Jäätelö Vaniljajäätelö 5l', category: '41820' }, item).key[2]);
  // Lyhyt osa ei osu toisen sanan keskelle: "kana" ei ole porkkanasosekeitossa.
  assert.equal(termTier({ name: 'Feelia Porkkanasosekeitto 3kg' }, { productTerm: 'kanakeitto', compounds: { kanakeitto: ['kana', 'keitto'] } }), TIER.NONE);
});
