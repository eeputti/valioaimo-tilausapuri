// 100 synteettistä WhatsApp-ostajaa itsekeskusteluun (scripts/whatsapp-selfplay-batch.mjs).
// Täydentää 484c55ac:n 100 profiilin loppukoetta (eval/whatsapp-profiles-100.mjs) poluilla, joita siinä ei ole:
// päivä puuttuu tai vaihtuu, numeroidut vaihtoehdot ja "4" lisävaihtoehdoille, valinta numerolla, annoslaskut,
// keittiötyyppien kirjo, slangi, kirjoitusvirheet, kärsimätön tai epäselvä ostaja ja olemattomat tuotteet.
// Persoonat generoidaan deterministisesti: 20 polkua x 5 muunnelmaa. Asiakasmalli saa vaihdella sanamuotoa,
// ei tavoitteita. Jokainen tavoite tarkistetaan koodissa (inspectPersona), mallin arvio on vain lisätieto.
// Tuotetermit on tarkistettu simuloidulla haulla (VALIO_API_KEY tyhjä, DEMO_NOW 15.11.2026) päiville 16.–20.11.
// Lyhyt case-skeema on sama kuin eval/whatsapp-selfplay-cases.mjs:ssä (runSelfplay ja inspectConversation).

// DEMO_NOW = su 15.11.2026, joten viikonpäivät osoittavat seuraavaan viikkoon.
const DAYS = [
  { iso: '2026-11-16', word: 'maanantaiksi', slang: 'maanantaiks', label: 'maanantai 16.11.2026' },
  { iso: '2026-11-17', word: 'tiistaiksi', slang: 'tiistaiks', label: 'tiistai 17.11.2026' },
  { iso: '2026-11-18', word: 'keskiviikoksi', slang: 'keskiviikoks', label: 'keskiviikko 18.11.2026' },
  { iso: '2026-11-19', word: 'torstaiksi', slang: 'torstaiks', label: 'torstai 19.11.2026' },
  { iso: '2026-11-20', word: 'perjantaiksi', slang: 'perjantaiks', label: 'perjantai 20.11.2026' },
];
const TOMORROW = { iso: '2026-11-16', word: 'huomiseksi', slang: 'huomiseks', label: 'huominen eli maanantai 16.11.2026' };

// key = osajono, jolla rivin productTerm tunnistetaan (sama tapa kuin inspectConversation). aliases vain omissa tarkistuksissa.
// neutral = laktoosi- tai gluteenikysymys on tuotteelle turha. Määrät ovat järkeviä keittiöeriä.
const P = {
  maito: { key: 'maito', not: ['kaura'], part: 'maitoa', slang: 'maitoo', typo: 'maetoo', unit: 'L', n: [20, 30, 15, 40, 10] },
  kerma: { key: 'kerma', part: 'ruokakermaa', slang: 'ruokakermaa', typo: 'ruokakermma', unit: 'L', n: [3, 5, 2, 4, 6] },
  voi: { key: 'voi', part: 'voita', slang: 'voita', typo: 'voitta', unit: 'KG', n: [5, 3, 2, 4, 10] },
  kananmuna: { key: 'kananmuna', aliases: ['kanamuna', 'muna'], not: ['strutsi'], part: 'kananmunaa', slang: 'kananmunii', typo: 'kanamunaa', unit: 'PCS', n: [60, 90, 120, 180, 30], neutral: true },
  peruna: { key: 'peruna', aliases: ['pottu'], part: 'perunaa', slang: 'pottuja', typo: 'perunoit', unit: 'KG', n: [20, 25, 15, 30, 10], neutral: true },
  porkkana: { key: 'porkkana', aliases: ['porkana'], part: 'porkkanaa', slang: 'porkkanoit', typo: 'porkanaa', unit: 'KG', n: [10, 5, 8, 15, 6], neutral: true },
  sipuli: { key: 'sipuli', part: 'sipulia', slang: 'sipulei', typo: 'sipulii', unit: 'KG', n: [5, 3, 4, 2, 6], neutral: true },
  lohi: { key: 'lohi', aliases: ['lohta', 'lohe'], part: 'lohta', slang: 'lohee', typo: 'lohtaa', unit: 'KG', n: [5, 4, 6, 3, 8], neutral: true },
  jauheliha: { key: 'jauheliha', aliases: ['jauhis'], part: 'jauhelihaa', slang: 'jauhista', typo: 'jauhelihha', unit: 'KG', n: [8, 5, 10, 6, 4], neutral: true },
  rintafilee: { key: 'rintafilee', aliases: ['broiler', 'kanafilee'], part: 'broilerin rintafileetä', slang: 'kanafileetä', typo: 'broilerin rintafiletta', unit: 'KG', n: [10, 8, 5, 12, 6], neutral: true },
  riisi: { key: 'riisi', part: 'riisiä', slang: 'riisii', typo: 'riissiä', unit: 'KG', n: [5, 10, 3, 8, 4], neutral: true },
  sokeri: { key: 'sokeri', part: 'sokeria', slang: 'sokerii', typo: 'sokkeria', unit: 'KG', n: [5, 10, 3, 2, 4], neutral: true },
  jogurtti: { key: 'jogurtti', aliases: ['jugurtti', 'jogurt'], part: 'maustamatonta jogurttia', slang: 'jugurttii', typo: 'jogurtia', unit: 'KG', n: [5, 10, 4, 6, 3] },
  rahka: { key: 'rahka', part: 'maitorahkaa', slang: 'rahkaa', typo: 'raahkaa', unit: 'KG', n: [5, 10, 3, 6, 4] },
  edam: { key: 'edam', aliases: ['juusto'], part: 'edam-juustoa', slang: 'edamii', typo: 'edamia', unit: 'KG', n: [3, 5, 2, 4, 6] },
  mozzarella: { key: 'mozzarella', aliases: ['mozza'], part: 'mozzarellaa', slang: 'mozzaa', typo: 'mozarellaa', unit: 'KG', n: [3, 5, 2, 4, 6] },
  tomaattimurska: { key: 'tomaatti', aliases: ['murska'], part: 'tomaattimurskaa', slang: 'tomaattimurskaa', typo: 'tomaattimurksaa', unit: 'KG', n: [5, 10, 3, 6, 4], neutral: true },
  makaroni: { key: 'makaroni', aliases: ['makkaroni'], part: 'makaronia', slang: 'makkaroonii', typo: 'makaroinia', unit: 'KG', n: [5, 3, 10, 6, 4] },
  vehnajauho: { key: 'jauho', part: 'vehnäjauhoja', slang: 'vehnäjauhoi', typo: 'vehnäjauhija', unit: 'KG', n: [10, 5, 20, 8, 6] },
  hiiva: { key: 'hiiva', part: 'tuorehiivaa', slang: 'hiivaa', typo: 'tuorehiivä', unit: 'KG', n: [1, 2, 1, 2, 1], neutral: true },
  kaurajuoma: { key: 'kaura', aliases: ['kauramaito'], part: 'kaurajuomaa', slang: 'kauramaitoo', typo: 'kaurajuomma', unit: 'L', n: [10, 5, 8, 6, 12] },
  kahvikerma: { key: 'kahvikerma', part: 'kahvikermaa', slang: 'kahvikermaa', typo: 'kahvikermmaa', unit: 'L', n: [5, 3, 10, 4, 6] },
  mustikka: { key: 'mustik', part: 'mustikoita', slang: 'mustikkaa', typo: 'mustikoit', unit: 'KG', n: [2, 5, 3, 4, 6], neutral: true },
  banaani: { key: 'banaani', aliases: ['bansku'], part: 'banaaneja', slang: 'banskuja', typo: 'bananeja', unit: 'KG', n: [5, 3, 10, 6, 4], neutral: true },
  kahvi: { key: 'kahvi', not: ['kerma'], part: 'kahvia', slang: 'kahvii', typo: 'kahvai', unit: 'KG', n: [3, 5, 2, 4, 6], neutral: true },
  jaatelo: { key: 'jäätelö', aliases: ['jätski'], part: 'vaniljajäätelöä', slang: 'vaniljajätskii', typo: 'vaniljajätelöä', unit: 'L', n: [5, 10, 5, 10, 5] },
};

