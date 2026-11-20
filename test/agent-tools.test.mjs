// v2-agentin työkalukerros (server/agent/tools.mjs, docs/agent-v2.md Työkalusopimus). Oikea order-tools-koodi ja oikea
// luonnosvarasto. Ilman katalogia gateway (haku ja tarjous) on injektoitu ja hinnat kiinteät; katalogin kanssa koko ketju
// ajetaan simuloiduilla hinnoilla (VALIO_API_KEY tyhjä) ja oikealla korisivun runtime-kytkennällä. Ei mallikutsuja, ei verkkoa.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-agent-tools-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
const CATALOG = new URL('../data/catalog.json', import.meta.url);
const { createAgentTools } = await import('../server/agent/tools.mjs');
const cart = await import('../server/agent/cart.mjs');
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { shoppingListView } = await import('../server/shopping-list/index.mjs');
const { storefrontCartProjection } = await import('../server/storefront-whatsapp-sync.mjs');
const { unitSizeFor } = await import('../server/gateway/quantity.mjs');
const { roundToStep, stepOf, unitLabel } = await import('../server/catalog.mjs');
const { explainItemQuantity, isEggItem } = await import('../server/itemQuantities.mjs');
const { helsinkiLabel } = await import('../server/gateway/clock.mjs');
const { cartNotes } = await import('../server/cart-notes.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', companyName: 'Testikeittiö', personName: 'Testi',
  deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
// Katalogin muotoiset testituotteet. Sipulisäkin myyntiyksikkö on kpl (ST) kuten oikeassa datassa (460195).
const P = Object.fromEntries([
  { id: '460195', name: 'SIPULI 10KG SÄKKI SUOMI', category: '17405', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], kg: 10, sizeApprox: true },
  { id: '460202', name: 'SIPULI 1KG PSS SUOMI', category: '17405', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], kg: 1 },
  { id: '490001', name: 'PUNASIPULI PIENI HOLLANTI', category: '17405', salesUnit: 'KG', baseUnit: 'KG', perSales: 1, lot: 0.01, temp: 'chilled', country: 'nl', contains: [], kg: 1 },
  { id: '460500', name: 'PERUNA 10KG SÄKKI SUOMI', category: '17420', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], kg: 10 },
  { id: '470001', name: 'Valio vispikerma 35 % 1 l', brand: 'Valio', category: '10401', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, labels: [], litres: 1, kg: 1, ingredients: 'KERMA (MAITO).', co2: 3.1, reliability: 0.97 },
  { id: '470002', name: 'Valio Eila laktoositon vispikerma 1 l', brand: 'Valio', category: '10401', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, labels: ['FREE_FROM_LACTOSE'], litres: 1, kg: 1 },
  { id: '470003', name: 'Oatly kaurakerma 1 l', brand: 'Oatly', category: '10401', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'se', contains: ['GO'], hasAllergenData: true, labels: ['VEGAN', 'FREE_FROM_LACTOSE'], litres: 1, kg: 1 },
  { id: '468121', name: 'Kieku Ulkokananmuna M10 580g', brand: 'Kieku', category: '10590', salesUnit: 'RAS', baseUnit: 'RAS', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AE'], hasAllergenData: true, kg: 0.58 },
  { id: '480001', name: 'Mansikkaleivos 6 x 80 g', category: '11200', salesUnit: 'KI', baseUnit: 'ST', perSales: 6, lot: 0.01, temp: 'frozen', country: 'fi', contains: ['AM', 'AE', 'UW'], hasAllergenData: true, kg: 0.48 },
  { id: '499999', name: 'TRYFFELI TUORE ITALIA', category: '17499', salesUnit: 'KG', baseUnit: 'KG', perSales: 1, lot: 0.01, temp: 'chilled', country: 'it', contains: [], kg: 1 },
  // Gluteenittomuus allergeenitiedoista: Emmental-raaste (kuten 476660: laktoositon, sisältää vain maitoa), vehnää sisältävä ja tiedoton.
  { id: '476660', name: 'Valio Emmental juustoraaste 2,5 kg', brand: 'Valio', category: '10700', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, labels: ['FREE_FROM_LACTOSE', 'VEGETARIAN'], kg: 2.5 },
  { id: '476661', name: 'Vehnäjuustoleipä 1 kg', category: '10700', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM', 'UW'], hasAllergenData: true, labels: [], kg: 1 },
  { id: '476662', name: 'Juusto talon oma 1 kg', category: '10700', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], labels: [], kg: 1 },
  // Korisivun tarvesarake: makaroni 5 kg, perunapussi 2 kg ja voi 500 g.
  { id: '450005', name: 'MAKARONI 5KG', category: '12100', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'ambient', country: 'fi', contains: ['UW'], hasAllergenData: true, kg: 5 },
  { id: '460520', name: 'PERUNA 2KG PSS SUOMI', category: '17420', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], kg: 2 },
  { id: '450600', name: 'Valio voi 500 g', brand: 'Valio', category: '10500', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, kg: 0.5 },
  { id: '460212', name: 'TILLI NIPPU SUOMI', category: '17405', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [] }, // paino ei tiedossa
].map((p) => [p.id, p]));
const PRICES = { 460195: 9.5, 460202: 1.25, 490001: 1.9, 460500: 8, 470001: 4.1, 470002: 4.9, 470003: 3.6, 468121: 3.3, 480001: 12, 476660: 40.08, 476661: 6.5, 476662: 9,
  450005: 7.9, 460520: 1.6, 450600: 3.2, 460212: 0.9 }; // tryffelillä ei hintaa
const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length > 4 ? w.slice(0, -1) : w));
const catalog = { get: (id) => P[String(id)], search: (q) => Object.values(P).filter((p) => words(q).every((w) => p.name.toLowerCase().includes(w))).map((product) => ({ product })) };
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cutoffOf = (date) => `${addDays(date, -1)}T12:00:00+0200`;

/**
 * Testimaailma: oikea createOrderingTools ja openDraftStore, injektoitu haku ja tarjous (sama muunnoslasku kuin gatewayssa,
 * unitSizeFor ja roundToStep). avail: { [id]: { off: [päivät] } | { from: päivä } | { closed: { [päivä]: aikaisin päivä } } }
 * (closed: tilausaika tälle päivälle on mennyt, kuten storefront.mjs:n dateAfterCutoff kertoo).
 */
function world({ avail = {}, orders = [], readPage, db = null, stale = [] } = {}) {
  let t = Date.parse('2026-11-14T08:00:00Z'); // la 14.11. klo 10.00 Helsingin aikaa
  const calls = { search: [], quote: [], order: [], nearby: 0 };
  const priceOf = (id) => (PRICES[id] == null ? null : { net: PRICES[id], vatRate: 14, comparison: null, comparisonUnit: null });
  const availOn = (id, date) => { const a = avail[id]; if (a?.closed?.[date]) return { ok: false, closed: a.closed[date] }; if (a?.off?.includes(date)) return { ok: false }; if (a?.from && date < a.from) return { ok: false, late: a.from }; return { ok: true }; };
  const orderingTools = createOrderingTools({ now: () => t, product: (id) => P[String(id)], buyer: (id) => (id === 'b1' ? { id } : null),
    nearby: async () => { calls.nearby += 1; return []; },
    search: async (line, date) => {
      calls.search.push({ term: line.productTerm, quantity: line.quantity, date });
      const hits = Object.values(P).filter((p) => words(line.productTerm).every((w) => p.name.toLowerCase().includes(w)));
      const list = []; let next = null; let priced = false; let closed = false;
      for (const p of hits) {
        const price = priceOf(p.id);
        if (!price) continue;
        priced = true;
        const a = availOn(p.id, date);
        if (!a.ok) { const later = a.late || a.closed; if (later && (!next || later < next)) next = later; if (a.closed) closed = true; continue; }
        const q = line.quantity; let size = unitSizeFor(p, price, q.unit, q.basis || 'sales'); let extra = {};
        if (!size) { if (q.unit === 'PCS' && q.basis === 'items' && !isEggItem(p)) { size = { value: 1 }; extra = { countUnknown: true, askQuantity: true }; } else continue; }
        const qty = extra.countUnknown ? stepOf(p) : Math.max(stepOf(p), roundToStep(q.value / size.value, p, 'up'));
        list.push({ id: p.id, name: p.name, brand: p.brand || null, qty, unitLabel: unitLabel(p.salesUnit), unit: p.salesUnit, litres: p.litres ?? null, kg: p.kg ?? null, price: price.net,
          labels: p.labels || [], availability: { deliveryDate: date, stock: 500, closingTime: cutoffOf(date) }, typeRank: 0, requested: true, match: 0,
          quantityExplanation: extra.countUnknown ? null : explainItemQuantity(p, q, qty), ...extra });
      }
      list.nextDeliveryDate = list.length ? null : next; list.cutoffPassed = !list.length && closed; list.notInCatalog = !hits.length; list.availabilityUnknown = hits.length > 0 && !priced;
      list.requestedUnknown = false; list.unknownIds = []; list.ingredientUnavailable = null;
      return list;
    },
    requestQuote: async (buyer, input) => {
      calls.quote.push(structuredClone(input));
      const expiresAt = new Date(t + 15 * 60_000).toISOString();
      return { quoteId: `Q${calls.quote.length}`, needs: input.needs.map((n) => {
        const p = P[n.candidates[0]]; const price = priceOf(p?.id);
        if (!p || !price) return { ref: n.ref, options: [], excluded: [{ code: 'PRICE_UNAVAILABLE', message: 'Hintaa ei saatu.' }] };
        const a = availOn(p.id, input.deliveryDate);
        if (!a.ok && !a.late) return { ref: n.ref, options: [], excluded: [{ code: 'NOT_DELIVERABLE', message: 'Tuotetta ei voi toimittaa valittuna päivänä.' }] };
        const size = unitSizeFor(p, price, n.quantity.unit, n.quantity.basis || 'sales');
        if (!size) return { ref: n.ref, options: [], excluded: [{ code: 'UNIT_NOT_CONVERTIBLE', message: 'Määrää ei voi muuntaa.' }] };
        const qty = Math.max(stepOf(p), roundToStep(n.quantity.value / size.value, p, 'up'));
        const date = a.late || input.deliveryDate;
        return { ref: n.ref, excluded: [], options: [{ kind: 'exact', deliveryDate: date, expiresAt, cutoff: cutoffOf(date), cutoffLabel: helsinkiLabel(cutoffOf(date)), offer: `jws-${n.ref}-${p.id}`,
          lines: [{ productId: p.id, name: p.name, quantity: qty, salesUnitLabel: unitLabel(p.salesUnit), covers: +(qty * size.value).toFixed(2), unitPriceNet: price.net, lineNet: +(price.net * qty).toFixed(2), vatRate: 14, availability: { stockKnown: true },
            ...(stale.includes(p.id) ? { priceCurrent: false, priceFetchedAt: '2026-11-17T08:00:00.000Z' } : {}) }] }] }; // stale: viimeisin tunnettu hinta
      }) };
    },
    placeOrder: async (buyer, input) => { calls.order.push(structuredClone(input)); return { status: 'confirmed', orderId: 'AGW-20261114-0001', deliveryDate: '2026-11-20', totals: { net: 1 }, reasons: [] }; },
  });
  const store = openDraftStore(':memory:', () => t);
  const tools = createAgentTools({ store, orderingTools, catalog, gatewayOrders: { list: (buyerId) => (buyerId === 'b1' ? orders : []) }, now: () => t, readPage, db });
  const ctx = (extra = {}) => ({ customer, conversationId: 'conv', now: new Date(t), channel: 'whatsapp', ...extra });
  const run = (name, input = {}, extra) => tools.run(name, input, ctx(extra));
  const draft = () => store.active('conv');
  const review = () => shoppingListView(draft(), customer)?.status === 'review';
  return { tools, store, orderingTools, calls, run, ctx, draft, review, at: (iso) => { t = Date.parse(iso); } };
}
const item = (term, amount = null, unit = null, note = null) => ({ term, amount, unit, note });
const upd = (ref, over = {}) => ({ ref, productId: null, packs: null, amount: null, unit: null, term: null, ...over });
const search = (query, over = {}) => ({ query, ref: null, amount: null, unit: null, limit: 3, more: false, ...over });
// Tarkistuslista ja korisivun tila kulkevat yhdessä: review täsmälleen silloin, kun ready.
const same = (w, r) => assert.equal(w.review(), r.checklist.ready, `shoppingListView review (${w.review()}) ja checklist.ready (${r.checklist.ready}) eroavat`);

