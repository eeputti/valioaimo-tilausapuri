// Tilausapuri v2: vartija (docs/agent-v2.md, kohta "Vartija"). Ainoa koodin tarkistus mallin tekstille:
// 1) jokaisen vastauksessa mainitun euromäärän pitää löytyä tämän vuoron työkalutuloksista tai korista (±0,01 €),
// 2) mallin tekstissä ei saa olla linkkejä, verkko-osoitteita eikä sähköpostiosoitteita (korilinkin lisää koodi).
// Määrä-arvioita ("50 hengelle noin 10 kg") ei tarkisteta, koska ne ovat ehdotuksia. Tekstiä ei muotoilla säännöillä.

// Luku: tuhaterottimena välilyönti tai piste ja desimaalipilkku ("1 234,50", "1.234,50"), englantilainen ("1,234.50") tai pelkkä
// luku enintään kolmella desimaalilla ("0,125"). Tulkinta: parseAmount.
const SPACE = String.raw`[ \u00a0\u202f]`;
const NUM = String.raw`\d{1,3}(?:(?:${SPACE}|\.)\d{3})+(?:,\d{1,3})?|\d{1,3}(?:,\d{3})+\.\d{1,3}|\d+(?:[.,]\d{1,3})?`;
// Euro kaikissa sijamuodoissa ("20 eurolla", "45 euroon", "100 eurosta", "15 euroksi"), € ja pelkkä "e" ("12,50 e").
// "Eurooppa" ja "e-luokka" eivät ole euroja.
const EURO_WORD = String.raw`(?:€|e(?=[\s.,!?;:)]|$)|eur(?:o(?:a|n|o|on|oo|ot|lla|lta|lle|ssa|sta|ksi|ja|jen|ihin|issa|ista|illa|ilta|ille|iksi|ina|in)?)?(?![\p{L}]))`;
// "12,50 €", "10–12 €" (molemmat päät), "50 snt" ja "50 senttiä" (sentteinä), "€ 12,50", "€12.50" ja "EUR 12". Merkki luvun
// edessä vain, kun sen edessä ei ole lukua, jotta "12,50 € 3 kg:n säkki" ei tulkitse kolmea kiloa euroiksi.
const AMOUNT_AFTER = new RegExp(String.raw`(?<![\d.,])(${NUM})(?:\s*[–—-]\s*(${NUM}))?\s*${EURO_WORD}`, 'giu');
const CENTS = new RegExp(String.raw`(?<![\d.,])(${NUM})\s*(?:snt|sentti\p{L}{0,3}|sentin|sentit|senttejä)(?![\p{L}])`, 'giu');
const AMOUNT_BEFORE = new RegExp(String.raw`(?<!\d${SPACE}*)(?:€|(?<![\p{L}])eur\s+)${SPACE}?(${NUM})(?![\d])`, 'giu');
const NUMBER = new RegExp(String.raw`(?<![\d])(${NUM})(?![\d])`, 'gu');

