// Tilauskeskustelun tuotetyökalut (TYONJAKO.md, v1-sopimus, henkilö 3): suggest, quote ja submit.
// Malli ei valitse tuotteita, hintoja tai saatavuutta. Vaihtoehdot tulevat nykyisestä hausta ja saatavuusehdosta
// (storefront.mjs), tarjous ja tilaus gatewayn allekirjoitetusta ketjusta (gateway/service.mjs).
// confirmed tarkoittaa gatewayn demotallennusta. Se ei ole oikea Valio-tilaus.
import crypto from 'node:crypto';
import { openSqlite } from '../sqlite.mjs';
import { clock } from '../gateway/clock.mjs';
import { touchesBanned, verifiedFree, bannedHits } from '../allergens.mjs';
import { explainPicks } from './why.mjs';
import { itemsPerSalesUnit } from '../itemQuantities.mjs';
import { noDataFor } from '../data-limits.mjs';
import { allative } from '../fi-words.mjs';

const cap = (s) => (s ? s[0].toLocaleUpperCase('fi-FI') + s.slice(1) : s);

// Broileri, kana ja kananpoika ovat sama tuote: "broilerin rintafilee" haetaan tarvittaessa kana-sanalla.
const sameMeat = (term) => {
  const t = String(term || '').replace(/\bbroilerin\b/giu, 'kanan').replace(/\bbroileri\b/giu, 'kana').replace(/\bkananpojan\b/giu, 'kanan');
  return t !== term ? t : null;
};

const CLAIM_WORD = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu' };
const UNIT_WORD = { L: 'l', KG: 'kg', PCS: 'kpl' };
// Ruokavaatimus kysytään vain, kun se oikeasti jakaa tilattavat vaihtoehdot ja koskee niiden ainesosia (AM = maito).
const CLARIFY = [{ claim: 'FREE_FROM_LACTOSE', min: 0.2, max: 0.8, needsAllergen: 'AM' }];
const issue = (code, fi, extra = {}) => ({ code, message: fi, ...extra });
const validQuantity = (q) => q && Number.isFinite(q.value) && q.value > 0 && q.value <= 100000 && ['L', 'KG', 'PCS'].includes(q.unit);
const dayLabel = (iso) => new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Vaihtoehdot haetaan hakutekstillä, jossa kappalemäärä on kappaleita vain munille (quantityBasisFor). Tarjous käyttää samaa
// tulkintaa: malli merkitsi "5 sipulia" kappaleiksi, vaihtoehdot näytettiin myyntierinä ("5 säkkiä, yhteensä 50 kg"), mutta
// tarjous laski kappaleina eikä säkin sipulimäärää tiedetä: UNIT_NOT_CONVERTIBLE jokaiselle valinnalle (puhelinkuva 17.11.).
export function quotedQuantity(line, p) {
  const q = line.quantity;
  return q?.unit === 'PCS' && q.basis === 'items' && !itemsPerSalesUnit(p) ? { value: q.value, unit: 'PCS', basis: 'sales' } : q;
}

// Tarjouksessa kaatunut valinta ei palaa samoihin vaihtoehtoihin (puhelinkuva 17.11.: sipuli, valinta 3 → virhe → samat
// vaihtoehdot uudelleen). Keskustelu muistaa kaatuneet tuotteet rivillä päivän ja määrän kanssa: toinen päivä tai määrä voi käydä.
function failedIds(draft, line) {
  const f = line.failedOptions; const q = line.quantity || {};
  const same = f && f.deliveryDate === (draft.deliveryDate || null) && f.quantity?.value === q.value && f.quantity?.unit === q.unit && (f.quantity?.basis || 'sales') === (q.basis || 'sales');
  return new Set(same ? (f.ids || []).map(String) : []);
}

/** Tarjous sidotaan sisältöön: sama hash vain, jos asiakas, päivä, toimituspaikka, tuotteet ja määrät ovat samat. */
export function draftHash(customer, draft) {
  const lines = (draft.lines || []).map((l) => [l.ref, String(l.selectedProductId || ''), l.quantity?.value ?? null, l.quantity?.unit ?? null, l.quantity?.basis || 'sales']).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const diet = [[...(draft.diet?.claims || [])].sort(), [...(draft.diet?.excludeAllergens || [])].sort()];
  return crypto.createHash('sha256').update(JSON.stringify([customer.customerId, customer.bindingVersion, draft.id, draft.deliveryDate || null, draft.deliverySiteId || null, diet, lines])).digest('hex');
}

/** Hakuteksti nykyiselle tulkinnalle: määrä, ruokavaatimukset ja tuotesana. Tuotenumero haetaan sellaisenaan. */
// Myyntipakkauksen sanan pitää olla jäsentimen tuntema yksikkö (paketti). Tuntematon sana luettiin tuotesanaksi,
// jolloin raaka-aineen oma hylly ohittui: "3 pakkausta banaani" tarjosi banaanijogurttia.
export function lineQuery(line) {
  const q = line.quantity;
  const amount = q ? `${String(q.value).replace('.', ',')} ${q.unit === 'PCS' && q.basis !== 'items' ? 'pakettia' : UNIT_WORD[q.unit]} ` : '';
  const claims = (line.claims || []).map((c) => CLAIM_WORD[c]).filter(Boolean).join(' ');
  return `${amount}${claims ? `${claims} ` : ''}${line.productTerm}`.trim();
}