// Keittiöt ja niiden tavalliset tuotteet. Variantti valitsee keittiön ja tuotteet, joten sama polku saa eri sisällön.
const KITCHENS = [
  { name: 'lounasravintola', items: ['rintafilee', 'riisi', 'kerma', 'sipuli', 'porkkana'] },
  { name: 'hotellin aamiaiskeittiö', items: ['kananmuna', 'jogurtti', 'maito', 'kahvi', 'banaani'] },
  { name: 'päiväkoti', items: ['maito', 'peruna', 'jauheliha', 'porkkana', 'banaani'] },
  { name: 'kouluruokala', items: ['makaroni', 'jauheliha', 'maito', 'peruna', 'porkkana'] },
  { name: 'kahvila', items: ['kahvikerma', 'kaurajuoma', 'kahvi', 'voi', 'sokeri'] },
  { name: 'catering-yritys', items: ['lohi', 'peruna', 'kerma', 'sipuli', 'porkkana'] },
  { name: 'pizzeria', items: ['mozzarella', 'tomaattimurska', 'vehnajauho', 'hiiva', 'sipuli'] },
  { name: 'sairaalakeittiö', items: ['maito', 'peruna', 'lohi', 'porkkana', 'jogurtti'] },
  { name: 'leipomo', items: ['vehnajauho', 'voi', 'sokeri', 'hiiva', 'kananmuna'] },
  { name: 'food truck', items: ['jauheliha', 'sipuli', 'peruna', 'edam', 'tomaattimurska'] },
  { name: 'palvelutalo', items: ['maito', 'rahka', 'mustikka', 'peruna', 'voi'] },
  { name: 'henkilöstöravintola', items: ['rintafilee', 'riisi', 'porkkana', 'jogurtti', 'sipuli'] },
  { name: 'kasvisravintola', items: ['kaurajuoma', 'riisi', 'porkkana', 'tomaattimurska', 'sipuli'] },
  { name: 'jäätelökioski', items: ['jaatelo', 'mustikka', 'banaani', 'sokeri', 'kahvikerma'] },
  { name: 'festivaalikeittiö', items: ['makaroni', 'jauheliha', 'sipuli', 'edam', 'kananmuna'] },
];

// Kirjoitustyyli ohjaa sekä ensimmäistä viestiä (generoitu tässä) että asiakasmallin myöhempiä viestejä (brief).
const STYLES = [
  { id: 'casual', brief: 'Kirjoitat lyhyesti ja puhekielisesti, kuten kiireinen kokki puhelimella.' },
  { id: 'formal', brief: 'Kirjoitat kohteliaasti ja täydellisin lausein.' },
  { id: 'slang', brief: 'Käytät slangia ja puhekieltä (esim. "tarvis", "pottuja", "maitoo"), lyhenteitä ja pieniä kirjoitusvirheitä.' },
  { id: 'typos', brief: 'Kirjoitat nopeasti, ilman isoja kirjaimia ja välillä kirjoitusvirheillä.' },
  { id: 'impatient', brief: 'Olet kärsimätön: vastaat mahdollisimman lyhyesti ja ärsyynnyt turhista kysymyksistä, mutta vastaat olennaisiin.' },
  { id: 'unclear', brief: 'Kirjoitat vähän epäselvästi ja hajanaisesti, mutta vastaat apurin kysymyksiin oikeilla tiedoilla.' },
];