const URL = /(?:https?:\/\/|www\.)[^\s<>()"']+/giu;
const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu;
// Pelkkä verkkotunnus ("valioaimo.fi"). Pääte pienillä kirjaimilla, jotta lause ilman välilyöntiä ("mukaan.Se") ei osu.
const DOMAIN = /(?<![\p{L}\d@._/-])(?:[\p{L}\d-]+\.)+(?:fi|com|net|org|io|eu|se|app|dev|co|info|ai|me|ly|xyz|shop|store|online|site|link)(?![\p{L}\d-])(?:\/[^\s]*)?/gu;

/**
 * Luvun arvo. Kun sekä piste että pilkku ovat mukana, viimeinen on desimaalierotin ("1.234,50", "1,234.50"). Pelkkä pilkku on
 * desimaalipilkku ("0,125", "12,50"), paitsi useana kolmen numeron ryhmänä ("1,234,567"). Pelkkä piste kolmen numeron ryhmissä
 * nollasta poikkeavan alun jälkeen on tuhaterotin ("1.234"), muuten desimaalipiste ("0.125", "12.5").
 */
export function parseAmount(raw) {
  let s = String(raw).replace(/[ \u00a0\u202f]/g, '');
  const dot = s.lastIndexOf('.'); const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? '.' : ',';
    s = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.');
  } else if (comma >= 0) {
    s = /^\d{1,3}(?:,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (dot >= 0 && /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  return Number(s);
}

/** Tekstin euromäärät: [{ value, raw, index }]. Välin molemmat päät ovat omia määriään, ja sentit muunnetaan euroiksi. */
export function euroAmounts(text) {
  const out = [];
  const t = String(text ?? '');
  const overlaps = (m) => out.some((a) => m.index < a.index + a.length && a.index < m.index + m[0].length);
  for (const m of t.matchAll(AMOUNT_AFTER)) {
    out.push({ value: parseAmount(m[1]), raw: m[2] ? `${m[1]} €` : m[0].trim(), index: m.index, length: m[0].length });
    if (m[2]) out.push({ value: parseAmount(m[2]), raw: `${m[2]} €`, index: m.index + m[0].lastIndexOf(m[2]), length: m[2].length });
  }
  for (const m of t.matchAll(CENTS)) if (!overlaps(m)) out.push({ value: parseAmount(m[1]) / 100, raw: m[0].trim(), index: m.index, length: m[0].length });
  for (const m of t.matchAll(AMOUNT_BEFORE)) if (!overlaps(m)) out.push({ value: parseAmount(m[1]), raw: m[0].trim(), index: m.index, length: m[0].length });
  return out.filter((a) => Number.isFinite(a.value)).sort((a, b) => a.index - b.index).map(({ length, ...a }) => a);
}

// Rahakentät työkalujen tuloksissa: hinnat, summat ja verot (lineNet, unitPriceNet, pricePerPack, pricePer, comparisonPrice,
// totals.net/vat/gross …). Muut luvut eivät ole euroja: tunnisteet, määrät ja pakkauskoot (total, excess, packs, netWeight) sekä
// verokanta (vatRate). Rahakentän alla olevat luvut ovat rahaa (totals.net, pricePer.value).
const MONEY_END = /(?:price|prices|hinta|hinnat|net|gross|brutto|netto|totals|summa|eur|euro|euros|cost|vat|alv|charge|maksu|saving)$/i;
const MONEY_START = /^(?:price|hinta|cost)/i;
const isMoneyKey = (key) => MONEY_END.test(key) || MONEY_START.test(key);

/**
 * Euromäärät, joihin vastaus saa viitata: rahakenttien luvut ja €-merkityt tekstit annetuista tuloksista ja tilannekuvista.
 * Asiakkaan omat viestit (esim. "budjetti 200 €") annetaan tekstinä.
 */
export function knownAmounts(values = [], texts = []) {
  const out = new Set();
  const add = (n) => { if (Number.isFinite(n)) out.add(Math.round(n * 100) / 100); };
  const walk = (value, money, depth) => {
    if (value == null || depth > 12) return;
    if (typeof value === 'number') { if (money) add(value); return; }
    if (typeof value === 'string') {
      if (money) for (const m of value.matchAll(NUMBER)) add(parseAmount(m[1]));
      else for (const a of euroAmounts(value)) add(a.value);
      return;
    }
    if (Array.isArray(value)) { for (const v of value) walk(v, money, depth + 1); return; }
    if (typeof value === 'object') for (const [key, v] of Object.entries(value)) walk(v, money || isMoneyKey(key), depth + 1);
  };
  for (const value of values) walk(value, false, 0);
  for (const text of texts) {
    for (const a of euroAmounts(text)) add(a.value);
  }
  return [...out];
}

// ---------- Valio-väite tuotteesta ----------
// Arviointi 19.11. (Haiku 5.5): "25 kpl Valio-kiinteää perunaa", vaikka tuote oli Pietilän Perunan (merkki null). Katalogissa
// Valion merkkiset tuotteet ovat aina nimeltään "Valio …" ja merkiltään Valio. Toimittaja "VALIO OY / VALIO AIMO" on monella
// muullakin tuotteella, joten sitä ei lueta merkiksi. Väite hylätään vain, kun Valion perässä oleva ensimmäinen sisältösana
// löytyy tämän vuoron tuotteista pelkästään muiden kuin Valion tuotteiden nimistä. Palvelun nimi (Valio Aimo), Valion valikoima
// ja hinnat, kielteiset lauseet ja asiakkaan oma Valio-maininta eivät ole tuoteväitteitä. Merkkilistaa ei ole.
const VALIO = /(?<![\p{L}\d])valio(?:n|ta|lta|lle|lla|ssa|sta|on|ksi)?(?:-([\p{L}\d]+))?(?![\p{L}\d])/giu;
const NEGATION = /(?<![\p{L}])(?:ei|eikä|en|et|emme|ette|eivät)(?![\p{L}])/iu;
const PHRASE_END = /^(?:ja|tai|sekä|vai|kuin|eli|mutta|vaan)$/u;
// Lauseen raja: välimerkki ennen isoa kirjainta tai rivinvaihto. Päiväys (21.11.) ja desimaali (1.5) eivät katkaise lausetta.
const BOUNDARY = /[.!?](?=\s+[\p{Lu}*"«(])|\n/gu;
const lower = (s) => String(s ?? '').toLocaleLowerCase('fi-FI');
const contentWord = (w) => /^\p{L}{4,}$/u.test(w);
const sameWord = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i += 1; return i >= 4 && i >= Math.min(5, a.length, b.length); };
const isValioProduct = (name, brand) => /(?<![\p{L}])valio(?![\p{L}])/iu.test(String(name ?? '')) || /valio/iu.test(String(brand ?? ''));
const mentionsValio = (text) => /valio/iu.test(lower(text).replace(/valio\s*-?\s*aimo\p{L}*/gu, ''));

/** Tuotteet työkalujen tuloksista ja tilannekuvista: olio, jolla on productId ja nimi (name, product tai product.name). */
export function productNames(values = []) {
  const out = [];
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 12) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v.productId != null) {
      const name = typeof v.name === 'string' ? v.name : typeof v.product === 'string' ? v.product : typeof v.product?.name === 'string' ? v.product.name : '';
      const brand = typeof v.brand === 'string' ? v.brand : typeof v.product?.brand === 'string' ? v.product.brand : '';
      if (name) out.push({ words: lower(name).split(/[^\p{L}\d]+/u).filter(contentWord), valio: isValioProduct(name, brand) });
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const v of values) walk(v, 0);
  return out;
}

function sentenceAround(text, index) {
  let start = 0; let end = text.length;
  for (const b of text.matchAll(BOUNDARY)) { if (b.index < index) start = b.index + 1; else { end = b.index; break; } }
  return text.slice(start, end);
}

/** Valio liitetty tuotteeseen, jota tämän vuoron tulokset eivät nimeä Valion tuotteeksi: [{ raw, word, index }]. */
export function brandClaims(text, { products = [], customerTexts = [] } = {}) {
  const t = String(text ?? '');
  if (!products.length || customerTexts.some(mentionsValio)) return [];
  const claims = [];
  for (const m of t.matchAll(VALIO)) {
    if (NEGATION.test(sentenceAround(t, m.index))) continue;
    const tokens = [...(m[1] ? [m[1]] : []), ...t.slice(m.index + m[0].length).split(/\s+/u).filter(Boolean)].slice(0, 4);
    let word = null;
    for (const raw of tokens) {
      const w = lower(raw).replace(/[^\p{L}\d]+/gu, '');
      if (w.startsWith('aimo') || PHRASE_END.test(w)) break; // palvelun nimi tai uusi ilmaus
      if (contentWord(w)) { word = w; break; }
      if (/[,;:)–—/.!?]$/u.test(raw)) break; // välimerkki päättää ilmauksen
    }
    if (!word) continue;
    const other = products.some((p) => !p.valio && p.words.some((x) => sameWord(word, x)));
    const own = products.some((p) => p.valio && p.words.some((x) => sameWord(word, x)));
    if (other && !own) claims.push({ raw: m[0], word, index: m.index });
  }
  return claims;
}

/** Poistaa Valio-sanan tuotteen edestä ("Valio-kiinteää perunaa" → "kiinteää perunaa"); lauseen alussa seuraava sana isolla. */
function withoutBrandClaims(text, claims) {
  let t = String(text ?? '');
  for (const c of [...claims].sort((a, b) => b.index - a.index)) {
    const head = t.slice(0, c.index);
    let rest = c.raw.includes('-') ? `${c.raw.slice(c.raw.indexOf('-') + 1)}${t.slice(c.index + c.raw.length)}` : t.slice(c.index + c.raw.length).replace(/^\s+/u, '');
    if (/(?:^|\n|[.!?:]\s+|[-–•]\s+)$/u.test(head)) rest = `${rest.charAt(0).toLocaleUpperCase('fi-FI')}${rest.slice(1)}`;
    t = head + rest;
  }
  return t;
}

/** Linkit, verkko-osoitteet ja sähköpostiosoitteet mallin tekstissä. */
export function findLinks(text) {
  const t = String(text ?? '');
  // Lauseen välimerkki osoitteen perässä ei kuulu osoitteeseen ("katso www.valio.fi.").
  return [...new Set([...t.matchAll(URL), ...t.matchAll(EMAIL), ...t.matchAll(DOMAIN)].map((m) => m[0].replace(/[.,!?;:]+$/u, '')))];
}

/**
 * Tarkistaa mallin vastauksen ennen lähetystä.
 * @returns {{ok: boolean, unknownAmounts: Array<{value: number, raw: string}>, links: string[], empty: boolean}}
 */
export function checkReply(text, { known = [], products = [], customerTexts = [] } = {}) {
  const t = String(text ?? '').trim();
  const unknownAmounts = euroAmounts(t).filter((a) => !known.some((k) => Math.abs(k - a.value) <= 0.0101));
  const links = findLinks(t);
  const brands = brandClaims(t, { products, customerTexts });
  const empty = !t;
  return { ok: !empty && !unknownAmounts.length && !links.length && !brands.length, unknownAmounts, links, brands, empty };
}

/**
 * Korjauskierroksen jälkeen jäljelle jääneet ongelmat: linkit poistetaan, ja tarkistamaton euromäärä korvataan
 * viittauksella koriin, jossa hinnat näkyvät työkalujen tiedoista. Muu teksti pysyy mallin omana.
 */
export function repairReply(text, { unknownAmounts = [], links = [], brands = [] } = {}) {
  // Valio-väitteiden kohdat viittaavat alkuperäiseen tekstiin, joten ne poistetaan ennen muita korjauksia.
  let t = withoutBrandClaims(String(text ?? '').trim(), brands);
  for (const link of [...links].sort((a, b) => b.length - a.length)) t = t.split(link).join('');
  if (unknownAmounts.length) {
    const bad = (value) => unknownAmounts.some((a) => Math.abs(value - a.value) <= 0.0101);
    const NOTE = '(hinta näkyy korissa)';
    t = t.replace(AMOUNT_AFTER, (match, first, second) => (bad(parseAmount(first)) || (second && bad(parseAmount(second))) ? NOTE : match))
      .replace(CENTS, (match, value) => (bad(parseAmount(value) / 100) ? NOTE : match))
      .replace(AMOUNT_BEFORE, (match, value) => (bad(parseAmount(value)) ? NOTE : match));
  }
  return t.replace(/[ \t]+([.,!?:;])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '').trim();
}
