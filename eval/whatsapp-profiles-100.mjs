// Synthetic, versioned customer goals. These expectations are independent of model judgments.
const q = (term, value, unit, extra = {}) => ({ term, value, unit, ...extra });
const personas = [
  { business: 'Lounasravintola', person: 'kiireinen keittiöpäällikkö', style: 'Lyhyet puhekieliset viestit. Vastaa vain olennaiseen.' },
  { business: 'Kahvila', person: 'uusi tilaaja', style: 'Rauhallinen yleiskieli. Kysy tarvittaessa mitä seuraavaksi tehdään.' },
  { business: 'Pitopalvelu', person: 'tarkka yrittäjä', style: 'Tarkista määrät ja toimituspäivä. Älä hyväksy väärää tuotetta tai sisältöä.' },
  { business: 'Hotellikeittiö', person: 'vuoronvaihdossa oleva kokki', style: 'Puhekieltä, lyhenteitä ja pieniä kirjoitusvirheitä. Pysy silti ostotavoitteessa.' },
  { business: 'Yhdistyksen tapahtumakeittiö', person: 'satunnainen ostaja', style: 'Kysy ymmärrettävä seuraava askel, jos ohje jää epäselväksi. Kohtelias, käytännöllinen.' },
];

// Twenty distinct journeys, each exercised by five different buyers with different amounts.
const journeys = [
  (v) => ({ route: 'eggs', first: `${30 + v * 10} kananmunaa 20.11.2026, tavalliset käy`, lines: [q('kananmuna', 30 + v * 10, 'PCS')], noIrrelevantDiet: true }),
  (v) => ({ route: 'milk', first: `${10 + v * 5} litraa maitoa 20.11.2026, tavallinen käy`, preferenceAlreadyGiven: true, lines: [q('maito', 10 + v * 5, 'L')] }),
  (v) => ({ route: 'decilitres', first: `${5 + v} desii kermaa 20.11.2026, laktoositonta`, lines: [q('kerma', (5 + v) / 10, 'L', { claim: 'FREE_FROM_LACTOSE' })] }),
  (v) => ({ route: 'grams', first: `${500 + v * 100} grammaa voita 20.11.2026, tavallinen käy`, preferenceAlreadyGiven: true, lines: [q('voi', (500 + v * 100) / 1000, 'KG')] }),
  (v) => ({ route: 'mixed-basket', first: `${20 + v} l maitoa, ${30 + v * 10} kananmunaa ja 5 dl kermaa 20.11.2026`, lines: [q('maito', 20 + v, 'L'), q('kananmuna', 30 + v * 10, 'PCS'), q('kerma', 0.5, 'L')] }),
  (v) => ({ route: 'quantity-correction', first: '50 l maitoa ja 2 l kermaa 20.11.2026, molemmat laktoosittomia', moves: [`Eiku maito ${15 + v * 5} litraan, kerma pysyy 2 litrassa.`], lines: [q('maito', 15 + v * 5, 'L', { claim: 'FREE_FROM_LACTOSE' }), q('kerma', 2, 'L', { claim: 'FREE_FROM_LACTOSE' })] }),
  (v) => ({ route: 'remove-and-correct', first: '5 kg voita ja 10 l maitoa 20.11.2026', moves: [`Poista maito kokonaan ja muuta voi ${1 + v} kiloksi.`], lines: [q('voi', 1 + v, 'KG')], absent: ['maito'] }),
  (v) => ({ route: 'add-later', first: `${20 + v * 10} kananmunaa 20.11.2026`, moves: [`Lisää myös ${1 + v} litraa kermaa, tavallinen käy.`], lines: [q('kananmuna', 20 + v * 10, 'PCS'), q('kerma', 1 + v, 'L')] }),
  (v) => ({ route: 'change-delivery', first: `${10 + v} l maitoa 20.11.2026`, moves: ['Siirrä koko tilaus päivälle 23.11.2026. Muut tiedot samana.'], date: '2026-11-23', lines: [q('maito', 10 + v, 'L')] }),
  (v) => ({ route: 'advice-before-order', first: 'Mikä kerma sopii lohikeittoon? En vielä tilaa mitään.', moves: [`Otetaan nyt ${1 + v} l ruokakermaa 20.11.2026, laktoositon käy.`], lines: [q('kerma', 1 + v, 'L')], adviceFirst: true }),
  (v) => ({ route: 'milk-allergy', first: `${2 + v} l kaurajuomaa 20.11.2026. Maitoallergia, pitää olla maidoton.`, lines: [q('kaura', 2 + v, 'L', { allergen: 'AM' })], canBlock: true }),
  (v) => ({ route: 'gluten-free', first: `${1 + v} kg gluteenitonta jauhoseosta 20.11.2026`, lines: [q('jauho', 1 + v, 'KG', { claim: 'FREE_FROM_GLUTEN' })], canBlock: true }),
  (v) => ({ route: 'vegan', first: `${2 + v} l vegaanista kaurajuomaa 20.11.2026`, lines: [q('kaura', 2 + v, 'L', { claim: 'VEGAN' })], canBlock: true }),
  (v) => ({ route: 'millilitres', first: `${250 + v * 50} ml kermaa 20.11.2026`, lines: [q('kerma', (250 + v * 50) / 1000, 'L')] }),
  (v) => ({ route: 'preserve-on-negative-reset', first: `${10 + v} l maitoa 20.11.2026`, moves: ['Älä tyhjennä koria. Miten tätä tilausta voi vielä muuttaa?'], lines: [q('maito', 10 + v, 'L')] }),
  (v) => ({ route: 'fresh-start', first: '10 l maitoa 20.11.2026', moves: ['Tyhjennä kori ja aloitetaan alusta.', `Uuteen koriin ${20 + v * 10} kananmunaa 20.11.2026.`], lines: [q('kananmuna', 20 + v * 10, 'PCS')], absent: ['maito'] }),
  (v) => ({ route: 'missing-details', first: 'tarvis maitoo ja kermaa', requireDateFirst: true, lines: [q('maito', 10 + v * 5, 'L'), q('kerma', 1 + v, 'L')], details: `Maitoa ${10 + v * 5} l ja kermaa ${1 + v} l 20.11.2026. Tavalliset käy.` }),
  (v) => ({ route: 'greeting-mid-order', first: `${2 + v} kg voita 20.11.2026`, moves: ['Moi taas!'], lines: [q('voi', 2 + v, 'KG')] }),
  (v) => ({ route: 'decline-extras', first: `${20 + v * 10} kananmunaa 20.11.2026. En halua muita tuotteita.`, moves: ['Ei mitään lisätuotteita. Jatketaan vain kananmunilla.'], lines: [q('kananmuna', 20 + v * 10, 'PCS')] }),
  (v) => ({ route: 'unavailable-product', first: `${1 + v} kg kuukivijogurttia 20.11.2026. En hyväksy korvaavia tuotteita.`, lines: [q('kuukivi', 1 + v, 'KG')], blocked: true }),
];

