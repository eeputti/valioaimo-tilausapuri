import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-order-tools-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
const { createOrderingTools, draftHash, lineQuery, rankOptions } = await import('../server/order-tools/index.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const date = '2026-11-16';
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', personName: 'Testi', permissions: { readProducts: true, placeOrders: true } };
const line = (ref, extra = {}) => ({ ref, productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [], ...extra });
const draftOf = (lines, extra = {}) => ({ id: 'd1', revision: 1, deliveryDate: date, lines, ...extra });
const found = (id, labels = [], extra = {}) => ({ id, name: `Tuote ${id}`, qty: 2, unitLabel: 'ltk', litres: 10, price: 5, labels, availability: { deliveryDate: date, stock: 50 }, ...extra });

// Injektoidut testivastaukset: ei katalogia, verkkoa tai gatewayn kantaa.
function fakes(over = {}) {
  const calls = { quote: [], order: [] }; let t = Date.parse('2026-11-14T08:00:00Z');
  const products = { 1: { hasAllergenData: true, contains: ['AM'] }, 2: { hasAllergenData: true, contains: [] }, 3: { hasAllergenData: false, contains: [] } };
  const tools = createOrderingTools({
    now: () => t, product: (id) => products[id], buyer: (id) => (id === 'b1' ? { id } : null),
    search: async () => [found('1', ['FREE_FROM_LACTOSE']), found('2'), found('3'), found('4')],
    requestQuote: async (buyer, input) => { calls.quote.push(input); return { quoteId: `Q${calls.quote.length}`, needs: input.needs.map((n) => ({ ref: n.ref, excluded: [], options: [{ kind: 'exact', deliveryDate: input.deliveryDate, expiresAt: new Date(t + 900_000).toISOString(), cutoff: null, cutoffLabel: null, offer: `jws-${n.ref}`,
      lines: [{ productId: n.candidates[0], name: `Tuote ${n.candidates[0]}`, quantity: 2, salesUnitLabel: 'ltk', covers: 20, unitPriceNet: 5, lineNet: 10, vatRate: 13.5, availability: { stockKnown: true } }] }] })) }; },
    placeOrder: async (buyer, input) => { calls.order.push(input); return { status: 'confirmed', orderId: 'AGW-1', deliveryDate: date, totals: { net: 10 }, reasons: [] }; },
    ...over,
  });
  return { tools, calls, tick: (ms) => { t += ms; } };
}
const approved = (draft, quoteId) => ({ customer, draft, quoteId, approval: { draftId: draft.id, revision: draft.revision, quoteId }, idempotencyKey: `wa-${draft.id}-r${draft.revision}` });

test('suggest vaatii päivän ja määrän eikä näytä tuotteita ilman oikeutta', async () => {
  const { tools } = fakes();
  const missing = await tools.suggest({ customer, draft: draftOf([line('a', { quantity: null })], { deliveryDate: null }) });
  assert.deepEqual(missing.issues.map((i) => i.code), ['DELIVERY_DATE_MISSING', 'QUANTITY_MISSING']);
  assert.equal(missing.lines.length, 0);
  const denied = await tools.suggest({ customer: { ...customer, permissions: {} }, draft: draftOf([line('a')]) });
  assert.equal(denied.issues[0].code, 'NOT_PERMITTED');
});

test('suggest antaa enintään kolme vaihtoehtoa, pyytää tarkennuksen vain jakavasta väittämästä ja pitää allergiakiellon', async () => {
  const { tools } = fakes();
  const s = await tools.suggest({ customer, draft: draftOf([line('a')]) });
  assert.equal(s.lines[0].options.length, 3);
  assert.equal(s.lines[0].total, 4);
  assert.deepEqual(s.lines[0].clarify, ['FREE_FROM_LACTOSE']); // 1/4 tilattavista on laktoosittomia
  assert.deepEqual(s.lines[0].options[0], { productId: '1', name: 'Tuote 1', brand: null, salesUnits: 2, salesUnitLabel: 'ltk', covers: { value: 20, unit: 'L' }, unitPriceNet: 5, lineNet: 10, deliveryDate: date, cutoff: null, stock: 50, labels: ['FREE_FROM_LACTOSE'], note: null, lactoseFree: false, co2PerKg: null, deliveryReliability: null, why: null,
    // Nimessä ei ole pyydettyä sanaa (injektoitu haku), joten vaihtoehto on lähin; halvin tarpeen kattava on aina mukana.
    pick: { place: 1, codes: ['NEAREST', 'CHEAPEST'] }, pool: { orderable: 4, suitable: 4, requested: 0, shown: 3, more: true, nextPage: false }, warning: null });
  const asked = await tools.suggest({ customer, draft: draftOf([line('a', { claims: ['FREE_FROM_LACTOSE'] })]) });
  assert.deepEqual(asked.lines[0].clarify, []);
  // Maidoton: tuote 1 sisältää maitoa, tuotteilta 3 ja 4 puuttuu allergeenitieto. Vain 2 kelpaa.
  const dairyFree = await tools.suggest({ customer, draft: draftOf([line('a', { excludeAllergens: ['AM'] })]) });
  assert.deepEqual(dairyFree.lines[0].options.map((o) => o.productId), ['2']);
  const failing = fakes({ search: async () => { throw new Error('verkko'); } });
  const down = await failing.tools.suggest({ customer, draft: draftOf([line('a')]) });
  assert.equal(down.issues[0].code, 'SEARCH_FAILED');
  assert.equal(down.lines.length, 0);
  assert.equal(lineQuery(line('a', { claims: ['FREE_FROM_LACTOSE'] })), '20 l laktoositon maito');
  // Myyntipakkaukset sanalla, jonka jäsennin tuntee yksiköksi; yksittäiset kappaleet sanalla kpl.
  assert.equal(lineQuery({ productTerm: 'banaani', quantity: { value: 3, unit: 'PCS' } }), '3 pakettia banaani');
  assert.equal(lineQuery({ productTerm: 'kananmuna', quantity: { value: 100, unit: 'PCS', basis: 'items' } }), '100 kpl kananmuna');
});

test('koko tilauksen ruokavalio: sisältävä pois, puuttuva allergeenitieto näkyy varoituksena, merkintä on pehmeä', async () => {
  const seen = [];
  const { tools } = fakes({ search: async (l) => { seen.push(l.claims); return l.claims.includes('FREE_FROM_GLUTEN') ? [] : [found('1', ['FREE_FROM_LACTOSE']), found('2'), found('3')]; } });
  const nutFree = await tools.suggest({ customer, draft: draftOf([line('a')], { diet: { claims: [], excludeAllergens: ['AM'] } }) });
  // Tuote 1 sisältää maitoa: pois. Tuote 2 on varmennettu. Tuotteelta 3 puuttuu tieto: näytetään varoituksella lisäsivulla,
  // koska maitoa esiintyy saman haun tuotteissa ja varmennettu vaihtoehto on (itsepeli V033).
  assert.deepEqual(nutFree.lines[0].options.map((o) => [o.productId, o.warning]), [['2', null]]);
  assert.equal(nutFree.lines[0].more, true);
  const page2 = await tools.suggest({ customer, draft: draftOf([line('a')], { diet: { claims: [], excludeAllergens: ['AM'] } }), exclude: { a: ['2'] } });
  assert.deepEqual(page2.lines[0].options.map((o) => [o.productId, o.warning]), [['3', 'allergeenitieto puuttuu, tarkista itse']]);
  // Halvin on aina näkyvissä, vaikka se ei olisi järjestyksen kärjessä. Kun muut maksavat yli kaksi kertaa sen verran, se näytetään ensin.
  const pricey = fakes({ search: async () => [found('2'), found('5'), found('6'), found('7', [], { price: 1 })] });
  assert.deepEqual((await pricey.tools.suggest({ customer, draft: draftOf([line('a')]) })).lines[0].options.map((o) => o.productId), ['7', '2', '5']);
  const near = fakes({ search: async () => [found('2'), found('5'), found('6'), found('7', [], { price: 3 })] });
  assert.deepEqual((await near.tools.suggest({ customer, draft: draftOf([line('a')]) })).lines[0].options.map((o) => o.productId), ['2', '5', '7']);
  // Merkinnällä rajattu haku palautti saman ryhmän muita tuotteita (gluteeniton + tilli → maustesuola): näytetään pyydetty tuote,
  // ja puuttuva merkintä kerrotaan vain niille, joilta se puuttuu.
  const dill = fakes({ search: async (l) => (l.claims.includes('FREE_FROM_GLUTEN') ? [found('9', ['FREE_FROM_GLUTEN'], { name: 'KNORR Umami maustesuola 1kg' })]
    : [found('2', [], { name: 'GREENS 1KG TILLI' }), found('5', ['FREE_FROM_GLUTEN'], { name: 'Tilli kuivattu 100 g gluteeniton' })]) });
  const dillOptions = (await dill.tools.suggest({ customer, draft: draftOf([line('a', { productTerm: 'tilli' })], { diet: { claims: ['FREE_FROM_GLUTEN'], excludeAllergens: [] } }) })).lines[0].options;
  assert.deepEqual(dillOptions.map((o) => [o.productId, o.warning]), [['2', 'Ei merkintää: gluteeniton'], ['5', null]]);
  // Kun merkitty osuma on pyydetty tuote, toista hakua ei tehdä eikä merkitsemättömiä näytetä.
  let searches = 0;
  const milk = fakes({ search: async (l) => { searches++; return l.claims.includes('FREE_FROM_LACTOSE') ? [found('2', ['FREE_FROM_LACTOSE'], { name: 'Valio Eila maitojuoma 1 l laktoositon' })] : [found('5', [], { name: 'Valio kevytmaito 1 l' })]; } });
  const milkOptions = (await milk.tools.suggest({ customer, draft: draftOf([line('a')], { diet: { claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [] } }) })).lines[0].options;
  assert.deepEqual([milkOptions.map((o) => o.productId), searches], [['2'], 1]);
  // Rivin oma kielto on tiukka: varmentamaton ei kelpaa.
  const strict = await tools.suggest({ customer, draft: draftOf([line('a', { excludeAllergens: ['AM'] })]) });
  assert.deepEqual(strict.lines[0].options.map((o) => o.productId), ['2']);
  // Merkintää ei löydy yhdeltäkään: näytetään ilman merkintää ja kerrotaan se, ei tyhjää listaa.
  seen.length = 0;
  const gluten = await tools.suggest({ customer, draft: draftOf([line('a')], { diet: { claims: ['FREE_FROM_GLUTEN'], excludeAllergens: [] } }) });
  assert.deepEqual(seen, [['FREE_FROM_GLUTEN'], []]);
  assert.equal(gluten.lines[0].options[0].warning, 'Ei merkintää: gluteeniton');
  // Tarjous estää valinnan, joka sisältää tilauksen kieltämää allergeenia, ja ruokavalio kuuluu sisällön tiivisteeseen.
  const d1 = draftOf([line('a', { selectedProductId: '1' })], { diet: { claims: [], excludeAllergens: ['AM'] } });
  assert.equal((await tools.quote({ customer, draft: d1 })).issues[0].code, 'ALLERGEN_CONFLICT');
  assert.notEqual(draftHash(customer, d1), draftHash(customer, { ...d1, diet: { claims: [], excludeAllergens: [] } }));
});

test('quote vaatii käyttäjän valinnan, ei vaihda toimituspäivää hiljaa ja estää allergiaristiriidan', async () => {
  const { tools, calls } = fakes();
  assert.equal((await tools.quote({ customer, draft: draftOf([line('a')]) })).issues[0].code, 'PRODUCT_NOT_SELECTED');
  assert.equal((await tools.quote({ customer, draft: draftOf([line('a', { selectedProductId: '1', excludeAllergens: ['AM'] })]) })).issues[0].code, 'ALLERGEN_CONFLICT');
  assert.equal(calls.quote.length, 0);
  const ok = await tools.quote({ customer, draft: draftOf([line('a', { selectedProductId: '2' })]) });
  assert.equal(ok.quoteId, 'Q1');
  assert.deepEqual(ok.totals, { net: 10, vat: 1.35, gross: 11.35, currency: 'EUR' });
  assert.deepEqual(calls.quote[0].needs[0], { ref: 'a', candidates: ['2'], quantity: { value: 20, unit: 'L' }, allowSubstitutes: false });
  const shifted = fakes({ requestQuote: async (b, input) => ({ quoteId: 'Q9', needs: [{ ref: 'a', excluded: [], options: [{ kind: 'exact', deliveryDate: '2026-11-17', expiresAt: new Date().toISOString(), lines: [{ name: 'Tuote 2' }] }] }] }) });
  const late = await shifted.tools.quote({ customer, draft: draftOf([line('a', { selectedProductId: '2' })]) });
  assert.equal(late.quoteId, null);
  assert.equal(late.issues[0].code, 'DELIVERY_DATE_SHIFT');
  const broken = fakes({ requestQuote: async () => { throw new Error('alhaalla'); } });
  assert.equal((await broken.tools.quote({ customer, draft: draftOf([line('a', { selectedProductId: '2' })]) })).issues[0].code, 'QUOTE_FAILED');
});

test('submit tallentaa hyväksytyn luonnoksen kerran ja palauttaa uusinnalle saman tilauksen', async () => {
  const { tools, calls, tick } = fakes();
  const draft = draftOf([line('a', { selectedProductId: '2' })]);
  const q = await tools.quote({ customer, draft });
  const first = await tools.submit(approved(draft, q.quoteId));
  assert.equal(first.status, 'confirmed');
  assert.deepEqual(calls.order[0], { offers: ['jws-a'], idempotencyKey: 'wa-d1-r1', buyerReference: 'whatsapp:d1', requestedBy: 'Testi' });
  tick(3600_000); // uusinta tarjouksen vanhenemisen jälkeenkin palauttaa saman tuloksen
  assert.deepEqual(await tools.submit(approved(draft, q.quoteId)), first);
  assert.equal(calls.order.length, 1);
  assert.equal((await tools.submit({ ...approved(draft, q.quoteId), idempotencyKey: 'toinen-avain' })).reasons[0].code, 'QUOTE_ALREADY_USED');
});

test('submit hylkää vanhan hyväksynnän, muuttuneen sisällön, vieraan asiakkaan, vanhentuneen tarjouksen ja puuttuvan oikeuden', async () => {
  const { tools, calls, tick } = fakes();
  const draft = draftOf([line('a', { selectedProductId: '2' })]);
  const q = await tools.quote({ customer, draft });
  const code = async (args) => { const r = await tools.submit(args); assert.equal(r.status, 'rejected'); assert.equal(r.orderId, null); return r.reasons[0].code; };
  const bumped = { ...draft, revision: 2 };
  assert.equal(await code(approved(bumped, q.quoteId)), 'APPROVAL_MISMATCH');
  assert.equal(await code({ ...approved(draft, q.quoteId), approval: null }), 'APPROVAL_MISMATCH');
  // Sama revisioluku, eri sisältö: tarjous on sidottu sisältöön eikä asiakkaan lähettämään numeroon.
  const changed = { ...draft, lines: [line('a', { selectedProductId: '2', quantity: { value: 30, unit: 'L' } })] };
  assert.notEqual(draftHash(customer, changed), draftHash(customer, draft));
  assert.equal(await code(approved(changed, q.quoteId)), 'DRAFT_CHANGED');
  assert.equal(await code({ ...approved(draft, q.quoteId), customer: { ...customer, customerId: 'c2' } }), 'QUOTE_NOT_FOUND');
  assert.equal(await code({ ...approved(draft, q.quoteId), customer: { ...customer, bindingVersion: 'v2' } }), 'QUOTE_NOT_FOUND');
  assert.equal(await code({ ...approved(draft, q.quoteId), customer: { ...customer, permissions: { readProducts: true } } }), 'NOT_PERMITTED');
  assert.equal(await code({ ...approved(draft, q.quoteId), idempotencyKey: 'x' }), 'IDEMPOTENCY_KEY_REQUIRED');
  tick(16 * 60_000);
  assert.equal(await code(approved(draft, q.quoteId)), 'QUOTE_EXPIRED');
  assert.equal(calls.order.length, 0);
});

test('oikeudet tarkistetaan tuoreesti ennen tilausta eikä tallennusvirhe näytä onnistumiselta', async () => {
  let allowed = false; let fail = true;
  const { tools, calls } = fakes({ permissions: async () => ({ readProducts: true, placeOrders: allowed }),
    placeOrder: async (b, input) => { calls.order.push(input); if (fail) throw new Error('kanta'); return { status: 'pending_approval', orderId: 'AGW-2', reasons: [{ code: 'SPEND_CAP_ORDER', message: 'Katto', severity: 'approval' }] }; } });
  const draft = draftOf([line('a', { selectedProductId: '2' })]);
  const q = await tools.quote({ customer, draft });
  assert.equal((await tools.submit(approved(draft, q.quoteId))).reasons[0].code, 'NOT_PERMITTED');
  allowed = true;
  assert.equal((await tools.submit(approved(draft, q.quoteId))).reasons[0].code, 'ORDER_FAILED');
  fail = false; // epäonnistunut yritys ei kuluta tarjousta: sama hyväksyntä voidaan yrittää uudelleen
  const ok = await tools.submit(approved(draft, q.quoteId));
  assert.equal(ok.status, 'pending_approval');
  assert.deepEqual(ok.reasons, [{ code: 'SPEND_CAP_ORDER', message: 'Katto', severity: 'approval' }]);
});

test('vaihtoehtojen järjestys: perustuote ennen maustettua ja sopiva pakkaus ennen pikkupakkauksia, mitään ei pudoteta', () => {
  const o = (name, qty, size, brand = 'Valio') => ({ id: name, name, brand, qty, litres: size, kg: size });
  const cream = [o('Valio Keittiön ruokakerma 2,5 dl kolme sipulia UHT laktoositon', 2, 3.75), o('Millac Gold Ruoka & Vispi 33 kasvirasvan ja kerman sekoitus UHT 1L', 5, 1, 'Millac Gold'), o('Valio Keittiön kuohukerma 2 dl', 5, 1), o('Valio ruokakerma 15 % 1 l UHT laktoositon', 5, 1)];
  const ranked = rankOptions(cream, { productTerm: 'kerma', quantity: { value: 5, unit: 'L' } }).map((x) => x.name);
  assert.deepEqual(ranked.slice(0, 2), ['Valio Keittiön kuohukerma 2 dl', 'Valio ruokakerma 15 % 1 l UHT laktoositon']);
  assert.equal(ranked.length, 4);
  // 25 pikkupakkausta jää 10 isomman taakse, vaikka haku antoi sen halvempana ensin.
  const butter = [o('Valio Eila® voi 200 g laktoositon', 25, 0.2), o('Valio voi 500 g normaalisuolainen', 10, 0.5)];
  assert.equal(rankOptions(butter, { productTerm: 'voi', quantity: { value: 5, unit: 'KG' } })[0].name, 'Valio voi 500 g normaalisuolainen');
  // Lajikenimi ei ole mauste: haun oma järjestys säilyy tuoretuotteilla.
  const potato = [o('VARHAISPERUNA (KESÄPERUNA) PESTY FI', 10, 1, null), o('PP PUIKULA PERUNA PESTY', 10, 1, null), o('PERUNA ROSAMUNDA PESTY', 10, 1, null)];
  assert.deepEqual(rankOptions(potato, { productTerm: 'peruna', quantity: { value: 10, unit: 'KG' } }), potato);
  // Ostajan itse pyytämä maku on osa tuotetta, ei poikkeama.
  const yoghurt = [o('Valiojogurtti® 1 kg mansikka vanilja', 10, 1), o('Valio luonnonjogurtti 1 kg', 10, 1)];
  assert.equal(rankOptions(yoghurt, { productTerm: 'jogurtti', quantity: { value: 10, unit: 'KG' } })[0].name, 'Valio luonnonjogurtti 1 kg');
  assert.equal(rankOptions(yoghurt, { productTerm: 'mansikka vanilja jogurtti', quantity: { value: 10, unit: 'KG' } })[0].name, 'Valiojogurtti® 1 kg mansikka vanilja');
  // Yli kaksi kertaa halvimman hintainen erikoistuote tai annospakkaus ei nouse kärkeen, vaikka eriä olisi vähemmän.
  const priced = (name, qty, size, price) => ({ ...o(name, qty, size), price });
  const milk = [priced('Valio Eila® kevytmaitojuoma 2,5 dl UHT laktoositon', 267, 3.75, 10.71), priced('Valio rasvaton maito 1 l ESL', 1000, 1, 0.88), priced('Valio kevytmaito 1 l ESL', 1000, 1, 1)];
  assert.deepEqual(rankOptions(milk, { productTerm: 'maito', quantity: { value: 1000, unit: 'L' } }).map((x) => x.name), [milk[1].name, milk[2].name, milk[0].name]);
  const browned = [priced('Jokilaakson Juusto Ruskistettu Voi 1,2kg', 9, 1.2, 23.95), priced('Valio voi 500 g suolaamaton', 20, 0.5, 3.3)];
  assert.equal(rankOptions(browned, { productTerm: 'voi', quantity: { value: 10, unit: 'KG' } })[0].name, 'Valio voi 500 g suolaamaton');
});

test('oikea haku ja gateway simuloidulla rajapinnalla: vaihtoehdot, tarjous ja yksi demotilaus', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const { seedBuyers } = await import('../server/gateway/mandate.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  seedBuyers();
  const tools = createOrderingTools();
  // Pakkausmäärä ei saa ohittaa raaka-aineen omaa hyllyä: banaani on banaania, ei banaanijogurttia.
  const { searchStorefront } = await import('../server/storefront.mjs');
  const bananas = (await searchStorefront(lineQuery({ productTerm: 'banaani', quantity: { value: 3, unit: 'PCS' } }), { deliveryDate: '2026-11-16', llm: false })).cards[0]?.list || [];
  assert.ok(bananas.length && bananas.every((x) => /^(LUOMU )?BANAANI/.test(x.name)), bananas.map((x) => x.name).join(' | '));
  const real = { ...customer, buyerId: 'ravintola-kulma' };
  const draft = draftOf([line('a', { claims: ['FREE_FROM_LACTOSE'] }), line('b', { productTerm: 'kananmuna', quantity: { value: 100, unit: 'PCS', basis: 'items' } })]);
  const s = await tools.suggest({ customer: real, draft });
  assert.deepEqual(s.issues, []);
  for (const l of s.lines) assert.ok(l.options.length >= 1 && l.options.length <= 3);
  assert.ok(s.lines[0].options.every((o) => o.labels.includes('FREE_FROM_LACTOSE')));
  assert.ok(s.lines[1].options[0].covers.unit === 'PCS' && s.lines[1].options[0].covers.value >= 100);
  const cream = await tools.suggest({ customer: real, draft: draftOf([line('k', { productTerm: 'kerma', quantity: { value: 5, unit: 'L' } })]) });
  assert.doesNotMatch(cream.lines[0].options[0].name, /sipuli|Millac/i);
  draft.lines.forEach((l, i) => { l.selectedProductId = s.lines[i].options[0].productId; });
  const q = await tools.quote({ customer: real, draft });
  assert.deepEqual(q.issues, []);
  assert.equal(q.lines.length, 2);
  const args = { ...approved(draft, q.quoteId), customer: real };
  const first = await tools.submit(args);
  assert.ok(['confirmed', 'pending_approval'].includes(first.status), JSON.stringify(first));
  assert.equal((await tools.submit(args)).orderId, first.orderId);
  assert.equal(orders.list('ravintola-kulma').length, 1);
  assert.equal(orders.list('ravintola-kulma')[0].buyerReference, 'whatsapp:d1');
});

test('näytettävissä kolmessa yli kaksi kertaa halvimman hintainen vaihtoehto ei ole ensimmäisenä', async () => {
  // Perunan tapaus oikealta rajapinnalta: kallis säkki kärjessä ja halvin kolmantena.
  const potato = (id, price, qty, kg) => found(id, [], { name: `Peruna ${id}`, price, qty, kg, litres: undefined, unitLabel: 'kpl' });
  const { tools } = fakes({ product: () => ({ hasAllergenData: true, contains: [] }),
    search: async () => [potato('sakki', 36.2, 2, 10), potato('ratte', 20, 2, 10), potato('pesty', 19, 2, 10), potato('irto', 0.665, 20, 1)] });
  const s = await tools.suggest({ customer, draft: draftOf([line('a', { productTerm: 'peruna', quantity: { value: 20, unit: 'KG' } })]) });
  assert.deepEqual(s.lines[0].options.map((o) => [o.productId, o.lineNet]), [['irto', 13.3], ['sakki', 72.4], ['ratte', 40]]);
  // Kun hinnat ovat lähellä toisiaan, järjestys ei muutu.
  const even = fakes({ search: async () => [found('1'), found('2', [], { price: 6 }), found('3', [], { price: 4 })] });
  assert.deepEqual((await even.tools.suggest({ customer, draft: draftOf([line('a')]) })).lines[0].options.map((o) => o.productId), ['1', '2', '3']);
});

test('laktoositarkennus vain, kun oikeissa vaihtoehdoissa on tunnettu maitoainesosa', async () => {
  // Kananmunat: vaihtelevat laktoositon-merkinnät eivät tee kysymyksestä olennaista, jos missään ei ole maitoa.
  const eggs = fakes({ product: () => ({ hasAllergenData: true, contains: ['AE'] }) });
  const e = await eggs.tools.suggest({ customer, draft: draftOf([line('a', { productTerm: 'kananmunat' })]) });
  assert.equal(e.lines[0].options.length, 3);
  assert.deepEqual(e.lines[0].clarify, []);
  // Maito: sama merkintöjen jakauma ja maitoainesosa säilyttävät kohdennetun tarkennuksen.
  const milk = fakes({ product: () => ({ hasAllergenData: true, contains: ['AM'] }) });
  const m = await milk.tools.suggest({ customer, draft: draftOf([line('a')]) });
  assert.deepEqual(m.lines[0].clarify, ['FREE_FROM_LACTOSE']);
});

test('laktoositarkennus lasketaan pyydetyn tuotteen vaihtoehdoista, ei hakuun osuneista muista tuotteista', async () => {
  // Itsepeli X097: perunahaun maitoa sisältävä muusijauhe sai kysymään perunasta laktoosittomuutta.
  // Haku merkitsee pyydetyn tuotetyypin requested-kentällä (perunat true, muusijauhe false), kuten oikealla katalogilla.
  const potato = (id, name, labels) => found(id, labels, { name, kg: 1, litres: undefined, qty: 15, requested: id.startsWith('P') });
  const contains = { P1: [], P2: [], P3: [], P4: ['AM'], M1: ['AM'], M2: ['AM'] };
  const { tools } = fakes({ product: (id) => ({ hasAllergenData: true, contains: contains[id] || [] }),
    // Pyydetyissäkin voi olla yksittäinen maitoa sisältävä tuote (pakastemuusi) ja laktoositon-merkintöjä: ei silti maitotuote.
    search: async () => [potato('P1', 'Peruna pesty 1 kg', ['FREE_FROM_LACTOSE']), potato('P2', 'Peruna kesä 1 kg', []), potato('P3', 'Peruna Rosamunda 1 kg', []), potato('P4', 'Perunamuusi pakaste 3 kg', []),
      potato('M1', 'Perunamuusijauhe laktoositon 1 kg', ['FREE_FROM_LACTOSE']), potato('M2', 'Perunamuusijauhe 1 kg', [])] });
  const s = await tools.suggest({ customer, draft: draftOf([line('a', { productTerm: 'peruna', quantity: { value: 15, unit: 'KG' } })]) });
  assert.deepEqual(s.lines[0].clarify, []);
});
