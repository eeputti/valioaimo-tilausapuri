// AIMO-MALLIN KOHDISTUS: rakenteinen pyyntö → oikeat tuotteet Aimon katalogista + portin kutsut valmiina.
// Tuotteet tulevat aina katalogista. Tämä kerros ei koskaan tuota tuotekoodia, jota katalogissa ei ole,
// ja jos mikään ei täsmää, se sanoo sen suoraan (NO_MATCH) ja tarjoaa lähimmät löysennykset nappeina.
import { loadCatalog } from '../catalog.mjs';
import { loadLexicon, variants, conceptOf } from './lexicon.mjs';
import { RAW_INGREDIENT, typeKey, compareKeys } from './match.mjs';
import { verifiedFree } from '../allergens.mjs';

/** Esiintyykö sana (missä tahansa taivutusmuodossa) tuotteen suomen- tai englanninkielisessä nimessä? */
const nameHas = (p, term) => { const en = (p.nameEn || '').toLowerCase(); return variants(term).some((v) => p._tokens.some((t) => t.includes(v)) || en.includes(v)); };

let PRODUCT_TYPES = [];
try { ({ PRODUCT_TYPES } = await import('../gateway/contract.mjs')); } catch { /* ilman porttia rajataan pelkällä kategorialla */ }

const FAT_RE = { 'fat-free': /rasvaton/i, 'semi-skimmed': /kevyt/i, whole: /täys/i }; // suomenkielisestä nimestä: englanniksi "semi-skimmed" sisältää sanan "skimmed"
// Säilyvät makeiset, keksit, säilykkeet, kastikkeet, öljyt ja kuiva-aineet. "Tuore" raaka-aine ei ole mikään näistä:
// tuoreiden tryffeleiden tilalle ei tarjota tryffelisuklaapatukkaa (itsepeli S056). Tuorehiiva on kylmätuote, joten se säilyy.
const SHELF_STABLE = /^(105|211|215|219|22|52)\d+$/;
const PORTION = /annos|portion|\d+\s*x\s*\d+\s*(cl|ml|g)\b/i; // annospakkaukset eivät vastaa litra- tai kilotarvetta
const CLAIM_FI = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu', MARINE_STEWARDSHIP_COUNCIL_LABEL: 'MSC', FAIR_TRADE_MARK: 'Reilu kauppa' };

function filterSteps(item) {
  const type = PRODUCT_TYPES.find((t) => t.id === item.productType);
  // Hyllyhaku ("kana" → raaka broileri): nimen pitää sisältää jokin hyllyn nimiosista, itse hakusanaa ei vaadita nimeen.
  const terms = item.shelf ? [] : (item.productTerm || '').split(' ').filter(Boolean);
  const steps = [];
  if (type) steps.push(['productType', (p) => type.categories.includes(p.category) && !(type.exclude && type.exclude.test(p.name))]);
  else if (item.categories?.length) steps.push(['category', (p) => item.categories.includes(p.category)]);
  else if (item.category) steps.push(['category', (p) => p.category === item.category]);
  if (item.shelf) steps.push(['shelf', (p) => { const n = p.name.toLowerCase(); return item.shelf.names.some((x) => n.includes(x)); }]);
  // Hyllyn tarkennus: "kanafilee" on broilerin fileetä, ei mitä tahansa broileria.
  if (item.shelf?.must?.length) steps.push(['shelfMust', (p) => { const n = p.name.toLowerCase(); return item.shelf.must.some((x) => n.includes(x)); }]);
  for (const c of item.claims) steps.push([`claim:${c}`, (p) => p.labels?.includes(c)]);
  // Koodihierarkia (allergens.mjs): pähkinätön (AN) ei tarjoa mantelia (SA), Tobleronea eikä Daimia.
  for (const a of item.excludeAllergens) steps.push([`excludeAllergen:${a}`, (p) => verifiedFree([a], p)]);
  if (item.countryOfOrigin) steps.push(['countryOfOrigin', (p) => p.country === item.countryOfOrigin]);
  if (item.brand) steps.push(['brand', (p) => (p.brand || '').trim().toLowerCase() === item.brand.trim().toLowerCase()]);
  if (item.attributes.fat) steps.push(['fat', (p) => FAT_RE[item.attributes.fat].test(p.name)]);
  if (item.attributes.fatPercent != null) steps.push(['fatPercent', (p) => new RegExp(`(^|\\D)${String(item.attributes.fatPercent).replace('.', '[.,]')}\\s*%`).test(p.name)]);
  if (item.attributes.treatment === 'uht') steps.push(['uht', (p) => /uht/i.test(p.name)]);
  if (item.attributes.state === 'frozen') steps.push(['frozen', (p) => p.temp === 'frozen']);
  if (item.attributes.state === 'fresh') steps.push(['fresh', (p) => !(p.temp === 'ambient' && SHELF_STABLE.test(p.category || ''))]);
  if (item.attributes.pack?.unit === 'L') steps.push(['pack', (p) => p.litres && Math.abs(p.litres / (p.perSales || 1) - item.attributes.pack.value) < 0.01]);
  if (item.quantity && item.quantity.unit !== 'PCS' && !/annos|portion/.test(item.raw)) steps.push(['notPortionPack', (p) => !PORTION.test(p.name)]);
  // muut tuotesanat (esim. "rintafilee" pääsanan "broilerin" lisäksi) rajaavat nimen perusteella
  return { steps, type, terms };
}