export const PROFILES = personas.flatMap((persona, variant) => journeys.map((create, routeIndex) => {
  const goal = create(variant);
  return { id: `P${String(variant * journeys.length + routeIndex + 1).padStart(3, '0')}`, persona,
    date: '2026-11-20', moves: [], ...goal,
    goal: `Osta vain nämä tarpeet: ${goal.lines.map((l) => `${l.term} ${l.value} ${l.unit}${l.claim ? ` (${l.claim})` : ''}${l.allergen ? ` (ei allergeenia ${l.allergen})` : ''}`).join(', ')}. Toimitus ${goal.date || '2026-11-20'}. ${goal.details || ''} Tavallinen tuote käy, jos muuta ei sanottu. Valitse sopiva näytetyistä vaihtoehdoista. Pyydä korilinkki ja jatka tarkistukseen. Älä muuta tavoitetta apurin virheen takia. ${goal.blocked ? 'Tuotetta ei oikeasti ole. Älä hyväksy korviketta äläkä vahvista mitään muuta.' : 'Lopullinen demovahvistus tehdään vain eristetyssä selainkorissa, kun sisältö on oikein.'}`,
  };
}));

export const redact = (value) => String(value || '').replace(/https?:\/\/[^\s<>]+/gu, '[korilinkki]');
const matches = (line, term) => String(line.productTerm || '').toLowerCase().includes(term);