// Vaihtoehtojen järjestys ostajalle. Haku palauttaa halvimman tarpeen kattavan ensin, jolloin kärkeen nousi maustettuja
// tuotteita ja annospakkauksia. Tässä perustuote tulee ennen maustettua ja tarpeeseen sopiva pakkaus ennen ylisuurta tai
// kymmeniä pikkupakkauksia. Hinta ja haun oma hyllyjärjestys ratkaisevat tasatilanteet. Heuristiikka nimen sanoista:
// se vain järjestää, ei pudota mitään pois, ja ostaja valitsee aina itse.
// Tukkunimissä alkuperämaa ja pakkaustapa ("SIPULI 1KG PUSSI HOLLANTI", "VALKOSIPULI SOLO IRTO KIINA") eivät ole kuvailevia sanoja.
const NEUTRAL = /^(\d+([.,]\d+)?|x|l|dl|cl|ml|g|kg|kpl|uht|esl|hyla|fi|ja|laktoosit\w*|vähälaktoosi\w*|gluteenit\w*|luomu|rasvat\w*|kevyt|täys\w*|d-vitaminoitu|suomesta|suomi|suomalainen|kotimainen|pakaste|tuore|pesty|\w*suola\w*|irto|pussi|säkki|ltk|laatikko|rasia|purkki|prk|pkt|nippu|filmi|naku|kiina|hollanti|espanja|italia|ruotsi|norja|tanska|saksa|puola|viro|egypti|ranska|kreikka|turkki|israel|marokko|peru|chile|brasilia|intia|kenia|belgia|portugali|meksiko)$/;
const words = (text) => String(text || '').toLowerCase().replace(/[®™%&(),+]/g, ' ').split(/[\s/]+/).filter(Boolean);
// Maun tai mausteen sana tuotenimessä ("kolme sipulia", "valkosipuli", "mansikka"). Ostajan itse pyytämä maku ei ole poikkeama.
const FLAVOUR = /sipul|yrtt|chili|pippur|tilli|basilik|curry|pesto|tomaat|herkkusien|kantarell|savu|sitruun|lime|appelsiin|mansik|vadelm|mustik|banaan|mango|persik|kirsik|vanilj|suklaa|kaakao|karamel|kinuski|toffee|grilli|bbq|paprik/i;
const stemsOf = (line) => words(line.productTerm).map((w) => (w.length > 4 ? w.slice(0, -1) : w));
/** Ostaja pyysi nimenomaan maustamatonta: maustetut eivät kelpaa vaihtoehdoiksi lainkaan. */
export const wantsPlain = (line) => /maustamat|ilman\s+mau|luonnollinen|natural|plain/i.test(line.productTerm || '');
// Pyydetty sana yhdyssanan lopussa ei tee tuotteesta pyydettyä, jos alkuosa on maku tai mausteseos: yrtti|suola ja
// ranskanperunamauste|suola eivät ole suolaa (katselmus 15.11. #17), mansikka|jogurtti on maustettu jogurtti.
const SEASONING = /mauste|selleri|tryffel/i;
export const flavoured = (o, line) => {
  const term = stemsOf(line);
  return words(o.name).some((w) => {
    const t = term.find((x) => w.includes(x));
    if (!t) return FLAVOUR.test(w);
    const head = w.slice(0, w.indexOf(t));
    return head.length >= 3 && (FLAVOUR.test(head) || SEASONING.test(head)) && !term.some((x) => head.includes(x));
  });
};
export function rankOptions(found, line) { return scoreOptions(found, line).map((x) => x.o); }
/**
 * Järjestetyt vaihtoehdot. regular = paras tuotetyyppiryhmä, ei maustettu eikä hintapoikkeama, eli kelpaa halvimman
 * nostoon kärkeen. group = haun tyyppiryhmä (storefront typeRank: 0 = pyydetty tuote, isompi = valmiste tai muu tuote).
 * known = tarjottu määrä tunnetaan pyydetyssä yksikössä.
 */
export function scoreOptions(found, line) {
  const term = words(line.productTerm).map((w) => (w.length > 4 ? w.slice(0, -1) : w)); // taivutus: kerma ~ kerman, maito ~ maitoa
  const need = line.quantity?.value || 0;
  // Yli kaksi kertaa tavallisen (mediaani) hintainen vaihtoehto, kuten erikoistuote tai annospakkaus, ei kuulu kärkeen.
  // Mediaani eikä halvin: yksi poikkeuksellisen halpa tuote ei saa pudottaa kaikkia muita.
  const cost = (o) => (Number.isFinite(o.price) && o.price > 0 ? o.price * o.qty : null);
  const costs = found.map(cost).filter((c) => c !== null).sort((x, y) => x - y);
  const typical = costs.length ? costs[Math.floor((costs.length - 1) / 2)] : Infinity;
  // Haun tyyppiryhmä ratkaisee ensin: halvempi väärä tuote (tomaattimurska, kinkkumakkara) ei ohita pyydettyä tuotetta.
  // Ilman hakutietoa (injektoitu haku) kaikki ovat samaa ryhmää ja aiempi järjestys säilyy.
  const group = (o) => (Number.isFinite(o.typeRank) ? o.typeRank : 0);
  const best = found.length ? Math.min(...found.map(group)) : 0;
  const byMeasure = ['L', 'KG'].includes(line.quantity?.unit);
  const flavourTerm = FLAVOUR.test(line.productTerm || '');
  const score = (o) => {
    const brand = words(o.brand);
    // Kuvailevat sanat, jotka eivät ole merkki, koko, ruokavaliomerkintä tai itse tuote: "kolme sipulia", "mansikka".
    const extras = words(o.name).filter((w) => w.length > 2 && !/\d/.test(w) && !NEUTRAL.test(w) && !brand.includes(w) && !term.some((t) => w.includes(t))).length;
    const covered = o.quantityExplanation?.providedItems ?? (line.quantity?.unit === 'L' && o.litres ? o.qty * o.litres : line.quantity?.unit === 'KG' && o.kg ? o.qty * o.kg : null);
    const over = need && covered ? (covered - need) / need : 0;
    // Irtotavarana kiloittain tai litroittain myytävässä myyntierien määrä on itse tarve (18 kg perunaa = 18 erää), ei pikkupakkauksia.
    const loose = ['KG', 'L'].includes(String(o.unit || '').toUpperCase());
    const many = loose ? 0 : o.qty > 30 ? 2 : o.qty > 12 ? 1 : 0;
    // Kilo- tai litratarpeessa tuote, jonka määrää ei tiedetä samassa yksikössä (SIPULI NIPPU: 2 kpl), ei näytä kattavansa tarvetta.
    const fit = (over > 0.5 ? 2 : over > 0.1 ? 1 : 0) + many + (byMeasure && covered == null ? 3 : 0);
    // Yksi kuvaileva sana (lajike, tuotesarja) ei vielä tee tuotteesta maustettua. Näin haun oma hyllyjärjestys säilyy.
    // Isossa tilauksessa kaikki vaihtoehdot ovat kymmeniä eriä: silloin vähemmän käsiteltäviä eriä ensin.
    // Makusanana käytettävä tuote nimen loppupäässä on maku: "HAPANKAALI 400G VALKOSIPULI" on hapankaalia (haun match 1).
    const asFlavour = flavourTerm && o.match === 1;
    // Liian suuri: yli nelinkertainen tarve ja vähintään 5 kg tai litraa ylimääräistä, tai lava, jonka kokoa ei tiedetä.
    const pallet = String(o.unit || '').toUpperCase() === 'PAL';
    const oversize = (need && covered && covered > 4 * need && covered - need >= 5) || (pallet && byMeasure && covered == null) ? 1 : 0;
    return [group(o), extras >= 2 || asFlavour || flavoured(o, line) || (cost(o) !== null && cost(o) > 2 * typical) ? 1 : 0, fit + (pallet ? 2 : 0), !loose && o.qty > 30 ? o.qty : 0, byMeasure && covered == null ? 0 : 1, oversize];
  };
  return found.map((o, i) => ({ o, i, s: score(o) })).sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2] - b.s[2] || a.s[3] - b.s[3] || a.i - b.i)
    .map((x) => ({ o: x.o, group: x.s[0], regular: x.s[0] === best && x.s[1] === 0, known: x.s[4] === 1, oversize: x.s[5] === 1 }));
}