/**
 * @param item understand()-tuloksen yksi rivi
 * @returns {{status: 'ok'|'no_match', candidates: object[], total: number, funnel: object[], chips: object[], search: object}}
 */
export function resolveItem(item, opts = {}) {
  const r = resolveOnce(item, opts);
  // Litra- tai kilotarve, jota pääryhmän yksikään tuote ei kata samassa yksikössä: "5 l kanalientä" osui vain liemijauheisiin
  // (kg), vaikka valmiit 1 l liemet ovat valikoimassa toisessa ryhmässä (katselmus 15.11. #17). Silloin haetaan sanan muistakin
  // ryhmistä (vähintään 10 % sanan esiintymistä). Pääryhmä pysyy järjestyksessä edellä (match.mjs), ja mitään ei pudoteta.
  const measure = { L: 'litres', KG: 'kg' }[item.quantity?.unit];
  if (!measure || item.productType || item.shelf || !(item.category || item.categories?.length) || r.candidates.some((c) => c[measure] != null)) return r;
  const head = (item.productTerm || '').split(' ').filter(Boolean).at(-1);
  const wider = (conceptOf(head || '')?.top || []).filter((t) => t.share >= 0.1).map((t) => t.category);
  const current = new Set(item.categories?.length ? item.categories : [item.category]);
  if (!wider.some((c) => !current.has(c))) return r;
  const categories = [...current, ...wider.filter((c) => !current.has(c))];
  const w = resolveOnce({ ...item, category: null, categories }, opts);
  if (!w.candidates.some((c) => c[measure] != null)) return r;
  return { ...w, funnel: [{ filter: 'widenedForMeasure', categories, remaining: w.total }, ...w.funnel] };
}

