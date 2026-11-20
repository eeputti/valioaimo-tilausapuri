// PUHEKIELEN SANAT JA OPPIVA MUISTI.
// Sanasto (lexicon.mjs) tuntee vain sanat, jotka ovat Aimon tuotenimissä. Keittiössä sanotaan silti "pottu", "limsa" ja
// "kauramaito". Tässä on kaksi lähdettä, jotka kääntävät ne sanaston sanoiksi:
//  1) SYNONYMS: pieni käsin ylläpidetty taulu.
//  2) Oppiva muisti (data/aimo-learned.json): kun kielimalli on kerran tulkinnut tuntemattoman sanan ja tulos on
//     tarkistettu sanastoa vasten, pari tallennetaan. Sama sana tunnistetaan sen jälkeen ilman mallikutsua.
// Kumpikaan ei valitse tuotteita: tulos on aina hakusana, ja tuotteet tulevat katalogista.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stems } from '../catalog.mjs';
import { spoken } from './lexicon.mjs';

export const SYNONYMS = {
  // juomat
  kauramaito: 'kaurajuoma', soijamaito: 'soijajuoma', mantelimaito: 'mantelijuoma',
  limu: 'virvoitusjuoma', limsa: 'virvoitusjuoma', limppari: 'virvoitusjuoma', limonaadi: 'limonadi', limukka: 'virvoitusjuoma',
  kalja: 'olut', bisse: 'olut', vissy: 'kivennäisvesi', kokis: 'cola',
  // maitotuotteet
  jugurtti: 'jogurtti', jukurtti: 'jogurtti', jogu: 'jogurtti', jätski: 'jäätelö', jäde: 'jäätelö',
  vispi: 'vispikerma', kuohis: 'kuohukerma', kermavaahto: 'kuohukerma',
  // kasvikset ja hedelmät
  pottu: 'peruna', pottuja: 'peruna', potut: 'peruna', peruna: 'peruna', bansku: 'banaani', tomsku: 'tomaatti',
  jäävuorisalaatti: 'jääsalaatti', appelsiinit: 'appelsiini', porkkanat: 'porkkana',
  // Lounais-Suomen murre: räätikkä on lanttu ja loora laatikko (ruotsin låda), eli räätikäsloora on lanttulaatikko.
  // Ilman taulua "räätikäsloora" haki loppuosalla "loor" ja kärkeen tuli lattiakuivain.
  räätikkä: 'lanttu', räätikä: 'lanttu', raatikka: 'lanttu',
  räätikäsloora: 'lanttulaatikko', räätikkäsloora: 'lanttulaatikko', räätikkäloora: 'lanttulaatikko', räätikäloora: 'lanttulaatikko',
  räätikkälaatikko: 'lanttulaatikko', räätikälaatikko: 'lanttulaatikko',
  // liha ja kala
  jauhis: 'jauheliha', possu: 'porsas', sika: 'porsas', kananpoika: 'kana', broidi: 'broileri',
  // kuiva-aineet ja muut
  // Pelkkä "jauhot" tarkoittaa keittiössä vehnäjauhoja: ruis- ja ohrajauho tulivat halvimpina ensin (WhatsApp-koe 17.11.).
  jauho: 'vehnäjauho', jauhot: 'vehnäjauho',
  makarooni: 'makaroni', spaghetti: 'spagetti', ranskalaiset: 'ranskanperuna', ranut: 'ranskanperuna',
  sipsi: 'perunalastu', sipsit: 'perunalastu', majo: 'majoneesi', ketsuppia: 'ketsuppi', kanamuna: 'kananmuna',
};

