// v2-agentin luonnos ja tarkistuslista (docs/agent-v2.md, Työkalusopimus).
// Luonnos on täsmälleen sama JSON kuin tilauskeskustelussa (server/order-conversation/index.mjs), joten korisivu
// (getStorefrontCart), tarjous, maksu ja vanha ydin lukevat sen sellaisinaan. Agentin omat tiedot ovat luonnoksen ja rivien
// agent-kentässä, jota vanha koodi ei lue. Ainoa kovakoodi on tarkistuslista: toimituspäivä, ruokavalio, tuotteet, määrät
// ja lopuksi ostoskori. Tässä tiedostossa ei ole verkko- eikä mallikutsuja.
import crypto from 'node:crypto';
import { CLAIMS } from '../order-conversation/interpret.mjs';
import { ALLERGEN_LABEL, allergenName, roundToStep, stepOf, unitLabel } from '../catalog.mjs';
import { itemsPerSalesUnit } from '../itemQuantities.mjs';
import { unitSizeFor } from '../gateway/quantity.mjs';
import { helsinkiDate, helsinkiLabel, parseApiTime } from '../gateway/clock.mjs';
import { packWord, readableName } from '../order-conversation/wording.mjs';

/** Sama tyhjä luonnos kuin index.mjs:n newDraft (ei vientiä sieltä). Testi vertaa avaimia vanhan ytimen luonnokseen. */
export function newDraft(customer) {
  return { id: `WD-${crypto.randomUUID()}`, state: 'active', revision: 0, customerId: customer.customerId, bindingVersion: customer.bindingVersion,
    deliveryDate: null, deliverySiteId: customer.deliverySites?.length === 1 ? customer.deliverySites[0].id : null,
    diet: { known: false, claims: [], excludeAllergens: [] }, lines: [], offered: {}, seen: {}, quote: null, pending: null, lastRef: null, lastRefTurn: -1, turn: 0, seq: 0 };
}

/** Vanhan ytimen tai aiemman version luonnos täydennetään kenttiin, joita shoppingListView ja tarjous lukevat. */
export function fillDraft(draft) {
  draft.diet = { known: draft.diet?.known === true, claims: [...(draft.diet?.claims || [])], excludeAllergens: [...(draft.diet?.excludeAllergens || [])] };
  draft.lines = (draft.lines || []).map((l) => ({ ...l, claims: [...(l.claims || [])], excludeAllergens: [...(l.excludeAllergens || [])],
    selectedProductId: l.selectedProductId || null, selectedName: l.selectedName || null, selectedWarning: l.selectedWarning || null }));
  draft.offered ||= {}; draft.seen ||= {};
  draft.seq = Number.isInteger(draft.seq) ? draft.seq : draft.lines.length;
  return draft;
}

