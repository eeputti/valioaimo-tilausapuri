// OSTAJAN MANDAATTI = valtuutus, jonka rajoissa ostoagentti saa toimia. Mandaatti on dataa (JSON), ei promptia:
// kielimalli voi ehdottaa mitä tahansa, mutta tilauksen kohtalon päättää tämä deterministinen koodi.
//
// Tiimin linjaus: oletuksena MIKÄÄN tilaus ei lähde ilman ostajan hyväksyntää (approval: 'always').
// Ostaja voi itse löysätä: 'exceptions' = kuittaus vain poikkeuksissa, 'autonomous' = itsenäinen sääntöjen sisällä.
// Agentti ei koskaan saa enempää valtaa kuin ostaja on sille erikseen antanut, eikä allergeenirajoitetta voi ohittaa edes hyväksynnällä.
import { buyers, orders } from './store.mjs';
import { clock, helsinkiDate } from './clock.mjs';
import { reason } from './contract.mjs';
import { loadCatalog, allergenName } from '../catalog.mjs';
import { allergenStatus } from '../allergens.mjs';

export const DEFAULT_MANDATE = {
  approval: 'always', // 'always' | 'exceptions' | 'autonomous'
  maxOrderNet: null, // € alv 0 % / tilaus; null = ei omaa kattoa (tasolla 'always' kaikki kuitataan joka tapauksessa)
  maxDayNet: null, // € alv 0 % / päivä
  requiredClaims: [], // esim. ['FREE_FROM_LACTOSE']
  bannedAllergens: [], // GS1-koodit, esim. ['AP']
  allowedCategories: null, // null = kaikki
  substitution: { allow: true, maxUnitPriceIncreasePct: 10, minReliability: 0.9 },
  maxDateShiftDays: 0, // montako päivää toimitus saa myöhästyä ilman kysymistä
};

// Demon ostajat. Avaimet ovat julkisia demoavaimia (README); tuotannossa OAuth 2.0 client credentials tai allekirjoitettu mandaatti.
const DEMO_BUYERS = [
  { id: 'nordic-hotels', name: 'Nordic Hotels Oy', kind: 'Hotelliketju, oma ostoagentti', apiKey: 'demo-nordic-hotels', approver: 'Hankintapäällikkö', mandate: { ...DEFAULT_MANDATE, approval: 'autonomous', maxOrderNet: 1000, maxDayNet: 5000 } },
  { id: 'ravintola-kulma', name: 'Ravintola Kulma', kind: 'Lounasravintola, keittiön tilausagentti', apiKey: 'demo-ravintola-kulma', approver: 'Keittiöpäällikkö', mandate: { ...DEFAULT_MANDATE, approval: 'exceptions', maxOrderNet: 6000, maxDayNet: 8000 } },
  { id: 'kahvila-aalto', name: 'Kahvila Aalto', kind: 'Uusi asiakas, oletusmandaatti', apiKey: 'demo-kahvila-aalto', approver: 'Omistaja', mandate: { ...DEFAULT_MANDATE } },
];
export function seedBuyers({ force = false } = {}) {
  for (const b of DEMO_BUYERS) if (force || !buyers.byId(b.id)) buyers.save(structuredClone(b));
}

/** Mandaatti kitchen-puolen korvaajahaun säännöiksi (substitutes.mjs). Allergeenisääntö on aina päällä. */
export const substitutionRules = (m) => ({ bannedAllergens: m.bannedAllergens, blockedVendors: [], subSameAllergens: true, preferDomestic: false, minReliability: m.substitution.minReliability, subMaxPriceIncreasePct: m.substitution.maxUnitPriceIncreasePct });

/** Staattiset tuotekohtaiset esteet. Palauttaa syyn tai null. Näitä ei voi ohittaa hyväksynnällä. */
// Kielto katsoo koodihierarkian (allergens.mjs): pähkinäkielto (AN) osuu myös mantelin (SA) koodiin ja viljakielto (AW) vehnän (UW).
export function productBlock(mandate, p) {
  const banned = allergenStatus(mandate.bannedAllergens, p).contains;
  if (banned.length) return reason('ALLERGEN_BANNED', 'block', { productId: p.id, allergens: banned, names: banned.map(allergenName) });
  const missing = (mandate.requiredClaims || []).filter((c) => !p.labels?.includes(c));
  if (missing.length) return reason('REQUIRED_CLAIM_MISSING', 'block', { productId: p.id, claims: missing });
  if (mandate.allowedCategories && !mandate.allowedCategories.includes(p.category)) return reason('CATEGORY_NOT_ALLOWED', 'block', { productId: p.id, category: p.category });
  return null;
}