// Raaka-aineen oma hylly. Näillä sanoilla tuotenimi ei kerro, mikä on raaka-aine: "kana" on nimissä lähinnä eväsleipien
// täyte ja raaka kana on nimeltään "broilerin" tai "kananpojan". Kun sana on pyynnön ainoa tuotesana, haetaan suoraan
// näistä tuoteryhmistä ja nimen pitää sisältää jokin luetelluista osista.
export const SHELVES = {
  kana: { label: 'broileri, kana', categories: ['18750', '41710'], names: ['broiler', 'kananpo', 'kana'] },
  broileri: { label: 'broileri, kana', categories: ['18750', '41710'], names: ['broiler', 'kananpo', 'kana'] },
  broiler: { label: 'broileri, kana', categories: ['18750', '41710'], names: ['broiler', 'kananpo', 'kana'] },
  // Kanafilee on raakaa broilerin fileetä. Sanasto tuntee sanan vain kanasäilykkeistä ja leikkeleestä ("Kanafile vedessä").
  // must: nimen pitää sisältää myös jokin näistä, eli broileria ilman fileetä (koivet, siivet) ei tarjota.
  kanafilee: { label: 'broilerin filee', categories: ['18750', '41710'], names: ['broiler', 'kananpo', 'kana'], must: ['file'] },
  kanafile: { label: 'broilerin filee', categories: ['18750', '41710'], names: ['broiler', 'kananpo', 'kana'], must: ['file'] },
  lohi: { label: 'lohi', categories: ['18701', '41720', '18702', '18708'], names: ['lohi', 'lohta', 'lohesta'] },
  nauta: { label: 'nauta', categories: ['18720', '41702', '18760'], names: ['naudan', 'nauta'] },
  porsas: { label: 'porsas', categories: ['18710', '41701'], names: ['porsaan', 'porsas', 'possu'] },
  kurkku: { label: 'kurkku', categories: ['17402', '17443', '21591'], names: ['kurkku'] },
  banaani: { label: 'banaani', categories: ['17413'], names: ['banaani'] },
  peruna: { label: 'peruna', categories: ['17421', '17423', '41751'], names: ['peruna'] },
  // Keittiön "suklaa" on leivonta- tai levysuklaata: pähkinättömälle suklaalle tuli vanukas ja suklaajuomat (WhatsApp-koe 17.11.).
  suklaa: { label: 'suklaa', categories: ['22601', '52201'], names: ['suklaa'] },
};

const FILE = process.env.AIMO_LEARNED || path.join(ROOT, 'data', 'aimo-learned.json');
let learned;
function load() {
  if (learned) return learned;
  try { learned = new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))); } catch { learned = new Map(); }
  return learned;
}

/** Kaikki muodot, joilla sanaa kokeillaan: itse sana, taivutuksen purku ja puhekielen muodot. */
const forms = (word) => [word, ...stems(word), ...spoken(word)];

/** @returns {{word: string, via: 'synonym'|'learned'} | null} */
export function synonymOf(word) {
  for (const f of forms(word)) if (Object.hasOwn(SYNONYMS, f)) return SYNONYMS[f] === word ? null : { word: SYNONYMS[f], via: 'synonym' };
  return null;
}
// Opittu sana tallennetaan siinä muodossa kuin se kirjoitettiin ("nötköttiä"). Haku osuu myös saman sanan muihin
// muotoihin ("nötkötti"), koska avaimen kaikki muodot indeksoidaan.
let learnedIndex;
function index() {
  if (learnedIndex) return learnedIndex;
  learnedIndex = new Map();
  for (const [k, t] of load()) for (const f of forms(k)) if (f.length >= 4 && !learnedIndex.has(f)) learnedIndex.set(f, t);
  return learnedIndex;
}
export function learnedOf(word) {
  const m = load(); const ix = index();
  for (const f of forms(word)) { const t = m.get(f) || (f.length >= 4 ? ix.get(f) : null); if (t) return { word: t, via: 'learned' }; }
  return null;
}

/** Tallentaa parin "kirjoitettu sana → sanaston sana". Kutsuja vastaa siitä, että kohde on tarkistettu sanastoa vasten. */
export function learn(word, term) {
  const w = String(word || '').toLowerCase().trim(); const t = String(term || '').toLowerCase().trim();
  if (!/^[a-zåäöé-]{3,40}$/.test(w) || !/^[a-zåäöé-]{3,40}$/.test(t) || w === t) return false;
  const m = load();
  if (m.get(w) === t) return false;
  m.set(w, t); learnedIndex = null;
  try { fs.writeFileSync(FILE, `${JSON.stringify(Object.fromEntries([...m].sort()), null, 1)}\n`); } catch { /* muisti jää tämän prosessin ajaksi */ }
  return true;
}