function resolveOnce(item, opts = {}) {
  const cat = loadCatalog();
  const limit = opts.limit ?? 40;
  const { steps, type, terms } = filterSteps(item);
  let pool; let narrowedToRaw = false;
  if (type || item.category || item.shelf) pool = cat.products;
  else {
    // Tuntematon ryhmä: nimihaku koko katalogista. Jos sana löytyy nimestä kokonaisena, osasanaosumat jätetään pois:
    // muuten halvin ehdokas voi olla "pas|tilli", kun haettiin tilliä.
    const hits = item.productTerm ? cat.search(item.productTerm, { limit: 200 }) : [];
    const whole = hits.filter((h) => h.exact);
    pool = (whole.length ? whole : hits).map((h) => h.product);
    // Raaka-aine voittaa maun: "mustikka" on myös jogurtin, saippuan ja lautasliinan nimessä. Jos sana löytyy kokonaisena
    // tuore-, pakaste- tai maustekategorian tuotteesta, ehdokkaiksi jäävät vain ne. Muuten joukko pysyy ennallaan.
    const raw = whole.length ? pool.filter((p) => RAW_INGREDIENT.test(p.category || '')) : [];
    if (raw.length && raw.length < pool.length) { pool = raw; narrowedToRaw = true; }
  }
  const funnel = [];
  if (narrowedToRaw) funnel.push({ filter: 'rawIngredient', remaining: pool.length });
  let relaxed = null;
  for (const [name, fn] of steps) {
    const next = pool.filter(fn);
    funnel.push({ filter: name, remaining: next.length });
    if (!next.length && pool.length) { relaxed = name; break; } // tämä ehto tyhjentäisi tuloksen: pysähdytään ja kerrotaan se
    pool = next;
  }
  // tuotesanat nimessä: jos pääsanan lisäksi on tarkentavia sanoja, suositaan tuotteita joissa ne esiintyvät
  if (terms.length && (type || item.category)) {
    // Yhdyssanan osat erillisinä sanoina kelpaavat myös: "vaniljajäätelö" osuu nimeen "jäätelö Vanilja" (understand: compounds).
    // Osa haetaan kokonaisena sanan alusta tai lopusta: lyhyt vartalo ("rinta" → "rin") osuisi muuten sanaan "broilerin"
    // ja "kana" sanaan "porkkanasosekeitto".
    const partIn = (p, x) => p._tokens.some((t) => t.startsWith(x) || t.endsWith(x));
    const has = (p, t) => nameHas(p, t) || (item.compounds?.[t]?.every((x) => partIn(p, x)) ?? false);
    let narrowed = pool.filter((p) => terms.every((t) => has(p, t)));
    if (!narrowed.length) {
      // Kaikki sanat eivät osu samaan nimeen: tarkin sana ratkaisee. "Oltermanni juusto": Oltermannin nimessä ei lue "juusto",
      // joten rajataan Oltermanniin eikä kaikkiin juusto-nimisiin. Tasatilanteessa pääsana (viimeinen) voittaa.
      // Tarkin = koko valikoimassa harvinaisin sana (Oltermanni 23 tuotetta, juusto 80).
      const rarity = (t) => conceptOf(t)?.total ?? Infinity;
      const perTerm = terms.map((t) => ({ n: rarity(t), list: pool.filter((p) => has(p, t)) })).filter((x) => x.list.length);
      narrowed = perTerm.reduce((best, x) => (!best || x.n <= best.n ? x : best), null)?.list || [];
    }
    if (narrowed.length) { pool = narrowed; funnel.push({ filter: 'nameTerms', remaining: pool.length }); }
  }
  // Järjestys: ensin pyydetty tuotetyyppi (match.mjs: hylly, raaka-aine ennen valmistetta, nimen osuma), sitten
  // tuote, jolla on toimitusvarmuusdataa (= oikeasti tilattu), ja lyhyt nimi (= perustuote). Tyyppi ratkaisee jo tässä,
  // koska vain kärki (limit) jatkaa saatavuustarkistukseen: tomaattisäilykkeet eivät saa syrjäyttää tuoreita tomaatteja.
  const keys = new Map(pool.map((p) => [p, typeKey(p, item)]));
  const ranked = [...pool].sort((a, b) => compareKeys(keys.get(a), keys.get(b)) || (b.reliability != null) - (a.reliability != null) || a.name.length - b.name.length);
  const status = relaxed || !ranked.length ? 'no_match' : 'ok';
  return {
    status,
    reason: status === 'no_match' ? { code: 'NO_MATCH', failedFilter: relaxed, fi: relaxed ? `Yksikään tuote ei täytä ehtoa ${relaxed}. Näytetään lähimmät ilman sitä.` : 'Aimon valikoimasta ei löytynyt tätä tuotetta.', en: relaxed ? `No product satisfies ${relaxed}. Showing the closest ones without it.` : 'Nothing in the Aimo assortment matches.' } : undefined,
    total: ranked.length,
    candidates: ranked.slice(0, limit).map((p) => ({ id: p.id, name: p.name, brand: p.brand || null, unit: p.salesUnit, litres: p.litres ?? null, kg: p.kg ?? null, labels: p.labels || [] })),
    funnel,
    chips: chipsFor(item, ranked),
    search: { productType: item.productType || undefined, query: item.productType ? undefined : item.productTerm || undefined, claims: item.claims.length ? item.claims : undefined, excludeAllergens: item.excludeAllergens.length ? item.excludeAllergens : undefined, countryOfOrigin: item.countryOfOrigin || undefined, brand: item.brand || undefined },
  };
}