async function defaultDeps() {
  const [storefront, service, gwStore, catalog, nearbyPicker] = await Promise.all([
    import('../storefront.mjs'), import('../gateway/service.mjs'), import('../gateway/store.mjs'), import('../catalog.mjs'), import('./nearby.mjs'),
  ]);
  const cat = catalog.loadCatalog();
  const picker = nearbyPicker.createNearbyPicker();
  return {
    // Säännöt ilman mallikutsua: luonnoksen rivi on jo rakenteinen.
    search: async (line, deliveryDate) => {
      const r = await storefront.searchStorefront(lineQuery(line), { deliveryDate, llm: false });
      // Tyhjän tuloksen aikaisin päivä, jolle sama haku löytää tilattavaa (rajapinnan saatavuudesta), kulkee listan mukana.
      const list = r.cards[0]?.list || [];
      list.nextDeliveryDate = r.cards[0]?.reason?.nextDeliveryDate || null;
      list.cutoffPassed = r.cards[0]?.reason?.cutoffPassed === true;
      list.notInCatalog = r.cards[0]?.notInCatalog === true;
      list.availabilityUnknown = r.cards[0]?.availabilityUnknown === true;
      list.requestedUnknown = r.cards[0]?.requestedUnknown === true;
      list.unknownIds = r.cards[0]?.unknownIds || [];
      list.ingredientUnavailable = r.cards[0]?.ingredientUnavailable || null;
      return list;
    },
    // Vastaavat tilattavat tuotteet, kun pyydetyn tuotteen saatavuutta ei saada (nearby.mjs valitsee, storefront tarkistaa).
    nearby: (item, deliveryDate, unknownIds) => storefront.knownAlternatives(item, deliveryDate, { unknownIds, pick: picker }),
    product: (id) => cat.get(String(id)),
    buyer: (buyerId) => gwStore.buyers.byId(buyerId),
    requestQuote: service.requestQuote,
    placeOrder: service.placeOrder,
  };
}

/**
 * @param {object} [deps] search, product, buyer, requestQuote, placeOrder, permissions, now, dbPath.
 *   permissions(customer) palauttaa tuoreet oikeudet juuri ennen tilausta (henkilön 4 sovitin); oletus käyttää annettua kontekstia.
 */
