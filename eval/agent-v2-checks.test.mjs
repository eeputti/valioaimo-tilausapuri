// v2-arvioinnin tarkistusten ja kustannuslaskennan testit (ei mallikutsuja, ei katalogia).
// Ajo: node --test eval/agent-v2-checks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineAmount, checkItems, repetition, inspectScenario, selections, PROMISE, CODE_TALK, FEEDBACK_CLAIM, unavailableSaid } from './agent-v2-checks.mjs';
import { usageCost, parseEventStream } from './agent-v2-meter.mjs';
import { judgePayload } from './agent-v2-judge.mjs';
import { SCENARIOS, ALL_SCENARIOS, scenarioById } from './agent-v2-scenarios.mjs';

const bag = { id: '460351', name: 'SIPULI 1KG PUSSI HOLLANTI', kg: 1, litres: null, salesUnit: 'ST', labels: [], contains: [] };
const sack = { id: '460195', name: 'SIPULI 10KG SÄKKI SUOMI', kg: 10, litres: null, salesUnit: 'ST', labels: [], contains: [] };

test('lineAmount: kappaleina kirjattu tarve pussituotteelle on yhtä monta pussia (19.11. "50 sipulia")', () => {
  assert.deepEqual(lineAmount({ quantity: { value: 50, unit: 'PCS', basis: 'items' }, product: bag }), { kg: 50, l: null, packs: 50, implied: true });
  assert.equal(lineAmount({ quantity: { value: 1, unit: 'PCS', basis: 'sales' }, product: sack }).kg, 10);
  assert.equal(lineAmount({ quantity: { value: 6, unit: 'KG' }, product: sack }).kg, 6);
  assert.equal(lineAmount({ quantity: { value: 6, unit: 'L' }, product: null }).l, 6);
  assert.equal(lineAmount({ quantity: { value: 50, unit: 'PCS', basis: 'items' }, product: { kg: 0.06, salesUnit: 'ST' } }), null);
  assert.equal(lineAmount({ quantity: null, product: bag }), null);
  assert.equal(lineAmount({ packs: 2, quantity: { value: 5, unit: 'KG' }, product: { kg: 5 } }).kg, 10);
});

const onion = scenarioById('E1-peruna-sipuli-kerma').expect.items;
test('checkItems: määrä, väärä tuote, ylimääräinen rivi, merkinnät ja allergeenit', () => {
  const lines = [{ name: 'PP PERUNA PESTY BELLAROSA', kg: 50, l: null, qty: 50, labels: [], contains: [] },
    { name: 'SIPULI 1KG PUSSI HOLLANTI', kg: 50, l: null, qty: 50, labels: [], contains: [] },
    { name: 'Valio ruokakerma 15 % 1 l UHT laktoositon', kg: 6.078, l: 6, qty: 6, labels: [], contains: ['AM'] }];
  assert.deepEqual(checkItems(onion, lines, true).failures, ['amount:sipuli=50']);
  lines[1] = { ...lines[1], name: 'SIPULI 10KG SÄKKI SUOMI', kg: 10, qty: 1 };
  assert.deepEqual(checkItems(onion, lines, true).failures, []);
  lines[1] = { ...lines[1], name: 'VALKOSIPULI 1KG KUORITTU' };
  assert.deepEqual(checkItems(onion, lines, true).failures, ['wrong_product:sipuli', 'unexpected:VALKOSIPULI 1KG KUORITTU']);
  const a1 = scenarioById('A1-allergiat').expect.items;
  const milk = { name: 'Valio laktoositon maitojuoma 1,5 % 1 l', l: 10, kg: 10.3, qty: 10, labels: ['FREE_FROM_LACTOSE'], contains: ['AM'] };
  assert.deepEqual(checkItems(a1, [milk, { name: 'Valio Edam 17 % e1 kg viipale', kg: 3, l: null, qty: 3, labels: ['FREE_FROM_LACTOSE'], contains: ['AM'] }], true).failures, []);
  assert.deepEqual(checkItems(a1, [{ ...milk, labels: [] }, { name: 'Juustoleipä juusto 1 kg', kg: 3, l: null, qty: 3, labels: [], contains: ['AW'] }], true).failures,
    ['label:maito:FREE_FROM_LACTOSE', 'wrong_product:juusto', 'unexpected:Juustoleipä juusto 1 kg']);
});

