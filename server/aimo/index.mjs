// AIMO-MALLI: yksi sisäänkäynti. Vapaa teksti → tulkinta → ehdokkaat katalogista → portin kutsu valmiina.
//   import { interpret } from './aimo/index.mjs';
//   const r = await interpret('I need 1,000 litres of lactose-free milk by Monday');
// Vastauksen muoto on tehty näytettäväksi ilman keskustelua: lyhyt yhteenveto, tuotekortit, näkyvät oletukset ja
// tarkennusnapit (valmiita rakenteisia muutoksia). Avoimia kysymyksiä ei esitetä koskaan.
import { understand } from './understand.mjs';
import { toGateway } from './resolve.mjs';
import { interpretWithModel, warm, modelStats, domainCard } from './model.mjs';
import { loadLexicon } from './lexicon.mjs';
import { detectRecipe, expandRecipe } from './recipes.mjs';
import { learn } from './synonyms.mjs';
import { loadCatalog } from '../catalog.mjs';
import { quantityBasisFor } from '../itemQuantities.mjs';

export const LLM_THRESHOLD = 0.6;
// Sama teksti ei maksa toista mallikutsua: tulos (myös tyhjä) muistetaan prosessin ajan.
const modelMemo = new Map();
async function askModelOnce(text, now) {
  const key = text.trim().toLowerCase();
  if (modelMemo.has(key)) return modelMemo.get(key);
  const m = await interpretWithModel(text, now);
  if (modelMemo.size > 500) modelMemo.delete(modelMemo.keys().next().value);
  modelMemo.set(key, m);
  return m;
}
const UNIT_FI = { L: 'l', KG: 'kg', PCS: 'kpl' };
const CLAIM_FI = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu', MARINE_STEWARDSHIP_COUNCIL_LABEL: 'MSC', FAIR_TRADE_MARK: 'Reilu kauppa' };

function summarize(req, gw) {
  if (!req.items.length) return req.language === 'en' ? 'I could not find a product request in this message.' : 'En löytänyt viestistä tuotepyyntöä.';
  const parts = req.items.map((it, i) => {
    const q = it.quantity ? `${String(it.quantity.value).replace('.', ',')} ${UNIT_FI[it.quantity.unit]} ` : '';
    const extra = [...it.claims.map((c) => CLAIM_FI[c]), it.brand, it.countryOfOrigin === 'fi' ? 'kotimainen' : null].filter(Boolean).join(', ');
    return `${q}${it.productTerm}${extra ? ` (${extra})` : ''}: ${gw.resolved[i].total} sopivaa tuotetta`;
  });
  return `${parts.join(', ')}${req.deliveryDate ? `, toimitus ${req.deliveryDate}` : ''}`;
}

/** Reseptirivi osoittaa täsmälleen yhteen tuotteeseen: ehdokkaaksi kelpaa vain se, eikä portti saa täydentää korvaajalla. */
function pinRecipe(req, gw) {
  const cat = loadCatalog();
  const needs = [];
  req.items.forEach((it, i) => {
    const p = it.pinned.found ? cat.get(it.pinned.productId) : null;
    gw.resolved[i] = p
      ? { status: 'ok', total: 1, candidates: [{ id: p.id, name: p.name, brand: p.brand || null, unit: p.salesUnit, litres: p.litres ?? null, kg: p.kg ?? null, labels: p.labels || [] }], funnel: [{ filter: 'recipeProduct', remaining: 1 }], chips: [], search: { productId: p.id } }
      : { status: 'no_match', reason: { code: 'NO_MATCH', fi: `Reseptin tuotetta ${it.pinned.productId} ei ole Aimon valikoimassa. Koria ei tilata vajaana.`, en: `Recipe product ${it.pinned.productId} is not in the Aimo assortment. The cart is not ordered incomplete.` }, total: 0, candidates: [], funnel: [], chips: [], search: { productId: it.pinned.productId } };
    if (p) needs.push({ ref: `need-${i + 1}`, candidates: [p.id], quantity: it.quantity, rank: 'price', allowSubstitutes: false });
  });
  gw.blocked = req.items.map((it, i) => (gw.resolved[i].candidates.length ? null : { item: i, code: 'NO_MATCH' })).filter(Boolean);
  gw.requestQuote = needs.length && !gw.blocked.length ? { deliveryDate: req.deliveryDate || undefined, needs, maxOptions: 1 } : null;
}

/**
 * @param {string} text ostajan vapaa pyyntö
 * @param {{now?: Date, llm?: boolean, limit?: number}} [opts] llm: false pakottaa pelkät säännöt
 */
