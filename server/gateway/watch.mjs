// TAUSTAVAHTI. Seuraa jokaista ostajaa portin omasta lokista ja tilaushistoriasta ja puuttuu vain, kun jokin poikkeaa.
// Näkymätön, ei salainen: mitä seurataan ja mitä siitä seuraa, on kerrottu sopimuksessa (WATCH_DISCLOSURE → /.well-known ja /openapi.json).
// Ei kielimallia: jokainen havainto on laskettavissa uudelleen ostajan omista tilauksista, ja se kirjataan lokiin syykoodilla.
// Vahti voi vain tiukentaa: se siirtää tilauksen ihmisen hyväksyntään, mutta ei koskaan vahvista tai hylkää mitään itse.
import { orders, ledger } from './store.mjs';
import { clock } from './clock.mjs';
import { reason } from './contract.mjs';
import { loadCatalog } from '../catalog.mjs';

// OLETUS: kynnykset on valittu demolle. Tuotannossa historiaa vaadittaisiin enemmän kuin kaksi tilausta.
export const WATCH = { minHistory: 2, quantityFactor: 3, splitWindowMin: 30 };

export const WATCH_DISCLOSURE = {
  active: true,
  what: 'The gateway reviews each buyer\'s own quotes and orders against that buyer\'s own history. No data from other buyers is used, and no language model is involved.',
  checks: [
    { code: 'UNUSUAL_QUANTITY', effect: 'pending_approval', rule: `Order quantity is more than ${WATCH.quantityFactor}x the buyer's typical (median) quantity for the same product, or the same product group, over at least ${WATCH.minHistory} confirmed orders.` },
    { code: 'ORDER_SPLIT_UNDER_CAP', effect: 'pending_approval', rule: `Orders for the same product within ${WATCH.splitWindowMin} minutes that are each under the per-order spend cap but exceed it together.` },
  ],
  limits: 'The watch can only escalate an order to the buyer\'s own human approver. It never confirms or rejects an order, and it cannot override a mandate block.',
  audit: 'Every evaluation is written to the order\'s audit trail as WATCH_EVALUATED (actor "watch"), including evaluations with no findings.',
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num = (n) => String(+(+n).toFixed(1)).replace('.', ',');
const eur = (n) => `${(+n).toFixed(2).replace('.', ',')} €`;
const withMessage = (r, fi, en) => ({ ...r, message: fi, messageEn: en });

/**
 * Vertaa tilausta ostajan omaan historiaan.
 * @param {object} buyer
 * @param {{lines: Array<{productId: string, quantity: number, lineNet: number, name?: string, salesUnitLabel?: string}>, totals: {net: number}}} draft
 * @returns {{findings: Array, historyOrders: number}} findings on syylista samassa muodossa kuin mandaatin syyt (severity: 'approval')
 */
export function watchOrder(buyer, draft, { excludeOrderId, focusProductIds } = {}) {
  // focus: lisäyksessä arvioidaan koko tilaus uusilla määrillä, mutta havainto tehdään vain lisätyistä tuotteista,
  // ettei jo kerran päätettyä asiaa kysytä ihmiseltä uudestaan.
  const focus = focusProductIds ? new Set(focusProductIds) : null;
  const cat = loadCatalog();
  const past = orders.list(buyer.id, 500).filter((o) => o.orderId !== excludeOrderId && o.lines?.length);
  const settled = past.filter((o) => o.status === 'confirmed');
  const findings = [];
  const categoryOf = (productId) => cat.get(productId)?.category || null;

  // 1) Poikkeava määrä. Ensin sama tuote (myyntiyksiköinä); jos siitä ei ole historiaa, sama tuoteryhmä (euroina).
  const seenCategory = new Set();
  for (const line of draft.lines) {
    if (focus && !focus.has(line.productId)) continue;
    const perOrder = settled.map((o) => o.lines.filter((l) => l.productId === line.productId).reduce((s, l) => s + l.quantity, 0)).filter((q) => q > 0);
    if (perOrder.length >= WATCH.minHistory) {
      const typical = median(perOrder);
      const now = draft.lines.filter((l) => l.productId === line.productId).reduce((s, l) => s + l.quantity, 0);
      if (now > typical * WATCH.quantityFactor && !findings.some((f) => f.detail.productId === line.productId)) {
        const factor = +(now / typical).toFixed(1);
        const unit = line.salesUnitLabel || 'kpl';
        findings.push(withMessage(
          reason('UNUSUAL_QUANTITY', 'approval', { basis: 'product', productId: line.productId, name: line.name || line.productId, quantity: now, typical, factor, unit, basedOnOrders: perOrder.length }),
          `Poikkeava määrä: ${line.name || line.productId} × ${num(now)} ${unit}, tavallisesti ${num(typical)} ${unit} (${num(factor)}-kertainen, vertailu ${perOrder.length} aiempaan tilaukseen).`,
          `Unusual quantity: ${line.name || line.productId} × ${now} ${unit}, typically ${typical} ${unit} (${factor}x, based on ${perOrder.length} earlier orders).`,
        ));
      }
      continue;
    }
    const category = categoryOf(line.productId);
    if (!category || seenCategory.has(category)) continue;
    seenCategory.add(category);
    const perOrderNet = settled.map((o) => o.lines.filter((l) => categoryOf(l.productId) === category).reduce((s, l) => s + l.lineNet, 0)).filter((v) => v > 0);
    if (perOrderNet.length < WATCH.minHistory) continue;
    const typical = +median(perOrderNet).toFixed(2);
    const now = +draft.lines.filter((l) => categoryOf(l.productId) === category).reduce((s, l) => s + l.lineNet, 0).toFixed(2);
    if (now > typical * WATCH.quantityFactor) {
      const factor = +(now / typical).toFixed(1);
      findings.push(withMessage(
        reason('UNUSUAL_QUANTITY', 'approval', { basis: 'category', category, orderNet: now, typicalNet: typical, factor, currency: 'EUR', basedOnOrders: perOrderNet.length }),
        `Poikkeava määrä: tuoteryhmän ${category} ostot ${eur(now)}, tavallisesti ${eur(typical)} / tilaus (${num(factor)}-kertainen, vertailu ${perOrderNet.length} aiempaan tilaukseen).`,
        `Unusual quantity: ${now} EUR in product group ${category}, typically ${typical} EUR per order (${factor}x, based on ${perOrderNet.length} earlier orders).`,
      ));
    }
  }

  // 2) Katon kiertäminen pilkkomalla: jokainen tilaus alittaa tilauskohtaisen katon, mutta yhdessä ne ylittävät sen.
  // Tilaus, joka jo itse ylitti katon tai jonka ihminen on hyväksynyt, ei ole kiertämistä eikä sitä lasketa mukaan.
  const cap = buyer.mandate.maxOrderNet;
  if (cap != null && draft.totals.net <= cap + 0.004) {
    const since = clock.now().getTime() - WATCH.splitWindowMin * 60_000;
    const ids = focus || new Set(draft.lines.map((l) => l.productId));
    const recent = past.filter((o) => ['confirmed', 'pending_approval'].includes(o.status)
      && new Date(o.createdAt).getTime() >= since
      && !o.reasons?.some((r) => ['SPEND_CAP_ORDER', 'HUMAN_APPROVED'].includes(r.code))
      && o.lines.some((l) => ids.has(l.productId)));
    const combined = +(recent.reduce((s, o) => s + o.totals.net, 0) + draft.totals.net).toFixed(2);
    if (recent.length && combined > cap + 0.004) {
      findings.push(withMessage(
        reason('ORDER_SPLIT_UNDER_CAP', 'approval', { windowMinutes: WATCH.splitWindowMin, orders: recent.map((o) => o.orderId), combinedNet: combined, cap, currency: 'EUR' }),
        `Sama tuote ${recent.length + 1} tilauksessa ${WATCH.splitWindowMin} minuutin sisällä: yhteensä ${eur(combined)}, tilauskohtainen katto ${eur(cap)}.`,
        `Same product in ${recent.length + 1} orders within ${WATCH.splitWindowMin} minutes: ${combined} EUR combined, per-order cap ${cap} EUR.`,
      ));
    }
  }
  return { findings, historyOrders: settled.length };
}

// Haut eivät mene hash-ketjutettuun lokiin (ne eivät ole päätöksiä), joten niistä pidetään vain laskuria muistissa.
const searches = new Map();
export const noteSearch = (buyerId) => { const s = searches.get(buyerId) || { count: 0, last: null }; s.count += 1; s.last = clock.now().toISOString(); searches.set(buyerId, s); };

/** Aimon näkymä: mitä kukin ostaja-agentti on tehnyt ja mihin vahti on puuttunut. Lasketaan lokista pyydettäessä. */
export function watchReport(buyerList) {
  const rows = ledger.recent(5000);
  return {
    disclosure: WATCH_DISCLOSURE, thresholds: WATCH, clock: clock.info(),
    buyers: buyerList.map((b) => {
      const mine = rows.filter((e) => e.buyerId === b.id);
      const count = (type) => mine.filter((e) => e.type === type).length;
      const flagged = mine.filter((e) => e.type === 'WATCH_EVALUATED' && e.payload.findings?.length);
      return {
        buyerId: b.id, buyerName: b.name, lastSeen: [mine[0]?.ts, searches.get(b.id)?.last].filter(Boolean).sort().at(-1) || null,
        activity: { searches: searches.get(b.id)?.count || 0, quotes: count('QUOTE_REQUESTED'), orders: count('ORDER_RECEIVED'), confirmed: count('ORDER_CONFIRMED'), pendingApproval: count('ORDER_PENDING_APPROVAL'), rejected: count('ORDER_REJECTED'), failedOfferChecks: count('OFFER_VERIFICATION_FAILED') },
        evaluations: count('WATCH_EVALUATED'),
        findings: flagged.flatMap((e) => e.payload.findings.map((f) => ({ at: e.ts, orderId: e.orderId, code: f.code, message: f.message, detail: f.detail }))),
      };
    }),
  };
}
