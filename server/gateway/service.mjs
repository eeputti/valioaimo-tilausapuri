import { unitSizeFor } from './quantity.mjs';
// PORTIN YDIN. Neljä operaatiota samalla logiikalla riippumatta siitä, tuleeko pyyntö REST:nä vai MCP:nä:
//   search_products → request_quote (allekirjoitettu tarjous) → place_order (confirmed | pending_approval | rejected) → audit trail.
// Periaatteet: hinta ja saatavuus vain rajatulle joukolle, tuntematon ei ole koskaan "saatavilla", tilausaikaraja valvotaan
// portin omalla kellolla (mock-rajapinta ei estä myöhästynyttä tilausta), ja jokaisesta päätöksestä jää rivi hash-ketjutettuun lokiin.
import crypto from 'node:crypto';
import { loadCatalog, unitLabel, stepOf, roundToStep, tokenize, stems } from '../catalog.mjs';
import { fetchQuotes, describePriceSource, combinePriceSources } from '../valioApi.mjs';
import { apiMode } from '../config.mjs';
import { findSubstitutes } from '../substitutes.mjs';
import { clock, parseApiTime, cutoffPassed, helsinkiLabel } from './clock.mjs';
import { verifiedFree } from '../allergens.mjs';
import { signOffer, verifyOffer } from './signing.mjs';
import { quotes, orders, ledger, buyers, transaction } from './store.mjs';
import { evaluateMandate, productBlock, substitutionRules, publicMandate, orderAllergenBans } from './mandate.mjs';
import { reason, REASONS, PRODUCT_TYPES, CLAIM_PHRASES } from './contract.mjs';
import { watchOrder, noteSearch } from './watch.mjs';
import { pickSubstitute, explainApproval } from './advisor.mjs';
import { suggestFor } from './suggest.mjs';