// Valmis kori: perunat, sipulit kiloina ja kerma perjantaiksi, ei ruokavaliota.
async function readyCart(w, date = '2026-11-20') {
  await w.run('add_items', { items: [item('sipuli', 50, 'kpl'), item('kerma', 3, 'l'), item('peruna', 10, 'kg')] });
  await w.run('set_delivery_date', { date });
  await w.run('set_diet', { allergens: [], diets: [], none: true, note: null });
  await w.run('update_item', upd('L1', { productId: '460195', amount: 6, unit: 'kg' }));
  await w.run('update_item', upd('L2', { productId: '470001' }));
  return w.run('update_item', upd('L3', { productId: '460500' }));
}

test('työkalut: nimet, suomenkieliset kuvaukset ja strict-skeemat API:n rajoissa', () => {
  const w = world();
  const names = ['set_delivery_date', 'set_diet', 'add_items', 'search_products', 'update_item', 'remove_item', 'get_cart', 'product_details', 'previous_orders', 'start_new_order', 'send_cart_link', 'save_feedback', 'read_link'];
  assert.deepEqual(w.tools.definitions.map((d) => d.name), names);
  let unions = 0; let optional = 0;
  const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'oneOf', 'not', 'pattern', 'default'];
  const walk = (s, at) => {
    for (const k of FORBIDDEN) assert.equal(k in s, false, `${at}: ${k} ei ole tuettu strict-skeemassa`);
    // API hylkää enumin tyyppiunionin kanssa (400 "Enum value 'kg' does not match declared type ['string','null']", 19.11.),
    // ja enum-arvojen pitää vastata ilmoitettua tyyppiä. anyOf ei saa olla samassa solmussa kuin type tai properties.
    if (s.enum) {
      assert.equal(Array.isArray(s.type), false, `${at}: enum ja tyyppiunioni samassa skeemassa`);
      if (s.type) assert.ok(s.enum.every((v) => (s.type === 'integer' ? Number.isInteger(v) : typeof v === s.type)), `${at}: enum-arvo ei vastaa tyyppiä ${s.type}`);
      else assert.ok(s.enum.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)), `${at}: enum-arvon pitää olla merkkijono, luku, totuusarvo tai null`);
    }
    if (s.anyOf) assert.ok(!('type' in s) && !('properties' in s), `${at}: anyOf ja type tai properties samassa solmussa`);
    assert.ok('type' in s || 'enum' in s || 'anyOf' in s, `${at}: tyyppi puuttuu`);
    if (Array.isArray(s.type) || s.anyOf) unions += 1;
    if ('minItems' in s) assert.ok([0, 1].includes(s.minItems), `${at}: minItems vain 0 tai 1`);
    const type = [s.type].flat();
    if (type.includes('object')) {
      assert.equal(s.additionalProperties, false, `${at}: additionalProperties`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${at}: kaikki kentät required-listassa`);
      optional += Object.keys(s.properties).length - s.required.length;
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${at}.${k}`);
    }
    if (type.includes('array')) walk(s.items, `${at}[]`);
  };
  for (const d of w.tools.definitions) {
    assert.equal(d.strict, true, d.name);
    assert.ok(d.description.length > 60 && /[äö]/.test(d.description), `${d.name}: kuvaus suomeksi`);
    assert.equal(d.input_schema.type, 'object');
    walk(d.input_schema, d.name);
  }
  // Structured outputs: enintään 20 strict-työkalua, 24 valinnaista ja 16 unioniparametria pyyntöä kohden.
  assert.ok(w.tools.definitions.length <= 20);
  assert.equal(optional, 0);
  assert.ok(unions <= 16, `unioniparametreja ${unions}`);
  assert.equal(unions, 9); // null-enumit (unit) eivät ole tyyppiunioneja
  const unit = w.tools.definitions.find((d) => d.name === 'update_item').input_schema.properties.unit;
  assert.deepEqual(unit.enum, ['kg', 'g', 'l', 'dl', 'kpl', 'pakkaus', null]);
  assert.equal('type' in unit, false);
  assert.deepEqual(w.tools.definitions.find((d) => d.name === 'save_feedback').input_schema.properties.kind.enum, ['bug', 'idea', 'praise', 'other']);
  assert.deepEqual(createAgentTools({ store: openDraftStore(), orderingTools: w.orderingTools, readPage: false }).definitions.map((d) => d.name), names.filter((n) => n !== 'read_link'));

  // WhatsApp-testi 19.11. (Opus): nollatulle numerolle "Tätä teillä on tilattu eniten", vaikka luku on kaikkien asiakkaiden tilauksista.
  assert.match(w.tools.definitions.find((d) => d.name === 'search_products').description,
    /popular ja orderedCount kertovat, kuinka monessa kaikkien asiakkaiden vahvistetussa tilauksessa tuote on ollut, eivät tämän asiakkaan omista tilauksista/);
});

