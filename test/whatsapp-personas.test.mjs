// 100 persoonan itsekeskustelun deterministiset tarkistukset. Ei mallikutsuja, ei verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PERSONAS, REGRESSIONS, inspectPersona, parseOptions } from '../eval/whatsapp-personas.mjs';
import { inspectConversation } from '../eval/whatsapp-selfplay-cases.mjs';
import { costUsd, modelOf, simTierFromEnv, restoreTurns, summarize, loadCases, CASE_SETS, patchDeepEffort } from '../scripts/whatsapp-selfplay-batch.mjs';
import { EXTENDED, SLOTS, earliestDate } from '../eval/whatsapp-personas-extended.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');

test('100 yksilöllistä persoonaa runSelfplayn case-skeemassa, 20 polkua ja keittiöiden kirjo', () => {
  assert.equal(PERSONAS.length, 100);
  assert.equal(new Set(PERSONAS.map((p) => p.id)).size, 100);
  assert.equal(new Set(PERSONAS.map((p) => p.first)).size, 100, 'ensimmäiset viestit eivät toistu');
  const routes = {}; for (const p of PERSONAS) routes[p.route] = (routes[p.route] || 0) + 1;
  assert.equal(Object.keys(routes).length, 20); assert.ok(Object.values(routes).every((n) => n === 5));
  assert.ok(new Set(PERSONAS.map((p) => p.kitchen)).size >= 12);
  assert.ok(new Set(PERSONAS.map((p) => p.style)).size === 6);
  for (const p of PERSONAS) {
    assert.match(p.id, /^S\d{3}$/u);
    assert.ok(p.first.length > 5 && p.first.length < 300, p.id);
    assert.ok(p.brief.includes('pyydä linkki ostoskoriin'), p.id);
    assert.match(p.date, /^2026-11-(16|17|18|19|20)$/u, p.id);
    assert.ok(p.maxTurns >= 5 && p.maxTurns <= 10, p.id);
    assert.ok(Object.keys(p.expected).length >= 1, p.id);
    for (const [key, q] of Object.entries(p.expected)) {
      assert.ok(Number.isFinite(q.value) && q.value > 0, `${p.id} ${key}`);
      assert.ok(['L', 'KG', 'PCS'].includes(q.unit), `${p.id} ${key}`);
      // Avain ei saa osua saman persoonan toiseen riviin (esim. kahvi vs. kahvikerma ilman not-sääntöä).
      for (const [other, oq] of Object.entries(p.expected)) if (other !== key) assert.ok(!other.includes(key) || (q.not || []).some((n) => other.includes(n)), `${p.id}: ${key} osuu riviin ${other}`);
    }
  }
});

test('uudet polut ovat mukana: päivä puuttuu, 4 = lisää vaihtoehtoja, numerovalinta, annoslasku, olematon tuote', () => {
  assert.ok(PERSONAS.filter((p) => !p.dateInFirst).length >= 25);
  assert.equal(PERSONAS.filter((p) => p.wantsMore).length, 10);
  assert.equal(PERSONAS.filter((p) => p.pickNumber === 2).length, 5);
  assert.equal(PERSONAS.filter((p) => p.unavailable).length, 10);
  const portions = PERSONAS.filter((p) => p.route === 'portions');
  assert.deepEqual(portions.map((p) => Object.values(p.expected)[0].value), [18, 10, 20, 18, 12]);
  assert.ok(PERSONAS.some((p) => p.requiredAllergen === 'AM') && PERSONAS.some((p) => p.requiredClaim === 'FREE_FROM_GLUTEN'));
  assert.deepEqual(PERSONAS.filter((p) => p.route === 'unit-correction').map((p) => Object.values(p.expected)[0].value), [0.5, 0.5, 20, 0.25, 3]);
});

test('jokaiselle tavoitetuotteelle löytyy tilattava vaihtoehto ja olemattomille ei (simuloitu haku)', { skip: !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-personas-test-'));
  Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
    AIMO_LEARNED: path.join(dir, 'learned.json'), AIMO_CATALOG: CATALOG, GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const { createOrderingTools } = await import('../server/order-tools/index.mjs');
  const tools = createOrderingTools();
  const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 1, permissions: { readProducts: true } };
  const suggest = async (term, quantity, date) => (await tools.suggest({ customer, draft: { id: 'd', deliveryDate: date, diet: { known: true, claims: [], excludeAllergens: [] },
    lines: [{ ref: 'L1', productTerm: term, quantity, claims: [], excludeAllergens: [] }] } })).lines[0]?.options || [];
  const seen = new Set();
  // Laajennetun joukon odotetut päivät ovat ti–pe tai kiirepoluilla aikaisin päivä, jotka ovat tilattavissa myös klo 9.00 kellolla.
  for (const p of [...PERSONAS, ...REGRESSIONS, ...EXTENDED]) for (const [key, q] of Object.entries(p.expected)) {
    const term = q.label; const id = `${term}|${p.date}`; if (seen.has(id)) continue; seen.add(id);
    assert.ok((await suggest(term, { value: q.value, unit: q.unit }, p.date)).length > 0, `${p.id}: ${term} ${p.date}`);
  }
  for (const term of ['kaviaari', 'ananas', 'appelsiinituoremehu']) assert.equal((await suggest(term, { value: 1, unit: 'KG' }, '2026-11-17')).length, 0, term);
});

