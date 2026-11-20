// Katselmuksen 15.11. löydökset #2–#5, #17, #19 ja #22 (docs/parallel/code-audit-2026-11-15-ilta.md, korjaukset docs/parallel/audit-fixes-a.md).
// Oikea katalogi, ei mallikutsuja eikä verkkoa: hinnat ja saatavuus simuloidaan (VALIO_API_KEY tyhjä), kannat ovat väliaikaisia.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const hasCatalog = fs.existsSync(CATALOG);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-audit-a-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_LOOP_MINUTES: '', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const skip = hasCatalog ? false : 'data/catalog.json puuttuu (rajoitettu aineisto)';

const { bannedHits, allergenStatus, touchesBanned } = await import('../server/allergens.mjs');
const { understand } = await import('../server/aimo/understand.mjs');
const { itemsPerSalesUnit } = await import('../server/itemQuantities.mjs');
const { lineQuery, createOrderingTools } = await import('../server/order-tools/index.mjs');

// Katalogin tuotteet (tunnisteet tarkistettu 16.11. katalogista):
const ALMOND_DRINK = '460443'; // Alpro mantelijuoma: contains SA, mayContain AN, ei yleiskoodia AN
const DAIM = '460835'; // Daim suklaapatukka: contains AM, AY, SA
const SOY_SAUCE = '460082'; // Kikkoman soijakastike: contains AY, UW, ei AW:tä
const SOY_SNACK = '460005'; // Alpro soijavalmiste: contains AY, mayContain AN
const NO_DATA = '460002'; // Puljonki luumutomaattikastike: allergeenitieto puuttuu
const CLEAN = '461246'; // ranskanperunat: allergeenitieto on, ei allergeeneja

test('#2 allergeenihierarkia: pähkinän ja viljan alakoodi osuu yleiskoodin kieltoon ja päinvastoin', () => {
  assert.deepEqual(bannedHits(['AN'], ['SA']), ['AN'], 'manteli on pähkinä');
  assert.deepEqual(bannedHits(['AN'], ['AM', 'AY', 'SA']), ['AN']);
  assert.deepEqual(bannedHits(['AW'], ['AY', 'UW']), ['AW'], 'vehnä on gluteeniviljaa');
  assert.deepEqual(bannedHits(['AW'], ['GO']), ['AW'], 'kaura kuuluu gluteeniviljoihin');
  assert.deepEqual(bannedHits(['AM'], ['ML']), ['AM'], 'laktoosi on maidosta');
  assert.deepEqual(bannedHits(['SA'], ['AN']), ['SA'], 'tarkentamaton pähkinä voi olla mantelia');
  assert.deepEqual(bannedHits(['SA'], ['AN', 'SH']), [], 'hasselpähkinäksi tarkennettu ei ole mantelia');
  assert.deepEqual(bannedHits(['UW'], ['AW']), ['UW'], 'tarkentamaton gluteenivilja voi olla vehnää');
  assert.deepEqual(bannedHits(['AN'], ['AP']), [], 'maapähkinä on oma allergeeninsa');
  assert.deepEqual(bannedHits(['ML'], ['AM'], { labels: ['FREE_FROM_LACTOSE'] }), [], 'laktoositon maitotuote ei ole laktoosia');
  assert.deepEqual(bannedHits(['ML'], ['AM']), ['ML']);
  assert.deepEqual(allergenStatus(['AN'], { hasAllergenData: true, contains: ['AY'], mayContain: ['SH'] }), { contains: [], mayContain: ['AN'], unknown: false });
  assert.deepEqual(allergenStatus(['AN'], { hasAllergenData: false, contains: [] }), { contains: [], mayContain: [], unknown: true });
});