test('repetition: toistuvat virkkeet ja identtiset viestit, listarivit eivät ole toistoa', () => {
  const m = (turn, text) => ({ turn, text });
  const r = repetition([m(0, 'Mille päivälle tarvitset toimituksen ja kuinka paljon?\n- peruna'), m(1, 'Kerma on mukana. Mille päivälle tarvitset toimituksen ja kuinka paljon?\n- peruna'),
    m(2, 'Vastaa 1, 2 tai 3.'), m(3, 'Vastaa 1, 2 tai 3.')]);
  assert.equal(r.repeatedSentences, 2); // kysymys kahdesti (+1) ja "Vastaa 1, 2 tai 3." kahdesti (+1)
  assert.equal(r.identical, 1);
});

test('puuttuvan tuotteen selitys tunnistetaan myös puhekielellä', () => {
  assert.ok(unavailableSaid('Joo, lanttulaatikko ei nyt oo tilattavissa lauantaille 21.11.'));
  assert.ok(unavailableSaid('Lanttulaatikkoa ei valitettavasti löydy valikoimasta.'));
  assert.ok(unavailableSaid('En löytänyt lanttulaatikkoa.'));
  assert.ok(unavailableSaid('Saarioisen lanttulaatikko on loppu.'));
  assert.ok(!unavailableSaid('Laitoin lanttulaatikon listalle, 500 kg.'));
});

test('lupaukset ja puhe omasta koodista tunnistetaan, tilauksen ohjeet eivät', () => {
  assert.ok(PROMISE.test('Kiitos palautteesta, vastaan jatkossa kaikkiin viesteihin kerralla.'));
  assert.ok(PROMISE.test('Välitän palautteen kehittäjille.'));
  assert.ok(!PROMISE.test('Tilaus vahvistetaan korisivulla.'));
  assert.ok(CODE_TALK.test('Vercelin bottia voi kehittää, mutta se on kehittäjien asia.'));
  assert.ok(!CODE_TALK.test('Laitoin porkkanat ja kerman listalle.'));
});

/** Pieni E1:n kaltainen tulos: vuorot, luonnos ja kori korisivun muodossa. */
function e1Result({ proposal, onionQty, link = true, status = 'review' }) {
  const list = (q) => ({ status, deliveryDate: '2026-11-26', lines: [{ productTerm: 'sipuli', quantity: q, selectedName: bag.name, product: bag, claims: [], excludeAllergens: [] }] });
  const turn = (mark, customer, parts, q = onionQty) => ({ mark, customer: [{ text: customer, at: 0 }], replies: [{ parts, e2eMs: 9000 }], chat: [{ ms: 6000 }], list: list(q) });
  return { conversations: [{ index: 0, ended: link ? 'link' : 'script_end', turns: [
    turn('need', 'tarviin paljon perunaa ja sipulii! sillee 50 henkilöl', [proposal]),
    turn('cream', 'pistetää kermaa kans!', ['Lisäsin kerman.']),
    turn('amounts', 'toimitus ois viikon pääst torstaina', ['Selvä, toimitus to 26.11.']),
    turn('onion50', '50 sipulia', ['Okei, sipulia 50 kpl.']),
    turn(null, 'linkki?', [link ? 'Tässä: [ostoskorilinkki]' : 'Valitse vielä kerma.']),
  ], final: { list: list(onionQty), storefront: { state: 'ready', deliveryDate: '2026-11-26', lines: [
    { name: 'PP PERUNA PESTY BELLAROSA', qty: 50, totalKg: 50, product: { labels: [], contains: [] } },
    { name: bag.name, qty: onionQty.value, totalKg: onionQty.value, product: bag },
    { name: 'Valio ruokakerma 15 % 1 l UHT laktoositon', qty: 6, totalL: 6, totalKg: 6.1, product: { labels: [], contains: [] } }] } } }] };
}