const OFFER_TTL_MS = 15 * 60_000;
// Kiertävän demokellon kierros (sessio A, #16): 0 ilman kiertoa tai ennen kuin clock.cycle() on käytössä.
const clockCycle = () => clock.cycle?.() ?? 0;
const money = (n) => +(+n).toFixed(2);
const id = (prefix) => `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
export class GatewayError extends Error { constructor(status, code, message, detail) { super(message); this.status = status; this.code = code; this.detail = detail; } }

// ---------- search_products ----------
function interpret(input) {
  let text = String(input.query || '').trim();
  const claims = new Set((input.claims || []).map(String));
  const assumptions = [];
  for (const [re, code] of CLAIM_PHRASES) if (re.test(text)) { claims.add(code); text = text.replace(new RegExp(re.source, 'gi'), ' '); }
  let type = PRODUCT_TYPES.find((t) => t.id === input.productType) || null;
  const tokens = tokenize(text);
  if (!type) {
    for (const tok of tokens) {
      const variants = stems(tok);
      type = PRODUCT_TYPES.find((t) => t.keywords.some((k) => variants.includes(k) || (k.length >= 5 && variants.some((v) => v.endsWith(k)))));
      if (type) break;
    }
    if (type) assumptions.push(`Hakusana tulkittu tuotetyypiksi "${type.id}" (${type.fi}); ei sisällä: ${type.excludes || '–'}.`);
  }
  // Tyypin oma avainsana ei ole enää hakusana ("milk"), mutta tarkenteet ovat ("arla", "rasvaton", "fat free").
  const rest = type ? tokens.filter((tok) => !type.keywords.some((k) => stems(tok).includes(k))) : tokens;
  if (claims.has('FREE_FROM_LACTOSE')) assumptions.push('Laktoositon = luokittelu FREE_FROM_LACTOSE. Vähälaktoosinen (LOW_LACTOSE) ei kelpaa.');
  return { type, claims: [...claims], textQuery: rest.join(' '), assumptions };
}

export function productCard(p, extra = {}) {
  return {
    productId: p.id, gtin: p.gtin || null, name: { fi: p.name, en: p.nameEn || null }, brand: p.brand || null, vendor: p.vendor, category: p.category,
    salesUnit: { code: p.salesUnit, label: unitLabel(p.salesUnit), step: stepOf(p) },
    pack: { piecesPerSalesUnit: p.perSales, litresPerSalesUnit: p.litres ?? null, kgPerSalesUnit: p.kg ?? null, fromName: !!p.sizeApprox },
    temperature: p.temp, countryOfOrigin: p.country || null,
    allergens: { contains: p.contains, mayContain: p.mayContain || [], dataAvailable: !!p.hasAllergenData },
    claims: p.labels || [], deliveryReliability: p.reliability ?? null, co2PerKg: p.co2 ?? null, listedSubstitutes: p.subs || [],
    ...extra,
  };
}

export function searchProducts(buyer, input = {}) {
  const t0 = performance.now();
  const cat = loadCatalog();
  const limit = Math.min(60, Math.max(1, Number(input.limit) || 30));
  const it = interpret(input);
  noteSearch(buyer.id);
  const exclude = new Set((input.excludeAllergens || []).map(String));
  const bound = (v, name, max) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new GatewayError(400, 'INVALID_FILTER', `${name}: luku väliltä 0–${max}`);
    return n;
  };
  const minReliability = bound(input.minDeliveryReliability, 'minDeliveryReliability', 1);
  const maxCo2 = bound(input.maxCo2PerKg, 'maxCo2PerKg', 1000);
  if (minReliability != null) it.assumptions.push(`Vain tuotteet, joiden toimitusvarmuus on vähintään ${Math.round(minReliability * 100)} %. Tuotteet ilman toimitusvarmuustietoa on jätetty pois.`);
  if (maxCo2 != null) it.assumptions.push(`Vain tuotteet, joiden hiilijalanjälki on enintään ${maxCo2} kg CO2e/kg. Tuotteet ilman hiilijalanjälkitietoa on jätetty pois.`);
  if (exclude.size) it.assumptions.push('Allergeenirajaus katsoo myös alakoodit (esim. manteli on pähkinä) ja "voi sisältää" -tiedon. Tuotteet ilman allergeenitietoa on jätetty pois.');
  const passes = (p) => {
    if (it.claims.some((c) => !p.labels?.includes(c))) return false;
    if (!verifiedFree([...exclude], p)) return false; // alakoodit, "voi sisältää" ja puuttuva tieto (katselmus 15.11. #2)
    if (input.countryOfOrigin && p.country !== String(input.countryOfOrigin).toLowerCase()) return false;
    if (input.brand && !(p.brand || '').toLowerCase().includes(String(input.brand).toLowerCase())) return false;
    if (minReliability != null && !(p.reliability >= minReliability)) return false; // puuttuva tieto ei läpäise suodatinta
    if (maxCo2 != null && !(p.co2 <= maxCo2)) return false;
    if (it.type && (!it.type.categories.includes(p.category) || (it.type.exclude && it.type.exclude.test(p.name)))) return false;
    return !productBlock(buyer.mandate, p); // mandaatin kieltämiä ei edes ehdoteta
  };
  let hits;
  if (it.textQuery) {
    hits = cat.search(it.textQuery, { limit: 400, filter: passes });
    // Kokonaisena sanana nimessä oleva osuma ennen osasanaosumaa ("tilli" ennen "pastilli"); muu järjestys säilyy.
    if (hits.some((h) => h.exact)) hits = [...hits.filter((h) => h.exact), ...hits.filter((h) => !h.exact)];
  }
  else if (it.type) hits = cat.products.filter(passes).map((p) => ({ product: p, score: 1 + (p.reliability != null ? 0.05 : 0) })).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'fi'));
  else if (it.claims.length || exclude.size) throw new GatewayError(400, 'QUERY_TOO_BROAD', 'Anna hakusana tai tuotetyyppi väittämien lisäksi');
  else throw new GatewayError(400, 'QUERY_REQUIRED', 'Anna query tai productType');
  if (it.type && it.textQuery && !hits.length) { // tarkenne ei osunut mihinkään → palautetaan koko tyyppi ja kerrotaan se
    hits = cat.products.filter(passes).map((p) => ({ product: p, score: 0.5 }));
    it.assumptions.push(`Tarkenne "${it.textQuery}" ei osunut yhteenkään tuotteeseen; palautetaan koko tuotetyyppi.`);
  }
  return {
    clock: clock.info(),
    interpretedAs: { productType: it.type?.id || null, claims: it.claims, textQuery: it.textQuery || null, assumptions: it.assumptions },
    total: hits.length,
    items: hits.slice(0, limit).map((h) => productCard(h.product, { matchScore: +h.score.toFixed(3), wholeWordMatch: !!h.exact })),
    next: 'Hinta ja saatavuus: request_quote näille tuotekoodeille (candidates). Koko valikoimaa ei saa hinnoitella kerralla.',
    ms: +(performance.now() - t0).toFixed(1),
  };
}

export const productTypes = () => PRODUCT_TYPES.map((t) => ({ id: t.id, fi: t.fi, en: t.en, keywords: t.keywords, categories: t.categories, excludes: t.excludes, assumption: 'Kuratoitu käsin tälle demolle: challenge-datassa kategorioilla ei ole nimiä.' }));

// ---------- request_quote ----------
function assess(p, quote, need, buyer, deliveryDate) {
  const out = (code, detail = {}) => ({ ok: false, productId: p?.id, name: p?.name, ...reason(code, 'excluded', detail) });
  if (!p) return { ok: false, productId: null, ...reason('UNKNOWN_PRODUCT', 'excluded') };
  const block = productBlock(buyer.mandate, p);
  if (block) return { ok: false, productId: p.id, name: p.name, ...block, severity: 'excluded' };
  const price = quote?.price; const avail = quote?.avail;
  if (!price || price.error) return out('PRICE_UNAVAILABLE');
  // Vanha tai viimeisin tunnettu hinta ei kelpaa hiljaa: liian vanha jää pois, ikärajan sisällä oleva merkitään riville ja tarjoukseen.
  const priceInfo = describePriceSource(price);
  if (priceInfo.tooOld) return out('PRICE_TOO_OLD', { priceSource: priceInfo.origin, priceFetchedAt: isoOrNull(priceInfo.fetchedAt) });
  if (!avail || avail.status === 'unknown') return out('AVAILABILITY_UNKNOWN', { note: avail?.note });
  if (avail.status === 'blocked') return out('SALES_BLOCK');
  if (avail.status === 'out') return out('NOT_DELIVERABLE');
  if (cutoffPassed(avail.closingTime)) return out('CUTOFF_PASSED', { closingTime: avail.closingTime, closingLabel: helsinkiLabel(avail.closingTime), logisticModel: avail.model });
  const size = unitSizeFor(p, price, need.quantity.unit, need.quantity.basis || 'sales');
  if (!size) return out('UNIT_NOT_CONVERTIBLE', { requestedUnit: need.quantity.unit, comparisonUnit: price.comparisonUnit });
  const qty = Math.max(stepOf(p), roundToStep(need.quantity.value / size.value, p, 'up'));
  return {
    ok: true, p, price, priceInfo, avail, size, qty,
    stock: avail.amount ?? null, // null = ei rajaa tai ei tiedossa (Terminal)
    perUnit: +(price.net / size.value).toFixed(4),
    deliveryDate: avail.date && avail.date > deliveryDate ? avail.date : deliveryDate,
  };
}

const isoOrNull = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
function lineOf(a, qty, extra = {}) {
  const { p, price, avail, size } = a;
  const info = a.priceInfo || describePriceSource(price);
  return {
    productId: p.id, gtin: p.gtin || null, name: p.name, brand: p.brand || null,
    quantity: qty, salesUnit: p.salesUnit, salesUnitLabel: unitLabel(p.salesUnit),
    unitSize: { value: size.value, source: size.source }, covers: +(qty * size.value).toFixed(2),
    unitPriceNet: price.net, pricePerRequestedUnit: a.perUnit, lineNet: money(price.net * qty), vatRate: price.vatRate ?? 13.5,
    // Valion hintarajapinnan oma vertailuhinta (comparisonPrice): korisivu näyttää tämän, ei katalogin koosta laskettua.
    comparisonPrice: price.comparison > 0 ? price.comparison : null, comparisonUnit: price.comparison > 0 ? price.comparisonUnit || null : null,
    closingTime: avail.closingTime || null, allergens: p.contains, deliveryReliability: p.reliability ?? null, co2PerKg: p.co2 ?? null,
    // priceSource: live | sim | stale | last-known. priceCurrent=false: hinta ei ole juuri nyt rajapinnasta (rajapintavirhe).
    priceSource: info.origin, priceCurrent: info.current, priceFetchedAt: isoOrNull(info.fetchedAt),
    availability: { logisticModel: avail.model, stock: avail.amount ?? null, stockKnown: avail.amount != null, deliveryDate: avail.date, source: avail.source || null },
    ...extra,
  };
}

function buildOption(buyer, need, kind, lines, ctx) {
  const net = money(lines.reduce((s, l) => s + l.lineNet, 0));
  const vat = money(lines.reduce((s, l) => s + l.lineNet * (l.vatRate / 100), 0));
  // Saatavuuspäivä on aikaisin mahdollinen: toimitusta ei aikaisteta asiakkaan pyytämästä.
  const deliveryDate = [ctx.deliveryDate, ...lines.map((l) => l.availability.deliveryDate).filter(Boolean)].sort().at(-1);
  const cutoffs = lines.map((l) => l.closingTime).filter(Boolean).sort((x, y) => parseApiTime(x) - parseApiTime(y));
  const flags = [];
  if (deliveryDate > ctx.deliveryDate) flags.push('DELIVERY_DATE_SHIFT');
  if (lines.length > 1) flags.push('PARTIAL_FILL_SPLIT');
  if (ctx.substitution) flags.push(ctx.substitution.withinPolicy ? 'SUBSTITUTION_WITHIN_POLICY' : 'SUBSTITUTION_OUTSIDE_POLICY');
  // Rajapinta palauttaa 999999 myös osalle Stock-tuotteista, ei vain Terminal-tuotteille: lippu seuraa saldotietoa, ei logistiikkamallia.
  if (lines.some((l) => !l.availability.stockKnown)) flags.push('STOCK_UNKNOWN');
  const stalePrices = lines.filter((l) => l.priceCurrent === false);
  if (stalePrices.length) flags.push('PRICE_NOT_LIVE');
  const covered = +lines.reduce((s, l) => s + l.covers, 0).toFixed(2);
  const draft = { lines, totals: { net }, deliveryDate, requestedDeliveryDate: ctx.deliveryDate, substitutions: ctx.substitution ? [ctx.substitution] : [] };
  const preview = evaluateMandate(buyer, draft);
  const now = clock.now();
  const exp = Math.min(now.getTime() + OFFER_TTL_MS, cutoffs[0] ? parseApiTime(cutoffs[0]).getTime() : Infinity);
  const offerId = id('OFR');
  const payload = {
    iss: 'aimo-agent-gateway', aud: buyer.id, jti: offerId, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(exp / 1000), cyc: clockCycle(),
    quoteId: ctx.quoteId, needRef: need.ref || null, kind, currency: 'EUR', priceBasis: 'net, VAT excluded, fixed for the offer validity',
    requested: { quantity: need.quantity, deliveryDate: ctx.deliveryDate }, deliveryDate, cutoff: cutoffs[0] || null,
    lines: lines.map((l) => ({ productId: l.productId, gtin: l.gtin, quantity: l.quantity, salesUnit: l.salesUnit, unitPriceNet: l.unitPriceNet, vatRate: l.vatRate, lineNet: l.lineNet, substituteFor: l.substituteFor || null })),
    totals: { net, vat, gross: money(net + vat) }, flags, substitution: ctx.substitution || null,
    priceSource: combinePriceSources(lines.map((l) => l.priceSource)),
    priceFetchedAt: stalePrices.map((l) => l.priceFetchedAt).filter(Boolean).sort()[0] || null, // vanhin ei-ajantasainen hinta
  };
  return {
    optionId: offerId, kind, lines, totals: payload.totals, covers: { value: covered, unit: need.quantity.unit },
    pricePerRequestedUnit: covered ? +(net / covered).toFixed(4) : null, deliveryDate, cutoff: payload.cutoff, cutoffLabel: helsinkiLabel(payload.cutoff),
    flags, substitution: ctx.substitution || null, priceSource: payload.priceSource, priceFetchedAt: payload.priceFetchedAt,
    mandatePreview: { status: preview.status, reasons: preview.reasons }, // mitä tapahtuu, jos tämä tilataan
    expiresAt: new Date(exp).toISOString(), offer: signOffer(payload),
  };
}

const RANK = {
  price: (a, b) => a.perUnit - b.perUnit,
  reliability: (a, b) => (b.p.reliability ?? -1) - (a.p.reliability ?? -1) || a.perUnit - b.perUnit,
  co2: (a, b) => (a.p.co2 ?? Infinity) - (b.p.co2 ?? Infinity) || a.perUnit - b.perUnit,
};

async function quoteNeed(buyer, need, ctx, liveQuotes) {
  const cat = loadCatalog();
  const maxOptions = ctx.maxOptions;
  const assessed = need.candidates.map((pid) => assess(cat.get(pid), liveQuotes.get(String(pid)), need, buyer, ctx.deliveryDate));
  const ok = assessed.filter((a) => a.ok).sort(RANK[need.rank] || RANK.price);
  const full = ok.filter((a) => a.stock == null || a.stock >= a.qty);
  const options = full.slice(0, maxOptions).map((a) => buildOption(buyer, need, 'exact', [lineOf(a, a.qty)], ctx));
  const excluded = assessed.filter((a) => !a.ok).map((a) => ({ productId: a.productId, name: a.name, code: a.code, message: a.message, detail: a.detail }));
  const short = ok.filter((a) => a.stock != null && a.stock < a.qty);
  const allowSubs = need.allowSubstitutes !== false && buyer.mandate.substitution.allow;
  const rules = substitutionRules(buyer.mandate);

  if (!options.length && ok.length > 1) {
    // Mikään ehdokkaista ei yksin riitä: täytetään järjestyksessä usealla ostajan itse antamalla ehdokkaalla (ei korvaamista).
    let left = need.quantity.value; const lines = [];
    for (const a of ok) {
      if (left <= 0.001) break;
      const can = a.stock == null ? Infinity : roundToStep(a.stock, a.p, 'down');
      const take = Math.min(can, Math.max(stepOf(a.p), roundToStep(left / a.size.value, a.p, 'up')));
      if (take <= 0) continue;
      lines.push(lineOf(a, take)); left -= take * a.size.value;
    }
    if (left <= 0.001) options.push(buildOption(buyer, need, 'split', lines, ctx));
  }
  if (!options.length && allowSubs) {
    // Pyydettyä tuotetta ei saada (kokonaan): pidetään saatavilla oleva osa ja täydennetään korvaajalla, tai korvataan kokonaan.
    // Korvaajaehdokkaat tulevat tuotedatasta (sama allergeeniprofiili, sama tuoteryhmä), ja niiltä tarkistetaan hinta, saldo ja tilausaika.
    const a = ok[0] || null;
    const first = excluded.find((e) => ['NOT_DELIVERABLE', 'CUTOFF_PASSED', 'SALES_BLOCK'].includes(e.code));
    const original = a ? a.p : first ? cat.get(first.productId) : null;
    if (original) {
      const size = a ? a.size : unitSizeFor(original, liveQuotes.get(original.id)?.price, need.quantity.unit, need.quantity.basis || 'sales');
      const wantUnits = a ? a.qty : Math.max(stepOf(original), roundToStep(need.quantity.value / (size?.value || 1), original, 'up'));
      const subs = await findSubstitutes(original, wantUnits, ctx.deliveryDate, rules, { limit: maxOptions + 2 });
      const keep = a ? roundToStep(a.stock, original, 'down') : 0;
      const subQuotes = await fetchQuotes(subs.options.map((o) => o.productId), ctx.deliveryDate);
      const type = PRODUCT_TYPES.find((t) => t.categories.includes(original.category) && !(t.exclude && t.exclude.test(original.name)));
      for (const o of subs.options) {
        const sp = cat.get(o.productId);
        if (type && (!type.categories.includes(sp.category) || (type.exclude && type.exclude.test(sp.name)))) continue; // maitojuomaa ei korvata piimällä
        // Ostajan pyytämä väittämä säilyy aina: luomua ei korvata ei-luomulla eikä laktoositonta tavallisella.
        if (['FREE_FROM_LACTOSE', 'FREE_FROM_GLUTEN', 'VEGAN', 'EU_ORGANIC_FARMING'].some((c) => original.labels?.includes(c) && !sp.labels?.includes(c))) continue;
        const subNeed = { ...need, quantity: { ...need.quantity, value: Math.max(0.01, need.quantity.value - (a ? keep * a.size.value : 0)) } };
        const sa = assess(sp, subQuotes.get(o.productId), subNeed, buyer, ctx.deliveryDate);
        if (!sa.ok || (sa.stock != null && sa.stock < sa.qty)) continue;
        const deltaPct = a ? +(((sa.perUnit - a.perUnit) / a.perUnit) * 100).toFixed(1) : o.price.deltaPct;
        const substitution = {
          forProductId: original.id, forName: original.name, byProductId: sp.id, byName: sp.name,
          cause: a ? 'INSUFFICIENT_STOCK' : first.code, keptOriginalUnits: keep, unitPriceDeltaPct: deltaPct,
          sameAllergenProfile: sp.contains.every((x) => original.contains.includes(x)), allergensVerified: !!(original.hasAllergenData && sp.hasAllergenData),
          deliveryReliability: sp.reliability ?? null, checks: o.why, warnings: o.warnings,
          withinPolicy: o.withinPolicy && (deltaPct == null || deltaPct <= buyer.mandate.substitution.maxUnitPriceIncreasePct) && (sp.reliability == null || sp.reliability >= buyer.mandate.substitution.minReliability),
        };
        const lines = [];
        if (a && keep > 0) lines.push(lineOf(a, keep));
        lines.push(lineOf(sa, sa.qty, { substituteFor: original.id }));
        options.push(buildOption(buyer, need, a && keep > 0 ? 'split' : 'substitute', lines, { ...ctx, substitution }));
      }
      // Sääntöjen sisällä pysyvät ensin, sitten halvin.
      options.sort((x, y) => Number(y.substitution.withinPolicy) - Number(x.substitution.withinPolicy) || x.totals.net - y.totals.net);
      // Kielimalli valitsee sääntöjen sisällä olevista sen, joka sopii käyttöön parhaiten (ei pelkkä hinta). Kirjataan lokiin.
      const ranked = await pickSubstitute(options, { original, need, buyer, quoteId: ctx.quoteId });
      options.splice(0, options.length, ...ranked);
    }
  }
  for (const a of short) if (!excluded.some((e) => e.productId === a.p.id)) excluded.push({ productId: a.p.id, name: a.p.name, ...reasonLite('INSUFFICIENT_STOCK', { available: a.stock, needed: a.qty, unit: unitLabel(a.p.salesUnit) }) });
  const excludedSummary = {};
  for (const e of excluded) excludedSummary[e.code] = (excludedSummary[e.code] || 0) + 1;
  return { ref: need.ref || null, requested: { quantity: need.quantity, candidates: need.candidates.length, rank: need.rank || 'price' }, options: options.slice(0, maxOptions), fulfillable: options.length > 0, excluded, excludedSummary };
}
const reasonLite = (code, detail) => ({ code, message: REASONS[code].fi, detail });

export async function requestQuote(buyer, input = {}) {
  const t0 = performance.now();
  if (!Array.isArray(input.needs) || !input.needs.length) throw new GatewayError(400, 'NEEDS_REQUIRED', 'needs puuttuu');
  if (input.needs.length > 20) throw new GatewayError(400, 'TOO_MANY_NEEDS', 'Enintään 20 tarvetta / tarjouspyyntö');
  const deliveryDate = input.deliveryDate || clock.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) throw new GatewayError(400, 'INVALID_DATE', 'deliveryDate muodossa YYYY-MM-DD');
  for (const n of input.needs) {
    if (!Array.isArray(n.candidates) || !n.candidates.length || n.candidates.length > 40) throw new GatewayError(400, 'INVALID_CANDIDATES', 'candidates: 1–40 tuotekoodia / tarve. Rajaa ensin search_products-haulla.');
    if (!(n.quantity?.value > 0) || !['L', 'KG', 'PCS'].includes(n.quantity?.unit)) throw new GatewayError(400, 'INVALID_QUANTITY', 'quantity: {value > 0, unit: L | KG | PCS}');
  }
  const ctx = { quoteId: id('Q'), deliveryDate, maxOptions: Math.min(5, Math.max(1, Number(input.maxOptions) || 3)) };
  const ids = [...new Set(input.needs.flatMap((n) => n.candidates.map(String)))];
  const live = await fetchQuotes(ids, deliveryDate); // vain nämä tuotteet, 2 rinnakkaista kutsua
  const fetchedSource = combinePriceSources([...live.values()].filter((v) => v.price && !v.price.error).map((v) => describePriceSource(v.price).origin)) || apiMode();
  ledger.append(`agent:${buyer.id}`, 'QUOTE_REQUESTED', { deliveryDate, needs: input.needs.map((n) => ({ ref: n.ref || null, quantity: n.quantity, candidates: n.candidates.length })), productsPriced: ids.length, priceSource: fetchedSource }, { buyerId: buyer.id, quoteId: ctx.quoteId });
  const needs = [];
  for (const n of input.needs) needs.push(await quoteNeed(buyer, n, ctx, live));
  for (const n of needs) for (const o of n.options) ledger.append('gateway', 'OFFER_ISSUED', { offerId: o.optionId, kind: o.kind, net: o.totals.net, lines: o.lines.map((l) => `${l.productId} × ${l.quantity} ${l.salesUnitLabel}`), flags: o.flags, expiresAt: o.expiresAt }, { buyerId: buyer.id, quoteId: ctx.quoteId });
  for (const n of needs) if (Object.keys(n.excludedSummary).length) ledger.append('gateway', 'CANDIDATES_EXCLUDED', { ref: n.ref, summary: n.excludedSummary }, { buyerId: buyer.id, quoteId: ctx.quoteId });
  const quote = { quoteId: ctx.quoteId, buyerId: buyer.id, createdAt: clock.now().toISOString(), deliveryDate, needs };
  quotes.save(quote);
  // Yleisotsikko kertoo tarjottujen rivien todellisen hintalähteen, ei pelkkää asetusta ("live" vaikka rivi olisi viimeisin tunnettu).
  const offered = combinePriceSources(needs.flatMap((n) => n.options.flatMap((o) => o.lines.map((l) => l.priceSource))));
  const priceOrigin = offered || fetchedSource;
  return { ...quote, clock: clock.info(), priceSource: PRICE_SOURCE_TEXT[priceOrigin] || PRICE_SOURCE_TEXT[apiMode()], priceOrigin, productsPriced: ids.length, ms: +(performance.now() - t0).toFixed(1) };
}
const PRICE_SOURCE_TEXT = {
  live: 'Valio Aimo Junction API (live)',
  sim: 'SIMULOITU (VALIO_API_KEY puuttuu)',
  stale: 'Vanha välimuistihinta: hintarajapinta ei vastannut',
  'last-known': 'Viimeisin tunnettu hinta: hintarajapinta ei vastannut',
};

// ---------- place_order ----------
// suggestions: mitä ostajan tavallisesta tilauksesta puuttuu (suggest.mjs). Lasketaan luettaessa, ei tallenneta tilaukselle.
function publicOrder(o) { return { ...o, suggestions: suggestFor(buyers.byId(o.buyerId), o), statusLabel: { confirmed: 'Vahvistettu', pending_approval: 'Odottaa ihmisen hyväksyntää', rejected: 'Hylätty' }[o.status], clock: clock.info() }; }

/** Hyväksyntää odottava tilaus vanhenee, kun tilausaikaraja menee. */
function refresh(o) {
  if (o?.status === 'pending_approval' && o.cutoff && cutoffPassed(o.cutoff)) {
    o.status = 'rejected';
    o.reasons.push(reason('APPROVAL_EXPIRED', 'block', { cutoff: o.cutoff }));
    o.history.push({ at: clock.now().toISOString(), status: 'rejected', by: 'gateway' });
    orders.save(o);
    ledger.append('gateway', 'ORDER_REJECTED', { reasons: ['APPROVAL_EXPIRED'] }, { buyerId: o.buyerId, orderId: o.orderId });
  }
  if (o?.pendingAddition && cutoffPassed(o.pendingAddition.approval?.expiresAt)) { // kuittaamaton lisäys raukeaa, tilaus pysyy ennallaan
    const add = o.pendingAddition; delete o.pendingAddition;
    add.status = 'rejected'; add.reasons = [...add.reasons, reason('APPROVAL_EXPIRED', 'block', { cutoff: add.approval.expiresAt })];
    (o.additions ||= []).push(add);
    orders.save(o);
    ledger.append('gateway', 'ADDITION_REJECTED', { additionId: add.additionId, reasons: ['APPROVAL_EXPIRED'] }, { buyerId: o.buyerId, orderId: o.orderId });
  }
  return o;
}

const offerRef = (p) => ({ offerId: p.jti, quoteId: p.quoteId, kind: p.kind });
const earliest = (times) => times.filter(Boolean).sort((a, b) => parseApiTime(a) - parseApiTime(b))[0] || null;
function totalsOf(lines) {
  const net = money(lines.reduce((s, l) => s + l.lineNet, 0));
  const vat = money(lines.reduce((s, l) => s + l.lineNet * (l.vatRate / 100), 0));
  return { net, vat, gross: money(net + vat), currency: 'EUR' };
}

/** Tarjousten todennus: allekirjoitus, vastaanottaja, voimassaolo, kertakäyttöisyys. Sama tarkistus tilaukselle ja lisäykselle. */
/** Ostajan voimassa olevissa tilauksissa (ja odottavissa lisäyksissä) jo käytetyt tarjoukset. */
const usedOfferIds = (buyerId) => new Set(orders.list(buyerId, 500).filter((o) => o.status !== 'rejected').flatMap((o) => [...(o.offers || []), ...(o.pendingAddition?.offers || [])].map((x) => x.offerId)));

function verifyOffers(buyer, offers, now) {
  const payloads = []; const reasons = [];
  const used = usedOfferIds(buyer.id);
  for (const jws of offers) {
    const v = verifyOffer(jws);
    if (!v.ok) { reasons.push(reason(v.code, 'block', { detail: v.detail })); continue; }
    const p = v.payload;
    if (p.aud !== buyer.id) { reasons.push(reason('OFFER_WRONG_BUYER', 'block', { offerId: p.jti })); continue; }
    if (p.exp * 1000 <= now.getTime()) { reasons.push(reason('OFFER_EXPIRED', 'block', { offerId: p.jti, expiredAt: new Date(p.exp * 1000).toISOString() })); continue; }
    // Kiertävä kello palaa alkuun: edellisen kierroksen tarjous näyttäisi taas voimassa olevalta.
    if (clock.looping && (p.cyc ?? 0) !== clockCycle()) { reasons.push(reason('OFFER_EXPIRED', 'block', { offerId: p.jti, clockCycle: p.cyc ?? 0 })); continue; }
    if (used.has(p.jti) || payloads.some((x) => x.jti === p.jti)) { reasons.push(reason('OFFER_ALREADY_USED', 'block', { offerId: p.jti })); continue; }
    payloads.push(p);
  }
  return { payloads, reasons };
}

/** Tuore tarkistus juuri ennen sitoutumista: hinta, saldo ja tilausaikaraja. Lisää löydökset reasons-listaan. */
async function liveRecheck(payloads, reasons) {
  const cat = loadCatalog();
  const requestedDeliveryDate = payloads.map((p) => p.requested.deliveryDate).sort()[0];
  const flat = payloads.flatMap((p) => p.lines.map((l) => ({ ...l, offerId: p.jti })));
  const live = await fetchQuotes(flat.map((l) => l.productId), requestedDeliveryDate, { fresh: true });
  const deliveryDates = new Map(payloads.map((p) => [p.jti, p.deliveryDate]));
  const lines = []; const origins = []; const oldest = [];
  for (const l of flat) {
    const p = cat.get(l.productId); const q = live.get(l.productId) || {};
    // "Tuore" tarkistus voi rajapintavirheessä saada vanhan välimuistiarvon tai viimeisimmän tunnetun hinnan. Sitä ei hyväksytä
    // hiljaa: liian vanha estää tilauksen, ikärajan sisällä oleva merkitään tilaukseen (priceSource, PRICE_NOT_LIVE).
    const info = q.price && !q.price.error ? describePriceSource(q.price) : null;
    if (info) { origins.push(info.origin); if (!info.current && info.fetchedAt != null) oldest.push(info.fetchedAt); }
    if (!q.price || q.price.error || Math.abs(q.price.net - l.unitPriceNet) > 0.004) reasons.push(reason('OFFER_STALE', 'block', { productId: l.productId, offered: l.unitPriceNet, current: q.price?.net ?? null }));
    else if (info.tooOld) reasons.push(reason('PRICE_TOO_OLD', 'block', { productId: l.productId, priceSource: info.origin, priceFetchedAt: isoOrNull(info.fetchedAt) }));
    else if (!q.avail || ['out', 'blocked', 'unknown'].includes(q.avail.status)) reasons.push(reason('OFFER_STALE', 'block', { productId: l.productId, availability: q.avail?.status || 'unknown' }));
    else if (q.avail.date && q.avail.date > deliveryDates.get(l.offerId)) reasons.push(reason('OFFER_STALE', 'block', { productId: l.productId, offeredDeliveryDate: deliveryDates.get(l.offerId), earliestAvailableDate: q.avail.date }));
    else if (cutoffPassed(q.avail.closingTime)) reasons.push(reason('CUTOFF_PASSED', 'block', { productId: l.productId, closingTime: q.avail.closingTime, closingLabel: helsinkiLabel(q.avail.closingTime) }));
    else if (q.avail.amount != null && q.avail.amount < l.quantity) reasons.push(reason('INSUFFICIENT_STOCK', 'block', { productId: l.productId, available: q.avail.amount, needed: l.quantity }));
    lines.push({ ...l, name: p?.name || l.productId, salesUnitLabel: unitLabel(l.salesUnit), allergens: p?.contains || [], closingTime: q.avail?.closingTime || null,
      priceSource: info?.origin || null, priceCurrent: info ? info.current : null, priceFetchedAt: isoOrNull(info?.fetchedAt) });
  }
  const source = combinePriceSources(origins);
  const price = { source, current: !!source && origins.every((o) => o === 'live' || o === 'sim'), oldestFetchedAt: isoOrNull(Math.min(...oldest)) };
  return { lines, deliveryDate: payloads.map((p) => p.deliveryDate).sort().at(-1), requestedDeliveryDate, cutoff: earliest(payloads.map((p) => p.cutoff)), price };
}

/** Tilaukseen jäävä merkintä, kun hinta ei ollut tuoreessa tarkistuksessa juuri rajapinnasta (ikärajan sisällä). */
const priceNotice = (price) => (price.source && !price.current
  ? [reason('PRICE_NOT_LIVE', 'info', { priceSource: price.source, priceFetchedAt: price.oldestFetchedAt })] : []);

/** Saman pyynnön sormenjälki: allekirjoitetut tarjoukset sellaisenaan. Sama avain + sama sisältö = sama tilaus. */
const requestFingerprint = (offers) => crypto.createHash('sha256').update(JSON.stringify([...offers].map(String).sort())).digest('hex');

/**
 * Idempotenssi sidottuna sisältöön (#7). Saman avaimen yritykset:
 * - sama sormenjälki (tai vanha tallenne ilman sormenjälkeä, joka ei ole hylätty) → sama tilaus, ei uutta,
 * - eri sisältö ja aiempi yritys vahvistettu tai odottaa hyväksyntää → 409, ettei kadonneen vastauksen uusinta uudella
 *   tarjouksella tilaa toista kertaa,
 * - kaikki aiemmat yritykset hylätty → uusi yritys sallitaan (hylkäys ei sitonut mitään).
 */
function idempotencyState(buyerId, key, fingerprint) {
  const attempts = orders.attempts(buyerId, key).map(refresh);
  const same = attempts.find((o) => o.requestFingerprint === fingerprint) || attempts.find((o) => !o.requestFingerprint && o.status !== 'rejected');
  if (same) return { duplicate: same };
  const committed = attempts.find((o) => o.status !== 'rejected');
  if (committed) return { conflict: committed };
  return { attempt: attempts.length + 1 };
}
const keyReused = (o) => new GatewayError(409, 'IDEMPOTENCY_KEY_REUSED', `idempotencyKey on jo käytetty toisenlaiseen tilaukseen ${o.orderId} (${o.status}). Uusi tilaus tarvitsee uuden avaimen.`, { orderId: o.orderId, status: o.status });

export async function placeOrder(buyer, input = {}, { baseUrl = '' } = {}) {
  const t0 = performance.now();
  const key = String(input.idempotencyKey || '');
  if (key.length < 8) throw new GatewayError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey (vähintään 8 merkkiä) on pakollinen: sama avain palauttaa saman tilauksen');
  if (!Array.isArray(input.offers) || !input.offers.length) throw new GatewayError(400, 'OFFERS_REQUIRED', 'offers puuttuu: anna request_quote-vastauksen offer-kentät');
  const fingerprint = requestFingerprint(input.offers);
  const allergenBans = orderAllergenBans(input.excludeAllergens); // tilauksen oma allergiakielto, vain tiukentaa (#4, V033)
  // Nopea polku tavalliselle uusinnalle. Lopullinen tarkistus tehdään vielä sitoutumisen transaktiossa (commit alla).
  const early = idempotencyState(buyer.id, key, fingerprint);
  if (early.duplicate) return { ...publicOrder(early.duplicate), duplicate: true };
  if (early.conflict) throw keyReused(early.conflict);

  const now = clock.now();
  // Numero varataan atomisesti. Kesken jäänyt tai uusinnaksi osoittautunut yritys jättää numeroon aukon, ei kahta samaa.
  const orderId = `AGW-${clock.today().replaceAll('-', '')}-${String(orders.reserveNumber()).padStart(4, '0')}`;
  const refs = { buyerId: buyer.id, orderId };
  const base = { orderId, buyerId: buyer.id, buyerName: buyer.name, idempotencyKey: key, requestFingerprint: fingerprint, clockCycle: clockCycle(), ...(allergenBans.length ? { excludeAllergens: allergenBans } : {}), buyerReference: input.buyerReference || null, requestedBy: input.requestedBy || null, createdAt: now.toISOString(), history: [], notifications: [], commit: { simulated: true, note: 'Junction-mock-rajapinnassa ei ole tilausendpointia: sitoumus kirjataan portin omaan kantaan.' } };

  // Sitoutuminen yhdessä kirjoitustransaktiossa tuoreen tarkistuksen (await) jälkeen: idempotenssi, tarjousten kertakäyttö,
  // mandaatin päiväkatto ja tallennus näkevät saman tilanteen, eikä samanaikainen tilaus voi ehtiä väliin (#6).
  const commit = (build) => {
    let out;
    transaction(() => {
      const state = idempotencyState(buyer.id, key, fingerprint);
      if (state.duplicate || state.conflict) {
        const other = state.duplicate || state.conflict;
        ledger.append('gateway', 'ORDER_DISCARDED', { reason: state.duplicate ? 'duplicate_request' : 'idempotency_key_reused', orderId: other.orderId }, refs);
        out = state; return;
      }
      const order = build();
      order.idempotencySlot = state.attempt === 1 ? key : `${key}#${state.attempt}`;
      order.history.push({ at: clock.now().toISOString(), status: order.status, by: 'gateway' });
      orders.insert(order);
      ledger.append('gateway', { confirmed: 'ORDER_CONFIRMED', pending_approval: 'ORDER_PENDING_APPROVAL', rejected: 'ORDER_REJECTED' }[order.status], { net: order.totals?.net ?? null, reasons: order.reasons.map((r) => r.code) }, refs);
      out = { order };
    });
    if (out.duplicate) return { ...publicOrder(out.duplicate), duplicate: true };
    if (out.conflict) throw keyReused(out.conflict);
    const { order } = out;
    if (order.status === 'pending_approval') {
      // Selitys ihmiselle selkokielellä. Jos malli ei vastaa ajoissa, näkymä näyttää syykoodit kuten ennenkin.
      // Ajetaan TAUSTALLA vasta tallennuksen jälkeen: agentti saa vastauksen heti, ja selitys ilmestyy tilaukselle parin sekunnin päästä.
      explainApproval(structuredClone(order), buyer).then((explanation) => {
        const fresh = explanation && orders.get(orderId);
        if (fresh?.approval) { fresh.approval.explanation = explanation; orders.save(fresh); }
      }).catch(() => {});
    }
    return { ...publicOrder(order), ms: +(performance.now() - t0).toFixed(1) };
  };

  // 1) Tarjousten todennus: allekirjoitus, vastaanottaja, voimassaolo, kertakäyttöisyys
  ledger.append(`agent:${buyer.id}`, 'ORDER_RECEIVED', { offers: input.offers.length, idempotencyKey: key, buyerReference: input.buyerReference || null }, refs);
  const { payloads, reasons } = verifyOffers(buyer, input.offers, now);
  ledger.append('gateway', reasons.length ? 'OFFER_VERIFICATION_FAILED' : 'OFFER_VERIFIED', { offers: payloads.map((p) => p.jti), failures: reasons.map((r) => r.code), algorithm: 'EdDSA (Ed25519)' }, refs);
  if (reasons.length) return commit(() => ({ ...base, status: 'rejected', reasons, lines: [], totals: null, offers: payloads.map((p) => ({ offerId: p.jti, quoteId: p.quoteId })) }));

  // 2) Tuore tarkistus: hinta, saldo ja tilausaikaraja juuri nyt
  const { lines, deliveryDate, requestedDeliveryDate, cutoff, price } = await liveRecheck(payloads, reasons);
  const totals = totalsOf(lines); const { net } = totals;
  const draft = { ...base, deliveryDate, requestedDeliveryDate, cutoff, cutoffLabel: helsinkiLabel(cutoff), lines, totals, offers: payloads.map(offerRef), requested: payloads.map((p) => ({ ref: p.needRef, ...p.requested })), substitutions: payloads.map((p) => p.substitution).filter(Boolean),
    priceSource: price.source, priceCheckedLive: price.current, priceFetchedAt: price.current ? null : price.oldestFetchedAt };
  ledger.append('gateway', 'LIVE_RECHECK', { products: lines.length, changed: reasons.map((r) => `${r.code}:${r.detail.productId}`), priceSource: price.source || apiMode() }, refs);
  if (reasons.length) return commit(() => ({ ...draft, status: 'rejected', reasons }));

  // Kielimallin perustelu korvaajalle ei ole allekirjoitetussa tarjouksessa (se ei ole sitova tieto), joten se haetaan tarjouspyynnöstä.
  for (const pl of payloads) {
    const note = pl.substitution && quotes.get(pl.quoteId)?.needs.flatMap((n) => n.options).find((o) => o.optionId === pl.jti)?.substitution;
    const sub = note?.modelNote && draft.substitutions.find((x) => x.byProductId === pl.substitution.byProductId);
    if (sub) { sub.modelNote = note.modelNote; sub.chosenBy = note.chosenBy; }
  }

  return commit(() => {
    const order = structuredClone(draft);
    // Samanaikainen tilaus on voinut käyttää saman tarjouksen tarkistuksen ja tämän hetken välissä.
    const used = usedOfferIds(buyer.id);
    const reused = payloads.filter((p) => used.has(p.jti));
    if (reused.length) {
      ledger.append('gateway', 'OFFER_VERIFICATION_FAILED', { offers: payloads.map((p) => p.jti), failures: reused.map(() => 'OFFER_ALREADY_USED'), stage: 'commit' }, refs);
      return { ...order, status: 'rejected', reasons: reused.map((p) => reason('OFFER_ALREADY_USED', 'block', { offerId: p.jti })) };
    }
    // 3) Mandaatti päättää: vahvistus, ihmisen hyväksyntä vai hylkäys
    const verdict = evaluateMandate(buyer, { lines, totals: order.totals, deliveryDate, requestedDeliveryDate, substitutions: order.substitutions }, { extraBannedAllergens: allergenBans });
    order.status = verdict.status;
    order.reasons = verdict.reasons;
    ledger.append('policy', 'MANDATE_EVALUATED', { approvalLevel: buyer.mandate.approval, outcome: verdict.status, reasons: verdict.reasons.map((r) => ({ code: r.code, severity: r.severity, detail: r.detail })) }, refs);
    // 3b) Taustavahti vertaa tilausta ostajan omaan historiaan. Se voi vain tiukentaa: vahvistettu → ihmisen hyväksyntään.
    if (order.status !== 'rejected') {
      const watch = watchOrder(buyer, { lines, totals: order.totals });
      order.reasons = [...order.reasons, ...watch.findings, ...priceNotice(price)];
      const escalated = order.status === 'confirmed' && watch.findings.length > 0;
      if (escalated) order.status = 'pending_approval';
      ledger.append('watch', 'WATCH_EVALUATED', { historyOrders: watch.historyOrders, outcome: escalated ? 'escalated_to_human' : watch.findings.length ? 'flagged' : 'no_findings', findings: watch.findings.map((r) => ({ code: r.code, severity: r.severity, message: r.message, detail: r.detail })) }, refs);
    }
    if (order.status === 'pending_approval') {
      order.approval = { required: true, requestedAt: now.toISOString(), approver: buyer.approver || null, expiresAt: order.cutoff, url: `${baseUrl}/approve.html?order=${orderId}` };
      order.notifications.push({ at: now.toISOString(), kind: 'approval_request', to: buyer.approver || 'ostaja', text: `Hyväksyntää odottaa tilaus ${orderId}: ${net.toFixed(2)} €, toimitus ${deliveryDate}.` });
      ledger.append('gateway', 'APPROVAL_REQUESTED', { to: buyer.approver || 'ostaja', url: order.approval.url, expiresAt: order.cutoff }, refs);
    } else if (order.status === 'confirmed') {
      const info = order.reasons.filter((r) => r.severity === 'info');
      if (info.length) { // agentti päätti itse sääntöjen sisällä → ihminen saa ilmoituksen jälkikäteen
        order.notifications.push({ at: now.toISOString(), kind: 'fyi', to: buyer.approver || 'ostaja', text: `Tilaus ${orderId} vahvistettu ilman kuittausta: ${info.map((r) => r.message).join('; ')}.` });
        ledger.append('gateway', 'NOTIFICATION_SENT', { to: buyer.approver || 'ostaja', kind: 'fyi', about: info.map((r) => r.code) }, refs);
      }
    }
    return order;
  });
}