test('#2 ja #4 mandaatti: alakoodi on este, "voi sisältää" ja puuttuva tieto vievät ihmisen hyväksyntään', { skip }, async () => {
  const { evaluateMandate, DEFAULT_MANDATE } = await import('../server/gateway/mandate.mjs');
  const buyer = (bannedAllergens) => ({ id: 'audit-a', mandate: { ...DEFAULT_MANDATE, approval: 'autonomous', bannedAllergens } });
  const draft = (productId) => ({ lines: [{ productId }], totals: { net: 10 }, deliveryDate: '2026-11-16', substitutions: [] });
  const almond = evaluateMandate(buyer(['AN']), draft(ALMOND_DRINK));
  assert.equal(almond.status, 'rejected', 'mantelijuoma vahvistui pähkinäkiellolla');
  assert.equal(almond.reasons[0].code, 'ALLERGEN_BANNED');
  assert.equal(evaluateMandate(buyer(['AN']), draft(DAIM)).status, 'rejected');
  assert.equal(evaluateMandate(buyer(['AW']), draft(SOY_SAUCE)).status, 'rejected', 'vehnä gluteeniviljakiellolla');
  const may = evaluateMandate(buyer(['AN']), draft(SOY_SNACK));
  assert.equal(may.status, 'pending_approval', 'voi sisältää pähkinää ei saa vahvistua itsestään');
  assert.ok(may.reasons.some((r) => r.code === 'ALLERGEN_MAY_CONTAIN' && r.severity === 'approval'));
  const unknown = evaluateMandate(buyer(['AN']), draft(NO_DATA));
  assert.equal(unknown.status, 'pending_approval', 'puuttuva allergeenitieto ei ole todiste sopivuudesta');
  assert.ok(unknown.reasons.some((r) => r.code === 'ALLERGEN_DATA_MISSING'));
  assert.equal(evaluateMandate(buyer(['AN']), draft(CLEAN)).status, 'confirmed', 'tunnettu ja puhdas tuote vahvistuu');
  assert.equal(evaluateMandate(buyer([]), draft(NO_DATA)).status, 'confirmed', 'ilman kieltoa puuttuva tieto ei haittaa');
});

test('#2 portin haku ei ehdota kiellon alakoodia sisältäviä eikä hakusuodatin "voi sisältää" -tuotteita', { skip }, async () => {
  const { searchProducts } = await import('../server/gateway/service.mjs');
  const { DEFAULT_MANDATE } = await import('../server/gateway/mandate.mjs');
  const { loadCatalog } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const banned = { id: 'audit-a-search', mandate: { ...DEFAULT_MANDATE, bannedAllergens: ['AN'] } };
  const ids = (r) => r.items.map((p) => p.productId);
  for (const q of ['mantelijuoma', 'suklaapatukka', 'toblerone']) {
    const r = searchProducts(banned, { query: q, limit: 60 });
    for (const id of ids(r)) assert.equal(bannedHits(['AN'], cat.get(id).contains).length, 0, `${q}: ${cat.get(id).name}`);
  }
  const open = { id: 'audit-a-open', mandate: { ...DEFAULT_MANDATE } };
  const filtered = searchProducts(open, { query: 'suklaapatukka', excludeAllergens: ['AN'], limit: 60 });
  assert.ok(filtered.items.length > 0);
  for (const id of ids(filtered)) assert.equal(touchesBanned(['AN'], cat.get(id)), false, cat.get(id).name);
});

test('#2 tulkinta ja kohdistus: pähkinätön suklaa ei tarjoa mantelia sisältäviä (Toblerone, Daim)', { skip }, async () => {
  const { resolveItem } = await import('../server/aimo/resolve.mjs');
  const { loadCatalog } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const u = understand('pähkinätöntä suklaata 2 kg');
  assert.ok(u.items[0].excludeAllergens.includes('AN'));
  const r = resolveItem(u.items[0], { limit: 200 });
  assert.ok(r.candidates.length > 0);
  for (const c of r.candidates) assert.equal(touchesBanned(['AN'], cat.get(c.id)), false, c.name);
});

test('#2 WhatsAppin numeroitu vaihtoehtolista ja tarjous pitävät pähkinäkiellon alakoodeille', { skip }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', permissions: { readProducts: true, placeOrders: true } };
  const opt = (id) => ({ id, name: cat.get(id).name, qty: 2, unitLabel: 'kpl', kg: 1, price: 3, labels: cat.get(id).labels || [], availability: { deliveryDate: '2026-11-16', stock: 50 } });
  let quoted = 0;
  const tools = createOrderingTools({ product: (id) => cat.get(String(id)), buyer: (id) => ({ id }), placeOrder: async () => ({}),
    search: async () => [opt(DAIM), opt(ALMOND_DRINK), opt(SOY_SNACK), opt(CLEAN)], requestQuote: async () => { quoted += 1; return { needs: [] }; } });
  const line = { ref: 'L1', productTerm: 'suklaa', quantity: { value: 2, unit: 'KG' }, claims: [], excludeAllergens: [] };
  const draft = { id: 'd1', revision: 1, deliveryDate: '2026-11-16', lines: [line], diet: { known: true, claims: [], excludeAllergens: ['AN'] } };
  const s = await tools.suggest({ customer, draft });
  assert.deepEqual(s.lines[0].options.map((o) => o.productId), [CLEAN], 'koko tilauksen pähkinäkielto');
  const strict = await tools.suggest({ customer, draft: { ...draft, diet: { known: true, claims: [], excludeAllergens: [] }, lines: [{ ...line, excludeAllergens: ['AN'] }] } });
  assert.deepEqual(strict.lines[0].options.map((o) => o.productId), [CLEAN], 'rivin oma pähkinäkielto');
  const q = await tools.quote({ customer, draft: { ...draft, lines: [{ ...line, selectedProductId: DAIM }] } });
  assert.equal(q.issues[0].code, 'ALLERGEN_CONFLICT');
  assert.equal(quoted, 0, 'kiellettyä tuotetta ei edes hinnoitella');
});