test('E1: annosehdotus 50 hengelle, "50 sipulia" ja kori', () => {
  const s = scenarioById('E1-peruna-sipuli-kerma');
  const bad = inspectScenario(s, e1Result({ proposal: 'Joo, otin perunat ja sipulit mukaan, 50 hengelle hyvä lähtökohta!', onionQty: { value: 50, unit: 'PCS', basis: 'items' } }));
  assert.deepEqual(bad.failures.sort(), ['amount:sipuli=50', 'no_quantity_proposal_for_50', 'onion_misread:50kg'].sort());
  const good = inspectScenario(s, e1Result({ proposal: '50 hengelle perunaa menee noin 10–12 kg ja sipulia pari kiloa, käykö?', onionQty: { value: 6, unit: 'PCS', basis: 'sales' } }));
  assert.deepEqual(good.failures, []);
  assert.equal(good.metrics.conversations[0].customerMessages, 5);
  // Ostaja oli itse valinnut 2 × 10 kg; botti kysyy tarkennusta eikä muuta määrää: ei väärä tulkinta.
  const sacks = e1Result({ proposal: 'Noin 10 kg perunaa riittää.', onionQty: { value: 2, unit: 'PCS', basis: 'sales' } });
  for (const t of sacks.conversations[0].turns) for (const l of t.list.lines) l.product = { ...bag, kg: 10 };
  sacks.conversations[0].turns[3].replies[0].parts = ['Korissa on 2 × 10 kg säkkiä. Tarkoitatko 50 kappaletta sipulia, noin 6 kg?'];
  assert.ok(!inspectScenario(s, sacks).failures.some((f) => f.startsWith('onion_misread')));
  const early = inspectScenario(s, e1Result({ proposal: 'Noin 10 kg perunaa riittää.', onionQty: { value: 6, unit: 'PCS', basis: 'sales' }, status: 'needs_product_selection' }));
  assert.ok(early.failures.includes('link_before_ready'));
});

test('G1: identtiset tervehdykset, puuttuva esittely ja pyytämätön "en ihminen"', () => {
  const s = scenarioById('G1-tervehdykset');
  const conv = (text) => ({ turns: [{ mark: 'greeting', customer: [{ text: 'moi', at: 0 }], replies: [{ parts: [text], e2eMs: 5000 }], chat: [{ ms: 3000 }], list: null }], final: { list: null } });
  const same = 'Päivää! Mä olen Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?';
  const r = inspectScenario(s, { conversations: [conv(same), conv(same), conv('Tilataanko jotain?'), conv(same), conv('Päivää! Oon digitaalinen tilausapuri enkä ihminen.')] });
  assert.ok(r.failures.includes('greeting_identical'));
  assert.ok(r.failures.includes('greeting_low_variation'));
  assert.ok(r.failures.includes('intro_missing:3'));
  assert.ok(r.failures.includes('unprompted_not_human:5'));
});

test('hinnat: välimuisti, 1 h kirjoitus ja fallback-iteraatiot', () => {
  const u = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000 };
  assert.equal(+usageCost(u, 'claude-opus-5-5').toFixed(6), +((1000 * 4 + 2000 * 5 + 10_000 * 0.2 + 500 * 20) / 1e6).toFixed(6));
  assert.equal(+usageCost(u, 'claude-haiku-5-5').toFixed(7), +((1000 * 0.1 + 2000 * 0.125 + 10_000 * 0.01 + 500 * 0.5) / 1e6).toFixed(7));
  assert.equal(+usageCost({ ...u, cache_creation: { ephemeral_1h_input_tokens: 2000 } }, 'claude-sonnet-5-5').toFixed(6), +((1000 * 2 + 2000 * 4 + 10_000 * 0.1 + 500 * 10) / 1e6).toFixed(6));
  const split = usageCost({ iterations: [{ model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 10 }, { model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 10 }] }, 'claude-opus-5-5');
  assert.equal(+split.toFixed(7), +((100 * 4 + 10 * 20 + 100 * 2 + 10 * 10) / 1e6).toFixed(7));
});

test('SSE-virrasta luetaan malli, syöte ja lopullinen tuloste', () => {
  const sse = ['event: message_start', 'data: {"type":"message_start","message":{"model":"claude-haiku-5-5","usage":{"input_tokens":12,"cache_read_input_tokens":300,"output_tokens":1}}}', '',
    'event: content_block_delta', 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"moi"}}', '',
    'event: content_block_start', 'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"save_feedback","input":{}}}', '',
    'event: message_delta', 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}', '', ''].join('\n');
  assert.deepEqual(parseEventStream(sse), { model: 'claude-haiku-5-5', usage: { input_tokens: 12, cache_read_input_tokens: 300, output_tokens: 42 }, stop: 'end_turn', toolUses: ['save_feedback'] });
});

