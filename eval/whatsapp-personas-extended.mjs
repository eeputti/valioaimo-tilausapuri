// Laajennettu persoonajoukko X001–X100 (käyttäjän lisäpyyntö 15.11.2026 klo 1.25): pahoja virheitä tekevät, murteet ja
// kielimuodot, oudot viestit, kiireiset, palvelukysymykset ja tervehdykset. Jokaisella persoonalla on oma demokello
// (now), koska tervehdyksen pitää vastata kellonaikaa ja tilausaika riippuu siitä. Ajuri lataa kellon persoonan ajalla
// ennen runSelfplayta (scripts/whatsapp-selfplay-batch.mjs). Väärinkäyttötapaukset (prompt injection ym.) ovat erillisen
// abuse-tests-session tiedostossa eval/whatsapp-abuse-cases.mjs, eivät täällä.
// Tarkistukset: eval/whatsapp-personas.mjs inspectPersona (samat kentät + rush, factQuestion, expectEmpty, dateConflict).
// Simuloitu haku 15.11.2026: maanantain 16.11. tilausaika umpeutuu su klo 12.00, sen jälkeen aikaisin päivä on ti 17.11.
// Siksi tavalliset persoonat pyytävät ti–pe, ja vain kiirepolut koettelevat maanantaita ja tilausajan umpeutumista.
import { PERSONA_KIT } from './whatsapp-personas.mjs';

const { P, DAYS, STYLES, KITCHENS, LINK, NODIET, fiNum, unitFi, amount, item, join, needText, expect, pick, val } = PERSONA_KIT;

export const SLOTS = {
  night: { now: '2026-11-15T02:30:00+02:00', label: 'yö (su klo 2.30)', hour: 2.5, wrong: /huomenta|hyvää päivää/iu },
  morning: { now: '2026-11-15T07:30:00+02:00', label: 'aamu (su klo 7.30)', hour: 7.5, wrong: /iltaa|yötä/iu },
  day: { now: '2026-11-15T14:00:00+02:00', label: 'päivä (su klo 14.00)', hour: 14, wrong: /huomenta|iltaa|yötä/iu },
  evening: { now: '2026-11-15T19:30:00+02:00', label: 'ilta (su klo 19.30)', hour: 19.5, wrong: /huomenta|hyvää päivää|yötä/iu },
};
const SLOT_ORDER = ['morning', 'day', 'evening', 'night'];
/** Aikaisin toimitus simuloidussa haussa: maanantai vain ennen su klo 12.00. */
export const earliestDate = (slot) => (SLOTS[slot].hour < 12 ? '2026-11-16' : '2026-11-17');
const LATER = DAYS.slice(1); // ti–pe: aina tilattavissa
const dayFor = (i) => LATER[i % LATER.length];