test('tarkistuslista etenee, ja shoppingListView on review täsmälleen silloin, kun checklist.ready on tosi', async () => {
  const w = world();
  const empty = await w.run('get_cart');
  assert.deepEqual(empty.checklist, { deliveryDate: { done: false, date: null, weekday: null, orderBy: null }, diet: { done: false, allergens: [], diets: [], none: false },
    products: { done: false, missing: [] }, quantities: { done: false, missing: [] }, ready: false });
  assert.equal(w.draft(), null); // pelkkä luku ei tallenna tyhjää luonnosta
  const added = await w.run('add_items', { items: [item('sipuli', 50, 'kpl', '50 hengelle'), item('kerma', 3, 'l'), item('peruna')] });
  assert.deepEqual(added.items.map((i) => [i.ref, i.term, i.status]), [['L1', 'sipuli', 'added'], ['L2', 'kerma', 'added'], ['L3', 'peruna', 'added']]);
  assert.deepEqual(added.items[0].amount, { amount: 50, unit: 'kpl' });
  assert.deepEqual(added.checklist.products.missing, ['sipuli', 'kerma', 'peruna']);
  assert.deepEqual(added.checklist.quantities.missing, ['peruna']);
  same(w, added);
  assert.equal(shoppingListView(w.draft(), customer).status, 'needs_details');
  // Luonnos on vanhan ytimen muotoa: määrät L/KG/PCS, ruokavalion selvitys avoimena tarkennuksena.
  assert.deepEqual(w.draft().lines[0].quantity, { value: 50, unit: 'PCS', basis: 'items' });
  assert.deepEqual(w.draft().pending, { kind: 'preference', refs: ['L1', 'L2', 'L3'], claim: null, reason: 'diet' });

  const date = await w.run('set_delivery_date', { date: '2026-11-20' });
  assert.equal(date.ok, true);
  assert.equal(date.weekday, 'perjantai');
  assert.equal(date.label, 'pe 20.11.');
  assert.equal(date.daysFromToday, 6);
  assert.equal(date.checklist.deliveryDate.done, true);
  same(w, date);
  const diet = await w.run('set_diet', { allergens: [], diets: [], none: true, note: null });
  assert.equal(diet.checklist.diet.done, true);
  assert.equal(diet.checklist.diet.none, true);
  assert.equal(w.draft().pending, null);
  same(w, diet);

  const potato = await w.run('update_item', upd('L3', { productId: '460500', amount: 12, unit: 'kg' }));
  assert.equal(potato.ok, true);
  assert.deepEqual([potato.packs, potato.packUnit, potato.total, potato.excess, potato.lineNet], [2, 'kpl', { amount: 20, unit: 'kg' }, 8, 16]);
  assert.equal(potato.orderBy, 'to 19.11. klo 12.00');
  same(w, potato);
  // 50 sipulia ja 10 kg:n säkki: kappaleita ei arvata säkeiksi, vaan malli saa pakkaustiedot ja muuntaa itse.
  const onions = await w.run('update_item', upd('L1', { productId: '460195' }));
  assert.equal(onions.error, 'UNIT_NOT_CONVERTIBLE');
  assert.deepEqual([onions.pack.salesUnit, onions.pack.kg, onions.pack.items], ['kpl', 10, null]);
  assert.match(onions.message, /Muunna määrä itse kiloiksi/);
  assert.deepEqual(onions.requested, { amount: 50, unit: 'kpl' });
  assert.equal(w.draft().lines[0].selectedProductId, null);
  const kilos = await w.run('update_item', upd('L1', { productId: '460195', amount: 6, unit: 'kg' }));
  assert.deepEqual([kilos.packs, kilos.total, kilos.excess, kilos.lineNet], [1, { amount: 10, unit: 'kg' }, 4, 9.5]);
  assert.deepEqual(w.draft().lines[0].quantity, { value: 6, unit: 'KG' });
  same(w, kilos);
  const options = await w.run('search_products', search('', { ref: 'L2' }));
  assert.deepEqual(options.need, { amount: 3, unit: 'l' });
  assert.deepEqual(options.options.map((o) => o.productId).sort(), ['470001', '470002', '470003']);
  const whipped = options.options.find((o) => o.productId === '470001');
  assert.deepEqual(whipped.forAmount, { convertible: true, packs: 3, total: { amount: 3, unit: 'l' }, lineNet: 12.3, excess: 0 });
  assert.deepEqual(whipped.pricePer, { value: 4.1, unit: 'l' });
  assert.deepEqual(whipped.allergens, { known: true, contains: ['maito'], mayContain: [] });
  const cream = await w.run('update_item', upd('L2', { productId: '470001' }));
  assert.deepEqual([cream.packs, cream.lineNet], [3, 12.3]);
  assert.equal(cream.checklist.ready, true);
  same(w, cream);
  const view = await w.run('get_cart');
  assert.deepEqual(view.totals, { net: 37.8, vat: 5.29, gross: 43.09, currency: 'EUR', complete: true });
  assert.deepEqual(view.lines.map((l) => l.status), ['ok', 'ok', 'ok']);
  assert.deepEqual(view.lines[0].need, { amount: 50, unit: 'kpl' }); // asiakkaan oma tarve säilyy muunnoksen jälkeen
  assert.equal(view.lines[0].note, '50 hengelle');
  const link = await w.run('send_cart_link');
  assert.equal(link.ok, true);
  assert.equal(link.draftId, w.draft().id);
  assert.deepEqual(link.totals, { net: 37.8, vat: 5.29, gross: 43.09, currency: 'EUR' });
  assert.equal('expiresAt' in link, false); // tarjouksen ~15 min ei ole linkin voimassaolo (livetesti 19.11.: "linkki toimii klo 19.12 asti")
  assert.deepEqual({ ...w.draft().quote, expiresAt: undefined }, { quoteId: `Q${w.calls.quote.length}`, revision: w.draft().revision, expiresAt: undefined });
  assert.ok('expiresAt' in w.draft().quote); // tarjouksen voimassaolo säilyy luonnoksessa
  same(w, link);
  // Poisto ja lisäys pitävät tilat samana.
  same(w, await w.run('remove_item', { ref: 'L2' }));
  same(w, await w.run('add_items', { items: [item('voi')] }));
  assert.equal(w.review(), false);
});

test('ilman ruokavalion selvitystä kori ei ole valmis eikä korisivu review, vaikka tuotteet, määrät ja päivä ovat valmiit', async () => {
  const w = world();
  await w.run('add_items', { items: [item('peruna', 10, 'kg')] });
  await w.run('set_delivery_date', { date: '2026-11-20' });
  const r = await w.run('update_item', upd('L1', { productId: '460500' }));
  assert.deepEqual([r.checklist.deliveryDate.done, r.checklist.products.done, r.checklist.quantities.done, r.checklist.diet.done, r.checklist.ready], [true, true, true, false, false]);
  assert.equal(shoppingListView(w.draft(), customer).status, 'needs_details');
  assert.deepEqual(shoppingListView(w.draft(), customer).missing, ['preference:L1']);
  same(w, r);
  const link = await w.run('send_cart_link');
  assert.deepEqual([link.ok, link.missing], [false, ['diet']]);
  same(w, await w.run('set_diet', { allergens: [], diets: [], none: true, note: null }));
  assert.equal(w.review(), true);
});

test('send_cart_link kertoo puuttuvat kohdat eikä anna linkkiä keskeneräiselle korille', async () => {
  const w = world();
  assert.deepEqual((await w.run('send_cart_link')).missing, ['deliveryDate', 'diet', 'items']);
  await w.run('add_items', { items: [item('sipuli'), item('kerma', 2, 'l')] });
  const r = await w.run('send_cart_link');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['deliveryDate', 'diet', 'product:sipuli', 'product:kerma', 'quantity:sipuli']);
  assert.equal(w.calls.quote.length, 0);
  // Monen toimituspaikan asiakas: paikka puuttuu, joten korisivun tilakaan ei ole review.
  const multi = { ...customer, customerId: 'c2', deliverySites: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
  const other = await w.tools.run('get_cart', {}, { ...w.ctx(), customer: multi, conversationId: 'multi' });
  assert.equal(other.checklist.deliveryDate.siteMissing, true);
});

test('muunnokset: kappaleet vain ilmoitetulla kappalemäärällä, kilot ja litrat myyntieriksi ylöspäin', () => {
  const q = (amount, unit) => cart.toQuantity(amount, unit);
  assert.deepEqual([q(250, 'g'), q(5, 'dl'), q(50, 'kpl'), q(2, 'pakkaus'), q(0, 'kg'), q(-1, 'l'), q(200000, 'kg')],
    [{ value: 0.25, unit: 'KG' }, { value: 0.5, unit: 'L' }, { value: 50, unit: 'PCS', basis: 'items' }, { value: 2, unit: 'PCS', basis: 'sales' }, null, null, null]);
  const sack = P['460195'];
  assert.equal(cart.convert(sack, q(50, 'kpl')).code, 'UNIT_NOT_CONVERTIBLE'); // myyntiyksikkö kpl ei ole yksi sipuli
  assert.deepEqual(cart.convert(sack, q(25, 'kg')), { ok: true, packs: 3, size: 10, total: { value: 30, unit: 'KG' }, excess: 5, pack: cart.packOf(sack) });
  assert.equal(cart.packOf(sack).contents, '1 kpl = 10 kg');
  const loose = P['490001']; // kiloittain myytävä: kilot sellaisenaan, puolen kilon askelin
  assert.deepEqual([cart.convert(loose, q(2.3, 'kg')).packs, cart.convert(loose, q(20, 'kpl')).code, cart.packOf(loose).contents], [2.5, 'UNIT_NOT_CONVERTIBLE', 'myydään kiloittain: 1 myyntierä = 1 kg']);
  const eggs = P['468121']; // M10: kymmenen munaa rasiassa
  assert.deepEqual([cart.convert(eggs, q(95, 'kpl')).packs, cart.convert(eggs, q(95, 'kpl')).total, cart.convert(eggs, q(95, 'kpl')).excess], [10, { value: 100, unit: 'PCS', basis: 'items' }, 5]);
  const cakes = P['480001']; // laatikossa 6 kpl (yksikkömuunnos)
  assert.deepEqual([cart.convert(cakes, q(20, 'kpl')).packs, cart.explicitItems(cakes), cart.convert(cakes, q(2, 'pakkaus')).packs], [4, 6, 2]);
  assert.equal(cart.convert(P['470001'], q(5, 'dl')).packs, 1);
  assert.equal(cart.convert(P['470001'], q(2, 'kg')).packs, 2);
});