/** Tarkennusnapit (Zalando-malli): vain ne rajaukset, jotka oikeasti jakavat ehdokasjoukon. Nappi on valmis rakenteinen muutos, ei tekstikenttä. */
function chipsFor(item, pool) {
  if (pool.length < 2) return [];
  const chips = [];
  const share = (fn) => pool.filter(fn).length;
  const add = (label, patch, n) => { if (n > 0 && n < pool.length) chips.push({ label, patch, matches: n }); };
  if (!item.attributes.fat && (item.productType === 'milk' || item.category === '10400')) for (const [k, fi] of [['fat-free', 'Rasvaton'], ['semi-skimmed', 'Kevyt'], ['whole', 'Täys']]) add(fi, { attributes: { fat: k } }, share((p) => FAT_RE[k].test(p.name)));
  for (const [code, fi] of Object.entries(CLAIM_FI)) if (!item.claims.includes(code) && !['LOW_LACTOSE', 'VEGETARIAN', 'MARINE_STEWARDSHIP_COUNCIL_LABEL', 'FAIR_TRADE_MARK'].includes(code)) add(fi[0].toUpperCase() + fi.slice(1), { claims: [...item.claims, code] }, share((p) => p.labels?.includes(code)));
  if (!item.countryOfOrigin) add('Kotimainen', { countryOfOrigin: 'fi' }, share((p) => p.country === 'fi'));
  if (!item.brand) {
    const brands = new Map();
    for (const p of pool) if (p.brand) brands.set(p.brand.trim(), (brands.get(p.brand.trim()) || 0) + 1);
    for (const [b, n] of [...brands].sort((x, y) => y[1] - x[1]).slice(0, 3)) add(b, { brand: b }, n);
  }
  const packs = new Map();
  for (const p of pool) if (p.litres) { const per = +(p.litres / (p.perSales || 1)).toFixed(2); packs.set(per, (packs.get(per) || 0) + 1); }
  if (!item.attributes.pack) for (const [per, n] of [...packs].sort((x, y) => y[1] - x[1]).slice(0, 3)) add(`${String(per).replace('.', ',')} l pakkaus`, { attributes: { pack: { value: per, unit: 'L' } } }, n);
  return chips.sort((a, b) => Math.abs(a.matches / pool.length - 0.5) - Math.abs(b.matches / pool.length - 0.5)).slice(0, 6); // tasaisimmin jakavat ensin
}

/** Koko pyyntö → portin kutsut: search_products-argumentit riveittäin ja valmis request_quote-runko. */
export function toGateway(request, opts = {}) {
  const resolved = request.items.map((it) => resolveItem(it, opts));
  const needs = [];
  request.items.forEach((it, i) => {
    const r = resolved[i];
    if (!r.candidates.length || !it.quantity) return;
    needs.push({ ref: `need-${i + 1}`, candidates: r.candidates.map((c) => c.id), quantity: it.quantity, rank: opts.rank || 'price' });
  });
  return {
    resolved,
    requestQuote: needs.length ? { deliveryDate: request.deliveryDate || undefined, needs, maxOptions: 3 } : null,
    blocked: request.items.map((it, i) => (!it.quantity ? { item: i, code: 'QUANTITY_MISSING' } : !resolved[i].candidates.length ? { item: i, code: 'NO_MATCH' } : null)).filter(Boolean),
  };
}