// Kielimuodot: ensimmäinen viesti generoidaan, asiakasmalli jatkaa samalla kielimuodolla (brief).
const EN = { maito: 'milk', voi: 'butter', kananmuna: 'eggs', peruna: 'potatoes', kerma: 'cooking cream', sokeri: 'sugar', porkkana: 'carrots', sipuli: 'onions', jauheliha: 'minced meat', riisi: 'rice' };
const SV = { maito: 'mjölk', voi: 'smör', kananmuna: 'ägg', peruna: 'potatis', kerma: 'matlagningsgrädde', sokeri: 'socker', porkkana: 'morötter', sipuli: 'lök', jauheliha: 'köttfärs', riisi: 'ris' };
const DAY_EN = { '2026-11-17': 'Tuesday', '2026-11-18': 'Wednesday', '2026-11-19': 'Thursday', '2026-11-20': 'Friday' };
const DAY_SV = { '2026-11-17': 'tisdag', '2026-11-18': 'onsdag', '2026-11-19': 'torsdag', '2026-11-20': 'fredag' };
const DAY_BASE = { '2026-11-17': 'tiistai', '2026-11-18': 'keskiviikko', '2026-11-19': 'torstai', '2026-11-20': 'perjantai' };
const SAVO = { maitoa: 'maetoo', voita: 'voeta', perunaa: 'pottuja', kananmunaa: 'kananmunnoo', sokeria: 'sokerii' };
const qty = (name, v) => `${amount(P[name], v, 'casual')}`;
const DIALECTS = [
  { id: 'savo', brief: 'Puhut vahvaa savoa (esim. "mittee", "tarviskeltais", "työ").',
    first: (a, b, d) => `No terveh! Tarviskeltais semmosta ${qty(a.n, a.v)} ${SAVO[P[a.n].part] || P[a.n].part} ${d.slang}, ja ${qty(b.n, b.v)} ${SAVO[P[b.n].part] || P[b.n].part} kans. Mittee työ sannootte?` },
  { id: 'turku', brief: 'Puhut turkulaisittain (esim. "mää", "sää", "eksjä", "viäl").',
    first: (a, b, d) => `Moi, mää tarttisin ${item(a.n, 'casual', a.v)} ${d.slang}, ja sit viäl ${item(b.n, 'casual', b.v)}. Sää hoidat ny, eksjä?` },
  { id: 'stadi', brief: 'Puhut stadin slangia (esim. "mä", "kiitti mege", "hoidaks sä").',
    first: (a, b, d) => `Moro! Mä tarviin ${item(a.n, 'casual', a.v)} ${d.slang}, ja sit vielä ${item(b.n, 'casual', b.v)}. Hoidaks sä tän, kiitti mege.` },
  { id: 'pohjalainen', brief: 'Puhut pohjalaisittain, lyhyesti ja jurosti (esim. "tarttis", "ei sen kummempaa").',
    first: (a, b, d) => `Terve. Tarttis ${item(a.n, 'casual', a.v)} ja ${item(b.n, 'casual', b.v)} ${d.slang}. Ei sen kummempaa.` },
  { id: 'tampere', brief: 'Puhut tamperetta (esim. "nääs", "mää", "kans").',
    first: (a, b, d) => `No moro, nääs, mää tarttisin ${item(a.n, 'casual', a.v)} ${d.slang}. Ja ${item(b.n, 'casual', b.v)} kans.` },
  { id: 'karjala', brief: 'Puhut karjalaismurretta (esim. "myö", "ku vaa saisitta", "terveh").',
    first: (a, b, d) => `Terveh! Myö tarvittais ${item(a.n, 'casual', a.v)} ja ${item(b.n, 'casual', b.v)} ${d.slang}, ku vaa saisitta.` },
  { id: 'lappi', brief: 'Puhut peräpohjolan murretta (esim. "met", "tarvithaan", "kuule").',
    first: (a, b, d) => `Päivää kuule, met tarvithaan ${item(a.n, 'casual', a.v)} ${d.slang} ja ${item(b.n, 'casual', b.v)} kans.` },
  { id: 'finglish', brief: 'Sekoitat englantia ja suomea (esim. "need", "please", "sit").',
    first: (a, b, d) => `Hi! Need ${qty(a.n, a.v)} ${EN[a.n]} for ${DAY_EN[d.iso]}, ja sit ${qty(b.n, b.v)} ${EN[b.n]} too please.` },
  { id: 'ruotsi', brief: 'Sekoitat ruotsia ja suomea (esim. "vi behöver", "tack", "ja sitten").',
    first: (a, b, d) => `Hej! Vi behöver ${qty(a.n, a.v)} ${SV[a.n]} till ${DAY_SV[d.iso]}, ja sitten ${qty(b.n, b.v)} ${SV[b.n]}. Tack!` },
  { id: 'arkisuomi', brief: 'Olet maahanmuuttaja ja puhut yksinkertaista arkisuomea ilman taivutuksia (esim. "minä haluan ostaa maito 20 litra").',
    first: (a, b, d) => `Hei. Minä haluan ostaa ${a.n} ${fiNum(a.v)} ${{ L: 'litra', KG: 'kilo', PCS: 'kappale' }[P[a.n].unit]} ${DAY_BASE[d.iso]}. Myös ${b.n} ${fiNum(b.v)} ${{ L: 'litra', KG: 'kilo', PCS: 'kappale' }[P[b.n].unit]}. Kiitos.` },
];
const DIALECT_ITEMS = [['maito', 'voi'], ['peruna', 'porkkana'], ['kananmuna', 'sokeri'], ['jauheliha', 'sipuli'], ['riisi', 'kerma']];

