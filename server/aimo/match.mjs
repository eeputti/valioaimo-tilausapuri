// PYYDETTY TUOTE VAI JOKIN MUU: hakusanan ja tuotenimen suhde järjestystä varten.
// Halvin osuma ei kerro tuotetyyppiä. "Tomaatti" on myös tomaattimurskan, "kinkku" kinkkumakkaran ja "salaatti"
// perunasalaatin nimessä. Suomen yhdyssanassa pääsana on viimeisenä: kirjo|lohi on eri kala kuin lohi, kinkku|makkara on
// makkaraa. Tämä moduuli vain järjestää. Se ei pudota tuotteita pois eikä keksi niitä, ja ostaja valitsee aina itse.
import { stems } from '../catalog.mjs';

// Raaka-ainekategoriat: tuoreet hedelmät, vihannekset, yrtit ja marjat (174xx), pakastevihannekset, -yrtit ja -marjat, kuivamausteet.
export const RAW_INGREDIENT = /^(174\d\d|41731|41733|41740|22630)$/;

/** Osuman taso, pienempi parempi. */
// SPLIT: yhdyssanan osat erillisinä sanoina ("jäätelö Vanilja" vaniljajäätelölle): pyydetty tuote, kokonaisen nimen jälkeen.
export const TIER = { LEAD: 0, CORE: 1, SPLIT: 1.5, HEAD: 2, PART: 3, NONE: 4 };
// Leikkuu- ja muotosanat eivät muuta tuotetta toiseksi: lohi|filee on lohta, kinkku|viipale on kinkkua.
const FORM = ['fileesuikaleet', 'fileesuikale', 'fileekuutiot', 'fileekuutio', 'fileeviipaleet', 'fileeviipale', 'fileepalat', 'fileepala',
  'fileet', 'filee', 'file', 'suikaleet', 'suikale', 'kuutiot', 'kuutio', 'viipaleet', 'viipale', 'palat', 'pala', 'siivut', 'siivu', 'jyvät', 'jyvä'];
// Etuliite, joka ei tee tuotteesta toista: tuore|hiiva on hiivaa, kuiva|hiiva ei ole pyydettyä tuorehiivaa.
const PREFIX = new Set(['kevyt', 'täys', 'ykkös', 'luomu', 'tuore', 'pakaste', 'perus']);
// Nimen alun sanat, jotka eivät ole itse tuote: koot, määrät ja kuvailevat sanat. "Kotimainen Herne" alkaa herneellä.
const SKIP = /\d|^(x|n|noin|pp|aito|uusi|iso|pieni|kypsä|kypsät|tuore|tuoreet|luomu\w*|pakaste\w*|kotimai\w*|suomalai\w*|\w+lainen|\w+läinen)$/u;
const RANK = { core: 0, head: 1, part: 2, none: 3 };
const better = (a, b) => (RANK[a] <= RANK[b] ? a : b);

