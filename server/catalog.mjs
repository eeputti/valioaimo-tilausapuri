// Tuotekatalogi muistissa + suomenkielinen haku. Tämä on "hakuagentti": pelkkä funktio, vastaa millisekunneissa eikä hallusinoi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Katalogin polun voi vaihtaa AIMO_CATALOG-asetuksella (testit, pilvi). Oletuksena repon oma data-kansio.
const DEFAULT_CATALOG_FILE = path.join(ROOT, 'data', 'catalog.json');
const CATALOG_FILE = process.env.AIMO_CATALOG || DEFAULT_CATALOG_FILE;

// Näyttölyhenteet on päätelty toimitustukun verkkokaupasta; challenge-datassa on vain tekniset koodit.
export const UNIT_LABEL = { KI: 'ltk', ST: 'kpl', KG: 'kg', PAK: 'pkt', BAG: 'pss', RAS: 'ras', PRK: 'prk', BOT: 'pl', SK: 'sk', CS: 'ltk', KLE: 'kää', KRT: 'krt', KAN: 'kan', PAL: 'lava', NIP: 'nippu' };
// GS1-allergeenikoodit (standardi). Tuntematon koodi näytetään sellaisenaan.
export const ALLERGEN_LABEL = { AC: 'äyriäiset', AE: 'kananmuna', AF: 'kala', AM: 'maito', AN: 'pähkinät', AP: 'maapähkinä', AS: 'seesami', AU: 'sulfiitit', AW: 'gluteeniviljat', AY: 'soija', BC: 'selleri', BM: 'sinappi', NL: 'lupiini', UM: 'nilviäiset', UW: 'vehnä', GB: 'ohra', GO: 'kaura', GK: 'kamut', GS: 'speltti', NR: 'ruis', ML: 'laktoosi', SA: 'manteli', SC: 'cashew', SH: 'hasselpähkinä', SM: 'macadamia', SP: 'pekaani', SQ: 'queenslandinpähkinä', SR: 'parapähkinä', ST: 'pistaasi', SW: 'saksanpähkinä' };
export const TEMP_LABEL = { ambient: 'Kuiva', chilled: 'Kylmä', frozen: 'Pakaste' };
export const allergenName = (code) => ALLERGEN_LABEL[code] || code;
export const unitLabel = (u) => UNIT_LABEL[u] || (u || '').toLowerCase();

const STOP = new Set(['ja', 'tai', 'sekä', 'että', 'myös', 'vielä', 'kanssa', 'ilman', 'the', 'kpl', 'ltk', 'kg', 'pss', 'pkt', 'prk', 'ras', 'pl', 'g', 'l', 'dl', 'ml', 'x', 'n', 'noin']);
const SUFFIXES = ['ies', 'es', 's', 'issa', 'issä', 'ista', 'istä', 'illa', 'illä', 'ilta', 'iltä', 'ille', 'ssa', 'ssä', 'sta', 'stä', 'lla', 'llä', 'lta', 'ltä', 'lle', 'ksi', 'tta', 'ttä', 'ita', 'itä', 'oja', 'öjä', 'eja', 'ejä', 'ja', 'jä', 'ta', 'tä', 'aa', 'ää', 'ia', 'iä', 'an', 'än', 'en', 'in', 'n', 'a', 'ä', 't', 'i'];

export const normalize = (s) => (s || '').toLowerCase().replace(/[®™]/g, '').replace(/[^a-z0-9åäöé%]+/g, ' ').trim();
export const tokenize = (s) => normalize(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+([.,]\d+)?$/.test(t));

// Kevyt suomen "stemmaus": kokeillaan sijapäätteen pudottamista. Ei kielitiedettä, mutta riittää tuotenimiin.
const REWRITES = [[/oita$/, 'a'], [/öitä$/, 'ä'], [/eita$/, 'e'], [/eitä$/, 'e'], [/uja$/, 'u'], [/yjä$/, 'y'], [/eja$/, 'i'], [/ejä$/, 'i'], [/ien$/, 'i'], [/den$/, ''], [/kkeita$/, 'ke'], [/kset$/, 's'], [/ksia$/, 's']];
export function stems(token) {
  const out = [token];
  for (const [re, rep] of REWRITES) if (re.test(token) && token.length >= 6) out.push(token.replace(re, rep)); // perunoita → peruna
  for (const suf of SUFFIXES) {
    if (token.length - suf.length >= 3 && token.endsWith(suf)) out.push(token.slice(0, -suf.length));
  }
  return [...new Set(out)];
}