// ---------- add_to_order ("ainii, unohtui kerma") ----------
function applyAddition(o, add) {
  o.lines = [...o.lines, ...add.lines];
  o.totals = totalsOf(o.lines);
  o.offers = [...(o.offers || []), ...add.offers];
  o.requested = [...(o.requested || []), ...add.requested];
  o.substitutions = [...(o.substitutions || []), ...add.substitutions];
  o.cutoff = earliest([o.cutoff, add.cutoff]); o.cutoffLabel = helsinkiLabel(o.cutoff);
}
const additionText = (o, add) => `${add.lines.map((l) => `${l.name} × ${l.quantity} ${l.salesUnitLabel}`).join(', ')}`;

/**
 * Lisää rivejä jo tehtyyn tilaukseen ennen tilausaikarajaa. Sama ketju kuin tilauksessa: allekirjoitettu tarjous,
 * tuore tarkistus ja mandaatti, joka arvioidaan KOKO tilauksen uudella summalla. Vahvistettu tilaus ei koskaan
 * muutu ilman päätöstä: jos lisäys tarvitsee ihmisen, se jää odottamaan ja alkuperäinen tilaus pysyy voimassa.
 */
export async function addToOrder(buyer, input = {}, { baseUrl = '' } = {}) {
  const t0 = performance.now();
  const key = String(input.idempotencyKey || '');
  if (key.length < 8) throw new GatewayError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey (vähintään 8 merkkiä) on pakollinen: sama avain palauttaa saman lisäyksen');
  if (!Array.isArray(input.offers) || !input.offers.length) throw new GatewayError(400, 'OFFERS_REQUIRED', 'offers puuttuu: anna request_quote-vastauksen offer-kentät');
  const o = refresh(orders.get(String(input.orderId || '')));
  if (!o || o.buyerId !== buyer.id) throw new GatewayError(404, 'ORDER_NOT_FOUND', 'Tilausta ei löydy');
  const prior = (o.additions || []).find((a) => a.idempotencyKey === key) || (o.pendingAddition?.idempotencyKey === key ? o.pendingAddition : null);
  if (prior) return { ...publicOrder(o), addition: prior, duplicate: true };
  if (!['confirmed', 'pending_approval'].includes(o.status)) throw new GatewayError(409, 'ORDER_NOT_OPEN', `Tilaus on tilassa ${o.status}, siihen ei voi lisätä`);
  if (o.cutoff && cutoffPassed(o.cutoff)) throw new GatewayError(409, 'CUTOFF_PASSED', `Tilausaika umpeutui ${helsinkiLabel(o.cutoff)}, tilaukseen ei voi enää lisätä`);
  if (o.pendingAddition) throw new GatewayError(409, 'ADDITION_PENDING', 'Edellinen lisäys odottaa vielä ihmisen hyväksyntää');

  const now = clock.now(); const at = now.toISOString();
  const refs = { buyerId: buyer.id, orderId: o.orderId };
  const additionId = `${o.orderId}-L${(o.additions?.length || 0) + 1}`;
  const to = buyer.approver || 'ostaja';
  ledger.append(`agent:${buyer.id}`, 'ADDITION_RECEIVED', { additionId, offers: input.offers.length, idempotencyKey: key, requestedBy: input.requestedBy || null }, refs);
  const { payloads, reasons } = verifyOffers(buyer, input.offers, now);
  ledger.append('gateway', reasons.length ? 'OFFER_VERIFICATION_FAILED' : 'OFFER_VERIFIED', { offers: payloads.map((p) => p.jti), failures: reasons.map((r) => r.code), algorithm: 'EdDSA (Ed25519)' }, refs);
  const add = { additionId, idempotencyKey: key, requestedBy: input.requestedBy || null, at, lines: [], addedNet: 0, offers: payloads.map(offerRef), requested: payloads.map((p) => ({ ref: p.needRef, ...p.requested })), substitutions: payloads.map((p) => p.substitution).filter(Boolean), cutoff: earliest(payloads.map((p) => p.cutoff)) };
  const done = (status, why, type) => {
    add.status = status; add.reasons = why; add.orderNetAfter = status === 'applied' ? o.totals.net : null;
    if (status !== 'pending_approval') (o.additions ||= []).push(add);
    o.history.push({ at: clock.now().toISOString(), status: o.status, by: 'gateway', addition: additionId, additionStatus: status });
    orders.save(o);
    ledger.append('gateway', type, { additionId, addedNet: add.addedNet, orderNet: o.totals.net, reasons: why.map((r) => r.code) }, refs);
    return { ...publicOrder(o), addition: add, ms: +(performance.now() - t0).toFixed(1) };
  };
  if (reasons.length) return done('rejected', reasons, 'ADDITION_REJECTED');

  const re = await liveRecheck(payloads, reasons);
  ledger.append('gateway', 'LIVE_RECHECK', { products: re.lines.length, changed: reasons.map((r) => `${r.code}:${r.detail.productId}`), priceSource: re.price.source || apiMode() }, refs);
  if (re.deliveryDate !== o.deliveryDate) reasons.push(reason('DELIVERY_DATE_MISMATCH', 'block', { orderDeliveryDate: o.deliveryDate, offerDeliveryDate: re.deliveryDate }));
  add.lines = re.lines.map((l) => ({ ...l, addedIn: additionId }));
  add.addedNet = totalsOf(add.lines).net;
  if (reasons.length) return done('rejected', reasons, 'ADDITION_REJECTED');

  // Mandaatti arvioi koko tilauksen uudella summalla. Jo päätettyjä asioita (aiempi korvaaja, päivän siirto) ei kysytä uudestaan,
  // mutta eurokatto lasketaan aina koko summasta: isompi tilaus tarvitsee uuden luvan.
  const stillOpen = o.status === 'pending_approval';
  const allLines = [...o.lines, ...add.lines];
  const verdict = evaluateMandate(buyer, { lines: allLines, totals: totalsOf(allLines), deliveryDate: o.deliveryDate, requestedDeliveryDate: stillOpen ? o.requestedDeliveryDate : o.deliveryDate, substitutions: stillOpen ? [...(o.substitutions || []), ...add.substitutions] : add.substitutions }, { excludeOrderId: o.orderId }, { extraBannedAllergens: o.excludeAllergens || [] });
  ledger.append('policy', 'MANDATE_EVALUATED', { scope: 'addition', additionId, approvalLevel: buyer.mandate.approval, outcome: verdict.status, orderNetAfter: totalsOf(allLines).net, reasons: verdict.reasons.map((r) => ({ code: r.code, severity: r.severity, detail: r.detail })) }, refs);
  if (verdict.status === 'rejected') return done('rejected', verdict.reasons.filter((r) => r.severity === 'block'), 'ADDITION_REJECTED');
  // Taustavahti: koko tilaus uusilla määrillä ostajan historiaa vasten, havainnot vain lisätyistä tuotteista. Voi vain tiukentaa.
  const watch = watchOrder(buyer, { lines: allLines, totals: totalsOf(allLines) }, { excludeOrderId: o.orderId, focusProductIds: add.lines.map((l) => l.productId) });
  verdict.reasons.push(...watch.findings, ...priceNotice(re.price));
  const escalated = verdict.status === 'confirmed' && watch.findings.length > 0;
  if (escalated) verdict.status = 'pending_approval';
  ledger.append('watch', 'WATCH_EVALUATED', { scope: 'addition', additionId, historyOrders: watch.historyOrders, outcome: escalated ? 'escalated_to_human' : watch.findings.length ? 'flagged' : 'no_findings', findings: watch.findings.map((r) => ({ code: r.code, severity: r.severity, message: r.message, detail: r.detail })) }, refs);

  if (stillOpen) { // tilaus odottaa vielä ihmistä: lisäys menee samaan kuittaukseen
    applyAddition(o, add); o.reasons = verdict.reasons;
    o.notifications.push({ at, kind: 'approval_request', to, text: `Hyväksyntää odottavaan tilaukseen ${o.orderId} lisättiin ${additionText(o, add)}. Uusi summa ${o.totals.net.toFixed(2)} €.` });
    return done('applied', verdict.reasons, 'ORDER_AMENDED');
  }
  if (verdict.status === 'confirmed') { // sääntöjen sisällä: lisätään heti ja kerrotaan ihmiselle jälkikäteen
    applyAddition(o, add);
    o.notifications.push({ at, kind: 'fyi', to, text: `Lisätty tilaukseen ${o.orderId}: ${additionText(o, add)}. Uusi summa ${o.totals.net.toFixed(2)} € (alv 0 %).` });
    ledger.append('gateway', 'NOTIFICATION_SENT', { to, kind: 'fyi', about: ['ORDER_AMENDED'] }, refs);
    return done('applied', verdict.reasons, 'ORDER_AMENDED');
  }
  // lisäys tarvitsee ihmisen: alkuperäinen tilaus pysyy vahvistettuna sellaisenaan
  add.orderNetIfApproved = totalsOf(allLines).net;
  add.approval = { required: true, requestedAt: at, approver: buyer.approver || null, expiresAt: earliest([o.cutoff, add.cutoff]), url: `${baseUrl}/approve.html?order=${o.orderId}` };
  o.pendingAddition = add;
  o.notifications.push({ at, kind: 'approval_request', to, text: `Lisäys tilaukseen ${o.orderId} odottaa hyväksyntää: ${additionText(o, add)}, +${add.addedNet.toFixed(2)} €. Uusi summa olisi ${add.orderNetIfApproved.toFixed(2)} €.` });
  ledger.append('gateway', 'APPROVAL_REQUESTED', { to, additionId, url: add.approval.url, expiresAt: add.approval.expiresAt }, refs);
  return done('pending_approval', verdict.reasons, 'ADDITION_PENDING_APPROVAL');
}