/**
 * Allergeenikielto, jota tuotteen tiedot eivät todista täytetyksi: "voi sisältää" kiellettyä allergeenia tai allergeenitieto
 * puuttuu kokonaan (noin 10 300 tuotteella 17 546:sta). Näitä ei vahvisteta automaattisesti millään mandaatin tasolla:
 * ihminen päättää (katselmus 15.11. #4). Este (productBlock) ratkaistaan ennen tätä.
 */
export function productAllergenReview(mandate, p) {
  const s = allergenStatus(mandate.bannedAllergens, p);
  const out = [];
  if (s.mayContain.length) out.push(reason('ALLERGEN_MAY_CONTAIN', 'approval', { productId: p.id, allergens: s.mayContain, names: s.mayContain.map(allergenName) }));
  if (s.unknown) out.push(reason('ALLERGEN_DATA_MISSING', 'approval', { productId: p.id, banned: [...new Set(mandate.bannedAllergens)], names: [...new Set(mandate.bannedAllergens)].map(allergenName) }));
  return out;
}

/** Tilauksen mukana annetut allergeenikiellot: vain GS1-koodin näköiset merkkijonot, enintään 20. */
export const orderAllergenBans = (list) => [...new Set((Array.isArray(list) ? list : []).filter((a) => typeof a === 'string' && /^[A-Z]{2,3}$/.test(a)))].slice(0, 20);

const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

/**
 * Arvioi tilauksen mandaattia vasten.
 * @param {object} buyer
 * @param {{lines: Array, totals: {net: number}, flags: string[], requestedDeliveryDate?: string, deliveryDate: string, substitutions: Array}} draft
 * @returns {{status: 'confirmed'|'pending_approval'|'rejected', reasons: Array}}
 * severity: block = hylätään aina, approval = ihminen päättää, info = kirjataan ja ilmoitetaan jälkikäteen
 */