// Synteettinen keskustelu nykyisen ytimen vastausmuodossa (server/order-conversation/index.mjs).
const list = (date, lines) => ({ deliveryDate: date, diet: { known: true, claims: [], excludeAllergens: [] }, lines });
const line = (term, value, unit, extra = {}) => ({ ref: `L-${term}`, productTerm: term, quantity: { value, unit }, claims: [], excludeAllergens: [], selectedProductId: null, ...extra });
const OPTIONS_A = '*Broilerin rintafilee 10 kg*\n1. Seara Broilerin rintafilee 2kg pakaste: 5 pkt (10 kg), 47,20 €\n2. Happy Chef rintafileeviipale 2,5kg: 4 pkt (10 kg), 51,00 €\n3. Atria broilerin rintafilee 1 kg: 10 pkt (10 kg), 89,00 €\n\nVastaa numerolla. Kirjoita 4, niin näytän lisää vaihtoehtoja samalle päivälle.';
const OPTIONS_B = '*Broilerin rintafilee 10 kg*\n1. Kariniemen rintafilee 1 kg: 10 pkt (10 kg), 95,00 €\n2. HK rintafilee 2 kg: 5 pkt (10 kg), 99,00 €\n\nVastaa numerolla.';

test('hyvä keskustelu: päivä ensin, numeroidut vaihtoehdot määrin ja hinnoin, 4 tuo uudet vaihtoehdot', () => {
  const persona = { ...PERSONAS.find((p) => p.route === 'date-missing-more-options'), expected: { rintafilee: { value: 10, unit: 'KG', aliases: ['broiler'] } }, date: '2026-11-16' };
  const turns = [
    { user: 'moi, 10 kg broilerin rintafileetä', assistant: 'Luonnoksessa nyt:\n- broilerin rintafilee 10 kg\n\nMille päivälle toimitus?', list: list(null, [line('broilerin rintafilee', 10, 'KG')]) },
    { user: 'maanantaiksi', assistant: OPTIONS_A, list: list('2026-11-16', [line('broilerin rintafilee', 10, 'KG')]) },
    { user: '4', assistant: OPTIONS_B, list: list('2026-11-16', [line('broilerin rintafilee', 10, 'KG')]) },
    { user: '1', assistant: 'Tilausluonnos, toimitus ma 16.11.\n1. Kariniemen rintafilee 1 kg: 10 pkt, 95,00 €\nYhteensä 95,00 € (alv 0 %)\nVoit avata korin: [ostoskorilinkki]', list: list('2026-11-16', [line('broilerin rintafilee', 10, 'KG', { selectedProductId: 'p9' })]) },
  ];
  const r = inspectPersona(persona, turns, turns.at(-1).list);
  assert.deepEqual(r.failures, []);
  // OPTIONS_B:ssä on vain kaksi vaihtoehtoa: vajaasta listasta ei ole enempää näytettävää, joten 4:ää ei vaadita.
  assert.deepEqual(r.newRequirement, []);
  assert.equal(r.metrics.moreHints, 1, 'OPTIONS_A tarjoaa 4:ää, OPTIONS_B ei (ydin näyttää 4:n vain, kun lisää on)');
  const none = [turns[0], turns[1], { ...turns[2], assistant: `Muita vaihtoehtoja päivälle ma 16.11. ei löytynyt: broilerin rintafilee.\n\n${OPTIONS_A}` }, turns[3]];
  assert.ok(!inspectPersona(persona, none, turns[3].list).newRequirement.includes('more_options_same'), 'ei lisää vaihtoehtoja ja sama lista on oikein');
  assert.equal(r.metrics.moreRequests, 1); assert.equal(r.metrics.optionReplies, 2); assert.equal(r.metrics.linkTurn, 4); assert.equal(r.metrics.allSelected, true);
  assert.deepEqual(parseOptions(OPTIONS_A)[0].map((o) => [o.number, o.hasPrice, o.hasQuantity]), [[1, true, true], [2, true, true], [3, true, true]]);
  assert.equal(parseOptions(OPTIONS_A)[0].heading, 'Broilerin rintafilee 10 kg');
  assert.deepEqual(parseOptions(turns.at(-1).assistant), [], 'yhteenveto ei ole vaihtoehtolista');
});

