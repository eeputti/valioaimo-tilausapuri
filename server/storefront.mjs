// Hakutulokset ja korin tarkistus käyttävät samaa saatavuusehtoa. Näiden kutsuminen ei tee tilausta.
import { loadCatalog, roundToStep, stepOf, unitLabel } from './catalog.mjs';
import { interpret } from './aimo/index.mjs';
import { fetchQuotes } from './valioApi.mjs';
import { findSubstitutes, dishesOf, sameDish } from './substitutes.mjs';
import { clock, cutoffPassed, parseApiTime } from './gateway/clock.mjs';
import { unitSizeFor } from './gateway/quantity.mjs';
import { PRODUCT_TYPES } from './gateway/contract.mjs';
import { explainItemQuantity, isEggItem } from './itemQuantities.mjs';
import { typeInfo, compareKeys, TIER, RAW_INGREDIENT } from './aimo/match.mjs';
import { verifiedFree } from './allergens.mjs';
import { SHELVES } from './aimo/synonyms.mjs';

export function validDeliveryDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

const plusDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Tilausaika pyydetylle päivälle on mennyt: aikaisin päivä, jolle sama toimitusaika vielä ehtii. Vain viimeisimmästä oikeasta
 * vastauksesta lasketulle saatavuudelle (valioApi.mjs lastKnownAvailability), jossa tilausaika siirtyy kokonaisina päivinä
 * toimituspäivän mukana. Sama haku tälle päivälle antaa siis tilattavan tuotteen. Rajapinnan omaa vastausta ei arvata.
 */
export function dateAfterCutoff(avail, date) {
  if (avail?.source !== 'last-known' || avail.status !== 'ok' || avail.stale) return null;
  const t = parseApiTime(avail.closingTime);
  if (!t) return null;
  const late = clock.now().getTime() - t.getTime();
  return late >= 0 ? plusDays(date, Math.floor(late / 86_400_000) + 1) : null;
}

export function orderableProduct(p, quote, date, quantity) {
  const a = quote?.avail; const price = quote?.price;
  const fail = (code) => ({ ok: false, code });
  if (!p) return fail('UNKNOWN_PRODUCT');
  if (!price || price.error || price.stale || !Number.isFinite(price.net) || price.net < 0) return fail('PRICE_UNAVAILABLE');
  if (!a || a.stale || a.status !== 'ok') return fail('NOT_AVAILABLE');
  // Rajapinnan päivä on aikaisin mahdollinen toimitus: tuote kelpaa, kun se ehtii pyydetyksi päiväksi.
  if (!a.date || a.date > date) return fail('DELIVERY_DATE_MISMATCH');
  if (cutoffPassed(a.closingTime)) return fail('CUTOFF_PASSED');
  const size = unitSizeFor(p, price, quantity?.unit || 'PCS', quantity?.basis || 'sales');
  if (!size?.value || !(size.value > 0)) return fail('UNIT_NOT_CONVERTIBLE');
  const qty = Math.max(stepOf(p), roundToStep((quantity?.value || 1) / size.value, p, 'up'));
  if (a.amount != null && (!Number.isFinite(a.amount) || a.amount < qty)) return fail('INSUFFICIENT_STOCK');
  return { ok: true, product: {
    id: p.id, name: p.name, brand: p.brand || null, unit: p.salesUnit, unitLabel: unitLabel(p.salesUnit),
    litres: p.litres ?? null, kg: p.kg ?? null, labels: p.labels || [], step: stepOf(p), qty,
    price: price.net, vat: price.vatRate, comparison: price.comparison ?? null, comparisonUnit: price.comparisonUnit ?? null,
    quantityExplanation: explainItemQuantity(p, quantity, qty),
    // closingTime: tilausaikaraja tälle toimitukselle ("Huomiselle ehtii tilata su 15.11. klo 12.00 asti").
    availability: { status: 'ok', deliveryDate: date, stock: a.amount ?? null, closingTime: a.closingTime || null, source: a.source, checkedAt: a.fetchedAt || Date.now() },
  } };
}

