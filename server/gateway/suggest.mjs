// "UNOHTUIKO TÄMÄ?" Portti huomaa ostajan puolesta, mitä tilauksesta puuttuu: tuote, joka on ollut mukana vähintään joka toisessa
// aiemmassa tilauksessa, mutta jonka tuoteryhmästä ei ole nyt mitään. Sama ajatus kuin kaverissa, joka kysyy "otat yleensä dippiäkin, tuonko?".
// Ei kielimallia: jokainen ehdotus on laskettavissa uudelleen ostajan omista vahvistetuista tilauksista.
// Ehdotus ei ole avoin kysymys vaan valmis tuote, määrä ja yksi nappi. Portti ei koskaan lisää mitään itse: lisäys kulkee
// samaa ketjua kuin add_to_order (allekirjoitettu tarjous, tuore tarkistus, mandaatti, loki).
import { orders } from './store.mjs';
import { cutoffPassed } from './clock.mjs';
import { productBlock } from './mandate.mjs';
import { loadCatalog } from '../catalog.mjs';

// OLETUS: kynnykset on valittu demolle. Tuotannossa historiaa vaadittaisiin enemmän ja vertailu tehtäisiin toimituspäivittäin
// (mock-rajapinnassa kaikki toimitukset osuvat samalle maanantaille, joten päivää ei voi käyttää erottelemaan tilauksia).
export const SUGGEST = { minOrders: 2, minShare: 0.5, lookback: 8, max: 3 };

export const SUGGEST_DISCLOSURE = {
  active: true,
  what: 'For the buyer\'s most recent open order, the gateway lists products that buyer usually orders but that are missing now. Only the buyer\'s own confirmed orders are used, and no language model is involved.',
  rule: `A product is suggested when it appears in at least ${SUGGEST.minOrders} and at least ${SUGGEST.minShare * 100} % of the buyer's last ${SUGGEST.lookback} confirmed orders, and the current order has nothing from the same product group. Quantity is the buyer's typical (median) quantity.`,
  limits: 'A suggestion never changes an order. Adding it goes through request_quote and add_to_order like any other addition, so the mandate, the cut-off and the audit trail apply.',
  where: 'Field "suggestions" on place_order, add_to_order and get_order responses, and as one-tap buttons in the human approval view.',
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num = (n) => String(+(+n).toFixed(2)).replace('.', ',');

/**
 * Mitä ostajan tavallisesta tilauksesta puuttuu tästä tilauksesta.
 * @returns {Array<{productId: string, name: string, typicalQuantity: number, salesUnitLabel: string, inOrders: number, ofOrders: number, estimateNet: number}>}
 */
export function suggestFor(buyer, order) {
  if (!buyer || !order?.lines?.length || !['confirmed', 'pending_approval'].includes(order.status)) return [];
  if (order.pendingAddition || (order.cutoff && cutoffPassed(order.cutoff))) return []; // ei kysytä kahta asiaa kerralla eikä tilausajan jälkeen
  const all = orders.list(buyer.id, 500);
  // Vain ostajan uusin avoin tilaus: sama ehdotus ei toistu jokaisella vanhalla tilauksella.
  if (all.find((o) => o.status !== 'rejected')?.orderId !== order.orderId) return [];
  const past = all.filter((o) => o.orderId !== order.orderId && o.status === 'confirmed' && o.lines?.length).slice(0, SUGGEST.lookback);
  if (past.length < SUGGEST.minOrders) return [];

  const cat = loadCatalog();
  const categoryOf = (productId) => cat.get(productId)?.category || `product:${productId}`;
  const have = new Set(order.lines.map((l) => categoryOf(l.productId)));
  const seen = new Map(); // productId → {quantities per order, viimeisin rivi}
  for (const o of past) { // uusin ensin
    const perProduct = new Map();
    for (const l of o.lines) perProduct.set(l.productId, { qty: (perProduct.get(l.productId)?.qty || 0) + l.quantity, line: l });
    for (const [productId, v] of perProduct) {
      const s = seen.get(productId) || { quantities: [], line: v.line };
      s.quantities.push(v.qty);
      seen.set(productId, s);
    }
  }
  const out = [];
  for (const [productId, s] of seen) {
    const inOrders = s.quantities.length;
    if (inOrders < SUGGEST.minOrders || inOrders / past.length < SUGGEST.minShare) continue;
    if (have.has(categoryOf(productId))) continue; // sama tuoteryhmä on jo tilauksessa (esim. toinen kerma): ei ehdoteta päälle
    const p = cat.get(productId);
    if (!p || productBlock(buyer.mandate, p)) continue; // mandaatin kieltämää ei ehdoteta
    const typicalQuantity = median(s.quantities);
    const unit = s.line.salesUnitLabel || 'kpl';
    out.push({
      productId, gtin: p.gtin || null, name: s.line.name || p.name, typicalQuantity, salesUnit: s.line.salesUnit || p.salesUnit, salesUnitLabel: unit,
      inOrders, ofOrders: past.length, basis: 'buyer-history',
      lastUnitPriceNet: s.line.unitPriceNet ?? null,
      estimateNet: s.line.unitPriceNet != null ? +(s.line.unitPriceNet * typicalQuantity).toFixed(2) : null, // viime kerran hinnalla; sitova hinta tulee tarjouksesta
      message: `${s.line.name || p.name} on ollut mukana ${inOrders}/${past.length} viime tilauksessa (yleensä ${num(typicalQuantity)} ${unit}), mutta puuttuu tästä.`,
      messageEn: `${p.nameEn || p.name} was in ${inOrders} of the last ${past.length} orders (typically ${typicalQuantity} ${unit}) but is missing from this one.`,
      // Agentille valmis jatko: sama ketju kuin missä tahansa lisäyksessä.
      next: { operation: 'request_quote', then: 'add_to_order', deliveryDate: order.deliveryDate, need: { candidates: [productId], quantity: { value: typicalQuantity, unit: 'PCS' } } },
    });
  }
  return out.sort((a, b) => b.inOrders - a.inOrders || (b.estimateNet || 0) - (a.estimateNet || 0)).slice(0, SUGGEST.max);
}