export function normalizeCases(cases, { productExists = () => true } = {}) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 100) throw new Error('Cases must contain 1–100 synthetic profiles.');
  const ids = new Set();
  const text = (value, name, max = 4000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid case field: ${name}`);
    return value.trim();
  };
  return cases.map((input) => {
    const id = text(input.id, 'id', 80);
    if (!/^[A-Za-z0-9_.-]+$/u.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate case id: ${id}`); ids.add(id);
    const persona = Object.fromEntries(['business', 'person', 'style'].map((key) => [key, text(input.persona?.[key], `persona.${key}`, 1000)]));
    if (!['order', 'stop'].includes(input.outcome)) throw new Error(`Case ${id} needs outcome order or stop.`);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.date || '') || Number.isNaN(Date.parse(`${input.date}T12:00:00Z`))
        || new Date(`${input.date}T12:00:00Z`).toISOString().slice(0, 10) !== input.date) throw new Error(`Invalid date in ${id}`);
    if (!Array.isArray(input.lines) || (!input.lines.length && input.outcome !== 'stop') || input.lines.length > 20) throw new Error(`Invalid lines in ${id}`);
    const lines = input.lines.map((line) => {
      const term = text(line.term, 'term', 80).toLowerCase();
      if (!Number.isFinite(line.value) || line.value <= 0 || line.value > 100000 || !['L', 'KG', 'PCS'].includes(line.unit)) throw new Error(`Invalid quantity in ${id}`);
      const need = Array.isArray(line.need) ? line.need.join(', ') : String(line.need || '');
      const clauses = need.split(/\s*(?:,|;|\bja\b|\bsekä\b)\s*/iu).filter(Boolean);
      const supported = /^(?:laktoosit\p{L}*|vähälaktoos\p{L}*|gluteenit\p{L}*|keliakia|vegaan\p{L}*|luomu|maidot\p{L}*|maitoallerg\p{L}*|munaton|muna-allerg\p{L}*|(?:maa)?pähkinät\p{L}*|(?:maa)?pähkinäallerg\p{L}*|soijaton|soija-allerg\p{L}*|kalaton|kala-allerg\p{L}*|ei (?:maitoa|(?:maa)?pähkin\p{L}*)|tavallinen|ei rajoitteita|ei erityisvaatimuksia)$/iu;
      if (clauses.some((clause) => !supported.test(clause.trim()))) throw new Error(`Unrecognized dietary need in ${id}: ${need}`);
      const claims = []; const allergens = [];
      if (/laktoosit(?:on|to)/iu.test(need)) claims.push('FREE_FROM_LACTOSE');
      if (/vähälaktoos/iu.test(need)) claims.push('LOW_LACTOSE');
      if (/gluteenit|keliakia/iu.test(need)) claims.push('FREE_FROM_GLUTEN');
      if (/vegaan/iu.test(need)) claims.push('VEGAN');
      if (/luomu/iu.test(need)) claims.push('EU_ORGANIC_FARMING');
      if (/maidot|maitoallerg|ei maitoa/iu.test(need)) allergens.push('AM');
      if (/munaton|muna-allerg/iu.test(need)) allergens.push('AE');
      if (/pähkinät|ei pähkin|pähkinäallerg/iu.test(need)) allergens.push('AN');
      if (/maapähkinät|ei maapähkin|maapähkinäallerg/iu.test(need)) allergens.push('AP');
      if (/soijaton|soija-allerg/iu.test(need)) allergens.push('AY');
      if (/kalaton|kala-allerg/iu.test(need)) allergens.push('AF');
      if (need.trim() && !claims.length && !allergens.length && !/^(?:tavallinen|ei rajoitteita|ei erityisvaatimuksia)$/iu.test(need.trim())) throw new Error(`Unrecognized dietary need in ${id}: ${need}`);
      if (input.outcome === 'order' && !productExists(term)) throw new Error(`Case ${id}: catalog does not verify product '${term}'; use outcome stop or correct the term.`);
      return { term, value: line.value, unit: line.unit, claims, allergens, need };
    });
    const moves = input.moves || [];
    if (!Array.isArray(moves) || moves.length > 20) throw new Error(`Invalid moves in ${id}`);
    return { id, persona, route: 'external', first: text(input.first, 'first'), moves: moves.map((move) => text(move, 'move')),
      lines, date: input.date, absent: (input.absent || []).map((term) => text(term, 'absent', 80)), blocked: input.outcome === 'stop',
      goal: JSON.stringify({ expected: lines, date: input.date, outcome: input.outcome, answers: input.answers || '',
        trap: input.trap || '', expectedGoodBehavior: input.good || '', avoidDeadEnd: input.dead_end || '' }) };
  });
}