export async function interpret(text, opts = {}) {
  const t0 = performance.now();
  let req = understand(text, opts);
  let modelError = null;
  // Resepti: "lohikeitto 100 annosta perjantaiksi". Päivä ja kieli tulevat tavallisesta tulkinnasta, rivit reseptitaulukosta.
  // Kielimallia ei kutsuta: resepti joko tunnistetaan taulukosta tai pyyntö käsitellään tavallisena tuotepyyntönä.
  const rec = detectRecipe(text);
  let recipe = null;
  if (rec) {
    const base = { ...req, intent: 'order', unparsed: [], confidence: 1, via: 'aimo-rules', assumptions: req.assumptions.filter((a) => a.item == null && a.code !== 'UNKNOWN_WORD') };
    if (rec.problem) {
      return {
        understood: { ...base, items: [], assumptions: [] }, summary: rec.problem.fi, cards: [], recipe: { id: rec.recipe.id, name: rec.recipe.name, portions: rec.portions, problem: rec.problem },
        gateway: { search: [], requestQuote: null, blocked: [] }, handoff: rec.problem,
        trace: { via: 'aimo-rules', confidence: 1, llmCalls: 0, modelError: null, ms: +(performance.now() - t0).toFixed(2) },
      };
    }
    const ex = expandRecipe(rec.recipe, rec.portions);
    recipe = ex.info;
    req = { ...base, items: ex.items, assumptions: [...base.assumptions, { code: 'RECIPE_EXPANDED', fi: `Resepti ${recipe.name} × ${recipe.portions} annosta: määrät laskettu reseptistä, tuotteita ei korvata automaattisesti`, en: `Recipe ${recipe.name} × ${recipe.portions} portions: quantities calculated from the recipe, no automatic substitutes` }, ...(recipe.pantry.length ? [{ code: 'RECIPE_PANTRY', fi: `Ei tilata (oletetaan löytyvän keittiöstä): ${recipe.pantry.join(', ')}`, en: `Not ordered (assumed to be in the kitchen): ${recipe.pantry.join(', ')}` }] : [])] };
  }
  if (!recipe && req.confidence < LLM_THRESHOLD && opts.llm !== false) {
    try {
      const m = await askModelOnce(text, opts.now || new Date());
      // Oppiva muisti: sana, jota säännöt eivät tunteneet ja jonka malli tulkitsi yhdeksi sanaston sanaksi, tallennetaan.
      // Seuraavalla kerralla sama sana tunnistuu säännöillä ilman mallikutsua.
      if (m) for (const it of m.items) if (it.heard && req.unparsed.includes(it.heard) && !it.productTerm.includes(' ')) learn(it.heard, it.productTerm);
      if (m && m.items.length) req = { ...req, intent: m.intent === 'other' ? req.intent : m.intent, items: m.items, deliveryDate: m.deliveryDate || req.deliveryDate, unparsed: m.unparsed, assumptions: req.assumptions.filter((a) => a.item == null && a.code !== 'UNKNOWN_WORD'), confidence: m.unparsed.length ? 0.7 : 0.9, via: m.via, modelMs: m.modelMs };
    } catch (err) { modelError = String(err.message || err).slice(0, 160); }
  }
  // Tarkennusnapit: valmis rakenteinen muutos riville, ei uutta tekstiä eikä uutta tulkintaa.
  for (const { item, patch } of opts.patches || []) {
    const it = req.items[item];
    if (!it || !patch || typeof patch !== 'object') continue;
    if (Array.isArray(patch.claims)) it.claims = patch.claims.filter((c) => typeof c === 'string');
    if (typeof patch.brand === 'string') it.brand = patch.brand;
    if (patch.countryOfOrigin === 'fi') it.countryOfOrigin = 'fi';
    if (patch.attributes && typeof patch.attributes === 'object') it.attributes = { ...it.attributes, ...patch.attributes };
    const q = patch.quantity;
    if (!recipe && q && typeof q.value === 'number' && Number.isFinite(q.value) && q.value > 0 && q.value <= 100000 && ['L', 'KG', 'PCS'].includes(q.unit) && (q.basis == null || ['items', 'sales'].includes(q.basis))) {
      it.quantity = { value: q.value, unit: q.unit };
      if (q.unit === 'PCS') it.quantity.basis = quantityBasisFor({ ...it, quantity: q }, 'kpl');
      req.assumptions = req.assumptions.filter((a) => !(a.item === item && ['QUANTITY_MISSING', 'UNIT_ASSUMED', 'INDIVIDUAL_ITEMS'].includes(a.code)));
    }
    req.assumptions = req.assumptions.filter((a) => !(a.item === item && a.code === 'FAT_NOT_SPECIFIED' && it.attributes.fat));
  }
  const gw = toGateway(req, opts);
  if (recipe) pinRecipe(req, gw);
  const needsHuman = !req.items.length || req.confidence < LLM_THRESHOLD;
  return {
    understood: req,
    recipe: recipe || undefined,
    summary: recipe ? `${recipe.name} × ${recipe.portions} annosta: ${req.items.length} raaka-ainetta${gw.blocked.length ? `, ${gw.blocked.length} ei löydy valikoimasta` : ''}${req.deliveryDate ? `, toimitus ${req.deliveryDate}` : ''}` : summarize(req, gw),
    cards: gw.resolved.map((r, i) => ({ item: i, status: r.status, reason: r.reason, total: r.total, top: r.candidates.slice(0, 3), list: r.candidates.slice(0, Math.min(80, opts.limit || 40)), chips: r.chips, funnel: r.funnel })),
    gateway: { search: gw.resolved.map((r) => r.search), requestQuote: gw.requestQuote, blocked: gw.blocked },
    handoff: needsHuman ? { code: 'NEEDS_HUMAN', fi: 'Pyyntöä ei ymmärretty riittävän varmasti: ohjataan ihmiselle eikä arvata', en: 'Not understood with enough confidence: handed to a human instead of guessing' } : null,
    trace: { via: req.via, confidence: req.confidence, llmCalls: req.via === 'aimo-rules' ? 0 : 1, modelError, ms: +(performance.now() - t0).toFixed(2) },
  };
}

export { understand, toGateway, warm, modelStats, domainCard, loadLexicon };