// Osuman laji. Haettu sana voi olla tuote itse (maito, kevytmaito), saman pääsanan toinen tuote (kahvimaito, kookosmaito)
// tai vain määrite toisen tuotteen nimessä (maitosuklaa, maitokahvijuoma). Laji ratkaisee, mikä nousee kärkeen.
const CORE = 0; const VARIANT = 1; const RELATED = 2;
export const MATCH_KIND = ['core', 'variant', 'related'];
// Etuliitteet, jotka eivät muuta tuotetta toiseksi: kevytmaito ja täysmaito ovat maitoa, kahvimaito ei.
const NEUTRAL_PREFIX = new Set(['kevyt', 'täys', 'ykkös', 'luomu', 'tuore', 'tila', 'perus']);
// Sama tuote toisella myyntinimellä: laktoositon maito on nimeltään "maitojuoma" tai "kevytmaitojuoma".
const ALIASES = [[/^(.*maito)juoma$/, '$1'], [/^milkdrink$/, 'milk']];
const VARIANT_PENALTY = 0.2; // saman pääsanan toinen tuote jää perustuotteen alle, mutta määriteosuman yläpuolelle
const HOME_BOOST = 0.1; // tuoteryhmä, johon haun vahvat osumat keskittyvät
const NO_MATCH = [0, RELATED];

/** @returns {[number, number]} [pisteet 0–1, laji] */
function matchScore(productToken, stem, original) {
  const quality = Math.max(0.55, stem.length / original.length);
  if (productToken === stem) return [1.0 * quality, CORE];
  if (stem.length < 3) return NO_MATCH;
  if (productToken.endsWith(stem)) { // yhdyssanan pääosa: kuohu|kerma
    return NEUTRAL_PREFIX.has(productToken.slice(0, -stem.length)) ? [0.97 * quality, CORE] : [0.86 * quality, VARIANT];
  }
  if (productToken.startsWith(stem)) return productToken.length - stem.length <= 3 ? [0.8 * quality, CORE] : [0.5 * quality, RELATED]; // taivutus vs. määriteosa: kerma|viili
  if (stem.length >= 4 && productToken.includes(stem)) return [0.35 * quality, RELATED];
  return NO_MATCH;
}

const LABEL_WORDS = [
  [/^laktoosit/, (p) => p.labels?.includes('FREE_FROM_LACTOSE')],
  [/^gluteenit/, (p) => p.labels?.includes('FREE_FROM_GLUTEN')],
  [/^vegaani|^vegan$/, (p) => p.labels?.includes('VEGAN')],
  [/^luomu|^organic$/, (p) => p.labels?.includes('EU_ORGANIC_FARMING')],
  [/^kotima/, (p) => p.country === 'fi'],
  [/^pakaste/, (p) => p.temp === 'frozen'],
];

// Lavan (PAL) koko puuttuu lähdedatasta: myyntiyksikössä on yksi perusyksikkö, joten paino on yhden pakkauksen paino.
// "325 x Dansukker Suomalainen Taloussokeri 1kg" on 325 kg:n lava, ei kilon pussi (itsepeli X096: 3 kg:n tarpeelle tarjottiin
// "3 lava (3 kg)"). Koko on nimen kappalemäärä kertaa pakkauksen koko. Ilman kappalemäärää lavan kokoa ei tiedetä.
function palletSize(p) {
  if (p.salesUnit !== 'PAL' || p.perSales > 1 || p._pallet) return;
  const n = Number((String(p.name || '').match(/^\s*(\d+)\s*[x×*]/i) || [])[1]);
  p._pallet = n > 1 ? n : 'unknown';
  if (n > 1) { if (p.kg) p.kg = +(p.kg * n).toFixed(3); if (p.litres) p.litres = +(p.litres * n).toFixed(3); return; }
  p.kg = null; p.litres = null;
}