// Evaluation-only evidence: a customer's later "two 1 l cartons" can equal the original 2 l goal.
// Only exact physical equivalence from catalog data is accepted, never a model's conversion.
export function withQuantityEvidence(list, product) {
  if (!list) return list;
  return { ...list, lines: list.lines.map((line) => {
    const p = line.selectedProductId && product(String(line.selectedProductId));
    if (line.quantity?.unit !== 'PCS' || line.quantity.basis === 'items' || !p) return line;
    const amounts = {};
    if (Number.isFinite(p.litres) && p.litres > 0) amounts.L = line.quantity.value * p.litres;
    if (Number.isFinite(p.kg) && p.kg > 0) amounts.KG = line.quantity.value * p.kg;
    return { ...line, catalogQuantityEvidence: amounts };
  }) };
}

export function inspectBasket(profile, list) {
  const failures = [];
  for (const wanted of profile.lines) {
    const lines = list?.lines?.filter((l) => matches(l, wanted.term)) || [];
    if (lines.length !== 1) { failures.push(`${lines.length ? 'duplicate' : 'missing'}:${wanted.term}`); continue; }
    const line = lines[0];
    if (line.selectedName && !line.selectedName.toLowerCase().includes(wanted.term)) failures.push(`selected_product:${wanted.term}`);
    const exact = Number.isFinite(line.quantity?.value) && Math.abs(line.quantity.value - wanted.value) <= 1e-9 && line.quantity.unit === wanted.unit;
    const equivalent = Number.isFinite(line.catalogQuantityEvidence?.[wanted.unit]) && Math.abs(line.catalogQuantityEvidence[wanted.unit] - wanted.value) <= 1e-9;
    if (!exact && !equivalent) failures.push(`quantity:${wanted.term}`);
    for (const claim of wanted.claims || (wanted.claim ? [wanted.claim] : [])) if (![...(line.claims || []), ...(list.diet?.claims || [])].includes(claim)) failures.push(`claim:${wanted.term}`);
    for (const allergen of wanted.allergens || (wanted.allergen ? [wanted.allergen] : [])) if (![...(line.excludeAllergens || []), ...(list.diet?.excludeAllergens || [])].includes(allergen)) failures.push(`allergen:${wanted.term}`);
  }
  for (const line of list?.lines || []) if (!profile.lines.some((w) => matches(line, w.term))) failures.push(`unexpected:${line.productTerm}`);
  for (const term of profile.absent || []) if (list?.lines?.some((line) => matches(line, term))) failures.push(`unremoved:${term}`);
  if (!(profile.blocked && !profile.lines.length) && list?.deliveryDate !== profile.date) failures.push('delivery_date');
  return [...new Set(failures)];
}