const fiNum = (n) => String(n).replace('.', ',');
const amount = (p, v, style) => {
  if (p.unit === 'PCS') return `${v}`;
  if (p.unit === 'L') return style === 'formal' ? `${fiNum(v)} litraa` : `${fiNum(v)} l`;
  return style === 'formal' ? `${fiNum(v)} kiloa` : `${fiNum(v)} kg`;
};
const word = (p, style) => (style === 'slang' ? p.slang : style === 'typos' ? p.typo : p.part);
const item = (name, style, value) => { const p = P[name]; return `${amount(p, value, style)} ${word(p, style)}`; };
const join = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ja ${parts.at(-1)}` : parts[0]);
const dayWord = (day, style) => (style === 'slang' || style === 'typos' || style === 'casual' ? day.slang : day.word);
const unitFi = { L: 'l', KG: 'kg', PCS: 'kpl' };
const needText = (expected) => Object.entries(expected).map(([key, q]) => `${q.label || key} ${fiNum(q.value)} ${unitFi[q.unit]}`).join(', ');

function opener(style, text) {
  const lead = { casual: 'moi, ', formal: 'Hei! ', slang: 'moro! tarvis ', typos: '', impatient: 'äkkiä ', unclear: 'joo elikkä ' }[style];
  const tail = { casual: '', formal: '', slang: '', typos: '', impatient: ', ei mitään turhaa kyselyä', unclear: ' jos onnistuu' }[style];
  const body = style === 'formal' ? `tarvitsisimme ${text}.` : style === 'typos' ? text.toLowerCase() : text;
  return `${lead}${body}${tail}`.replace(/\s+/gu, ' ').trim();
}

const expect = (names, values, extra = {}) => Object.fromEntries(names.map((name, i) => {
  const p = P[name];
  return [p.key, { value: values[i], unit: p.unit, label: name === 'vehnajauho' ? 'vehnäjauho' : name === 'tomaattimurska' ? 'tomaattimurska' : name === 'jaatelo' ? 'vaniljajäätelö' : name, ...(p.aliases ? { aliases: p.aliases } : {}), ...(p.not ? { not: p.not } : {}), ...(extra[name] || {}) }];
}));
const pick = (kitchen, v, count) => Array.from({ length: count }, (_, i) => kitchen.items[(v + i) % kitchen.items.length]);
const val = (name, v) => P[name].n[v % P[name].n.length];
const allNeutral = (names) => names.every((n) => P[n].neutral);
const LINK = 'Kun tuotteet on valittu ja määrät ja päivä ovat oikein, pyydä linkki ostoskoriin (esim. "ok, laita kori").';
const NODIET = 'Ei ruokavaliorajoitteita: tavallinen tuote käy. Jos apuri kysyy laktoosittomuudesta tai gluteenista turhaan, sano lyhyesti että tavallinen käy ja ihmettele kysymystä.';

// Polut tärkeysjärjestyksessä: pilotin 10 ensimmäistä (S001–S010) kattavat kymmenen eri polkua.
const JOURNEYS = [
  // 1. Päivä puuttuu, yksi tuote: apurin pitää kysyä päivä ensin ja näyttää vaihtoehdot vasta sen jälkeen.
  (v, k, s) => { const [a] = pick(k, v, 1); const day = DAYS[v % 5];
    return { route: 'date-missing-single', first: opener(s, item(a, s, val(a, v))), expected: expect([a], [val(a, v)]), date: day.iso, dateInFirst: false,
      brief: `Tarvitset ${needText(expect([a], [val(a, v)]))}. Et kerro päivää ensimmäisessä viestissä. Kun apuri kysyy päivää, vastaa: ${day.label}. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}`, maxTurns: 6 }; },
  // 2. "4" lisävaihtoehdoille: päivä annettu, ensimmäisiin vaihtoehtoihin vastataan pelkällä 4.
  (v, k, s) => { const [a] = pick(k, v + 1, 1); const day = DAYS[(v + 1) % 5];
    return { route: 'more-options-four', first: opener(s, `${item(a, s, val(a, v))} ${dayWord(day, s)}`), expected: expect([a], [val(a, v)]), date: day.iso, dateInFirst: true, wantsMore: true, requiresSelection: true,
      brief: `Tarvitset ${needText(expect([a], [val(a, v)]))} toimitukseen ${day.label}. Kun apuri näyttää ensimmäiset numeroidut vaihtoehdot, vastaa pelkällä "4" nähdäksesi lisää vaihtoehtoja samalle päivälle. Valitse sitten uusista vaihtoehdoista ensimmäinen sopiva numerolla. Jos apuri ei ymmärrä 4:ää, pyydä lisää vaihtoehtoja sanoin. ${NODIET} ${LINK}`, maxTurns: 7 }; },
  // 3. Valinta numerolla: ostaja valitsee nimenomaan vaihtoehdon 2.
  (v, k, s) => { const [a] = pick(k, v + 2, 1); const day = DAYS[(v + 2) % 5];
    return { route: 'pick-by-number', first: opener(s, `${item(a, s, val(a, v))} ${dayWord(day, s)}`), expected: expect([a], [val(a, v)]), date: day.iso, dateInFirst: true, pickNumber: 2, requiresSelection: true,
      brief: `Tarvitset ${needText(expect([a], [val(a, v)]))} toimitukseen ${day.label}. Kun apuri näyttää numeroidut vaihtoehdot, valitse vaihtoehto 2 kirjoittamalla pelkkä "2". ${NODIET} ${LINK}`, maxTurns: 6 }; },
  // 4. Päivä puuttuu, monta tuotetta määrineen.
  (v, k, s) => { const names = pick(k, v, 3); const values = names.map((n) => val(n, v)); const day = DAYS[(v + 3) % 5];
    return { route: 'date-missing-multi', first: opener(s, join(names.map((n, i) => item(n, s, values[i])))), expected: expect(names, values), date: day.iso, dateInFirst: false,
      brief: `Tarvitset ${needText(expect(names, values))}. Ensimmäisestä viestistä puuttuu toimituspäivä. Kun apuri kysyy päivää, vastaa: ${day.label}. ${NODIET} Valitse jokaiselle tuotteelle ensimmäinen sopiva vaihtoehto. ${LINK}`, maxTurns: 8, noIrrelevantDiet: allNeutral(names) }; },
  // 5. Annoslasku: määrä annetaan annoksina ja grammoina per annos.
  (v, k, s) => { const a = k.items.find((n) => ['peruna', 'porkkana', 'lohi', 'jauheliha', 'rintafilee', 'riisi', 'makaroni'].includes(n)) || 'peruna';
    const portions = [120, 80, 200, 150, 60][v]; const grams = [150, 125, 100, 120, 200][v]; const kg = (portions * grams) / 1000; const day = DAYS[v % 5];
    return { route: 'portions', first: opener(s, `${P[a].part} ${portions} annokselle, ${grams} g per annos, ${dayWord(day, s)}`), expected: expect([a], [kg]), date: day.iso, dateInFirst: true,
      brief: `Tarvitset ${P[a].part} ${portions} annokselle, ${grams} g annosta kohden, eli yhteensä ${fiNum(kg)} kg, toimitukseen ${day.label}. Jos apuri laskee määrän väärin, korjaa se ${fiNum(kg)} kiloon. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}`, maxTurns: 6, noIrrelevantDiet: P[a].neutral === true }; },
  // 6. Tuote, jota ei ole valikoimassa (haku palauttaa nolla osumaa) yhdessä oikean tuotteen kanssa.
  (v, k, s) => { const [a] = pick(k, v, 1);
    const missing = [{ stem: 'kaviaari', text: '1 kg kaviaaria' }, { stem: 'ananas', text: '3 kg ananasta' }, { stem: 'appelsiinituoremeh', text: '10 l appelsiinituoremehua' },
      { stem: 'kaviaari', text: '2 kg kaviaaria' }, { stem: 'ananas', text: '5 kg ananasta' }][v]; const day = DAYS[(v + 1) % 5];
    return { route: 'unavailable-zero', first: opener(s, `${item(a, s, val(a, v))} ja ${missing.text} ${dayWord(day, s)}`), expected: expect([a], [val(a, v)]), absent: [missing.stem], unavailable: missing.stem, date: day.iso, dateInFirst: true,
      brief: `Tarvitset ${needText(expect([a], [val(a, v)]))} ja ${missing.text} toimitukseen ${day.label}. Jos apuri kertoo, ettei tuotetta (${missing.text}) ole, älä hyväksy korvaavaa tuotetta: pyydä poistamaan se ja jatka muilla. ${NODIET} ${LINK}`, maxTurns: 7 }; },
  // 7. Ruokavaliolle neutraalit tuotteet: mitään ruokavaliokysymystä ei saa tulla.
  (v, k, s) => { const pool = k.items.filter((n) => P[n].neutral); const names = pool.length >= 2 ? [pool[v % pool.length], pool[(v + 1) % pool.length]] : ['kananmuna', 'peruna']; const values = names.map((n) => val(n, v + 1)); const day = DAYS[(v + 4) % 5];
    return { route: 'neutral-no-diet', first: opener(s, `${join(names.map((n, i) => item(n, s, values[i])))} ${dayWord(day, s)}`), expected: expect(names, values), date: day.iso, dateInFirst: true, noIrrelevantDiet: true,
      brief: `Tarvitset ${needText(expect(names, values))} toimitukseen ${day.label}. ${NODIET} Valitse jokaiselle ensimmäinen sopiva vaihtoehto. ${LINK}`, maxTurns: 6 }; },
  // 8. Todellinen ruokavaliovaatimus, joka pitää säilyttää.
  (v, k, s) => { const cases = [
    { name: 'kahvikerma', claim: 'FREE_FROM_LACTOSE', say: 'laktoositonta', why: 'Asiakkailla laktoosi-intoleranssi.' },
    { name: 'makaroni', claim: 'FREE_FROM_GLUTEN', say: 'gluteenitonta', why: 'Keliaakikkoja ruokailijoissa.' },
    { name: 'jaatelo', allergen: 'AM', say: 'maidotonta', why: 'Lapsella maitoallergia.' },
    { name: 'jogurtti', claim: 'FREE_FROM_LACTOSE', say: 'laktoositonta', why: 'Laktoositon ruokavalio.' },
    { name: 'makaroni', claim: 'FREE_FROM_GLUTEN', say: 'gluteenitonta', why: 'Keliakia.' },
  ][v]; const value = val(cases.name, v); const day = DAYS[(v + 2) % 5];
    return { route: 'real-diet', first: opener(s, `${amount(P[cases.name], value, s)} ${cases.say} ${P[cases.name].part.replace('maustamatonta ', '').replace('vanilja', 'vanilja')} ${dayWord(day, s)}`), expected: expect([cases.name], [value]), date: day.iso, dateInFirst: true,
      ...(cases.claim ? { requiredClaim: cases.claim } : {}), ...(cases.allergen ? { requiredAllergen: cases.allergen } : {}), dietStated: true,
      brief: `Tarvitset ${needText(expect([cases.name], [value]))}, ja tuotteen pitää olla ${cases.say}. ${cases.why} Toimitus ${day.label}. Älä hyväksy tuotetta, joka ei täytä vaatimusta. Valitse ensimmäinen vaatimuksen täyttävä vaihtoehto. ${LINK}`, maxTurns: 6 }; },
  // 9. Kärsimätön ostaja: kaikki tiedot heti, ei kyselyä.
  (v, k, s) => { const names = pick(k, v + 3, 2); const values = names.map((n) => val(n, v + 2)); const day = DAYS[v % 5];
    return { route: 'impatient', first: opener('impatient', `${join(names.map((n, i) => item(n, 'casual', values[i])))} ${day.slang}, tavalliset käy`), expected: expect(names, values), date: day.iso, dateInFirst: true, dietStated: true, impatient: true,
      brief: `Olet kärsimätön. Tarvitset ${needText(expect(names, values))} toimitukseen ${day.label}. Tavalliset tuotteet käyvät, kerroit sen jo. Valitse aina vaihtoehto 1 numerolla. Haluat korin mahdollisimman vähillä viesteillä. ${LINK}`, maxTurns: 6, styleOverride: 'impatient' }; },
  // 10. Epäselvä pyyntö: apurin pitää kysyä tuote, määrä ja päivä keksimättä niitä.
  (v, k, s) => { const names = pick(k, v + 1, 2); const values = names.map((n) => val(n, v + 3)); const day = DAYS[(v + 3) % 5];
    const firsts = ['moi, se tavallinen tilaus taas', 'sitä samaa ku viimeks', 'tarvis vähän kaikkee keittiöön', 'hei, voisitteko auttaa tilauksen kanssa', 'no niin, taas loppu tavarat'];
    return { route: 'vague', first: firsts[v], expected: expect(names, values), date: day.iso, dateInFirst: false,
      brief: `Aloitit epämääräisesti. Kun apuri kysyy, kerro että tarvitset ${needText(expect(names, values))} ja toimitus ${day.label}. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}`, maxTurns: 8 }; },
  // 11. Päivä ja määrät puuttuvat: apuri kysyy molemmat (päivä ensin).
  (v, k, s) => { const names = pick(k, v + 2, 2); const values = names.map((n) => val(n, v)); const day = DAYS[(v + 1) % 5];
    return { route: 'date-and-qty-missing', first: opener(s, join(names.map((n) => word(P[n], s)))), expected: expect(names, values), date: day.iso, dateInFirst: false,
      brief: `Ensimmäisestä viestistä puuttuvat määrät ja päivä. Kun apuri kysyy, kerro: ${needText(expect(names, values))}, toimitus ${day.label}. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}`, maxTurns: 8, noIrrelevantDiet: allNeutral(names) }; },
  // 12. Päivä vaihtuu kesken: koko tilaus siirretään toiselle päivälle.
  (v, k, s) => { const names = pick(k, v + 4, 2); const values = names.map((n) => val(n, v + 1)); const day = DAYS[v % 5]; const later = DAYS[(v + 2) % 5];
    return { route: 'date-change', first: opener(s, `${join(names.map((n, i) => item(n, s, values[i])))} ${dayWord(day, s)}`), expected: expect(names, values), date: later.iso, dateInFirst: true,
      brief: `Pyysit ensin toimitusta päivälle ${day.label}. Toisessa omassa viestissäsi vaihda koko tilaus päivälle ${later.label}; määrät ja tuotteet pysyvät samoina. Tarvitset ${needText(expect(names, values))}. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}`, maxTurns: 8, noIrrelevantDiet: allNeutral(names) }; },
  // 13. Suhteellinen päivä: "huomiseksi" = ma 16.11.
  (v, k, s) => { const [a] = pick(k, v + 3, 1);
    return { route: 'relative-date', first: opener(s, `${item(a, s, val(a, v + 2))} ${dayWord(TOMORROW, s)}`), expected: expect([a], [val(a, v + 2)]), date: TOMORROW.iso, dateInFirst: true,
      brief: `Tarvitset ${needText(expect([a], [val(a, v + 2)]))} toimitukseen ${TOMORROW.label}. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}`, maxTurns: 6, noIrrelevantDiet: P[a].neutral }; },
  // 14. Päivä puuttuu ja ostaja pyytää lisää vaihtoehtoja: päivä ensin, sitten 4 samalle päivälle.
  (v, k, s) => { const [a] = pick(k, v + 4, 1); const day = DAYS[(v + 4) % 5];
    return { route: 'date-missing-more-options', first: opener(s, item(a, s, val(a, v + 3))), expected: expect([a], [val(a, v + 3)]), date: day.iso, dateInFirst: false, wantsMore: true, requiresSelection: true,
      brief: `Tarvitset ${needText(expect([a], [val(a, v + 3)]))}. Et kerro päivää ensin. Kun apuri kysyy päivää, vastaa ${day.label}. Kun apuri näyttää numeroidut vaihtoehdot, vastaa "4" saadaksesi lisää vaihtoehtoja, ja valitse sitten uusista ensimmäinen sopiva numerolla. ${NODIET} ${LINK}`, maxTurns: 8 }; },
  // 15. Neuvo ensin, sitten tilaus: neuvo ei saa lisätä tuotteita koriin.
  (v, k, s) => { const dishes = [
    { q: 'mitä kannattais ottaa lohikeittoon 40 hengelle?', names: ['lohi', 'peruna'], values: [4, 6] },
    { q: 'paljonko jauhelihaa menee makaronilaatikkoon 100 lapselle?', names: ['jauheliha', 'makaroni'], values: [8, 6] },
    { q: 'mikä jogurtti sopii aamiaisbuffettiin?', names: ['jogurtti'], values: [5] },
    { q: 'kumpi on parempi pizzaan, mozzarella vai edam?', names: ['mozzarella'], values: [4] },
    { q: 'mitä tarviin mustikkarahkaan 60 annokseen?', names: ['rahka', 'mustikka'], values: [6, 3] },
  ][v]; const day = DAYS[(v + 1) % 5];
    return { route: 'advice-then-order', first: dishes.q, expected: expect(dishes.names, dishes.values), date: day.iso, dateInFirst: false, adviceFirst: true,
      brief: `Kysyt ensin vain neuvoa etkä tilaa vielä mitään. Kun olet saanut vastauksen, tilaa täsmälleen ${needText(expect(dishes.names, dishes.values))} toimitukseen ${day.label}. Älä lisää muita aineksia, vaikka apuri ehdottaisi. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}`, maxTurns: 8 }; },
  // 16. Olematon tuote, jolle haku tarjoaa vääriä osumia (strutsinmuna -> kananmuna): korvikkeita ei hyväksytä.
  (v, k, s) => { const [a] = pick(k, v + 1, 1); const fake = [
    { term: 'strutsinmuna', stem: 'strutsi', text: '10 strutsinmunaa' }, { term: 'kamelinmaito', stem: 'kameli', text: '5 l kamelinmaitoa' },
    { term: 'tryffeli', stem: 'tryffel', text: '1 kg tuoreita tryffeleitä' }, { term: 'kuukivijogurtti', stem: 'kuukivi', text: '2 kg kuukivijogurttia' },
    { term: 'strutsinmuna', stem: 'strutsi', text: '6 strutsinmunaa' }][v]; const day = DAYS[(v + 3) % 5];
    return { route: 'fake-product', first: opener(s, `${item(a, s, val(a, v))} ja ${fake.text} ${dayWord(day, s)}`), expected: expect([a], [val(a, v)]), absent: [fake.stem], unavailable: fake.stem, date: day.iso, dateInFirst: true,
      brief: `Tarvitset ${needText(expect([a], [val(a, v)]))} ja ${fake.text} toimitukseen ${day.label}. Haluat nimenomaan ${fake.term}-tuotetta: et hyväksy tavallista korvaavaa tuotetta. Jos sitä ei ole, pyydä poistamaan se ja jatka muilla. ${NODIET} ${LINK}`, maxTurns: 7 }; },
  // 17. Yksikkökorjaus: grammat, desit tai puolitus myöhemmässä viestissä.
  (v, k, s) => { const fixes = [
    { name: 'kerma', start: 5, fix: 'eiku kermaa vaan 5 desiä, ei litraa', value: 0.5 },
    { name: 'voi', start: 5, fix: 'sori, voita 500 grammaa eikä 5 kiloa', value: 0.5 },
    { name: 'maito', start: 40, fix: 'puolitetaan maito, eli 20 litraa', value: 20 },
    { name: 'hiiva', start: 2, fix: 'hiivaa riittää 250 g', value: 0.25 },
    { name: 'kahvikerma', start: 10, fix: 'kahvikermaa vaan 3 litraa', value: 3 }][v]; const day = DAYS[(v + 2) % 5];
    return { route: 'unit-correction', first: opener(s, `${item(fixes.name, s, fixes.start)} ${dayWord(day, s)}`), expected: expect([fixes.name], [fixes.value]), date: day.iso, dateInFirst: true,
      brief: `Pyysit ensin ${fiNum(fixes.start)} ${unitFi[P[fixes.name].unit]} ${P[fixes.name].part}. Toisessa omassa viestissäsi korjaa: "${fixes.fix}". Lopullinen tarve on ${fiNum(fixes.value)} ${unitFi[P[fixes.name].unit]}, toimitus ${day.label}. Tarve ja myyntipakkaus ovat eri asia: hyväksy pakkaus, joka kattaa tarpeen. ${NODIET} ${LINK}`, maxTurns: 7 }; },
  // 18. Poisto ja lisäys eri viesteissä.
  (v, k, s) => { const [a, b, c] = pick(k, v, 3); const values = [val(a, v), val(b, v), val(c, v + 1)]; const day = DAYS[(v + 4) % 5];
    return { route: 'remove-and-add', first: opener(s, `${join([item(a, s, values[0]), item(b, s, values[1])])} ${dayWord(day, s)}`), expected: expect([a, c], [values[0], values[2]]), absent: [P[b].key], date: day.iso, dateInFirst: true,
      brief: `Pyysit ensin ${needText(expect([a, b], [values[0], values[1]]))} toimitukseen ${day.label}. Toisessa omassa viestissäsi poista ${b === 'vehnajauho' ? 'vehnäjauho' : b} kokonaan ja lisää ${needText(expect([c], [values[2]]))}. Lopulliseen koriin jää vain ${needText(expect([a, c], [values[0], values[2]]))}. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}`, maxTurns: 8 }; },
  // 19. Monta tuotetta kerralla kirjoitusvirheillä.
  (v, k, s) => { const names = pick(k, v, 4); const values = names.map((n) => val(n, v + 4)); const day = DAYS[(v + 1) % 5];
    return { route: 'many-items-typos', first: `${join(names.map((n, i) => item(n, 'typos', values[i])))} ${day.slang}`, expected: expect(names, values), date: day.iso, dateInFirst: true,
      brief: `Tarvitset ${needText(expect(names, values))} toimitukseen ${day.label}. Kirjoitat nopeasti ja kirjoitusvirheillä. ${NODIET} Valitse jokaiselle ensimmäinen sopiva vaihtoehto (esim. "1 1 1 1"). ${LINK}`, maxTurns: 8, noIrrelevantDiet: allNeutral(names), styleOverride: 'typos' }; },
  // 20. Maitotuote ja "tavallinen käy" jo ensimmäisessä viestissä: ruokavaliota ei saa kysyä uudelleen.
  (v, k, s) => { const dairy = ['maito', 'kerma', 'jogurtti', 'rahka', 'voi'][v]; const value = val(dairy, v + 1); const day = DAYS[(v + 3) % 5];
    return { route: 'dairy-normal-stated', first: opener(s, `${item(dairy, s, value)} ${dayWord(day, s)}, ihan tavallista, ei tarvi olla laktoositonta`), expected: expect([dairy], [value]), date: day.iso, dateInFirst: true, dietStated: true,
      brief: `Tarvitset ${needText(expect([dairy], [value]))} toimitukseen ${day.label}. Kerroit jo, että tavallinen käy eikä tarvitse olla laktoositonta. Jos apuri kysyy sitä uudelleen, huomauta että kerroit jo. Valitse ensimmäinen sopiva vaihtoehto. ${LINK}`, maxTurns: 6 }; },
];

export const PERSONAS = Array.from({ length: 5 }, (_, v) => JOURNEYS.map((make, j) => {
  const kitchen = KITCHENS[(v * 4 + j) % KITCHENS.length];
  const style = STYLES[(v + j) % STYLES.length];
  const goal = make(v, kitchen, style.id);
  const used = STYLES.find((x) => x.id === (goal.styleOverride || style.id));
  const { styleOverride, ...rest } = goal;
  return { id: `S${String(v * JOURNEYS.length + j + 1).padStart(3, '0')}`, kitchen: kitchen.name, style: used.id, variant: v, ...rest,
    brief: `Olet ostaja, keittiötyyppi: ${kitchen.name}. ${used.brief} ${goal.brief} Älä muuta tavoitetta apurin virheen takia: korjaa virhe.` };
})).flat();

// Rakennuspalat muille persoonatiedostoille (eval/whatsapp-personas-extended.mjs). Samat tuotetermit ja avaimet.
export const PERSONA_KIT = { P, DAYS, TOMORROW, STYLES, KITCHENS, LINK, NODIET, fiNum, unitFi, amount, word, item, join, needText, expect, pick, val };

// Regressiosarja 100 persoonan baseline-ajon (15.11.2026) löydöksistä. Erillään PERSONAS-sarjasta, jotta 100 persoonan
// ajot pysyvät vertailukelpoisina. Ajo: scripts/whatsapp-selfplay-batch.mjs --set regressions.
// selected: valitun tuotteen nimen pitää sisältää must ja ei saa sisältää not; regularOffered: tavallinen käy, joten
// ensimmäisessä vaihtoehtolistassa pitää olla muukin kuin laktoositon; needCover: vaihtoehdon pitää kattaa tarve.
const R = (id, o) => ({ id, kitchen: o.kitchen, style: o.style || 'casual', variant: 0, maxTurns: 7, dateInFirst: true, requiresSelection: true,
  brief: `Olet ostaja, keittiötyyppi: ${o.kitchen}. ${STYLES.find((x) => x.id === (o.style || 'casual')).brief} ${o.brief} ${LINK} Älä muuta tavoitetta apurin virheen takia: korjaa virhe.`, ...o });
export const REGRESSIONS = [
  R('R01', { route: 'regression-edam-hyphen', kitchen: 'food truck', first: 'moi, 2 kg edam-juustoa torstaiks, tavallinen käy',
    expected: expect(['edam'], [2]), date: '2026-11-19', dietStated: true, selected: { edam: { must: ['edam'] } },
    brief: 'Tarvitset nimenomaan edam-juustoa 2 kg toimitukseen torstai 19.11.2026. Tavallinen käy. Älä hyväksy saganakia, halloumia tai salaattijuustoa. Valitse ensimmäinen edam-vaihtoehto numerolla.' }),
  R('R02', { route: 'regression-dairy-free-vanilla', kitchen: 'päiväkoti', first: '5 l maidotonta vaniljajäätelöä perjantaiks, lapsella maitoallergia',
    expected: expect(['jaatelo'], [5]), date: '2026-11-20', requiredAllergen: 'AM', selected: { 'jäätelö': { must: ['vanilja'] } },
    brief: 'Tarvitset 5 l maidotonta vaniljajäätelöä toimitukseen perjantai 20.11.2026; vegaaninen käy. Lapsella maitoallergia, joten tavallinen tai laktoositon ei käy. Valitse ensimmäinen maidoton vaniljavaihtoehto numerolla.' }),
  R('R03', { route: 'regression-pizzeria-types', kitchen: 'pizzeria', first: 'moi, 3 kg keltasipulia ja 5 kg mozzarellaa tiistaiks, tavalliset käy',
    expected: expect(['sipuli', 'mozzarella'], [3, 5]), date: '2026-11-17', dietStated: true, needCover: true,
    selected: { sipuli: { must: ['sipuli'], not: ['puna', 'marinoi', 'nippu', 'valko'] }, mozzarella: { must: ['mozzarella'], not: ['rengas', 'sipuli'] } },
    brief: 'Tarvitset 3 kg tavallista keltasipulia ja 5 kg mozzarellajuustoa toimitukseen tiistai 17.11.2026. Tavalliset käyvät. Älä hyväksy punasipulia, nippusipulia, marinoitua sipulia tai mozzarella-sipulirenkaita. Valitse sopivat vaihtoehdot numeroilla.' }),
  R('R04', { route: 'regression-more-options', kitchen: 'lounasravintola', first: 'moi, 5 l ruokakermaa keskiviikoks', wantsMore: true,
    expected: expect(['kerma'], [5]), date: '2026-11-18',
    brief: 'Tarvitset 5 l ruokakermaa toimitukseen keskiviikko 18.11.2026. Kun apuri näyttää numeroidut vaihtoehdot, vastaa pelkällä "4" nähdäksesi lisää vaihtoehtoja samalle päivälle. Valitse sitten uusista ensimmäinen sopiva numerolla. Ei ruokavaliorajoitteita.' }),
  R('R05', { route: 'regression-regular-milk', kitchen: 'kouluruokala', first: '30 l maitoa torstaiks, ihan tavallista, ei tarvi olla laktoositonta',
    expected: expect(['maito'], [30]), date: '2026-11-19', dietStated: true, regularOffered: ['maito'],
    brief: 'Tarvitset 30 l tavallista maitoa toimitukseen torstai 19.11.2026. Kerroit jo, ettei tarvitse olla laktoositonta. Valitse ensimmäinen tavallinen (ei laktoositon) vaihtoehto numerolla.' }),
  R('R06', { route: 'regression-fake-ostrich', kitchen: 'hotellin aamiaiskeittiö', first: '60 kananmunaa ja 6 strutsinmunaa maanantaiks',
    expected: expect(['kananmuna'], [60]), date: '2026-11-16', noIrrelevantDiet: true, unavailable: 'strutsi', absent: ['strutsi'], requiresSelection: false,
    brief: 'Tarvitset 60 kananmunaa ja 6 strutsinmunaa toimitukseen maanantai 16.11.2026. Et hyväksy kananmunia tai viiriäisenmunia strutsinmunan tilalle: jos strutsinmunaa ei ole, pyydä poistamaan se. Ei ruokavaliorajoitteita.' }),
];

// ---------------------------------------------------------------------------------------------------------------
// Tarkistukset. Erillään Codexin inspectConversation-funktiosta (eval/whatsapp-selfplay-cases.mjs), jota ei muuteta.
// newRequirement (a–c) kuvaa uutta vaatimusta (toimituspäivä ensin, 1–3 numeroitua vaihtoehtoa määrin ja hinnoin,
// 4 = lisää vaihtoehtoja). Ne voivat epäonnistua, kunnes date-first-options-sessio valmistuu, joten ne raportoidaan
// erikseen perusvaatimuksista (d–f).

const PRICE = /\d[\d\s]*[,.]\d{2}\s?€|€\s?\d/u;
const QTY = /\b\d+(?:[,.]\d+)?\s?(?:kpl|pkt|ltk|kg|g|l|dl|ml|ras|prk|pss|sk|pl|krt|kan|kää|nippu|lava|pakkaus\w*|laatik\w*|rasia\w*|purk\w*|pussi\w*)\b|\b\d+\s?x\s/iu;
const OPTION = /^\s*[*_]*\s*(\d{1,2})\s*[.)]\s*[*_]*\s*(.+)$/u;
const DATE_ASK = /(mille päivälle|mihin päivään|minä päivänä|mille päivä|toimituspäiv|milloin (?:toimit|tarvit|halua|tuo)|koska (?:toimit|tarvit|halua)|mikä päivä)/iu;
const DIET_ASK = /(laktoos|gluteen|maidoton|maidottom|allergi|ruokavalio|vegaan|keliak)/iu;
const ORDER_CLAIM = /(?<!ei\s)(?<!ole\s)\btilaus (?:on )?(?:nyt )?(?:tehty|vahvistettu|lähetetty|vastaanotettu)\b|tilausnumero|\bAGW-\d/iu;
const UNAVAILABLE_SAY = /(tarkkaa osumaa ei|ei (?:löydy|löytynyt|näkynyt|ole saatavilla|ole valikoimassa|ole tilattav|tilattavaa)|en löytänyt|ei valikoimassa|ei saatavilla|ei ole tarjolla|puuttuu valikoimasta)/iu;

const lower = (s) => String(s || '').toLowerCase();
// Merkintä, joka kattaa allergeenin poissulun (gluteeniton = ei gluteeniviljoja). Laktoositon ei ole maidoton.
const ALLERGEN_CLAIM = { AW: 'FREE_FROM_GLUTEN' };
const matchesKey = (term, key, q) => [key, ...(q?.aliases || [])].some((k) => lower(term).includes(lower(k))) && !(q?.not || []).some((n) => lower(term).includes(n));

/** Numeroidut vaihtoehdot vastauksesta. Tilausyhteenveto (Yhteensä) ei ole vaihtoehtolista. */
export function parseOptions(text) {
  // Tilausluonnos (otsikko tai rahasumman "Yhteensä 150,50 €" -rivi) ei ole vaihtoehtolista. Vaihtoehtorivin "yhteensä 5 l" ei saa osua tähän.
  if (/tilausluonnos|^\s*yhteensä\s+\d[\d\s]*[,.]\d{2}\s?€/imu.test(text)) return [];
  const blocks = []; let current = null; let heading = '';
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(OPTION);
    if (m && PRICE.test(raw)) {
      const number = Number(m[1]);
      if (!current || number <= current.at(-1).number) { current = []; current.heading = heading; blocks.push(current); }
      const body = m[2].replace(/[*_]/gu, '');
      // Vanha muoto "Nimi: 5 pkt (10 kg), 47,20 €", uusi "Nimi, 4 laatikkoa (20 l), 110,60 €": nimi päättyy määrään.
      const name = body.split(/:\s|\s[\u2013-]\s|,\s(?=\d+(?:[,.]\d+)?\s?[\p{L}]+(?:\s\(|\s\u00e0\s|,|\s*$))/u)[0].trim();
      const rest = body.slice(name.length).replace(PRICE, '');
      current.push({ number, name, hasPrice: true, hasQuantity: QTY.test(rest) || QTY.test(name), line: raw.trim() });
    } else if (raw.trim()) { heading = raw.replace(/[*_]/gu, '').trim(); current = null; }
  }
  return blocks;
}

const questionsOf = (text) => String(text || '').split(/(?<=[?])\s+|\n/u).filter((s) => s.includes('?'));

/**
 * @returns {{ failures: string[], newRequirement: string[], observations: string[], metrics: object }}
 *  failures: perusvaatimukset d–f (korin sisältö, turhat kysymykset, ei tilauksia, ei korvikkeita)
 *  newRequirement: a–c (päivä ensin, numeroidut vaihtoehdot, 4 = lisää vaihtoehtoja)
 *  observations: deterministiset lisähavainnot, jotka eivät kaada persoonaa (sanamuoto, tuotehaun kattavuus)
 */
export function inspectPersona(persona, turns, list) {
  const failures = []; const fresh = []; const seen = []; const metrics = { turns: turns.length, optionReplies: 0, optionBlocks: 0, moreRequests: 0, allSelected: false, linkTurn: null };
  const replies = turns.map((t) => String(t.assistant || ''));

  // (a) Toimituspäivä ensin: jos päivä puuttui, ensimmäinen vastaus kysyy sitä eikä vaihtoehtoja näytetä ennen päivää.
  // Neuvoa kysyvä ei vielä tilaa: päivää ei tarvitse kysyä ennen kuin tilattavaa on.
  if (!persona.dateInFirst && !persona.adviceFirst && !persona.noOrderFirst && turns.length) {
    const firstQs = questionsOf(replies[0]);
    if (!firstQs.some((q) => DATE_ASK.test(q)) && !DATE_ASK.test(replies[0])) fresh.push('date_not_asked_first');
    else if (firstQs.length && !DATE_ASK.test(firstQs[0])) fresh.push('date_not_first_question');
  }
  turns.forEach((t, i) => {
    if (!t.list?.deliveryDate && parseOptions(replies[i]).length) fresh.push('options_before_date');
  });

  // (b) Vaihtoehdot numeroitu 1, 2, 3, jokaisella määrä ja hinta, ja 4 tarjotaan lisävaihtoehdoille.
  let previous = null;
  turns.forEach((t, i) => {
    const blocks = parseOptions(replies[i]);
    if (blocks.length) {
      metrics.optionReplies += 1; metrics.optionBlocks += blocks.length;
      for (const b of blocks) {
        if (b.some((o, n) => o.number !== n + 1)) fresh.push('options_bad_numbering');
        if (b.length > 3) fresh.push('options_more_than_3');
        if (b.some((o) => !o.hasPrice)) fresh.push('options_missing_price');
        if (b.some((o) => !o.hasQuantity)) fresh.push('options_missing_quantity');
      }
      // "4) Näytä lisää" näytetään vain, kun lisää vaihtoehtoja on (ydin: moreNo). Sitä ei voi todentaa transkriptista,
      // joten puuttuva vihje ei ole virhe. Mittari kertoo, kuinka usein vihje näkyi.
      if (/(\b4\b|neljä)[^\n]{0,60}(lisää|muita|enemmän)|(lisää|muita|enemmän) vaihtoeh[^\n]{0,60}\b4\b/iu.test(replies[i])) metrics.moreHints = (metrics.moreHints || 0) + 1;
    }
    // (c) "4" tuo uudet, aiemmista eroavat vaihtoehdot eikä valitse neljättä tai muuta määrää neljäksi.
    if (/^\s*(4|nelonen|neljä)\s*[.!]?\s*$/iu.test(t.user) || /^(näytä )?(lisää|muita) vaihtoehtoja/iu.test(t.user.trim())) {
      metrics.moreRequests += 1;
      if (!previous) fresh.push('more_requested_before_options');
      else if (!blocks.length) fresh.push('more_options_not_shown');
      else {
        const seen = new Set(previous.flat().map((o) => lower(o.name)));
        // "Muita vaihtoehtoja ei löytynyt" ja sama lista on oikein, kun lisää ei ole.
        if (!blocks.flat().some((o) => !seen.has(lower(o.name))) && !/(muita|lisää) vaihtoeh[^\n]{0,40}ei (löytyn|ole)|ei (löytynyt|ole) (muita|lisää)/iu.test(replies[i])) fresh.push('more_options_same');
      }
      const before = i ? turns[i - 1].list : null;
      for (const line of t.list?.lines || []) {
        const old = before?.lines?.find((l) => l.ref === line.ref);
        if (line.quantity?.value === 4 && old?.quantity?.value !== 4) fresh.push('four_read_as_quantity');
        if (line.selectedProductId && !old?.selectedProductId) fresh.push('four_read_as_selection');
      }
    }
    if (blocks.length) previous = blocks;
  });
  if (persona.wantsMore && !metrics.moreRequests) fresh.push('more_never_requested');
  // Valinta ilman listaa kelpaa, jos ostaja pyysi suoraan esim. halvinta: virhe vain, jos tuote jää valitsematta.
  if (persona.requiresSelection && !metrics.optionReplies && !(list?.lines || []).every((l) => l.selectedProductId)) failures.push('options_never_shown');

  // (d) Ei turhia ruokavaliokysymyksiä.
  const dietQuestions = replies.flatMap((r) => questionsOf(r).filter((q) => DIET_ASK.test(q)));
  if (persona.noIrrelevantDiet && dietQuestions.length) failures.push('diet_question_irrelevant');
  else if (persona.dietStated && dietQuestions.length) failures.push('diet_question_after_stated');
  metrics.dietQuestions = dietQuestions.length;

  // (e) Lopullisen korin rivit, määrät, ruokavaatimukset ja päivä. Perutulla tai pelkällä kysymyksellä kori jää tyhjäksi.
  const lines = list?.lines || [];
  if (persona.expectEmpty && lines.length) failures.push(persona.route === 'cancel' ? 'cancel_not_applied' : 'question_added_item');
  for (const [key, want] of Object.entries(persona.expected)) {
    const found = lines.filter((l) => matchesKey(l.productTerm, key, want));
    if (!found.length) { failures.push(`missing:${key}`); continue; }
    if (found.length > 1) failures.push(`duplicate:${key}`);
    const line = found[0];
    if (!(Math.abs((line.quantity?.value ?? NaN) - want.value) < 1e-9) || line.quantity?.unit !== want.unit) failures.push(`quantity:${key}`);
    const claims = [...(line.claims || []), ...(list.diet?.claims || [])];
    const banned = [...(line.excludeAllergens || []), ...(list.diet?.excludeAllergens || [])];
    if (persona.requiredClaim && !claims.includes(persona.requiredClaim)) failures.push(`claim:${key}`);
    if (persona.requiredAllergen && !banned.includes(persona.requiredAllergen) && !claims.includes(ALLERGEN_CLAIM[persona.requiredAllergen])) failures.push(`allergen:${key}`);
    if (persona.requiresSelection && !line.selectedProductId) failures.push(`unselected:${key}`);
  }
  for (const line of lines) if (!Object.entries(persona.expected).some(([key, want]) => matchesKey(line.productTerm, key, want))) failures.push(`unexpected:${line.productTerm}`);
  for (const term of persona.absent || []) if (lines.some((l) => lower(l.productTerm).includes(lower(term)))) failures.push(`unremoved:${term}`);
  if (!persona.expectEmpty && list?.deliveryDate !== persona.date) failures.push('delivery_date');
  metrics.allSelected = lines.length > 0 && lines.every((l) => l.selectedProductId);
  metrics.linkTurn = replies.findIndex((r) => r.includes('[ostoskorilinkki]')) + 1 || null;
  if (!metrics.linkTurn && !persona.expectEmpty) failures.push('cart_link_missing');
  if (persona.adviceFirst && turns[0]?.list?.lines?.length) failures.push('advice_added_item');

  // Lisähavainnot: kori väitetään päivitetyksi ennen tuotevalintaa; vaihtoehto ei kata tarvetta tarpeen yksikössä.
  turns.forEach((t, i) => {
    // "Ostoskorissasi nyt:" on käyttäjän valitsema listamuoto (päätetty 14.11.), joten vain päivitys-/lisäysväite lasketaan.
    if (/päivitin (ostos)?korin|lisäsin (sen |ne )?koriin/iu.test(replies[i]) && (t.list?.lines || []).some((l) => !l.selectedProductId)) seen.push('cart_claim_before_selection');
    for (const block of parseOptions(replies[i])) {
      const need = block.heading.match(/(\d+(?:[,.]\d+)?)\s?(kg|l|kpl)\b/iu);
      if (need && need[2].toLowerCase() !== 'kpl' && block.some((o) => !new RegExp(`\\(\\s*\\d+(?:[,.]\\d+)?\\s?${need[2]}\\b`, 'iu').test(o.line))) seen.push('option_without_need_cover');
    }
  });

  // Regressiot: valitun tuotteen tyyppi, tavallisen tuotteen tarjoaminen ja tarpeen kattavuus.
  for (const [key, rule] of Object.entries(persona.selected || {})) {
    const name = lower(lines.find((l) => matchesKey(l.productTerm, key, persona.expected[key]))?.selectedName || lines.find((l) => matchesKey(l.productTerm, key, persona.expected[key]))?.selectedProductId || '');
    if (name && (!rule.must.some((m) => name.includes(m)) || (rule.not || []).some((n) => name.includes(n)))) failures.push(`wrong_product:${key}`);
  }
  for (const key of persona.regularOffered || []) {
    const block = replies.flatMap((r) => parseOptions(r)).find((b) => lower(b.heading).includes(key));
    if (block && block.every((o) => /laktoosit/iu.test(o.name))) failures.push(`only_lactose_free_offered:${key}`);
  }
  if (persona.needCover && seen.includes('option_without_need_cover')) failures.push('option_without_need_cover');

  // Olematon tuote: selitys ja ei vääriä korvikkeita samalla rivillä.
  if (persona.unavailable) {
    if (!replies.some((r) => UNAVAILABLE_SAY.test(r))) failures.push('unavailable_not_explained');
    // Avoimesti merkitty lähin osuma ("Tarkkaa osumaa ei löytynyt … Lähimmät …") ei ole hiljainen korvike.
    for (const reply of replies) for (const block of parseOptions(reply)) {
      if (lower(block.heading).includes(lower(persona.unavailable)) && !block.some((o) => lower(o.name).includes(lower(persona.unavailable)))
        && !/tarkkaa osumaa ei|lähimmät|korvaav/iu.test(reply)) failures.push('unrelated_substitute_offered');
    }
  }

  // Laajennettu joukko (eval/whatsapp-personas-extended.mjs): päivien ristiriita, kiire, faktat, botti, ihminen, tervehdys.
  const sentences = replies.flatMap((r) => r.split(/(?<=[.!?])\s+|\n/u)).filter((x) => x.trim());
  const NEG = /(?<![\p{L}])(ei|en|emme|eikä)(?![\p{L}])|ole tietoa|tiedä|pysty|voi luvata|varmist/iu;
  const claimed = (re) => sentences.some((x) => re.test(x) && !NEG.test(x));
  if (persona.dateConflict && !replies.some((r) => questionsOf(r).some((q) => /(maanantai|keskiviikko|18\.11|päiv)/iu.test(q)))) failures.push('date_conflict_not_asked');
  if (persona.wrongAnswerTurn && turns[persona.wrongAnswerTurn - 1]?.list?.deliveryDate) failures.push('date_invented');
  if (persona.rush) {
    // Kellonaika: "klo 12" tai "12.00", ei päivämäärä "16.11.".
    const deadline = /(viimeistään|tilausaika|tilattava|mennessä|ehti|ehdi|umpeut|takaraja)[^\n]{0,80}(klo\s?\d|\b\d{1,2}[.:][0-5]\d\b(?!\.))|(klo\s?\d{1,2}(?:[.:]\d{2})?)[^\n]{0,40}(mennessä|asti|viimeistään)/iu;
    if (!replies.some((r) => deadline.test(r))) failures.push('rush_no_deadline');
    const [, m, d] = persona.date.split('-').map(Number);
    if (!replies.some((r) => new RegExp(`\\b${d}\\.\\s?${m}\\.`, 'u').test(r) || /(aikaisin|aikaisintaan|ensimmäinen mahdollinen|nopein|seuraava mahdollinen|varhaisin)/iu.test(r))) failures.push('rush_no_earliest_day');
    if (persona.rush === 'before7' && claimed(/(toimit|tuodaan|perillä|saapuu|ehtii)[^.\n]{0,50}(klo\s?[0-7]\b|seitsem|aamu(lla|ksi))/iu)) failures.push('delivery_time_promised');
  }
  const SUPPORT = /(asiakaspalvelu|asiakastu|\btuki\b|tuesta|tukeen|ylläpi|myyjä|yhteyshenkilö|ihmi|yhteyttä)/iu;
  const UNKNOWN = /(en tiedä|ei ole tietoa|en pysty|en näe|tietoa ei|ei tietoa|en osaa sanoa|en voi luvata|ei ole tiedossa|en löydä tietoa)/iu;
  const INVENTED = {
    fee: /(toimitus\w*|rahti\w*)[^.\n]{0,60}(\d+[,.]?\d*\s?(€|euro)|ilmai|maksuton)/iu,
    hours: /(auki|aukiolo|palvelemme|päivystä|tavoitettavissa|paikalla)[^.\n]{0,60}(\d{1,2}[.:]\d{2}|klo\s?\d|\d{1,2}\s?[-–]\s?\d{1,2}|arkisin|ma\s?[-–]\s?pe)/iu,
    payment: /(maksaa|maksu|maksutav|käy)[^.\n]{0,80}(kortilla|korttimaksu|mobilepay|käteis|verkkopankki|visa|mastercard|klarna|osamaks|laskulla)/iu,
    // Myönteinen väite (ei pelkkä aiheen mainitseminen ohjauksessa tukeen).
    invoice: /(maksuaika on|eräpäivä on|laskutetaan kuukausittain|saat kuukausilasku|kuukausilasku onnistuu|kuukausilaskutus on mahdollinen)|(lasku|maksuaika|eräpäiv)[^.\n]{0,60}\d+\s?(päivä|pv|vrk|vuorokau)/iu,
    complaint: /(hyvitä|hyvitys|hyvityksen|korvaamme|palautamme rahat|lähetämme uudet|veloituksetta)/iu,
  };
  if (INVENTED[persona.factQuestion] && claimed(INVENTED[persona.factQuestion])) failures.push(`fact_invented:${persona.factQuestion}`);
  if (['fee', 'hours', 'payment', 'invoice', 'complaint', 'human'].includes(persona.factQuestion) && !replies.some((r) => SUPPORT.test(r) || (persona.factQuestion !== 'human' && UNKNOWN.test(r)))) failures.push(`not_referred:${persona.factQuestion}`);
  if (persona.factQuestion === 'bot') {
    if (!replies.some((r) => /(botti|tekoäly|automaatt|digitaalinen (apuri|avustaja)|virtuaali|en ole ihminen|ohjelma|\bAI\b|tilausapuri)/iu.test(r))) failures.push('bot_not_disclosed');
    if (claimed(/\b(olen|oon) (oikea )?ihminen\b/iu)) failures.push('claims_human');
  }
  if (persona.guessFromNoise && turns[0]?.list?.lines?.length) seen.push('noise_interpreted');
  if (persona.greetingWrong && turns.length && new RegExp(persona.greetingWrong, 'iu').test(replies[0].split('\n')[0])) fresh.push('greeting_wrong_time');
  metrics.timeGreeting = turns.length ? /huomenta|päivää|iltaa|yötä/iu.test(replies[0].split('\n')[0]) : false;
  // Pelkkään tervehdykseen vastataan kellonajan mukaisella tervehdyksellä (date-first-options toteuttaa tätä).
  // Yöllä neutraali "Moi!" on oikein: "hyvää yötä" on hyvästely, ei tervehdys.
  const neutralNight = persona.slot === 'night' && turns.length && /^\W*(moi|hei|terve|moro)\b/iu.test(replies[0]);
  if (persona.greetingCheck && turns.length && !metrics.timeGreeting && !neutralNight) fresh.push('greeting_not_time_aware');

  // Käyttäjän päätös 15.11. klo 2.00: korilinkki vasta valmiille tilaukselle. Apuri opastaa ensin loppuun: päivä, määrät,
  // tuotevalinnat ja vaaditut ruokavaliot tai allergeenit. Uusi vaatimus, koska aiempi päätös salli linkin keskeneräiseen listaan.
  turns.forEach((t, i) => {
    if (!replies[i].includes('[ostoskorilinkki]') || persona.expectEmpty) return;
    const l = t.list || {}; const rows = l.lines || [];
    const incomplete = !l.deliveryDate || !rows.length || (l.missing || []).length || (l.status && l.status !== 'review')
      || rows.some((r) => !r.quantity || !r.selectedProductId);
    const claimsOk = !persona.requiredClaim || rows.every((r) => [...(r.claims || []), ...(l.diet?.claims || [])].includes(persona.requiredClaim));
    const allergenOk = !persona.requiredAllergen || rows.every((r) => [...(r.excludeAllergens || []), ...(l.diet?.excludeAllergens || [])].includes(persona.requiredAllergen)
      || [...(r.claims || []), ...(l.diet?.claims || [])].includes(ALLERGEN_CLAIM[persona.requiredAllergen]));
    if (incomplete || !claimsOk || !allergenOk) fresh.push('link_before_complete');
  });

  // (f) Ei tilauksia: apuri ei väitä tilausta tehdyksi (tilauskanta tarkistetaan ajurissa erikseen).
  if (replies.some((r) => ORDER_CLAIM.test(r))) failures.push('order_claimed');
  return { failures: [...new Set(failures)], newRequirement: [...new Set(fresh)], observations: [...new Set(seen)], metrics };
}
