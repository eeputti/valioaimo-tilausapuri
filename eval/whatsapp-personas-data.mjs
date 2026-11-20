// Valion dataan perustuvat persoonat V001–V035 (käyttäjän pyyntö 15.11.2026 klo 2): kysymykset, joiden oikea vastaus on
// challengen tuotedatassa (data/catalog.json, rakennettu data/raw/:n product_data-, carbon_footprint- ja
// delivery_reliability-tiedostoista) tai saatavuusrajapinnan tilausajassa (closingTime). Tarkistus vertaa apurin väitettä
// dataan: väärä väite on virhe, ja "en näe" on data_not_used, kun tieto olisi apurin käytettävissä
// (tuoteneuvo saa publicProductin: country, contains, labels, temp, co2, reliability; vaihtoehdot saavat cutoffin).
// Totuus haetaan katalogista ladattaessa, ei kirjoiteta käsin. Ilman katalogia joukko on tyhjä.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONA_KIT, inspectPersona, parseOptions } from './whatsapp-personas.mjs';
import { SLOTS } from './whatsapp-personas-extended.mjs';

const { P, DAYS, STYLES, LINK, NODIET, expect, needText } = PERSONA_KIT;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let catalog = null;
export function loadCatalogIndex(file = path.join(ROOT, 'data/catalog.json')) {
  if (catalog) return catalog;
  if (!fs.existsSync(file)) return (catalog = { byName: new Map(), byId: new Map(), ok: false });
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byName = new Map(); const byId = new Map();
  for (const p of list) { byId.set(p.id, p); const k = p.name.toLowerCase().trim(); if (!byName.has(k)) byName.set(k, p); }
  return (catalog = { byName, byId, ok: true });
}
const product = (name) => loadCatalogIndex().byName.get(String(name).toLowerCase());
/** Valittu tuote rivillä: elävässä ajossa selectedProductId + selectedName, uudelleentarkistuksessa nimi kentässä selectedProductId. */
export function selectedProduct(line) {
  const idx = loadCatalogIndex();
  return idx.byId.get(String(line?.selectedProductId)) || (line?.selectedName && product(line.selectedName)) || (line?.selectedProductId && product(line.selectedProductId)) || null;
}

const ALLERGEN_WORD = { AM: 'maitoa', AW: 'gluteenia', AE: 'kananmunaa', BM: 'sinappia', AY: 'soijaa', AF: 'kalaa' };
// Maiden tunnistus vastauksesta. Avain = catalogin country-koodi.
export const COUNTRY = { fi: /suom|kotimai/iu, il: /israel/iu, th: /thai/iu, fr: /ransk/iu, br: /brasil/iu, de: /saksa/iu, nl: /hollan|alankoma/iu,
  es: /espanj/iu, it: /itali/iu, se: /ruotsi/iu, be: /belgi/iu, pl: /puola/iu, cr: /costa ric/iu, dk: /tanska/iu, ee: /viro|eesti/iu, lt: /liettu/iu };
const TEMP = { chilled: { right: /jääkaap|kylmä|\+\s?[2-8]|viileä/iu, wrong: /pakaste|pakastim|huoneenlämpö|-\s?18/iu },
  frozen: { right: /pakaste|pakastim|-\s?18|jäädy/iu, wrong: /jääkaapi|huoneenlämpö|\+\s?[2-8]\s?°?\s?c/iu },
  ambient: { right: /huoneenlämpö|kuiva|viileä/iu, wrong: /pakastim|pakasteessa/iu } };

