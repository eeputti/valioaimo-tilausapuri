// Valmisruoan tilalle sen pääraaka-aine (Eelis 18.11.: "tarjoa lanttulaatikon tilalle mieluummin lanttua ja samaa logiikkaa
// kaikkeen muuhunkin"). Toista ruokaa (maksalaatikkoa, nakki-perunasoselaatikkoa) ei tarjota. Ei mallikutsuja eikä verkkoa:
// hinnat ja saatavuus simuloidaan (VALIO_API_KEY tyhjä), kanta on väliaikainen.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const skip = !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-dish-ingredient-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', AIMO_DB: path.join(dir, 'k.db'), AIMO_LEARNED: path.join(dir, 'learned.json') });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingTools } = await import('../server/order-tools/index.mjs');

const item = (productTerm, value, unit, claims = []) => ({ raw: productTerm, productTerm, quantity: { value, unit }, claims, excludeAllergens: [], attributes: {} });

test('pääraaka-aine: porkkanalaatikolle porkkana ja lanttulaatikolle lanttu, ei mehua, pihviä eikä laatikkoa', { skip }, async () => {
  const { dishIngredient } = await import('../server/storefront.mjs');
  const carrot = await dishIngredient(item('porkkanalaatikko', 5, 'KG'), '2026-11-18');
  assert.equal(carrot.word, 'porkkana');
  assert.ok(carrot.options.length > 0);
  for (const o of carrot.options) {
    assert.match(o.name, /porkkana/i);
    assert.doesNotMatch(o.name, /laatikko|mehu|pihvi|piltti/i, `${o.name} ei ole raaka-ainetta`);
    assert.equal(o.ingredientWord, 'porkkana');
    assert.equal(o.ingredientFor, 'porkkanalaatikko');
  }
  const swede = await dishIngredient(item('lanttulaatikko', 5, 'KG'), '2026-11-18');
  assert.equal(swede.word, 'lanttu');
  for (const o of swede.options) assert.doesNotMatch(o.name, /laatikko|pihvi/i, `${o.name} ei ole lanttua`);
  // Kappaleina pyydetty ruoka ei kerro raaka-aineen määrää: hinta yhdestä myyntierästä ja määrä kysytään.
  const pieces = await dishIngredient(item('porkkanalaatikko', 6, 'PCS'), '2026-11-18');
  assert.ok(pieces.options.length > 0 && pieces.options.every((o) => o.askQuantity === true && o.qty <= 1), 'kpl ei muutu pusseiksi');
  // Laktoosittoman ruoan tilalle tuore kasvis kelpaa ilman merkintää.
  const lactoseFree = await dishIngredient(item('porkkanalaatikko', 5, 'KG', ['FREE_FROM_LACTOSE']), '2026-11-18');
  assert.ok(lactoseFree.options.length > 0);
  // Kaalilaatikolle keräkaali, ei pikkelöityä punakaalia tai kaalisalaattia.
  const cabbage = await dishIngredient(item('kaalilaatikko', 5, 'KG'), '2026-11-18');
  assert.equal(cabbage.word, 'keräkaali');
  for (const o of cabbage.options) assert.match(o.name, /^KERÄKAALI/, `${o.name} ei ole keräkaalia`);
  // Raaka-aineelle ei ole raaka-ainetta.
  assert.equal(await dishIngredient(item('porkkana', 5, 'KG'), '2026-11-18'), null);
});

test('valmisruoan haku ei tarjoa toista ruokaa: perunalaatikolle ei nakki- tai liha-perunasoselaatikkoa', { skip }, async () => {
  const { searchStorefront } = await import('../server/storefront.mjs');
  const r = await searchStorefront('10 kg perunalaatikkoa', { deliveryDate: '2026-11-18', llm: false });
  const names = r.cards[0].list.map((p) => p.name);
  assert.ok(names.length > 0);
  for (const name of names) assert.match(name, /perunalaatikko|peruna(?!.*laatikko)/i, `${name} on toinen ruoka`);
  assert.ok(!names.some((n) => /perunasoselaatikko/i.test(n)), 'perunasoselaatikko ei ole perunalaatikkoa');
});

