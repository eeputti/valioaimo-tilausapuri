// AIMON SANASTO, LOUHITTU AIMON OMASTA DATASTA.
// Challenge-datassa kategorioilla on vain koodit (349 kpl), ei nimiä, eikä tuotetyyppejä ole lueteltu missään.
// Tämä moduuli rakentaa käynnistyksessä tuotekatalogista (17 546 tuotetta) sanaston, jolla vapaa teksti
// kiinnitetään Aimon omiin käsitteisiin: sana → kategoriajakauma, kategorialle luettava nimi, merkit, pakkauskoot.
// Mitään ei ole kirjoitettu käsin tuotekohtaisesti, joten sanasto pysyy ajan tasalla, kun katalogi päivittyy.
import { loadCatalog, tokenize, stems } from '../catalog.mjs';

// Sanat, jotka kuvaavat ominaisuutta eivätkä tuotetta. Ne käsitellään väittäminä tai attribuutteina, ei tuotetyyppinä.
const NOT_A_PRODUCT = /^(pakaste\w*|kypsä\w*|laktoosi\w*|gluteeni\w*|luomu\w*|vegaani\w*|suomi|suomesta|suomalainen|kotimainen|uht|esl|kpl|ltk|pkt|noin|iso|pieni|mini|maxi|original|classic|frozen|free|lactose|gluten|organic|with|and|the|for|pcs|box|bag|finland|finnish|vähälaktoosinen|approx|apx|new|uusi|kausituote|seasonal|rasvaton|kevyt|vähärasvainen|skimmed|semi|light|pro|professional|food|service)$/;

// Taivutusmuodot: katalogin kevyt stemmaus + muutama suomen vartalonvaihtelu, joita se ei kata.
// -mi- ja -ni-sanojen partitiivi ja genetiivi: liemi → lientä/liemen, sieni → sientä (katselmus 15.11. #17: "kasvilientä").
const EXTRA = [[/ia$/, 'a'], [/iä$/, 'ä'], [/ia$/, 'i'], [/iä$/, 'i'], [/hta$/, 'hi'], [/ttä$/, 'si'], [/tta$/, 'si'], [/kkeja$/, 'ke'], [/ies$/, 'y'], [/oes$/, 'o'],
  [/ntä$/, 'mi'], [/nta$/, 'mi'], [/ntä$/, 'ni'], [/nta$/, 'ni'], [/men$/, 'mi']];
export function variants(token) {
  const out = new Set(stems(token));
  for (const [re, rep] of EXTRA) if (re.test(token)) out.add(token.replace(re, rep));
  return [...out].filter((v) => v.length >= 3);
}

let built;

