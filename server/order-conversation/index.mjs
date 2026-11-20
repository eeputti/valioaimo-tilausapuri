// Tilauskeskustelu (TYONJAKO.md, v1-sopimus, henkilö 2).
// Luonnos säilyy palvelimella viestien välillä. Kielimalli tai säännöt tulkitsevat viestin muutoksiksi (interpret.mjs),
// mutta jokainen muutos tarkistetaan ja toteutetaan täällä, ja kaikki vastaustekstit hintoineen kootaan koodissa
// työkalujen palauttamista tiedoista. Tilaus lähtee vain, kun ostaja vastaa TILAA juuri näytettyyn yhteenvetoon.
import crypto from 'node:crypto';
import { CLAIMS, DEADLINE_QUESTION } from './interpret.mjs';
import { helsinkiLabel, parseApiTime } from '../gateway/clock.mjs';
import { packWord, readableName, substituteTerm, summaryRow, optionRow } from './wording.mjs';
import { isEggItem } from '../itemQuantities.mjs';
import { DATA_REASON, HAVE, NO_DATA, noDataFor } from '../data-limits.mjs';
import { allative } from '../fi-words.mjs';

const UNIT_FI = { L: 'l', KG: 'kg', PCS: 'kpl' };
const CLAIM_FI = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu' };
const ALLERGEN_FI = { AM: 'maidoton', AW: 'ei gluteeniviljoja', AE: 'munaton', AN: 'pähkinätön', AP: 'ei maapähkinää', AF: 'kalaton', AY: 'soijaton', AC: 'ei äyriäisiä', AS: 'ei seesamia', BC: 'ei selleriä', BM: 'ei sinappia' , UW: 'ei vehnää', ML: 'ei laktoosia', AU: 'ei sulfiitteja', NL: 'ei lupiinia', UM: 'ei nilviäisiä', SA: 'ei mantelia', SH: 'ei hasselpähkinää', SC: 'ei cashewpähkinää', SW: 'ei saksanpähkinää', ST: 'ei pistaasia' };
// Ostajalle ei näytetä raakaa GS1-koodia (Haiku-mittaus 16.11. A3: "(ei allergeeneja AW)" vaihtoehtorivillä).
const allergenFi = (a) => ALLERGEN_FI[a] || 'allergeenirajaus';
// Gluteeniton-merkintä ja gluteeniviljojen kielto ovat ostajalle sama asia: näytetään kerran.
const dietLabel = (d) => [...d.claims.map((c) => CLAIM_FI[c]), ...d.excludeAllergens.filter((a) => !(a === 'AW' && d.claims.includes('FREE_FROM_GLUTEN'))).map(allergenFi)].filter(Boolean).join(', ');
// Vahvistus tunnistetaan koodissa, ei mallilla. Pelkkä "joo" ei ole tilauslupa. Korisivu sallii vahvistuksen vain
// vihreästä painikkeesta (cart-link.mjs), ei muutoskenttään kirjoitettuna (katselmus #10).
export const CONFIRM = /^(tilaa|vahvista|vahvistan|hyväksy|hyväksyn|(kyllä|joo|ok|okei)[,\s]+(tilaa|vahvista|vahvistan))[\s.!]*$/iu;
const VAGUE_YES = /^(joo|kyllä|ok|okei|jep|juu|selvä|hyvä|sopii)[\s.!]*$/iu;
const CANCEL = /^(peru|peruuta|tyhjennä|aloita alusta)\b/iu;
// Koko luonnoksen vapaa peruminen ("unohda koko homma, ei tilata mitään"). Kielto ("älä peru") ei peru mitään.
export const CANCEL_ALL = /^(?:(?:no|ok|okei|joo|ei|ai)[,\s]+)?(?:unohda\s+(?:koko\s+)?(?:homma|juttu|tilaus|lista|ostoslista|kaikki)|ei\s+(?:tilata|tilatakaan)(?:\s+(?:mitään|sittenkään))+|en\s+(?:tilaa|tilaakaan)(?:\s+(?:mitään|sittenkään))+|peru(?:ta|taan)?\s+(?:koko\s+)?(?:tilaus|homma|ostoslista|lista))(?:[,.\s]+(?:ei\s+tilata\s+mitään|en\s+tilaa\s+mitään|kiitos|sittenkään|ei\s+tarvi\p{L}*))*[.!\s]*$/iu;
// Kysymys tilausaikarajasta (interpret.mjs). Vastaus tulee työkalujen tiedoista, ei mallilta.
export { DEADLINE_QUESTION };
// Pelkkä kiitos ei muuta luonnosta eikä tulosta koko listaa uudelleen.
const THANKS = /^(kiitos|kiitti|kiitoksia|kiitän|thx|thanks|tack)(\s+(paljon|tosi paljon|kovasti|avusta))?[\s.!]*$/iu;
const HELP = 'Kirjoita tuotteet ja määrät, esim. "20 l laktoositonta maitoa ja 5 kg voita maanantaiksi".';
// Ilman tuotteita ja päivää kysytään silti ensin päivä (itsepeli X044 "60", S030 "sitä samaa ku viimeks").
const START_QUESTION = 'Mille päivälle toimitus, ja mitä tarvitset? Esim. "20 l laktoositonta maitoa ja 5 kg voita maanantaiksi".';
// "Sitä samaa ku viimeks": edellisen tilauksen rivit uuteen luonnokseen, päivä kysytään uudelleen.
// Mahdoton päivämäärä ("31.2.") ohitettiin hiljaa, ja sama päiväkysymys toistui (WhatsApp-koe 17.11.).
export function invalidDate(text) {
  const m = /(?<![\d.,])(\d{1,2})\.(\d{1,2})\.?(?:(\d{4}|\d{2}))?(?![\d,])(?!\s*(?:kg|g|l|dl|cl|ml|kpl|lit|kil|ltk|%|€|e\b))/iu.exec(String(text || ''));
  if (!m) return null;
  const day = Number(m[1]); const month = Number(m[2]);
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 2028; // karkausvuosi: 29.2. kelpaa ilman vuotta
  const days = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  return day >= 1 && day <= days ? null : `${day}.${month}.`;
}
// "Sama ku viimeks mut tuplana": kerroin kopioidun tilauksen määriin (WhatsApp-koe 17.11.: "tuplana" ohitettiin).
const MULTIPLIER = /(?<![\p{L}\d])(?:(tupla\p{L}*|kaksinkertai\p{L}*|kaksi\s+kertaa\s+(?:enemmän|isompana)|kahteen\s+kertaan)|(kolminkertai\p{L}*|triplana)|(puolet|puolikkaa\p{L}*|puolta\s+vähemmän|puoleen)|(?:(?<![\d,.]\s{0,2})x\s*(\d)(?![\d,.]|\s*\p{L})|(\d)\s*[x×](?!\s*[\d\p{L}])|(\d)\s*-?\s*kertai\p{L}*))(?![\p{L}\d])/iu;
export function repeatFactor(text) {
  const m = MULTIPLIER.exec(String(text || ''));
  if (!m) return 1;
  const n = Number(m[4] || m[5] || m[6]);
  const f = m[1] ? 2 : m[2] ? 3 : m[3] ? 0.5 : n;
  return f > 0 && f <= 10 ? f : 1;
}
const REPEAT_FILLER = /(?<![\p{L}\d])(?:sitä|se|ne|niitä|joo|ok|okei|kiitos|vaan|vain|nyt|taas|uudestaan|uudelleen|mut|mutta|ja|tilaa|laita|otetaan|please)(?![\p{L}\d])/giu;
export const REPEAT_LAST = /(?:sama\p{L}*|samanlai\p{L}*)\s+(?:tilaus\s+)?(?:kuin|ku|ko|kun)\s+(?:viimeks\p{L}*|viime\s+kerra\p{L}*|viimeksi|edelli\p{L}*|viimeisin\p{L}*|viime\s+viiko\p{L}*)|(?:toista|tilaa\s+uudelleen|uusi)\s+(?:viime\p{L}*|edelli\p{L}*|viimeisin)\s+tilau\p{L}*/iu;
// "Se tavallinen": ostajan toistuvat tuotteet tavallisella määrällä (usualOrder). Pelkkä "tavallinen" tai "se tavallinen maito"
// ei ole tilaus vaan tuotteen tarkennus (laktoosikysymyksen "tavallinen käy"), joten "se tavallinen" kelpaa vain yksinään tai
// päivän, kiitoksen tai tervehdyksen kanssa. Tunnistetaan vain tyhjään luonnokseen.
const USUAL_DAY = String.raw`(?:ma|ti|ke|to|pe|la|su)\b|maanantai|tiistai|keskiviik|torstai|perjantai|lauantai|sunnuntai|huomise|ylihuomise|huomenna|ensi\s+viik|\d{1,2}\.\d{1,2}`;
export const USUAL_ORDER = new RegExp(String.raw`(?<![\p{L}\d])(?:tavalli\p{L}*|normaali\p{L}*|normi|vakio|perus)\s+(?:tilaus\p{L}*|tilaukse\p{L}*|setti\p{L}*|satsi\p{L}*)`
  + String.raw`|(?<![\p{L}\d])(?:vakio|perus|normi)tilau\p{L}*`
  + String.raw`|(?<![\p{L}\d])(?:sama\p{L}*|samat|tilaa)\s+(?:niin\s*)?(?:kuin|ku|ko|kun|kuten)\s+(?:aina|yleensä|tavallisesti)(?![\p{L}\d])`
  + String.raw`|(?<![\p{L}\d])tavalliseen\s+tapaan`
  + String.raw`|^(?:(?:moi\p{L}*|hei|moro|morjes|terve|no|joo|juu)[,!.]?\s+)?(?:se|sitä|ne|niitä|mun|meidän|meiän)\s+tavalli\p{L}*(?=\s*$|\s*[.,!?]|\s+(?:kiitos|kiitti|vaan|taas|pliis|please|${USUAL_DAY}))`, 'iu');