test('tuntematon saatavuus: valmisruoalle vain sama ruoka, ei mallin valitsemaa toista laatikkoa', { skip }, async () => {
  const { knownAlternatives } = await import('../server/storefront.mjs');
  let asked = 0;
  const pick = async ({ candidates }) => { asked += 1; return candidates.map((c) => ({ id: c.id, term: null, reason: 'x', fits: true })); };
  // 462447 Saarioinen Lanttulaatikko 2,8kg (tuntematon), 462450 Saarioinen Maksalaatikko, 472119 Feelia Lanttulaatikko 600 g
  const alts = await knownAlternatives(item('lanttulaatikko', 5, 'KG'), '2026-11-18', { unknownIds: ['462447'], knownIds: ['462450', '472119'], pick });
  assert.equal(asked, 0, 'mallia ei kysytä valmisruoalle');
  for (const o of alts) assert.match(o.name, /lanttulaatikko/i, `${o.name} on toinen ruoka`);
  const plain = await knownAlternatives(item('jäätelö', 5, 'L'), '2026-11-18', { unknownIds: [], knownIds: ['462450'], pick });
  assert.equal(asked, 1, 'muulle kuin valmisruoalle valitsija toimii kuten ennen');
  assert.ok(Array.isArray(plain));
});

test('tilausapuri: raaka-aine otsikolla, valinta vaihtaa rivin raaka-aineeksi, ja hinnaton raaka-aine sanotaan', async () => {
  const clock = Date.parse('2026-11-18T10:00:00+02:00');
  const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
  const carrot = { id: '460811', name: 'PORKKANA PESTY 1KG PSS SUOMI', unit: 'PSS', unitLabel: 'pussi', kg: 1, qty: 5, price: 1.26, labels: [], availability: { deliveryDate: '2026-11-23' },
    ingredientFor: 'porkkanalaatikko', ingredientWord: 'porkkana', typeRank: 1 };
  const search = async (line) => {
    if (line.productTerm === 'porkkanalaatikko') return Object.assign([carrot], { ingredientUnavailable: null });
    if (line.productTerm === 'kaalilaatikko') return Object.assign([], { ingredientUnavailable: { word: 'keräkaali', unknown: false } });
    return Object.assign([], { ingredientUnavailable: { word: 'lanttu', unknown: true } });
  };
  const real = createOrderingTools({ now: () => clock, search, product: () => ({ hasAllergenData: false, contains: [], labels: [] }), buyer: (id) => ({ id }),
    requestQuote: async () => ({ needs: [] }), placeOrder: async () => ({}) });
  const tools = { ...real, quote: async ({ draft }) => ({ quoteId: 'Q', draftId: draft.id, revision: draft.revision, expiresAt: new Date(clock + 900_000).toISOString(), issues: [], totals: { net: 6.3 },
    lines: draft.lines.map((l) => ({ ref: l.ref, name: `${l.selectedName} [${l.productTerm}]`, salesUnits: 5, salesUnitLabel: 'pussia', covers: l.quantity, lineNet: 6.3 })) }) };
  const add = (productTerm) => ({ intent: 'order', deliveryDate: '2026-11-23', ops: [{ op: 'add', productTerm, quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [] }] });
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => clock), tools, now: () => clock,
    interpretTurn: async ({ text }) => (['porkkanalaatikko', 'lanttulaatikko', 'kaalilaatikko'].includes(text) ? add(text) : { intent: 'other', ops: [] }) });
  let n = 0;
  const say = (text, conversationId = 'c') => handleTurn({ messageId: `m${++n}`, conversationId, customer, text, receivedAt: clock });

  const shown = await say('porkkanalaatikko');
  assert.match(shown.text, /Porkkanalaatikolle ei löytynyt tilattavaa\.\nTilalle käy raaka-aine porkkana \(tarve 5 kg\):\n1\) /);
  assert.doesNotMatch(shown.text, /korvaaja|osumaa/);
  const picked = await say('1');
  assert.match(picked.text, /\[porkkana\]/, 'valinta vaihtaa rivin tuotteeksi porkkanan');

  const none = await say('lanttulaatikko', 'c2');
  assert.match(none.text, /Lanttulaatikolle kävisi korvaajaksi raaka-aine lanttu, mutta sen hintaa ja saatavuutta en nyt saa tarkistettua\./);
  // Toinen päivä ei tuo lantulle hintaa (Eelis 18.11.: "korjaa myös lanttulaatikon 'Kokeile toista päivää'").
  assert.doesNotMatch(none.text, /Kokeile toista päivää/);
  assert.match(none.text, /Kirjoita "poista lanttulaatikko" tai kerro, mitä laitetaan tilalle\. Tilausta ei ole tehty\.$/);
  // Raaka-aine on tilattavissa muina päivinä, mutta ei tälle: toisen päivän kokeilu on yhä oikea neuvo.
  const otherDay = await say('kaalilaatikko', 'c3');
  assert.match(otherDay.text, /Kaalilaatikolle kävisi korvaajaksi raaka-aine keräkaali, mutta päivälle .+ sitäkään ei ole tilattavana\./);
  assert.match(otherDay.text, /Kokeile toista päivää tai tarkenna tuotetta\./);
});
