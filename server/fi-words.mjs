// Tuotesanojen taivutus asiakkaalle lähteviin viesteihin. Taivutetaan vain sanat, joiden muoto tiedetään:
// "En saa nyt tarkistettua saatavuutta juustolle" eikä "saatavuutta: juusto" (Eelis 17.11.). Tuntematon nimi
// kirjoitetaan muotoon "tuotteelle X", joka on oikeaa suomea ilman arvausta.

// Allatiivi (-lle) yleisimmille tuotesanoille. Yhdyssana taivutetaan viimeisen osan mukaan (emmentaljuusto → emmentaljuustolle).
const ALLATIVE = {
  maito: 'maidolle', kerma: 'kermalle', voi: 'voille', juusto: 'juustolle', kananmuna: 'kananmunille', kananmunat: 'kananmunille',
  muna: 'munille', munat: 'munille', peruna: 'perunoille', perunat: 'perunoille', riisi: 'riisille', pasta: 'pastalle',
  jauho: 'jauhoille', jauhot: 'jauhoille', sokeri: 'sokerille', suola: 'suolalle', kahvi: 'kahville', tee: 'teelle',
  jogurtti: 'jogurtille', rahka: 'rahkalle', viili: 'viilille', kermaviili: 'kermaviilille', jäätelö: 'jäätelölle',
  suklaa: 'suklaalle', lohi: 'lohelle', kala: 'kalalle', kana: 'kanalle', broileri: 'broilerille', liha: 'lihalle',
  jauheliha: 'jauhelihalle', filee: 'fileelle', fileesuikale: 'fileesuikaleelle', suikale: 'suikaleelle', piimä: 'piimälle',
  margariini: 'margariinille', öljy: 'öljylle', porkkana: 'porkkanoille', porkkanat: 'porkkanoille', sipuli: 'sipulille',
  tomaatti: 'tomaateille', tomaatit: 'tomaateille', kurkku: 'kurkuille', kurkut: 'kurkuille', omena: 'omenoille',
  banaani: 'banaaneille', leipä: 'leivälle', makaroni: 'makaronille', spagetti: 'spagetille', mehu: 'mehulle',
  juoma: 'juomalle', kaurajuoma: 'kaurajuomalle', kauramaito: 'kauramaidolle', salaatti: 'salaatille', kinkku: 'kinkulle',
  makkara: 'makkaralle', pekoni: 'pekonille', tilli: 'tillille', persilja: 'persiljalle', valkosipuli: 'valkosipulille',
  liemi: 'liemelle', kastike: 'kastikkeelle', hiiva: 'hiivalle', marja: 'marjoille', marjat: 'marjoille', mustikka: 'mustikoille',
  mansikka: 'mansikoille', vadelma: 'vadelmille', herne: 'herneille', herneet: 'herneille', papu: 'pavuille', pavut: 'pavuille',
  kaali: 'kaalille', paprika: 'paprikoille', sieni: 'sienille', sienet: 'sienille', leivos: 'leivoksille', leivokset: 'leivoksille',
  pulla: 'pullille', sämpylä: 'sämpylöille', sämpylät: 'sämpylöille', kakku: 'kakulle', mousse: 'moussille', vesi: 'vedelle',
  kahvimaito: 'kahvimaidolle', ruokakerma: 'ruokakermalle', kuohukerma: 'kuohukermalle', vispikerma: 'vispikermalle',
  laatikko: 'laatikolle', keitto: 'keitolle', puuro: 'puurolle',
};

// Edeltävä adjektiivi taipuu samaan sijaan: laktoositon → laktoosittomalle, maustamaton → maustamattomalle,
// tavallinen → tavalliselle, tuore → tuoreelle. Genetiivimääre (kanan, naudan) pysyy ennallaan.
const ADJECTIVE = { tuore: 'tuoreelle', kevyt: 'kevyelle', luomu: 'luomu', pakaste: 'pakaste', iso: 'isolle', pieni: 'pienelle', uusi: 'uudelle' };
function adjectiveAllative(word) {
  if (ADJECTIVE[word] !== undefined) return ADJECTIVE[word];
  // Vailla-adjektiivit: laktoositon, gluteeniton, maidoton, rasvaton, maustamaton, sokeriton.
  if (/t[oö]n$/u.test(word)) return word.replace(/t([oö])n$/u, (_, v) => (v === 'o' ? 'ttomalle' : 'ttömälle'));
  if (/inen$/u.test(word)) return word.replace(/inen$/u, 'iselle');
  return null;
}

function nounAllative(word) {
  const lower = word.toLocaleLowerCase('fi-FI');
  const keepCase = (form) => (word[0] !== lower[0] ? `${form[0].toLocaleUpperCase('fi-FI')}${form.slice(1)}` : form);
  if (ALLATIVE[lower]) return keepCase(ALLATIVE[lower]);
  // Yhdyssana: pisin tunnettu loppuosa, vähintään kolme kirjainta edessä (maitorahka, Emmental-juusto, vehnäjauho).
  for (let i = 3; i < lower.length - 1; i += 1) {
    const tail = lower.slice(i);
    if (ALLATIVE[tail]) return `${word.slice(0, i)}${ALLATIVE[tail]}`;
  }
  return null;
}

/** "juusto" → "juustolle", "maustamaton jogurtti" → "maustamattomalle jogurtille", tuntematon → "tuotteelle X". */
export function allative(term) {
  const text = String(term || '').trim();
  const words = text.split(/\s+/u).filter(Boolean);
  if (!words.length) return 'tuotteelle';
  const last = nounAllative(words.at(-1));
  const before = words.slice(0, -1).map((w) => { const l = w.toLocaleLowerCase('fi-FI'); return /n$/u.test(l) && !/t[oö]n$/u.test(l) && !/inen$/u.test(l) ? w : adjectiveAllative(l); });
  if (!last || before.some((w) => w == null)) return `tuotteelle ${text}`;
  return [...before, last].join(' ');
}