// Toimituspäivä kysytään ensin ja yksin: saatavuus ja vaihtoehdot riippuvat päivästä.
const DATE_QUESTION = 'Mille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.';
// Vaihtoehtolistan vastaukset tunnistetaan koodissa, jotta numero viittaa aina viimeksi näytettyyn listaan.
const PICK = /^(?:nro\s*|numero\s*)?(\d{1,2})[.)]?(?:\s*kiitos)?[.!\s]*$/iu;
const SHOW = /^(?:näytä(?:\s+(?:lista|ostoslista|tilaus|yhteenveto))?|lista)[.!?\s]*$/iu;
const MORE = /^(?:(?:näytä|anna|hae|katso)\s+)?(?:lisää|muita|muut|enemmän)(?:\s+(?:vaihtoehtoja|vaihtoehdot|tuotteita|tuotteet))?(?:\s+kiitos)?[.!?\s]*$|^onko\s+(?:muita|muuta|lisää)(?:\s+(?:vaihtoehtoja|tuotteita))?[?.!\s]*$/iu;
const CHEAPEST = /^(?:(?:otetaan|ota|laita|valitse|se|joo)\s+)*(?:halvin|halvinta|halvimman|halvempi|edullisin|edullisinta)(?:\s+(?:vaihtoehto|kiitos))?[.!\s]*$/iu;
// Vertailukysymys näytetyistä vaihtoehdoista: hinta, hiilijalanjälki tai toimitusvarmuus. Koodi vastaa työkalujen tiedoista
// eikä valitse mitään (itsepeli V017, V020, V025: malli vastasi "en näe hintoja"). "Se halvin" ilman kysymystä on valinta.
const COMPARE = {
  co2: /hiilijalanj|hiilidioksid|ympäristöystävällis|ilmastoystävällis|ekologisi|(?<![\p{L}\d])co2|co₂|päästö/iu,
  // Kumpi tahansa sanajärjestys: "toimitetaan varmimmin" jäi tunnistamatta ja malli vastasi "en pysty arvioimaan" (Haiku-mittaus V023).
  reliability: /toimitusvarm|varmimmin\s+(?:toimit|perill)|(?:toimit|perill)\p{L}*\s+(?:\p{L}+\s+)?(?:varmimmin|luotettavimmin)|varmin\s+toimitus|luotettavi\p{L}*\s+toimit/iu,
  price: /halvi\p{L}*|edullisi\p{L}*|halvemp\p{L}*|edullisemp\p{L}*|hintoineen|hintavertailu/iu,
  // "Mikä näistä on suosituin?" (WhatsApp-koe 17.11.: "En näe suosituimmuustietoa"). Vastaus asiakkaidemme tilauksista.
  popular: /suosituin|suosituimm\p{L}*|suosit(?:tu|uin)|eniten\s+tila\p{L}*|tilatui\p{L}*|tilataan\s+eniten|(?:muut|toiset)\s+(?:keittiöt|asiakkaat|ravintolat)\s+(?:\p{L}+\s+)?(?:tilaa|tilaavat|ottaa|ottavat|käyttää|käyttävät)|trendi\p{L}*/iu,
};
const ASKS = /\?|(?:^|[\s,.!])(?:mikä|mitkä|kumpi|onko|onks|onkos|oikeesti|oikeasti|vertaa\p{L}*|listaa|hintoineen)(?=$|[\s,.!?])/iu;
export function compareKind(text) {
  const t = String(text || '').trim();
  if (COMPARE.popular.test(t)) return 'popular';
  if (COMPARE.co2.test(t)) return 'co2';
  if (COMPARE.reliability.test(t)) return 'reliability';
  if (COMPARE.price.test(t) && ASKS.test(t) && !CHEAPEST.test(t)) return 'price';
  return null;
}
// Pyyntö näyttää vaihtoehdot uudelleen ("listaa vaihtoehdot hintoineen", "onko halvempia"), myös jo valitulle riville.
export const RELIST = /(?:listaa|näytä|näyttäis\p{L}*|laita\s+näkyviin|anna)\s[^.!?\n]{0,40}vaihtoeh\p{L}*|vaihtoeh\p{L}*\s+(?:hintoineen|numeroituna|uudelleen|uudestaan)|muut\s+vaihtoeh\p{L}*|on(?:ko|ks)\s+(?:muita|halvempi\p{L}*|edullisempi\p{L}*)/iu;
// Valinta numerolla tai järjestyssanalla samassa viestissä ("ykkönen, mut onks se halvin?") on valinta, ei pelkkä kysymys.
const PICK_WORD = /\d|ykkö|kakko|kolmo|nelo|(?<![\p{L}])(?:eka|toka|kolmas|ensimmäi\p{L}*|toinen|viimei\p{L}*)(?![\p{L}])/iu;
// Kiire: asiakas haluaa toimituksen mahdollisimman pian. Kellonaikatoive kirjataan, mutta sitä ei luvata:
// tilausjärjestelmä kertoo vain toimituspäivän ja tilausaikarajan.
const RUSH = /(?:^|[\s,.!?])(?:tänään|tänää|heti|nyt\s+heti|asap|kiire\p{L}*|pikaisesti|pikana|mahd(?:ollisimman)?\.?\s+pian|aikaisin\s+mahdollinen)(?=$|[\s,.!?])/iu;
const TIME_WISH = /(?:ennen|viimeistään)\s+(?:klo|kello)\s*\d{1,2}(?:[.:]\d{2})?|(?:klo|kello)\s*\d{1,2}(?:[.:]\d{2})?\s*(?:mennessä|asti)|(?:huomenna\s+)?aamu(?:lla|ks(?:i|een)?|päivällä|seitsemäksi)|aamuun|iltapäivällä/iu;
// Kellonaika- ja kiireilmaukset poistetaan tulkille menevästä tekstistä: ne eivät ole tuotetietoa, ja sääntötulkki luki ne
// muuten tuotesanaan ("kananmuna enne kelt", "aamu maito"). Päiväsanat (tänään, huomenna) säilyvät.
const CLOCK_WORDS = /(?<![\p{L}\d])(?:(?:ennen|viimeistään)\s+)?(?:klo|kello)\s*\d{1,2}(?:[.:]\d{2})?(?:\s*(?:mennessä|asti|aikaan))?(?![\p{L}\d])|(?<![\p{L}\d])(?:aamu(?:lla|ks(?:i|een)?|päivällä|seitsemäksi|seitsemään)?|aamuun|iltapäivällä|nyt\s+heti|heti|kiire(?:esti|ellä|ellisesti|ellinen|ellistä|ellisenä)?|asap|pikaisesti|pikana|mahd(?:ollisimman)?\.?\s+pian)(?![\p{L}\d])[,!]?/giu;
export const withoutClockWords = (text) => { const cleaned = String(text || '').replace(CLOCK_WORDS, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim(); return cleaned || String(text || ''); };
const RUSH_DATE_QUESTION = 'Mille päivälle toimitus? Jos on kiire, kirjoita esim. "huomenna", niin katson aikaisimman päivän, jolle ehtii.';
// Vastaus tuotekohtaiseen laktoosikysymykseen "haluatko laktoositonta vai käykö tavallinen?" (katselmus #20).
// "joo" ja "kyllä" vastaavat ensimmäiseen kysymykseen (laktoositon). "sopii", "ok", "hyvä" ja "käy" vastaavat viimeiseen
// ("käykö tavallinen?"), joten ne eivät lisää vaatimusta eivätkä toista kysymystä.
const PREF_YES = /^(?:1[.)]?|laktoosit(?:tomana|tomina|onta|on)|joo|kyllä|juu|jep|selvä)(?:[,\s]+kiitos)?[.!\s]*$/iu;
const PREF_NO = /^(?:2[.)]?|ei|ei väliä|ei tarvitse|ei tarvi|tavallinen|tavallista|tavalliset|ihan tavallista|ihan tavalliset|normaali|normaalia|ihan normi|kumpikin käy|kaikki käy|(?:(?:joo|juu|kyllä|no)[,\s]+)?(?:ok|okei|okay|hyvä|sopii|käy|kelpaa)(?:[,\s]+(?:hyvin|se|kiitos|tavallinen|vaan|vain))*)[.!\s]*$/iu;
// "Vaihda tavalliseen" valittuun laktoosittomaan tuotteeseen (Haiku-mittaus C4, X079): valinta avataan ja näytetään tavalliset.
const SWITCH_REGULAR = /vaihd\p{L}*\s+(?:se\s+|ne\s+)?tavalli\p{L}*|(?:en|ei)\s+(?:tarvitse|tarvi\p{L}*|halua|haluta|tarvita)\s+(?:olla\s+)?laktoositon\p{L}*|tavalli\p{L}*\s+(?:tilalle|tilalla)/iu;
const lactoseFree = (o) => Boolean(o && ((o.labels || []).includes('FREE_FROM_LACTOSE') || /laktoositon|laktoositonta|lactose[- ]?free|(?<![\p{L}])hyla(?![\p{L}])/iu.test(o.name || '')));
// Asiakkaan valtuutus "valitse ensimmäinen sopiva" (C5, S018): koodi valitsee näytetyn listan ykkösen ja kertoo sen.
const FIRST_SUITABLE = /(?:ensimmäi\p{L}*|eka|ykkö\p{L}*)\s+(?:sopiv\p{L}*|vaihtoeh\p{L}*)|mikä\s+tahansa\s+(?:sopiva|käy|kelpaa)/iu;
// Sanallinen kielto aikaisimman päivän ehdotukseen ("ei käy ti, tarvin maanantaiks", C2, X066).
const DATE_REFUSAL = /^\s*(?:ei|en|eikä|no\s+ei)(?![\p{L}])/iu;
const mentions = (text, term) => String(text).toLocaleLowerCase('fi').includes(term.toLocaleLowerCase('fi').slice(0, Math.max(4, term.length - 2)));
const DATE_YES = /^(?:1[.)]?|kyllä|joo|juu|jep|ok|okei|sopii|vaihda|vaihdetaan|käy)(?:[,\s]+(?:kiitos|vaan|vain|sopii|käy|vaihda|vaihdetaan|se))*[.!\s]*$/iu;
const DATE_NO = /^(?:2[.)]?|ei|ei kiitos|pidetään|pidä|ei käy)(?:[,\s]+(?:kiitos|pidetään|pidä|se|sama|päivä))*[.!\s]*$/iu;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Myyntierän sana ("5 rasiaa") ja tuoterivien selkokielinen esitys ovat wording.mjs:ssä.

