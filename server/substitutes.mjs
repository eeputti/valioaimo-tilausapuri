// Korvaaja-agentti: ehdottaa max 3 korvaavaa tuotetta, jotka säilyttävät allergeeniprofiilin, pakkauskoon ja hintatason.
// Vaihe 1 on puhdasta staattista dataa (millisekunteja), vaihe 2 kysyy saatavuuden ja hinnan vain rajatulle joukolle.
import { loadCatalog, tokenize, stems, allergenName, unitLabel, stepOf, roundToStep } from './catalog.mjs';
import { fetchQuotes } from './valioApi.mjs';
import { cutoffPassed } from './gateway/clock.mjs';
import { touchesBanned } from './allergens.mjs';

const DIET_LABELS = ['FREE_FROM_LACTOSE', 'FREE_FROM_GLUTEN', 'VEGAN', 'EU_ORGANIC_FARMING'];
const DIET_NAME = { FREE_FROM_LACTOSE: 'laktoositon', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', EU_ORGANIC_FARMING: 'luomu' };
const SIZE_TOKEN = /^\d|^(kg|g|l|dl|ml|cl|kpl|x|pss|ltk|pkt|prk|n|noin|uht|esl)$/;

const GENERIC = new Set(['pakaste', 'kotimainen', 'suomi', 'suomalainen', 'luomu', 'laktoositon', 'gluteeniton', 'vegaaninen', 'kypsä', 'tuore', 'pesty', 'irto', 'lk', 'laatikko', 'pussi', 'säkki', 'filmi', 'viipale', 'viipaloitu', 'kausituote']);
const brandTokens = (p) => new Set(tokenize(p.brand || ''));
const nameKey = (p) => { const b = brandTokens(p); return new Set(tokenize(p.name).filter((t) => !SIZE_TOKEN.test(t) && !GENERIC.has(t) && !b.has(t)).map((t) => stems(t).at(-1))); };
const jaccard = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter += 1; return inter / (a.size + b.size - inter || 1); };
const sizeOf = (p) => p.kg || p.litres || null;
const pieceSize = (p) => { const s = sizeOf(p); return s ? s / (p.perSales > 1 ? p.perSales : 1) : null; };
const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x)} %`;

// Yhdyssanat: "jäävuorisalaatti" ja "amerikansalaattisuikale" ovat samaa tuotetta, vaikka yhtään sanaa ei ole yhteistä.
const sharedPart = (a, b) => { for (let len = Math.min(a.length, b.length); len >= 5; len--) for (let i = 0; i + len <= a.length; i++) if (b.includes(a.slice(i, i + len))) return true; return false; };
const compoundSim = (a, b) => { let hit = 0; for (const x of a) if ([...b].some((y) => x === y || sharedPart(x, y))) hit += 1; return a.size ? hit / a.size : 0; };

// Ruoka ratkeaa yhdyssanan alkuosasta: lanttulaatikko ja maksalaatikko ovat eri ruokia, vaikka "laatikko" on yhteinen
// (WhatsApp 18.11.: lanttulaatikon tilalle tarjottiin maksalaatikkoa ja nakki-perunasoselaatikkoa). Ruoan tilalle käy vain
// sama ruoka toiselta valmistajalta tai toisessa koossa; lihakaalilaatikko ja kaalilaatikko ovat sama ruoka.
const DISH_HEADS = ['laatikko', 'keitto', 'kastike', 'kiusaus', 'vuoka', 'pata', 'muhennos', 'piirakka', 'pihvi', 'pyörykkä', 'pyörykät', 'kääryle'];
export function dishesOf(p) {
  const out = [];
  for (const t of tokenize(p?.name || '')) for (const head of DISH_HEADS) {
    const at = t.indexOf(head);
    if (at >= 3) out.push({ head, base: t.slice(0, at) }); // alkuosa vähintään 3 kirjainta: pelkkä "laatikko" on myyntierä
  }
  return out;
}
export function sameDish(a, b) {
  const da = dishesOf(a), db = dishesOf(b);
  if (!da.length && !db.length) return true; // kumpikaan ei ole valmisruokaa: tämä sääntö ei koske
  return da.some((x) => db.some((y) => x.head === y.head && (x.base === y.base || x.base.endsWith(y.base) || y.base.endsWith(x.base))));
}

function staticCandidates(original, rules, relaxed = false) {
  const cat = loadCatalog();
  const pool = new Map();
  const add = (p, why) => { if (p && p.id !== original.id && !pool.has(p.id)) pool.set(p.id, { product: p, listed: false, why }); };
  for (const id of original.subs || []) { add(cat.get(id), 'listed'); if (pool.has(id)) pool.get(id).listed = true; }
  // Käänteinen suunta: tuotteet, joiden korvaajaksi tämä on merkitty, ovat usein samaa perhettä.
  for (const p of cat.products) if (p.category === original.category) add(p, 'category');
  for (const { product } of cat.search(tokenize(original.name).filter((t) => !SIZE_TOKEN.test(t)).slice(0, 3).join(' '), { limit: 25 })) add(product, 'search');

  const key = nameKey(original);
  const origSize = pieceSize(original);
  const scored = [];
  for (const c of pool.values()) {
    const p = c.product;
    if (original.temp && p.temp && p.temp !== original.temp) continue; // kylmäketju ei vaihdu
    if (touchesBanned(rules.bannedAllergens, p)) continue; // alakoodit ja "voi sisältää" (katselmus 15.11. #2)
    if ((rules.blockedVendors || []).includes(p.vendor)) continue;
    const newAllergens = p.contains.filter((a) => !original.contains.includes(a));
    if (rules.subSameAllergens && newAllergens.length) continue; // ei uusia allergeeneja
    const lostDiet = DIET_LABELS.filter((l) => original.labels?.includes(l) && !p.labels?.includes(l) && l !== 'EU_ORGANIC_FARMING');
    if (lostDiet.length) continue; // laktoositon pysyy laktoosittomana
    // Valmisruoan tilalle vain sama ruoka, myös väljässä haussa (saman tuoteryhmän muut laatikot ovat eri ruokia).
    // Valion tuotedatassa korvaajaksi merkitty kelpaa aina.
    if (!c.listed && !sameDish(original, p)) continue;
    const sim = Math.max(jaccard(key, nameKey(p)), compoundSim(key, nameKey(p)) * 0.8);
    // Tiukka haku vaatii saman tuotteen; väljä haku (kun tiukka ei löydä mitään tilattavaa) hyväksyy saman tuoteryhmän.
    if (!c.listed && (relaxed ? p.category !== original.category : sim < 0.2)) continue;
    const size = pieceSize(p);
    const ratio = origSize && size ? size / origSize : null;
    if (!c.listed && ratio && (relaxed ? ratio > 10 || ratio < 0.1 : ratio > 4 || ratio < 0.2)) continue;
    let score = sim * 0.5 + (c.listed ? 0.3 : 0) + (p.category === original.category ? 0.12 : 0);
    if (ratio) score += 0.12 * (1 - Math.min(1, Math.abs(Math.log2(ratio)) / 2));
    score += ((p.reliability ?? 0.93) - 0.9) * 0.6;
    if (rules.preferDomestic && p.country === 'fi') score += 0.05;
    if (p.brand && p.brand === original.brand) score += 0.04;
    scored.push({ ...c, sim, ratio, loose: !c.listed && sim < 0.4, newAllergens, score, allergensVerified: !!(original.hasAllergenData && p.hasAllergenData) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, relaxed ? 90 : 14);
}

/**
 * @returns {Promise<{options: Array, checked: number, staticMs: number, quoteMs: number}>}
 * options[]: {type:'swap'|'combo', productId, name, qty, unitLabel, price, availability, why[], warnings[], score, recommended}
 */
export async function findSubstitutes(original, qty, date, rules, ctx = {}) {
  const t0 = performance.now();
  const cands = staticCandidates(original, rules, !!ctx.relaxed);
  const staticMs = performance.now() - t0;
  const t1 = performance.now();
  const quotes = await fetchQuotes([original.id, ...cands.map((c) => c.product.id)], date);
  const quoteMs = performance.now() - t1;

  const origQuote = quotes.get(original.id) || {};
  const origPrice = origQuote.price && !origQuote.price.error ? origQuote.price : null;
  const origSize = sizeOf(original) || (origPrice?.comparison ? origPrice.net / origPrice.comparison : null);
  const origAvail = origQuote.avail;
  const partialAmount = origAvail?.status === 'ok' && !cutoffPassed(origAvail.closingTime) && origAvail.amount != null && origAvail.amount < qty ? roundToStep(origAvail.amount, original, 'down') : 0;
  const needQty = qty - partialAmount;

  const options = [];
  for (const c of cands) {
    const p = c.product;
    const q = quotes.get(p.id) || {};
    const avail = q.avail;
    const price = q.price && !q.price.error ? q.price : null;
    if (!avail || avail.status !== 'ok' || !price) continue; // vain varmistetusti saatavilla ja hinnoiteltu
    if (cutoffPassed(avail.closingTime)) continue; // tilausaika jo umpeutunut → ei oikeasti tilattavissa
    const size = sizeOf(p) || (price.comparison ? price.net / price.comparison : null);
    // Sama määrä raaka-ainetta, ei sama määrä pakkauksia.
    let subQty = origSize && size ? (needQty * origSize) / size : needQty;
    subQty = Math.max(stepOf(p), roundToStep(subQty, p, 'up'));
    if (avail.amount != null && avail.amount < subQty) continue;
    const total = +(price.net * subQty).toFixed(2);
    const origTotal = origPrice ? +(origPrice.net * needQty).toFixed(2) : null;
    const deltaPct = origTotal ? ((total - origTotal) / origTotal) * 100 : null;
    const cmpDelta = origPrice?.comparison && price.comparison ? ((price.comparison - origPrice.comparison) / origPrice.comparison) * 100 : null;

    const why = [];
    const warnings = [];
    if (ctx.recipeRequired) warnings.push('Reseptikäyttö: varmista maku, koostumus ja saanto ennen korvaamista');
    if (c.listed) why.push('Aimon tuotedatassa merkitty korvaajaksi');
    if (c.loose) warnings.push('Eri tuote samasta tuoteryhmästä');
    if (c.allergensVerified) why.push(original.contains.length ? `Sama allergeeniprofiili (${original.contains.map(allergenName).join(', ')})` : 'Ei allergeeneja, kuten alkuperäisessä');
    else warnings.push('Allergeenitietoa ei voi varmentaa datasta');
    for (const l of DIET_LABELS) if (original.labels?.includes(l) && p.labels?.includes(l)) why.push(`Myös ${DIET_NAME[l]}`);
    if (original.labels?.includes('EU_ORGANIC_FARMING') && !p.labels?.includes('EU_ORGANIC_FARMING')) warnings.push('Ei luomu (alkuperäinen on)');
    if (c.ratio && Math.abs(c.ratio - 1) > 0.15) warnings.push(`Pakkauskoko ${c.ratio > 1 ? 'suurempi' : 'pienempi'} (${fmtSize(p)} vs. ${fmtSize(original)})`);
    else if (c.ratio) why.push('Sama pakkauskoko');
    if (p.reliability != null) (p.reliability >= (rules.minReliability ?? 0.9) ? why : warnings).push(`Toimitusvarmuus ${(p.reliability * 100).toFixed(1).replace('.0', '')} %`);
    if (p.country === 'fi' && original.country === 'fi') why.push('Kotimainen');
    else if (original.country === 'fi' && p.country && p.country !== 'fi') warnings.push(`Alkuperä ${p.country.toUpperCase()} (alkuperäinen FI)`);
    if (deltaPct != null && deltaPct > (rules.subMaxPriceIncreasePct ?? 10)) warnings.push(`Hinta ${pct(deltaPct)} yli sallitun ${rules.subMaxPriceIncreasePct} %`);

    let score = c.score;
    if (deltaPct != null) score -= Math.max(0, deltaPct) * 0.006 - Math.min(0, deltaPct) * 0.001;
    if (cmpDelta != null) score -= Math.max(0, Math.abs(cmpDelta) - 10) * 0.002;
    score -= warnings.length * 0.03;

    options.push({
      type: 'swap', productId: p.id, name: p.name, brand: p.brand, qty: subQty, unit: p.salesUnit, unitLabel: unitLabel(p.salesUnit),
      price: { net: price.net, total, deltaPct: deltaPct == null ? null : +deltaPct.toFixed(1), comparison: price.comparison, comparisonUnit: price.comparisonUnit, source: price.source },
      availability: { status: 'ok', amount: avail.amount, model: avail.model, source: avail.source },
      reliability: p.reliability ?? null, co2: p.co2 ?? null, country: p.country, listed: c.listed,
      withinPolicy: !ctx.recipeRequired && !warnings.some((w) => /yli sallitun|varmentaa|Eri tuote/.test(w)),
      why, warnings, score: +score.toFixed(3),
    });
  }
  options.sort((a, b) => b.score - a.score);
  // Tiukka haku ei löytänyt mitään tilattavaa: haetaan lähin tilattavissa oleva samasta tuoteryhmästä. Nämä vaativat aina ihmisen päätöksen.
  if (!options.length && !ctx.relaxed) return findSubstitutes(original, qty, date, rules, { ...ctx, relaxed: true });
  const top = options.slice(0, ctx.limit ?? 3);

  // Osatoimitus: pidetään saatavilla oleva osa alkuperäistä ja täydennetään loput parhaalla korvaajalla.
  if (partialAmount > 0 && top.length) {
    const best = top[0];
    top.forEach((o) => { o.type = 'combo'; o.keepOriginalQty = partialAmount; });
    best.why.unshift(`Alkuperäistä saadaan ${partialAmount} ${unitLabel(original.salesUnit)}, loput ${needQty} ${unitLabel(original.salesUnit)} korvataan`);
  }
  if (top[0]) top[0].recommended = true;
  return { options: top, checked: cands.length, staticMs: +staticMs.toFixed(1), quoteMs: +quoteMs.toFixed(1), partialAmount };
}

function fmtSize(p) {
  const n = (v) => String(+(v / (p.perSales > 1 ? p.perSales : 1)).toFixed(2)).replace('.', ',');
  if (p.litres && /\d\s*(l|dl|ml|cl)\b/i.test(p.name)) return `${n(p.litres)} l`;
  if (p.kg) return `${n(p.kg)} kg`;
  return unitLabel(p.salesUnit);
}
