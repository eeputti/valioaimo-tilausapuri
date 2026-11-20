// AIMO-MALLIN YMMÄRRYSKERROS: vapaa ostopyyntö (suomi tai englanti) → rakenteinen pyyntö portin sopimuksen muodossa.
// Säännöt + Aimon datasta louhittu sanasto, ei kielimallia: vastaus tulee alle millisekunnissa eikä voi keksiä tuotteita.
// Kielimalli (llm.mjs) on varapolku vain silloin, kun tämä kerros ilmoittaa itse, ettei ymmärtänyt (confidence < 0.6).
//
// Periaatteet (lainattu Zalando Assistantilta ja DM Champilta, ks. docs/aimo-malli.md):
//  - malli tuottaa vain rakenteisia hakuehtoja, tuotteet ja hinnat tulevat aina katalogista ja rajapinnasta
//  - jokainen kenttä on tyypitetty ja validoitu (määrä, yksikkö, päivä), kelpaamaton arvo hylätään eikä arvata
//  - oletukset kirjataan näkyviin, ihmiseltä ei kysytä avoimia kysymyksiä
import { normalize } from '../catalog.mjs';
import { quantityBasisFor, isEggItem, EGGS_PER_TRAY } from '../itemQuantities.mjs';
import { conceptOf, brandAt, variants, loadLexicon, recognize } from './lexicon.mjs';
import { synonymOf, learnedOf, SHELVES } from './synonyms.mjs';

// ---------- Portin kuratoidut tuotetyypit ja kello (jos portti on käytössä), muuten omat varakopiot ----------
let PRODUCT_TYPES = [
  { id: 'milk', keywords: ['maito', 'maitojuoma', 'milk'], categories: ['10400'] },
  { id: 'cream', keywords: ['kerma', 'cream'], categories: ['10401'] },
  { id: 'butter', keywords: ['voi', 'butter'], categories: ['10500'] },
  { id: 'eggs', keywords: ['kananmuna', 'muna', 'egg'], categories: ['10590'] },
];
let clock = { now: () => new Date(), simulated: false };
try { ({ PRODUCT_TYPES } = await import('../gateway/contract.mjs')); } catch { /* portti ei ole mukana: käytetään varakopiota */ }
try { ({ clock } = await import('../gateway/clock.mjs')); } catch { /* oikea kello */ }

// ---------- Sanastot: nämä ovat kielen rakennetta, eivät tuotetietoa ----------
const UNITS = [ // [regex, portin yksikkö, kerroin]
  [/^(l|ltr|lit(er|re)s?|litra\w*)$/, 'L', 1], [/^(dl|desi\w*)$/, 'L', 0.1], [/^cl$/, 'L', 0.01], [/^ml$/, 'L', 0.001],
  [/^(kg|kgs|kilo\w*|kilogram\w*)$/, 'KG', 1], [/^(g|gr|gram\w*|gramma\w*)$/, 'KG', 0.001],
  [/^(kpl|kappale\w*|pcs|pc|pieces?|units?|ltk|laatik\w*|box(es)?|cases?|crates?|cartons?|tölk\w*|purk\w*|pussi\w*|pss|pkt|paket\w*|packs?|packets?|bags?|bottles?|pullo\w*|cans?|säk\w*|sacks?|rasia\w*|ras|prk|sk|pl|kenno\w*)$/, 'PCS', 1],
];
const NUMBER_WORDS = { yksi: 1, kaksi: 2, kolme: 3, neljä: 4, viisi: 5, kuusi: 6, seitsemän: 7, kahdeksan: 8, yhdeksän: 9, kymmenen: 10, kaksikymmentä: 20, viisikymmentä: 50, sata: 100, sataa: 100, tuhat: 1000, tuhatta: 1000, pari: 2, tusina: 12, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50, hundred: 100, thousand: 1000, dozen: 12, couple: 2 };
const MULTIPLIERS = { sata: 100, sataa: 100, tuhat: 1000, tuhatta: 1000, hundred: 100, thousand: 1000, dozen: 12, tusinaa: 12 };