// Tiukat ruokavalio- ja allergeeniehdot säilyvät myös korvaajissa.
function fits(p, item) {
  const type = PRODUCT_TYPES.find((t) => t.id === item.productType);
  const fat = { 'fat-free': /rasvaton/i, 'semi-skimmed': /kevyt/i, whole: /täys/i }[item.attributes?.fat];
  return !!p && (!type || type.categories.includes(p.category) && !type.exclude?.test(p.name)) &&
    (!fat || fat.test(p.name)) && (!item.countryOfOrigin || p.country === item.countryOfOrigin) &&
    (item.attributes?.state !== 'frozen' || p.temp === 'frozen') &&
    (item.attributes?.treatment !== 'uht' || /uht/i.test(p.name)) &&
    (item.claims || []).every((c) => p.labels?.includes(c)) &&
    verifiedFree(item.excludeAllergens, p); // alakoodit: pähkinätön ei saa mantelia (katselmus 15.11. #2)
}
async function alternatives(original, qty, date, item, cat) {
  const r = await findSubstitutes(original, qty, date, { subSameAllergens: true, bannedAllergens: item.excludeAllergens || [], subMaxPriceIncreasePct: 10 }, { limit: 8, recipeRequired: !!item.pinned });
  const candidates = r.options.filter((o) => fits(cat.get(o.productId), item));
  const quotes = await fetchQuotes(candidates.map((o) => o.productId), date);
  return candidates.flatMap((o) => {
    // Osatoimituksen alkuperäinen osa ei saa kadota: etsitään tässä kokonaisen tarpeen kattavia korvaajia.
    const assessed = orderableProduct(cat.get(o.productId), quotes.get(o.productId), date, item.quantity || { value: o.type === 'combo' ? o.qty * qty / (qty - r.partialAmount) : o.qty, unit: 'PCS' });
    return assessed.ok ? [{ ...assessed.product, substituteFor: { id: original.id, name: original.name }, warnings: o.warnings, why: o.why.filter((why) => !why.startsWith('Alkuperäistä saadaan')) }] : [];
  });
}