test('add_items palauttaa vaihtoehdot, kun päivä on tiedossa, joten tuotteen voi valita ilman erillistä hakua', async () => {
  // Eelis 19.11.: "toi vastaus kestää kyl liian kauan". Haku omana kierroksenaan lisäsi jokaiseen tilausviestiin yhden mallikierroksen.
  const w = world();
  const noDate = await w.run('add_items', { items: [item('peruna', 50, 'kg')] });
  assert.equal('options' in noDate.items[0], false, 'ilman päivää ei ole hintoja eikä vaihtoehtoja');
  assert.equal(w.calls.search.length, 0);
  await w.run('set_delivery_date', { date: '2026-11-20' });
  const r = await w.run('add_items', { items: [item('peruna', 50, 'kg'), item('sipuli', 6, 'kg'), item('kerma', 3, 'l'), item('tryffeli', 1, 'kg')] });
  const [potato, onion, cream, truffle] = r.items;
  // Peruna oli jo listalla samalla määrällä (existing): sitä ei haeta uudelleen. Uudet rivit haetaan yhdellä kertaa.
  assert.equal(potato.status, 'existing');
  assert.equal('options' in potato, false);
  assert.deepEqual(w.calls.search.map((c) => c.term).sort(), ['kerma', 'sipuli', 'tryffeli']);
  assert.equal(onion.deliveryDate, '2026-11-20');
  assert.deepEqual(onion.options.find((o) => o.productId === '460202').forAmount, { convertible: true, packs: 6, total: { amount: 6, unit: 'kg' }, lineNet: 7.5, excess: 0 });
  assert.ok(cream.options.length >= 2 && cream.options.every((o) => o.forAmount && o.pricePerPack > 0));
  // Ei tilattavaa (tryffelillä ei hintaa): syy samassa muodossa kuin search_productsissa.
  assert.deepEqual(truffle.options, []);
  assert.ok(truffle.unavailable);
  // Näytetyt merkitään nähdyiksi, joten more-haku jatkaa niistä eikä näytä samoja uudelleen.
  assert.deepEqual([...w.draft().agent.seen['ref:L2']].sort(), onion.options.map((o) => o.productId).sort());
  const more = await w.run('search_products', search('', { ref: 'L2', more: true }));
  assert.ok(more.options.every((o) => !onion.options.some((x) => x.productId === o.productId)));
  // Valinta suoraan add_itemsin vaihtoehdosta.
  const picked = await w.run('update_item', upd('L2', { productId: '460202', amount: 6, unit: 'kg' }));
  assert.equal(picked.ok, true);
  assert.equal(w.draft().lines.find((l) => l.ref === 'L2').selectedProductId, '460202');
  // Valitun rivin toistettu tarve ei hae uudelleen.
  const before = w.calls.search.length;
  const again = await w.run('add_items', { items: [item('sipuli', 6, 'kg')] });
  assert.equal('options' in again.items[0], false);
  assert.equal(w.calls.search.length, before);
});

test('add_items onnistuu, vaikka vaihtoehtojen haku epäonnistuu', async () => {
  const w = world();
  await w.run('set_delivery_date', { date: '2026-11-20' });
  w.orderingTools.suggest = async () => { throw new Error('verkko'); };
  const r = await w.run('add_items', { items: [item('sipuli', 6, 'kg')] });
  assert.equal(r.ok, true);
  assert.equal(r.items[0].status, 'added');
  assert.equal('options' in r.items[0], false);
});

test('50 sipulia: haku näyttää pakkauksen, ei muunna kappaleita säkeiksi, ja kilomäärä muuntuu', async () => {
  const w = world();
  await w.run('add_items', { items: [item('sipuli', 50, 'kpl')] });
  await w.run('set_delivery_date', { date: '2026-11-20' });
  const r = await w.run('search_products', search('sipuli', { ref: 'L1' }));
  // Kappalehaku tehdään yhdellä myyntierällä: haku ei laske 50 kappaletta 50 säkiksi.
  assert.deepEqual(w.calls.search.at(-1).quantity, { value: 1, unit: 'PCS', basis: 'sales' });
  const sack = r.options.find((o) => o.productId === '460195');
  assert.deepEqual(sack.pack, { salesUnit: 'kpl', byWeight: false, kg: 10, l: null, items: null, step: 1, contents: '1 kpl = 10 kg' });
  assert.equal(sack.pricePerPack, 9.5);
  assert.deepEqual(sack.pricePer, { value: 0.95, unit: 'kg' });
  assert.equal(sack.forAmount.convertible, false);
  assert.equal(sack.forAmount.code, 'UNIT_NOT_CONVERTIBLE');
  assert.ok(r.options.every((o) => o.forAmount.convertible === false));
  const kg = await w.run('search_products', search('sipuli', { ref: 'L1', amount: 6, unit: 'kg' }));
  assert.deepEqual(kg.options.find((o) => o.productId === '460195').forAmount, { convertible: true, packs: 1, total: { amount: 10, unit: 'kg' }, lineNet: 9.5, excess: 4 });
  assert.deepEqual(kg.options.find((o) => o.productId === '460202').forAmount, { convertible: true, packs: 6, total: { amount: 6, unit: 'kg' }, lineNet: 7.5, excess: 0 });
  // Munat: kappaleet muuntuvat, koska rasian munamäärä (M10) on nimessä.
  const eggs = await w.run('search_products', search('kananmuna', { amount: 100, unit: 'kpl' }));
  assert.deepEqual(eggs.options[0].forAmount, { convertible: true, packs: 10, total: { amount: 100, unit: 'kpl' }, lineNet: 33, excess: 0 });
});

test('allergiat rajaavat haun ja valinnan, ja myöhempi rajaus purkaa ristiriitaisen valinnan', async () => {
  const w = world();
  await w.run('add_items', { items: [item('kerma', 2, 'l')] });
  await w.run('set_delivery_date', { date: '2026-11-20' });
  const unknown = await w.run('set_diet', { allergens: ['kuukivi'], diets: [], none: false, note: null });
  assert.equal(unknown.error, 'UNKNOWN_DIET');
  assert.equal(unknown.checklist.diet.done, false);
  assert.equal((await w.run('set_diet', { allergens: ['AM'], diets: [], none: true, note: null })).error, 'DIET_CONFLICT');
  assert.equal((await w.run('set_diet', { allergens: [], diets: [], none: false, note: null })).error, 'DIET_EMPTY');
  const milk = await w.run('set_diet', { allergens: ['maidoton'], diets: [], none: false, note: 'yksi maitoallerginen' });
  assert.deepEqual(milk.diet, { known: true, allergens: [{ code: 'AM', name: 'maito' }], diets: [], note: 'yksi maitoallerginen' });
  const found = await w.run('search_products', search('kerma', { ref: 'L1' }));
  assert.deepEqual(found.options.map((o) => o.productId), ['470003']); // maitoa sisältävät pois
  const denied = await w.run('update_item', upd('L1', { productId: '470001' }));
  assert.equal(denied.error, 'ALLERGEN_CONFLICT');
  assert.deepEqual(denied.contains, ['maito']);
  assert.equal(w.draft().lines[0].selectedProductId, null);
  assert.equal((await w.run('update_item', upd('L1', { productId: '470003' }))).ok, true);

  // Valittu maitotuote ja vasta sitten maitoallergia: valinta puretaan ja kerrotaan, rivi ja määrä säilyvät.
  const v = world();
  await readyCart(v);
  assert.equal(v.review(), true);
  const late = await v.run('set_diet', { allergens: ['maito'], diets: [], none: false, note: null });
  assert.deepEqual(late.conflicts.map((c) => [c.ref, c.productId, c.action, c.contains]), [['L2', '470001', 'unselected', ['maito']]]);
  assert.deepEqual(late.checklist.products.missing, ['kerma']);
  assert.deepEqual(v.draft().lines[1].quantity, { value: 3, unit: 'L' });
  same(v, late);
  // Ruokavaliomerkintä on toive: puuttuva merkintä on varoitus, ei este.
  const gluten = await v.run('set_diet', { allergens: [], diets: ['gluteeniton'], none: false, note: null });
  assert.deepEqual(gluten.warnings.map((x) => x.warning), ['Ei merkintää: gluteeniton', 'Ei merkintää: gluteeniton']);
  assert.equal(v.draft().lines[0].selectedWarning, 'Ei merkintää: gluteeniton');
});

test('asetusmuotoiset työkalut: sama kutsu uudelleen ei lisää rivejä, ei kasvata revisiota eikä tee uutta tarjousta', async () => {
  const w = world();
  await readyCart(w);
  const before = w.draft(); const quotes = w.calls.quote.length;
  const again = [
    ['add_items', { items: [item('sipuli', 50, 'kpl'), item('kerma', 3, 'l'), item('peruna', 10, 'kg')] }],
    ['set_delivery_date', { date: '2026-11-20' }],
    ['set_diet', { allergens: [], diets: [], none: true, note: null }],
    ['update_item', upd('L1', { productId: '460195', amount: 6, unit: 'kg' })],
    ['update_item', upd('L3', { productId: '460500' })],
  ];
  for (const [name, input] of again) {
    const r = await w.run(name, input);
    assert.equal(r.error, undefined, name);
    assert.deepEqual(w.draft(), before, `${name} muutti luonnosta`);
  }
  assert.equal(w.calls.quote.length, quotes);
  const repeat = await w.run('add_items', { items: [item('Sipuli', 50, 'kpl')] }); // kirjainkoko ei tee uutta riviä
  assert.deepEqual(repeat.items.map((i) => [i.ref, i.status]), [['L1', 'existing']]);
  const twiceInOne = await w.run('add_items', { items: [item('voi', 2, 'kg'), item('Voi', 3, 'kg')] }); // sama sana kahdesti: yksi rivi
  assert.deepEqual(twiceInOne.items.map((i) => [i.ref, i.status, i.amount]), [['L4', 'added', { amount: 3, unit: 'kg' }]]);
  await w.run('remove_item', { ref: 'L4' });
  const afterVoi = w.draft();
  // Uusi määrä samalle tuotesanalle korvaa aiemman (kokonaismäärä) ja tarkistetaan valitulle tuotteelle.
  const more = await w.run('add_items', { items: [item('peruna', 25, 'kg')] });
  assert.deepEqual(more.items.map((i) => [i.ref, i.status, i.amount]), [['L3', 'updated', { amount: 25, unit: 'kg' }]]);
  assert.equal(w.draft().lines.length, 3);
  assert.equal(w.draft().revision, afterVoi.revision + 1);
  assert.equal((await w.run('get_cart')).lines[2].packs, 3);
  // Muuttunut kappaletarve muunnetulla rivillä: kappaleita ei muunneta säkeiksi, vaan valinta puretaan syineen.
  const eighty = await w.run('add_items', { items: [item('sipuli', 80, 'kpl')] });
  assert.deepEqual([eighty.items[0].status, eighty.items[0].unavailable.code], ['updated', 'UNIT_NOT_CONVERTIBLE']);
  assert.deepEqual(eighty.checklist.products.missing, ['sipuli']);
  same(w, eighty);
  const removed = await w.run('remove_item', { ref: 'L2' });
  const twice = await w.run('remove_item', { ref: 'L2' });
  assert.deepEqual([removed.removed, twice.removed, twice.ok], [true, false, true]);
});