export function evaluateMandate(buyer, draft, { excludeOrderId, extraBannedAllergens = [] } = {}) {
  // Tilauksen oma allergiakielto (esim. WhatsApp-asiakkaan "lapsella maitoallergia") arvioidaan kuten mandaatin kielto: sisältävä
  // tuote on este, ja "voi sisältää" tai puuttuva allergeenitieto vie ihmisen hyväksyntään (katselmus #4, itsepeli V033).
  // Kielto voi vain tiukentaa mandaattia, ei koskaan löysätä sitä.
  const extra = orderAllergenBans(extraBannedAllergens);
  const m = extra.length ? { ...buyer.mandate, bannedAllergens: [...new Set([...(buyer.mandate.bannedAllergens || []), ...extra])] } : buyer.mandate;
  const cat = loadCatalog();
  const reasons = [];
  for (const line of draft.lines) {
    const p = cat.get(line.productId);
    const block = p ? productBlock(m, p) : reason('UNKNOWN_PRODUCT', 'block', { productId: line.productId });
    if (block) reasons.push(block);
    else reasons.push(...productAllergenReview(m, p));
  }
  const net = draft.totals.net;
  if (m.maxOrderNet != null && net > m.maxOrderNet + 0.004) reasons.push(reason('SPEND_CAP_ORDER', 'approval', { orderNet: net, cap: m.maxOrderNet, overBy: +(net - m.maxOrderNet).toFixed(2), currency: 'EUR' }));
  if (m.maxDayNet != null) {
    const today = clock.today();
    // Kiertävällä demokellolla jokainen tilaus syntyy samalle demopäivälle, joten päiväraja kertyi kierroksesta toiseen ja lopulta
    // kaikki jäi odottamaan hyväksyntää (katselmus 15.11. #16). Kierros on demon "päivä": vain saman kierroksen tilaukset lasketaan.
    // Tilaus ilman kierrostietoa on tehty ennen tätä korjausta, eli jollain aiemmalla kierroksella.
    const cycle = clock.cycle();
    const sameDay = (o) => helsinkiDate(new Date(o.createdAt)) === today && (!clock.looping || o.clockCycle === cycle);
    const spent = orders.list(buyer.id, 500).filter((o) => o.orderId !== excludeOrderId && ['confirmed', 'pending_approval'].includes(o.status) && sameDay(o)).reduce((s, o) => s + o.totals.net, 0);
    if (spent + net > m.maxDayNet + 0.004) reasons.push(reason('SPEND_CAP_DAY', 'approval', { spentToday: +spent.toFixed(2), orderNet: net, cap: m.maxDayNet, currency: 'EUR' }));
  }
  for (const s of draft.substitutions || []) {
    // Tasolla 'autonomous' sääntöjen sisällä pysyvä korvaaja hyväksytään itse ja ihminen saa ilmoituksen. Muilla tasoilla kysytään.
    const within = s.withinPolicy && m.substitution.allow;
    reasons.push(reason(within ? 'SUBSTITUTION_WITHIN_POLICY' : 'SUBSTITUTION_OUTSIDE_POLICY', within && m.approval === 'autonomous' ? 'info' : 'approval', s));
  }
  if (draft.requestedDeliveryDate && draft.deliveryDate > draft.requestedDeliveryDate) {
    const shift = daysBetween(draft.requestedDeliveryDate, draft.deliveryDate);
    reasons.push(reason('DELIVERY_DATE_SHIFT', shift > (m.maxDateShiftDays || 0) ? 'approval' : 'info', { requested: draft.requestedDeliveryDate, earliest: draft.deliveryDate, shiftDays: shift, allowedDays: m.maxDateShiftDays || 0 }));
  }
  if (m.approval === 'always') reasons.push(reason('APPROVAL_ALWAYS', 'approval', {}));
  const status = reasons.some((r) => r.severity === 'block') ? 'rejected' : reasons.some((r) => r.severity === 'approval') ? 'pending_approval' : 'confirmed';
  return { status, reasons };
}

export function publicMandate(buyer) {
  const m = buyer.mandate;
  return {
    buyerId: buyer.id, buyerName: buyer.name, mandate: m,
    summary: {
      fi: m.approval === 'always' ? 'Jokainen tilaus vaatii ihmisen hyväksynnän.' : `${m.approval === 'autonomous' ? 'Agentti saa tilata itsenäisesti sääntöjen sisällä' : 'Agentti saa tilata ilman kuittausta, kun poikkeuksia ei ole'}${m.maxOrderNet != null ? `, enintään ${m.maxOrderNet} € / tilaus (alv 0 %)` : ''}. ${m.approval === 'autonomous' ? 'Sääntöjen sisällä pysyvän korvaajan agentti hyväksyy itse, ja ihminen saa ilmoituksen.' : 'Korvaava tuote kysytään aina.'} Allergeenirajoitetta ei voi ohittaa.`,
    },
  };
}

export function updateMandate(buyerId, patch) {
  const b = buyers.byId(buyerId);
  if (!b) return null;
  if (['always', 'exceptions', 'autonomous'].includes(patch.approval)) b.mandate.approval = patch.approval;
  for (const key of ['maxOrderNet', 'maxDayNet']) if (key in patch) b.mandate[key] = patch[key] === null || patch[key] === '' ? null : Math.max(0, Number(patch[key]) || 0);
  if (Array.isArray(patch.bannedAllergens)) b.mandate.bannedAllergens = patch.bannedAllergens.map(String);
  if (Array.isArray(patch.requiredClaims)) b.mandate.requiredClaims = patch.requiredClaims.map(String);
  if (patch.substitution) b.mandate.substitution = { ...b.mandate.substitution, ...patch.substitution };
  if ('maxDateShiftDays' in patch) b.mandate.maxDateShiftDays = Math.max(0, Number(patch.maxDateShiftDays) || 0);
  return buyers.save(b);
}