const tokensOf = (name) => String(name || '').toLowerCase().replace(/[®™%&(),;:+*"'!?]/g, ' ').replace(/\.(?!\d)/g, ' ').split(/[\s/]+/).filter(Boolean);
const formsOf = (word) => stems(word).filter((s) => s.length >= Math.min(4, word.length));

/** Yhden nimen osan suhde hakusanaan: core = tuote itse, head = saman pääsanan toinen tuote, part = vain määrite. */
function partKind(part, want) {
  if (want.shelf.some((n) => part.startsWith(n))) return 'core';
  let best = 'none';
  for (const s of stems(part).filter((x) => x.length >= 3)) {
    for (const v of want.forms) {
      if (s === v) return 'core';
      if (s.length <= v.length) continue;
      if (s.endsWith(v)) { const pre = s.slice(0, -v.length); best = better(best, PREFIX.has(pre) || want.others.has(pre) ? 'core' : 'head'); continue; }
      if (s.startsWith(v)) { // lohi|filee, maissi|n|jyvät (genetiivi)
        const rest = s.slice(v.length);
        if (FORM.includes(rest) || (rest.startsWith('n') && FORM.includes(rest.slice(1)))) return 'core';
        best = better(best, 'part'); continue;
      }
      const f = FORM.find((x) => s.endsWith(x) && s.length > x.length); // kirjo|lohi|filee: pääsana ennen muotosanaa
      const base = f ? s.slice(0, -f.length) : '';
      if (base.endsWith(v)) { best = better(best, PREFIX.has(base.slice(0, -v.length)) ? 'core' : 'head'); continue; }
      if (v.length >= 4 && s.includes(v)) best = better(best, 'part');
    }
  }
  return best;
}

/** Sana väliviivoineen: "kikherne-porkkanapihvi" on pihvi, jossa herne on vain alkuosa. */
function tokenKind(token, want) {
  const parts = token.split('-').filter(Boolean);
  if (parts.length < 2) return partKind(token, want);
  const last = partKind(parts.at(-1), want);
  if (last !== 'none') return last === 'core' && parts.slice(0, -1).every((p) => PREFIX.has(p) || /\d/.test(p)) ? 'core' : 'head';
  return parts.slice(0, -1).some((p) => partKind(p, want) !== 'none') ? 'part' : 'none';
}

function wordTier(tokens, want, skip) {
  const kinds = tokens.map((t) => tokenKind(t, want));
  const lead = tokens.findIndex((t, i) => kinds[i] === 'core' || !(SKIP.test(t) || skip.has(t)));
  if (lead >= 0 && kinds[lead] === 'core') return TIER.LEAD;
  if (kinds.includes('core')) return TIER.CORE;
  if (kinds.includes('head')) return TIER.HEAD;
  return kinds.includes('part') ? TIER.PART : TIER.NONE;
}

/**
 * @param {{name: string, brand?: string}} product
 * @param {{productTerm?: string, shelf?: {names: string[]}}} item tulkittu rivi (understand) tai pelkkä hakusana
 * @returns {number} TIER: 0 = nimi alkaa pyydetyllä tuotteella, 1 = tuote mainitaan myöhemmin (HAPANKAALI 400G VALKOSIPULI),
 *   2 = saman pääsanan toinen tuote (kirjolohi, perunasalaatti), 3 = vain määrite (tomaattimurska), 4 = ei mainita.
 */
export function termTier(product, item) {
  const words = String(item.productTerm || '').toLowerCase().split(/\s+/).filter(Boolean);
  const shelf = (item.shelf?.names || []).map((n) => n.toLowerCase());
  if (!words.length && !shelf.length) return TIER.NONE;
  const tokens = tokensOf(product.name);
  const brand = String(product.brand || '').trim().toLowerCase();
  // Merkki ohitetaan nimen alussa, paitsi jos merkkikenttä on koko nimi (datassa "Tuorehiiva 1 kg leivinhiiva").
  const brandWords = brand && brand !== String(product.name || '').trim().toLowerCase() ? tokensOf(brand) : [];
  let best = TIER.NONE;
  for (const w of words.length ? words : ['']) {
    // Saman pyynnön muut sanat eivät ole "toinen tuote": "Broilerin rintafilee" alkaa pyydetyllä tuotteella.
    const skip = new Set([...brandWords, ...words.filter((x) => x !== w).flatMap((x) => [x, ...stems(x)])]);
    const others = new Set(words.filter((x) => x !== w));
    best = Math.min(best, wordTier(tokens, { forms: w ? formsOf(w) : [], shelf, others }, skip));
    // Yhdyssana erillisinä sanoina: "GelatoLAB 5L jäätelö Vanilja" on vaniljajäätelöä, kun molemmat osat ovat nimen sanojen
    // alussa tai lopussa. Taso SPLIT: kokonaisena kirjoitettu yhdyssana ("Vaniljajäätelö") pysyy edellä.
    const parts = item.compounds?.[w];
    if (parts && best > TIER.SPLIT && parts.every((x) => tokens.some((t) => t.startsWith(x) || t.endsWith(x)))) best = TIER.SPLIT;
  }
  return best;
}

const at = (list, c) => { const i = (list || []).indexOf(c); return i < 0 ? (list || []).length : i; };

/**
 * Tuotetyypin tieto järjestystä varten.
 * key: järjestysavain, pienempi ensin: [raaka-aineen oma hylly, raaka-aine ennen valmistetta, osuman ryhmä].
 *   Ryhmä 0 = pyydetty tuote, 1 = saman pääsanan eri tuote, 2 = vain määrite (tomaattimurska), 3 = ei mainita.
 * requested: tuote on pyydettyä tuotetta (ryhmä 0). tier: nimen osuman tarkka taso (TIER).
 * Saman pääsanan yhdyssana on yleensä lajike (luonnon|jogurtti, pitkä|riisi, palvi|kinkku) ja kuuluu ryhmään 0. Erillinen
 * ryhmä vain, kun lajike on oikeasti eri tuote: raaka-aineen hyllysana (lohi ≠ kirjolohi, banaani ≠ keittobanaani) tai
 * ostajan tarkentama tila tai lajike (tuorehiiva ≠ kuivahiiva, keltasipuli ≠ punasipuli). Kuratoitu tuotetyyppi (maito, kerma, voi, munat) rajaa ryhmän jo itse,
 * joten sille avain on aina sama ja aiempi hinta- ja pakkausjärjestys säilyy.
 */
export function typeInfo(product, item) {
  if (item.productType) return { key: [0, 0, 0], tier: null, requested: null };
  const tier = termTier(product, item);
  const strict = !!item.shelf || !!item.attributes?.state || !!item.qualified;
  const group = tier <= TIER.CORE ? 0 : tier === TIER.SPLIT ? 1 : tier === TIER.HEAD ? (strict ? 1 : 0) : tier === TIER.PART ? 2 : 3;
  const shelf = item.shelf ? at(item.categories, product.category) : 0;
  const raw = RAW_INGREDIENT.test(product.category || '') ? 0 : 1;
  // Sana elää usealla hyllyllä (understand: CATEGORY_AMBIGUOUS), ja ryhmät ovat yleisyysjärjestyksessä: saman tyyppiryhmän sisällä
  // sanan yleisin hylly ensin. "Merisuola" on suolaa ennen kuin perunalastujen makua (katselmus 15.11. #17).
  const spread = !item.shelf && item.categories?.length > 1 ? at(item.categories, product.category) : 0;
  return { key: [shelf, raw, group, spread], tier, requested: group === 0 || tier === TIER.SPLIT };
}
export const typeKey = (product, item) => typeInfo(product, item).key;
export const compareKeys = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