test('korisivu, tarjous ja maksu toimivat työkalujen luonnoksella sellaisenaan', async () => {
  const w = world();
  await readyCart(w);
  await w.run('send_cart_link');
  const draft = w.draft();
  const list = shoppingListView(draft, customer);
  assert.equal(list.status, 'review');
  assert.deepEqual(list.missing, []);
  const quote = await w.orderingTools.quote({ customer, draft });
  assert.equal(quote.issues.length, 0);
  const page = storefrontCartProjection(list, quote);
  assert.equal(page.state, 'ready');
  assert.deepEqual(page.lines.map((l) => [l.id, l.qty, l.price, l.requested]), [['460195', 1, 9.5, { value: 10, unit: 'KG' }], ['470001', 3, 4.1, { value: 3, unit: 'L' }], ['460500', 1, 8, { value: 10, unit: 'KG' }]]);
  const order = await w.orderingTools.submit({ customer, draft, quoteId: quote.quoteId, approval: { draftId: draft.id, revision: draft.revision, quoteId: quote.quoteId }, idempotencyKey: `wa-${draft.id}-r${draft.revision}` });
  assert.equal(order.status, 'confirmed');
  assert.deepEqual(w.calls.order[0].offers, ['jws-L1-460195', 'jws-L2-470001', 'jws-L3-460500']);

  // Korisivun SIIRRY MAKSAMAAN -polku vanhan ytimen kautta: "näytä" tekee tarjouksen ja "TILAA" tilauksen samasta luonnoksesta.
  const p = world();
  await readyCart(p);
  await p.run('send_cart_link');
  const handleTurn = createOrderingConversation({ store: p.store, tools: p.orderingTools, now: () => Date.parse('2026-11-14T08:00:00Z'),
    interpretTurn: async () => { throw new Error('maksupolku ei tulkitse viestejä'); } });
  const id = p.draft().id; const revision = p.draft().revision;
  const shown = await handleTurn({ messageId: 'pay-1', conversationId: 'conv', customer, text: 'näytä' });
  assert.equal(shown.status, 'ready');
  assert.equal(shown.revision, revision);
  assert.match(shown.text, /\*Tilausluonnos\*/);
  const paid = await handleTurn({ messageId: 'pay-2', conversationId: 'conv', customer, text: 'TILAA' });
  assert.equal(paid.status, 'confirmed');
  assert.equal(paid.draftId, id);
  assert.equal(p.draft(), null); // luonnos on tilattu
  assert.equal(p.calls.order.length, 1);
  // Tilauksen jälkeen työkalut aloittavat uuden luonnoksen, ja tilannekuva kertoo edellisen tilauksen.
  const snap = p.tools.snapshot(p.ctx());
  assert.deepEqual(snap.lastOrder, { orderId: 'AGW-20261114-0001', status: 'confirmed', deliveryDate: '2026-11-20' });
  assert.equal(snap.lines.length, 0);
});

test('korisivu näyttää asiakkaan tarpeen kiloina ja litroina, kun malli valitsee myyntierinä, ja myyntierät täsmäävät tarjouksen kanssa', async () => {
  const w = world();
  await w.run('add_items', { items: [item('makaroni', 5, 'kg'), item('peruna', 18, 'kg'), item('kerma', 3, 'l'), item('voi', 10, 'pakkaus'), item('kananmuna', 95, 'kpl')] });
  await w.run('set_delivery_date', { date: '2026-11-20' });
  await w.run('set_diet', { allergens: [], diets: [], none: true, note: null });
  // Malli valitsee hakutuloksen forAmount.packs-luvulla (arvioinnin löydös 19.11.: tarve 5 kg näkyi korisivulla "1 kpl").
  const picks = [['L1', '450005', 1], ['L2', '460520', 9], ['L3', '470001', 3], ['L4', '450600', 10], ['L5', '468121', 10]];
  const results = [];
  for (const [ref, productId, packs] of picks) results.push(await w.run('update_item', upd(ref, { productId, packs })));
  assert.deepEqual(results.map((r) => [r.ok, r.packs]), [[true, 1], [true, 9], [true, 3], [true, 10], [true, 10]]);
  assert.deepEqual(w.draft().lines.map((l) => l.quantity), [{ value: 5, unit: 'KG' }, { value: 18, unit: 'KG' }, { value: 3, unit: 'L' },
    { value: 10, unit: 'PCS', basis: 'sales' }, { value: 95, unit: 'PCS', basis: 'items' }]); // "10 voita" pyydettiin myyntierinä
  const draft = w.draft();
  const quote = await w.orderingTools.quote({ customer, draft });
  const page = storefrontCartProjection(shoppingListView(draft, customer), quote);
  assert.equal(page.state, 'ready');
  assert.deepEqual(page.lines.map((l) => [l.id, l.qty, l.requested]), [['450005', 1, { value: 5, unit: 'KG' }], ['460520', 9, { value: 18, unit: 'KG' }],
    ['470001', 3, { value: 3, unit: 'L' }], ['450600', 10, { value: 10, unit: 'PCS' }], ['468121', 10, { value: 100, unit: 'PCS' }]]);
  assert.deepEqual(quote.lines.map((l) => l.salesUnits), results.map((r) => r.packs)); // kori, tarjous ja työkalu samaa mieltä
  assert.deepEqual((await w.run('get_cart')).lines.map((l) => l.packs), results.map((r) => r.packs));
  // Eri määrä myyntierinä kuin tarve (10 pussia 9:n sijaan) on asiakkaan valinta myyntierinä; 9 palauttaa tarpeen kiloina.
  const ten = await w.run('update_item', upd('L2', { productId: '460520', packs: 10 }));
  assert.deepEqual([ten.packs, w.draft().lines[1].quantity], [10, { value: 10, unit: 'PCS', basis: 'sales' }]);
  const nine = await w.run('update_item', upd('L2', { productId: '460520', packs: 9 }));
  assert.deepEqual([nine.packs, nine.total, w.draft().lines[1].quantity], [9, { amount: 18, unit: 'kg' }, { value: 18, unit: 'KG' }]);
  const quotes = w.calls.quote.length;
  assert.equal((await w.run('update_item', upd('L2', { productId: '460520', packs: 9 }))).unchanged, true); // uusinta ilman uutta tarjousta
  assert.equal(w.calls.quote.length, quotes);
  // Mallin oma muunnos on tarve: 50 sipulia → 6 kg, ja yksi 10 kg:n säkki pitää tarpeen 6 kg:na.
  await w.run('add_items', { items: [item('sipuli', 50, 'kpl')] });
  await w.run('update_item', upd('L6', { productId: '460195', amount: 6, unit: 'kg' }));
  const sack = await w.run('update_item', upd('L6', { productId: '460195', packs: 1 }));
  assert.deepEqual([sack.packs, sack.excess, w.draft().lines[5].quantity], [1, 4, { value: 6, unit: 'KG' }]);
  // Ilman päivää sama sääntö katalogin koolla.
  const v = world();
  await v.run('add_items', { items: [item('peruna', 18, 'kg')] });
  const early = await v.run('update_item', upd('L1', { productId: '460520', packs: 9 }));
  assert.deepEqual([early.packs, v.draft().lines[0].quantity], [9, { value: 18, unit: 'KG' }]);
});