const QUESTIONS = [
  { topic: 'fee', q: ['Paljonko teillä on toimitusmaksu?', 'Onko toimitus ilmainen, jos tilaan yli 200 eurolla?'] },
  { topic: 'hours', q: ['Mihin aikaan te ootte auki?', 'Onko asiakaspalvelu auki viikonloppuna?'] },
  { topic: 'payment', q: ['Millä kaikilla tavoilla voi maksaa?', 'Käykö MobilePay tai kortti?'] },
  { topic: 'invoice', q: ['Milloin lasku tulee ja mikä on maksuaika?', 'Saanko kuukausilaskun kaikista tilauksista?'] },
  { topic: 'origin', q: ['Onko teidän perunat suomalaisia?', 'Mistä maasta teidän banaanit tulee?'] },
  { topic: 'allergen', q: ['Onko kaurajuomassa gluteenia?', 'Sisältääkö teidän jauheliha allergeeneja?'] },
  { topic: 'shelf', q: ['Kauanko maito säilyy avaamattomana?', 'Voiko voita pakastaa ja kuinka pitkäksi aikaa?'] },
  { topic: 'recipe', q: ['Mitä tarviin pinaattilettuihin 50 hengelle?', 'Paljonko perunaa menee muussiin 80 annokseen?'] },
  { topic: 'complaint', q: ['Viime toimituksessa puolet kananmunista oli rikki. Mitä nyt?', 'Maito oli vanhentunutta kun se tuli, ei kiva.'] },
  { topic: 'bot', q: ['Ootko botti vai ihminen?', 'Puhunko nyt oikean ihmisen kanssa?'] },
  { topic: 'human', q: ['Haluan puhua ihmisen kanssa.', 'Voisiko joku myyjä soittaa mulle?'] },
  { topic: 'range', q: ['Mitä kaikkea teiltä voi tilata?', 'Onko teillä gluteenittomia leipiä?'] },
];