function decideAddition(o, decision, by) {
  const add = o.pendingAddition; const at = clock.now().toISOString();
  const refs = { buyerId: o.buyerId, orderId: o.orderId };
  delete o.pendingAddition;
  if (decision === 'approve') {
    applyAddition(o, add); add.status = 'applied'; add.orderNetAfter = o.totals.net;
    add.reasons = [...add.reasons, reason('HUMAN_APPROVED', 'info', { by, at })];
    ledger.append(`human:${by}`, 'HUMAN_APPROVED', { additionId: add.additionId, overrode: add.reasons.filter((r) => r.severity === 'approval').map((r) => r.code) }, refs);
  } else {
    add.status = 'rejected'; add.reasons = [...add.reasons, reason('HUMAN_REJECTED', 'block', { by, at })];
    ledger.append(`human:${by}`, 'HUMAN_REJECTED', { additionId: add.additionId }, refs);
  }
  add.approval = { ...add.approval, decidedAt: at, decidedBy: by, decision };
  (o.additions ||= []).push(add);
  o.history.push({ at, status: o.status, by: `human:${by}`, addition: add.additionId, additionStatus: add.status });
  orders.save(o);
  ledger.append('gateway', add.status === 'applied' ? 'ORDER_AMENDED' : 'ADDITION_REJECTED', { additionId: add.additionId, addedNet: add.addedNet, orderNet: o.totals.net, after: 'human decision' }, refs);
  return { ...publicOrder(o), addition: add };
}