test('#3 maapähkinä tunnistetaan ennen yleistä pähkinää, ja erillinen kielto koskee edellistä riviä', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  const peanut = understand('maapähkinätöntä suklaata 2 kg').items[0];
  assert.deepEqual(peanut.excludeAllergens, ['AP'], 'maapähkinätön on maapähkinätön, ei pähkinätön');
  assert.ok(understand('suklaata 2 kg ilman maapähkinää').items[0].excludeAllergens.includes('AP'));
  const separate = understand('suklaata 2 kg, ei maapähkinöitä');
  assert.equal(separate.items.length, 1);
  assert.ok(separate.items[0].excludeAllergens.includes('AP'), 'erillinen "ei maapähkinöitä" katosi');
  assert.ok(understand('peanut-free chocolate 2 kg').items[0].excludeAllergens.includes('AP'));
  const nut = understand('pähkinätöntä suklaata 2 kg').items[0];
  assert.ok(nut.excludeAllergens.includes('AN'));
});

test('#5 desimaalipilkku: 0,125 kg on 0,125 kg eikä 125 kg, myös hakulauseen muotoilun jälkeen', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  const kg = (text) => understand(text).items[0].quantity;
  assert.deepEqual(kg('0,125 kg voita'), { value: 0.125, unit: 'KG' });
  assert.deepEqual(kg('0,750 kg voita'), { value: 0.75, unit: 'KG' });
  assert.deepEqual(kg('1,250 kg voita'), { value: 1.25, unit: 'KG' }, 'suomeksi pilkku on desimaali');
  assert.deepEqual(kg('2,5 l kermaa'), { value: 2.5, unit: 'L' });
  assert.deepEqual(kg('1.000 l maitoa'), { value: 1000, unit: 'L' }, 'piste ja kolme numeroa on tuhaterotin');
  assert.deepEqual(kg('1 000 l maitoa'), { value: 1000, unit: 'L' });
  assert.deepEqual(understand('I need 1,000 litres of lactose-free milk by Monday.').items[0].quantity, { value: 1000, unit: 'L' }, 'englannissa pilkku on tuhaterotin');
  for (const q of [{ value: 0.125, unit: 'KG' }, { value: 0.75, unit: 'KG' }, { value: 1.125, unit: 'KG' }, { value: 0.25, unit: 'L' }, { value: 2.5, unit: 'L' }, { value: 1000, unit: 'L' }, { value: 12, unit: 'KG' }]) {
    const text = lineQuery({ productTerm: q.unit === 'KG' ? 'voi' : 'maito', quantity: q, claims: [] });
    assert.deepEqual(understand(text).items[0].quantity, q, `${JSON.stringify(q)} → "${text}"`);
  }
});