export function createOrderingTools(deps = {}) {
  // Sama kello kuin gatewaylla (DEMO_NOW), jotta tarjouksen voimassaolo ei riipu kahdesta eri ajasta.
  const now = deps.now || (() => clock.now().getTime());
  let resolved;
  const d = async () => (resolved ||= { ...(deps.search && deps.requestQuote && deps.placeOrder && deps.buyer && deps.product ? {} : await defaultDeps()), ...deps });
  const db = openSqlite(deps.dbPath || ':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS tool_quotes (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, binding TEXT NOT NULL, draft_id TEXT NOT NULL, revision INTEGER NOT NULL,
    hash TEXT NOT NULL, expires INTEGER NOT NULL, offers TEXT NOT NULL, idem_key TEXT, result TEXT, created INTEGER NOT NULL)`);
  const saved = (id) => db.prepare('SELECT * FROM tool_quotes WHERE id=?').get(String(id || ''));
  const allowed = (customer, what) => customer?.customerId && customer.buyerId && customer.permissions?.[what] === true;

  function unsafe(product, line) {
    const banned = line.excludeAllergens || [];
    if (!banned.length) return false;
    // Puuttuva allergeenitieto ei ole todiste sopivuudesta. Kielto katsoo koodihierarkian: pähkinä (AN) kattaa mantelin (SA).
    return !verifiedFree(banned, product);
  }

  /**
   * @param {object} o
   * @param {object} [o.exclude] { [ref]: productId[] } jo näytetyt vaihtoehdot. Annettuna palautetaan seuraavat samalle
   *   päivälle tilattavat vaihtoehdot ilman toistoja ("Näytä lisää vaihtoehtoja"). Ilman sitä ensimmäinen sivu.
   * @param {number} [o.limit] vaihtoehtoja riviä kohden (1–5, oletus 3).
   */
  async function suggest({ customer, draft, exclude = {}, limit = 3 }) {
    if (!allowed(customer, 'readProducts')) return { lines: [], issues: [issue('NOT_PERMITTED', 'Asiakkuudella ei ole oikeutta tuotetietoihin.')] };
    const size = Math.min(5, Math.max(1, Math.floor(Number(limit) || 3)));
    const issues = [];
    if (!validDate(draft.deliveryDate)) issues.push(issue('DELIVERY_DATE_MISSING', 'Toimituspäivä puuttuu.'));
    for (const l of draft.lines) if (!validQuantity(l.quantity)) issues.push(issue('QUANTITY_MISSING', `Määrä puuttuu: ${l.productTerm}.`, { ref: l.ref }));
    if (issues.length) return { lines: [], issues };
    const { search, product, nearby, popularity } = await d();
    // Asiakkaidemme vahvistetut tilaukset: suosituin näytetään ensimmäisellä sivulla ja merkitään (Eelis 17.11.).
    let counts = null;
    if (popularity) { try { counts = await popularity(); } catch { counts = null; } }
    const ordered = (o) => counts?.get(String(o.id)) || 0;
    // Laktoositon maitotuote (laktoositon-merkintä ja maitoa ainesosana): kananmunien satunnainen merkintä ei kuulu tähän.
    const lactoseFreeDairy = (id) => { const p = product(id); return !!p && (p.labels || []).includes('FREE_FROM_LACTOSE') && bannedHits(['AM'], p.contains || []).length > 0; };
    const lines = [];
    // Koko tilauksen ruokavalio (draft.diet): allergeenia sisältävä tuote putoaa aina pois. Tuote, jolta allergeenitieto puuttuu
    // (esim. tuoreet kasvikset), näytetään varoituksen kanssa, ja merkintää vailla olevat näytetään vain, jos merkittyjä ei ole.
    // Rivin oma vaatimus (line.claims, line.excludeAllergens) on tiukka: varmentamaton ei kelpaa.
    const diet = { claims: draft.diet?.claims || [], excludeAllergens: draft.diet?.excludeAllergens || [] };
    for (const line of draft.lines) {
      let found; let soft = [];
      const extra = diet.claims.filter((c) => !(line.claims || []).includes(c));
      // Merkinnällä rajattu haku voi palauttaa saman tuoteryhmän muita merkittyjä tuotteita, kun itse tuotteella ei ole
      // merkintää (gluteeniton + tilli antoi maustesuolaa). Jos yksikään osuma ei ole pyydettyä tuotetta, näytetään
      // pyydetty tuote ja kerrotaan puuttuva merkintä tuotekohtaisesti.
      const stems = words(line.productTerm).map((w) => (w.length > 4 ? w.slice(0, -1) : w));
      // Haku kertoo itse, onko vaihtoehto pyydettyä tuotetta (requested). Hylly- ja synonyymihaku ("kana" → broileri) osuu
      // silloin oikein, vaikka nimessä ei lue sama sana, eikä pelkkä kirjolohi ole lohta. Ilman hakutietoa (kuratoitu tuotetyyppi,
      // injektoitu haku) verrataan sanoja kuten ennenkin.
      const onTerm = (o) => (typeof o.requested === 'boolean' ? o.requested : stems.some((t) => String(o.name || '').toLowerCase().includes(t)));
      try {
        found = await search(extra.length ? { ...line, claims: [...(line.claims || []), ...extra] } : line, draft.deliveryDate);
        if (extra.length && !found.some(onTerm)) { const plain = await search(line, draft.deliveryDate); if (plain.length) { found = plain; soft = extra; } }
        // Broileri, kana ja kananpoika ovat sama tuote. "Broilerin rintafilee" osui pakastehyllyyn, jonka hintoja ei ole tiedossa,
        // vaikka Kariniemen kananpojan rintafileillä on (paikallinen koe 17.11.). Haetaan silloin uudelleen kana-sanalla.
        const kana = sameMeat(line.productTerm);
        if (kana && !found.length && (found.availabilityUnknown || found.requestedUnknown)) {
          const again = await search({ ...line, productTerm: kana }, draft.deliveryDate);
          if (again.length) found = again;
        }
      } catch { issues.push(issue('SEARCH_FAILED', `Tuotehaku ei onnistunut: ${line.productTerm}. Hintoja tai saatavuutta ei näytetä.`, { ref: line.ref })); continue; }
      let fit = found.filter((o) => !unsafe(product(o.id), line));
      if (diet.excludeAllergens.length) {
        const has = (o) => touchesBanned(diet.excludeAllergens, product(o.id));
        fit = fit.filter((o) => !has(o));
      }
      // Väärä mitta ja pyydetty tuote vain makuna nimen lopussa: "3 kg suklaata" ei ole "18x Oatly Kaurajuoma Suklaa 2,5 dl",
      // joka oli pähkinättömän suklaan ainoa vaihtoehto (WhatsApp-koe 17.11.). Pelkkä mitan ero ei pudota (jäätelö kiloina).
      const wrongMeasure = (o) => (line.quantity?.unit === 'KG' && !(o.kg > 0) && o.litres > 0) || (line.quantity?.unit === 'L' && !(o.litres > 0) && o.kg > 0);
      fit = fit.filter((o) => !(wrongMeasure(o) && o.match === 1));
      const failed = failedIds(draft, line);
      if (failed.size && fit.length) {
        fit = fit.filter((o) => !failed.has(String(o.id)));
        if (!fit.length) { issues.push(issue('NO_ORDERABLE_PRODUCT', `Muita tilattavia vaihtoehtoja päivälle ${dayLabel(draft.deliveryDate)} ei löytynyt: ${line.productTerm}.`, { ref: line.ref, nextDeliveryDate: null })); continue; }
      }
      let scored = scoreOptions(fit, line);
      // nextDeliveryDate: aikaisin päivä, jolle haku löytää tilattavaa, kun haku sen tietää (muuten null).
      // Valikoimassa ei ole pyydettyä tuotetta lainkaan (tuore tryffeli): sanotaan se, ei toimituspäivän ongelmaksi.
      // Pyydetyn tuotteen saatavuutta ei saatu (rajapinta alhaalla, ei aiempaa tietoa): toinen päivä ei auta, joten tarjotaan
      // tuotteita, joiden saatavuus tunnetaan ja jotka sopivat samaan käyttöön. Ostaja valitsee itse; mitään ei vaihdeta hiljaa.
      const unknownAvail = !scored.length && !found.length && !found.notInCatalog && (found.availabilityUnknown || found.requestedUnknown);
      if (unknownAvail && nearby && !Object.keys(exclude).length) {
        let alts = [];
        try {
          alts = await nearby({ productTerm: line.productTerm, quantity: line.quantity, claims: [...new Set([...(line.claims || []), ...diet.claims])],
            excludeAllergens: [...new Set([...(line.excludeAllergens || []), ...diet.excludeAllergens])] }, draft.deliveryDate, found.unknownIds || []);
        } catch { alts = []; }
        if (alts.length) {
          // Laktoosittomat maitotuotteet ensin, kun ostaja ei ole sanonut laktoosista mitään (Eelis 17.11.: juustoista
          // laktoosittomat ensin). Järjestys muuten valitsijan.
          if (!draft.diet?.known) alts = [...alts.filter((o) => lactoseFreeDairy(o.id)), ...alts.filter((o) => !lactoseFreeDairy(o.id))];
          lines.push({ ref: line.ref, total: alts.length, more: false, shownBefore: 0, exact: false, availabilityUnknown: true, alternatives: true, clarify: [],
            options: alts.map((o, i) => ({
              productId: String(o.id), name: o.name, brand: o.brand || null, salesUnits: o.qty, salesUnitLabel: o.unitLabel,
              covers: o.askQuantity ? null : o.litres ? { value: +(o.qty * o.litres).toFixed(2), unit: 'L' } : o.kg ? { value: +(o.qty * o.kg).toFixed(2), unit: 'KG' } : null,
              unitPriceNet: o.price, lineNet: +(o.price * o.qty).toFixed(2), deliveryDate: o.availability?.deliveryDate || draft.deliveryDate,
              cutoff: o.availability?.closingTime || null, stock: o.availability?.stock ?? null, labels: o.labels || [], note: null, lactoseFree: lactoseFreeDairy(o.id),
              co2PerKg: Number.isFinite(product(o.id)?.co2) ? product(o.id).co2 : null,
              deliveryReliability: Number.isFinite(product(o.id)?.reliability) ? product(o.id).reliability : null,
              // Valinta vaihtaa rivin tuotteen (replaceTerm). Eri mittayksikössä määrä kysytään uudelleen (askQuantity).
              why: o.why || null, replaceTerm: o.alternativeTerm || o.name, askQuantity: o.askQuantity === true, warning: null,
              pick: { place: i + 1, codes: ['SIMILAR_KNOWN'] }, // why.mjs: vastaava tuote, jonka saatavuus tunnetaan
            })) });
          continue;
        }
      }
      if (!scored.length) {
        issues.push(found.notInCatalog
          ? issue('NO_ORDERABLE_PRODUCT', `Pyydettyä tuotetta ei ole valikoimassa: ${line.productTerm}.`, { ref: line.ref, nextDeliveryDate: null, notInCatalog: true })
          // Saatavuustietoa ei saatu (rajapinta alhaalla, ei välimuistissa): sanotaan se, ei väitetä tuotetta saatavuudettomaksi.
          : !found.length && (found.availabilityUnknown || found.requestedUnknown)
            ? issue('NO_ORDERABLE_PRODUCT', noDataFor([line.productTerm]), { ref: line.ref, nextDeliveryDate: null, availabilityUnknown: true })
          : found.cutoffPassed
            ? issue('NO_ORDERABLE_PRODUCT', `Tilausaika toimitukselle ${dayLabel(draft.deliveryDate)} on jo mennyt: ${line.productTerm}.`, { ref: line.ref, nextDeliveryDate: found.nextDeliveryDate || null, cutoffPassed: true })
          : issue('NO_ORDERABLE_PRODUCT', `Ei tilattavaa tuotetta päivälle ${dayLabel(draft.deliveryDate)}: ${line.productTerm}.`, { ref: line.ref, nextDeliveryDate: found.nextDeliveryDate || null }));
        // Valmisruoan pääraaka-aine on valikoimassa, mutta sitäkään ei saa tilattua (lanttu ilman Valion hintaa): sanotaan se.
        const ing = found.ingredientUnavailable;
        if (ing?.word && !found.notInCatalog) {
          const head = `${cap(allative(line.productTerm))} kävisi korvaajaksi raaka-aine ${ing.word}, mutta`;
          issues.push(issue('INGREDIENT_UNAVAILABLE', ing.unknown ? `${head} sen hintaa ja saatavuutta en nyt saa tarkistettua.`
            : `${head} päivälle ${dayLabel(draft.deliveryDate)} sitäkään ei ole tilattavana.`, { ref: line.ref, unknown: ing.unknown === true }));
        }
        continue;
      }
      // Asiakkaan selvä ehto (maustamaton) rajaa vaihtoehdot: maustettua ei tarjota edes halvimpana.
      if (wantsPlain(line)) {
        scored = scored.filter((x) => !flavoured(x.o, line));
        if (!scored.length) { issues.push(issue('NO_ORDERABLE_PRODUCT', `Maustamatonta vaihtoehtoa ei löytynyt päivälle ${dayLabel(draft.deliveryDate)}: ${line.productTerm}.`, { ref: line.ref })); continue; }
      }
      // Koko tilauksen allergiakielto: allergeenivapaaksi todennetut vaihtoehdot ennen tuotteita, joilta allergeenitieto puuttuu
      // (itsepeli V033: maitoallergiselle lapselle tarjottiin ensin jäätelöä ilman allergeenitietoa). Vain kun kielletty allergeeni
      // oikeasti esiintyy saman haun tuotteissa (jäätelö ja maito): tuoreilla kasviksilla tietoa ei ole eikä riskiä, joten niiden
      // järjestys säilyy. Mitään ei pudoteta: ilman todennettua vaihtoehtoa tuote ilman tietoa näytetään varoituksella.
      const verified = (x) => !!product(x.o.id)?.hasAllergenData;
      const risky = diet.excludeAllergens.length > 0 && found.some((o) => touchesBanned(diet.excludeAllergens, product(o.id)));
      const dietVerified = risky && scored.some(verified);
      if (dietVerified) scored = [...scored.filter(verified), ...scored.filter((x) => !verified(x))];
      fit = scored.map((x) => x.o);
      // Laktoosikysymys vain, jos ainakin yhdessä oikeassa vaihtoehdossa on tunnettu maitoainesosa: kananmunien
      // satunnaiset laktoositon-merkinnät eivät tee kysymyksestä olennaista.
      // Tarkennus lasketaan pyydetyn tuotteen omista vaihtoehdoista, ja laktoosia kysytään vain maitotuotteesta (vähintään
      // puolessa vaihtoehdoista maitoa): perunahaun yksittäinen maitoa sisältävä muusi ei tee kysymyksestä olennaista (itsepeli X097).
      const own = fit.filter(onTerm); const base = own.length ? own : fit;
      // Osuus lasketaan tuotteista, joiden allergeenitieto tunnetaan: puuttuva tieto ei ole todiste kumpaankaan suuntaan.
      // Tiedon pitää kuitenkin kattaa vähintään puolet vaihtoehdoista: tuoreella perunalla sitä ei ole, ja kaksi tunnettua
      // jalostettua perunatuotetta (yksi maitoa) kysyi laktoosia 25 kilon perunasta (itsepeli X022, peruna 2/23 tunnettu).
      const known = base.filter((o) => product(o.id)?.hasAllergenData);
      const ingredientShare = (allergen) => (known.length ? known.filter((o) => bannedHits([allergen], product(o.id).contains).length).length / known.length : 0);
      const mostlyContains = (allergen) => known.length >= base.length / 2 && ingredientShare(allergen) >= 0.5;
      const clarify = CLARIFY.filter((c) => !(line.claims || []).includes(c.claim) && (!c.needsAllergen || mostlyContains(c.needsAllergen)))
        .map((c) => ({ claim: c.claim, share: base.filter((o) => o.labels?.includes(c.claim)).length / base.length, ...c }))
        .filter((c) => base.length >= 3 && c.share >= c.min && c.share <= c.max).map((c) => c.claim);
      // Halvin nostetaan kärkeen vain parhaan tyyppiryhmän tavallisista, joiden määrä tunnetaan: maustettu, poikkeava tai
      // väärää tyyppiä oleva tuote ei ohita järjestystä halvimpana, eikä sipulinippu kilotarpeeseen.
      // Ensimmäinen sivu näyttää vain pyydettyä tuotetta, kun sellaista on (haun requested): kaksi tuorehiivaa eikä kuivahiivaa
      // kolmanneksi. Saman pääsanan muut tuotteet ja valmisteet jäävät "Näytä lisää" -sivulle, mitään ei pudoteta.
      let first = scored.some((x) => x.o.requested === true) ? scored.filter((x) => x.o.requested === true) : scored;
      // Moninkertaisesti liian suuri erä (lava tai säkkikuorma) ei tule ensimmäiselle sivulle, kun tarpeen kattava pienempi
      // pakkaus on tarjolla (itsepeli X096: kuormalava 3 kg:n sokeritarpeeseen). Lisäsivulla se näkyy edelleen.
      const sane = first.filter((x) => !x.oversize);
      if (sane.length && sane.some((x) => x.known)) first = sane;
      // Ensimmäiselle sivulle vain todennetut, kun niitä on; tuote ilman allergeenitietoa jää "Näytä lisää" -sivulle.
      if (dietVerified && first.some(verified)) first = first.filter(verified);
      const top0 = first[0].group;
      const flat = (x) => !flavoured(x.o, line);
      const pick = [(x) => x.regular && x.known, (x) => x.regular, (x) => x.group === top0 && x.known && flat(x), (x) => x.group === top0 && x.known, (x) => x.group === top0]
        .map((f) => first.filter(f)).find((xs) => xs.length);
      const cheapest = pick.map((x) => x.o).reduce((a, b) => (b.price * b.qty < a.price * a.qty ? b : a));
      const groupOf = new Map(scored.map((x) => [x.o, x.group]));
      const seen = new Set((exclude[line.ref] || []).map(String));
      let top; let rest;
      if (seen.size) {
        // Lisäsivu: seuraavat järjestyksessä, jo näytetyt pois. Ensimmäisen sivun nostama halvin on jo näytetty.
        rest = fit.filter((o) => !seen.has(String(o.id)));
        if (!rest.length) { issues.push(issue('NO_MORE_OPTIONS', `Muita vaihtoehtoja päivälle ${dayLabel(draft.deliveryDate)} ei löytynyt: ${line.productTerm}.`, { ref: line.ref })); continue; }
        top = rest.slice(0, size);
      } else {
        // Halvin tarpeen kattava vaihtoehto on aina ensimmäisellä sivulla, vaikka järjestys suosisi isompaa pakkausta.
        rest = fit;
        top = first.map((x) => x.o).slice(0, size);
        if (!top.includes(cheapest)) top[top.length - 1] = cheapest;
      }
      // Näytettävien sisällä yli kaksi kertaa halvimman hintainen vaihtoehto siirtyy muiden jälkeen
      // (peruna 20 kg näytti ensin 72,40 €:n säkin ja halvimman 13,30 € kolmantena). Muu järjestys säilyy.
      const floor = cheapest.price * cheapest.qty;
      const pricey = (o) => (Number.isFinite(floor) && floor > 0 && o.price * o.qty > 2 * floor ? 1 : 0);
      // Suosituin (vähintään kahdessa tilauksessa) tulee ensimmäiselle sivulle ja oman ryhmänsä kärkeen. Halvin pysyy mukana.
      const favourite = !seen.size && counts ? first.map((x) => x.o).filter((o) => ordered(o) >= 2).sort((a, b) => ordered(b) - ordered(a))[0] : null;
      if (favourite && !top.includes(favourite)) {
        const slot = top.map((o, i) => i).reverse().find((i) => top[i] !== cheapest);
        if (slot !== undefined) top[slot] = favourite;
      }
      top.sort((a, b) => groupOf.get(a) - groupOf.get(b) || pricey(a) - pricey(b) || ordered(b) - ordered(a));
      // more: tälle päivälle on vielä näyttämättömiä vaihtoehtoja seuraavalle sivulle.
      const more = rest.some((o) => !top.includes(o));
      // Miksi juuri nämä: tallentuu vaihtoehtojen mukana agentin jälkeä varten (why.mjs). Ei muuta järjestystä.
      const why = explainPicks({ found, fit, scored, first, top, cheapest, seen, onTerm, pricey, more, size });
      // exact=false: yksikään tilattava vaihtoehto ei ole pyydettyä tuotetta (strutsinmuna -> viiriäisen munat). Kerrotaan ostajalle.
      lines.push({ ref: line.ref, total: fit.length, more, shownBefore: seen.size, exact: fit.some(onTerm),
        // Pyydetyn tuotteen saatavuus on tuntematon (rajapinta alhaalla): lähimmät vaihtoehdot eivät todista sen puuttumista.
        ...(!fit.some(onTerm) && found.requestedUnknown ? { availabilityUnknown: true } : {}),
        // Kaikki näytetyt ovat valmisruoan pääraaka-ainetta (lanttulaatikko → lanttu): ydin kertoo sen otsikossa.
        ...(!fit.some(onTerm) && top.every((o) => o.ingredientWord) ? { ingredient: top[0].ingredientWord } : {}), clarify, options: top.map((o) => ({
        productId: String(o.id), name: o.name, brand: o.brand || null, salesUnits: o.qty, salesUnitLabel: o.unitLabel,
        covers: o.countUnknown ? null : o.quantityExplanation ? { value: o.quantityExplanation.providedItems, unit: 'PCS' } : o.litres ? { value: +(o.qty * o.litres).toFixed(2), unit: 'L' } : o.kg ? { value: +(o.qty * o.kg).toFixed(2), unit: 'KG' } : null,
        unitPriceNet: o.price, lineNet: +(o.price * o.qty).toFixed(2), deliveryDate: o.availability?.deliveryDate || draft.deliveryDate,
        cutoff: o.availability?.closingTime || null, // tilausaikaraja; ydin muotoilee sen kiireisessä tilauksessa
        stock: o.availability?.stock ?? null, labels: o.labels || [], note: o.quantityExplanation?.text || null, lactoseFree: lactoseFreeDairy(o.id),
        ...(counts ? { orderedCount: ordered(o) } : {}), ...(favourite === o ? { popular: true } : {}),
        // Pakkauksen kappalemäärä tuntematon: hinta yhdestä myyntierästä, määrä kysytään valinnan jälkeen myyntierinä.
        ...(o.countUnknown ? { askQuantity: true, countUnknown: true } : {}),
        // Pääraaka-aine: valinta vaihtaa rivin tuotteeksi raaka-aineen (lanttu 5 kg), eri mittayksikössä määrä kysytään.
        ...(o.ingredientWord ? { ingredient: true, replaceTerm: o.ingredientWord, ...(o.askQuantity ? { askQuantity: true } : {}) } : {}),
        // Katalogin hiilijalanjälki (kg CO2e/kg) ja toimitusvarmuus (0–1): ydin vastaa niillä vertailukysymykseen, ei malli.
        co2PerKg: Number.isFinite(product(o.id)?.co2) ? product(o.id).co2 : null,
        deliveryReliability: Number.isFinite(product(o.id)?.reliability) ? product(o.id).reliability : null,
        why: o.substituteFor ? `Korvaa tuotteen ${o.substituteFor.name}` : o.ingredientWord ? `Raaka-aine, josta ${o.ingredientFor} tehdään` : null,
        pick: why(o), pool: why.pool,
        warning: [soft.filter((c) => !o.labels?.includes(c)).length ? `Ei merkintää: ${soft.filter((c) => !o.labels?.includes(c)).map((c) => CLAIM_WORD[c] || c).join(', ')}` : null, diet.excludeAllergens.length && !product(o.id)?.hasAllergenData ? 'allergeenitieto puuttuu, tarkista itse' : null].filter(Boolean).join('; ') || null,
      })) });
    }
    return { lines, issues };
  }

  async function quote({ customer, draft }) {
    const fail = (...issues) => ({ quoteId: null, draftId: draft.id, revision: draft.revision, expiresAt: null, lines: [], totals: null, issues });
    if (!allowed(customer, 'readProducts')) return fail(issue('NOT_PERMITTED', 'Asiakkuudella ei ole oikeutta tarjoukseen.'));
    if (!validDate(draft.deliveryDate)) return fail(issue('DELIVERY_DATE_MISSING', 'Toimituspäivä puuttuu.'));
    if (!draft.lines?.length) return fail(issue('EMPTY_DRAFT', 'Tilausluonnoksessa ei ole tuotteita.'));
    const open = draft.lines.filter((l) => !l.selectedProductId || !validQuantity(l.quantity));
    if (open.length) return fail(...open.map((l) => issue(l.selectedProductId ? 'QUANTITY_MISSING' : 'PRODUCT_NOT_SELECTED', `Valinta tai määrä puuttuu: ${l.productTerm}.`, { ref: l.ref })));
    const { buyer, requestQuote, product } = await d();
    const b = buyer(customer.buyerId);
    if (!b) return fail(issue('BUYER_UNKNOWN', 'Asiakkuutta ei löydy tilausjärjestelmästä.'));
    const dietBan = draft.diet?.excludeAllergens || [];
    const bad = draft.lines.filter((l) => unsafe(product(l.selectedProductId), l) || touchesBanned(dietBan, product(l.selectedProductId)));
    if (bad.length) return fail(...bad.map((l) => issue('ALLERGEN_CONFLICT', `Valittu tuote ei täytä allergiavaatimusta: ${l.productTerm}.`, { ref: l.ref })));
    let q;
    try {
      q = await requestQuote(b, { deliveryDate: draft.deliveryDate, maxOptions: 1, needs: draft.lines.map((l) => ({ ref: l.ref, candidates: [String(l.selectedProductId)], quantity: quotedQuantity(l, product(l.selectedProductId)), allowSubstitutes: false })) });
    } catch { return fail(issue('QUOTE_FAILED', 'Hinnan ja saatavuuden tarkistus ei onnistunut. Tilausta ei voi vielä hyväksyä.')); }
    const issues = []; const lines = []; const offers = []; let expires = Infinity;
    for (const need of q.needs) {
      const line = draft.lines.find((l) => l.ref === need.ref); const o = need.options[0];
      if (!o || o.kind !== 'exact') { issues.push(issue(need.excluded?.[0]?.code || 'NOT_AVAILABLE', `Ei tilattavissa: ${line?.productTerm || need.ref}. ${need.excluded?.[0]?.message || ''}`.trim(), { ref: need.ref, productId: line?.selectedProductId ? String(line.selectedProductId) : null, reason: need.excluded?.[0]?.message || null })); continue; }
      // Eri toimituspäivä vaatii ostajan uuden valinnan, sitä ei hyväksytä hiljaa.
      if (o.deliveryDate !== draft.deliveryDate) { issues.push(issue('DELIVERY_DATE_SHIFT', `${o.lines[0].name} toimitetaan vasta ${o.deliveryDate}.`, { ref: need.ref, deliveryDate: o.deliveryDate, productId: String(o.lines[0].productId), reason: `toimitetaan vasta ${dayLabel(o.deliveryDate)}` })); continue; }
      const l = o.lines[0];
      lines.push({ ref: need.ref, productId: l.productId, name: l.name, salesUnits: l.quantity, salesUnitLabel: l.salesUnitLabel, covers: { value: l.covers, unit: line.quantity.unit }, unitPriceNet: l.unitPriceNet, lineNet: l.lineNet, vatRate: l.vatRate, stockKnown: l.availability.stockKnown, cutoff: o.cutoff, cutoffLabel: o.cutoffLabel,
        comparisonPrice: l.comparisonPrice ?? null, comparisonUnit: l.comparisonUnit ?? null, // Valion hintarajapinnan vertailuhinta korisivulle
        priceCurrent: l.priceCurrent !== false, priceFetchedAt: l.priceFetchedAt ?? null }); // false: viimeisin tunnettu hinta (korisivun huomio)
      offers.push(o.offer); expires = Math.min(expires, Date.parse(o.expiresAt));
    }
    if (issues.length) return fail(...issues);
    const net = +lines.reduce((s, l) => s + l.lineNet, 0).toFixed(2);
    const vat = +lines.reduce((s, l) => s + l.lineNet * l.vatRate / 100, 0).toFixed(2);
    db.prepare('INSERT INTO tool_quotes(id,customer_id,binding,draft_id,revision,hash,expires,offers,created) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(q.quoteId, customer.customerId, String(customer.bindingVersion), draft.id, draft.revision, draftHash(customer, draft), expires, JSON.stringify(offers), now());
    return { quoteId: q.quoteId, draftId: draft.id, revision: draft.revision, expiresAt: new Date(expires).toISOString(), deliveryDate: draft.deliveryDate, lines, totals: { net, vat, gross: +(net + vat).toFixed(2), currency: 'EUR' }, issues: [] };
  }

  async function submit({ customer, draft, quoteId, approval, idempotencyKey }) {
    const reject = (code, fi) => ({ status: 'rejected', orderId: null, reasons: [issue(code, fi)] });
    const q = saved(quoteId);
    const key = String(idempotencyKey || '');
    if (key.length < 8) return reject('IDEMPOTENCY_KEY_REQUIRED', 'Tilauksen tunniste puuttuu.');
    // Saman lähetyksen uusinta palauttaa saman tuloksen, vaikka tarjous olisi jo vanhentunut.
    if (q?.result && q.idem_key === key && q.customer_id === customer?.customerId) return JSON.parse(q.result);
    const fresh = deps.permissions ? await deps.permissions(customer) : customer?.permissions;
    if (!allowed({ ...customer, permissions: fresh }, 'placeOrders')) return reject('NOT_PERMITTED', 'Asiakkuudella ei ole tilausoikeutta.');
    if (!q || q.customer_id !== customer.customerId || q.binding !== String(customer.bindingVersion)) return reject('QUOTE_NOT_FOUND', 'Tarjousta ei löydy tälle asiakkuudelle.');
    if (!approval || approval.draftId !== draft.id || approval.revision !== draft.revision || approval.quoteId !== q.id || q.draft_id !== draft.id || q.revision !== draft.revision)
      return reject('APPROVAL_MISMATCH', 'Hyväksyntä ei koske tätä luonnosversiota. Tarkista yhteenveto uudelleen.');
    if (q.hash !== draftHash(customer, draft)) return reject('DRAFT_CHANGED', 'Luonnos on muuttunut tarjouksen jälkeen. Tarkista yhteenveto uudelleen.');
    if (q.result) return reject('QUOTE_ALREADY_USED', 'Tarjous on jo käytetty.');
    // Kiertävä demokello palaa alkuun: myöhemmin tallennettu tarjous kuin nyt tarkoittaa edellistä kierrosta (katselmus 15.11. #16).
    if (q.expires <= now() || q.created > now()) return reject('QUOTE_EXPIRED', 'Tarjous on vanhentunut. Tarkista hinnat uudelleen.');
    const { buyer, placeOrder } = await d();
    const b = buyer(customer.buyerId);
    if (!b) return reject('BUYER_UNKNOWN', 'Asiakkuutta ei löydy tilausjärjestelmästä.');
    let order;
    // Virhe ei tuota onnistumiskuittausta. Gatewayn oma idempotenssi estää kaksoistilauksen uusinnassa.
    // Asiakkaan allergiakielto (koko tilaus ja rivit) kulkee portille: tuote ilman allergeenitietoa ei vahvistu ilman ihmistä (V033).
    const excludeAllergens = [...new Set([...(draft.diet?.excludeAllergens || []), ...draft.lines.flatMap((l) => l.excludeAllergens || [])])];
    try { order = await placeOrder(b, { offers: JSON.parse(q.offers), idempotencyKey: key, buyerReference: `whatsapp:${draft.id}`, requestedBy: customer.personName || null, ...(excludeAllergens.length ? { excludeAllergens } : {}) }); } catch { return reject('ORDER_FAILED', 'Tilauksen tallennus ei onnistunut. Tilausta ei ole tehty.'); }
    const result = { status: order.status, orderId: order.orderId, deliveryDate: order.deliveryDate || null, totals: order.totals || null, approvalUrl: order.approval?.url || null,
      reasons: (order.reasons || []).map((r) => ({ code: r.code, message: r.message, severity: r.severity })) };
    db.prepare('UPDATE tool_quotes SET idem_key=?, result=? WHERE id=?').run(key, JSON.stringify(result), q.id);
    return result;
  }

  return { suggest, quote, submit, prune() { db.prepare('DELETE FROM tool_quotes WHERE created<?').run(now() - 7 * 86400_000); }, close: () => db.close() };
}