export function getOrder(buyer, orderId) {
  const o = refresh(orders.get(orderId));
  if (!o || (buyer && o.buyerId !== buyer.id)) throw new GatewayError(404, 'ORDER_NOT_FOUND', 'Tilausta ei löydy');
  return publicOrder(o);
}
export const listOrders = (buyer) => orders.list(buyer?.id).map(refresh).map(publicOrder);

/** Ihmisen päätös (hyväksyntänäkymästä). Hyväksyntä ei voi ohittaa mennyttä tilausaikarajaa eikä esteitä. */
export function decideApproval(orderId, decision, by = 'ostaja') {
  const o = refresh(orders.get(orderId));
  if (!o) throw new GatewayError(404, 'ORDER_NOT_FOUND', 'Tilausta ei löydy');
  if (o.status === 'confirmed' && o.pendingAddition) return decideAddition(o, decision, by);
  if (o.status !== 'pending_approval') throw new GatewayError(409, 'NOT_PENDING', `Tilaus on jo tilassa ${o.status}`);
  const refs = { buyerId: o.buyerId, orderId };
  const at = clock.now().toISOString();
  if (decision === 'approve') {
    o.status = 'confirmed'; o.reasons.push(reason('HUMAN_APPROVED', 'info', { by, at }));
    ledger.append(`human:${by}`, 'HUMAN_APPROVED', { overrode: o.reasons.filter((r) => r.severity === 'approval').map((r) => r.code) }, refs);
  } else {
    o.status = 'rejected'; o.reasons.push(reason('HUMAN_REJECTED', 'block', { by, at }));
    ledger.append(`human:${by}`, 'HUMAN_REJECTED', {}, refs);
  }
  o.approval = { ...o.approval, decidedAt: at, decidedBy: by, decision };
  o.history.push({ at, status: o.status, by: `human:${by}` });
  orders.save(o);
  ledger.append('gateway', o.status === 'confirmed' ? 'ORDER_CONFIRMED' : 'ORDER_REJECTED', { net: o.totals.net, after: 'human decision' }, refs);
  return publicOrder(o);
}

