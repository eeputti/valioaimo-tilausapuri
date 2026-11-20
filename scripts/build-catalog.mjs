// Tiivistää 87 Mt:n tuotedatan ~10 Mt:n katalogiksi, jonka palvelin lataa muistiin käynnistyksessä.
// Aja: npm run catalog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = path.join(root, 'data', 'raw');

function readCsv(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [id, value] = line.split(',');
    if (id && value !== undefined && value !== '') out.set(id.trim(), Number(value));
  }
  return out;
}

const pick = (arr, lang) => arr?.find((x) => x.language === lang)?.value;
const toKg = (w) => (!w ? null : w.unit === 'GRM' ? w.value / 1000 : w.unit === 'KGM' ? w.value : null);
const toLitre = (v) => (!v ? null : v.unit === 'MLT' ? v.value / 1000 : v.unit === 'LTR' ? v.value : v.unit === 'CLT' ? v.value / 100 : null);

// Varakeino kun tuotedatassa ei ole painoa (tyypillisesti HeVi): luetaan koko nimestä, esim. "SIPULI 10KG", "96x50g", "2 dl".
function sizeFromName(name, perSales) {
  const unitTo = { kg: 1, g: 0.001, l: 1, dl: 0.1, cl: 0.01, ml: 0.001 };
  const n = (s) => Number(s.replace(',', '.'));
  const multi = name.match(/(\d+)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)(?![a-zåäö])/i);
  const single = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)(?![a-zåäö])/i);
  let size; let unit;
  if (multi) { size = n(multi[1]) * n(multi[2]) * unitTo[multi[3].toLowerCase()]; unit = multi[3].toLowerCase(); }
  else if (single) { size = n(single[1]) * unitTo[single[2].toLowerCase()] * (perSales > 1 ? perSales : 1); unit = single[2].toLowerCase(); }
  if (!size || size <= 0 || size > 60) return null;
  size = +size.toFixed(3);
  return /l$/.test(unit) ? { kg: size, litres: size } : { kg: size };
}

const LABELS_KEPT = new Set([
  'FREE_FROM_LACTOSE', 'LOW_LACTOSE', 'FREE_FROM_GLUTEN', 'VEGAN', 'VEGETARIAN', 'EU_ORGANIC_FARMING',
  'GOODS_FROM_FINLAND_BLUE_SWAN', 'MADE_IN_FINLAND_FLAG_WITH_KEY', 'FINNISH_HEART_SYMBOL',
  'MARINE_STEWARDSHIP_COUNCIL_LABEL', 'FAIR_TRADE_MARK', 'RAINFOREST_ALLIANCE',
]);

console.time('catalog');
const products = JSON.parse(fs.readFileSync(path.join(raw, 'product_data.json'), 'utf8'));
const reliability = readCsv(path.join(raw, 'delivery_reliability.csv'));
const co2 = readCsv(path.join(raw, 'carbon_footprint.csv'));