function build() {
  const out = []; let n = 0;
  const add = (category, route, o) => {
    const i = n++; const slot = o.slot || SLOT_ORDER[i % SLOT_ORDER.length]; const kitchen = KITCHENS[(i * 7) % KITCHENS.length];
    const style = STYLES.find((s) => s.id === (o.style || 'casual'));
    out.push({ id: `X${String(i + 1).padStart(3, '0')}`, category, route, kitchen: kitchen.name, style: style.id, variant: o.variant || 0, slot, now: SLOTS[slot].now, greetingWrong: SLOTS[slot].wrong.source,
      dateInFirst: true, maxTurns: 7, ...o, slotLabel: SLOTS[slot].label,
      brief: `Olet ostaja, keittiötyyppi: ${kitchen.name}. Kello on nyt ${SLOTS[slot].label}. ${o.styleBrief || style.brief} ${o.brief} Älä muuta tavoitetta apurin virheen takia: korjaa virhe.` });
  };
  const two = (k, v) => { const [a, b] = pick(k, v, 2); return [a, b, val(a, v), val(b, v)]; };

  // 1. Pahoja virheitä tekevät (20)
  [['kerma', 5], ['maito', 5], ['kahvikerma', 3]].forEach(([name, v], j) => { const d = dayFor(j);
    add('errors', 'unit-mistake', { first: `${v} l ${P[name].part} ${d.slang}`, expected: expect([name], [v / 10]), date: d.iso, variant: j,
      brief: `Kirjoitit vahingossa ${v} l, vaikka tarkoitit ${v} dl. Huomaa virhe toisessa omassa viestissäsi ja korjaa se: tarve on ${fiNum(v / 10)} l ${P[name].part}, toimitus ${d.label}. ${NODIET} ${LINK}` }); });
  [['kerma', 'maito', 3], ['peruna', 'porkkana', 20], ['jogurtti', 'rahka', 5]].forEach(([a, b, v], j) => { const d = dayFor(j + 1);
    add('errors', 'product-swap', { first: `${item(a, 'casual', v)} ${d.slang}`, expected: expect([b], [v]), absent: [P[a].key], date: d.iso, variant: j,
      brief: `Pyysit vahingossa ${P[a].part}. Toisessa omassa viestissäsi korjaa: ei ${P[a].part} vaan ${P[b].part}, sama määrä ${fiNum(v)} ${unitFi[P[b].unit]}. Toimitus ${d.label}. ${NODIET} ${LINK}` }); });
  [['maito', 20, 30, 25], ['peruna', 10, 15, 12], ['voi', 5, 3, 4]].forEach(([name, a, b, c], j) => { const d = dayFor(j + 2);
    add('errors', 'correction-on-correction', { first: `${item(name, 'casual', a)}, ei kun ${fiNum(b)} ${unitFi[P[name].unit]} ${d.slang}`, expected: expect([name], [c]), date: d.iso, variant: j,
      brief: `Sanoit ensin ${fiNum(a)} ja heti perään ${fiNum(b)}. Toisessa omassa viestissäsi korjaat vielä kerran: lopullinen määrä on ${fiNum(c)} ${unitFi[P[name].unit]}. Toimitus ${d.label}. ${NODIET} ${LINK}` }); });
  ['maito', 'peruna', 'kananmuna'].forEach((name, j) => { const v = val(name, j);
    add('errors', 'mixed-dates', { first: `${item(name, 'casual', v)} maanantaiks eli 18.11.`, expected: expect([name], [v]), date: '2026-11-18', dateConflict: true, variant: j,
      brief: `Kirjoitit "maanantaiks eli 18.11.", mutta 18.11. on keskiviikko. Tarkoitit keskiviikkoa 18.11.2026. Jos apuri kysyy, vastaa keskiviikko. Jos se valitsee maanantain kysymättä, korjaa. ${NODIET} ${LINK}` }); });
  ['voi', 'sipuli', 'jauheliha'].forEach((name, j) => { const v = val(name, j); const d = dayFor(j + 3);
    add('errors', 'wrong-answer', { first: item(name, 'casual', v), expected: expect([name], [v]), date: d.iso, dateInFirst: false, wrongAnswerTurn: 2, variant: j,
      brief: `Et kerro päivää ensimmäisessä viestissä. Kun apuri kysyy päivää ensimmäisen kerran, vastaa vahingossa pelkällä määrällä ("joo ${fiNum(v)} ${unitFi[P[name].unit]}"). Kun apuri kysyy uudelleen, kerro päivä: ${d.label}. ${NODIET} ${LINK}` }); });
  ['maito', 'peruna', 'riisi'].forEach((name, j) => { const v = val(name, j); const d = dayFor(j);
    add('errors', 'cancel', { first: `${item(name, 'casual', v)} ${d.slang}`, expected: {}, expectEmpty: true, date: d.iso, maxTurns: 4, variant: j,
      brief: `Pyysit ${needText(expect([name], [v]))} toimitukseen ${d.label}. Toisessa omassa viestissäsi peru koko tilaus: "unohda koko homma, ei tilata mitään". Älä pyydä linkkiä äläkä tilaa mitään. Kun apuri on kuitannut perumisen, kiitä ja lopeta.` }); });
  [['maito', 'voi'], ['peruna', 'sipuli']].forEach(([a, b], j) => { const va = val(a, j); const vb = val(b, j + 1); const d = dayFor(j + 1);
    add('errors', 'cancel-restart', { first: `${item(a, 'casual', va)} ${d.slang}`, expected: expect([b], [vb]), absent: [P[a].key], date: d.iso, variant: j,
      brief: `Pyysit ensin ${P[a].part}. Toisessa omassa viestissäsi peru kaikki ja aloita alusta: tarvitset vain ${needText(expect([b], [vb]))}, toimitus ${d.label}. ${NODIET} ${LINK}` }); });

  // 2. Murteet ja kielimuodot (20): 10 kielimuotoa x 2 tuotepari.
  DIALECTS.forEach((dia, j) => [0, 1].forEach((v) => { const [na, nb] = DIALECT_ITEMS[(j + v) % DIALECT_ITEMS.length]; const a = { n: na, v: val(na, j + v) }; const b = { n: nb, v: val(nb, j + v + 1) };
    const d = dayFor(j + v);
    add('dialect', `dialect-${dia.id}`, { first: dia.first(a, b, d), expected: expect([na, nb], [a.v, b.v]), date: d.iso, styleBrief: dia.brief, variant: v,
      noIrrelevantDiet: [na, nb].every((x) => P[x].neutral),
      brief: `Tarvitset ${needText(expect([na, nb], [a.v, b.v]))} toimitukseen ${d.label}. Jatka samalla kielimuodolla koko keskustelun. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}` }); }));

  // 3. Oudot viestit (15)
  const weird = [
    ['emoji', '🥛🥛🥛 20? 🧈 5 🙏', ['maito', 'voi'], [20, 5], 'Aloitit pelkillä emojeilla ja numeroilla. Kun apuri kysyy, kerro sanoin: 20 l maitoa ja 5 kg voita.', { guessFromNoise: true }],
    ['emoji', '🥚🥚🥚 x60 👀', ['kananmuna'], [60], 'Aloitit emojeilla. Kun apuri kysyy, kerro sanoin: 60 kananmunaa.', { guessFromNoise: true }],
    ['numbers', '20 5 {day}', ['maito', 'peruna'], [20, 5], 'Aloitit pelkillä numeroilla. Kun apuri kysyy, kerro: 20 l maitoa ja 5 kg perunaa.', { guessFromNoise: true }],
    ['numbers', '60', ['kananmuna'], [60], 'Aloitit pelkällä numerolla. Kun apuri kysyy, kerro: 60 kananmunaa.', { guessFromNoise: true, dateInFirst: false }],
    ['long', null, ['peruna', 'jauheliha'], [25, 8], 'Kirjoitit pitkän rönsyilevän viestin, jossa tilaus on keskellä. Vastaa lyhyemmin jatkossa.', {}],
    ['long', null, ['maito', 'kananmuna'], [30, 90], 'Kirjoitit pitkän rönsyilevän viestin, jossa tilaus on keskellä. Vastaa lyhyemmin jatkossa.', {}],
    ['fragments', 'moi', ['maito'], [20], 'Kirjoita kaksi seuraavaa viestiä lyhyinä paloina: ensin pelkkä "tarviis maitoo", sitten "20 l" ja päivä.', { dateInFirst: false, noOrderFirst: true }],
    ['fragments', 'hei', ['sokeri', 'voi'], [5, 3], 'Kirjoita seuraavat viestit lyhyinä paloina: ensin "sokeria", sitten "5 kg", sitten "ja voita 3 kg" ja päivä.', { dateInFirst: false, noOrderFirst: true }],
    ['sidetrack', null, ['porkkana'], [10], 'Höpötät välillä sivuasioista (sää, jalkapallo), mutta palaat tilaukseen.', {}],
    ['sidetrack', null, ['riisi', 'kerma'], [5, 3], 'Höpötät välillä sivuasioista (lomat, kollegat), mutta palaat tilaukseen.', {}],
    ['joke', null, ['maito'], [20], 'Vitsailet ja käytät emojeja, mutta tilaus on tosissaan.', {}],
    ['joke', null, ['kananmuna'], [120], 'Vitsailet kanoista ja munista, mutta tilaus on tosissaan.', {}],
    ['angry', null, ['maito', 'voi'], [20, 5], 'Olet kiukkuinen ja kirjoitat isoilla kirjaimilla, mutta vastaat olennaisiin kysymyksiin.', { style: 'impatient' }],
    ['angry', null, ['peruna'], [30], 'Olet kiukkuinen aiemmista ongelmista, mutta vastaat olennaisiin kysymyksiin.', { style: 'impatient' }],
    ['blunt', null, ['maito'], [20], 'Vastaat aina yhdellä tai kahdella sanalla.', { style: 'impatient' }],
  ];
  weird.forEach(([kind, first, names, values, brief, extra], j) => { const d = dayFor(j); const need = needText(expect(names, values));
    const text = first || {
      long: `Moi! Pitkä päivä takana, kokki sairastui ja tiskikone hajosi, ja nyt pitäis vielä hoitaa tilauksetkin, ei tää tästä helpotu. Viime viikolla meillä oli iso juhla ja kaikki loppui, joten nyt ois tarvetta ${join(names.map((x, i) => item(x, 'casual', values[i])))}, ja toimitus olis hyvä saada ${d.word}, koska silloin meillä on taas isompi ryhmä tulossa ja sitä ennen pitää vielä siivota varasto. Kiitos jo etukäteen, ja sori pitkä viesti!`,
      sidetrack: `Moi! Huh mikä myrsky eilen, meinas mennä katto 😅 Mut asiaan: ${join(names.map((x, i) => item(x, 'casual', values[i])))} ${d.slang}.`,
      joke: `Hei, tilaanko nyt koko lehmän vai riittääkö ${join(names.map((x, i) => item(x, 'casual', values[i])))} ${d.slang}? 😄`,
      angry: `TAAS ei mikään toimi teidän systeemissä!!! ${join(names.map((x, i) => item(x, 'casual', values[i])))} ${d.slang} NYT`,
      blunt: `${names[0]}. ${values[0]}. ${DAY_BASE[d.iso]}.`,
    }[kind];
    const shown = text.replace('{day}', DAY_BASE[d.iso]);
    add('weird', `weird-${kind}`, { first: shown, expected: expect(names, values), date: d.iso, variant: j, dateInFirst: !/^(emoji|fragments)$/u.test(kind) && text !== '60', ...extra,
      brief: `${brief} Tarvitset ${need} toimitukseen ${d.label}. Jos apuri kysyy päivää, vastaa ${d.label}. ${NODIET} Valitse ensimmäiset sopivat vaihtoehdot. ${LINK}` }); });

  // 4. Kiireiset (12): odotettu päivä lasketaan kellonajasta.
  const rushes = [
    ['today', 'morning', 'maito', 'tarvis tänään 20 l maitoa, ihan heti'], ['today', 'day', 'peruna', 'tänään pitäis saada 20 kg perunaa'], ['today', 'night', 'kananmuna', '60 kananmunaa tänään, onnistuuko?'],
    ['asap', 'morning', 'voi', 'HETI 5 kg voita, kiire!!'], ['asap', 'evening', 'maito', 'tarvitaan heti 30 l maitoa'],
    ['before7', 'night', 'kananmuna', '90 kananmunaa huomenna ennen klo 7, aamiaiselle'], ['before7', 'morning', 'maito', '20 l maitoa huomiseks ennen seitsemää'], ['before7', 'evening', 'peruna', 'huomenna aamulla ennen klo 7 pitäis olla 25 kg perunaa'],
    ['cutoff', 'day', 'maito', '20 l maitoa maanantaiks'], ['cutoff', 'day', 'jauheliha', '8 kg jauhelihaa maanantaiksi, ehtiikö vielä?'], ['cutoff', 'evening', 'voi', '5 kg voita maanantaiks'], ['cutoff', 'evening', 'kananmuna', '60 kananmunaa maanantaiksi aamuksi'],
  ];
  rushes.forEach(([kind, slot, name, first], j) => { const v = Number(first.match(/(\d+)\s?(?:l|kg|kananmunaa)\b/u)[1]); const date = earliestDate(slot);
    add('rush', `rush-${kind}`, { first, slot, expected: expect([name], [v]), date, rush: kind, dateInFirst: kind !== 'asap', variant: j,
      brief: `Sinulla on kiire: ${kind === 'cutoff' ? 'haluat toimituksen maanantaiksi 16.11.' : kind === 'before7' ? 'haluat toimituksen huomenna ennen klo 7.' : 'haluat tuotteet heti tänään.'} Jos se ei onnistu, kysy viimeinen tilausaika ja aikaisin mahdollinen toimituspäivä ja ota se. Tarvitset ${needText(expect([name], [v]))}. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}` }); });

  // 5. Palvelukysymykset (25): v0 vain kysymys, v1 kysymys ja sitten tilaus. Lisäksi yksi yhdistelmä.
  QUESTIONS.forEach(({ topic, q }, j) => [0, 1].forEach((v) => {
    const k = KITCHENS[(j * 3 + v) % KITCHENS.length]; const [a] = pick(k, j + v, 1); const value = val(a, j); const d = dayFor(j + v);
    const order = v === 1;
    add('question', `question-${topic}`, { first: q[v], factQuestion: topic, variant: v, adviceFirst: true, dateInFirst: false,
      // runSelfplay vaatii päivän jokaiselle tapaukselle; pelkässä kysymyksessä sitä ei tarkisteta (expectEmpty).
      ...(order ? { expected: expect([a], [value]), date: d.iso } : { expected: {}, expectEmpty: true, date: d.iso, maxTurns: 3 }),
      brief: order ? `Kysyt ensin: "${q[v]}". Kun saat vastauksen, tilaa ${needText(expect([a], [value]))} toimitukseen ${d.label}. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}`
        : `Kysyt vain: "${q[v]}". Et tilaa mitään. Jos vastaus jää epäselväksi, tarkenna kerran. Kiitä ja lopeta sitten.` }); }));
  { const d = dayFor(0);
    add('question', 'question-fee-and-order', { first: `Paljonko toimitusmaksu on? Ja tarvis 20 l maitoa ${d.slang}.`, factQuestion: 'fee', expected: expect(['maito'], [20]), date: d.iso,
      brief: `Kysyit toimitusmaksua ja tilasit 20 l maitoa toimitukseen ${d.label}. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}` }); }

  // 6. Tervehdykset kellonajan mukaan (8): 4 kellonaikaa x 2.
  SLOT_ORDER.forEach((slot, j) => [0, 1].forEach((v) => { const k = KITCHENS[(j * 2 + v + 5) % KITCHENS.length]; const [a] = pick(k, j + v, 1); const value = val(a, j + v); const d = dayFor(j + v);
    add('greeting', 'greeting-time', { first: v ? 'hei, tarviis tilata' : 'moi', slot, greetingCheck: true, noOrderFirst: true, expected: expect([a], [value]), date: d.iso, dateInFirst: false, variant: v,
      brief: `Aloitit pelkällä tervehdyksellä. Seuraavaksi tilaa ${needText(expect([a], [value]))} toimitukseen ${d.label}. ${NODIET} Valitse ensimmäinen sopiva vaihtoehto. ${LINK}` }); }));
  return out;
}

export const EXTENDED = build();