// Väittämät: aina luokittelukoodiksi, ei koskaan nimihauksi. "Vähälaktoosinen" EI ole "laktoositon".
const CLAIMS = [
  [/\b(lactose[- ]?free|free (from|of) lactose|no lactose|without lactose|laktoosit\w+|ilman laktoosia)\b/, 'FREE_FROM_LACTOSE'],
  [/\b(low[- ]lactose|vähälaktoosi\w+)\b/, 'LOW_LACTOSE'],
  [/\b(gluten[- ]?free|free (from|of) gluten|no gluten|without gluten|gluteenit\w+|ilman gluteenia)\b/, 'FREE_FROM_GLUTEN'],
  [/\b(vegan|vegaani\w*|plant[- ]based|kasvipohjai\w+)\b/, 'VEGAN'],
  [/\b(vegetarian|kasvis(ruoka)?\b|vegetaari\w+)/, 'VEGETARIAN'],
  [/\b(organic|luomu\w*|eco|bio)\b/, 'EU_ORGANIC_FARMING'],
  [/\b(msc)\b/, 'MARINE_STEWARDSHIP_COUNCIL_LABEL'],
  [/\b(fair[- ]?trade|reilun kaupan)\b/, 'FAIR_TRADE_MARK'],
];
const ORIGIN_FI = /\b(kotimai\w+|suomalai\w+|finnish|domestic|from finland|suomesta)\b/;
// Allergeenit, joita tuote ei saa sisältää (GS1-koodit): "nut-free", "ilman pähkinää", "no soy". Ensimmäinen osuma voittaa, joten
// tarkempi sana ensin: "maapähkinätön" on maapähkinä (AP), ei yleinen pähkinä (katselmus 15.11. #3). Pelkkä "pähkinätön" on
// EU:n allergeenijaon mukaan pähkinät (AN), kuten aimo:eval määrittelee ("nut-free cookies").
const ALLERGEN_WORDS = [[/peanut|maapähkin/, ['AP']], [/nut|pähkin/, ['AN']], [/soy|soija/, ['AY']], [/egg|kananmun|muna/, ['AE']], [/fish|kala/, ['AF']], [/sesam|seesam/, ['AS']], [/milk|dairy|maido|maito/, ['AM']], [/wheat|vehnä/, ['UW']], [/celery|selleri/, ['BC']], [/mustard|sinap/, ['BM']]];
const EXCLUDE = /\b(?:no|without|free of|ilman|ei)\s+([a-zåäö]+)|\b([a-zåäö]+?)[- ]free\b|\b([a-zåäö]+?)t[oö]n(?:ta|tä|t)?\b/g;

// Attribuutit, jotka rajaavat tuotetyypin sisällä. Arvo on nimestä haettava säännöllinen lauseke.
const ATTRIBUTES = [
  ['fat', 'fat-free', /\b(rasvat\w+|fat[- ]?free|skimmed|skim|non[- ]?fat)\b/, /rasvaton|fat ?free|skimmed/i],
  ['fat', 'semi-skimmed', /\b(kevytmai\w+|kevyt\w*|semi[- ]?skimmed|low[- ]fat|light)\b/, /kevyt|semi/i],
  ['fat', 'whole', /\b(täysmai\w+|täys\w*|whole|full[- ]fat|punai\w+)\b/, /täys|whole/i],
  ['treatment', 'uht', /\b(uht|iskukuumennet\w+|long[- ]life)\b/, /uht/i],
  ['state', 'frozen', /\b(pakaste|pakasteet|pakasteita|pakastetta|pakasteena|pakastet\w+|frozen)\b/, null],
  ['state', 'fresh', /\b(tuore|tuoreet|tuoretta|tuoreita|tuoreena|fresh)\b/, /tuore|fresh/i],
];

const WEEKDAYS = [ // 0 = sunnuntai
  [/^(su|sunnuntai\w*|sun|sunday)$/, 0], [/^(ma|maanantai\w*|mon|monday)$/, 1], [/^(ti|tiistai\w*|tue|tues|tuesday)$/, 2], [/^(ke|keskiviik\w*|wed|wednesday)$/, 3],
  [/^(to|torstai\w*|thu|thur|thurs|thursday)$/, 4], [/^(pe|perjantai\w*|fri|friday)$/, 5], [/^(la|lauantai\w*|sat|saturday)$/, 6],
];
const FILLER = new Set(('about what thing do does have has got there i we you me us our my the a an of for to by on in at is are be it this that and or please pls need needs needed want wants would like could can get order ordering buy purchase deliver delivered delivery send some any hi hello hey thanks thank kindly asap urgent urgently also plus with next coming hotel restaurant kitchen chain ' +
  'tarvitsen tarvitsemme tarvitaan tarvis tarvin tarviin haluan haluaisin haluamme tilaa tilaan tilataan tilaisin tilaisitko tilaus tilaukseen lisää laita ota hanki osta ostaisin toimita toimitus toimitettuna toimitettava kiitos moi hei terve voisitko voitko saisinko saisiko mulle meille minulle hotellille ravintolalle keittiölle ja tai sekä myös vielä noin n mennessä viimeistään ensi tulevaksi tulevan viikon viikolla että on ole pitäisi saada pliis heti onko teillä löytyykö olisiko saako').split(' '));
const INTENT = [
  [/^(onko|löytyykö|do you have|have you got|is there|are there|what .* do you|mitä .* (on|löytyy))\b|\b(näytä|show me|list|etsi|hae|search for|find)\b/, 'search'],
  [/^(miksi|why|paljonko|how much|mikä on|what is|milloin|when|missä|where)\b|\b(order status|tilauksen tila|where is my order|missä tilaukseni)\b/, 'question'],
];