test('huono keskustelu: jokainen virheluokka tunnistetaan', () => {
  const persona = { ...PERSONAS.find((p) => p.route === 'date-missing-more-options'), expected: { kananmuna: { value: 60, unit: 'PCS', not: ['strutsi'] } }, date: '2026-11-16', noIrrelevantDiet: true, unavailable: 'strutsi', absent: ['strutsi'] };
  const many = '*Strutsinmuna 6 kpl*\n1. Kieku Ulkokananmuna M10: 6 ras, 63,20 €\n2. Viiriäisen munia: 6 pkt, 12,90 €\n3. Kieku M6: 10 ras, 26,00 €\n4. Kieku M90: 1 ltk, 240,00 €\n5. Muna jotain\n';
  const turns = [
    { user: '60 kananmunaa ja 6 strutsinmunaa', assistant: many, list: list(null, [line('kananmuna', 60, 'PCS'), line('strutsinmuna', 6, 'PCS')]) },
    { user: '4', assistant: 'Haluatko laktoositonta vai käykö tavallinen?', list: list('2026-11-17', [line('kananmuna', 4, 'PCS'), line('strutsinmuna', 6, 'PCS')]) },
    { user: 'ok', assistant: 'Tilaus on vahvistettu, tilausnumero AGW-20261116-0001.', list: list('2026-11-17', [line('kananmuna', 4, 'PCS'), line('strutsinmuna', 6, 'PCS')]) },
  ];
  const r = inspectPersona(persona, turns, turns.at(-1).list);
  for (const f of ['date_not_asked_first', 'options_before_date', 'options_more_than_3', 'more_options_not_shown', 'four_read_as_quantity']) assert.ok(r.newRequirement.includes(f), f);
  for (const f of ['diet_question_irrelevant', 'quantity:kananmuna', 'unexpected:strutsinmuna', 'unremoved:strutsi', 'delivery_date', 'cart_link_missing', 'unselected:kananmuna', 'unrelated_substitute_offered', 'unavailable_not_explained', 'order_claimed']) assert.ok(r.failures.includes(f), f);
  assert.ok(!r.failures.includes('missing:kananmuna'), 'strutsinmuna ei kelpaa kananmunaksi, mutta kananmunarivi löytyy');
  const honest = inspectPersona(persona, [{ user: 'x', assistant: 'Tarkkaa osumaa ei löytynyt: strutsinmuna. Lähimmät tilattavat vaihtoehdot:\n*Strutsinmuna 6 kpl:*\n1) Kieku M6, 1 rasia (6 kpl), 2,60 €', list: list('2026-11-16', [line('kananmuna', 60, 'PCS')]) }], list('2026-11-16', [line('kananmuna', 60, 'PCS')]));
  assert.ok(!honest.failures.includes('unrelated_substitute_offered') && !honest.failures.includes('unavailable_not_explained'), 'avoimesti merkitty lähin osuma ei ole hiljainen korvike');
  const sip = inspectPersona(persona, [{ user: 'x', assistant: 'Selvä, päivitin ostoskorin.\n*Sipuli 2 kg*\n1. SIPULI NIPPU SUOMI: 2 kpl, 1,78 €\n2. SIPULI 1KG PUSSI: 2 kpl (2 kg), 1,94 €', list: list('2026-11-16', [line('sipuli', 2, 'KG')]) }], null);
  assert.deepEqual(sip.observations.sort(), ['cart_claim_before_selection', 'option_without_need_cover']);
});

test('Codexin inspectConversation hyväksyy persoonat sellaisenaan (sama case-skeema)', () => {
  const p = PERSONAS.find((x) => x.route === 'neutral-no-diet');
  const lines = Object.entries(p.expected).map(([key, q]) => line(q.label, q.value, q.unit));
  const turns = [{ user: p.first, assistant: 'Valmis: [ostoskorilinkki]', list: list(p.date, lines) }];
  assert.deepEqual(inspectConversation(p, turns, list(p.date, lines)), []);
  assert.deepEqual(inspectPersona(p, turns, list(p.date, lines)).failures, []);
});

test('aliakset eivät osu toisiin tuotteisiin (porkkana ei ole kana, strutsinmuna ei ole kananmuna)', () => {
  const p = PERSONAS.find((x) => x.route === 'many-items-typos' && x.expected.rintafilee && x.expected.porkkana);
  assert.ok(p, 'testipersoona löytyy');
  const lines = Object.entries(p.expected).map(([, q]) => line(q.label === 'rintafilee' ? 'broilerin rintafilee' : q.label, q.value, q.unit, { selectedProductId: 'x' }));
  const r = inspectPersona(p, [{ user: p.first, assistant: '[ostoskorilinkki]', list: list(p.date, lines) }], list(p.date, lines));
  assert.deepEqual(r.failures, []);
});