const slot = (i) => ['morning', 'day', 'evening', 'night'][i % 4];
const D = DAYS.slice(1);
function build() {
  const idx = loadCatalogIndex(); if (!idx.ok) return [];
  const out = [];
  const add = (category, route, o) => {
    const i = out.length; const s = o.slot || slot(i); const style = STYLES.find((x) => x.id === (o.style || 'casual'));
    out.push({ id: `V${String(i + 1).padStart(3, '0')}`, category, route, kitchen: o.kitchen || 'lounasravintola', style: style.id, variant: 0, slot: s, now: SLOTS[s].now,
      greetingWrong: SLOTS[s].wrong.source, dateInFirst: true, maxTurns: 7, ...o,
      brief: `Olet ostaja, keittiötyyppi: ${o.kitchen || 'lounasravintola'}. Kello on nyt ${SLOTS[s].label}. ${style.brief} ${o.brief} Älä muuta tavoitetta apurin virheen takia: korjaa virhe.` });
  };
  const question = (route, name, q, truth, extra = {}) => {
    const p = product(name); if (!p) return;
    add('data', route, { first: q, expected: {}, expectEmpty: true, adviceFirst: true, dateInFirst: false, date: D[0].iso, maxTurns: 3,
      truth: { productId: p.id, name: p.name, country: p.country, contains: p.contains || [], labels: p.labels || [], temp: p.temp, ...truth }, ...extra,
      brief: `Kysyt vain: "${q}". Et tilaa mitään. Jos vastaus jää epäselväksi, tarkenna kerran. Kiitä ja lopeta sitten.` });
  };

  // 1. Alkuperämaa (6): nimi ei paljasta maata.
  for (const [name, q] of [['PERUNA PESTY 1KG', 'Mistä maasta teidän PERUNA PESTY 1KG tulee?'], ['Benella Kirjolohi', 'Onko Benella Kirjolohi suomalaista?'],
    ['Atria Keittokinkku 250g', 'Mistä maasta Atria Keittokinkku 250g on?'], ['APPELSIINI JAFFA', 'Mistä maasta APPELSIINI JAFFA tulee?'],
    ['BANAANINLEHTI 500G', 'Onko BANAANINLEHTI 500G suomalainen tuote?'], ['Roquefort 1,3kg', 'Mistä maasta Roquefort 1,3kg on?']]) question('data-origin', name, q, { kind: 'origin' });
  // 2. Allergeenit (6): asked = kysytty allergeeni, contains = datan totuus. Mukana laktoositon mutta ei maidoton -ansa.
  for (const [name, code, q] of [['HK Coleslaw 3 kg', 'AE', 'Onko HK Coleslaw 3 kg munaton?'], ['Oatly iKaffe 0,5L', 'AW', 'Onko Oatly iKaffe 0,5L gluteeniton?'],
    ['Vegem Nakki 1kg', 'AW', 'Sopiiko Vegem Nakki 1kg keliaakikolle?'], ['Alpro Soijajuoma 1L', 'AM', 'Sisältääkö Alpro Soijajuoma 1L maitoa?'],
    ['Valio Edam e350 g', 'AM', 'Onko Valio Edam e350 g maidoton? Meillä on maitoallerginen.'], ['HK Rosolli 3 kg', 'BM', 'Sisältääkö HK Rosolli 3 kg sinappia?']]) {
    const p = product(name); if (!p) continue;
    question('data-allergen', name, q, { kind: 'allergen', asked: code, hasIt: (p.contains || []).includes(code) || (p.mayContain || []).includes(code), word: ALLERGEN_WORD[code] });
  }
  // 3. Säilytys (4)
  for (const [name, q] of [['RF Mustikkakakku 1150 g', 'Miten RF Mustikkakakku 1150 g säilytetään?'], ['Vaasan Pizzapohja 60x160g', 'Missä lämpötilassa Vaasan Pizzapohja 60x160g säilytetään?'],
    ['Atria Keittokinkku 250g', 'Voiko Atria Keittokinkku 250g säilyttää huoneenlämmössä?'], ['APPELSIINI JAFFA', 'Pitääkö APPELSIINI JAFFA laittaa pakkaseen?']]) question('data-storage', name, q, { kind: 'storage' });

  // 4.–6. Valinta datan perusteella: pienin hiilijalanjälki, varmin toimitus, edullisin.
  const choose = (route, kind, items, ask, brief) => items.forEach(([name, v], j) => { const d = D[(j + 1) % D.length];
    add('data', route, { first: `${name === 'kerma' ? `${v} l ruokakermaa` : name === 'jauheliha' ? `${v} kg jauhelihaa` : name === 'kaurajuoma' ? `${v} l kaurajuomaa` : name === 'maito' ? `${v} l maitoa` : `${v} kg perunaa`} ${d.slang}. ${ask}`,
      expected: expect([name], [v]), date: d.iso, truth: { kind, term: P[name].key }, requiresSelection: true, kitchen: ['catering-yritys', 'kouluruokala', 'kahvila', 'hotellin aamiaiskeittiö', 'päiväkoti'][j % 5],
      brief: `Tarvitset ${needText(expect([name], [v]))} toimitukseen ${d.label}. ${brief} ${NODIET} ${LINK}` }); });
  choose('data-co2', 'co2', [['maito', 20], ['kaurajuoma', 10], ['jauheliha', 8], ['kerma', 3], ['peruna', 20]], 'Mikä vaihtoehdoista on ympäristöystävällisin, eli pienin hiilijalanjälki?',
    'Valitse numerolla se vaihtoehto, jonka apuri sanoo pienimmän hiilijalanjäljen vaihtoehdoksi. Jos apuri ei tiedä, valitse 1.');
  choose('data-reliability', 'reliability', [['maito', 30], ['peruna', 25], ['jauheliha', 6]], 'Mikä näistä toimitetaan varmimmin? Ei saa jäädä tulematta.',
    'Valitse numerolla se vaihtoehto, jonka apuri sanoo varmimmin toimitettavaksi. Jos apuri ei tiedä, valitse 1.');
  choose('data-cheapest', 'cheapest', [['maito', 20], ['kerma', 5], ['peruna', 15]], 'Mikä vaihtoehdoista tulee edullisimmaksi?',
    'Valitse numerolla se vaihtoehto, jonka apuri sanoo edullisimmaksi. Jos apuri ei sano, valitse halvin itse.');

  // 7. Tilausaika (4): simuloidussa saatavuudessa closingTime on edellinen päivä klo 12.00.
  [['morning', 'maito', 20, DAYS[0]], ['day', 'peruna', 20, D[0]], ['evening', 'jauheliha', 8, D[2]], ['night', 'kerma', 3, D[1]]].forEach(([s, name, v, d], j) => {
    add('data', 'data-cutoff', { slot: s, first: `${name === 'kerma' ? `${v} l ruokakermaa` : name === 'jauheliha' ? `${v} kg jauhelihaa` : name === 'maito' ? `${v} l maitoa` : `${v} kg perunaa`} ${d.slang}. Mihin mennessä pitää tilata?`,
      expected: expect([name], [v]), date: d.iso, truth: { kind: 'cutoff', hour: 12 }, variant: j,
      brief: `Tarvitset ${needText(expect([name], [v]))} toimitukseen ${d.label} ja haluat tietää viimeisen tilausajan. Jos apuri ei kerro sitä, kysy uudelleen kerran. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}` }); });

  // 8. Allergiaopas (4): ostaja pyytää linkkiä liian aikaisin. Apurin pitää opastaa valinta ja allergeeni loppuun ennen linkkiä.
  [['kaurajuoma', 10, 'AW', null, 'keliaakikko, pitää olla gluteeniton'], ['jaatelo', 5, 'AM', null, 'lapsella maitoallergia'],
    ['makaroni', 5, 'AW', 'FREE_FROM_GLUTEN', 'keliakia'], ['kerma', 3, null, 'FREE_FROM_LACTOSE', 'laktoosi-intoleranssi']].forEach(([name, v, allergen, claim, why], j) => { const d = D[j % D.length];
    add('data', 'data-allergy-guide', { first: `${name === 'jaatelo' ? `${v} l jäätelöä` : name === 'kaurajuoma' ? `${v} l kaurajuomaa` : name === 'makaroni' ? `${v} kg makaronia` : `${v} l ruokakermaa`} ${d.slang}, ${why}. Laita kori heti, ei aikaa.`,
      expected: expect([name], [v]), date: d.iso, requiresSelection: true, kitchen: ['päiväkoti', 'kouluruokala', 'sairaalakeittiö', 'palvelutalo'][j],
      ...(allergen ? { requiredAllergen: allergen } : {}), ...(claim ? { requiredClaim: claim } : {}), truth: { kind: 'safe-selection', allergen, claim }, style: 'impatient',
      brief: `Tarvitset ${needText(expect([name], [v]))} toimitukseen ${d.label}: ${why}. Kiirehdit ja pyydät korilinkkiä heti. Jos apuri kysyy tai näyttää vaihtoehdot, vastaa ja valitse turvallinen vaihtoehto numerolla. Pyydä sen jälkeen linkki.` }); });
  return out;
}