const tempStats = {};
const out = products.filter((p) => !p.deleted).map((p) => {
  const sd = p.synkkaData || {};
  const groups = Object.fromEntries((sd.classifications || []).map((g) => [g.name, g.values || []]));
  const marks = (groups.packagingMarkedLabel || []).map((v) => v.id);
  const claims = (groups.nutritionalClaim || []).map((v) => v.id);

  // Lämpötilaluokka: pakkausmerkintä on eksplisiittinen, koodi on varalla (8 = kuiva, 7 = pakaste, muut kylmä).
  let temp = marks.includes('freezeTemperature') ? 'frozen' : marks.includes('coolTemperature') ? 'chilled' : marks.includes('warmTemperature') ? 'ambient' : null;
  if (!temp && p.temperatureCondition != null) temp = p.temperatureCondition === 8 ? 'ambient' : p.temperatureCondition === 7 ? 'frozen' : 'chilled';
  const key = `${p.temperatureCondition}:${temp}`;
  tempStats[key] = (tempStats[key] || 0) + 1;

  const allergens = groups.allergen || [];
  const contains = [...new Set(allergens.filter((a) => a.unit === 'CONTAINS').map((a) => a.id))].sort();
  const mayContain = [...new Set(allergens.filter((a) => a.unit === 'MAY_CONTAIN').map((a) => a.id))].sort();
  const freeFrom = [...new Set(allergens.filter((a) => a.unit === 'FREE_FROM').map((a) => a.id))].sort();

  // Myyntiyksikön nettopaino/tilavuus: perusyksikön netto × montako perusyksikköä myyntiyksikössä on.
  const base = (sd.unitConversions || []).find((u) => u.synkkaPackagingType === 'BASE_UNIT_OR_EACH');
  const perSales = (p.units || []).find((u) => u.unitId === p.salesUnit)?.sizeInBaseUnits ?? 1;
  let kg = p.salesUnit === 'KG' ? 1 : null; // eslint-disable-line prefer-const
  let litres = null;
  if (kg == null && base) {
    const baseKg = toKg(base.netWeight);
    if (baseKg) kg = +(baseKg * perSales).toFixed(3);
    const baseL = toLitre(base.volume);
    if (baseL) litres = +(baseL * perSales).toFixed(3);
  }

  if (kg > 60 && p.salesUnit !== 'PAL') kg = +(kg / 1000).toFixed(3); // datassa grammoja kilojen kentässä
  let sizeApprox;
  if (kg == null && p.baseUnit === 'KG') kg = perSales; // perusyksikkö on kilo → myyntiyksikön koko on suoraan paino
  const parsed = sizeFromName(pick(sd.names, 'fi') || '', perSales);
  if (kg == null && litres == null && parsed) { kg = parsed.kg; litres = parsed.litres ?? null; sizeApprox = true; }
  else if (litres == null && parsed?.litres) { litres = parsed.litres; sizeApprox = true; } // paino on datassa, tilavuus luetaan nimestä ("1 l", "100x2 cl")

  const labels = [...new Set([...marks, ...claims])].filter((l) => LABELS_KEPT.has(l));
  const ingredients = pick(sd.keyIngredients, 'fi') || pick(sd.keyIngredients, 'en') || '';

  return {
    id: p.id,
    gtin: p.salesUnitGtin || sd.gtin || undefined,
    name: (pick(sd.names, 'fi') || pick(sd.names, 'en') || pick(sd.names, 'sv') || `Tuote ${p.id}`).trim(),
    nameEn: pick(sd.names, 'en') || undefined,
    brand: sd.brand || undefined,
    vendor: p.vendorName,
    category: p.category,
    salesUnit: p.salesUnit,
    baseUnit: p.baseUnit,
    perSales,
    lot: p.allowedLotSize,
    temp,
    country: p.countryOfOrigin || undefined,
    contains,
    mayContain: mayContain.length ? mayContain : undefined,
    freeFrom: freeFrom.length ? freeFrom : undefined,
    hasAllergenData: allergens.length > 0 || undefined,
    labels: labels.length ? labels : undefined,
    kg: kg ?? undefined,
    litres: litres ?? undefined,
    sizeApprox,
    variableWeight: sd.variableUnit || undefined,
    vat: sd.vatCode || undefined,
    subs: p.substitutions?.length ? [...new Set(p.substitutions.map((s) => s.substituteProduct).filter((s) => s !== p.id))] : undefined,
    deposit: p.deposits?.length ? true : undefined,
    reliability: reliability.get(p.id),
    co2: co2.has(p.id) ? +co2.get(p.id).toFixed(3) : undefined,
    ingredients: ingredients ? ingredients.slice(0, 220) : undefined,
  };
});

fs.writeFileSync(path.join(root, 'data', 'catalog.json'), JSON.stringify(out));
console.timeEnd('catalog');
const size = fs.statSync(path.join(root, 'data', 'catalog.json')).size;
console.log(`${out.length} tuotetta → data/catalog.json (${(size / 1e6).toFixed(1)} Mt)`);
console.log('toimitusvarmuus:', reliability.size, 'hiilijalanjälki:', co2.size, 'korvaavuussääntöjä:', out.filter((p) => p.subs).length);
console.log('lämpötilakoodi:luokka →', tempStats);