test('kappaletarve, joka ei muunnu: myyntierät tallentuvat pakkausten painona, ja hintahuomio ei tule mallille', async () => {
  const w = world({ stale: ['460202'] });
  await w.run('add_items', { items: [item('sipuli', 50, 'kpl'), item('tilli', 10, 'kpl')] });
  await w.run('set_delivery_date', { date: '2026-11-20' });
  await w.run('set_diet', { allergens: [], diets: [], none: true, note: null });
  // 50 sipulia ja 1 kg:n pussit: malli valitsee 6 pussia, ja korisivun tarve on 6 kg (arviointi 19.11.: näkyi "6 kpl").
  const bags = await w.run('update_item', upd('L1', { productId: '460202', packs: 6 }));
  assert.deepEqual([bags.ok, bags.packs, bags.total, w.draft().lines[0].quantity], [true, 6, { amount: 6, unit: 'kg' }, { value: 6, unit: 'KG' }]);
  // Hintahuomio ("viimeisin tunnettu hinta") ei tule mallille: rajapinta on suljettu, ja huomio tuli joka tuotteelle.
  assert.deepEqual(bags.notes, []);
  const view = await w.run('get_cart');
  assert.deepEqual([view.lines[0].need, view.lines[0].amount], [{ amount: 50, unit: 'kpl' }, { amount: 6, unit: 'kg' }]);
  // Toinen pakkausmäärä samalle kappaletarpeelle: taas pakkausten paino.
  const seven = await w.run('update_item', upd('L1', { productId: '460202', packs: 7 }));
  assert.deepEqual([seven.packs, w.draft().lines[0].quantity], [7, { value: 7, unit: 'KG' }]);
  // Pakkauksen sisältöä ei tiedetä (tillinippu): myyntierät säilyvät myyntierinä.
  const bunch = await w.run('update_item', upd('L2', { productId: '460212', packs: 4 }));
  assert.deepEqual([bunch.packs, w.draft().lines[1].quantity], [4, { value: 4, unit: 'PCS', basis: 'sales' }]);
  const draft = w.draft();
  const quote = await w.orderingTools.quote({ customer, draft });
  const list = shoppingListView(draft, customer);
  assert.deepEqual(storefrontCartProjection(list, quote).lines.map((l) => [l.id, l.qty, l.requested]), [['460202', 7, { value: 7, unit: 'KG' }], ['460212', 4, { value: 4, unit: 'PCS' }]]);
  // Korisivun oma hintahuomio (cart-notes.mjs) on ennallaan.
  assert.deepEqual(cartNotes({ list, quote }).map((n) => n.kind), ['price']);
});

test('toimituspäivän vaihto tarkistaa valitut tuotteet ja purkaa valinnan, joka ei käy uudelle päivälle', async () => {
  const w = world({ avail: { 460202: { off: ['2026-11-16'] }, 470001: { from: '2026-11-18' } } });
  await w.run('add_items', { items: [item('sipuli', 5, 'kg'), item('kerma', 2, 'l')] });
  await w.run('set_diet', { allergens: [], diets: [], none: true, note: null });
  // Ilman päivää valinta tehdään katalogin koolla, ja hinta tarkistetaan päivää asetettaessa.
  const early = await w.run('update_item', upd('L1', { productId: '460202' }));
  assert.deepEqual([early.ok, early.packs, early.needsDeliveryDate, early.lineNet], [true, 5, true, null]);
  assert.equal(w.calls.quote.length, 0);
  await w.run('update_item', upd('L2', { productId: '470001' }));
  const friday = await w.run('set_delivery_date', { date: '2026-11-20' });
  assert.deepEqual(friday.products.map((p) => [p.ref, p.available]), [['L1', true], ['L2', true]]);
  assert.equal(friday.checklist.ready, true);
  same(w, friday);
  const monday = await w.run('set_delivery_date', { date: '2026-11-16' });
  assert.deepEqual(monday.products.map((p) => [p.ref, p.available, p.code, p.earliestDate ?? null]),
    [['L1', false, 'NOT_DELIVERABLE', null], ['L2', false, 'DELIVERY_DATE_SHIFT', '2026-11-18']]);
  assert.deepEqual(monday.checklist.products.missing, ['sipuli', 'kerma']);
  assert.deepEqual(w.draft().lines.map((l) => [l.selectedProductId, l.quantity]), [[null, { value: 5, unit: 'KG' }], [null, { value: 2, unit: 'L' }]]);
  same(w, monday);
  const cart1 = await w.run('get_cart');
  assert.equal(cart1.lines[1].unavailable.earliestDate, '2026-11-18');
  // Valinta suoraan päivälle, jolle tuotetta ei saa: virhe ja aikaisin päivä, ei valintaa.
  const shift = await w.run('update_item', upd('L2', { productId: '470001' }));
  assert.deepEqual([shift.error, shift.earliestDate], ['DELIVERY_DATE_SHIFT', '2026-11-18']);
  assert.equal((await w.run('set_delivery_date', { date: '2026-11-13' })).error, 'DATE_IN_PAST');
  assert.equal((await w.run('set_delivery_date', { date: '2026-02-30' })).error, 'INVALID_DATE');
});

test('mennyt toimituspäivä ja mennyt tilausaika poistuvat tarkistuslistalta ja korisivun review-tilasta', async () => {
  const w = world();
  await readyCart(w, '2026-11-16');
  assert.equal(w.review(), true);
  // Tilausaika (su 15.11. klo 12.00) menee: valinnat puretaan, kun tilannekuva tai työkalu seuraavan kerran luetaan.
  w.at('2026-11-15T11:00:00Z');
  const snap = w.tools.snapshot(w.ctx());
  assert.deepEqual(snap.notices.map((n) => n.code), ['CUTOFF_PASSED', 'CUTOFF_PASSED', 'CUTOFF_PASSED']);
  assert.equal(snap.checklist.ready, false);
  assert.equal(w.review(), false);
  assert.deepEqual(snap.checklist.products.missing, ['sipuli', 'kerma', 'peruna']);
  // Päivä menee: päivä tyhjennetään, tuotteet ja määrät säilyvät.
  const v = world();
  await readyCart(v, '2026-11-20');
  v.at('2026-11-21T08:00:00Z');
  const after = await v.run('get_cart');
  assert.deepEqual(after.notices.map((n) => n.code), ['DELIVERY_DATE_PASSED']);
  assert.equal(after.checklist.deliveryDate.done, false);
  assert.equal(v.draft().deliveryDate, null);
  assert.equal(v.review(), false);
  assert.equal(v.draft().lines.length, 3);
});

test('haku: ilman päivää katalogi, lisää vaihtoehtoja, puuttuva tuote ilman mallikutsua', async () => {
  const w = world();
  const plain = await w.run('search_products', search('sipuli', { amount: 6, unit: 'kg' }));
  assert.equal(plain.needsDeliveryDate, true);
  assert.equal(w.calls.search.length, 0);
  assert.deepEqual(plain.options.map((o) => o.productId), ['460195', '460202', '490001']);
  assert.equal('pricePerPack' in plain.options[0], false); // ei hintaa ilman päivää
  assert.deepEqual(plain.options[0].forAmount, { convertible: true, packs: 1, total: { amount: 10, unit: 'kg' }, excess: 4 });
  await w.run('set_delivery_date', { date: '2026-11-20' });
  const first = await w.run('search_products', search('kerma', { limit: 1 }));
  const second = await w.run('search_products', search('kerma', { limit: 1, more: true }));
  const third = await w.run('search_products', search('kerma', { limit: 1, more: true }));
  const fourth = await w.run('search_products', search('kerma', { limit: 1, more: true }));
  const ids = [first, second, third].map((r) => r.options[0].productId);
  assert.equal(new Set(ids).size, 3);
  assert.equal(fourth.options.length, 0);
  assert.equal(fourth.unavailable.reason, 'no_more_options');
  assert.equal((await w.run('search_products', search('kerma', { limit: 1 }))).options[0].productId, ids[0]); // more: false alkaa alusta
  // Tuote ilman hintaa: kerrotaan, eikä order-toolsin mallipohjaista lähivalitsijaa kutsuta.
  const truffle = await w.run('search_products', search('tryffeli'));
  assert.deepEqual([truffle.options.length, truffle.unavailable.reason], [0, 'unknown']);
  assert.match(truffle.unavailable.message, /ei ole nyt hintaa eikä saatavuutta/);
  assert.equal(w.calls.nearby, 0);
  const missing = await w.run('search_products', search('kamelinmaito'));
  assert.equal(missing.unavailable.reason, 'not_in_catalog');
  const late = world({ avail: { 470001: { from: '2026-11-18' }, 470002: { from: '2026-11-19' }, 470003: { from: '2026-11-19' } } });
  await late.run('set_delivery_date', { date: '2026-11-16' });
  const none = await late.run('search_products', search('kerma'));
  assert.deepEqual([none.unavailable.reason, none.unavailable.earliestDate], ['not_on_date', '2026-11-18']);
  assert.equal((await w.run('search_products', search('kerma', { ref: 'L9' }))).error, 'UNKNOWN_REF');
});

test('a passed order deadline is reported as the reason with the earliest day, not as a missing product', async () => {
  // Sessio E tuotannossa to 19.11. klo 17.18: "10 litraa kermaa ja 5 kg voita perjantaiks" kesti 24 s, ja vastaus oli vain,
  // ettei perjantaille löydy kermaa eikä voita. Syy (tilausaika meni klo 17.00) ja aikaisin päivä puuttuivat tuloksesta.
  const closedOn = { '2026-11-16': '2026-11-17' };
  const w = world({ avail: { 470001: { closed: closedOn }, 470002: { closed: closedOn }, 470003: { closed: closedOn } } });
  await w.run('set_delivery_date', { date: '2026-11-16' });
  const r = await w.run('search_products', search('kerma'));
  assert.equal(r.options.length, 0);
  assert.deepEqual([r.unavailable.reason, r.unavailable.earliestDate], ['cutoff_passed', '2026-11-17']);
  assert.match(r.unavailable.message, /^Tilausaika toimitukselle .*16\.11\. on jo mennyt: kerma\.$/);
  // Seuraavalle päivälle sama haku löytää tilattavaa.
  await w.run('set_delivery_date', { date: '2026-11-17' });
  assert.ok((await w.run('search_products', search('kerma'))).options.length > 0);
});