test('regressiosarja: väärä tuotetyyppi, pelkät laktoosittomat ja kattamaton vaihtoehto tunnistetaan', () => {
  assert.deepEqual(REGRESSIONS.map((r) => r.id), ['R01', 'R02', 'R03', 'R04', 'R05', 'R06']);
  assert.equal(new Set([...PERSONAS, ...REGRESSIONS].map((p) => p.id)).size, 106);
  const r03 = REGRESSIONS.find((r) => r.id === 'R03');
  const bad = [line('keltasipuli', 3, 'KG', { selectedProductId: 'a', selectedName: 'PUNASIPULI NIPPU SUOMI' }), line('mozzarella', 5, 'KG', { selectedProductId: 'b', selectedName: 'Salomon mozzarella-sipulirengas 6x1kg' })];
  const reply = '*Keltasipuli 3 kg*\n1. PUNASIPULI NIPPU SUOMI: 3 kpl, 4,59 €\n2. SIPULI 1KG PUSSI: 3 kpl (3 kg), 2,91 €\n\nVastaa numerolla.';
  const r = inspectPersona(r03, [{ user: r03.first, assistant: reply, list: list(r03.date, bad) }, { user: 'ok', assistant: '[ostoskorilinkki]', list: list(r03.date, bad) }], list(r03.date, bad));
  for (const f of ['wrong_product:sipuli', 'wrong_product:mozzarella', 'option_without_need_cover']) assert.ok(r.failures.includes(f), f);
  const r05 = REGRESSIONS.find((r) => r.id === 'R05');
  const milk = '*Maito 30 l*\n1. Valio kevytmaito 2,5 dl laktoositon UHT: 8 ltk (30 l), 158,08 €\n2. Valio Eila kevytmaitojuoma laktoositon: 8 ltk (30 l), 201,92 €';
  assert.ok(inspectPersona(r05, [{ user: r05.first, assistant: milk, list: list(r05.date, [line('maito', 30, 'L')]) }], list(r05.date, [line('maito', 30, 'L')])).failures.includes('only_lactose_free_offered:maito'));
});

test('uudelleentarkistus palauttaa tallennetut vuorot inspectPersonan muotoon', () => {
  const stored = { turns: [{ user: 'u', assistant: 'a', ms: 1, deliveryDate: '2026-11-16', lines: [{ term: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [], selected: 'Valio maito' }] }],
    finalList: { deliveryDate: '2026-11-16', diet: { known: true, claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [] }, lines: [] } };
  const [t] = restoreTurns(stored);
  assert.equal(t.list.deliveryDate, '2026-11-16'); assert.equal(t.list.lines[0].productTerm, 'maito'); assert.equal(t.list.lines[0].selectedProductId, 'Valio maito');
  assert.deepEqual(t.list.diet.claims, ['FREE_FROM_LACTOSE']);
});