// Laatikon paino on lähdedatassa joskus yhden pienen osan paino: "Valio voi 4x5 kg HYLA" KI/4 kg 0,08, jolloin 500 kg voita
// näytettiin "25 laatikkoa à 0,08 kg, yhteensä 2 kg, 3 635 €" (WhatsApp-koe 17.11.). Kun nimen kappalemäärä on sama kuin
// laatikon kappalemäärä (perSales), laatikon koko on kappalemäärä kertaa nimen koko. Muuten tietoa ei muuteta.
const MULTIPACK = /(?<![\d,.])(\d+)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)(?![\p{L}])/iu;
const PER_UNIT = { kg: 1, g: 0.001, l: 1, dl: 0.1, cl: 0.01, ml: 0.001 };
export function boxSize(p) {
  if (!['KI', 'CS'].includes(p.salesUnit) || !(p.perSales > 1) || p._boxSize) return;
  const m = MULTIPACK.exec(String(p.name || ''));
  if (!m || Number(m[1]) !== p.perSales) return;
  const unit = m[3].toLowerCase();
  const total = +(Number(m[1]) * Number(m[2].replace(',', '.')) * PER_UNIT[unit]).toFixed(3);
  const key = unit === 'kg' || unit === 'g' ? 'kg' : 'litres';
  if (!(total > 0) || !(p[key] > 0) || p[key] * 5 >= total) return;
  p._boxSize = { [key]: p[key] };
  p[key] = total;
}

export class Catalog {
  constructor(products) {
    products.forEach(palletSize);
    products.forEach(boxSize);
    this.products = products;
    this.byId = new Map(products.map((p) => [p.id, p]));
    this.vocab = new Map(); // token -> [index, position]
    this.fiDocs = new Map(); // suomenkielisen nimen sana -> tuoteindeksit (vain sanaston suomennosta varten)
    this.enDocs = new Map(); // englanninkielisen nimen sana -> tuoteindeksit
    this.translations = new Map();
    const note = (map, t, i) => { let list = map.get(t); if (!list) map.set(t, (list = [])); if (list.at(-1) !== i) list.push(i); };
    products.forEach((p, i) => {
      p._tokens = tokenize(`${p.name} ${p.brand || ''}`);
      p._nameLen = p._tokens.length;
      const add = (t, pos) => { let list = this.vocab.get(t); if (!list) this.vocab.set(t, (list = [])); list.push(i, pos); };
      p._tokens.forEach((t, pos) => {
        add(t, pos);
        note(this.fiDocs, t, i);
        for (const [re, to] of ALIASES) if (re.test(t)) add(t.replace(re, to), pos);
      });
      // Englanninkielinen nimi samaan indeksiin: ostoagentti voi kysyä kummalla kielellä tahansa.
      if (p.nameEn) tokenize(p.nameEn).forEach((t, pos) => {
        note(this.enDocs, t, i);
        if (!p._tokens.includes(t)) add(t, pos);
        for (const [re, to] of ALIASES) if (re.test(t)) add(t.replace(re, to), pos);
      });
    });
    this.vocabKeys = [...this.vocab.keys()];
    this.fiKeys = [...this.fiDocs.keys()];
  }

  get(id) { return this.byId.get(String(id)); }