test('aiemmat tilaukset, tuotetiedot, uusi tilaus ja reseptilinkki', async () => {
  const order = (orderId, lines, status = 'confirmed') => ({ orderId, status, deliveryDate: '2026-11-10', createdAt: '2026-11-09T10:00:00Z', totals: { net: 20 },
    lines: lines.map(([productId, quantity]) => ({ productId, name: P[productId].name, quantity, salesUnitLabel: unitLabel(P[productId].salesUnit), lineNet: 5 })) });
  const orders = [order('AGW-3', [['470001', 4], ['460195', 1]]), order('AGW-2', [['470001', 2]]), order('AGW-1', [['460500', 1]], 'rejected')];
  const pages = [];
  const w = world({ orders, readPage: async (url) => { pages.push(url); return { url, title: 'Kermaperunat', text: 'pitkä teksti', recipes: [{ name: 'Kermaperunat', yield: '4 annosta', ingredients: ['1 kg perunoita', '3 dl kermaa'] }] }; } });
  const prev = await w.run('previous_orders');
  assert.deepEqual(prev.orders.map((o) => o.orderId), ['AGW-3', 'AGW-2']);
  assert.deepEqual(prev.orders[0].lines[0], { productId: '470001', name: 'Valio vispikerma 35 % 1 l', packs: 4, packUnit: 'kpl', lineNet: 5 });
  assert.deepEqual(prev.usual.lines.map((l) => [l.productId, l.packs]), [['470001', 3]]); // kahdessa tilauksessa, mediaani 3
  const details = await w.run('product_details', { productId: '470001' });
  assert.deepEqual([details.allergens.contains, details.storage, details.ingredients, details.co2PerKg, details.deliveryReliability], [['maito'], 'Kylmä', 'KERMA (MAITO).', 3.1, 0.97]);
  assert.equal((await w.run('product_details', { productId: '1' })).error, 'PRODUCT_NOT_FOUND');
  await readyCart(w);
  // Korisivun huomiot samoilla säännöillä (cart-notes.mjs): 10 kermaa, kun tavallisesti 3 (mediaani kahdesta tilauksesta).
  const lots = await w.run('update_item', upd('L2', { productId: '470001', packs: 10 }));
  assert.deepEqual(lots.notes.map((n) => [n.kind, n.text]), [['quantity', 'Tilaat 10 kpl, tavallisesti 3 kpl (vertailu 2 aiempaan tilaukseen).']]);
  const huge = await w.run('update_item', upd('L3', { productId: '460500', amount: 1500, unit: 'kg' }));
  assert.deepEqual([huge.packs, huge.warnings], [150, ['Poikkeuksellisen suuri määrä: 1500 kg. Varmista asiakkaalta.']]);
  // Tarpeen vaihto: uusi term ilman tuotetta purkaa valinnan; term ja tuote yhdessä vaihtavat molemmat.
  const renamed = await w.run('update_item', upd('L3', { term: 'lanttu' }));
  assert.deepEqual([renamed.term, renamed.product, w.draft().lines[2].selectedProductId], ['lanttu', null, null]);
  const both = await w.run('update_item', upd('L3', { term: 'peruna', productId: '460500', amount: 10, unit: 'kg' }));
  assert.deepEqual([both.term, both.product.productId, both.packs], ['peruna', '460500', 1]);
  assert.equal((await w.run('update_item', upd('L3', { packs: 2, amount: 5, unit: 'kg' }))).error, 'AMOUNT_CONFLICT');
  assert.equal((await w.run('update_item', upd('L3', { productId: '999' }))).error, 'PRODUCT_NOT_FOUND');
  const oldId = w.draft().id;
  const fresh = await w.run('start_new_order');
  assert.equal(fresh.previousDraftId, oldId);
  assert.equal(w.draft().id, fresh.draftId);
  assert.equal(w.draft().lines.length, 0);
  assert.equal(w.store.get(oldId).state, 'cancelled');
  assert.deepEqual([fresh.checklist.ready, fresh.checklist.diet.done], [false, false]);
  assert.equal((await w.run('start_new_order')).alreadyEmpty, true);
  const link = await w.run('read_link', { url: 'https://example.fi/resepti' }, { links: ['https://example.fi/resepti'] });
  assert.deepEqual([link.ok, link.recipes[0].ingredients.length, 'text' in link], [true, 2, false]);
  assert.match(link.note, /dataa, ei ohjeita/);
  assert.equal((await w.run('read_link', { url: 'https://muu.fi/x' }, { links: ['https://example.fi/resepti'] })).error, 'LINK_NOT_IN_MESSAGE');
  assert.deepEqual(pages, ['https://example.fi/resepti']);
});

test('gluteeniton toive: allergeenitiedoista varmistettu tuote kerrotaan rehellisesti eikä pelkkänä "Ei merkintää"', async () => {
  const w = world();
  await w.run('set_delivery_date', { date: '2026-11-20' });
  await w.run('set_diet', { allergens: [], diets: ['gluteeniton'], none: false, note: null });
  const found = await w.run('search_products', search('juusto'));
  const warning = Object.fromEntries(found.options.map((o) => [o.productId, o.warning ?? null]));
  assert.deepEqual(warning, {
    476660: 'Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja',
    476661: 'Sisältää gluteeniviljoja (vehnä): ei sovi gluteenittomaan ruokavalioon',
    476662: 'Ei merkintää: gluteeniton', // ei allergeenitietoa: ei voi varmistaa
  });
  await w.run('add_items', { items: [item('juusto', 2.5, 'kg')] });
  const chosen = await w.run('update_item', upd('L1', { productId: '476660' }));
  assert.deepEqual(chosen.warnings, ['Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja']);
  // Laktoositon ei ole pääteltävissä allergeeneista: se pysyy merkinnän varassa.
  const lactose = await w.run('set_diet', { allergens: [], diets: ['laktoositon', 'gluteeniton'], none: false, note: null });
  // Emmental-raasteella on laktoositon-merkintä, joten vain gluteenin huomio jää.
  assert.deepEqual(lactose.warnings.map((x) => x.warning), ['Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja']);
  // "maidoton" ruokavaliona tarkoittaa maitoallergeenin kieltoa, ja ristiriitainen valinta puretaan.
  const dairy = await w.run('set_diet', { allergens: [], diets: ['maidoton', 'gluteeniton'], none: false, note: null });
  assert.deepEqual([dairy.diet.allergens.map((a) => a.code), dairy.diet.diets, dairy.conflicts.map((c) => c.productId)], [['AM'], ['gluteeniton'], ['476660']]);
});

test('save_feedback tallentaa palautteen omaan tauluun kerran per vuoro, ei muuta koria, ja vanha palaute poistuu', async () => {
  const { openSqlite } = await import('../server/sqlite.mjs');
  const db = openSqlite(':memory:');
  const w = world({ db });
  const rows = () => db.prepare('SELECT customer_id, binding, conversation, kind, text, channel, message_id FROM agent_feedback ORDER BY created, kind').all().map((r) => ({ ...r }));
  const saved = await w.run('save_feedback', { text: '  vastaat jokaiseen viestiin erikseen ', kind: 'bug' }, { messageId: 'm-1' });
  assert.deepEqual([saved.ok, saved.saved, saved.kind, saved.checklist.ready], [true, true, 'bug', false]);
  assert.equal(w.draft(), null); // kori ei muuttunut eikä tyhjää luonnosta tallennettu
  await w.run('save_feedback', { text: 'vastaat jokaiseen viestiin erikseen', kind: 'bug' }, { messageId: 'm-1' }); // uusinta samassa vuorossa
  assert.deepEqual(rows(), [{ customer_id: 'c1', binding: 'v1', conversation: 'conv', kind: 'bug', text: 'vastaat jokaiseen viestiin erikseen', channel: 'whatsapp', message_id: 'm-1' }]);
  assert.equal((await w.run('save_feedback', { text: 'kiva botti', kind: 'Praise' }, { messageId: 'm-2' })).kind, 'praise'); // enumin kirjainkoko ei ratkaise
  assert.equal(rows().length, 2);
  assert.equal((await w.run('save_feedback', { text: 'x', kind: 'valitus' })).error, 'FEEDBACK_KIND');
  assert.equal((await w.run('save_feedback', { text: '   ', kind: 'idea' })).error, 'FEEDBACK_EMPTY');
  // Kori ja palaute samassa vuorossa: palaute ei muuta koria eikä sen revisiota.
  await w.run('add_items', { items: [item('maito', 10, 'l')] });
  const revision = w.draft().revision;
  await w.run('save_feedback', { text: 'pitäisikö bottia muuttaa', kind: 'other' }, { messageId: 'm-3' });
  assert.equal(w.draft().revision, revision);
  // Rajattu säilytys: yli 30 päivää vanha palaute poistuu seuraavassa tallennuksessa.
  w.at('2026-12-20T08:00:00Z');
  await w.run('save_feedback', { text: 'näytä kilohinnat', kind: 'idea' }, { messageId: 'm-9' });
  assert.deepEqual(rows().map((r) => r.kind), ['idea']);
  // Ilman luonnoskantaa palautetta ei väitetä tallennetuksi.
  assert.equal((await world().run('save_feedback', { text: 'testi', kind: 'other' })).error, 'FEEDBACK_UNAVAILABLE');
});

test('tallentamattomalla luonnoksella tunniste on null, tallennetun tunniste pysyy samana', async () => {
  const w = world();
  const first = w.tools.snapshot(w.ctx()); const cartView = await w.run('get_cart');
  assert.deepEqual([first.draftId, first.revision, cartView.draftId, cartView.revision], [null, null, null, null]);
  await w.run('add_items', { items: [item('maito', 10, 'l')] });
  const a = w.tools.snapshot(w.ctx()); const b = w.tools.snapshot(w.ctx());
  assert.deepEqual([a.draftId, b.draftId, a.revision], [w.draft().id, w.draft().id, w.draft().revision]);
  assert.equal((await w.run('get_cart')).draftId, w.draft().id);
});