// Valmisruoan pääraaka-aine (Eelis 18.11.: "tarjoa lanttulaatikon tilalle mieluummin lanttua ja samaa logiikkaa kaikkeen
// muuhunkin"). Ruoan nimen alkuosa on raaka-aine: lanttulaatikko → lanttu, porkkanalaatikko → porkkana, lohikeitto → lohi.
// Raaka-aine tarjotaan saman ruoan muiden valmistajien jälkeen, ei toista ruokaa (maksalaatikkoa). Raaka-aineeksi kelpaa vain
// tuote, joka on itse sitä raaka-ainetta (haun requested) eikä valmisruoka: porkkanatäysmehu ja lanttupihvi eivät käy.
// Ruokavalio- ja allergeeniehdot pätevät kuten muissakin korvaajissa: laktoosittoman lanttulaatikon tilalle lanttu kelpaa vain merkittynä.
// Tuoreet kasvikset, hedelmät, perunat, juurekset ja kuoritut juurekset. Ei 17423 (kypsät perunavalmisteet).
const FRESH_PRODUCE = /^17(40\d|41\d|42[124]|43[12])$/;
const SHELF_CATEGORIES = new Set(Object.values(SHELVES).flatMap((s) => s.categories)); // raaka liha, kala, broileri, peruna
const READY_FOOD = /^173\d\d$/; // valmisruoat ja -salaatit eivät ole raaka-ainetta
const INGREDIENT_ALIAS = { kaali: 'keräkaali' };
export async function dishIngredient(item, date) {
  const dish = dishesOf({ name: item?.productTerm || '' })[0];
  if (!dish) return null;
  let r = await interpret(dish.base, { llm: false, limit: 40 });
  // Pelkkä "kaali" on tuotenimissä salaatteja; kaalilaatikon kaali on keräkaalia.
  const alias = INGREDIENT_ALIAS[r.understood.items[0]?.productTerm];
  if (alias) r = await interpret(alias, { llm: false, limit: 40 });
  const it = r.understood.items[0]; const card = r.cards[0];
  if (!it || !card || card.status !== 'ok') return null;
  const cat = loadCatalog();
  const rule = { ...item, productType: undefined };
  // Tuore, käsittelemätön kasvis tai hedelmä on luonnostaan laktoositon, gluteeniton ja vegaaninen, vaikka merkintää ei ole:
  // laktoosittoman lanttulaatikon tilalle käy lanttu. Allergeenikiellot pätevät edelleen sellaisinaan.
  const plain = { ...rule, claims: (rule.claims || []).filter((c) => !['FREE_FROM_LACTOSE', 'FREE_FROM_GLUTEN', 'VEGAN', 'VEGETARIAN'].includes(c)) };
  const fresh = (p) => FRESH_PRODUCE.test(String(p.category || ''));
  const all = card.list.map((p) => cat.get(p.id)).filter((p) => p && !dishesOf(p).length && !READY_FOOD.test(String(p.category || ''))
    && typeInfo(p, it).requested !== false && fits(p, fresh(p) ? plain : rule));
  // Raaka-ainehyllyt ensin: kaalilaatikolle tuli pikkelöityä punakaalia ja kaalisalaattia. Jalostettu käy vain, jos raakaa ei
  // ole lainkaan (lihamakaronilaatikko → kuiva makaroni).
  const shelf = (p) => RAW_INGREDIENT.test(String(p.category || '')) || SHELF_CATEGORIES.has(String(p.category || ''));
  const raw = all.some(shelf) ? all.filter(shelf) : all;
  if (!raw.length) return null;
  // Näytettävä raaka-aine on hakusanan viimeinen sana: lihamakaronilaatikko → "liha makaroni" → makaroni.
  const word = String(it.productTerm).split(' ').at(-1);
  const quotes = await fetchQuotes(raw.map((p) => p.id), date);
  const known = (p) => { const a = quotes.get(p.id)?.avail; return !!a && !a.stale && a.status !== 'unknown'; };
  // Kilot ja litrat siirtyvät raaka-aineelle (5 kg lanttulaatikkoa → 5 kg lanttua). Kappaleina pyydetty ruoka ei kerro raaka-aineen
  // määrää (6 kpl porkkanalaatikkoa ei ole 6 pussia porkkanaa), joten hinta näytetään yhdestä myyntierästä ja määrä kysytään.
  const byWeight = ['KG', 'L'].includes(item.quantity?.unit);
  const options = raw.flatMap((p) => {
    let a = byWeight ? orderableProduct(p, quotes.get(p.id), date, item.quantity) : { ok: false, code: 'UNIT_NOT_CONVERTIBLE' };
    // Eri mittayksikkö (10 l lohikeittoa → lohi kiloina): hinta yhdestä myyntierästä, määrä kysytään valinnan jälkeen.
    const askQuantity = !a.ok && a.code === 'UNIT_NOT_CONVERTIBLE';
    if (askQuantity) a = orderableProduct(p, quotes.get(p.id), date, { value: 1, unit: 'PCS' });
    return a.ok ? [{ ...a.product, ingredientFor: item.productTerm, ingredientWord: word, askQuantity, typeRank: 1, key: typeInfo(p, it).key }] : [];
  }).sort((a, b) => compareKeys(a.key, b.key) || a.price * a.qty - b.price * b.qty).map(({ key, ...o }) => o);
  return { word, options, unknown: !raw.some(known) };
}

// Pelkkä tuotenumero haetaan suoraan katalogista ilman tulkintaa. Määrä tulee vain korisivun omasta muutoksesta.
const PRODUCT_NUMBER = /^\d{3,15}$/;
const NUMBER_SEARCH_UNITS = ['PCS', 'L', 'KG'];

function quantityForNumberSearch(patches) {
  const change = (patches || []).find((entry) => entry.item === 0 && entry.patch?.quantity);
  if (!change) return null;
  const { quantity } = change.patch;
  const sensible = Number.isFinite(quantity.value) && quantity.value > 0 && quantity.value <= 100000
    && NUMBER_SEARCH_UNITS.includes(quantity.unit) && ['sales', 'items'].includes(quantity.basis || 'sales');
  if (!sensible) throw new Error('Tarkista tuotteen määrä ja yksikkö.');
  return quantity;
}

function searchByProductNumber(text, number, opts) {
  const product = loadCatalog().get(number);
  if (!product) throw new Error('Tuotenumeroa ei löydy tilattavasta valikoimasta. Hae tuotetta nimellä.');
  const item = { raw: product.name, productTerm: product.name, quantity: quantityForNumberSearch(opts.patches),
    claims: [], excludeAllergens: [], attributes: {} };
  const found = {
    understood: { text, items: [item], deliveryDate: null, unparsed: [], assumptions: [] },
    cards: [{ status: 'ok', list: [product], chips: [] }],
    handoff: null,
    gateway: {},
    trace: { confidence: 1, llmCalls: 0, via: 'product-id', ms: 0 },
  };
  return availableStorefront(found, opts);
}