test('kustannusarvio käyttää mallikohtaisia hintoja ja yhteenveto listaa virheluokat', () => {
  assert.equal(modelOf('whatsapp_optional_addition'), 'claude-haiku-5-5'); assert.equal(modelOf('whatsapp_order_turn'), 'claude-opus-5-5');
  assert.equal(costUsd({ input: 1_000_000, cacheRead: 0, output: 1_000_000 }, 'claude-opus-5-5'), 24);
  assert.equal(costUsd({ input: 1_000_000, cacheRead: 1_000_000, output: 0 }, 'claude-opus-5-5'), 0.2);
  const results = [{ id: 'S001', route: 'r', failures: ['missing:maito'], newRequirement: ['options_no_more_hint'], codexFailures: [], judgment: { score: 3, problems: ['p'] }, turns: [{ user: 'u', assistant: 'a https://x.invalid/y' }] }];
  const md = summarize(results, { calls: 10, failed: 0, input: 100, output: 50, cacheRead: 0, orders: 0, ms: 60000, personaMs: 60000, assistantMs: 30000, byPurpose: { whatsapp_order_turn: { calls: 10, input: 100, output: 50, cacheRead: 0 } } },
    { created: 'x', commit: 'abc', dirty: [], snapshotHash: '0'.repeat(64), deepModel: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5' });
  assert.match(md, /missing: 1/u); assert.match(md, /options_no_more_hint: 1/u); assert.doesNotMatch(md, /https:/u); assert.doesNotMatch(md, /\u00b7/u);
});

test('simuloitu asiakas ja arvioija ovat oletuksena Haiku, apuri pysyy deep-mallilla', () => {
  assert.equal(simTierFromEnv({}), 'fast'); assert.equal(simTierFromEnv({ WHATSAPP_SELFPLAY_SIM_TIER: 'deep' }), 'deep');
  assert.equal(simTierFromEnv({ WHATSAPP_SELFPLAY_SIM_TIER: 'opus' }), 'fast');
  for (const p of ['whatsapp_selfplay_customer', 'whatsapp_selfplay_review']) {
    assert.equal(modelOf(p, 'claude-opus-5-5', 'claude-haiku-5-5', 'fast'), 'claude-haiku-5-5');
    assert.equal(modelOf(p, 'claude-opus-5-5', 'claude-haiku-5-5', 'deep'), 'claude-opus-5-5');
    assert.equal(modelOf(p), 'claude-opus-5-5', 'vanhan ajon meta ilman simTieri\u00e4: ajettiin Opuksella');
  }
  for (const p of ['whatsapp_dialogue', 'whatsapp_order_turn', 'whatsapp_cart_reply']) assert.equal(modelOf(p, 'claude-opus-5-5', 'claude-haiku-5-5', 'fast'), 'claude-opus-5-5');
  const totals = { calls: 2, failed: 0, input: 2_000_000, output: 0, cacheRead: 0, orders: 0, ms: 1, personaMs: 1, assistantMs: 1,
    byPurpose: { whatsapp_selfplay_customer: { calls: 1, input: 1_000_000, output: 0, cacheRead: 0 }, whatsapp_order_turn: { calls: 1, input: 1_000_000, output: 0, cacheRead: 0 } } };
  const meta = { created: 'x', commit: 'abc', dirty: [], snapshotHash: '0'.repeat(64), deepModel: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5' };
  assert.match(summarize([], totals, { ...meta, simTier: 'fast' }), /Kustannusarvio 4\.10 USD/u);
  assert.match(summarize([], totals, { ...meta, simTier: 'fast' }), /simuloitu asiakas ja arvioija claude-haiku-5-5/u);
  assert.match(summarize([], totals, meta), /Kustannusarvio 8\.00 USD/u);
});

test('laajennettu joukko X001–X100: luokat, kellonajat ja kellon mukaan laskettu aikaisin päivä', () => {
  assert.equal(EXTENDED.length, 100); assert.equal(new Set(EXTENDED.map((p) => p.id)).size, 100);
  assert.equal(new Set([...PERSONAS, ...REGRESSIONS, ...EXTENDED].map((p) => p.id)).size, 206);
  const cats = {}; for (const p of EXTENDED) cats[p.category] = (cats[p.category] || 0) + 1;
  assert.deepEqual(cats, { errors: 20, dialect: 20, weird: 15, rush: 12, question: 25, greeting: 8 });
  for (const slot of Object.keys(SLOTS)) assert.ok(EXTENDED.filter((p) => p.slot === slot).length >= 20, slot);
  assert.equal(new Set(EXTENDED.filter((p) => p.category === 'dialect').map((p) => p.route)).size, 10);
  assert.equal(earliestDate('morning'), '2026-11-16'); assert.equal(earliestDate('evening'), '2026-11-17');
  for (const p of EXTENDED) {
    assert.ok(p.now && p.greetingWrong && p.brief.includes('Kello on nyt'), p.id);
    if (p.rush) assert.equal(p.date, earliestDate(p.slot), p.id);
    else if (!p.expectEmpty) assert.ok(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].includes(p.date), `${p.id} ${p.date}`);
    if (p.expectEmpty) assert.deepEqual(p.expected, {}, p.id);
    for (const [, q] of Object.entries(p.expected)) assert.ok(Number.isFinite(q.value) && q.value > 0, p.id);
  }
  assert.equal(EXTENDED.find((p) => p.route === 'rush-before7' && p.slot === 'evening').expected.peruna.value, 25, 'kellonaika 7 ei ole määrä');
});

test('laajennetut tarkistukset: keksityt faktat, ohjaus tukeen, botti, kiire, tervehdys, peruminen, päivien ristiriita', () => {
  const X = (route) => EXTENDED.find((p) => p.route === route);
  const fee = X('question-fee');
  const one = (persona, assistant, lines = [], date = null, user = persona.first) => inspectPersona(persona, [{ user, assistant, list: list(date, lines) }], list(date, lines));
  assert.ok(one(fee, 'Moi! Toimitusmaksu on 9,90 € alle 100 euron tilauksissa.').failures.includes('fact_invented:fee'));
  assert.ok(one(fee, 'Toimitus on ilmainen yli 200 euron tilauksissa.').failures.includes('fact_invented:fee'));
  assert.deepEqual(one(fee, 'En näe toimitusmaksua täältä, joten en voi luvata summaa. Kysy asiakaspalvelusta.').failures, []);
  assert.ok(one(fee, 'Kiva kun kysyit! Tilataanko jotain?').failures.includes('not_referred:fee'));
  assert.ok(one(fee, 'Moi!', [line('maito', 20, 'L')]).failures.includes('question_added_item'));
  assert.ok(one(X('question-hours'), 'Olemme auki arkisin klo 8–16.').failures.includes('fact_invented:hours'));
  assert.ok(one(X('question-payment'), 'Voit maksaa kortilla tai MobilePaylla.').failures.includes('fact_invented:payment'));
  assert.ok(one(X('question-complaint'), 'Pahoittelut, hyvitämme rikkinäiset munat seuraavassa laskussa.').failures.includes('fact_invented:complaint'));
  const inv = EXTENDED.find((p) => p.factQuestion === 'invoice');
  assert.ok(!one(inv, 'Laskutukseen liittyvät asiat, kuten kuukausilaskun, hoitaa asiakaspalvelu.').failures.some((f) => f.startsWith('fact_invented') || f.startsWith('not_referred')));
  assert.ok(one(inv, 'Maksuaika on 14 päivää netto.').failures.includes('fact_invented:invoice'));
  const bot = X('question-bot');
  assert.deepEqual(one(bot, 'Olen tekoälyllä toimiva tilausapuri, en ihminen. Asiakaspalvelu auttaa muissa asioissa.').failures, []);
  assert.ok(one(bot, 'Joo, olen ihminen täällä!').failures.includes('bot_not_disclosed'));
  assert.ok(one(X('question-human'), 'Kerro vaan mitä tarvitset.').failures.includes('not_referred:human'));

  const rush = X('rush-cutoff');
  const r1 = one(rush, 'Ei tilattavaa tuotetta päivälle ma 16.11.: maito.', [line('maito', 20, 'L')], '2026-11-17');
  assert.ok(r1.failures.includes('rush_no_deadline') && r1.failures.includes('rush_no_earliest_day'), 'pelkkä "ei tilattavaa" ei kerro tilausaikaa eikä aikaisinta päivää');
  const r2 = one(rush, 'Maanantain tilausaika umpeutui su klo 12.00. Aikaisin mahdollinen toimitus on ti 17.11.', [line('maito', 20, 'L')], '2026-11-17');
  assert.ok(!r2.failures.includes('rush_no_deadline') && !r2.failures.includes('rush_no_earliest_day'));
  const b7 = EXTENDED.find((p) => p.rush === 'before7');
  assert.ok(one(b7, 'Joo, toimitus saapuu huomenna ennen klo 7!').failures.includes('delivery_time_promised'));
  assert.ok(!one(b7, 'En voi luvata, että toimitus saapuu ennen klo 7.').failures.includes('delivery_time_promised'));

  const evening = EXTENDED.find((p) => p.route === 'greeting-time' && p.slot === 'evening');
  assert.ok(one(evening, 'Hyvää huomenta! Mitä tilataan?').newRequirement.includes('greeting_wrong_time'));
  assert.ok(!one(evening, 'Hyvää iltaa! Mitä tilataan?').newRequirement.includes('greeting_wrong_time'));
  assert.ok(one(evening, 'Moi! Mitä tilataan?').newRequirement.includes('greeting_not_time_aware'));
  assert.ok(!one(evening, 'Hyvää iltaa! Mitä tilataan?').newRequirement.includes('greeting_not_time_aware'));
  const night = EXTENDED.find((p) => p.route === 'greeting-time' && p.slot === 'night');
  assert.ok(!one(night, 'Moi! Mitä tilataan?').newRequirement.includes('greeting_not_time_aware'), 'yöllä neutraali moi');
  assert.ok(one(night, 'Huomenta! Mitä tilataan?').newRequirement.includes('greeting_wrong_time'));
  assert.ok(!one(EXTENDED.find((p) => p.route === 'greeting-time' && p.slot === 'morning'), 'Huomenta! Mitä tilataan?').newRequirement.includes('greeting_wrong_time'));

  const cancel = X('cancel');
  assert.ok(one(cancel, 'Selvä, peruttu.', [line('maito', 20, 'L')]).failures.includes('cancel_not_applied'));
  assert.deepEqual(one(cancel, 'Selvä, lista tyhjennetty, mitään ei tilattu.').failures, []);
  const mixed = X('mixed-dates');
  assert.ok(inspectPersona(mixed, [{ user: mixed.first, assistant: 'Selvä! [ostoskorilinkki]', list: list('2026-11-18', [line('maito', 20, 'L', { selectedProductId: 'x' })]) }], list('2026-11-18', [line('maito', 20, 'L')])).failures.includes('date_conflict_not_asked'));
  const early = EXTENDED.find((p) => p.route === 'greeting-time');
  const open = [line('peruna', 25, 'KG')];
  assert.ok(inspectPersona(early, [{ user: 'laita kori', assistant: 'Tässä linkki: [ostoskorilinkki]', list: { ...list('2026-11-18', open), status: 'needs_product_selection' } }], list('2026-11-18', open)).newRequirement.includes('link_before_complete'), 'linkki ennen tuotevalintaa');
  const done = [line('peruna', 25, 'KG', { selectedProductId: 'x' })];
  assert.ok(!inspectPersona(early, [{ user: 'ok', assistant: 'Tässä linkki: [ostoskorilinkki]', list: { ...list('2026-11-18', done), status: 'review' } }], list('2026-11-18', done)).newRequirement.includes('link_before_complete'));
  const wrong = X('wrong-answer');
  const turns = [{ user: wrong.first, assistant: 'Mille päivälle toimitus?', list: list(null, [line('voi', 5, 'KG')]) }, { user: 'joo 5 kg', assistant: 'Laitoin perjantaille.', list: list('2026-11-20', [line('voi', 5, 'KG')]) }];
  assert.ok(inspectPersona(wrong, turns, turns[1].list).failures.includes('date_invented'));
});

test('loadCases: yleinen tapausvalinta, oma tarkistin ja polkurajaus', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const all = await loadCases(root, CASE_SETS.all);
  const { DATA_CASES } = await import('../eval/whatsapp-personas-data.mjs');
  assert.equal(all.cases.length, 206 + DATA_CASES.length);
  const codex = await loadCases(root, 'eval/whatsapp-selfplay-cases.mjs:SELFPLAY_CASES');
  assert.ok(codex.cases.length >= 5 && codex.inspectors.get(codex.cases[0].id) === inspectPersona);
  await assert.rejects(() => loadCases(root, '../etc/x.mjs'), /projektin sisällä/u);
  await assert.rejects(() => loadCases(root, 'eval/whatsapp-personas.mjs:PERSONAS,eval/whatsapp-personas.mjs:PERSONAS'), /toistuva/u);
  const dir = fs.mkdtempSync(path.join(root, 'eval', '.tmp-cases-'));
  try {
    fs.writeFileSync(path.join(dir, 'c.mjs'), "export const CASES = [{ id: 'T1', first: 'moi', brief: 'b', expected: {}, maxTurns: 2 }];\nexport const inspect = () => ['custom'];\n");
    const custom = await loadCases(root, `eval/${path.basename(dir)}/c.mjs`);
    assert.deepEqual(custom.inspectors.get('T1')(), ['custom']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Valion dataan perustuvat persoonat: totuus katalogista ja väitteiden tarkistus', { skip: !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu' }, async () => {
  const { DATA_CASES, inspect } = await import('../eval/whatsapp-personas-data.mjs');
  assert.equal(DATA_CASES.length, 35); assert.ok(DATA_CASES.every((p) => /^V\d{3}$/u.test(p.id) && p.truth && p.date && p.now));
  const by = (route, i = 0) => DATA_CASES.filter((p) => p.route === route)[i];
  const edam = DATA_CASES.find((p) => p.truth.name === 'Valio Edam e350 g');
  assert.equal(edam.truth.hasIt, true, 'laktoositon Edam sisältää maitoa (AM)');
  assert.equal(DATA_CASES.find((p) => p.truth.name === 'Alpro Soijajuoma 1L').truth.hasIt, false);
  const ask = (persona, assistant, lines = [], date = persona.date) => inspect(persona, [{ user: persona.first, assistant, list: list(date, lines) }], list(date, lines));
  assert.ok(ask(edam, 'Joo, Valio Edam e350 g on laktoositon ja maidoton, sopii hyvin.').failures.includes('allergen_wrong_dangerous'));
  assert.ok(!ask(edam, 'Ei ole maidoton: se sisältää maitoa, vaikka on laktoositon.').failures.some((f) => f.startsWith('allergen')));
  assert.ok(ask(edam, 'En pysty varmistamaan allergeeneja.').failures.includes('data_not_used:allergen'));
  const jaffa = by('data-origin', 3);
  assert.equal(jaffa.truth.country, 'il');
  assert.ok(ask(jaffa, 'APPELSIINI JAFFA tulee Espanjasta.').failures.includes('origin_wrong'));
  assert.ok(!ask(jaffa, 'Se on Israelista.').failures.some((f) => f.startsWith('origin') || f.startsWith('data_not_used')));
  const frozen = DATA_CASES.find((p) => p.route === 'data-storage' && p.truth.temp === 'frozen');
  assert.ok(ask(frozen, 'Säilytä jääkaapissa +4 asteessa.').failures.includes('storage_wrong'));
  assert.ok(!ask(frozen, 'Säilytä pakastimessa -18 asteessa.').failures.some((f) => f.startsWith('storage') || f.startsWith('data_not_used')));
  assert.ok(!ask(frozen, 'Säilytä pakastimessa. Sulata jääkaapissa ennen tarjoilua.').failures.includes('storage_wrong'));
  const cut = by('data-cutoff');
  assert.ok(ask(cut, 'En tiedä tilausaikaa.').failures.includes('data_not_used:cutoff'));
  assert.ok(!ask(cut, 'Tilattava viimeistään su 15.11. klo 12.00.').failures.some((f) => f.includes('cutoff')));
  const cheap = by('data-cheapest');
  const opts = '*Maito 20 l:*\n1) Valio Luomu™ D-vitaminoitu rasvaton maito 1 l, 4 laatikkoa (20 l), 110,60 €\n2) 5 x Arla Luomu 1 L kevytmaito, 4 laatikkoa (20 l), 169,80 €\n3) 5 x Arla 1 L kevytmaito Suomesta, 4 laatikkoa (20 l), 171,80 €';
  const pick = (name) => [line('maito', 20, 'L', { selectedProductId: 'x', selectedName: name })];
  assert.ok(ask(cheap, `${opts}\nEdullisin on vaihtoehto 2.`, pick('5 x Arla Luomu 1 L kevytmaito')).failures.includes('cheapest_wrong'));
  assert.ok(!ask(cheap, `${opts}\nEdullisin on vaihtoehto 1.`, pick('Valio Luomu™ D-vitaminoitu rasvaton maito 1 l')).failures.includes('cheapest_wrong'));
  assert.ok(ask(cheap, opts, pick('Valio Luomu™ D-vitaminoitu rasvaton maito 1 l')).failures.includes('data_not_used:cheapest'));
  const guide = DATA_CASES.find((p) => p.route === 'data-allergy-guide' && p.truth.allergen === 'AW' && !p.truth.claim);
  assert.ok(ask(guide, '[ostoskorilinkki]', [line('kaurajuoma', 10, 'L', { selectedProductId: '468319', selectedName: 'Oatly iKaffe 0,5L', excludeAllergens: ['AW'] })]).failures.includes('unsafe_selection'), 'gluteenia sisältävä kaurajuoma keliaakikolle');
});

test('gluteenittomuusmerkintä kattaa gluteeniallergian, valinta ilman listaa kelpaa pyydettäessä', () => {
  const p = { ...PERSONAS[0], expected: { kaura: { value: 10, unit: 'L' } }, date: '2026-11-17', requiredAllergen: 'AW', requiresSelection: true };
  const ok = [line('kaurajuoma', 10, 'L', { selectedProductId: 'x', claims: ['FREE_FROM_GLUTEN'] })];
  const r = inspectPersona(p, [{ user: 'x', assistant: '[ostoskorilinkki]', list: { ...list('2026-11-17', ok), status: 'review' } }], list('2026-11-17', ok));
  assert.ok(!r.failures.includes('allergen:kaura') && !r.newRequirement.includes('link_before_complete') && !r.failures.includes('options_never_shown'));
  const milk = { ...p, requiredAllergen: 'AM' };
  const lf = [line('kaurajuoma', 10, 'L', { selectedProductId: 'x', claims: ['FREE_FROM_LACTOSE'] })];
  assert.ok(inspectPersona(milk, [{ user: 'x', assistant: '[ostoskorilinkki]', list: list('2026-11-17', lf) }], list('2026-11-17', lf)).failures.includes('allergen:kaura'), 'laktoositon ei ole maidoton');
});

test('patchDeepEffort kiinnittää syvän tason effortin ajon kopioon eikä koske nopeaan tasoon', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server/aimoAgent.mjs'), 'utf8');
  const patched = patchDeepEffort(source, 'medium');
  assert.ok(patched.includes("effort: deep ? 'medium' : 'low'"));
  assert.ok(!patched.includes("effort: deep ? 'high' : 'low'"));
  assert.equal(patched.length - source.length, "medium".length - "high".length);
  assert.throws(() => patchDeepEffort(source, 'korkea'), /Tuntematon effort/u);
  assert.throws(() => patchDeepEffort('const x = 1;', 'low'), /ei vastaa odotettua/u);
});

test('parseOptions lukee rivimuodon "yhteensä 5 l" vaihtoehdoksi mutta ei tilausluonnosta', () => {
  const text = '*Ruokakerma 5 l:*\n1) Valio ruokakerma 15 % 1 l UHT laktoositon, 5 kpl, yhteensä 5 l, 42,85 €\n2) 6 x Arla Lempi 2 dl, 5 laatikkoa à 1,2 l, yhteensä 6 l, 61,55 €\n3) Arla Ruokakerma 10 l, 1 kpl, yhteensä 10 l, 112,81 €\n4) Näytä lisää vaihtoehtoja';
  const blocks = parseOptions(text);
  assert.equal(blocks.length, 1); assert.equal(blocks[0].length, 3);
  assert.ok(blocks[0].every((o) => o.hasQuantity && o.hasPrice));
  assert.equal(blocks[0][0].name, 'Valio ruokakerma 15 % 1 l UHT laktoositon');
  assert.equal(blocks[0][1].name, '6 x Arla Lempi 2 dl');
  assert.deepEqual(parseOptions('*Tilausluonnos*, toimitus ti 17.11., Testikeittiö\n1. Maito 20 l: 4 ltk (20 l), 110,60 €\nYhteensä 110,60 € (alv 0 %)'), []);
});