test('skenaariot: tunnisteet yksilöllisiä ja käsikirjoitetut viestit Eeliksen sanoin', () => {
  assert.equal(new Set(ALL_SCENARIOS.map((s) => s.id)).size, ALL_SCENARIOS.length);
  const e1 = SCENARIOS[0].steps.filter((s) => s.say || s.burst);
  assert.deepEqual(e1.map((s) => s.say || s.burst.map((b) => b.text).join(' | ')), ['tarviin paljon perunaa ja sipulii! sillee 50 henkilöl', 'pistetää kermaa kans! ja siis paljo menis 50 henkilöl about',
    'toimitus ois viikon pääst torstaina ja vaikka 50 kg perunaa ja 20 sipulii, kermaa sillee 6 litraa ni pitäs riittää', '50 sipulia',
    'nyt tuli kyl vitust liikaa sipulii, tarviin 50 sipulii!! | en 50kg sipulii :D']);
  assert.equal(SCENARIOS[0].steps.find((s) => s.burst).burst[1].afterMs, 6000);
  for (const s of ALL_SCENARIOS) assert.ok(s.now && s.title && (s.steps || s.conversations), s.id);
});

test('arvioijan syöte: peräkkäiset viestit ja erilliset vastaukset näkyvät', () => {
  const s = scenarioById('E2-palaute-kesken');
  const p = judgePayload(s, { conversations: [{ ended: 'link', turns: [{ customer: [{ text: 'a', at: 0 }, { text: 'b', at: 6000 }], replies: [{ parts: ['x'] }, { parts: ['y'] }] }], final: { list: null } }] });
  assert.deepEqual(p.keskustelut[0].vuorot[0].asiakas, ['a', '(6 s myöhemmin) b']);
  assert.deepEqual(p.keskustelut[0].vuorot[0].apuri, [{ 'vastaus 1': ['x'] }, { 'vastaus 2': ['y'] }]);
});

test('palautteen kirjausväite vaatii save_feedback-kutsun, ja purskeen vastaukset lasketaan', () => {
  assert.ok(FEEDBACK_CLAIM.test('Kiitos! Kirjasin palautteen tiimille.'));
  assert.ok(FEEDBACK_CLAIM.test('Palaute menee eteenpäin.'));
  assert.ok(!FEEDBACK_CLAIM.test('Laitoin porkkanat listalle.'));
  assert.ok(!FEEDBACK_CLAIM.test('Joo, kerma on nyt listalla! 50 hengelle menee aika reilusti, joten kirjasin sen muistiin.'));
  assert.ok(!FEEDBACK_CLAIM.test('Kiitos palautteesta!'));
  const s = scenarioById('E2-palaute-kesken');
  const conv = { ended: 'link', turns: [{ kind: 'burst', mark: 'feedback', customer: [{ text: 'a', at: 0 }, { text: 'b', at: 6000 }],
    replies: [{ parts: ['Kiitos, kirjasin palautteen tiimille.'], e2eMs: 9000 }, { parts: ['Jatketaan porkkanoihin.'], e2eMs: 8000 }], chat: [], list: null }], final: { list: null } };
  const without = inspectScenario(s, { conversations: [conv], calls: [{ role: 'bot', toolUses: ['add_items'] }] });
  assert.ok(without.failures.includes('feedback_claim_unbacked'));
  assert.deepEqual(without.metrics.conversations[0].bursts, [{ mark: 'feedback', messages: 2, replies: 2 }]);
  const withTool = inspectScenario(s, { conversations: [conv], calls: [{ role: 'bot', toolUses: ['save_feedback'] }] });
  assert.ok(!withTool.failures.includes('feedback_claim_unbacked'));
});

test('toistot: tiedostonimet ja skenaariokohtainen kooste (läpi / ajoja, arvion keskiarvo ja vaihteluväli)', async () => {
  const { fileOf, perScenario } = await import('../scripts/agent-v2-eval.mjs');
  assert.equal(fileOf('E1-peruna-sipuli-kerma'), 'E1-peruna-sipuli-kerma.json');
  assert.equal(fileOf('E1-peruna-sipuli-kerma', 3), 'E1-peruna-sipuli-kerma.r3.json');
  const row = (rep, failures, score) => ({ id: 'E1', rep, failures, cost: { bot: 0.1 * rep }, judgment: { scores: { kokonaisuus: { score } } } });
  const [x] = perScenario([row(1, [], 4), row(2, ['amount:sipuli=50'], 2), row(3, [], 5)]);
  assert.deepEqual({ n: x.n, passed: x.passed, mean: +x.judgeMean.toFixed(2), min: x.judgeMin, max: x.judgeMax, failures: x.failures }, { n: 3, passed: 2, mean: 3.67, min: 2, max: 5, failures: { amount: 1 } });
});