const pad = (n) => String(n).padStart(2, '0');
function helsinkiParts(date) {
  const v = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +v.year, m: +v.month, d: +v.day, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v.weekday) };
}
const addDays = ({ y, m, d }, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

/** Poimii toimituspäivän tekstistä ja palauttaa tekstin ilman sitä. Suhteelliset päivät lasketaan portin kellosta. */
function extractDate(text, now) {
  const today = helsinkiParts(now);
  let m;
  const out = (date, phrase, note) => ({ date, phrase, note, rest: text.replace(phrase, ' ') });
  if ((m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return out(m[0], m[0]);
  // Päivämäärä "16.11.", "16.11.2026" tai ilman loppupistettä "16.11" ja "ma 16.11" (katselmus 15.11. #19). Ilman loppupistettä
  // luku voi olla myös desimaali tai kellonaika, joten se on päivä vain, kun kuukausi on kirjoitettu kahdella numerolla tai edessä
  // on viikonpäivä, eikä perässä ole yksikköä ("1.10 l") eikä edessä kelloa ("klo 11.10"). Desimaalipilkku ("2,5") ei ole päivä.
  const reDate = /(?:\b([a-zåäö]+)\s+)?\b(\d{1,2})\.(\d{1,2})(\.(\d{4})?)?(?!\d|,\d)/g;
  while ((m = reDate.exec(text))) {
    const [all, pre, dd, mm, dot, yyyy] = m;
    const day = +dd; const month = +mm;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const wd = pre && WEEKDAYS.find(([r]) => r.test(pre));
    if (!dot) {
      const next = (text.slice(m.index + all.length).trim().split(/\s+/)[0] || '').replace(/[,.;:!?]+$/, '');
      if (/^(klo|kello|kl)$/.test(pre || '') || /^(%|x|×)/.test(next) || UNITS.some(([r]) => r.test(next))) continue;
      if (!wd && mm.length < 2) continue;
    }
    let y = yyyy ? +yyyy : today.y;
    if (!yyyy && (month < today.m || (month === today.m && day < today.d))) y += 1;
    const date = `${y}-${pad(month)}-${pad(day)}`;
    const phrase = wd ? all : all.slice(all.length - `${dd}.${mm}${dot || ''}`.length);
    const start = m.index + all.length - phrase.length;
    const actual = new Date(`${date}T12:00:00Z`).getUTCDay();
    const note = wd && wd[1] !== actual ? { code: 'DATE_WEEKDAY_MISMATCH', fi: `${pre} ja ${day}.${month}. eivät ole sama päivä: käytetään päivämäärää ${day}.${month}.`, en: `Weekday and date disagree: using the date ${day}.${month}.` } : undefined;
    return { date, phrase, note, rest: `${text.slice(0, start)} ${text.slice(start + phrase.length)}` };
  }
  if ((m = text.match(/\b(day after tomorrow|ylihuomi\w*)\b/))) return out(addDays(today, 2), m[0]);
  if ((m = text.match(/\b(tomorrow|huomi\w+|huomenna)\b/))) return out(addDays(today, 1), m[0]);
  if ((m = text.match(/\b(today|tänään|täksi päiväksi)\b/))) return out(addDays(today, 0), m[0]);
  // viikonpäivä: "by Monday", "maanantaiksi", "ensi viikon tiistaina", "next Friday"
  // Pidempi etuliite ensin: "ensi viikon tiistaina" ei saa jäädä muotoon "ensi" + "viikon" (katselmus 15.11. #19).
  // "Viikon päästä keskiviikkona" on sama kuin ensi viikon keskiviikko (WhatsApp 18.11.: bileet viikon päästä keskiviikkona).
  const re = /\b(?:(by|on|for|before|until|next|ensi viikon|tulevan viikon|viikon päästä|viikon kuluttua|ensi|tulevaksi|tulevan)\s+)?([a-zåäö]+)\b/g;
  while ((m = re.exec(text))) {
    const word = m[2];
    // Etuliite ei saa niellä seuraavaa sanaa: "juhlat on viikon päästä torstaina" ("on" on englannin etuliite).
    if (m[1] && !WEEKDAYS.some(([r]) => r.test(word))) { re.lastIndex = m.index + m[1].length; continue; }
    // "ma", "to", "la" ovat päiviä vain etuliitteen kanssa, tai kun lyhenne on viestin viimeinen sana ("1.000 l maitoa ma").
    const lastWord = /^[\s.!?]*$/.test(text.slice(m.index + m[0].length));
    if (word.length <= 2 && !m[1] && !lastWord) continue;
    const wd = WEEKDAYS.find(([r]) => r.test(word));
    if (!wd || /^(sun|sat|wed|mon|to|la|ti|ke|pe|su|ma)$/.test(word) && !m[1] && word.length < 3 && !lastWord) continue;
    let delta = (wd[1] - today.dow + 7) % 7;
    if (delta === 0) delta = 7; // "maanantaiksi" maanantaina = ensi viikon maanantai
    // "Ensi viikon tiistai" on maanantaista alkavan seuraavan viikon tiistai: sunnuntaina 15.11. se on ti 17.11., maanantaina 16.11. ti 24.11.
    if (/(ensi|tulevan) viikon|viikon (päästä|kuluttua)/.test(m[1] || '')) delta = ((8 - today.dow) % 7 || 7) + ((wd[1] + 6) % 7);
    else if (/next/.test(m[1] || '') && delta < 7 - today.dow) delta += 7;
    // Poistetaan täsmälleen osuman kohta: pelkkä replace('ma') osuisi sanaan "maitoa".
    return { date: addDays(today, delta), phrase: m[0], note: undefined, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
  }
  return { date: null, phrase: null, rest: text };
}

/**
 * Kaikki viestissä mainitut toimituspäivät järjestyksessä samalla tulkinnalla kuin understand(): "huomenna", "perjantaiksi",
 * "ma 23.11". Mallitulkki tarkistaa näillä oman päivänsä (order-conversation/interpret.mjs).
 */
export function deliveryDatesIn(text, opts = {}) {
  const now = opts.now || clock.now();
  let s = String(text || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/[’'`"“”!?]/g, ' ').replace(/\s+/g, ' ');
  const dates = [];
  for (let i = 0; i < 5; i += 1) {
    const d = extractDate(s, now);
    if (!d.date) break;
    if (!dates.includes(d.date)) dates.push(d.date);
    s = d.rest;
  }
  return dates;
}

// Toimituksen ja tapahtuman sanat (WhatsApp 18.11.: "bileet olis viikon päästä keskiviikkona, niin toimitus about lauantaina").
const DELIVERY_WORD = /(?<![\p{L}])(?:toimit\p{L}*|perill\p{L}*|kuljetu\p{L}*)/iu;
const EVENT_WORD = /(?<![\p{L}])(?:bile\p{L}*|juhl\p{L}*|tilaisuu\p{L}*|tapahtum\p{L}*|synttär\p{L}*|syntymäpäiv\p{L}*|häät|häihin|häissä|pikkujoul\p{L}*|kemu\p{L}*|kekkere\p{L}*|kalaas\p{L}*|karonk\p{L}*|tupari\p{L}*|illanvie\p{L}*|ottelu\p{L}*|seminaar\p{L}*|messu\p{L}*)/iu;
const CLAUSE = /[,;.!?\n]+|\s(?:ja|niin|mutta|eli|koska)\s/u;

/**
 * Viestin toimituspäivä, kun asiakas kertoo sen erikseen tapahtuman päivästä. Lause, jossa on toimitussana eikä tapahtuman
 * sanaa, antaa toimituspäivän; lause, jossa on vain tapahtuman sana, antaa tapahtuman päivän. Lause, jossa ovat molemmat
 * ("toimitus ennen bileitä lauantaina"), ei ratkaise kumpaakaan.
 * @returns {{delivery: string|null, events: string[]}}
 */
export function deliveryDateCue(text, opts = {}) {
  let delivery = null; const events = [];
  for (const clause of String(text || '').split(CLAUSE)) {
    if (!clause || !/\p{L}/u.test(clause)) continue;
    const delivers = DELIVERY_WORD.test(clause); const event = EVENT_WORD.test(clause);
    if (delivers === event) continue;
    const dates = deliveryDatesIn(clause, opts);
    if (!dates.length) continue;
    if (delivers && !delivery) delivery = dates[0];
    if (event) events.push(...dates.filter((d) => !events.includes(d)));
  }
  return { delivery, events };
}

/**
 * "1 000" / "1.000" → 1000 ja englanniksi myös "1,000" → 1000, mutta "1,5" pysyy desimaalina.
 * Suomeksi pilkku on aina desimaali, ja nolla alussa ei ole koskaan tuhansia: "0,125 kg" on 0,125 kg eikä 125 kg (katselmus 15.11. #5).
 */
function normalizeNumbers(text, lang = 'fi') {
  return text
    .replace(/(\d{1,3})((?:[ ,. ]\d{3})+)(?![\d])/g, (all, a, rest) => (a === '0' || (lang === 'fi' && rest.includes(',')) ? all : a + rest.replace(/[ ,. ]/g, '')))
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*(?:x|×)\s*(\d)/g, '$1 x $2');
}

function parseQuantity(tokens) {
  // etsitään "<luku> [yksikkö]" tai "<lukusana> [yksikkö]"; palautetaan käytetyt indeksit
  for (let i = 0; i < tokens.length; i++) {
    let value = null; let used = [i];
    if (/^\d+(\.\d+)?$/.test(tokens[i])) {
      value = Number(tokens[i]);
      if (MULTIPLIERS[tokens[i + 1]]) { value *= MULTIPLIERS[tokens[i + 1]]; used.push(i + 1); }
    } else if (/^\d+(\.\d+)?[a-zåäö]+$/.test(tokens[i])) { // "500g", "10l"
      const [, n, u] = tokens[i].match(/^(\d+(?:\.\d+)?)([a-zåäö]+)$/);
      const unit = UNITS.find(([r]) => r.test(u));
      if (unit) return { quantity: { value: +(Number(n) * unit[2]).toFixed(4), unit: unit[1] }, used: [i], unitWord: u };
      continue;
    } else if (NUMBER_WORDS[tokens[i]] != null && !(tokens[i] === 'a' || tokens[i] === 'one' && tokens[i + 1] === 'of')) {
      value = NUMBER_WORDS[tokens[i]];
      if (MULTIPLIERS[tokens[i + 1]] && value < 100) { value *= MULTIPLIERS[tokens[i + 1]]; used.push(i + 1); }
    } else if ((tokens[i] === 'a' || tokens[i] === 'an') && MULTIPLIERS[tokens[i + 1]]) { value = MULTIPLIERS[tokens[i + 1]]; used = [i, i + 1]; }
    if (value == null) continue;
    const next = used.at(-1) + 1;
    const unit = tokens[next] && UNITS.find(([r]) => r.test(tokens[next]));
    if (unit) return { quantity: { value: +(value * unit[2]).toFixed(4), unit: unit[1] }, used: [...used, next], unitWord: tokens[next] };
    return { quantity: { value, unit: 'PCS' }, used, unitWord: null, unitAssumed: true };
  }
  return null;
}

function productTypeFor(word) {
  for (const t of PRODUCT_TYPES) for (const k of t.keywords) if (word === k || (word.endsWith(k) && k.length >= 4)) return t;
  return null;
}

const STATE_PREFIX = { pakaste: 'frozen', tuore: 'fresh' };
/** "vaniljajäätelö" → ['vanilja', 'jäätelö'], kun molemmat osat ovat itse sanoja tuotenimissä. Pisin loppuosa ensin. */
function compoundParts(word) {
  if (!word || word.length < 8 || /\s/.test(word)) return null;
  for (let k = 4; k <= word.length - 4; k++) {
    const head = conceptOf(word.slice(0, k)); const tail = conceptOf(word.slice(k));
    if (head && tail && head.word === word.slice(0, k) && tail.word === word.slice(k) && head.total >= 3 && tail.total >= 3) return [head.word, tail.word];
  }
  return null;
}
/**
 * Kirjoitettu sana → sanaston sana. Järjestys: puhekielen synonyymi, sanasto sellaisenaan, opittu sana,
 * puhekielen muoto ja astevaihtelu, yhdyssanan osat, kirjoitusvirhe. Palauttaa myös tiedon siitä, miten sana löytyi.
 */
function canonical(word, lang) {
  const syn = synonymOf(word);
  if (syn) return { w: syn.word, via: 'synonym' };
  if (conceptOf(word) || variants(word).some(productTypeFor)) return { w: word, via: 'exact' };
  const mem = learnedOf(word);
  if (mem && (conceptOf(mem.word) || SHELVES[mem.word])) return { w: mem.word, via: 'learned' };
  if (word.length < 4) return { w: word, via: null };
  // "pakastemustikka", "tuoremehu": tila on attribuutti, loppuosa on tuote
  const pre = word.match(/^(pakaste|tuore)([a-zåäö]{4,})$/);
  if (pre) { const rest = recognize(pre[2]); if (rest && rest.via !== 'fuzzy') return { w: rest.word, via: 'exact', state: STATE_PREFIX[pre[1]] }; }
  const r = recognize(word);
  if (r) return { w: r.word, via: r.via }; // myös kirjoitusvirhe koko sanassa voittaa pilkkomisen: mustikkajugurtti → mustikkajogurtti
  // Tuntematon yhdyssana: pisin loppuosa, jonka sanasto tuntee, on pääsana ("jäävuorisalaatti" → salaatti, alkuosa rajaa nimeä).
  // Ensin loppuosa, joka on itse sana tuotenimissä: "kelta|sipuli" eikä "kelt|asipuli", vaikka "asipuli" on punasipulin loppu.
  if (lang === 'fi' && word.length >= 8) {
    for (const real of [true, false]) {
      for (let k = 3; k <= word.length - 5; k++) {
        const tail = recognize(word.slice(k));
        if (!tail || tail.via === 'fuzzy' || tail.concept.total < 3 || (real && tail.via === 'tail')) continue;
        const head = recognize(word.slice(0, k));
        const known = head && head.via !== 'fuzzy';
        return { w: tail.word, via: 'split', head: known ? head.word : null, dropped: known ? null : word.slice(0, k) };
      }
    }
  }
  return { w: word, via: null };
}

function parseItem(raw, lang) {
  let text = ` ${raw} `;
  const item = { raw: raw.trim(), productTerm: null, productType: null, category: null, categories: undefined, categoryLabel: null, claims: [], excludeAllergens: [], brand: null, countryOfOrigin: null, attributes: {}, quantity: null };
  const notes = []; const unparsed = [];

  for (const [re, code] of CLAIMS) if (re.test(text)) { if (!item.claims.includes(code)) item.claims.push(code); text = text.replace(new RegExp(re.source, 'g'), ' '); }
  if (ORIGIN_FI.test(text)) { item.countryOfOrigin = 'fi'; text = text.replace(new RegExp(ORIGIN_FI.source, 'g'), ' '); }
  text = text.replace(EXCLUDE, (all, a, b, c) => {
    const w = a || b || c;
    const hit = ALLERGEN_WORDS.find(([re]) => re.test(w));
    if (!hit || /^(rasva|fat|suola|salt|sokeri|sugar)/.test(w)) return all; // "rasvaton" on attribuutti, ei allergeeni
    for (const code of hit[1]) if (!item.excludeAllergens.includes(code)) item.excludeAllergens.push(code);
    return ' ';
  });
  for (const [key, value, re] of ATTRIBUTES) if (re.test(text) && !item.attributes[key]) { item.attributes[key] = value; if (key !== 'fat' || !/kevytmai|täysmai/.test(text)) text = text.replace(new RegExp(re.source, 'g'), ' '); }
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) { item.attributes.fatPercent = Number(pct[1]); text = text.replace(pct[0], ' '); }

  // Ostajan yhdysmerkkisana luetaan kahtena sanana: "edam-juusto" on edam juusto. Muuten sanasto pilkkoi sen ja haki
  // pelkällä sanalla juusto (itsepeli S031: saganaki ja halloumi edamin tilalla).
  let tokens = text.replace(/[^a-z0-9åäöé.\s-]/g, ' ').replace(/(^|\s)-|-(\s|$)/g, ' ').replace(/([a-zåäöé])-(?=[a-zåäöé])/g, '$1 ').replace(/\.(?!\d)/g, ' ').split(/\s+/).filter(Boolean);
  // pakkauskoko ennen määrää: "10 l novobox", "1 l tölkeissä" kertoo pakkauksen vain jos varsinainen määrä on jo toisaalla ("200 x 1 l")
  const q = parseQuantity(tokens);
  if (q) {
    item.quantity = q.quantity;
    if (q.unitAssumed) notes.push({ code: 'UNIT_ASSUMED', fi: `Yksikköä ei annettu: ${q.quantity.value} tulkittu myyntiyksiköiksi`, en: `No unit given: ${q.quantity.value} read as sales units` });
    const at = q.used[0];
    tokens = tokens.filter((_, i) => !q.used.includes(i));
    if (tokens[at] === 'x') { // "200 x 1 l maitoa" → 200 kpl, pakkaus 1 l
      const tail = tokens.slice(at + 1);
      const pack = parseQuantity(tail);
      if (pack && pack.used[0] === 0 && !pack.unitAssumed) { item.attributes.pack = pack.quantity; tokens = [...tokens.slice(0, at), ...tail.filter((_, i) => !pack.used.includes(i))]; if (q.unitAssumed) notes.pop(); }
    }
  }
  // merkki
  for (let i = 0; i < tokens.length; i++) {
    let b = brandAt(tokens, i);
    if (!b && tokens[i].length >= 4) { // taivutettu merkki: "Arlan", "Valion", "Pauligin"
      const base = variants(tokens[i]).find((v) => v !== tokens[i] && brandAt([v], 0));
      if (base) b = brandAt([base], 0);
    }
    if (!b || FILLER.has(tokens[i])) continue;
    if (b.words === 1 && variants(tokens[i]).some(productTypeFor)) continue; // sana on tuotetyyppi, ei merkki
    item.brand = b.name; tokens.splice(i, b.words); break;
  }
  const words = tokens.filter((t) => !FILLER.has(t) && !/^\d+(\.\d+)?$/.test(t) && t !== 'x');

  // tuotesana: viimeinen sana, jonka Aimon sanasto tuntee, on pääsana ("laktoositonta kevytmaitoa", "whipping cream")
  const canon = [];
  for (const orig of words) {
    const c = canonical(orig, lang);
    if (c.state && !item.attributes.state) item.attributes.state = c.state;
    // Tarkennettu yhdyssana (kelta|sipuli): saman pääsanan muut lajikkeet (punasipuli, valkosipuli) ovat eri tuotteita.
    if (c.head) { canon.push(c.head); item.qualified = true; }
    canon.push(c.w);
    // Näkyvä korjaus: käyttäjä näkee, millä sanalla haettiin, kun se ei ole se mitä hän kirjoitti.
    if (['synonym', 'learned', 'fuzzy', 'split'].includes(c.via) && !variants(orig).includes(c.w)) {
      notes.push({ code: 'WORD_CORRECTED', via: c.via, from: orig, to: c.w, ...(c.dropped ? { dropped: c.dropped } : {}), fi: c.dropped ? `"${orig}": haetaan sanalla "${c.w}", osaa "${c.dropped}" ei tunnistettu` : `"${orig}": haetaan sanalla "${c.head ? `${c.head} ${c.w}` : c.w}"`, en: `"${orig}": searching with "${c.w}"` });
    }
  }
  const known = canon.map((w) => {
    const concept = conceptOf(w);
    let type = variants(w).map(productTypeFor).find(Boolean) || null;
    // "kahvimaito" päättyy sanaan "maito", mutta tuotetyyppi sulkee sen itse pois: haetaan sanalla, ei tyypillä.
    if (type && type.exclude?.test(w) && !variants(w).some((v) => type.keywords.includes(v))) type = null;
    // "kookosmaito" päättyy sanaan "maito", mutta on sanaston mukaan toisella hyllyllä: se ei ole juomamaitoa.
    if (type && concept && !variants(w).some((v) => type.keywords.includes(v)) && !type.categories.includes(concept.top[0].category)) type = null;
    return { w, concept, type };
  });
  const heads = known.filter((k) => k.concept || k.type);
  for (const k of known) if (!k.concept && !k.type) unparsed.push(k.w);
  if (heads.length) {
    const head = heads.findLast((k) => k.type) || (lang === 'en' ? heads.at(-1) : heads.findLast((k) => k.concept.total >= 3) || heads.at(-1));
    item.productTerm = heads.map((k) => k.concept?.word || k.w).join(' ');
    if (head.type) { item.productType = head.type.id; item.category = head.type.categories[0]; }
    else if (head.concept.top[0].share >= 0.3) item.category = head.concept.top[0].category;
    if (!head.type && head.concept.top[0].share < 0.5) item.categories = head.concept.top.filter((t) => t.share >= 0.12).map((t) => t.category); // sana elää usealla hyllyllä: haetaan kaikista
    // Yhdyssana, jonka molemmat osat ovat tuotenimissä: "vaniljajäätelö" löytyy myös nimestä "jäätelö Vanilja" (itsepeli S048:
    // vegaaninen vaniljajäätelö jäi löytymättä). Osat tallennetaan, jotta haku ja järjestys tunnistavat ne erillisinä sanoina.
    for (const k of heads) {
      const w = k.concept?.word || k.w; const parts = compoundParts(w);
      if (parts) (item.compounds ||= {})[w] = parts;
    }
    item.categoryLabel = item.category ? loadLexicon().categories.get(item.category)?.label || null : null;
    // Raaka-aineen oma hylly: "kana" yksin tarkoittaa raakaa broileria, ei kanatäytteistä eväsleipää.
    // Taivutettu muoto ("kanafileetä") löytää saman hyllyn sanan perusmuodon kautta.
    const shelf = heads.length === 1 && !head.type ? [head.concept?.word, head.w, ...variants(head.w)].map((k) => k && SHELVES[k]).find(Boolean) || null : null;
    if (shelf) { item.shelf = shelf.must ? { names: shelf.names, must: shelf.must } : { names: shelf.names }; item.category = null; item.categories = shelf.categories; item.categoryLabel = shelf.label; }
    if (!shelf && !head.type && head.concept.top[0].share < 0.5 && head.concept.top[1]) notes.push({ code: 'CATEGORY_AMBIGUOUS', fi: `"${head.concept.word}" esiintyy useassa tuoteryhmässä (${head.concept.top.slice(0, 3).map((t) => t.label).join(' / ')}): haetaan kaikista`, en: `"${head.concept.word}" appears in several product groups: searching all of them` });
  }
  // "3 kennoa kananmunia" on 90 munaa: kenno on noin 30 munaa, ei kolme munaa (katselmus 15.11. #22).
  const tray = q && /^kenno\w*$/.test(q.unitWord || '') ? q.unitWord : null;
  if (tray && quantityBasisFor({ ...item, quantity: { ...item.quantity, basis: undefined } }, null) === 'items') {
    item.quantity = { value: item.quantity.value * EGGS_PER_TRAY, unit: 'PCS', basis: 'items' };
    notes.push({ code: 'EGG_TRAY', fi: `${q.quantity.value} kennoa = ${item.quantity.value} kananmunaa (kenno on ${EGGS_PER_TRAY} munaa)`, en: `${q.quantity.value} trays = ${item.quantity.value} eggs (${EGGS_PER_TRAY} eggs per tray)` });
  }
  const basis = tray ? item.quantity?.basis : quantityBasisFor(item, q?.unitWord);
  if (basis === 'items') {
    item.quantity.basis = basis;
    const assumed = notes.findIndex((n) => n.code === 'UNIT_ASSUMED');
    if (isEggItem(item)) {
      if (assumed >= 0) notes.splice(assumed, 1);
      notes.push({ code: 'INDIVIDUAL_ITEMS', fi: `${item.quantity.value} kananmunaa tarkoittaa munien lukumäärää. Pakkaukset lasketaan tuotetiedoista.`, en: 'The quantity counts individual eggs, not sales packs.' });
    } else if (assumed >= 0) {
      // Paljas luku ("10 leivosta") on kappaleita: laatikon kappalemäärä luetaan tuotetiedoista (17.11.).
      notes[assumed] = { code: 'UNIT_ASSUMED', fi: `Yksikköä ei annettu: ${item.quantity.value} tulkittu kappaleiksi`, en: `No unit given: ${item.quantity.value} read as individual items` };
    } else notes.push({ code: 'INDIVIDUAL_ITEMS', fi: `${item.quantity.value} kpl tarkoittaa tuotteiden lukumäärää. Myyntipakkaukset lasketaan tuotetiedoista.`, en: 'The quantity counts individual items, not sales packs.' });
  }
  if (!item.quantity) notes.push({ code: 'QUANTITY_MISSING', fi: 'Määrää ei annettu', en: 'No quantity given' });
  return { item, notes, unparsed };
}

/**
 * @param {string} text vapaa ostopyyntö
 * @param {{now?: Date}} [opts]
 * @returns rakenteinen pyyntö: items[], deliveryDate, intent, assumptions[], unparsed[], confidence (0–1), ms
 */
export function understand(text, opts = {}) {
  const t0 = performance.now();
  const now = opts.now || clock.now();
  const original = String(text || '').trim();
  // Kieli ja päivämäärä luetaan ennen lukujen yhdistämistä: kieli ratkaisee pilkun merkityksen, ja "16.11 100 l" ei saa
  // muuttua luvuksi 16.11100.
  let s = original.toLowerCase().replace(/[‐-―]/g, '-').replace(/[’'`"“”!?]/g, ' ').replace(/\s+/g, ' ');
  const fiHits = (s.match(/\b(ja|tarvit\w+|tilaa\w*|maanantai\w*|tiistai\w*|keskiviik\w*|torstai\w*|perjantai\w*|lauantai\w*|sunnuntai\w*|litra\w*|kiloa?|kpl|laktoosit\w+|huomi\w+|mennessä|haluan|onko|löytyykö|ilman)\b|[äö]/g) || []).length;
  const enHits = (s.match(/\b(the|and|need|order|please|by|for|of|litres?|liters?|free|want|would|some|have|with|without|tomorrow|next)\b/g) || []).length;
  const language = fiHits >= enHits ? 'fi' : 'en';
  const intent = (INTENT.find(([re]) => re.test(s)) || [null, 'order'])[1];

  const d = extractDate(s, now);
  // Tapahtuman päivä ei ole toimituspäivä, kun asiakas nimeää toimituspäivän erikseen.
  const cue = deliveryDateCue(original, { now });
  if (cue.delivery && cue.delivery !== d.date) d.date = cue.delivery;
  s = normalizeNumbers(d.rest, language);
  const parts = s.split(/\s*(?:;|\n|\+|,(?!\d)|\s(?:and|ja|sekä|plus|as well as)\s)\s*/).map((p) => p.trim()).filter((p) => p && /[a-zåäö]{2}/.test(p));
  const items = []; const assumptions = []; const unparsed = [];
  let carry = null; // "laktoositonta maitoa 100 l ja kermaa 20 l": väittämä EI periydy, mutta pelkkä "ja 20 l" perii tuotteen
  for (const part of parts) {
    const r = parseItem(part, language);
    if (!r.item.productTerm && !r.item.brand) {
      if (r.item.quantity && carry && !carry.quantity) { carry.quantity = r.item.quantity; continue; }
      // "…, kaikki luomuna" ja "…, ei maapähkinöitä": koskee edellisiä rivejä. Allergeenikielto ei saa kadota (katselmus 15.11. #3).
      if (items.length && (r.item.claims.length || r.item.countryOfOrigin || r.item.excludeAllergens.length)) {
        for (const it of items) {
          for (const c of r.item.claims) if (!it.claims.includes(c)) it.claims.push(c);
          for (const a of r.item.excludeAllergens) if (!it.excludeAllergens.includes(a)) it.excludeAllergens.push(a);
          it.countryOfOrigin ||= r.item.countryOfOrigin;
        }
        continue;
      }
      unparsed.push(...r.unparsed.filter((w) => w.length > 2));
      continue;
    }
    items.push(r.item); carry = r.item;
    for (const n of r.notes) assumptions.push({ ...n, item: items.length - 1 });
    unparsed.push(...r.unparsed);
  }
  if (d.note) assumptions.push(d.note);
  if (d.date && d.date < addDays(helsinkiParts(now), 0)) assumptions.push({ code: 'DATE_IN_PAST', fi: `Päivä ${d.date} on jo mennyt`, en: `Date ${d.date} is in the past` });
  if (!d.date && intent === 'order' && items.length) assumptions.push({ code: 'DATE_MISSING', fi: 'Toimituspäivää ei annettu: käytetään aikaisinta mahdollista', en: 'No delivery date given: earliest possible is used' });
  for (const [i, it] of items.entries()) {
    if (it.productType === 'milk' && !it.attributes.fat && it.attributes.fatPercent == null) assumptions.push({ code: 'FAT_NOT_SPECIFIED', item: i, fi: 'Rasvapitoisuutta ei rajattu: valitaan halvin sopiva', en: 'Fat content not specified: cheapest match is chosen' });
    if (it.claims.includes('FREE_FROM_LACTOSE')) assumptions.push({ code: 'LACTOSE_STRICT', item: i, fi: 'Laktoositon tulkitaan tiukasti: vähälaktoosinen ei kelpaa', en: 'Lactose-free is strict: low-lactose products are excluded' });
  }

  for (const w of new Set(unparsed.filter((x) => x.length > 2))) assumptions.push({ code: 'UNKNOWN_WORD', fi: `Sanaa "${w}" ei löydy Aimon sanastosta`, en: `"${w}" is not in the Aimo vocabulary`, word: w });

  // Varmuus: kerros kertoo itse, milloin se ei ymmärtänyt. Vain silloin kutsutaan kielimallia.
  let confidence = items.length ? 1 : 0;
  if (items.length) {
    const meaningful = unparsed.filter((w) => w.length > 2);
    if (meaningful.length) confidence -= Math.min(0.7, 0.45 + (meaningful.length - 1) * 0.15); // tuntematon sana = emme tiedä mitä pyydettiin
    if (items.some((it) => !it.category && !it.categories?.length && !it.productType)) confidence -= 0.3;
    if (intent === 'order' && items.some((it) => !it.quantity)) confidence -= 0.15;
    if (assumptions.some((a) => a.code === 'CATEGORY_AMBIGUOUS')) confidence -= 0.1;
    confidence -= 0.1 * assumptions.filter((a) => a.code === 'WORD_CORRECTED' && (a.via === 'fuzzy' || a.via === 'split')).length; // arvattu sana: näytetään, mutta ei täydellä varmuudella
  }
  return {
    text: original, language, intent, items, deliveryDate: d.date, deliveryPhrase: d.phrase?.trim() || null,
    assumptions, unparsed: [...new Set(unparsed)], confidence: +Math.max(0, confidence).toFixed(2), via: 'aimo-rules',
    clock: clock.simulated ? { simulated: true, now: now.toISOString() } : undefined,
    ms: +(performance.now() - t0).toFixed(2),
  };
}

export { normalize };
