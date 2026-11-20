// Pikalista: puhekieli, kirjoitusvirheet, synonyymit ja väärän hyllyn tapaukset. Ei mallikutsuja, ei API-kutsuja.
// Aja: npm run aimo:eval:spoken
// Jokainen rivi: [haku, odotettu hakusana, sana jonka pitää olla jokaisen kolmen kärkituotteen nimessä (tai null)]
process.env.AIMO_LEARNED = '/dev/null'; // oppiva muisti pois: tulos ei saa riippua siitä, mitä tällä koneella on haettu
const { understand } = await import('../server/aimo/understand.mjs');
const { resolveItem } = await import('../server/aimo/resolve.mjs');

const CASES = [
  // taivutus ja astevaihtelu
  ['maidon', 'maito', 'mai'], ['maidot', 'maito', 'mai'], ['jogurtit', 'jogurtti', 'jogurtti'], ['mustikoita', 'mustikka', 'mustikka'],
  ['leivän', 'leipä', 'leipä'], ['leivät', 'leipä', 'leipä'], ['jauhoja', 'vehnäjauho', 'vehnäjauho'], ['muroja', 'muro', 'muro'],
  // puhekieli
  ['maitoo', 'maito', 'mai'], ['10 l maitoo', 'maito', 'mai'], ['juustoo', 'juusto', 'juusto'], ['kurkkuu', 'kurkku', 'kurkku'],
  ['lohee', 'lohi', 'lohi'], ['kananmunii', 'kananmuna', 'muna'], ['perunoit', 'peruna', 'peruna'], ['kahvii', 'kahvi', 'kahvi'],
  ['porkkanoit', 'porkkana', 'porkkana'], ['kukkakaalii', 'kukkakaali', 'kukkakaali'],
  // kirjoitusvirheet
  ['maetoo', 'maito', 'mai'], ['miato', 'maito', 'mai'], ['maitto', 'maito', 'mai'], ['jugurtti', 'jogurtti', 'jogurtti'],
  ['jukurtti', 'jogurtti', 'jogurtti'], ['jugurttii', 'jogurtti', 'jogurtti'], ['mustikkajugurtti', 'mustikkajogurtti', 'mustikkajogurtti'],
  ['mustikka jugurtti', 'mustikka jogurtti', 'mustikka'],
  // slangi ja synonyymit
  ['pottu', 'peruna', 'peruna'], ['pottuu', 'peruna', 'peruna'], ['bansku', 'banaani', 'banaani'], ['jätski', 'jäätelö', 'jäätelö'],
  ['limu', 'virvoitusjuoma', 'virvoitusjuoma'], ['limsaa', 'virvoitusjuoma', 'virvoitusjuoma'], ['kalja', 'olut', null],
  ['kauramaito', 'kaurajuoma', 'kaurajuoma'], ['jäävuorisalaatti', 'jääsalaatti', 'jääsalaatti'],
  // murre
  ['räätikäsloora', 'lanttulaatikko', 'lanttulaatikko'], ['5 kg räätikäslooraa', 'lanttulaatikko', 'lanttulaatikko'],
  ['räätikkälooraa', 'lanttulaatikko', 'lanttulaatikko'], ['räätikkää 3 kg', 'lanttu', 'lanttu'],
  // yhdyssanat
  ['pakastemustikka', 'mustikka', 'mustikka'], ['tuoremehu', 'mehu', 'mehu'], ['tuorejuusto', 'tuorejuusto', 'tuorejuusto'],
  ['jauho', 'vehnäjauho', 'vehnäjauho'], ['kanakeittoo', 'kanakeitto', 'kanakeitto'],
  // väärä hylly: raaka-aine, ei valmisruoka tai maustettu tuote
  ['kahvimaito', 'kahvimaito', 'kahvimaito'], ['kana', 'kana', /kana|broiler/], ['kanaa 10 kg', 'kana', /kana|broiler/],
  ['broileri', 'broiler', /kana|broiler/], ['lohi', 'lohi', 'lohi'], ['lohta', 'lohi', 'lohi'], ['nauta', 'nauta', /naudan|nauta/],
  ['possua', 'porsas', /porsaan|possu/], ['kurkku', 'kurkku', 'kurkku'], ['banaani', 'banaani', 'banaani'], ['peruna', 'peruna', 'peruna'],
  // ei saa arvata: tuntematon pysyy tuntemattomana
  ['xyzzy', null, null], ['asdfgh', null, null], ['2 kg unicorn meat', undefined, null],
];
// Näissä kärjessä ei saa olla mitään näistä (valmisruoat, eväsleivät, säilykkeet).
const NOT_TOP = { kana: /panini|kolmioleipä|keitto|kiusaus/i, lohi: /laatikko|kiusaus|keitto/i, kurkku: /mauste|suola|säilyke/i, kauramaito: /kevytmaito|täysmaito/i };

let pass = 0; let ms = 0;
understand('lämmitys');
for (const [text, term, top] of CASES) {
  const r = understand(text); ms += r.ms;
  const it = r.items[0]; const errs = [];
  if (term === null) { if (it) errs.push(`tunnisti sanan "${it.productTerm}", piti jäädä tuntemattomaksi`); }
  else if (term === undefined) { if (r.confidence >= 0.6) errs.push(`varmuus ${r.confidence}, piti olla alle 0.6`); }
  else if (!it) errs.push('ei tunnistettu');
  else {
    if (it.productTerm !== term) errs.push(`hakusana "${it.productTerm}" ≠ "${term}"`);
    const names = resolveItem(it).candidates.slice(0, 3).map((c) => c.name);
    if (!names.length) errs.push('ei tuotteita');
    const bad = names.find((n) => (top instanceof RegExp ? !top.test(n.toLowerCase()) : top && !n.toLowerCase().includes(top)) || NOT_TOP[text]?.test(n));
    if (bad) errs.push(`kärjessä "${bad}"`);
  }
  if (!errs.length) pass += 1;
  console.log(`${errs.length ? 'VIRHE' : 'ok   '} ${text}${errs.length ? `: ${errs.join(', ')}` : ''}`);
}
console.log(`\n${pass}/${CASES.length} oikein, 0 mallikutsua, keskimäärin ${(ms / CASES.length).toFixed(2)} ms / haku`);
process.exit(pass === CASES.length ? 0 : 1);