/** @returns {{concepts: Map, categories: Map, brands: Map, brandMaxWords: number, stats: object}} */
export function loadLexicon() {
  if (built) return built;
  const t0 = performance.now();
  const cat = loadCatalog();
  const products = cat.products;

  // 1) Merkit: "santa maria" → {name: 'Santa Maria', n}
  const brands = new Map();
  const brandTokens = new Set();
  for (const p of products) {
    if (!p.brand) continue;
    const toks = tokenize(p.brand);
    if (!toks.length) continue;
    const key = toks.join(' ');
    const b = brands.get(key) || { name: p.brand.trim(), n: 0, key };
    b.n += 1;
    brands.set(key, b);
    toks.forEach((t) => brandTokens.add(t));
  }
  for (const [key, b] of brands) if (b.n < 2) brands.delete(key); // yksittäiset kirjoitusasut pois
  const brandMaxWords = Math.max(...[...brands.keys()].map((k) => k.split(' ').length));

  // 2) Tuotesanat nimistä. Suomen yhdyssanat: "kevytmaitojuoma" lasketaan myös sanoille "maitojuoma" ja "juoma",
  //    jos ne esiintyvät datassa itsenäisinä sanoina. Englanniksi "ice cream" on eri asia kuin "cream".
  const wordsOf = (p, lang) => {
    let toks = tokenize(lang === 'en' ? p.nameEn || '' : p.name);
    if (lang === 'en') { const out = []; for (let i = 0; i < toks.length; i++) { if (toks[i] === 'ice' && toks[i + 1] === 'cream') { out.push('icecream'); i += 1; } else out.push(toks[i]); } toks = out; }
    const own = new Set(tokenize(p.brand || '')); // vain tuotteen oma merkki pois: "Nordic Sugar" ei saa hävittää sanaa "sugar" muilta
    return toks.filter((t) => t.length >= 3 && !/\d/.test(t) && !own.has(t) && !NOT_A_PRODUCT.test(t));
  };
  const standalone = new Map(); // sana → montako tuotetta
  const perProduct = products.map((p) => {
    const fi = new Set(wordsOf(p, 'fi'));
    const en = new Set(wordsOf(p, 'en'));
    for (const w of fi) standalone.set(w, (standalone.get(w) || 0) + 1);
    for (const w of en) if (!fi.has(w)) standalone.set(w, (standalone.get(w) || 0) + 1);
    return { fi, en };
  });
  const concepts = new Map(); // sana → {total, cats: Map(cat → n)}
  // Sama laskenta vain kokonaisista sanoista. "tilli" on yrtti; "pas|tilli" ei saa viedä sanaa makeishyllylle.
  const whole = new Map();
  const bumpWhole = (w, c) => { let e = whole.get(w); if (!e) whole.set(w, (e = { total: 0, cats: new Map() })); e.total += 1; e.cats.set(c, (e.cats.get(c) || 0) + 1); };
  const bump = (w, c) => { let e = concepts.get(w); if (!e) concepts.set(w, (e = { total: 0, cats: new Map() })); e.total += 1; e.cats.set(c, (e.cats.get(c) || 0) + 1); };
  products.forEach((p, i) => {
    const seen = new Set();
    for (const w of perProduct[i].fi) {
      seen.add(w);
      for (let k = 1; k <= w.length - 3; k++) { const tail = w.slice(k); if ((standalone.get(tail) || 0) >= 2) seen.add(tail); } // yhdyssanan loppuosa
    }
    for (const w of perProduct[i].en) seen.add(w);
    for (const w of seen) bump(w, p.category);
    for (const w of new Set([...perProduct[i].fi, ...perProduct[i].en])) bumpWhole(w, p.category);
  });
  for (const [w, e] of concepts) if (e.total < 2) concepts.delete(w);
  // Jos sanan yleisin hylly syntyy pelkistä yhdyssanojen loppuosista eikä sana esiinny siellä kertaakaan itsenäisenä,
  // hylly otetaan itsenäisistä osumista. Muuten laskenta pysyy ennallaan (kevyt|maito kuuluu yhä maidolle).
  const topOf = (e) => [...e.cats].sort((a, b) => b[1] - a[1])[0][0];
  for (const [w, e] of whole) {
    const c = concepts.get(w);
    if (c && e.total >= 2 && !e.cats.has(topOf(c))) concepts.set(w, e);
  }

  // 3) Kategorialle luettava nimi: sana, joka kattaa kategoriasta eniten ja keskittyy siihen.
  const sizes = new Map();
  for (const p of products) sizes.set(p.category, (sizes.get(p.category) || 0) + 1);
  const best = new Map(); // cat → [{w, n, share}]
  for (const [w, e] of concepts) {
    for (const [c, n] of e.cats) {
      const share = n / e.total;
      if (n < 3 || share < 0.3) continue;
      let list = best.get(c); if (!list) best.set(c, (list = []));
      list.push({ w, n, share, score: n * share });
    }
  }
  const categories = new Map();
  for (const [c, size] of sizes) {
    const words = (best.get(c) || []).sort((a, b) => b.score - a.score).slice(0, 6);
    categories.set(c, { id: c, size, label: words.slice(0, 2).map((x) => x.w).join(', ') || `kategoria ${c}`, words: words.map((x) => x.w) });
  }

  built = { concepts, whole, categories, brands, brandMaxWords, stats: { products: products.length, concepts: concepts.size, categories: categories.size, brands: brands.size, ms: Math.round(performance.now() - t0) } };
  return built;
}