test('tuotevalinnat: valinta ilman vaihtoehtoja ja vaihtoehtojen jälkeen erotellaan', () => {
  const list = (sel) => ({ lines: [{ ref: 'r1', productTerm: 'peruna', selectedProductId: sel.p || null, selectedName: sel.p ? 'PERUNA' : null }, { ref: 'r2', productTerm: 'kerma', selectedProductId: sel.k || null, selectedName: sel.k ? 'KERMA' : null }] });
  const turn = (parts, sel) => ({ customer: [{ text: 'x', at: 0 }], replies: [{ parts }], chat: [], list: list(sel) });
  const conv = { turns: [
    turn(['Kirjasin perunan ja kerman.'], {}),
    turn(['Valitsin perunaksi PP kiinteä peruna 2 kg, 13,30 €. Kermasta vaihtoehdot:\n\n- Valio ruokakerma 1 l, 2,63 €\n- Arla ruokakerma 1 l, 3,31 €'], { p: '471033' }),
    turn(['Otetaan Valio.'], { p: '471033', k: '463828' }),
    turn(['Vaihdoin perunan.'], { p: '460573', k: '463828' }),
  ] };
  assert.deepEqual(selections(conv).map((s) => [s.term, s.afterOptions, s.change]), [['peruna', false, false], ['kerma', true, false], ['peruna', false, true]]);
});

test('merkkitarkistus: merkin ja tuotesanan pitää kuulua samaan työkalun tuotteeseen', async () => {
  const { unsupportedBrands, productsIn } = await import('./agent-v2-checks.mjs');
  const evidence = productsIn([JSON.stringify({ options: [{ productId: '471033', name: 'PP KIINTEÄ PERUNA 2KG PUSSI PESTY', brand: null },
    { productId: '463828', name: 'Valio ruokakerma 15 % 1 l UHT laktoositon', brand: 'Valio' }] }), JSON.stringify({ ok: true, product: { name: 'Saarioinen Lanttulaatikko 2,8kg', brand: 'Saarioinen' } })]);
  assert.deepEqual(unsupportedBrands('- 25 kpl Valio-kiinteää perunaa 2 kg pusseissa (50 kg)', evidence).map((x) => x.brand), ['Valio']);
  assert.deepEqual(unsupportedBrands('Kerma: Valio ruokakerma 15 % 1 l, laktoositon. Valion ruokakermaa 6 purkkia.', evidence), []);
  assert.deepEqual(unsupportedBrands('Moi! Olen Valio Aimon digitaalinen tilausapuri. Kehityksestä päättää Valion tiimi.', evidence), []);
  assert.deepEqual(unsupportedBrands('Saarioisen lanttulaatikko on loppu.', evidence), []);
  assert.deepEqual(unsupportedBrands('Saarioisen maksalaatikko käy tilalle.', evidence).map((x) => x.brand), ['Saarioinen']);
  assert.deepEqual(unsupportedBrands('Arla Pro ruokakerma 10 % 1 l', evidence).map((x) => x.brand), ['Arla']);
  const vocab = new Set(['perun', 'kiint', 'ruoka', 'kerma', 'lantt', 'maksa', 'laati']);
  assert.deepEqual(unsupportedBrands('Hinnat ovat viimeisimmät tunnetut, koska Valion hintarajapinta ei vastannut.', evidence, vocab), []);
  assert.deepEqual(unsupportedBrands('Kokeilin hakuja laktoositon juusto ja Valio viipale, mutta valikoimassa ei ollut niistä yhtään tuotetta.', evidence, new Set([...vocab, 'viipa'])), []);
  assert.deepEqual(unsupportedBrands('- 25 kpl Valio-kiinteää perunaa 2 kg pusseissa (50 kg)', evidence, vocab).map((x) => x.brand), ['Valio']);
});