const num = (n) => String(+Number(n).toFixed(3)).replace('.', ',');
const eur = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
const qty = (q) => (q ? `${num(q.value)} ${UNIT_FI[q.unit]}` : '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const helsinki = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date(ms));
const dateLabel = (iso) => new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const validQuantity = (q) => q && Number.isFinite(q.value) && q.value > 0 && q.value <= 100000 && ['L', 'KG', 'PCS'].includes(q.unit);
const cleanQuantity = (q) => ({ value: q.value, unit: q.unit, ...(q.unit === 'PCS' && ['items', 'sales'].includes(q.basis) ? { basis: q.basis } : {}) });
// Gatewayn tilauksesta kopioitu määrä on myyntieriä: näytetään pakkaussanalla ("4 laatikkoa"), ei "4 kpl", niin kauan kuin
// sama tuote on valittuna.
const lineQty = (l) => (l.packLabel && l.packFor === l.selectedProductId && l.quantity?.basis === 'sales' ? `${num(l.quantity.value)} ${packWord(l.quantity.value, l.packLabel)}` : qty(l.quantity));
const lineLabel = (l) => `${l.productTerm}${l.quantity ? ` ${lineQty(l)}` : ''}${[...l.claims.map((c) => CLAIM_FI[c]), ...[...new Set(l.excludeAllergens.filter((a) => !(a === 'AW' && l.claims.includes('FREE_FROM_GLUTEN'))).map(allergenFi))]].filter(Boolean).map((x) => ` (${x})`).join('')}`;
// Sisältö, jonka muutos kasvattaa revisiota ja mitätöi tarjouksen ja hyväksynnän.
const content = (d) => JSON.stringify([d.deliveryDate, d.deliverySiteId, d.diet.claims, d.diet.excludeAllergens, d.lines.map((l) => [l.ref, l.productTerm, l.quantity, l.claims, l.excludeAllergens, l.selectedProductId || null, l.answeredClaims || []])]);

function newDraft(customer) {
  return { id: `WD-${crypto.randomUUID()}`, state: 'active', revision: 0, customerId: customer.customerId, bindingVersion: customer.bindingVersion,
    deliveryDate: null, deliverySiteId: customer.deliverySites?.length === 1 ? customer.deliverySites[0].id : null,
    diet: { known: false, claims: [], excludeAllergens: [] }, lines: [], offered: {}, seen: {}, quote: null, pending: null, lastRef: null, lastRefTurn: -1, turn: 0, seq: 0 };
}

/** Toteuttaa tulkin ehdottamat muutokset. Tuntematon ref, kelvoton määrä tai tarjoamaton vaihtoehto ohitetaan ja raportoidaan. */
function apply(draft, turn, customer, today) {
  const notes = turn.note ? [String(turn.note).slice(0, 300)] : [];
  const touch = (ref) => { draft.lastRef = ref; draft.lastRefTurn = draft.turn; };
  const find = (ref) => draft.lines.find((l) => l.ref === ref);
  const claims = (list) => [...new Set((list || []).filter((c) => CLAIMS.includes(c)))];
  const allergens = (list) => [...new Set((list || []).filter((a) => /^[A-Z]{2}$/.test(a)))];
  if (turn.deliveryDate) {
    if (!validDate(turn.deliveryDate) || turn.deliveryDate < today) notes.push('Toimituspäivän pitää olla tuleva päivä.');
    else {
      // Toinen päivä: aiemmin näytetyt vaihtoehdot, hinnat ja saatavuus eivät enää päde.
      if (draft.deliveryDate !== turn.deliveryDate) { draft.offered = {}; draft.seen = {}; }
      draft.deliveryDate = turn.deliveryDate;
    }
  }
  for (let o of (turn.ops || []).slice(0, 30)) {
    const line = o.ref ? find(o.ref) : null;
    // Viestissä mainittu ruokavaatimus tarkoittaa, että asia on käsitelty: sitä ei kysytä enää erikseen.
    if (['add', 'update'].includes(o.op) && (claims([...(o.claims || []), ...(o.addClaims || [])]).length || allergens(o.excludeAllergens).length)) draft.diet.known = true;
    if (o.op === 'diet') {
      // Koko tilauksen ruokavalio. Tyhjä vastaus ("ei") kirjaa vain, että asia on kysytty.
      const before = JSON.stringify(draft.diet);
      draft.diet = { known: true, claims: claims([...draft.diet.claims, ...(o.addClaims || [])]), excludeAllergens: allergens([...draft.diet.excludeAllergens, ...(o.excludeAllergens || [])]) };
      if (before !== JSON.stringify(draft.diet) && (draft.diet.claims.length || draft.diet.excludeAllergens.length)) { for (const l of draft.lines) { l.selectedProductId = null; l.selectedName = null; l.selectedWarning = null; } draft.offered = {}; draft.seen = {}; }
      continue;
    }
    if (o.op === 'add' && typeof o.productTerm === 'string' && o.productTerm.trim()) {
      if (draft.lines.length >= 20) { notes.push('Luonnoksessa voi olla enintään 20 riviä.'); continue; }
      const ref = `L${++draft.seq}`;
      draft.lines.push({ ref, productTerm: o.productTerm.trim().slice(0, 80), quantity: validQuantity(o.quantity) ? cleanQuantity(o.quantity) : null, claims: claims(o.claims), excludeAllergens: allergens(o.excludeAllergens), selectedProductId: null, selectedName: null, selectedWarning: null });
      touch(ref);
    } else if (o.op === 'update' && line) {
      const before = JSON.stringify([line.productTerm, line.claims, line.excludeAllergens]);
      // Kiloja kysyttiin (kiloina myytävä tuote): pelkkä luku tai kappalemäärä vastauksena tarkoittaa kiloja.
      if (line.byWeight && o.quantity?.unit === 'PCS' && o.quantity.basis !== 'sales') o = { ...o, quantity: { value: o.quantity.value, unit: 'KG' } };
      // Myyntierät kysyttiin, koska pakkauksen kappalemäärää ei tiedetä: vastauksen luku on myyntieriä (17.11.).
      if (line.askPacks && o.quantity?.unit === 'PCS') { o = { ...o, quantity: { value: o.quantity.value, unit: 'PCS', basis: 'sales' } }; delete line.askPacks; }
      if (o.quantity) {
        if (!validQuantity(o.quantity)) notes.push(`Tarkista määrä: ${line.productTerm}.`);
        else {
          // Näytettyjen vaihtoehtojen myyntierät ja hinnat laskettiin vanhalle määrälle.
          if (JSON.stringify(line.quantity) !== JSON.stringify(cleanQuantity(o.quantity))) { delete draft.offered[line.ref]; delete draft.seen?.[line.ref]; }
          line.quantity = cleanQuantity(o.quantity);
        }
      }
      if (typeof o.productTerm === 'string' && o.productTerm.trim()) {
        if (line.productTerm !== o.productTerm.trim()) line.answeredClaims = [];
        line.productTerm = o.productTerm.trim().slice(0, 80);
      }
      line.claims = claims([...line.claims, ...(o.addClaims || [])]).filter((c) => !(o.removeClaims || []).includes(c));
      line.excludeAllergens = allergens([...line.excludeAllergens, ...(o.excludeAllergens || [])]);
      // Tuotteen tai ruokavaatimuksen muutos vaatii uuden tuotevalinnan. Määrän muutos säilyttää valinnan ja tarkistetaan tarjouksessa.
      if (before !== JSON.stringify([line.productTerm, line.claims, line.excludeAllergens])) { line.selectedProductId = null; line.selectedName = null; delete line.askPacks; delete draft.offered[line.ref]; delete draft.seen?.[line.ref]; }
      touch(line.ref);
    } else if (o.op === 'remove' && line) {
      draft.lines = draft.lines.filter((l) => l !== line); delete draft.offered[line.ref]; delete draft.seen?.[line.ref];
    } else if (o.op === 'select' && line) {
      const option = draft.offered[line.ref]?.[o.option - 1];
      if (!option) { notes.push(`Valitse numero näytetyistä vaihtoehdoista: ${line.productTerm}.`); continue; }
      line.selectedProductId = option.productId; line.selectedName = option.name; line.selectedWarning = option.warning || null;
      // Vastaava tuote saatavuudeltaan tuntemattoman tilalle: rivin tuote vaihtuu, ja eri mittayksikössä määrä kysytään uudelleen.
      if (option.replaceTerm) {
        line.productTerm = String(option.replaceTerm).slice(0, 80); delete line.noExact; line.answeredClaims = [];
        draft.unknownNoted = null;
      } else if (line.noExact) {
        // Lähin vaihtoehto ei ollut pyydetty tuote: rivi saa valitun tuotteen sanan, jotta muutosvihje ("poista maksalaatikko")
        // ja rivin otsikko kertovat, mitä on oikeasti valittu, ja poisto osuu riviin.
        line.productTerm = substituteTerm(option); delete line.noExact; line.answeredClaims = [];
      }
      if (option.askQuantity) line.quantity = null;
      // Pakkauksen kappalemäärä puuttuu Valion tiedoista: kappaleita ei muunneta arvaamalla, vaan määrä kysytään myyntierinä.
      if (option.countUnknown) {
        line.askPacks = true;
        notes.push(`Pakkauksen kappalemäärää ei ole Valion tiedoissa: ${readableName(option.name)}. Kerro, montako ${option.salesUnitLabel ? packWord(2, option.salesUnitLabel) : 'myyntierää'} laitetaan.`);
      } else delete line.askPacks;
    } else if (o.op === 'no_preference') {
      if (draft.pending?.kind === 'preference') {
        for (const ref of draft.pending.refs) {
          if (o.ref && o.ref !== ref) continue;
          const target = find(ref);
          if (target) target.answeredClaims = [...new Set([...(target.answeredClaims || []), draft.pending.claim])];
        }
      } else draft.diet.known = true;
    } else if (o.op === 'site') {
      const site = customer.deliverySites?.[o.option - 1];
      if (site) draft.deliverySiteId = site.id; else notes.push('Valitse toimituspaikka numerolla.');
    }
  }
  return notes;
}

// Muutosesimerkki tilauksen omista riveistä: ei neuvota muuttamaan maitoa, jos tilauksessa ei ole maitoa.
function changeHint(draft) {
  const first = draft.lines.find((l) => l.quantity); const last = draft.lines[draft.lines.length - 1];
  if (!first || !last) return 'Voit vielä muuttaa määriä tai poistaa rivejä.';
  const more = first.quantity.value >= 4 ? Math.ceil(first.quantity.value * 1.5) : first.quantity.value + 1;
  return `Voit vielä muuttaa, esim. "${first.productTerm} ${qty({ value: more, unit: first.quantity.unit })}", "poista ${last.productTerm}" tai "tyhjennä ostoskori".`;
}

const joinFi = (names) => (names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} ja ${names.at(-1)}`);
// Toinen toimituspäivä ei auta riviin: tuotetta ei ole valikoimassa, tai valmisruokaa ei ole tilattavana eikä sen pääraaka-aineelle
// ole hintaa (lanttulaatikko ja lanttu 18.11.). Jos ruoalle tiedetään myöhempi tilattava päivä, toinen päivä auttaa.
function daylessIssue(issues, ref) {
  const own = issues.filter((i) => i.ref === ref);
  if (own.some((i) => i.notInCatalog)) return true;
  return own.some((i) => i.code === 'INGREDIENT_UNAVAILABLE' && i.unknown) && !own.some((i) => i.nextDeliveryDate);
}
// Supistettujen tietojen syy kerrotaan kerran luonnosta kohden, ei jokaisen puuttuvan tuotteen kohdalla.
const dataReason = (draft) => (draft.dataNoted ? '' : (draft.dataNoted = true, `${DATA_REASON} `));

// Saman päivän tilattavattomat rivit yhteen lauseeseen: kolme peräkkäistä "Ei tilattavaa tuotetta päivälle ke 18.11.: maito." -riviä
// (maito, voi, kananmuna) kuulosti robotilta (WhatsApp-koe 17.11.).
export function mergeUnavailable(problems) {
  // Useampi tuote ilman hintaa ja saatavuutta yhdeksi lauseeksi: "Hups, banaaneille ja omenoille minulla ei ole ..." (17.11.).
  const unknown = problems.map((p) => NO_DATA.exec(p)?.[1]).filter(Boolean);
  if (unknown.length > 1) {
    let merged = false;
    problems = problems.flatMap((p) => (NO_DATA.test(p) ? (merged ? [] : (merged = true, [`Hups, ${joinFi(unknown)} minulla ei ole nyt hintaa eikä saatavuutta.`])) : [p]));
  }
  const NONE = /^Ei tilattavaa tuotetta päivälle (.+?): (.+)\.$/u;
  const byDate = new Map();
  for (const p of problems) { const m = NONE.exec(p); if (m) byDate.set(m[1], [...(byDate.get(m[1]) || []), m[2]]); }
  const done = new Set();
  return problems.flatMap((p) => {
    const m = NONE.exec(p);
    if (!m || byDate.get(m[1]).length < 2) return [p];
    if (done.has(m[1])) return [];
    done.add(m[1]);
    return [`Ei tilattavaa tuotetta päivälle ${m[1]}: ${joinFi(byDate.get(m[1]))}.`];
  });
}
// Vaihtoehto ostajan ymmärtämänä: luettava nimi, myyntierät, yhden koko ja määrä yhteensä,
// esim. "Kananmunat M10, 5 rasiaa à 10 munaa, yhteensä 50 munaa, 12,40 €" (wording.mjs). Otsikkorivi kertoo jo pyydetyn määrän.
const itemNounOf = (covers, line) => (covers?.unit === 'PCS' && line?.quantity?.basis === 'items' ? (/kananmun/iu.test(line.productTerm || '') ? 'munaa' : 'kpl') : undefined);
// Laktoositon maitotuote merkitään, kun nimi ei sitä kerro (Emmental-raaste): ostaja näkee sen ilman erillistä kysymystä
// (Eelis 17.11.: "miksei tä ehottanu esin juustois laktoosittomuut?"). Ei, kun laktoosittomuus on jo rivin ehto.
function optionLabel(o, line) {
  const lactose = o.lactoseFree && !/laktoosit/iu.test(o.name || '') && !(line?.claims || []).includes('FREE_FROM_LACTOSE');
  return `${optionRow(lactose ? { ...o, name: `${o.name} (laktoositon)` } : o, { itemNoun: itemNounOf(o.covers, line) })}${o.warning ? ` (${o.warning})` : ''}${o.popular ? ', suosituin' : ''}`;
}

/** Montako eri vahvistettua tilausta kustakin tuotteesta on (kaikki asiakkaat). Suosituimpien ehdottamista varten. */
export function popularityCounts(orders) {
  const counts = new Map();
  for (const o of orders || []) {
    if (o?.status !== 'confirmed') continue;
    for (const id of perProduct(o).keys()) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

// Vastaus vertailukysymykseen näytetyistä vaihtoehdoista: vain työkalujen palauttamat arvot, puuttuva tieto sanotaan.
function compareAnswer(kind, options = []) {
  const shown = options.map((o, i) => ({ o, n: i + 1 }));
  if (!shown.length) return '';
  if (kind === 'popular') {
    const counted = shown.filter(({ o }) => o.orderedCount > 0);
    if (!counted.length) return 'Näitä ei ole vielä tilattu asiakkaidemme tilauksissa, joten suosituinta en osaa sanoa. Tieto kertyy tilauksista.';
    const best = counted.reduce((a, b) => (b.o.orderedCount > a.o.orderedCount ? b : a));
    const times = (n) => (n === 1 ? 'yhdessä tilauksessa' : `${n} tilauksessa`);
    return `Asiakkaamme ovat tilanneet näistä eniten vaihtoehtoa ${best.n}) ${readableName(best.o.name)}, ${times(best.o.orderedCount)}.`;
  }
  if (kind === 'price') {
    const priced = shown.filter(({ o }) => Number.isFinite(o.lineNet));
    if (!priced.length) return '';
    const best = priced.reduce((a, b) => (b.o.lineNet < a.o.lineNet ? b : a));
    return `Vaihtoehdoista edullisin on ${best.n}) ${readableName(best.o.name)}, ${eur(best.o.lineNet)} (alv 0 %).`;
  }
  const [key, what, fmt, better] = kind === 'co2'
    ? ['co2PerKg', 'Hiilijalanjälki', (v) => `${num(v)} kg CO2e/kg`, Math.min]
    : ['deliveryReliability', 'Toimitusvarmuus', (v) => `${Math.round(v * 100)} %`, Math.max];
  const known = shown.filter(({ o }) => Number.isFinite(o[key]));
  if (!known.length) return `${what}tietoa ei ole näille vaihtoehdoille, joten en voi verrata niitä siinä.`;
  const best = better(...known.map(({ o }) => o[key]));
  const top = known.filter(({ o }) => o[key] === best);
  const values = shown.map(({ o, n }) => `${n}) ${Number.isFinite(o[key]) ? fmt(o[key]) : 'ei tietoa'}`).join(', ');
  // "Kaikille sama" vain, kun tieto on kaikilla: muuten tuntematon vaihtoehto ei ole sama (Haiku-mittaus 16.11. V019).
  const verdict = known.length > 1 && top.length === known.length ? (known.length === shown.length ? 'Arvo on kaikille sama.' : 'Arvo on sama niillä, joilta tieto löytyy.')
    : `${kind === 'co2' ? 'Pienin' : 'Paras'}: ${joinFi(top.map(({ o, n }) => `${n}) ${readableName(o.name)}`))}.`;
  return `${what}: ${values}. ${verdict}`;
}

// Poistettu rivi kerrotaan aina (itsepeli S036, S056: kamelinmaito ja tryffeli pudotettiin sanomatta). Rivi, jolle ei
// löytynyt pyydettyä tuotetta, kerrotaan puuttuvaksi.
function removedNote(removed) {
  const gone = removed.filter((r) => r.noExact).map((r) => r.term); const other = removed.filter((r) => !r.noExact).map((r) => r.term);
  return [gone.length ? `Pyydettyä tuotetta ei löytynyt tilattavana, joten poistin listalta: ${joinFi(gone)}.` : '', other.length ? `Poistin listalta: ${joinFi(other)}.` : ''].filter(Boolean).join(' ');
}

// Valittu rivi, jonka vaihtoehdot ostaja haluaa nähdä uudelleen: ainoa valittu, nimetty tai viimeksi käsitelty.
function reopenTarget(draft, text) {
  const t = text.toLocaleLowerCase('fi');
  const chosen = draft.lines.filter((l) => l.selectedProductId);
  if (chosen.length <= 1) return chosen[0] || null;
  const named = chosen.filter((l) => t.includes(l.productTerm.toLocaleLowerCase('fi').slice(0, Math.max(4, l.productTerm.length - 2))));
  if (named.length === 1) return named[0];
  return chosen.find((l) => l.ref === draft.lastRef) || null;
}

function summary(draft, q, customer) {
  // Toimituspaikka näytetään vain, kun valittavia on useampi (yhden paikan asiakkaalle se toistaisi yrityksen nimen).
  const site = (customer.deliverySites?.length || 0) > 1 ? customer.deliverySites.find((s) => s.id === draft.deliverySiteId) : null;
  const warn = (ref) => { const w = draft.lines.find((l) => l.ref === ref)?.selectedWarning; return w ? `\n  Huom: ${w}` : ''; };
  // "PP peruna 1 kg annabelle: 2 kpl, yhteensä 2 kg (pyysit 1,5 kg), 1,52 € (0,76 €/kg)" (wording.mjs, Eelis 17.11.).
  // Rivit ranskalaisin viivoin (Eelis 18.11.).
  const rows = q.lines.map((l) => { const d = draft.lines.find((x) => x.ref === l.ref);
    return `- ${summaryRow(l, { requested: d?.quantity, itemNoun: itemNounOf(l.covers, d) })}${warn(l.ref)}`; });
  const diet = dietLabel(draft.diet);
  // Tarjous vanhenee aikaisimpaan tilausaikarajaan, joten se näytetään, ei ensimmäisen rivin rajaa (katselmus #18).
  const cutoffAt = (l) => parseApiTime(l.cutoff)?.getTime() ?? Infinity;
  const first = q.lines.filter((l) => l.cutoffLabel || parseApiTime(l.cutoff)).sort((a, b) => cutoffAt(a) - cutoffAt(b))[0];
  const cutoff = first ? (Number.isFinite(cutoffAt(first)) ? helsinkiLabel(first.cutoff) : first.cutoffLabel) : null;
  // Jäsennys Eeliksen pohjan mukaan (18.11.): otsikko, toimitus ja yritys, tuotteet viivoin, yhteensä ja tilausaika,
  // sitten ohjeet omilla riveillään. WhatsAppissa TILAA-rivi vaihtuu ok-ohjeeseen (cart-handoff.mjs).
  return ['*Tilausluonnos*', `Toimitus: ${dateLabel(draft.deliveryDate)}`, ...(customer.companyName ? [customer.companyName] : []),
    ...(site ? [`Toimituspaikka: ${site.label}`] : []), ...(diet ? [`Huomioitu: ${diet}`] : []), '', '*Tuotteet*', ...rows, '',
    `Yhteensä: ${eur(q.totals.net)} (alv 0 %)`, ...(cutoff ? [`Tilaus pitää tehdä viimeistään ${cutoff}.`] : []),
    ...(draft.timeWish ? [timeWishNote(draft)] : []), '', 'Vahvista vastaamalla *TILAA*.', changeHint(draft)].join('\n');
}
const timeWishNote = (draft) => `Toivoit toimitusta "${draft.timeWish}": kellonaikaa en näe tilausjärjestelmästä, joten en voi luvata sitä. Toimituspäivä on ${dateLabel(draft.deliveryDate)}`;

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openDraftStore>} o.store
 * @param {{suggest: Function, quote: Function, submit: Function}} o.tools henkilön 3 työkalut (server/order-tools)
 * @param {(input: {text: string, draft: object, today: string, now: number}) => Promise<{intent: string, deliveryDate?: string, ops: object[]}>} o.interpretTurn
 * @param {() => number} [o.now]
 */
/**
 * Gatewayn viimeisin vahvistettu tilaus luonnosriveiksi "sama kuin viime kerralla" -pyyntöä varten. Valittu tuote ja
 * myyntierämäärä säilyvät, päivää ei kopioida: hinta ja saatavuus tarkistetaan uudelle päivälle tarjouksessa.
 * @param {object[]} orders saman ostajan tilaukset uusin ensin (gatewayn orders.list)
 * @param {(name: string) => {productTerm?: string, claims?: string[]}} [termOf] lyhyt hakusana tuotenimestä
 */
export function lastConfirmedOrder(orders, termOf = () => ({})) {
  const order = (orders || []).find((o) => o?.status === 'confirmed' && o.lines?.length);
  if (!order) return null;
  const lines = [...perProduct(order).values()].map((p) => draftLineFrom(p.line, p.qty, termOf)).slice(0, 20);
  return lines.length ? { orderId: order.orderId, lines } : null;
}

// Tilauksen rivit tuotteittain: saman tuotteen rivit yhdistetään, rikkinäiset ja nollamäärät ohitetaan.
function perProduct(order) {
  const byProduct = new Map();
  for (const l of order.lines || []) {
    const id = String(l.productId || ''); const qty = Number(l.quantity);
    if (!id || !(qty > 0)) continue;
    const prior = byProduct.get(id);
    if (prior) prior.qty += qty; else byProduct.set(id, { qty, line: l });
  }
  return byProduct;
}

// Gatewayn tilausrivi luonnosriviksi: valittu tuote ja myyntierämäärä säilyvät, hakusana tuotenimestä.
function draftLineFrom(l, qty, termOf) {
  const id = String(l.productId); const name = String(l.name || id).slice(0, 120); const term = termOf(name) || {};
  return { productTerm: String(term.productTerm || name).slice(0, 60), quantity: { value: qty, unit: 'PCS', basis: 'sales' },
    claims: term.claims || [], excludeAllergens: [], selectedProductId: id, selectedName: name, selectedWarning: null,
    ...(l.salesUnitLabel ? { packLabel: String(l.salesUnitLabel).slice(0, 12), packFor: id } : {}) };
}

// OLETUS: sama sääntö kuin portin "Unohtuiko tämä?" -ehdotuksissa (gateway/suggest.mjs SUGGEST): tuote kuuluu tavalliseen
// tilaukseen, kun se on mukana vähintään kahdessa ja vähintään puolessa ostajan 8 viime vahvistetussa tilauksessa.
export const USUAL = { minOrders: 2, minShare: 0.5, lookback: 8 };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * "Se tavallinen": ostajan toistuvat tuotteet luonnosriveiksi tavallisella (mediaani) myyntierämäärällä. Päivää ei kopioida.
 * Jos vahvistettuja tilauksia on vasta yksi, kopioidaan se (single). Ei kielimallia: rivit voi laskea uudelleen tilauksista.
 * @param {object[]} orders saman ostajan tilaukset uusin ensin (gatewayn orders.list)
 * @returns {{lines: object[], ofOrders: number, single?: string}}
 */
export function usualOrder(orders, termOf = () => ({})) {
  const past = (orders || []).filter((o) => o?.status === 'confirmed' && o.lines?.length).slice(0, USUAL.lookback);
  if (past.length < USUAL.minOrders) {
    const last = lastConfirmedOrder(past, termOf);
    return last ? { lines: last.lines, ofOrders: past.length, single: last.orderId } : { lines: [], ofOrders: past.length };
  }
  const seen = new Map(); // productId → määrät tilauksittain ja uusin rivi (tilaukset uusin ensin)
  past.forEach((o, index) => {
    for (const [id, { qty, line }] of perProduct(o)) {
      const s = seen.get(id) || { quantities: [], line, index };
      s.quantities.push(qty); seen.set(id, s);
    }
  });
  const lines = [...seen.values()]
    .filter((s) => s.quantities.length >= USUAL.minOrders && s.quantities.length / past.length >= USUAL.minShare)
    .sort((a, b) => b.quantities.length - a.quantities.length || a.index - b.index)
    .slice(0, 20)
    .map((s) => draftLineFrom(s.line, Math.max(1, Math.round(median(s.quantities))), termOf));
  return { lines, ofOrders: past.length };
}

export function createOrderingConversation({ store, tools, interpretTurn, now = Date.now, lastOrder = null, usualOrder: usualFor = null }) {
  // Tilausaikaraja verrataan keskustelun omaan kelloon (tuotannossa portin kello, testeissä kiinnitetty aika).
  const cutoffPassed = (closingTime) => { const t = parseApiTime(closingTime); return t ? t.getTime() <= now() : null; };
  // Aikaisin vielä voimassa oleva raja näytetyistä vaihtoehdoista. Mennyttä rajaa ei luvata; jos kaikki ovat menneet, se sanotaan.
  const cutoffNote = (day, sorted) => {
    const open = sorted.find((c) => !cutoffPassed(c));
    return open ? `${day} ehtii tilata ${helsinkiLabel(open)} asti.` : `${day} tilausaika on jo umpeutunut (${helsinkiLabel(sorted.at(-1))}).`;
  };
  // Kysyy puuttuvat tiedot, näyttää vaihtoehdot tai yhteenvedon. Ei koskaan valitse tuotetta, päivää tai ruokavaatimusta itse.
  // Vastaus "mihin mennessä pitää tilata": aikaisin tilausaikaraja näytetyistä vaihtoehdoista tai yhdestä hausta.
  // Ilman päivää tai tuotteita raja ei ole tiedossa, ja se sanotaan. Ei arvausta.
  async function deadlineAnswer(draft, customer, shownText = '') {
    if (!draft.lines.length) return 'Tilausaikaraja riippuu tuotteista ja toimituspäivästä. Kerro ne, niin kerron rajan.';
    if (!draft.deliveryDate) return 'Tilausaikaraja riippuu toimituspäivästä.';
    const today = helsinki(now());
    const day = draft.deliveryDate === today ? 'Tämän päivän toimitukseen' : draft.deliveryDate === addDays(today, 1) ? `Huomiselle (${dateLabel(draft.deliveryDate)})` : `Päivälle ${dateLabel(draft.deliveryDate)}`;
    let cutoffs = Object.values(draft.offered || {}).flat().map((o) => o?.cutoff).filter((c) => parseApiTime(c));
    if (!cutoffs.length) {
      try {
        const s = await tools.suggest({ customer, draft: { ...draft, lines: [draft.lines[0]] } });
        cutoffs = (s.lines[0]?.options || []).map((o) => o.cutoff).filter((c) => parseApiTime(c));
      } catch { /* ei rajaa ilman työkalua */ }
    }
    const sorted = cutoffs.sort((a, b) => parseApiTime(a) - parseApiTime(b));
    // Pyydetylle päivälle ei ehdi, ja aikaisin päivä on tiedossa: kerrotaan se ja sen tilausaikaraja (C2, X066).
    const e = !sorted.length && draft.earliest?.from === draft.deliveryDate ? draft.earliest : null;
    if (e) {
      let later = [];
      try {
        const line = draft.lines.find((l) => l.ref === e.ref) || draft.lines[0];
        const s = await tools.suggest({ customer, draft: { ...draft, deliveryDate: e.date, lines: [line] } });
        later = (s.lines[0]?.options || []).map((o) => o.cutoff).filter((c) => parseApiTime(c)).sort((a, b) => parseApiTime(a) - parseApiTime(b));
      } catch { /* päivä kerrotaan ilman rajaa */ }
      const open = later.find((c) => !cutoffPassed(c));
      return `${day} ei enää ehdi tilata. Aikaisin toimitettava päivä on ${dateLabel(e.date)}${open ? `, ja sille ehtii tilata ${helsinkiLabel(open)} asti` : ''}.`;
    }
    if (!sorted.length) return /Tilattava viimeistään/.test(shownText) ? '' : `${day} en saanut tilausaikarajaa tilausjärjestelmästä. Yhteenveto kertoo sen, kun tuotteet on valittu.`;
    return cutoffNote(day, sorted);
  }

  /** opts.again = { ref, more } näyttää saman rivin listan uudelleen, opts.more hakee sille seuraavat vaihtoehdot. */
  async function advance(draft, customer, depth = 0, opts = {}) {
    draft.pending = null;
    if (!draft.lines.length) {
      // Päivä tai ruokavalio ennen tuotteita säilyy luonnoksessa (katselmus #11): kuitataan ja kysytään tuotteet.
      const diet = dietLabel(draft.diet);
      if (draft.state === 'active' && (draft.deliveryDate || diet)) {
        // dateLabel päättyy jo pisteeseen ("pe 20.11.").
        const known = [...(draft.deliveryDate ? [`Toimitus ${dateLabel(draft.deliveryDate)}`] : []), ...(diet ? [`Huomioitu: ${diet}.`] : [])].join(' ');
        return { status: 'collecting', text: `${known} Mitä tarvitset? Kirjoita tuotteet ja määrät, esim. "20 l maitoa ja 5 kg voita"${draft.deliveryDate ? '' : ' maanantaiksi'}.` };
      }
      return { status: 'collecting', text: `Luonnos on tyhjä. ${draft.deliveryDate ? HELP : START_QUESTION}` };
    }
    const list = draft.lines.map((l) => `- ${lineLabel(l)}${l.selectedName ? `: ${readableName(l.selectedName)}` : ''}`).join('\n');
    const noQty = draft.lines.filter((l) => !l.quantity);
    const quantityQuestion = `Kuinka paljon: ${noQty.map((l) => l.productTerm).join(', ')}?`;
    // Toimituspäivä ensin: saatavuus, hinnat ja vaihtoehdot riippuvat päivästä. Puuttuvat määrät kysytään samassa viestissä
    // (Eelis 16.11.), mutta tuotteita ei haeta ennen päivää. Mainitut tuotteet säilyvät luonnoksessa.
    if (!draft.deliveryDate) {
      draft.pending = { kind: 'checklist', asks: noQty.length ? ['date', 'quantity'] : ['date'], refs: noQty.map((l) => l.ref) };
      const dateQuestion = draft.rush ? RUSH_DATE_QUESTION : DATE_QUESTION;
      return { status: 'collecting', text: `Luonnoksessa nyt:\n${list}\n\n${dateQuestion}${noQty.length ? `\n${quantityQuestion}` : ''}` };
    }
    // Sitten määrät. Ruokavaliotarkennus kysytään vasta, kun oikeat tilattavat vaihtoehdot eroavat siinä;
    // asiakkaan itse ilmoittamat vaatimukset pätevät aina.
    const questions = []; const asks = [];
    if (noQty.length) { questions.push(quantityQuestion); asks.push('quantity'); }
    if (asks.length) draft.pending = { kind: 'checklist', asks, refs: noQty.map((l) => l.ref) };
    if (!draft.deliverySiteId && customer.deliverySites?.length > 1 && !questions.length) {
      questions.push(`Mihin toimitetaan? ${customer.deliverySites.map((s, i) => `${i + 1}) ${s.label}`).join(' ')}`);
      if (!draft.pending) draft.pending = { kind: 'site', refs: [] };
    }
    if (questions.length) return { status: 'collecting', text: `Luonnoksessa nyt:\n${list}\n\n${questions.join('\n')}` };

    const open = draft.lines.filter((l) => !l.selectedProductId);
    if (open.length) {
      // Yksi tuoterivi kerrallaan: numerot 1-3 viittaavat aina viimeksi näytettyyn listaan, seuraava numero hakee lisää.
      draft.seen ||= {};
      const problems = []; let x = null; let line = null;
      const again = opts.again && open.find((l) => l.ref === opts.again.ref && draft.offered[l.ref]?.length);
      if (again && opts.more && opts.again.more === false) {
        // Lisärivi jäi pois, koska muita tälle päivälle tilattavia ei ollut: ei uutta hakua.
        problems.push(`Muita vaihtoehtoja päivälle ${dateLabel(draft.deliveryDate)} ei löytynyt: ${again.productTerm}.`);
      } else if (again && opts.more) {
        const shownIds = draft.seen[again.ref]?.length ? draft.seen[again.ref] : draft.offered[again.ref].map((o) => o.productId);
        const s = await tools.suggest({ customer, draft: { ...draft, lines: [again] }, exclude: { [again.ref]: shownIds } });
        if (s.lines[0]?.options?.length) {
          x = s.lines[0]; line = again;
          draft.seen[again.ref] = [...new Set([...shownIds, ...x.options.map((o) => o.productId)])];
        } else {
          problems.push(...(s.issues.length ? s.issues.map((i) => i.message) : [`Muita vaihtoehtoja ei löytynyt: ${again.productTerm}.`]));
          // Ei uusia: sama lista ilman lisäpyyntöä, jotta numerot pysyvät samoina.
          if (s.issues.some((i) => i.code === 'NO_MORE_OPTIONS')) opts = { again: { ...opts.again, more: false } };
        }
      }
      if (!x && again) { x = { ref: again.ref, options: draft.offered[again.ref], more: opts.again.more === true, exact: opts.again.exact, ...(opts.again.unknown ? { availabilityUnknown: true } : {}) }; line = again; }
      // Kiireellinen päivä (tänään, huomenna tai kiireeksi sanottu): jos pyydetylle päivälle ei ehdi, haetaan aikaisin
      // päivä, jolle sama tuote on tilattavissa, ja kysytään päivän vaihtoa. Ostajan hylkäämää vaihtoa ei tarjota uudestaan.
      const today = helsinki(now());
      const urgent = draft.rush || draft.deliveryDate <= addDays(today, 1);
      // Saatavuutta ei saatu tarkistettua (rajapinta alhaalla, tuotteesta ei aiempaa tietoa): sama koskee kaikkia päiviä.
      const unknownTerms = []; let blocked = 0;
      // Rivit, joille tällä päivällä ei ole tilattavaa: niitä ei luvata valita seuraavaksi (spagetti pe 20.11., 17.11.).
      // Tieto säilyy luonnoksessa samalle päivälle, jotta "näytä lisää" ei palauta niitä "Sen jälkeen valitaan" -listaan.
      const blockedRefs = new Set(x && draft.noOptions?.date === draft.deliveryDate ? draft.noOptions.refs : []);
      // Tuote, jolle ei ole hintaa eikä saatavuutta millekään päivälle eikä korvaajaa (Valion rajapinta suljettu, data-limits.mjs):
      // jätetään pois listalta ja kerrotaan syy. Ennen rivi jäi odottamaan "poista X" -viestiä, ja keskustelu jumittui siihen
      // (paikallinen koe 17.11.: broilerin rintafilee ja pasta). Eelis: sano selvästi, jos tuotetta ei ole, ja miksi.
      const dropped = [];
      // Rivit ilman vaihtoehtoja, ja auttaisiko toinen päivä niihin (vihje viestin lopussa).
      const failedLines = [];
      if (!x) {
        for (const l of open) {
          const s = await tools.suggest({ customer, draft: { ...draft, lines: [l] } });
          if (s.lines[0]?.options?.length) { problems.push(...s.issues.map((i) => i.message)); x = s.lines[0]; line = l; draft.seen[l.ref] = x.options.map((o) => o.productId); break; }
          const none = s.issues.find((i) => i.code === 'NO_ORDERABLE_PRODUCT' && i.ref === l.ref);
          if (none?.availabilityUnknown) {
            dropped.push(l);
            draft.lines = draft.lines.filter((d) => d.ref !== l.ref);
            delete draft.offered[l.ref]; delete draft.seen[l.ref];
            draft.revision += 1; draft.quote = null;
            continue;
          }
          if (none) { blocked += 1; blockedRefs.add(l.ref); }
          // Tuntematonta saatavuutta ei kannata kokeilla seuraaville päiville: tieto puuttuu niiltäkin.
          if (none && !none.availabilityUnknown && urgent && !(draft.keptDates || []).includes(draft.deliveryDate)) {
            let earliest = none.nextDeliveryDate && none.nextDeliveryDate > draft.deliveryDate ? none.nextDeliveryDate : null;
            for (let k = 1; !earliest && k <= 5; k += 1) {
              const probe = await tools.suggest({ customer, draft: { ...draft, deliveryDate: addDays(draft.deliveryDate, k), lines: [l] } });
              if (probe.lines[0]?.options?.length) earliest = addDays(draft.deliveryDate, k);
            }
            if (earliest) {
              const from = draft.deliveryDate;
              draft.pending = { kind: 'date_offer', date: earliest, from, refs: [l.ref] };
              draft.earliest = { from, date: earliest, ref: l.ref }; // jos ostaja pitää päivän, aikaisin päivä kerrotaan silti
              const when = from === today ? 'Tänään' : from === addDays(today, 1) ? `Huomiseksi (${dateLabel(from)})` : `Päivälle ${dateLabel(from)}`;
              return { status: 'collecting', text: [...problems, `${when} ei enää ehdi: ${l.productTerm}. Aikaisin toimitettava päivä on ${dateLabel(earliest)}`,
                `Vaihdetaanko koko tilauksen toimitus päivälle ${dateLabel(earliest)}?`, `1) kyllä, ${dateLabel(earliest)}`, `2) ei, pidetään ${dateLabel(from)}`].join('\n') };
            }
          }
          problems.push(...s.issues.map((i) => i.message));
          failedLines.push({ term: l.productTerm, dayless: daylessIssue(s.issues, l.ref) });
        }
      }
      if (dropped.length) {
        const many = dropped.length > 1;
        const note = `${noDataFor(dropped.map((l) => l.productTerm))} ${dataReason(draft)}En löytänyt korvaajaa, joten poistin ${many ? 'rivit' : 'rivin'} listalta.`.replace(/\s+/gu, ' ');
        if (!draft.lines.length) {
          return { status: 'collecting', text: `${note}\n\nHyvin löytyy esimerkiksi ${HAVE}. Mitä laitetaan tilalle?` };
        }
        // Muut rivit on jo valittu: suoraan yhteenvetoon.
        if (!x && draft.lines.every((l) => l.selectedProductId)) {
          const next = await advance(draft, customer, depth);
          return { ...next, text: `${note}\n\n${next.text}` };
        }
        problems.unshift(note);
      }
      if (!x) {
        const e = draft.earliest?.from === draft.deliveryDate ? draft.earliest : null;
        // dateLabel päättyy pisteeseen ("ti 17.11."), joten perään ei tule toista (Haiku-otos X064: "ti 17.11..").
        // Kun toinen päivä ei auta yhteenkään riviin, ei kehoteta vaihtamaan päivää (Eelis 18.11.: lanttulaatikon vastauksen
        // perässä "Kokeile toista päivää"), vaan kerrotaan, miten listaa jatketaan.
        const stuck = failedLines.length && failedLines.every((f) => f.dayless);
        const hint = e ? `Aikaisin toimitettava päivä on ${dateLabel(e.date)} Kirjoita "${dateLabel(e.date)}", jos se käy.`
          : stuck ? `Kirjoita ${joinFi(failedLines.map((f) => `"poista ${f.term}"`))} tai kerro, mitä laitetaan tilalle.`
            : 'Kokeile toista päivää tai tarkenna tuotetta.';
        return { status: 'collecting', text: `${mergeUnavailable(problems).join('\n')}\n${hint} Tilausta ei ole tehty.` };
      }
      // Kappalemäärä ei kerro kiloja (puhelinkuva 17.11.: "kanan fileesuikale 100 kpl" → 100 kg, 899 €). Kiloina myytävää
      // tuotetta ei tarjota kappaleriville. Kun vähintään puolet vaihtoehdoista myydään kiloina, tuote on kilotavaraa ja
      // kilot kysytään (muuten 100 kpl → 100 rasiaa à 3 kg = 300 kg). Muuten kiloina myytävät vain jäävät pois (10 kpl leipää).
      // Edellisestä tilauksesta kopioitu rivi (packFor) on jo oikeina myyntierinä, eikä munien kappalemäärä (items) koske tätä.
      if (line.quantity?.unit === 'PCS' && (line.quantity.basis !== 'items' || !isEggItem(line)) && !line.packFor) {
        const counted = x.options.filter((o) => o.salesUnitLabel !== 'kg');
        if (!again && counted.length * 2 <= x.options.length) {
          const asked = line.quantity;
          line.quantity = null; line.byWeight = true; delete draft.offered[line.ref]; delete draft.seen[line.ref];
          draft.revision += 1; draft.quote = null;
          draft.pending = { kind: 'checklist', asks: ['quantity'], refs: [line.ref] };
          const rows = draft.lines.map((l) => `- ${lineLabel(l)}${l.selectedName ? `: ${l.selectedName}` : ''}`).join('\n');
          return { status: 'collecting', text: [...problems, `${cap(line.productTerm)} myydään kiloina, joten määrästä ${num(asked.value)} kpl en voi laskea tilattavia kiloja.`,
            `Luonnoksessa nyt:\n${rows}`, `Kuinka monta kiloa laitetaan: ${line.productTerm}?`].join('\n\n') };
        }
        if (!counted.length) {
          // Lisäsivulla vain kiloina myytäviä: näytetään edellinen lista, numerot pysyvät samoina.
          problems.push(`Muita kappaleina myytäviä vaihtoehtoja ei löytynyt: ${line.productTerm}.`);
          x = { ref: line.ref, options: draft.offered[line.ref] || [], more: false, exact: x.exact };
        } else if (counted.length < x.options.length) x = { ...x, options: counted };
      }
      if (line.avoidClaims?.includes('FREE_FROM_LACTOSE')) {
        const regular = x.options.filter((o) => !lactoseFree(o));
        if (regular.length) x = { ...x, options: regular };
        else if (!again) problems.push(`Tavallista (ei laktoositonta) vaihtoehtoa ei löytynyt: ${line.productTerm}. Näytän kaikki vaihtoehdot.`);
      }
      draft.offered[x.ref] = x.options;
      if (x.exact === false) line.noExact = true; else delete line.noExact;
      // Ruokavaliotarkennus vain, kun vaihtoehdot ovat pyydettyä tuotetta: kamelinmaidon puuttuessa ei kysytä maidon laktoosia (S036).
      const preference = !again && x.exact !== false && !draft.diet.known && (x.clarify || []).find((claim) => !line.answeredClaims?.includes(claim)
        && !line.claims.includes(claim) && !draft.diet.claims.includes(claim));
      if (preference) {
        draft.pending = { kind: 'preference', refs: [x.ref], claim: preference };
        return { status: 'collecting', text: `Luonnoksessa nyt:\n${list}\n\n${cap(line.productTerm)}: haluatko laktoositonta vai käykö tavallinen?\n1) laktoositon\n2) tavallinen käy` };
      }
      // Ostajan valtuutus "valitse ensimmäinen sopiva": ykkönen valitaan ja kerrotaan, ellei tarkkaa osumaa tai varoitusta ole.
      if (line.pickFirst && x.exact !== false && x.options[0] && !x.options[0].warning) {
        const o = x.options[0];
        line.selectedProductId = o.productId; line.selectedName = o.name; line.selectedWarning = null; delete line.pickFirst;
        draft.revision += 1; draft.quote = null;
        const next = await advance(draft, customer, depth);
        return { ...next, text: [...problems, `Valitsin ensimmäisen sopivan vaihtoehdon: ${cap(lineLabel(line))}: ${optionLabel(o, line)}.`, next.text].join('\n\n') };
      }
      const moreNo = x.more ? x.options.length + 1 : null;
      draft.pending = { kind: 'choose', refs: [x.ref], options: x.options.length, more: moreNo, ...(x.exact === false ? { exact: false } : {}), ...(x.availabilityUnknown ? { unknown: true } : {}) };
      // Valintaohje ja lisävaihtoehdot omilla riveillään (Eelis 18.11.): "Vastaa 1 tai 2." ja "Jos haluat muita
      // vaihtoehtoja, vastaa 3." Lisävaihtoehtojen numero ei ole enää listan rivi.
      const numbers = x.options.map((_, i) => String(i + 1));
      // Yksi vaihtoehto: "Vastaa 1." kuulosti käskyltä ilman valintaa (puhelinkuva 17.11.), joten kysytään, käykö se.
      const single = numbers.length === 1;
      const how = single ? (x.availabilityUnknown ? `Vastaa 1, jos tämä käy. Muuten kirjoita "poista ${line.productTerm}".` : 'Vastaa 1, jos tämä käy.')
        : `Vastaa ${numbers.slice(0, -1).join(', ')} tai ${numbers.at(-1)}.`;
      const unknownBefore = draft.noOptions?.date === draft.deliveryDate ? draft.noOptions.unknown || [] : [];
      const unknownNow = [...new Set([...unknownBefore, ...unknownTerms])];
      draft.noOptions = { date: draft.deliveryDate, refs: [...blockedRefs].filter((ref) => ref !== x.ref), unknown: unknownNow };
      const still = open.filter((l) => !dropped.includes(l));
      const blockedTerms = still.filter((l) => l.ref !== x.ref && blockedRefs.has(l.ref)).map((l) => l.productTerm);
      const later = still.filter((l) => l.ref !== x.ref && !blockedRefs.has(l.ref)).map((l) => l.productTerm);
      // Tuntematon saatavuus puuttuu kaikilta päiviltä: päivän vaihto ei auta, joten sitä ei ehdoteta.
      const dayHelps = blockedTerms.some((t) => !unknownNow.includes(t));
      const many = blockedTerms.length > 1;
      const blockedNote = blockedTerms.length ? `\n${cap(joinFi(blockedTerms))} ${many ? 'jäävät' : 'jää'} ilman tuotetta ${dayHelps ? 'tälle päivälle. Vaihda päivä tai tuote' : `toistaiseksi. Valitse ${many ? 'toiset tuotteet' : 'toinen tuote'}`}, tai poista ${many ? 'ne' : 'se'} kirjoittamalla ${joinFi(blockedTerms.map((t) => `"poista ${t}"`))}.` : '';
      const diet = dietLabel(draft.diet);
      // Myyntierä voi olla tarvetta suurempi: kerrotaan, ettei tarvetta ole muutettu. Pelkät luomuvaihtoehdot mainitaan.
      const covered = x.options.filter((o) => o.covers?.unit === line.quantity.unit).map((o) => o.covers.value);
      const smallest = covered.length ? Math.min(...covered) : null;
      const notes = [...(smallest > line.quantity.value ? [`Tarve on ${qty(line.quantity)}; ${single ? 'tämä myyntierä kattaa' : 'pienin näistä myyntieristä kattaa'} ${qty({ value: smallest, unit: line.quantity.unit })}.`] : []),
        ...(!line.claims.includes('EU_ORGANIC_FARMING') && x.options.every((o) => o.labels?.includes('EU_ORGANIC_FARMING')) ? ['Näytetyt vaihtoehdot ovat luomua.'] : []),
        // Vastaavat tuotteet toisessa mittayksikössä (1000 l jäätelöä → leivokset): hinta on yhdestä myyntierästä, määrä kysytään.
        ...(x.options.some((o) => o.askQuantity) ? [`${x.options.every((o) => o.askQuantity) ? 'Hinnat ovat' : 'Määrää vailla olevien hinta on'} yhdestä myyntierästä: tarve ${qty(line.quantity)} ei muunnu ${x.options.every((o) => o.askQuantity) ? 'näihin tuotteisiin' : 'kaikkiin näistä'}, joten määrä kysytään valinnan jälkeen.`] : []),
        ...(x.availabilityUnknown && !single ? [`Jos mikään näistä ei käy, kirjoita "poista ${line.productTerm}".`] : [])];
      // Kiireessä tilausaikaraja näkyy jo vaihtoehdoissa (aikaisin näytetyistä, työkalujen tiedoista). Kellonaikaa ei luvata.
      const cutoffs = urgent ? x.options.map((o) => o.cutoff).filter((c) => parseApiTime(c)).sort((a, b) => parseApiTime(a) - parseApiTime(b)) : [];
      const day = draft.deliveryDate === today ? 'Tämän päivän toimitukseen' : draft.deliveryDate === addDays(today, 1) ? 'Huomiselle' : `Päivälle ${dateLabel(draft.deliveryDate)}`;
      if (cutoffs.length) notes.push(cutoffNote(day, cutoffs));
      if (draft.timeWish && !draft.timeWishNoted) { notes.push(timeWishNote(draft)); draft.timeWishNoted = true; }
      // Selkeä jäsennys (Eelis 18.11.): toimitus ja hinnat omilla riveillään, puuttuvasta tuotteesta yksi lause ja
      // korvaajat, sitten kysymys ja ohjeet. Aiempaa toimituspäivää ei ehdoteta varmuuden vuoksi.
      const tarve = `tarve ${qty(line.quantity)}`;
      // Valmisruoan tilalle sen pääraaka-aine (Eelis 18.11.: lanttulaatikon tilalle lanttua, ei maksalaatikkoa).
      const ingredient = x.ingredient || (x.options.length && x.options.every((o) => o.ingredient) ? x.options[0].replaceTerm : null);
      const offer = ingredient ? `Tilalle käy raaka-aine ${ingredient} (${tarve}):` : null;
      const head = x.exact === false
        ? (x.availabilityUnknown
          // "Hups, juustolle minulla ei ole …" ja syy kerran (Eelis 17.11.). Yksi vaihtoehto: "Tämä löytyy tilalle".
          ? [`${noDataFor([line.productTerm])} ${dataReason(draft)}`.trim(), offer || `${single ? 'Tämä löytyy tilalle' : 'Tässä korvaajia'} (${tarve}):`]
          : ingredient ? [`${cap(allative(line.productTerm))} ei löytynyt tilattavaa.`, offer]
          : [`${cap(allative(line.productTerm))} ei valitettavasti löytynyt osumaa.`, `${single ? 'Tässä korvaaja' : 'Tässä korvaajia'} (${tarve}):`])
        : [`*${cap(lineLabel(line))}:*`];
      const block = [`Toimitus: ${dateLabel(draft.deliveryDate)}`, 'Hinnat alv 0 %', ...(diet ? [`Huomioitu: ${diet}`] : []),
        ...head, ...x.options.map((o, i) => `${i + 1}) ${optionLabel(o, line)}`), ...notes, how,
        ...(moreNo ? [`Jos haluat muita vaihtoehtoja, vastaa ${moreNo}.`] : []),
        ...(later.length ? [`Sen jälkeen valitaan ${joinFi(later)}.`] : [])].join('\n') + blockedNote;
      return { status: 'choosing', text: [...mergeUnavailable(problems), block].join('\n\n') };
    }

    const q = await tools.quote({ customer, draft });
    if (q.issues.length) {
      // Tilattavaksi kelpaamaton valinta puretaan, jotta ostaja valitsee uudelleen. Mitään ei vaihdeta hiljaa.
      // Kaatunut tuote muistetaan rivillä (päivä ja määrä mukana), jotta samat vaihtoehdot eivät palaa uudelleen
      // (puhelinkuva 17.11.: sipuli, valinta 3 → "Määrää ei voi muuntaa" → samat kolme vaihtoehtoa). Viesti nimeää tuotteen.
      const said = q.issues.map((i) => {
        const l = draft.lines.find((line) => line.ref === i.ref);
        if (!l) return i.message;
        const id = i.productId || (l.selectedProductId ? String(l.selectedProductId) : null);
        const name = l.selectedName;
        if (id) {
          const f = l.failedOptions; const qn = l.quantity || {};
          const same = f && f.deliveryDate === (draft.deliveryDate || null) && f.quantity?.value === qn.value && f.quantity?.unit === qn.unit && (f.quantity?.basis || 'sales') === (qn.basis || 'sales');
          l.failedOptions = { deliveryDate: draft.deliveryDate || null, quantity: l.quantity ? { ...l.quantity } : null, ids: [...new Set([...(same ? f.ids : []), id])] };
        }
        l.selectedProductId = null; l.selectedName = null; l.selectedWarning = null; delete draft.offered[l.ref]; delete draft.seen?.[l.ref];
        return name && id ? `${cap(readableName(name))} ei käy${i.reason ? `: ${String(i.reason).replace(/\.$/u, '')}` : ''}. Jätin sen pois vaihtoehdoista.` : i.message;
      });
      const text = `${said.join('\n')}\nTilausta ei ole tehty.`;
      if (depth < 1 && q.issues.some((i) => i.ref)) { const next = await advance(draft, customer, depth + 1); return { ...next, text: `${text}\n\n${next.text}` }; }
      return { status: 'collecting', text };
    }
    draft.quote = { quoteId: q.quoteId, revision: draft.revision, expiresAt: q.expiresAt };
    return { status: 'ready', text: summary(draft, q, customer) };
  }

  async function confirm(draft, customer) {
    if (!draft.quote || draft.quote.revision !== draft.revision) {
      const next = await advance(draft, customer);
      return { ...next, text: `Vahvistettavaa yhteenvetoa ei vielä ole.\n\n${next.text}` };
    }
    if (customer.permissions?.placeOrders !== true) return { status: 'error', text: 'Sinulla ei ole tilausoikeutta tälle asiakkuudelle. Luonnos säilyy, tilausta ei tehty.' };
    if (Date.parse(draft.quote.expiresAt) <= now()) {
      draft.quote = null;
      const next = await advance(draft, customer);
      return { ...next, text: `Tarjous ehti vanhentua, joten tarkistin hinnat uudelleen. Tilausta ei vielä tehty.\n\n${next.text}` };
    }
    const quoteId = draft.quote.quoteId;
    const r = await tools.submit({ customer, draft, quoteId, approval: { draftId: draft.id, revision: draft.revision, quoteId }, idempotencyKey: `wa-${draft.id}-r${draft.revision}` });
    if (r.status === 'confirmed' || r.status === 'pending_approval') {
      // Rakenteinen tilaustunnus ja tila talteen: maksupolku ei poimi tunnusta tekstistä, ja uusinta säilyttää hyväksyntätilan.
      draft.state = 'ordered'; draft.orderId = r.orderId; draft.orderStatus = r.status;
      const total = r.totals ? `, yhteensä ${eur(r.totals.net)} (alv 0 %)` : '';
      return { status: r.status, orderId: r.orderId, text: r.status === 'confirmed'
        ? `Tilaus ${r.orderId} on tallennettu. Toimitus ${dateLabel(r.deliveryDate || draft.deliveryDate)}${total}.\nTämä on demoympäristö: oikeaa Valio-tilausta ei lähetetty.`
        : `Tilaus ${r.orderId} odottaa yrityksesi hyväksyjän kuittausta${total}. Tilaus ei ole vielä vahvistettu.\nTämä on demoympäristö: oikeaa Valio-tilausta ei lähetetty.` };
    }
    draft.quote = null;
    return { status: 'rejected', text: `Tilausta ei tehty:\n${(r.reasons || []).map((x) => `- ${x.message}`).join('\n') || '- Tilaus hylättiin.'}\nLuonnos säilyy. Kirjoita "näytä", niin tarkistan tilanteen uudelleen.` };
  }

  return async function handleTurn({ messageId, conversationId, customer, text, receivedAt, context }) {
    const done = store.result(messageId);
    if (done) return done; // sama viesti uudelleen: sama vastaus, ei uusia muutoksia
    if (!customer?.customerId || customer.permissions?.readProducts !== true) return { status: 'error', text: 'Asiakkuuttasi ei voitu vahvistaa, joten en voi näyttää tuotteita tai tehdä tilausta.' };
    const t = String(text || '').trim().slice(0, 4000);
    const today = helsinki(now());
    let draft = store.active(conversationId);
    // Luonnos kuuluu yhdelle asiakkuudelle ja sidokselle. Vaihtunut sidos ei peri vanhaa luonnosta.
    if (draft && (draft.customerId !== customer.customerId || draft.bindingVersion !== customer.bindingVersion)) { draft.state = 'cancelled'; store.save(conversationId, draft, `${messageId}:rebind`, {}); draft = null; }
    draft ||= newDraft(customer);
    draft.diet ||= { known: false, claims: [], excludeAllergens: [] };
    // Tauon jälkeen jatkettu luonnos: mennyt toimituspäivä ei kelpaa tarjoukseen, joten päivä kysytään uudelleen.
    // Tuotteet, määrät ja valinnat säilyvät; hinnat ja saatavuus tarkistetaan uudelle päivälle.
    let pastDate = null;
    if (draft.state === 'active' && validDate(draft.deliveryDate) && draft.deliveryDate < today) {
      pastDate = draft.deliveryDate;
      draft.deliveryDate = null; draft.offered = {}; draft.seen = {}; draft.quote = null; draft.pending = null; delete draft.earliest;
      draft.revision += 1;
    }
    let result;
    try {
      if (CANCEL.test(t) || CANCEL_ALL.test(t)) {
        draft.state = 'cancelled';
        result = { status: 'collecting', text: 'Luonnos tyhjennetty. Tilausta ei tehty.' };
      } else if (CONFIRM.test(t)) {
        const last = !draft.lines.length && store.lastOrdered(conversationId);
        // Tunnus vain, kun tallennetun tilauksen tila tiedetään. Vanha luonnos ilman tilaa ei tuota maksulinkkiä tekstin perusteella.
        result = last ? { status: last.orderStatus || 'confirmed', ...(last.orderStatus && last.orderId ? { orderId: last.orderId } : {}),
          text: `Tilaus ${last.orderId} on jo tallennettu. Uutta tilausta ei tehty.` } : await confirm(draft, customer);
      } else if (THANKS.test(t)) {
        const ready = draft.quote?.revision === draft.revision && !draft.pending;
        result = ready ? { status: 'ready', text: 'Ole hyvä! Luonnos odottaa vahvistusta: vastaa *TILAA*, kun haluat tilata.' }
          : draft.lines.length ? { status: 'collecting', text: 'Ole hyvä! Luonnos on tallessa ja jatkuu siitä, mihin jäätiin.' }
            : { status: 'collecting', text: 'Ole hyvä! Kirjoita, kun tarvitset jotain.' };
      } else if (VAGUE_YES.test(t) && draft.quote?.revision === draft.revision && !draft.pending) {
        result = { status: 'ready', text: 'Vahvista tilaus vastaamalla *TILAA*. Muuten luonnos jää odottamaan.' };
      } else {
        const before = content(draft);
        // Tarkennus on numeroitu kuten vaihtoehdot: 1 = laktoositon, 2 = tavallinen käy.
        const preferenceNo = draft.pending?.kind === 'preference' && PREF_NO.test(t);
        const preferenceYes = draft.pending?.kind === 'preference' && !preferenceNo && PREF_YES.test(t);
        // Kiire ja kellonaikatoive kirjataan viestistä; ne eivät muuta luonnoksen sisältöä eivätkä ole lupaus.
        const wish = t.match(TIME_WISH)?.[0];
        if (wish) { draft.timeWish = wish.slice(0, 40); draft.timeWishNoted = false; }
        if (wish || RUSH.test(t)) draft.rush = true;
        // Vastaus aikaisimman päivän ehdotukseen: 1/kyllä vaihtaa koko tilauksen päivän, 2/ei pitää pyydetyn.
        const offer = draft.pending?.kind === 'date_offer' ? draft.pending : null;
        const dateAnswer = offer && DATE_YES.test(t) ? { intent: 'order', deliveryDate: offer.date, ops: [] }
          : offer && DATE_NO.test(t) ? (draft.keptDates = [...new Set([...(draft.keptDates || []), offer.from])], { intent: 'order', ops: [] }) : null;
        // Vastaus viimeksi näytettyyn vaihtoehtolistaan: numero, "halvin" tai "näytä lisää". Koodissa, ei mallikutsua.
        const choosing = draft.pending?.kind === 'choose' && draft.pending.refs?.length === 1 ? draft.pending : null;
        const shownOptions = choosing ? draft.offered[choosing.refs[0]] || [] : [];
        const picked = choosing ? Number(t.match(PICK)?.[1]) : NaN;
        // "4" tai listan seuraava numero on lisäpyyntö myös silloin, kun lisärivi jäi pois: silloin kerrotaan, ettei lisää ole.
        const nextNumber = choosing && choosing.more == null && picked > shownOptions.length && (picked === shownOptions.length + 1 || picked === 4);
        const wantsMore = Boolean(choosing && ((picked && picked === choosing.more) || nextNumber || MORE.test(t)));
        const cheapest = choosing && shownOptions.length && CHEAPEST.test(t)
          ? shownOptions.reduce((best, o, i) => (o.lineNet < shownOptions[best].lineNet ? i : best), 0) + 1 : null;
        // Pelkkä vertailukysymys näytettyyn listaan ("mikä näistä on ympäristöystävällisin?"): ei valintaa eikä mallikutsua.
        const compare = compareKind(t);
        const askOnly = Boolean(choosing && compare && !PICK_WORD.test(t));
        const choice = SHOW.test(t) ? { intent: 'show', ops: [] }
          : wantsMore || askOnly ? { intent: 'order', ops: [] }
          : picked ? { intent: 'order', ops: [{ op: 'select', ref: choosing.refs[0], option: picked }] }
            : cheapest ? { intent: 'order', ops: [{ op: 'select', ref: choosing.refs[0], option: cheapest }] } : null;
        // Edellinen tilaus uuteen tyhjään luonnokseen: tuotteet, määrät, valinnat ja ruokavalio, ei päivää. Ensisijaisesti
        // gatewayn viimeisin vahvistettu tilaus samalle ostajalle (toimii myös nollauksen ja korisivun vahvistuksen jälkeen);
        // jos se on tämän keskustelun oma tilaus, käytetään keskustelun rivejä hakusanoineen ja ruokavalioineen.
        const repeat = !draft.lines.length && REPEAT_LAST.test(t);
        const own = repeat ? store.lastOrdered(conversationId) : null;
        let confirmed = null;
        if (repeat && lastOrder) { try { confirmed = await lastOrder(customer); } catch { confirmed = null; } }
        // "Se tavallinen" tyhjään luonnokseen: ostajan toistuvat tuotteet gatewayn vahvistetuista tilauksista (usualOrder).
        const usual = !draft.lines.length && !repeat && USUAL_ORDER.test(t);
        let usualFound = null;
        if (usual && usualFor) { try { usualFound = await usualFor(customer); } catch { usualFound = null; } }
        const last = usual ? usualFound : confirmed?.lines?.length && own?.orderId !== confirmed.orderId ? confirmed : own;
        if (last?.lines?.length) {
          const factor = repeat || usual ? repeatFactor(t) : 1;
          const scaled = (q) => (!q || factor === 1 ? q : { ...q, value: q.unit === 'PCS' ? Math.max(1, Math.ceil(q.value * factor)) : +(q.value * factor).toFixed(3) });
          for (const l of last.lines.slice(0, 20)) {
            draft.lines.push({ ref: `L${++draft.seq}`, productTerm: l.productTerm, quantity: scaled(l.quantity), claims: l.claims || [], excludeAllergens: l.excludeAllergens || [],
              selectedProductId: l.selectedProductId || null, selectedName: l.selectedName || null, selectedWarning: l.selectedWarning || null,
              ...(l.packLabel ? { packLabel: l.packLabel, packFor: l.packFor } : {}) });
          }
          if (last.diet) draft.diet = { known: !!last.diet.known, claims: last.diet.claims || [], excludeAllergens: last.diet.excludeAllergens || [] };
        }
        // Toistopyyntö ei ole tuote: sääntötulkki teki fraasista "sitä samaa ku viimeks" rivin "sima". Tulkille annetaan vain
        // muu osa viestistä ("sama ku viimeks, mut 10 l maitoa lisää" → "mut 10 l maitoa lisää"); pelkkä toisto ei tulkita.
        const toInterpret = (repeat ? t.replace(REPEAT_LAST, ' ') : usual ? t.replace(USUAL_ORDER, ' ') : t).replace(repeat || usual ? MULTIPLIER : /$^/u, ' ');
        const onlyRepeat = (repeat || usual) && !/\p{L}{2}/u.test(toInterpret.replace(REPEAT_FILLER, ' '));
        const recheck = 'Hinnat ja saatavuus tarkistetaan uudelle toimituspäivälle.';
        const repeatNote = !last?.lines?.length ? ''
          : !usual ? `Kopioin edellisen tilauksen${last.orderId ? ` ${last.orderId}` : ''} tuotteet${repeatFactor(t) === 1 ? '' : repeatFactor(t) === 2 ? ' tuplamäärinä' : repeatFactor(t) === 0.5 ? ' puolikkain määrin' : ` ${String(repeatFactor(t)).replace('.', ',')}-kertaisina`}. ${recheck}`
            : last.single ? `Löysin vasta yhden aiemman tilauksen (${last.single}), joten kopioin sen tuotteet tavalliseksi tilaukseksi. ${recheck}`
              : `Kokosin tavallisen tilauksesi ${last.ofOrders} viime tilauksesta: tuotteet, jotka ovat olleet mukana vähintään puolessa niistä, tavallisella määrällä. ${recheck}`;
        // Tavallista tilausta ei löytynyt: kerrotaan miksi. Muuten viestin muut tuotteet lisätään kuten ennenkin.
        const usualMissing = usual && !last?.lines?.length ? (usualFound?.ofOrders
          ? 'Aiemmissa tilauksissasi ei ole toistuvia tuotteita, joten tavallista tilausta ei voi koota. Kirjoita "sama kuin viimeksi", niin kopioin viimeisimmän tilauksen.'
          : 'En löydä aiempia tilauksia, joten tavallista tilausta ei vielä ole.') : '';
        // Tulkki ajetaan silti: samassa viestissä voi olla lisäyksiä ("sama ku viimeks, mut 10 l maitoa lisää").
        // Vastaus kilokysymykseen ("30", "30 kg"): kilot suoraan kysyttyyn riviin ilman tulkkia (kiloina myytävä tuote).
        const weightLine = draft.pending?.kind === 'checklist' && draft.pending.asks?.includes('quantity') ? draft.lines.find((l) => l.ref === draft.pending.refs?.[0] && l.byWeight) : null;
        const kilos = weightLine && t.match(/^(\d+(?:[.,]\d+)?)\s*(?:kg|kilo\p{L}*)?[.!\s]*$/iu);
        // Vastaus myyntieräkysymykseen ("2", "2 laatikkoa"), kun pakkauksen kappalemäärää ei tiedetä.
        const packLine = !weightLine && draft.pending?.kind === 'checklist' && draft.pending.asks?.includes('quantity') ? draft.lines.find((l) => l.ref === draft.pending.refs?.[0] && l.askPacks) : null;
        const packs = packLine && t.match(/^(\d+)\s*(?:kpl|kappale\p{L}*|ltk|laatik\p{L}*|pkt|paket\p{L}*|pakkau\p{L}*|rasi\p{L}*|säk\p{L}*|pussi\p{L}*|purk\p{L}*|tölk\p{L}*|pullo\p{L}*|kotelo\p{L}*|myyntierä\p{L}*|erä\p{L}*)?[.!\s]*$/iu);
        const weightAnswer = kilos ? { intent: 'order', ops: [{ op: 'update', ref: weightLine.ref, quantity: { value: Number(kilos[1].replace(',', '.')), unit: 'KG' } }] }
          : packs ? { intent: 'order', ops: [{ op: 'update', ref: packLine.ref, quantity: { value: Number(packs[1]), unit: 'PCS', basis: 'sales' } }] } : null;
        const interpreted = dateAnswer || choice || weightAnswer || (preferenceYes || preferenceNo ? { intent: 'order', ops: draft.pending.refs.map((ref) => preferenceYes
          ? { op: 'update', ref, addClaims: [draft.pending.claim] } : { op: 'no_preference', ref }) }
          : onlyRepeat ? { intent: 'order', ops: [] }
          : await interpretTurn({ text: withoutClockWords(toInterpret), draft: structuredClone(draft), today, now: now(), receivedAt, context }));
        // Pelkkä kysymys (tilausaikaraja, hintavertailu, vaihtoehdot uudelleen) ei lisää tuoterivejä: sääntötulkki teki
        // jutustelusta rivejä "mirin pit tila" ja "half" (katselmus #21). Määrä viestissä tarkoittaa tilausmuutosta.
        const questionOnly = interpreted !== dateAnswer && interpreted !== choice && (DEADLINE_QUESTION.test(t) || compareKind(t) || RELIST.test(t)) && !/\d/.test(t);
        const turn = questionOnly ? { ...interpreted, ops: (interpreted.ops || []).filter((o) => o.op !== 'add') } : interpreted;
        // Sanallinen vastaus päivänsiirtoon: sama päivä tai kielto pitää pyydetyn päivän, eikä siirtoa kysytä uudelleen (C2).
        if (offer && !dateAnswer && (turn.deliveryDate === offer.from || (!turn.deliveryDate && DATE_REFUSAL.test(t)))) {
          draft.keptDates = [...new Set([...(draft.keptDates || []), offer.from])];
        }
        // Aikaisimman päivän hyväksyntä ("1" tai "tilaa sitten ti 17.11."): ostajalla on kiire, joten uuden päivän
        // vaihtoehtojen alla kerrotaan tilausaikaraja (Haiku-otos X064: raja ei näkynyt ennen korilinkkiä).
        if (offer && turn.deliveryDate === offer.date) draft.rush = true;
        const pendingRefs = draft.pending?.refs || [];
        const moreAsked = wantsMore || Boolean(choosing && (turn.ops || []).some((o) => o.op === 'more' && (!o.ref || o.ref === choosing.refs[0])));
        const selectedBefore = new Map(draft.lines.map((l) => [l.ref, l.selectedProductId]));
        const linesBefore = draft.lines.map((l) => ({ ref: l.ref, term: l.productTerm, noExact: !!l.noExact }));
        const notes = apply(draft, turn, customer, today);
        const removed = linesBefore.filter((b) => !draft.lines.some((l) => l.ref === b.ref));
        if (removed.length && draft.lines.length) notes.unshift(removedNote(removed));
        // "Vaihda tavalliseen": valittu laktoositon tuote vaihdetaan avaamalla valinta, ja vaihtoehdoista näytetään tavalliset (C4).
        if (SWITCH_REGULAR.test(t) && !draft.diet.claims.includes('FREE_FROM_LACTOSE')) {
          const chosen = draft.lines.filter((l) => l.selectedProductId && !l.claims.includes('FREE_FROM_LACTOSE')
            && lactoseFree((draft.offered[l.ref] || []).find((o) => o.productId === l.selectedProductId) || { name: l.selectedName }));
          const named = chosen.filter((l) => mentions(t, l.productTerm));
          for (const l of named.length ? named : chosen) {
            l.avoidClaims = ['FREE_FROM_LACTOSE']; l.answeredClaims = [...new Set([...(l.answeredClaims || []), 'FREE_FROM_LACTOSE'])];
            l.selectedProductId = null; l.selectedName = null; l.selectedWarning = null; delete draft.offered[l.ref]; delete draft.seen?.[l.ref];
          }
        }
        // "Valitse ensimmäinen sopiva": nimetylle riville, muuten kysytylle riville, muuten kaikille valitsemattomille (C5).
        if (FIRST_SUITABLE.test(t)) {
          const open = draft.lines.filter((l) => !l.selectedProductId);
          const named = open.filter((l) => mentions(t, l.productTerm));
          const asked = open.filter((l) => pendingRefs.includes(l.ref));
          for (const l of named.length ? named : asked.length ? asked : open) l.pickFirst = true;
        }
        // Kaikki rivit poistettu: luonnos suljetaan, myös sen päivä (pilotti X016).
        if (linesBefore.length && !draft.lines.length) draft.state = 'cancelled';
        if (repeatNote) notes.unshift(repeatNote);
        if (usualMissing && draft.lines.length) notes.unshift(usualMissing);
        // Pyyntö näyttää tai vertailla vaihtoehtoja jo valitulle riville: valinta avataan ja sama lista näytetään uudelleen,
        // ostaja valitsee numerolla (V025: "listaa vaihtoehdot hintoineen" toisti valitun yhteenvedon neljästi).
        // Tässä viestissä tehtyä valintaa ei pureta.
        const reopen = !choosing && (RELIST.test(t) || compare) ? reopenTarget(draft, t) : null;
        const reopened = reopen && selectedBefore.get(reopen.ref) === reopen.selectedProductId ? reopen : null;
        if (reopened) { reopened.selectedProductId = null; reopened.selectedName = null; reopened.selectedWarning = null; }
        draft.turn += 1;
        const unchanged = content(draft) === before;
        if (!unchanged) { draft.revision += 1; draft.quote = null; }
        else if (!draft.lines.length && REPEAT_LAST.test(t)) {
          // Tulkin tulkinnasta riippumatta: aiempaa tilausta ei ole, joten kysytään päivä ja tuotteet (itsepeli S030).
          result = { status: 'collecting', text: `En löydä aiempaa tilausta tästä keskustelusta. ${draft.deliveryDate ? HELP : START_QUESTION}` };
        } else if (turn.intent === 'other' && !notes.length && !draft.lines.length) {
          result = { status: 'collecting', text: `Olen Valio Aimon digitaalinen tilausapuri. ${draft.deliveryDate ? HELP : START_QUESTION}` };
        }
        // Tavallista tilausta ei löytynyt eikä viestissä ollut muita tuotteita: syy ja seuraava kysymys (myös kun päivä kirjattiin).
        if (!result && usualMissing && !draft.lines.length) result = { status: 'collecting', text: `${usualMissing} ${draft.deliveryDate ? HELP : START_QUESTION}` };
        if (!result) {
          const asksDeadline = DEADLINE_QUESTION.test(t);
          // Muuttumaton luonnos: sama lista uudelleen (virheellinen numero) tai seuraavat vaihtoehdot ilman uutta alkuhakua.
          const next = await advance(draft, customer, 0, choosing && unchanged ? { again: { ref: choosing.refs[0], more: choosing.more != null, exact: choosing.exact, unknown: choosing.unknown }, more: moreAsked }
            : reopened && draft.offered[reopened.ref]?.length ? { again: { ref: reopened.ref, more: true } } : {});
          // Vertailu näytetyistä vaihtoehdoista. Jos lista tulee vasta tarkennuksen jälkeen, kysymys muistetaan siihen asti.
          const kind = compare || draft.compare || null;
          let compared = '';
          if (kind && next.status === 'choosing' && draft.pending?.kind === 'choose') { compared = compareAnswer(kind, draft.offered[draft.pending.refs[0]]); draft.compare = null; }
          else if (kind && ['preference', 'checklist', 'date_offer', 'site'].includes(draft.pending?.kind)) draft.compare = kind;
          else {
            draft.compare = null;
            if (compare && next.status === 'ready' && draft.lines.length > 1) compared = `Kerro, minkä tuotteen vaihtoehdot näytän: ${joinFi(draft.lines.map((l) => l.productTerm))}.`;
          }
          const deadline = asksDeadline ? await deadlineAnswer(draft, customer, next.text) : '';
          // Tilausaikavastaus kertoi jo aikaisimman päivän: samaa virkettä ei toisteta saman viestin lopussa (X064).
          const earliest = deadline.match(/Aikaisin toimitettava päivä on \p{L}+ \d{1,2}\.\d{1,2}\./u)?.[0];
          const body = earliest ? next.text.replace(`${earliest} `, '') : next.text;
          result = { ...next, text: [...notes, deadline, compared, body].filter(Boolean).join('\n'),
            ...(removed.length && draft.lines.length ? { removedNote: removedNote(removed) } : {}) };
        } else if (DEADLINE_QUESTION.test(t)) result = { ...result, text: `${await deadlineAnswer(draft, customer, result.text)}\n${result.text}` };
      }
    } catch {
      result = { status: 'error', text: 'Käsittely ei nyt onnistunut. Luonnos säilyy ennallaan, eikä tilausta ole tehty. Yritä hetken kuluttua uudelleen.' };
      store.save(conversationId, null, messageId, { ...result, draftId: draft.id, revision: draft.revision });
      return { ...result, draftId: draft.id, revision: draft.revision };
    }
    // Kun ostaja poistaa kaikki rivit, aiemmin tallennettu luonnos suljetaan. Muuten vanha luonnos jäisi kantaan ja
    // vastaus "Luonnos on tyhjä" olisi väärä (pilotti X016: maito jäi listalle). Pelkän päivän tai ruokavalion
    // sisältävä luonnos säilyy, jotta niitä ei kysytä uudelleen (katselmus #11).
    if (!draft.lines.length && draft.state === 'active' && store.get(draft.id)?.lines?.length) draft.state = 'cancelled';
    const badDate = !draft.deliveryDate && invalidDate(t);
    if (badDate) result = { ...result, text: `${badDate} ei ole oikea päivämäärä.\n\n${result.text}` };
    // Mennyt päivä kerrotaan, ellei asiakas antanut samassa viestissä uutta päivää.
    if (pastDate && draft.state === 'active' && draft.lines.length && !draft.deliveryDate) {
      result = { ...result, text: `Aiempi toimituspäivä ${dateLabel(pastDate)} on jo mennyt, joten valitaan uusi päivä.\n\n${result.text}` };
    }
    const keep = draft.lines.length || draft.state !== 'active' || draft.deliveryDate || dietLabel(draft.diet) || draft.diet.known;
    const out = { text: result.text, status: result.status, draftId: draft.id, revision: draft.revision, ...(result.orderId ? { orderId: result.orderId } : {}),
      ...(result.removedNote ? { removedNote: result.removedNote } : {}) };
    store.save(conversationId, keep ? draft : null, messageId, out);
    return out;
  };
}