const shape = (word, e, categories) => ({ word, total: e.total, top: [...e.cats].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([category, n]) => ({ category, label: categories.get(category)?.label, n, share: +(n / e.total).toFixed(2) })) });

/**
 * Sana (missä tahansa suomen taivutusmuodossa tai englanniksi) → Aimon kategoriat, todennäköisin ensin.
 * @returns {{word: string, total: number, top: {category: string, label: string, n: number, share: number}[]} | null}
 */
export function conceptOf(token) {
  const { concepts, categories } = loadLexicon();
  let hit = null;
  for (const v of variants(token)) { // "maitoa" → "maito", "voita" → "voi", "kananmunia" → "kananmuna", "eggs" → "egg"
    const e = concepts.get(v);
    if (e && (!hit || e.total > hit.e.total)) hit = { word: v, e };
  }
  return hit ? shape(hit.word, hit.e, categories) : null;
}

// ---------- Puhekieli, astevaihtelu ja kirjoitusvirheet ----------
// Jokainen ehdokas hyväksytään vain, jos se löytyy Aimon sanastosta. Säännöt saavat siis tuottaa myös vääriä muotoja:
// sanasto karsii ne. Mitään tuotetta tai sanaa ei synny tyhjästä.
const WEAK_TO_STRONG = { ng: 'nk', mm: 'mp', nn: 'nt', ll: 'lt', rr: 'rt', d: 't', v: 'p', k: 'kk', p: 'pp', t: 'tt' };
/** Heikko aste takaisin vahvaksi: maido → maito, jogurti → jogurtti, leivä → leipä, mustika → mustikka. */
function strengthen(stem) {
  const m = stem.match(/^(.*?)(ng|mm|nn|ll|rr|d|v|k|p|t)([aeiouyäö]+)$/);
  if (!m || (m[2].length === 1 && m[1].endsWith(m[2]))) return [];
  return [m[1] + WEAK_TO_STRONG[m[2]] + m[3]];
}
/** Puhekielen ja taivutuksen muodot, joita kevyt stemmaus ei kata: maitoo, lohee, kananmunii, perunoit, maidon, jogurtit. */
export function spoken(token) {
  const out = new Set();
  const add = (v) => { if (v.length >= 3 && v !== token) out.add(v); };
  const bases = new Set([token, ...stems(token)]);
  for (const b of bases) {
    const m = b.match(/^(.+?)([aeiouyäö])\2$/); // pitkä loppuvokaali: maitoo → maito
    if (m) {
      add(m[1] + m[2]);
      if (m[2] === 'e') add(`${m[1]}i`); // lohee → lohi
      if (m[2] === 'i') { add(`${m[1]}a`); add(`${m[1]}ä`); } // kananmunii → kananmuna
    }
    if (/[oö]it$/.test(b)) { add(b.replace(/oit$/, 'a')); add(b.replace(/öit$/, 'ä')); } // perunoit → peruna
    if (/ei$/.test(b)) add(b.replace(/ei$/, 'i')); // tomaattei → tomaatti
  }
  for (const b of [...bases, ...out]) for (const v of strengthen(b)) add(v);
  return [...out];
}