  /**
   * Englanninkielisen hakusanan suomennos katalogin omista kaksikielisistä nimistä ("milk" → "maito").
   * Suomennos valitaan sanaksi, joka esiintyy niiden tuotteiden suomenkielisissä nimissä, joiden englanninkielisessä
   * nimessä hakusana on, eikä juuri muualla. Epävarmaa tulosta ei käytetä ("cream" on sekä kermaa että jäätelöä):
   * silloin palautetaan null ja haku jatkuu englanninkielisillä nimillä kuten ennenkin.
   */
  translate(term) {
    if (this.translations.has(term)) return this.translations.get(term);
    const union = (map, keys) => { const s = new Set(); for (const k of keys) for (const i of map.get(k) || []) s.add(i); return s; };
    const variants = stems(term).filter((v) => v.length >= 3);
    const docs = union(this.enDocs, variants);
    let best = null;
    // Vain selvästi englanninkielinen sana: "pasta" tai "valio" esiintyy molemmissa nimissä eikä tarvitse suomennosta.
    if (docs.size >= 3 && docs.size >= 3 * union(this.fiDocs, variants).size) {
      const df = new Map();
      for (const i of docs) for (const t of new Set(this.products[i]._tokens)) df.set(t, (df.get(t) || 0) + 1);
      const frequent = [...df].filter(([t]) => t.length >= 3).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
      const candidates = new Set(frequent);
      // Yleisimpien sanojen loppuosat ovat yhdyssanan pääsanoja: kevytmaito → maito.
      for (const c of frequent) for (let k = 1; k <= c.length - 3; k++) if (this.fiDocs.has(c.slice(k))) candidates.add(c.slice(k));
      for (const c of candidates) {
        const hit = new Set();
        for (const key of this.fiKeys) if (key.includes(c)) for (const i of this.fiDocs.get(key)) hit.add(i);
        let both = 0;
        for (const i of hit) if (docs.has(i)) both += 1;
        const cover = both / docs.size; const precision = both / hit.size;
        const f = cover + precision ? (2 * cover * precision) / (cover + precision) : 0;
        if (cover >= 0.6 && precision >= 0.6 && (!best || f > best.f)) best = { term: c, f };
      }
    }
    const out = best ? best.term : null;
    this.translations.set(term, out);
    return out;
  }

