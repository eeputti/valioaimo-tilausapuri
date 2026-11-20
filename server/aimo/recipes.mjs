// RESEPTISTÄ OSTOSKORI. "lohikeitto 100 annosta perjantaiksi" → raaka-ainerivit määrineen → sama tarjous- ja tilausketju kuin muillakin pyynnöillä.
// Ei kielimallia eikä arvailua: resepti on taulukko, määrä on annokset × määrä per annos, ja jokainen rivi osoittaa yhteen katalogin tuotteeseen.
// Näin vältetään tyhmät virheet:
//   - annosmäärä on pakollinen ja rajattu (1–MAX_PORTIONS); ilman sitä ei lasketa mitään, vaan pyydetään se
//   - raaka-aine on kiinnitetty tuotekoodiin, joten "peruna" ei voi muuttua halvimmaksi perunatuotteeksi (esim. muusiksi)
//   - jos kiinnitettyä tuotetta ei ole katalogissa, rivi jää ratkaisematta (NO_MATCH) ja koko pyyntö pysähtyy; vajaata koria ei tilata
//   - reseptin tuotetta ei korvata automaattisesti (allowSubstitutes: false); pakkauskoon pyöristyksen tekee portti
// OLETUS: reseptit ja annoskoot ovat demodataa. Tuotannossa ne tulisivat asiakkaan omasta reseptiikasta (Minun Aimo).
import { loadCatalog } from '../catalog.mjs';

export const MAX_PORTIONS = 2000;

export const RECIPES = [
  {
    id: 'lohikeitto', name: 'Lohikeitto', match: /\b(lohikeit\w*|lohisop\w*|salmon soup)\b/i,
    pantry: ['suola', 'valkopippuri', 'vesi'],
    lines: [
      { productId: '463316', label: 'lohikuutio (pakaste)', amount: 0.1, unit: 'KG' },
      { productId: '470961', label: 'peruna', amount: 0.2, unit: 'KG' },
      { productId: '460708', label: 'porkkana', amount: 0.05, unit: 'KG' },
      { productId: '462411', label: 'kuorittu sipuli', amount: 0.03, unit: 'KG' },
      { productId: '465193', label: 'kuohukerma', amount: 0.05, unit: 'L' },
      { productId: '464411', label: 'voi', amount: 0.005, unit: 'KG' },
      { productId: '475132', label: 'kalaliemi (jauhe)', amount: 0.0045, unit: 'KG' },
      { productId: '463024', label: 'tilli', amount: 0.004, unit: 'KG' },
    ],
  },
  {
    id: 'mustikkarahka', name: 'Mustikkarahka', match: /\b(mustikkarahk\w*|blueberry quark)\b/i,
    pantry: ['sokeri', 'vaniljasokeri'],
    lines: [
      { productId: '477044', label: 'maitorahka', amount: 0.07, unit: 'KG' },
      { productId: '468832', label: 'mustikkasose (pakaste)', amount: 0.04, unit: 'KG' },
      { productId: '465193', label: 'kuohukerma', amount: 0.03, unit: 'L' },
    ],
  },
  {
    id: 'kanacurry', name: 'Kanacurry ja riisi', match: /\b(kanacurry\w*|broilericurry\w*|kana[- ]?curry\w*|chicken curry)\b/i,
    pantry: ['suola', 'öljy', 'vesi'],
    lines: [
      { productId: '462790', label: 'broilerin rintafileeviipale (pakaste)', amount: 0.1, unit: 'KG' },
      { productId: '460394', label: 'kookosmaito', amount: 0.08, unit: 'L' },
      { productId: '463511', label: 'riisi', amount: 0.07, unit: 'KG' },
      { productId: '462411', label: 'kuorittu sipuli', amount: 0.03, unit: 'KG' },
      { productId: '460457', label: 'currypyree', amount: 0.01, unit: 'KG' },
    ],
  },
  {
    id: 'riisipuuro', name: 'Riisipuuro', match: /\b(riisipuur\w*|joulupuur\w*|rice porridge)\b/i,
    pantry: ['suola', 'vesi'],
    lines: [
      { productId: '462353', label: 'puuroriisi', amount: 0.06, unit: 'KG' },
      { productId: '464073', label: 'täysmaito (laktoositon)', amount: 0.3, unit: 'L' },
      { productId: '464411', label: 'voi', amount: 0.005, unit: 'KG' },
      { productId: '476785', label: 'kaneli', amount: 0.001, unit: 'KG' },
    ],
  },
];