export async function searchStorefront(text, opts = {}) {
  const number = text.trim();
  if (PRODUCT_NUMBER.test(number)) return searchByProductNumber(text, number, opts);
  const r = await interpret(text, { ...opts, limit: 80 });
  return availableStorefront(r, opts);
}

// Myös reseptien rakenteiset määrät tarkistetaan samalla saatavuusehdolla.
export async function availableStorefront(r, opts = {}) {
  const date = r.understood.deliveryDate || opts.deliveryDate;
  if (!validDeliveryDate(date) || date < clock.today()) throw new Error('Valitse kelvollinen tuleva toimituspäivä.');
  r.deliveryDate = date;
  r.dateAssumed = !r.understood.deliveryDate;
  const cat = loadCatalog();
  const ids = [...new Set(r.cards.filter((c) => c.status === 'ok').flatMap((c) => c.list.map((p) => p.id)))];
  const quotes = await fetchQuotes(ids, date);
  for (const [i, card] of r.cards.entries()) {
    const item = r.understood.items[i];
    // Haku ei löytänyt valikoimasta pyydettyä tuotetta lainkaan (tai mikään ei täytä ehtoja): ei toimituspäivän ongelma.
    const catalogMiss = card.status !== 'ok';
    // Rajapinta ei vastannut eikä tuotteista ole voimassa olevaa tietoa (välimuistin ulkopuoliset tuotteet katkon aikana):
    // saatavuus on tuntematon, ei "ei saatavilla". Muuten resepti- ja tilauspolku pudottaisivat tuotteita, joita ei tunneta.
    const unknownOf = (p) => { const a = quotes.get(p.id)?.avail; return !a || a.stale || a.status === 'unknown'; };
    const unknownData = !catalogMiss && card.list.length > 0 && card.list.every(unknownOf);
    // Pyydetyn tuotteen omat osumat (kuratoitu tuotetyyppi: kaikki osumat). Jos niistä ei ole tietoa, muut tilattavat ovat
    // vain lähimpiä, eikä pyydettyä tuotetta voi sanoa saatavuudettomaksi.
    const wanted = catalogMiss ? [] : card.list.filter((p) => { const prod = cat.get(p.id); if (!prod) return false; const t = typeInfo(prod, item); return t.tier == null || t.requested === true; });
    const wantedUnknown = wanted.length > 0 && wanted.every(unknownOf);
    // Valmisruoan haussa vain sama ruoka: perunalaatikolle haku antoi nakki- ja liha-perunasoselaatikkoa. Toisen ruoan
    // sijaan tarjotaan pääraaka-aine (dishIngredient, Eelis 18.11.).
    const dishWanted = dishesOf({ name: item?.productTerm || '' }).length ? { name: item.productTerm } : null;
    const own = (p) => !dishWanted || (!!p && sameDish(dishWanted, p));
    const closed = []; // tuotteet, jotka kävisivät, mutta tilausaika tälle päivälle on mennyt
    const exact = card.status === 'ok' ? card.list.flatMap((p) => {
      const prod = cat.get(p.id);
      if (!own(prod)) return [];
      let a = orderableProduct(prod, quotes.get(p.id), date, item.quantity);
      if (!a.ok && a.code === 'CUTOFF_PASSED') closed.push(quotes.get(p.id).avail);
      // Kappalemäärä ("10 kpl leivoksia"), mutta pakkauksen kappaleita ei ole tuotetiedoissa: ei arvata. Tuote näytetään yhden
      // myyntierän hinnalla, ja määrä kysytään valinnan jälkeen myyntierinä (17.11.). Munissa tuntematon pakkaus jää pois kuten ennen.
      if (!a.ok && a.code === 'UNIT_NOT_CONVERTIBLE' && item.quantity?.unit === 'PCS' && item.quantity.basis === 'items' && prod && !isEggItem(prod)) {
        a = orderableProduct(prod, quotes.get(p.id), date, { value: 1, unit: 'PCS' });
        if (a.ok) a.product = { ...a.product, quantityExplanation: null, askQuantity: true, countUnknown: true };
      }
      return a.ok ? [a.product] : [];
    }) : [];
    // Tyhjä tulos kertoo aikaisimman päivän, jolle sama haku löytää tilattavaa.
    // Kun tilausaika on mennyt, aikaisin päivä lasketaan samalla toimitusajalla (dateAfterCutoff): last-known-saatavuuden päivä
    // on aina pyydetty päivä, joten ilman tätä aikaisinta päivää ei tiedetty (pe 20.11. kysyttynä to klo 17.18, 19.11.).
    const cutoff = !exact.length && closed.length > 0;
    const nextDeliveryDate = exact.length || card.status !== 'ok' ? null : card.list.filter((p) => own(cat.get(p.id))).map((p) => quotes.get(p.id)?.avail)
      .filter((a) => a && !a.stale && ['ok', 'late'].includes(a.status) && a.date > date && cutoffPassed(a.closingTime) === false)
      .map((a) => a.date).sort()[0] || (cutoff ? closed.map((a) => dateAfterCutoff(a, date)).filter(Boolean).sort()[0] || null : null);
    let substitutes = [];
    const first = card.status === 'ok' ? card.list.map((p) => cat.get(p.id)).find(own) : null;
    if (!exact.length && first) {
      const original = first;
      const size = unitSizeFor(original, quotes.get(original.id)?.price, item.quantity?.unit || 'PCS', item.quantity?.basis || 'sales');
      if (size?.value) substitutes = await alternatives(original, (item.quantity?.value || 1) / size.value, date, item, cat);
    }
    // Valmisruokaa ei ole tilattavana: pääraaka-aine saman ruoan muiden valmistajien jälkeen. Jos raaka-ainetta ei saa
    // tilattua, sen nimi kulkee kortissa, jotta tilausapuri voi sanoa sen (lanttu on valikoimassa, mutta hinta puuttuu).
    let ingredient = null;
    if (!exact.length && card.status === 'ok') {
      ingredient = await dishIngredient(item, date);
      if (ingredient?.options.length) substitutes = [...substitutes, ...ingredient.options.filter((o) => !substitutes.some((s) => s.id === o.id))];
    }
    // Pyydetty tuotetyyppi ennen hintaa (match.mjs): kurkun tuorehylly ennen säilykkeitä, tuore tomaatti ennen tomaattimurskaa,
    // spagetti ennen spagettilihavuokaa. Saman tyypin sisällä halvin tarpeen kattava ensin, kuten ennenkin.
    const info = new Map(exact.map((p) => [p, typeInfo(cat.get(p.id), item)]));
    exact.sort((a, b) => compareKeys(info.get(a).key, info.get(b).key) || (a.countUnknown ? 1 : 0) - (b.countUnknown ? 1 : 0) || (item.quantity?.basis === 'items' ? (a.quantityExplanation?.excessItems || 0) - (b.quantityExplanation?.excessItems || 0) : 0) || a.price * a.qty - b.price * b.qty);
    // Tilausapurin vaihtoehdot (order-tools) järjestävät näillä eivätkä nosta halvempaa väärää tyyppiä kärkeen:
    // typeRank = tyyppiryhmän järjestysnumero (0 = paras), match = nimen osuman taso (4 = pyydettyä tuotetta ei mainita),
    // requested = tuote on pyydettyä tuotetta. Kuratoidulla tuotetyypillä (maito, kerma, voi, munat) ryhmä on jo oikea.
    // Jos sanasto joutui arvaamaan sanan osan ("kuukivi|jogurtti" → jogurtti), mikään osuma ei ole pyydetty tuote.
    const guessed = r.understood.assumptions?.some((a) => a.item === i && a.code === 'WORD_CORRECTED' && a.dropped);
    let rank = 0;
    exact.forEach((p, j) => {
      if (j && compareKeys(info.get(exact[j - 1]).key, info.get(p).key)) rank += 1;
      p.typeRank = rank;
      const { tier, requested } = info.get(p);
      if (tier != null) { p.match = guessed ? TIER.NONE : tier; p.requested = !guessed && requested; }
    });
    // Pyydetyt tuotteet, joiden saatavuutta ei saatu: tilausapuri hakee niiden lähelle tuotteita, joiden saatavuus tunnetaan.
    const unknownIds = (wanted.length ? wanted : card.list).filter(unknownOf).slice(0, 10).map((p) => String(p.id));
    card.list = exact.length ? exact : substitutes;
    card.top = card.list.slice(0, 3); card.total = card.list.length;
    card.status = card.total ? 'ok' : 'no_match';
    card.notInCatalog = catalogMiss && !card.total;
    card.availabilityUnknown = unknownData && !card.total;
    card.requestedUnknown = !guessed && wantedUnknown && !exact.some((p) => p.requested !== false);
    if ((card.availabilityUnknown || card.requestedUnknown) && unknownIds.length) card.unknownIds = unknownIds;
    if (ingredient && !ingredient.options.length) card.ingredientUnavailable = { word: ingredient.word, unknown: ingredient.unknown };
    // Katalogin suodatinten lukumäärät eivät kuvaa tämän päivän saatavuutta.
    card.chips = card.chips.map(({ matches, ...chip }) => chip);
    if (!card.total) card.reason = nextDeliveryDate
      ? { code: 'NOT_AVAILABLE_ON_DATE', fi: 'Ei tilattavia tuotteita valitulle toimituspäivälle.', nextDeliveryDate, ...(cutoff ? { cutoffPassed: true } : {}) }
      : { code: 'NOT_AVAILABLE_ON_DATE', fi: 'Ei tilattavia tuotteita valitulle toimituspäivälle. Kokeile toista päivää tai tarkenna hakua.', ...(cutoff ? { cutoffPassed: true } : {}) };
  }
  r.gateway = { ...r.gateway, requestQuote: null };
  return r;
}