export const DATA_CASES = build();

const sentencesOf = (replies) => replies.flatMap((r) => r.split(/(?<=[.!?])\s+|\n/u)).filter((x) => x.trim());
const UNKNOWN = /(en näe|ei ole tietoa|en tiedä|en pysty|ei tietoa|en löydä|tietoa ei|ei ole tiedossa|en osaa sanoa)/iu;
const NEG = /(?<![\p{L}])(ei|en|eikä)(?![\p{L}])/iu;

/** Vaihtoehto nimeltä katalogista (vaihtoehtolistan nimi on katalogin name). */
const optionProduct = (o) => loadCatalogIndex().byName.get(o.name.toLowerCase()) || null;
const lastPrice = (line) => { const m = [...line.matchAll(/(\d[\d\s]*[,.]\d{2})\s?€/gu)].at(-1); return m ? Number(m[1].replace(/\s/gu, '').replace(',', '.')) : null; };

/** inspectPersona + datatarkistukset. Palauttaa saman rakenteen kuin inspectPersona. */
export function inspect(persona, turns, list) {
  const base = inspectPersona(persona, turns, list);
  const t = persona.truth; if (!t) return base;
  const replies = turns.map((x) => String(x.assistant || '')); const sentences = sentencesOf(replies);
  const fail = (code) => base.failures.push(code);
  if (t.kind === 'origin') {
    const truthRe = COUNTRY[t.country];
    const said = Object.entries(COUNTRY).filter(([code, re]) => sentences.some((x) => re.test(x) && !(code !== t.country && NEG.test(x))));
    if (said.some(([code]) => code !== t.country) && !said.some(([code]) => code === t.country)) fail('origin_wrong');
    else if (!truthRe || !sentences.some((x) => truthRe.test(x))) fail('data_not_used:origin');
  }
  if (t.kind === 'allergen') {
    const w = t.word.replace(/a$/u, '');
    const free = { AE: /munaton|munattom|ei sisällä (kanan)?muna|kananmunaa ei ole merkitty/iu, AW: /gluteeniton|gluteenitto|ei sisällä gluteeni|sopii keliaak/iu, AM: /maidoton|maidottom|ei sisällä maito|maitoa ei ole merkitty/iu, BM: /ei sisällä sinappi|sinapiton/iu, AY: /soijaton|ei sisällä soija/iu }[t.asked];
    const has = new RegExp(`sisältää[^.\\n]{0,40}${w}|ei ole (munaton|gluteeniton|maidoton)|ei sovi|${w}a sisältävä`, 'iu');
    const claimsFree = sentences.some((x) => free.test(x) && !/ei ole (munaton|gluteeniton|maidoton)|ei sovi/iu.test(x));
    const claimsHas = sentences.some((x) => has.test(x));
    if (t.hasIt && claimsFree && !claimsHas) fail('allergen_wrong_dangerous');
    else if (!t.hasIt && claimsHas && !claimsFree) fail('allergen_wrong');
    else if (!claimsFree && !claimsHas) fail('data_not_used:allergen');
  }
  if (t.kind === 'storage') {
    const rule = TEMP[t.temp];
    // Oikea säilytys missä tahansa vastauksessa riittää (esim. "säilytä pakastimessa, sulata jääkaapissa").
    if (rule && !sentences.some((x) => rule.right.test(x)) && sentences.some((x) => rule.wrong.test(x) && !NEG.test(x))) fail('storage_wrong');
    else if (rule && !sentences.some((x) => rule.right.test(x))) fail('data_not_used:storage');
  }
  if (['co2', 'reliability', 'cheapest'].includes(t.kind)) {
    const blocks = replies.flatMap((r) => parseOptions(r)).filter((b) => b.heading.toLowerCase().includes(t.term));
    const options = blocks.flat();
    const value = (o) => (t.kind === 'cheapest' ? lastPrice(o.line) : t.kind === 'co2' ? optionProduct(o)?.co2 : optionProduct(o)?.reliability);
    const known = options.map((o) => ({ o, v: value(o) })).filter((x) => Number.isFinite(x.v));
    const best = known.length ? (t.kind === 'reliability' ? Math.max(...known.map((x) => x.v)) : Math.min(...known.map((x) => x.v))) : null;
    const topic = { co2: /hiilijalanjälj|ympäristö|co2|päästö/iu, reliability: /toimitusvarm|varmin|varmimmin|luotettav/iu, cheapest: /edullisin|halvin|halvim/iu }[t.kind];
    const claim = sentences.some((x) => topic.test(x) && !UNKNOWN.test(x));
    const selected = (list?.lines || []).find((l) => l.productTerm.toLowerCase().includes(t.term));
    const sp = selectedProduct(selected);
    const selectedOption = sp && options.find((o) => o.name.toLowerCase() === sp.name.toLowerCase());
    const chosen = selectedOption ? value(selectedOption) : (sp && t.kind !== 'cheapest' ? (t.kind === 'co2' ? sp.co2 : sp.reliability) : null);
    base.metrics.dataKnownOptions = known.length; base.metrics.dataBest = best; base.metrics.dataChosen = chosen ?? null;
    if (known.length >= 2 && !claim) fail(`data_not_used:${t.kind}`);
    else if (claim && Number.isFinite(chosen) && best != null && (t.kind === 'reliability' ? chosen < best - 1e-9 : chosen > best + 1e-9)) fail(`${t.kind}_wrong`);
  }
  if (t.kind === 'cutoff') {
    // Rivin sisällä: päivämäärän piste ("su 15.11. klo 12.00") ei saa katkaista tilausajan ja kellonajan yhteyttä.
    const times = replies.flatMap((r) => [...r.matchAll(/(?:viimeistään|tilausaika|mennessä|takaraja|tilattava|ehti)[^\n]{0,80}?(?:klo\s?(\d{1,2})|\b(\d{1,2})[.:][0-5]\d\b(?!\.))/giu)].map((m) => Number(m[1] || m[2])));
    // closingTime vaihtelee tuotteittain (esim. klo 10 kaksi päivää ennen), joten tarkistetaan vain, että aika kerrotaan.
    if (!times.length) fail('data_not_used:cutoff');
  }
  if (t.kind === 'safe-selection') {
    for (const l of list?.lines || []) {
      const p = selectedProduct(l); if (!p) continue;
      if (t.allergen && ((p.contains || []).includes(t.allergen) || (p.mayContain || []).includes(t.allergen) || !p.hasAllergenData)) fail('unsafe_selection');
      if (t.claim && !(p.labels || []).includes(t.claim)) fail('unsafe_selection');
    }
  }
  base.failures = [...new Set(base.failures)];
  return base;
}