/** Damerau–Levenshtein (vierekkäisten kirjainten vaihto on yksi virhe). Palauttaa max + 1, jos raja ylittyy. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null; let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

const recognized = new Map();
/**
 * Tunnistaa sanan, jota sanasto ei löydä sellaisenaan. Tasot järjestyksessä, ensimmäinen osuma voittaa:
 *  exact  = tavallinen taivutus (conceptOf)
 *  spoken = puhekielen muoto tai astevaihtelu (maitoo, maidon)
 *  tail   = sana elää vain yhdyssanojen loppuosana (jauho: vehnäjauho, ruisjauho)
 *  fuzzy  = kirjoitusvirhe, enintään 1 merkin ero (2, kun sana on vähintään 8 merkkiä): maetoo, jugurtti
 * @returns {{word: string, concept: object, via: 'exact'|'spoken'|'tail'|'fuzzy', distance?: number} | null}
 */
export function recognize(token) {
  if (recognized.has(token)) return recognized.get(token);
  const lex = loadLexicon();
  const { concepts, categories, whole } = lex;
  const done = (r) => { recognized.set(token, r); return r; };
  const exact = conceptOf(token);
  if (exact) return done({ word: exact.word, concept: exact, via: 'exact' });
  if (token.length < 4 || /\d/.test(token)) return done(null);

  const forms = spoken(token);
  let best = null;
  for (const v of forms) { const e = concepts.get(v); if (e && (!best || e.total > best.e.total)) best = { v, e }; }
  if (best) return done({ word: best.v, concept: shape(best.v, best.e, categories), via: 'spoken' });

  // Yhdyssanan loppuosa: "jauho" ja "muro" eivät ole yksinään minkään tuotteen nimessä tarpeeksi usein.
  for (const base of [token, ...forms, ...stems(token)].filter((v) => v.length >= 4)) {
    const e = { total: 0, cats: new Map() };
    for (const [w, x] of whole) if (w.length > base.length && (w.endsWith(base) || w.endsWith(`${base}t`))) { e.total += x.total; for (const [c, n] of x.cats) e.cats.set(c, (e.cats.get(c) || 0) + n); }
    if (e.total >= 3) { concepts.set(base, e); return done({ word: base, concept: shape(base, e, categories), via: 'tail' }); }
  }

  // Kirjoitusvirhe: lähin sanaston sana. Ensimmäisen kirjaimen pitää täsmätä, ja ehdokkaan pitää olla oikea tuotesana
  // (vähintään 3 tuotetta), jotta harvinainen sana ei kaappaa virhettä.
  lex.fuzzyKeys ||= [...concepts].filter(([w, e]) => w.length >= 4 && e.total >= 3 && !/\d/.test(w)).map(([w, e]) => [w, e.total]);
  // Myös taivutuksen perusmuoto (variants): "kasvilientä" → "kasviliemi" → kasvisliemi. Ilman sitä loppuosa "ilien"
  // (tekst|iilien) kaappasi sanan ja haku antoi tekstiilien huuhteluaineita (katselmus 15.11. #17).
  const tries = [...new Set([token, ...forms, ...stems(token), ...variants(token)])].filter((v) => v.length >= 4);
  let hit = null;
  for (const form of tries) {
    const max = form.length >= 8 ? 2 : 1;
    for (const [w, total] of lex.fuzzyKeys) {
      if (w[0] !== form[0]) continue;
      const d = editDistance(form, w, max);
      if (d > max) continue;
      const better = !hit || d < hit.d || (d === hit.d && (form === token) > hit.own) || (d === hit.d && (form === token) === hit.own && total > hit.total);
      if (better) hit = { w, d, total, own: form === token };
    }
  }
  if (hit) return done({ word: hit.w, concept: shape(hit.w, concepts.get(hit.w), categories), via: 'fuzzy', distance: hit.d });
  return done(null);
}

/** Pisin merkkiosuma sanajonon alusta. @returns {{name: string, key: string, words: number} | null} */
export function brandAt(tokens, i) {
  const { brands, brandMaxWords } = loadLexicon();
  for (let len = Math.min(brandMaxWords, tokens.length - i); len >= 1; len--) {
    const b = brands.get(tokens.slice(i, i + len).join(' '));
    if (b && (len > 1 || b.n >= 5)) return { name: b.name, key: b.key, words: len };
  }
  return null;
}