const PORTIONS = /(\d[\d\s.,]*)\s*(?:annos\w*|henge\w*|henkilö\w*|hlö\w*|ruokaili\w*|asiaka\w*|portions?|servings?|people|persons?|guests?|pax)\b|\b(?:for|x)\s*(\d[\d\s.,]*)\b/i;
const OTHER_UNIT = /\d\s*(kg|kilo\w*|l|litra\w*|litres?|liters?|kpl|pcs|g|dl)\b/i; // "lohikeittoa 10 kg" on valmistuotteen haku, ei resepti
const UNIT_FI = { KG: 'kg', L: 'l' };
const fmt = (n) => String(+n.toFixed(n < 1 ? 3 : 1)).replace('.', ',');

/**
 * Tunnistaa reseptin ja annosmäärän tekstistä.
 * @returns {null | {recipe: object, portions: number|null, problem?: {code: string, fi: string, en: string}}}
 */
export function detectRecipe(text) {
  const s = String(text || '');
  const recipe = RECIPES.find((r) => r.match.test(s));
  if (!recipe) return null;
  const m = s.match(PORTIONS);
  if (!m) {
    if (OTHER_UNIT.test(s)) return null;
    return { recipe, portions: null, problem: { code: 'PORTIONS_MISSING', fi: `Resepti "${recipe.name}" tunnistettiin, mutta annosmäärä puuttuu. Kirjoita esim. "${recipe.name.toLowerCase()} 100 annosta"`, en: `Recipe "${recipe.name}" recognised, but the number of portions is missing` } };
  }
  const portions = Number((m[1] || m[2]).replace(/[\s.,]/g, ''));
  if (!Number.isInteger(portions) || portions < 1 || portions > MAX_PORTIONS) return { recipe, portions, problem: { code: 'PORTIONS_OUT_OF_RANGE', fi: `Annosmäärä ${portions} ei ole välillä 1–${MAX_PORTIONS}: ostoskoria ei laskettu`, en: `Portions ${portions} is outside 1–${MAX_PORTIONS}: nothing was calculated` } };
  return { recipe, portions };
}

/** Resepti × annokset → rivit samassa muodossa kuin understand() tuottaa, jokainen kiinnitettynä yhteen katalogin tuotteeseen. */
export function expandRecipe(recipe, portions) {
  const cat = loadCatalog();
  const items = recipe.lines.map((l) => {
    const p = cat.get(l.productId);
    const value = +(l.amount * portions).toFixed(3);
    return {
      raw: `${fmt(value)} ${UNIT_FI[l.unit]} ${l.label}`, productTerm: l.label, productType: null, category: p?.category || null,
      claims: [], excludeAllergens: [], brand: null, countryOfOrigin: null, attributes: {},
      quantity: { value, unit: l.unit },
      pinned: { productId: l.productId, found: !!p, name: p?.name || null, perPortion: { value: l.amount, unit: l.unit } },
    };
  });
  return {
    items,
    info: {
      id: recipe.id, name: recipe.name, portions, pantry: recipe.pantry,
      lines: items.map((it) => ({ label: it.productTerm, productId: it.pinned.productId, productName: it.pinned.name, perPortion: it.pinned.perPortion, total: it.quantity, inCatalog: it.pinned.found })),
      rules: { fi: 'Määrä = annokset × määrä per annos. Tuote on kiinnitetty reseptissä eikä sitä korvata automaattisesti. Portti pyöristää pakkauskokoon ylöspäin.', en: 'Quantity = portions × amount per portion. Each product is fixed by the recipe and never substituted automatically. The gateway rounds up to pack size.' },
    },
  };
}