test('#17 tuotetyyppi: kasviliemi, merisuola, suola ja kanaliemi löytävät oikean tuotteen', { skip }, async () => {
  const { searchStorefront } = await import('../server/storefront.mjs');
  const { scoreOptions } = await import('../server/order-tools/index.mjs');
  const first = async (text, term) => {
    const list = (await searchStorefront(text, { deliveryDate: '2026-11-16', llm: false })).cards[0]?.list || [];
    const line = { productTerm: term, quantity: understand(text).items[0].quantity };
    return scoreOptions(list, line).map((x) => x.o.name);
  };
  // Kasviliemi: ainoa litroina myytävä (Puljonki 1 l) on Terminal-tuote, joka ei ole simuloidusti tilattavissa 16.11.
  // Tärkeintä on, ettei tekstiilien huuhteluaineita tarjota.
  assert.equal(understand('5 l kasvilientä').items[0].productTerm, 'kasvisliemi');
  const broth = await first('5 l kasvilientä', 'kasvisliemi');
  assert.ok(broth.every((n) => /liemi/i.test(n)), `kasviliemi: ${broth.slice(0, 3)}`);
  const sea = await first('1 kg merisuolaa', 'merisuola');
  assert.match(sea[0], /merisuola/i); assert.doesNotMatch(sea[0], /perunalastu|crisps|sipsi/i, `merisuola: ${sea.slice(0, 3)}`);
  const salt = await first('1 kg suolaa', 'suola');
  assert.doesNotMatch(salt[0], /mauste|yrtti|herbamare/i, `suola: ${salt.slice(0, 3)}`);
  const chicken = await first('5 l kanalientä', 'kanaliemi');
  assert.ok(chicken.length > 0, 'kanaliemi löytyy valikoimasta');
  assert.match(chicken[0], /kanaliemi/i);
});

test('#19 päivämäärät ilman loppupistettä ja "ensi viikon tiistaina"', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  const sunday = new Date('2026-11-15T09:00:00+02:00');
  const monday = new Date('2026-11-16T09:00:00+02:00');
  const date = (text, now = sunday) => understand(text, { now }).deliveryDate;
  assert.equal(date('10 l maitoa 16.11'), '2026-11-16');
  assert.equal(date('10 l maitoa ma 16.11'), '2026-11-16');
  assert.equal(date('10 l maitoa ma 16.11.'), '2026-11-16');
  assert.equal(date('10 l maitoa 20.11, kiitos'), '2026-11-20');
  assert.equal(date('2,5 kg voita'), null, 'desimaali ei ole päivämäärä');
  assert.equal(understand('2,5 kg voita', { now: sunday }).items[0].quantity.value, 2.5);
  assert.equal(date('2.5 kg voita'), null);
  assert.equal(date('10 l maitoa ensi viikon tiistaina'), '2026-11-17', 'sunnuntaina ensi viikon tiistai on 17.11.');
  assert.equal(date('10 l maitoa ensi viikon tiistaina', monday), '2026-11-24', 'maanantaina ensi viikon tiistai on 24.11.');
  assert.equal(date('10 l maitoa tiistaina', monday), '2026-11-17');
  const u = understand('10 l maitoa ensi viikon tiistaina', { now: sunday });
  assert.equal(u.items[0].productTerm.includes('viikon'), false);
});

test('#22 kananmunat: kenno on 30 munaa, ja Vapaan kanan munat muuntuvat kappaleiksi', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  const q = understand('3 kennoa kananmunia').items[0].quantity;
  assert.deepEqual(q, { value: 90, unit: 'PCS', basis: 'items' });
  const egg = (name, extra = {}) => itemsPerSalesUnit({ name, category: '10590', salesUnit: 'RAS', baseUnit: 'RAS', perSales: 1, ...extra })?.value ?? null;
  assert.equal(egg('Kieku Vapaan kanan muna M10'), 10);
  assert.equal(egg('Kieku Vapaan kanan muna L15 1020g'), 15);
  assert.equal(egg('Kieku Vapaan kanan muna L180 12300g', { salesUnit: 'KI', baseUnit: 'KI' }), 180);
  assert.equal(egg('20 x Kieku Vapaan kanan muna L6 408g', { salesUnit: 'KI', baseUnit: 'RAS', perSales: 20 }), 120);
  // Munakoiso ei ole muna: nimen 5 kg ei ole munamäärä. Kappaleina myytävä tuote on yksi kappale myyntierää kohden (17.11.).
  assert.deepEqual(itemsPerSalesUnit({ name: 'Munakoiso 5 kg', category: '17400', salesUnit: 'ST', baseUnit: 'ST', perSales: 1 }), { value: 1, source: 'sales-unit' }, 'munakoiso ei ole muna');
});

test('#22 kananmunien vaihtoehdot oikealla katalogilla: Vapaan kanan munat tulevat munamäärälle', { skip }, async () => {
  const { searchStorefront } = await import('../server/storefront.mjs');
  const list = (await searchStorefront('100 kananmunaa', { deliveryDate: '2026-11-16', llm: false })).cards[0]?.list || [];
  assert.ok(list.some((o) => /vapaan kanan/i.test(o.name)), list.map((o) => o.name).join(' | '));
});