  /**
   * Palauttaa [{product, score, match}] parhaat ensin. opts: {limit, temp, filter(p), boost(p)}
   * match: 'core' = haettu tuote itse, 'variant' = saman pääsanan toinen tuote tai sama sana toisessa tuoteryhmässä,
   * 'related' = sana on vain määritteenä. exact = jokainen hakusana on nimessä kokonaisena sanana.
   * Tulostaulukon translated-kenttä kertoo käytetyt suomennokset.
   */
  search(query, opts = {}) {
    const limit = opts.limit ?? 8;
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const labelFilters = [];
    const terms = [];
    const translated = {};
    for (const t of qTokens) {
      const lf = LABEL_WORDS.find(([re]) => re.test(t));
      if (lf) labelFilters.push(lf[1]);
      const fi = lf ? null : this.translate(t);
      if (fi && fi !== t) translated[t] = fi;
      terms.push(fi || t);
    }
    const perTerm = terms.map((term) => {
      const best = new Map(); // productIndex -> score
      const kinds = new Map(); // productIndex -> osuman laji
      const exact = new Set(); // productIndex, jonka nimessä hakusana on kokonaisena sanana (ei "pas|tilli")
      const variants = stems(term);
      for (const tok of this.vocabKeys) {
        let s = 0; let kind = RELATED;
        for (const st of variants) { const [m, k] = matchScore(tok, st, term); if (m > s) { s = m; kind = k; } }
        if (s <= 0) continue;
        const postings = this.vocab.get(tok);
        const whole = variants.includes(tok);
        for (let k = 0; k < postings.length; k += 2) {
          const idx = postings[k];
          if (whole) exact.add(idx);
          const pos = postings[k + 1];
          const withPos = s * (1 - Math.min(pos, 6) * 0.03); // nimen alussa oleva sana painaa enemmän
          if ((best.get(idx) || 0) < withPos) { best.set(idx, withPos); kinds.set(idx, kind); }
        }
      }
      return { best, kinds, exact };
    });

    const combine = (requireAll) => {
      const totals = new Map();
      perTerm.forEach(({ best }) => best.forEach((s, idx) => totals.set(idx, (totals.get(idx) || 0) + s)));
      const candidates = [];
      for (const [idx, sum] of totals) {
        const matched = perTerm.filter(({ best }) => best.has(idx)).length;
        if (requireAll && matched < perTerm.length) continue;
        const p = this.products[idx];
        if (opts.temp && p.temp !== opts.temp) continue;
        if (opts.filter && !opts.filter(p)) continue;
        if (labelFilters.length && !labelFilters.every((f) => f(p))) {
          // sana voi olla myös nimessä ("laktoositon"), joten ei pudoteta jos termi osui nimeen täysillä
          if (matched < perTerm.length) continue;
        }
        let kind = CORE; // heikoin laji ratkaisee: "laktoositon kahvimaito" on kahvimaitoa
        for (const { kinds } of perTerm) { const k = kinds.get(idx); if (k !== undefined && k > kind) kind = k; }
        candidates.push({ p, base: sum / perTerm.length, kind, exact: perTerm.every(({ exact }) => exact.has(idx)) });
      }
      // Kotiryhmä: tuoteryhmä, johon vahvat osumat keskittyvät. "Maito" on maitohyllyn tuote, ei kondensoitua maitoa säilykkeissä.
      const mass = new Map(); let total = 0;
      for (const c of candidates) if (c.kind !== RELATED) { const w = c.kind === CORE ? 1 : 0.5; mass.set(c.p.category, (mass.get(c.p.category) || 0) + w); total += w; }
      let home = null;
      if (total >= 3) { const [category, weight] = [...mass].sort((a, b) => b[1] - a[1])[0]; if (weight / total >= 0.4) home = category; }
      const res = candidates.map(({ p, base, kind, exact }) => {
        const atHome = !home || p.category === home;
        let score = base;
        if (kind === VARIANT || (kind === CORE && !atHome)) score -= VARIANT_PENALTY; // sama sana toisessa tuoteryhmässä (kermanvärinen lautasliina) ei ole perustuote
        if (home && atHome) score += HOME_BOOST;
        if (p.reliability != null) score += 0.08; // toimitusvarmuusdata = tuotetta on oikeasti tilattu
        score += Math.max(0, 0.06 - p._nameLen * 0.006); // lyhyt nimi = perustuote
        if (opts.boost) score += opts.boost(p) || 0;
        return { product: p, score, match: MATCH_KIND[kind === CORE && !atHome ? VARIANT : kind], exact };
      });
      return res.sort((a, b) => b.score - a.score);
    };
    let res = combine(true);
    if (!res.length && perTerm.length > 1) res = combine(false);
    res = res.slice(0, limit);
    if (Object.keys(translated).length) res.translated = translated;
    return res;
  }
}

let singleton;
export function loadCatalog() {
  if (singleton) return singleton;
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error('data/catalog.json puuttuu. Aja ensin: npm run catalog');
  }
  const t0 = performance.now();
  singleton = new Catalog(JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')));
  singleton.loadMs = Math.round(performance.now() - t0);
  return singleton;
}

/** Julkinen, tiivis tuotekuvaus UI:lle ja agenteille (ei sisäisiä kenttiä). */
export function publicProduct(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.name, brand: p.brand, vendor: p.vendor, category: p.category,
    unit: p.salesUnit, unitLabel: unitLabel(p.salesUnit), temp: p.temp, country: p.country,
    contains: p.contains, mayContain: p.mayContain || [], hasAllergenData: !!p.hasAllergenData, labels: p.labels || [],
    kg: p.kg, litres: p.litres, reliability: p.reliability, co2: p.co2, lot: p.lot, step: stepOf(p),
  };
}

/** Käytännön askel määrälle. Data sallii 0,01:n kerrannaiset, mutta kappaleita ei tilata sadasosina. */
export function stepOf(p) {
  if (p.lot >= 1) return p.lot;
  return p.salesUnit === 'KG' ? 0.5 : 1;
}

export function roundToStep(qty, p, mode = 'nearest') {
  const step = stepOf(p);
  const f = mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round;
  const v = f(qty / step - (mode === 'up' ? 1e-9 : 0)) * step;
  return Math.max(0, +v.toFixed(2));
}