export const todayOf = (ms) => helsinkiDate(new Date(ms));
export function validDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}
export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export const weekdayOf = (iso) => new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${iso}T12:00:00Z`));
/** "pe 20.11." kuten vanhan ytimen dateLabel. */
export const dateLabel = (iso) => new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));

export const validQuantity = (q) => !!q && Number.isFinite(q.value) && q.value > 0 && q.value <= 100000 && ['L', 'KG', 'PCS'].includes(q.unit);
export const round2 = (n) => +(+n).toFixed(2); // sama pyöristys kuin portin money()
const round3 = (n) => +(+n).toFixed(3);

// ---------- Määrät ----------
// Työkalujen yksiköt. kpl = yksittäiset kappaleet (50 sipulia, 100 munaa), pakkaus = myyntierät (10 pakettia voita).
export const UNITS = ['kg', 'g', 'l', 'dl', 'kpl', 'pakkaus'];

/** Työkalun määrä luonnoksen muotoon {value, unit: L|KG|PCS, basis}. Kelvoton määrä palauttaa null. */
export function toQuantity(amount, unit) {
  const v = Number(amount);
  if (amount == null || !Number.isFinite(v) || v <= 0) return null;
  const q = unit === 'kg' ? { value: round3(v), unit: 'KG' } : unit === 'g' ? { value: round3(v / 1000), unit: 'KG' }
    : unit === 'l' ? { value: round3(v), unit: 'L' } : unit === 'dl' ? { value: round3(v / 10), unit: 'L' }
      : unit === 'kpl' ? { value: Math.ceil(v - 1e-9), unit: 'PCS', basis: 'items' }
        : unit === 'pakkaus' ? { value: round3(v), unit: 'PCS', basis: 'sales' } : null;
  return validQuantity(q) ? q : null;
}

/** Luonnoksen määrä takaisin työkalun yksiköihin: {amount, unit}. */
export function amountOf(q) {
  if (!q) return null;
  if (q.unit === 'KG') return { amount: q.value, unit: 'kg' };
  if (q.unit === 'L') return { amount: q.value, unit: 'l' };
  return { amount: q.value, unit: q.basis === 'sales' ? 'pakkaus' : 'kpl' };
}

const num = (n) => String(round3(n)).replace('.', ',');
/** "6 kg", "50 kpl", "2 pakkausta". */
export function amountText(q) {
  if (!q) return null;
  if (q.unit === 'PCS' && q.basis === 'sales') return `${num(q.value)} ${Number(q.value) === 1 ? 'pakkaus' : 'pakkausta'}`;
  return `${num(q.value)} ${{ KG: 'kg', L: 'l', PCS: 'kpl' }[q.unit]}`;
}

// ---------- Pakkaus ja muunnos ----------
/**
 * Kappaleet myyntierässä vain ilmoitetusta tiedosta: tuotetieto, nimi ("6 x", "M10"), laatikon yksikkömuunnos tai tusina.
 * Myyntiyksikkö "kpl" ei yksin kerro sisällön kappaleita: SIPULI 10KG SÄKKI on myyntiyksiköltään kpl, mutta säkissä on
 * kymmeniä sipuleita (WhatsApp 19.11.: "50 sipulia" tilattiin 50 säkkinä). Siksi itemsPerSalesUnit-arvaus "1 kpl" ei kelpaa.
 */
export function explicitItems(p) {
  const c = p ? itemsPerSalesUnit(p) : null;
  return c && (c.source !== 'sales-unit' || p.salesUnit === 'DZ') ? c.value : null;
}

const sizeIn = (p, price, unit) => { const s = unitSizeFor(p, price, unit, 'sales'); return s?.value > 0 ? s.value : null; };

/**
 * Myyntierän tiedot mallille: myyntiyksikkö ja sisältö kg, l tai kpl, kun ne tiedetään. Koot samalla laskulla kuin tarjous
 * (gateway unitSizeFor). price on valinnainen Valion hinta (vertailuhinta tarkentaa kokoa), muuten katalogin koko.
 */
export function packOf(p, price) {
  const label = unitLabel(p.salesUnit);
  const byWeight = p.salesUnit === 'KG';
  const kg = sizeIn(p, price, 'KG'); const l = sizeIn(p, price, 'L'); const items = explicitItems(p);
  const word = packWord(1, label);
  const parts = [kg && !byWeight ? `${num(kg)} kg` : null, l ? `${num(l)} l` : null, items ? `${num(items)} kpl` : null].filter(Boolean);
  return { salesUnit: label, byWeight, kg, l, items, step: stepOf(p),
    contents: byWeight ? 'myydään kiloittain: 1 myyntierä = 1 kg' : parts.length ? `1 ${word} = ${parts.join(' = ')}` : `1 ${word}, sisältöä ei ole tuotetiedoissa` };
}

/**
 * Asiakkaan määrä valitun tuotteen myyntierinä samalla laskulla kuin tarjous (gateway assess: koko, roundToStep ylös,
 * vähintään yksi askel). Kappaleet muunnetaan vain ilmoitetulla kappalemäärällä: kiloina tai yksittäin myytävän tuotteen
 * kappaleita ei arvata (50 kpl sipulia ei ole 50 säkkiä), vaan tulee UNIT_NOT_CONVERTIBLE pakkaustietoineen.
 */
export function convert(p, q, price) {
  const pack = packOf(p, price);
  const size = q.unit === 'PCS' ? (q.basis === 'items' ? pack.items : 1) : q.unit === 'KG' ? pack.kg : pack.l;
  if (!(size > 0)) return { ok: false, code: 'UNIT_NOT_CONVERTIBLE', pack };
  const packs = Math.max(stepOf(p), roundToStep(q.value / size, p, 'up'));
  const total = round3(packs * size);
  return { ok: true, packs, size, total: { value: total, unit: q.unit, ...(q.unit === 'PCS' ? { basis: q.basis || 'sales' } : {}) }, excess: round3(total - q.value), pack };
}

/** Selitys mallille, kun asiakkaan yksikkö ei muunnu tuotteen myyntieriksi. */
export function notConvertibleMessage(p, q, pack) {
  const name = readableName(p.name);
  if (q.unit === 'PCS' && q.basis === 'items') {
    return `Kappalemäärää ei voi muuntaa tuotteelle ${name} (${pack.contents}). Muunna määrä itse kiloiksi tai litroiksi, tai anna myyntierät (packs), ja kutsu uudelleen.`;
  }
  return `Määrää ${amountText(q)} ei voi muuntaa tuotteelle ${name} (${pack.contents}). Anna määrä toisessa yksikössä tai myyntierinä (packs).`;
}

// ---------- Tuotetiedot mallille ----------
const CLAIM_FI = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu' };
export const claimName = (c) => CLAIM_FI[c] || c;
/** Merkinnät suomeksi, kun ne ovat ruokavaliomerkintöjä; muut merkinnät koodeina. */
export const labelNames = (labels) => [...new Set((labels || []).map(claimName))];
export function allergensOf(p) {
  return { known: !!p?.hasAllergenData, contains: [...new Set((p?.contains || []).map(allergenName))], mayContain: [...new Set((p?.mayContain || []).map(allergenName))] };
}

// ---------- Ruokavalio ----------
// Allergeenit GS1-koodeina (catalog.mjs ALLERGEN_LABEL) tai sanoina. Tarkempi sana ensin: maapähkinä ei ole yleinen pähkinä.
const ALLERGEN_WORDS = [
  [/^(?:maapähkin|peanut)/, 'AP'], [/^(?:manteli|almond)/, 'SA'], [/^cashew/, 'SC'], [/^(?:hasselpähkin|hazelnut)/, 'SH'], [/^(?:pistaasi|pistachio)/, 'ST'],
  [/^(?:saksanpähkin|walnut)/, 'SW'], [/^(?:pekaani|pecan)/, 'SP'], [/^(?:macadamia|makadamia)/, 'SM'], [/^(?:parapähkin|brazil)/, 'SR'], [/^(?:pähkin|nut)/, 'AN'],
  [/^(?:laktoosi|lactose)/, 'ML'], [/^(?:maito|maido|dairy|milk)/, 'AM'], [/^(?:kananmun|muna|egg)/, 'AE'], [/^(?:kala|fish)/, 'AF'],
  [/^(?:äyriäi|shellfish|crustace|katkarap|rapu)/, 'AC'], [/^(?:nilviäi|mollus|simpuk)/, 'UM'], [/^(?:soija|soy)/, 'AY'], [/^(?:seesam|sesam)/, 'AS'],
  [/^(?:selleri|celery)/, 'BC'], [/^(?:sinap|mustard)/, 'BM'], [/^(?:lupiini|lupin)/, 'NL'], [/^(?:sulfiit|sulfit|sulphit|rikkidioksid)/, 'AU'],
  [/^(?:vehnä|wheat)/, 'UW'], [/^(?:ohra|barley)/, 'GB'], [/^(?:kaura|oat)/, 'GO'], [/^(?:ruis|rukii|rye)/, 'NR'], [/^(?:speltti|spelt)/, 'GS'], [/^kamut/, 'GK'],
  [/^(?:gluteeni|gluten|vilja)/, 'AW'],
];
const DIET_WORDS = [[/^(?:laktoosit|lactose[- ]?free)/, 'FREE_FROM_LACTOSE'], [/^(?:vähälaktoosi|low[- ]?lactose)/, 'LOW_LACTOSE'], [/^(?:gluteenit|gluten[- ]?free|keliak)/, 'FREE_FROM_GLUTEN'],
  [/^(?:vegaan|vegan|kasvipohjai)/, 'VEGAN'], [/^(?:kasvis|vegetaar|vegetarian)/, 'VEGETARIAN'], [/^(?:luomu|organic)/, 'EU_ORGANIC_FARMING']];
const wordOf = (raw) => String(raw ?? '').trim().toLocaleLowerCase('fi-FI').replace(/^(?:ei|ilman|no|without)\s+/u, '');

/** Allergeenit sanoina tai GS1-koodeina → koodit. Tuntemattomat palautetaan erikseen, niitä ei ohiteta hiljaa. */
export function allergenCodes(list) {
  const codes = []; const unknown = [];
  for (const raw of list || []) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (ALLERGEN_LABEL[code]) { codes.push(code); continue; }
    const hit = ALLERGEN_WORDS.find(([re]) => re.test(wordOf(raw)));
    if (hit) codes.push(hit[1]); else if (String(raw ?? '').trim()) unknown.push(String(raw).trim());
  }
  return { codes: [...new Set(codes)], unknown };
}

/** Ruokavaliot sanoina tai merkintäkoodeina (interpret.mjs CLAIMS) → koodit. */
export function dietCodes(list) {
  const codes = []; const unknown = [];
  for (const raw of list || []) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (CLAIMS.includes(code)) { codes.push(code); continue; }
    const hit = DIET_WORDS.find(([re]) => re.test(wordOf(raw)));
    if (hit) codes.push(hit[1]); else if (String(raw ?? '').trim()) unknown.push(String(raw).trim());
  }
  return { codes: [...new Set(codes)], unknown };
}

// ---------- Revisio ja tarkistuslista ----------
/**
 * Sisältö, jonka muutos kasvattaa revisiota ja mitätöi tarjouksen ja hyväksynnän (kuten index.mjs:n content). Mukana myös
 * ruokavalion selvitys (diet.known), koska se muuttaa shoppingListView-tilaa, ja tila (state).
 */
export const contentKey = (d) => JSON.stringify([d.state, d.deliveryDate || null, d.deliverySiteId || null, d.diet?.known === true, d.diet?.claims || [], d.diet?.excludeAllergens || [],
  (d.lines || []).map((l) => [l.ref, l.productTerm, l.quantity || null, l.claims || [], l.excludeAllergens || [], l.selectedProductId || null, l.answeredClaims || []])]);

/**
 * Ruokavalion selvitys näkyy shoppingListView-tilassa: ennen kuin asiakas on kertonut allergiat tai vahvistanut, ettei niitä
 * ole, luonnoksella on avoin tarkennus (pending preference) kaikista riveistä. Silloin tila on needs_details eikä review,
 * ja review on täsmälleen silloin, kun checklist.ready on tosi.
 */
export function syncPending(draft) {
  draft.pending = draft.diet?.known !== true && draft.lines?.length ? { kind: 'preference', refs: draft.lines.map((l) => l.ref), claim: null, reason: 'diet' } : null;
}

/** Rivin tallennettu tarkistus pätee vain samalle päivälle, tuotteelle ja määrälle. */
export function quotedFor(line, date) {
  const q = line.agent?.quoted;
  return q && date && q.date === date && q.productId === String(line.selectedProductId || '') && JSON.stringify(q.quantity) === JSON.stringify(line.quantity) ? q : null;
}

/** Aikaisin tilausaikaraja valituista, tälle päivälle tarkistetuista riveistä. */
export function earliestCutoff(lines, date) {
  const cutoffs = (lines || []).map((l) => quotedFor(l, date)?.cutoff).filter((c) => parseApiTime(c)).sort((a, b) => parseApiTime(a) - parseApiTime(b));
  return cutoffs.length ? helsinkiLabel(cutoffs[0]) : null;
}

/**
 * Tarkistuslista. ready = toimituspäivä (tuleva, toimituspaikka tiedossa), ruokavalio selvitetty, jokaisella rivillä tuote ja
 * määrä. Työkalut tarkistavat valitun tuotteen tilattavuuden päivälle aina valittaessa ja päivää vaihdettaessa ja purkavat
 * valinnan, joka ei käy, joten ready tarkoittaa myös, että rivit ovat tilattavissa päivälle.
 */
export function checklist(draft, today) {
  const lines = draft?.state === 'active' ? draft.lines || [] : [];
  const date = draft?.state === 'active' && validDate(draft?.deliveryDate) && draft.deliveryDate >= today ? draft.deliveryDate : null;
  const site = !!draft?.deliverySiteId;
  const deliveryDate = { done: !!date && site, date, weekday: date ? weekdayOf(date) : null, orderBy: date ? earliestCutoff(lines, date) : null, ...(site ? {} : { siteMissing: true }) };
  const known = draft?.state === 'active' && draft?.diet?.known === true;
  const diet = { done: known, allergens: [...(draft?.diet?.excludeAllergens || [])], diets: [...(draft?.diet?.claims || [])],
    none: known && !(draft.diet.claims || []).length && !(draft.diet.excludeAllergens || []).length };
  const noProduct = lines.filter((l) => !l.selectedProductId).map((l) => l.productTerm);
  const noQuantity = lines.filter((l) => !validQuantity(l.quantity)).map((l) => l.productTerm);
  const products = { done: lines.length > 0 && !noProduct.length, missing: noProduct };
  const quantities = { done: lines.length > 0 && !noQuantity.length, missing: noQuantity };
  return { deliveryDate, diet, products, quantities, ready: deliveryDate.done && diet.done && products.done && quantities.done };
}

/** Mitä korilinkistä vielä puuttuu, koneluettavasti: deliveryDate, deliverySite, diet, items, product:<tarve>, quantity:<tarve>. */
export function missingOf(c) {
  return [...(c.deliveryDate.date ? [] : ['deliveryDate']), ...(c.deliveryDate.siteMissing ? ['deliverySite'] : []), ...(c.diet.done ? [] : ['diet']),
    ...(!c.products.done && !c.products.missing.length ? ['items'] : []),
    ...c.products.missing.map((t) => `product:${t}`), ...c.quantities.missing.map((t) => `quantity:${t}`)];
}