test('luonnos on vanhan ytimen muotoinen, ja vaihtunut asiakkuus ei peri luonnosta', async () => {
  const w = world();
  const old = createOrderingConversation({ store: w.store, tools: w.orderingTools, now: () => Date.parse('2026-11-14T08:00:00Z'),
    interpretTurn: async () => ({ intent: 'order', ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: [] }] }) });
  await old({ messageId: 'm1', conversationId: 'old', customer, text: 'maitoa 5 l' });
  const legacy = w.store.active('old');
  const mine = cart.newDraft(customer);
  for (const key of Object.keys(legacy).filter((k) => !['offered', 'seen', 'pending', 'lastRef', 'lastRefTurn', 'turn', 'quote', 'compare'].includes(k))) assert.ok(key in mine, `uudesta luonnoksesta puuttuu ${key}`);
  // Vanhan ytimen luonnos jatkuu työkaluilla: rivi löytyy ja sen voi valita.
  const r = await w.tools.run('add_items', { items: [item('maito')] }, { ...w.ctx(), conversationId: 'old' });
  assert.deepEqual(r.items.map((i) => [i.ref, i.status]), [['L1', 'existing']]);
  await w.run('add_items', { items: [item('sipuli')] });
  const otherBinding = { ...customer, bindingVersion: 'v2' };
  const moved = await w.tools.run('get_cart', {}, { ...w.ctx(), customer: otherBinding });
  assert.equal(moved.lines.length, 0);
  assert.equal(w.store.active('conv'), null); // vanha luonnos suljettiin
  assert.equal((await w.tools.run('get_cart', {}, { ...w.ctx(), customer: { ...customer, permissions: {} } })).error, 'NOT_PERMITTED');
  assert.equal((await w.run('nonexistent')).error, 'UNKNOWN_TOOL');
});

// ---------- Oikea katalogi, simuloidut hinnat ja korisivun runtime ----------
const noCatalog = !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu';

test('oikea katalogi ja simuloidut hinnat: 50 sipulia, getStorefrontCart ja maksupolku työkalujen luonnoksella', { skip: noCatalog, timeout: 60000 }, async () => {
  const { createConfiguredOrdering } = await import('../server/order-conversation/runtime.mjs');
  const { seedBuyers } = await import('../server/gateway/mandate.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  const { loadCatalog } = await import('../server/catalog.mjs');
  const { clock } = await import('../server/gateway/clock.mjs');
  seedBuyers();
  const draftDb = path.join(dir, 'drafts.db'); const quoteDb = path.join(dir, 'quotes.db');
  const runtime = await createConfiguredOrdering({ draftDb, quoteDb });
  const now = () => clock.now().getTime();
  const tools = createAgentTools({ store: openDraftStore(draftDb, now), orderingTools: createOrderingTools({ dbPath: quoteDb, now }), catalog: loadCatalog(), gatewayOrders: orders, now, readPage: false });
  const real = { ...customer, customerId: 'c-real', buyerId: 'ravintola-kulma', bindingVersion: 'real-v1' };
  const ctx = { customer: real, conversationId: 'real', now: clock.now(), channel: 'whatsapp' };
  const run = (name, input = {}) => tools.run(name, input, { ...ctx, now: clock.now() });
  await run('add_items', { items: [item('sipuli', 50, 'kpl'), item('vispikerma', 3, 'l')] });
  assert.equal((await run('set_delivery_date', { date: '2026-11-16' })).ok, true);
  await run('set_diet', { allergens: [], diets: [], none: true, note: null });
  const onions = await run('search_products', search('', { ref: 'L1' }));
  assert.ok(onions.options.length > 0, JSON.stringify(onions.unavailable));
  assert.ok(onions.options.every((o) => o.forAmount.convertible === false || o.pack.items), 'kappaleita ei muunneta arvaamalla');
  const bag = onions.options.find((o) => o.pack.kg >= 1 && !o.pack.items && !o.pack.byWeight);
  assert.ok(bag, 'sipulipussi tai -säkki kilokokoineen');
  const asked = await run('update_item', upd('L1', { productId: bag.productId }));
  assert.equal(asked.error, 'UNIT_NOT_CONVERTIBLE');
  assert.equal(asked.pack.kg, bag.pack.kg);
  const kilos = await run('update_item', upd('L1', { productId: bag.productId, amount: 6, unit: 'kg' }));
  assert.equal(kilos.ok, true, kilos.message);
  assert.equal(kilos.packs, Math.ceil(6 / bag.pack.kg - 1e-9));
  const cream = await run('search_products', search('', { ref: 'L2' }));
  assert.ok(cream.options.length > 0);
  assert.ok(cream.options[0].pricePerPack > 0);
  const picked = await run('update_item', upd('L2', { productId: cream.options[0].productId }));
  assert.equal(picked.ok, true, picked.message);
  assert.equal(picked.lineNet, cream.options[0].forAmount.lineNet); // haun ja tarkistuksen luvut ovat samat
  const link = await run('send_cart_link');
  assert.equal(link.ok, true, JSON.stringify(link.missing || link.message));
  assert.equal(runtime.getShoppingList({ conversationId: 'real', customer: real }).status, 'review'); // korisivun oma luonnosvarasto
  const page = await runtime.getStorefrontCart({ conversationId: 'real', customer: real });
  assert.equal(page.state, 'ready', page.message);
  assert.deepEqual(page.lines.map((l) => l.id), [bag.productId, cream.options[0].productId]);
  assert.equal(page.lines[0].qty, kilos.packs);
  const shown = await runtime.handleTurn({ messageId: 'real-pay-1', conversationId: 'real', customer: real, text: 'näytä', receivedAt: Date.now() });
  assert.equal(shown.status, 'ready', shown.text);
  const paid = await runtime.handleTurn({ messageId: 'real-pay-2', conversationId: 'real', customer: real, text: 'TILAA', receivedAt: Date.now() });
  assert.ok(['confirmed', 'pending_approval'].includes(paid.status), paid.text);
  assert.ok(orders.list('ravintola-kulma').some((o) => o.buyerReference === `whatsapp:${link.draftId}`));
  runtime.close();
});

test('oikea katalogi: maitoallergia rajaa haun, ja muunnokset vastaavat tarjousta', { skip: noCatalog, timeout: 60000 }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const { touchesBanned } = await import('../server/allergens.mjs');
  const { clock } = await import('../server/gateway/clock.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  const cat = loadCatalog();
  const now = () => clock.now().getTime();
  const tools = createAgentTools({ store: openDraftStore(':memory:', now), orderingTools: createOrderingTools({ now }), catalog: cat, gatewayOrders: orders, now, readPage: false });
  const real = { ...customer, customerId: 'c-real2', buyerId: 'ravintola-kulma', bindingVersion: 'real-v2' };
  const run = (name, input = {}) => tools.run(name, input, { customer: real, conversationId: 'allergy', now: clock.now() });
  await run('set_delivery_date', { date: '2026-11-16' });
  await run('set_diet', { allergens: ['maito'], diets: [], none: false, note: null });
  for (const query of ['kerma', 'jogurtti', 'voi']) {
    const r = await run('search_products', search(query, { limit: 5 }));
    for (const o of r.options) assert.equal(touchesBanned(['AM'], cat.get(o.productId)), false, `${query}: ${o.name}`);
  }
  // Keliaakikko ja Emmental-raaste (476660, arvioinnin löydös A1): ei gluteeniton-merkintää, mutta allergeenitiedoissa vain maito.
  await run('set_diet', { allergens: [], diets: ['gluteeniton'], none: false, note: null });
  assert.deepEqual(cat.get('476660').contains, ['AM']);
  await run('add_items', { items: [item('juusto', 2.5, 'kg')] });
  const cheese = await run('update_item', upd('L1', { productId: '476660' }));
  assert.equal(cheese.ok, true, cheese.message);
  assert.deepEqual(cheese.warnings, ['Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja']);
  const grated = await run('search_products', search('emmental raaste', { limit: 5 }));
  for (const o of grated.options.filter((x) => x.productId === '476660')) assert.equal(o.warning, 'Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja');
  await run('remove_item', { ref: 'L1' });
  // Kiloina pyydetty: haun myyntierät ja rivihinta ovat samat kuin tarjouksen.
  await run('set_diet', { allergens: [], diets: [], none: true, note: null });
  const { ref } = (await run('add_items', { items: [item('peruna', 18, 'kg')] })).items[0];
  const potatoes = await run('search_products', search('', { ref }));
  const option = potatoes.options.find((o) => o.forAmount?.convertible);
  assert.ok(option);
  const chosen = await run('update_item', upd(ref, { productId: option.productId }));
  assert.deepEqual([chosen.packs, chosen.lineNet], [option.forAmount.packs, option.forAmount.lineNet]);
  // Valinta haun myyntierillä pitää tarpeen kiloina, jolloin korisivu näyttää 18 kg eikä myyntierien määrää.
  const byPacks = await run('update_item', upd(ref, { productId: option.productId, packs: option.forAmount.packs }));
  assert.deepEqual([byPacks.ok, byPacks.packs, byPacks.unchanged], [true, option.forAmount.packs, true]);
  assert.deepEqual((await run('get_cart')).lines[0].amount, { amount: 18, unit: 'kg' });
});