export function inspectResult(profile, result) {
  const failures = [...inspectBasket(profile, result.finalBasket)];
  if (profile.adviceFirst && result.turns[0]?.list?.lines?.length) failures.push('advice_created_item');
  if (profile.requireDateFirst && (!/(?:päiv|milloin)/iu.test(result.turns[0]?.assistant || '')
      || /(?:kuinka paljon|paljonko|montako|laktoositonta vai|\n1\.\s)/iu.test(result.turns[0]?.assistant || ''))) failures.push('delivery_not_asked_first');
  if (profile.preferenceAlreadyGiven && /(?:haluatko|käykö)[^\n?]*(?:laktoositonta|tavallinen)/iu.test(result.turns[0]?.assistant || '')) failures.push('preference_asked_again');
  if (result.turns.some((t) => /korilinkki[^\n.!?]{0,90}(?:ei[^\n.!?]*(?:saa|pysty|onnistu)|en[^\n.!?]*pysty)/iu.test(t.assistant))) failures.push('cart_link_capability_denied');
  if (profile.noIrrelevantDiet && result.turns.some((t) => /(?:onko|haluatko|tarvitsetko|pitääkö|käykö)[^\n?]*(?:laktoos|gluteen)/iu.test(t.assistant))) failures.push('irrelevant_egg_diet_question');
  if (result.prematureOrders) failures.push('order_before_browser_confirmation');
  if (result.duplicateOrders) failures.push('duplicate_order');
  if (result.orderContentMismatch) failures.push('saved_order_content_mismatch');
  if (profile.blocked || result.safelyBlocked) {
    if (result.orderCount) failures.push('blocked_profile_ordered');
    if (!result.blockReason) failures.push('missing_block_explanation');
    if (profile.route === 'unavailable-product' && result.turns.some((turn) => turn.status === 'ready' || turn.list?.lines?.some((line) => line.selectedProductId))) failures.push('unavailable_product_replaced');
  } else {
    if (!result.linkOpened) failures.push('cart_link_not_opened');
    if (!result.reviewed) failures.push('review_not_reached');
    if (!result.confirmed || result.orderCount !== 1) failures.push('demo_order_not_confirmed');
  }
  return [...new Set(failures)];
}

export function diagnoseDeadEnds(result) {
  if (result.confirmed || result.safelyBlocked) return [];
  const turns = result.turns || []; const evidence = [];
  const normalized = (text) => redact(text).toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();
  for (let i = 0; i < turns.length; i++) {
    const current = turns[i];
    if (/käsittely ei nyt onnistunut|en ymmärtänyt|en saanut selvää/iu.test(current.assistant)) evidence.push({ reason: 'fallback', turn: i + 1, reply: redact(current.assistant) });
    if (i && normalized(current.assistant) === normalized(turns[i - 1].assistant)) evidence.push({ reason: 'repeated_reply', turn: i + 1, reply: redact(current.assistant) });
  }
  const content = (list) => list ? JSON.stringify([list.id, list.deliveryDate, list.diet, list.lines]) : null;
  if (turns.length >= 3 && turns.slice(-3).every((turn) => content(turn.list) === content(turns.at(-1).list))) {
    evidence.push({ reason: 'no_progress', turn: turns.length, reply: redact(turns.at(-1).assistant) });
  }
  if (result.hitTurnLimit) evidence.push({ reason: 'turn_limit', turn: turns.length, reply: redact(turns.at(-1)?.assistant) });
  if (result.customerStuck) evidence.push({ reason: 'customer_stuck', turn: turns.length, reply: redact(result.customerStuck) });
  return evidence;
}