/**
 * "Unohtuiko tämä?": ihminen lisää portin ehdotuksen yhdellä napilla. Portti ei oikaise mitään: se pyytää itseltään
 * allekirjoitetun tarjouksen ja lisää sen add_to_order-ketjun läpi (tuore tarkistus, mandaatti, vahti, loki).
 * Jos lisäys jäisi odottamaan hyväksyntää, napin painanut ihminen on jo se hyväksyjä, joten päätös kirjataan hänen nimiinsä.
 */
export async function acceptSuggestion(orderId, productId, by = 'ostaja', ctx = {}) {
  const o = refresh(orders.get(orderId));
  if (!o) throw new GatewayError(404, 'ORDER_NOT_FOUND', 'Tilausta ei löydy');
  const buyer = buyers.byId(o.buyerId);
  const s = suggestFor(buyer, o).find((x) => x.productId === String(productId));
  if (!s) throw new GatewayError(409, 'SUGGESTION_NOT_AVAILABLE', 'Ehdotus ei ole enää voimassa');
  ledger.append(`human:${by}`, 'SUGGESTION_ACCEPTED', { productId: s.productId, name: s.name, quantity: s.typicalQuantity, unit: s.salesUnitLabel, basis: { inOrders: s.inOrders, ofOrders: s.ofOrders } }, { buyerId: buyer.id, orderId });
  const quote = await requestQuote(buyer, { deliveryDate: o.deliveryDate, maxOptions: 1, needs: [{ ref: 'suggestion', candidates: [s.productId], quantity: { value: s.typicalQuantity, unit: 'PCS' }, allowSubstitutes: false }] });
  const option = quote.needs[0].options[0];
  if (!option) { const why = quote.needs[0].excluded[0]; throw new GatewayError(409, 'SUGGESTION_NOT_AVAILABLE', `${s.name} ei ole nyt tilattavissa${why ? `: ${why.message}` : ''}`, why); }
  const r = await addToOrder(buyer, { orderId, offers: [option.offer], idempotencyKey: `suggest-${s.productId}-${(o.additions?.length || 0) + 1}`, requestedBy: `Portin ehdotus: ${by} lisäsi yhdellä napilla` }, ctx);
  if (r.addition?.status === 'pending_approval') return decideApproval(orderId, 'approve', by);
  return r;
}

export function auditTrail(buyer, orderId) {
  const o = orders.get(orderId);
  if (!o || (buyer && o.buyerId !== buyer.id)) throw new GatewayError(404, 'ORDER_NOT_FOUND', 'Tilausta ei löydy');
  const entries = ledger.forOrder(orderId, [...(o.offers || []), ...(o.pendingAddition?.offers || [])].map((x) => x.quoteId));
  return { orderId, status: o.status, chain: ledger.verify(), entries, clock: clock.info() };
}

export const mandateOf = (buyer) => ({ ...publicMandate(buyer), clock: clock.info() });