// ---------- Vastaavat tuotteet, kun pyydetyn tuotteen saatavuutta ei saada ----------
// Valion rajapinta ei vastaa, eikä pyydetystä tuotteesta (jäätelö) ole aiempaa tietoa. Toinen päivä ei auta, joten
// tarjotaan tuotteita, joiden saatavuus tunnetaan ja jotka sopivat samaan käyttöön. Ehdokkaat ovat vain tuotteita,
// joiden viimeisin oikea saatavuus oli "ok"; ruokavalio- ja allergeeniehdot pätevät. Valitsija (malli) saa vain nimet
// ja palauttaa tunnisteita listasta, ja tilattavuus tarkistetaan valinnan jälkeen tavallisella ehdolla.
// Ilman valitsijaa kelpaavat vain saman tuotealaryhmän tuotteet (neljä ensimmäistä numeroa samat).
const NON_FOOD = /^6/; // siivous-, pakkaus- ja kertakäyttötarvikkeet
const sharedDigits = (a, b) => { let n = 0; while (n < Math.min(a.length, b.length) && a[n] === b[n]) n += 1; return n; };
const fitsDiet = (p, item) => (item.claims || []).every((c) => p.labels?.includes(c)) && verifiedFree(item.excludeAllergens, p);

export async function knownAlternatives(item, date, { unknownIds = [], knownIds, pick = null, limit = 3, pool = 150 } = {}) {
  const cat = loadCatalog();
  const { lastKnownOkIds } = await import('./valioApi.mjs');
  const refs = unknownIds.map((id) => cat.get(String(id))).filter(Boolean);
  const skip = new Set(unknownIds.map(String));
  const refCats = refs.map((p) => String(p.category || ''));
  const temps = refs.map((p) => p.temp).filter(Boolean);
  const temp = temps.sort((a, b) => temps.filter((t) => t === b).length - temps.filter((t) => t === a).length)[0] || null;
  // Valmiin tuotteen (jäätelö, leivos, kastike) tilalle ei tarjota raaka-ainetta: pakastemansikka ehdotettiin jäätelölle (17.11.).
  // Raaka-ainetta pyydettäessä (mustikka) toinen raaka-aine kelpaa. Pyydetyn tuotteen kategoria tunnetaan unknownIds-tuotteista.
  const rawWanted = refs.some((p) => RAW_INGREDIENT.test(String(p.category || '')));
  // Valmisruoan tilalle vain sama ruoka (substitutes.mjs sameDish): lanttulaatikolle ei toista laatikkoruokaa. Pääraaka-aineen
  // tarjoaa jo haku (dishIngredient), joten mallia ei kysytä: ehdokkaat ovat saman ruoan tuotteita, joiden saatavuus tunnetaan.
  const dishRefs = dishesOf({ name: item.productTerm || '' }).length ? (refs.length ? refs : [{ name: item.productTerm }]) : null;
  const scored = (knownIds || lastKnownOkIds()).flatMap((id) => {
    const p = cat.get(String(id));
    if (!p || skip.has(String(p.id)) || NON_FOOD.test(String(p.category || '')) || !fitsDiet(p, item)) return [];
    if (dishRefs && !dishRefs.some((r) => sameDish(r, p))) return [];
    if (refs.length && !rawWanted && RAW_INGREDIENT.test(String(p.category || ''))) return [];
    const near = refCats.length ? Math.max(...refCats.map((c) => sharedDigits(c, String(p.category || '')))) : 0;
    return [{ p, near, sameTemp: temp && p.temp === temp ? 1 : 0 }];
  }).sort((a, b) => b.near - a.near || b.sameTemp - a.sameTemp || a.p.name.localeCompare(b.p.name, 'fi'));
  const candidates = scored.slice(0, pool);
  if (!candidates.length) return [];
  let picks;
  if (pick && !dishRefs) {
    try {
      const ids = new Set(candidates.map((c) => String(c.p.id)));
      const r = await pick({ term: item.productTerm, quantity: item.quantity || null, candidates: candidates.map((c) => ({ id: String(c.p.id), name: c.p.name })) });
      // Valitsija saa ehdottaa muutaman enemmän: osa voi pudota tilattavuustarkistuksessa (tilausaika, hinta, saldo).
      picks = (Array.isArray(r) ? r : []).filter((x) => x && ids.has(String(x.id))).slice(0, limit + 2)
        .map((x) => ({ id: String(x.id), term: typeof x.term === 'string' && x.term.trim() ? x.term.trim().slice(0, 60) : null, why: typeof x.reason === 'string' ? x.reason.trim().slice(0, 120) : null }));
    } catch { picks = null; }
  }
  if (!picks) picks = candidates.filter((c) => dishRefs || c.near >= 4).slice(0, limit).map((c) => ({ id: String(c.p.id), term: null, why: null }));
  if (!picks.length) return [];
  const quotes = await fetchQuotes(picks.map((x) => x.id), date);
  return picks.flatMap((x) => {
    const p = cat.get(x.id);
    let a = orderableProduct(p, quotes.get(x.id), date, item.quantity);
    // Eri mittayksikkö (1000 l jäätelöä → leivokset kappaleina): hinta yhdestä myyntierästä, määrä kysytään valinnan jälkeen.
    const askQuantity = !a.ok && a.code === 'UNIT_NOT_CONVERTIBLE';
    if (askQuantity) a = orderableProduct(p, quotes.get(x.id), date, { value: 1, unit: 'PCS' });
    return a.ok ? [{ ...a.product, alternativeFor: item.productTerm, alternativeTerm: x.term, askQuantity, why: x.why }] : [];
  }).slice(0, limit);
}

export async function reviewStorefront(rows, date) {
  const cat = loadCatalog();
  const quotes = await fetchQuotes(rows.map((r) => r.id), date, { fresh: true });
  const lines = [];
  for (const row of rows) {
    const p = cat.get(row.id);
    const a = orderableProduct(p, quotes.get(row.id), date, { value: row.qty, unit: 'PCS' });
    const avail = quotes.get(row.id)?.avail;
    const nextDeliveryDate = !avail?.stale && avail?.date > date && !cutoffPassed(avail.closingTime) ? avail.date : null;
    lines.push({ id: row.id, qty: row.qty, ...a,
      availability: avail ? { status: avail.status, deliveryDate: avail.date, stock: avail.amount ?? null, cutoffPassed: !!cutoffPassed(avail.closingTime), stale: !!avail.stale, source: avail.source } : { status: 'unknown' },
      nextDeliveryDate, alternatives: !a.ok && p ? await alternatives(p, row.qty, date, {}, cat) : [] });
  }
  return { deliveryDate: date, ok: lines.every((l) => l.ok), lines, checkedAt: clock.now().toISOString() };
}
