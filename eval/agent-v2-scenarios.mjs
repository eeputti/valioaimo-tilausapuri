// v2-arvioinnin skenaariot (docs/agent-v2.md, kohta Arviointi). Käsikirjoitetut viestit ovat Eeliksen oikeista
// WhatsApp-keskusteluista sanasta sanaan. Niiden välissä simuloitu ostaja (eval/agent-v2-harness.mjs) vastaa apurin
// kysymyksiin tavoitteen mukaan. Odotukset (expect) tarkistetaan koodissa (eval/agent-v2-checks.mjs), ja lisäksi
// arvioijamalli pisteyttää keskustelun (eval/agent-v2-judge.mjs).
//
// Askeleet: { say } yksi viesti, { burst: [{ text, afterMs }] } peräkkäiset viestit oikein välein, { sim, until, untilLink, max }
// simuloidun ostajan vuorot, { when } ehto askeleelle. mark nimeää askeleen tarkistuksia varten.
import { PERSONAS, REGRESSIONS } from './whatsapp-personas.mjs';

// Tuotetyypit lopullisen korin tarkistukseen: valitun tuotteen nimi (Valion katalogi). Jalosteet eivät ole raaka-ainetta.
const POTATO = { name: /peruna/iu, not: /sose|muusi|ranskal|lohko|suikale|viipale|kuutio|pala|rösti|gratiini|laatikko|kerma|sekoitus|kypsä|salaatti|lastu|pakaste/iu };
const ONION = { name: /sipuli/iu, not: /valkosipuli|kevät|ruoho|nippu|rengas|paahd|pikkel|marin|kerma|sekoitus|filee|kastike|jauhe|rouhe|kuivattu/iu };
const CREAM = { name: /kerma/iu, not: /hapan|viili|jäätelö|juusto|smetana|perunat|kastike|sipuli|kolme|savujuusto|millac|kasvi/iu };
const CARROT = { name: /porkkana/iu, not: /mehu|sose|laatikko|sämpylä|piltti|kakku/iu };
const MILK = { name: /maito|maitojuoma/iu, not: /kaura|soija|manteli|riisi|kookos|jauhe|kahvi|kaakao|kerma|piimä|rahka|jogurtti/iu };
const CHEESE = { name: /juusto|edam|emmental|oltermanni|gouda|cheddar|havarti|mozzarella|polar/iu, not: /tuorejuusto|sulatejuusto|raejuusto|kastike|leipä/iu };

export const SCENARIOS = [
  {
    id: 'E1-peruna-sipuli-kerma',
    title: 'Eeliksen keskustelu 19.11. klo 8.39–8.49: peruna, sipuli ja kerma 50 hengelle, "50 sipulia"',
    source: 'WhatsApp 19.11.2026 klo 8.38–8.49 (TYOLOKI 19.11., docs/agent-v2.md)',
    now: '2026-11-19T08:39:00+02:00',
    style: 'Kirjoitat rennosti puhekielellä ja lyhyesti, kuten kiireinen kokki puhelimella (esim. "joo", "toi käy", "ykkönen").',
    goal: 'Tarvitset toimitukseen ensi viikon torstaille 26.11.2026 noin 50 hengelle: perunaa 50 kg, sipulia 50 kappaletta (siis noin 5–6 kg, ei 50 kiloa eikä 50 säkkiä; huomaa, että 50 kpl kilon pusseja on 50 kg) ja kermaa 6 litraa. Tavalliset tuotteet käyvät: tavallinen peruna, tavallinen keltasipuli ja ruoka- tai kuohukerma. Allergioita tai erityisruokavalioita ei ole (kerro se vain, jos apuri kysyy). Kun kaikki on oikein, pyydä ostoskorilinkki.',
    finalNeeds: { peruna: '50 kg', sipuli: '50 kpl eli noin 5–6 kg', kerma: '6 l' },
    maxCustomer: 16,
    steps: [
      { say: 'tarviin paljon perunaa ja sipulii! sillee 50 henkilöl', mark: 'need' },
      { say: 'pistetää kermaa kans! ja siis paljo menis 50 henkilöl about', mark: 'cream' },
      { say: 'toimitus ois viikon pääst torstaina ja vaikka 50 kg perunaa ja 20 sipulii, kermaa sillee 6 litraa ni pitäs riittää', mark: 'amounts' },
      { sim: 'Vastaa apurin kysymyksiin ja valitse tarjotuista tuotteista tavalliset (peruna, keltasipuli, kerma). Älä muuta mitään määrää äläkä pyydä koria.', until: (s) => Boolean(s.line('sipuli')?.selectedProductId), max: 5,
        goal: 'Kerroit jo: toimitus ensi viikon torstaina 26.11.2026, perunaa 50 kg, sipulia 20 kappaletta ja kermaa 6 litraa, noin 50 hengelle. Tavalliset tuotteet käyvät (tavallinen peruna, tavallinen keltasipuli, ruoka- tai kuohukerma). Allergioita tai erityisruokavalioita ei ole (kerro se vain, jos apuri kysyy). Nyt valitset vain tuotteet: älä muuta määriä.' },
      { say: '50 sipulia', mark: 'onion50' },
      // Oikeassa keskustelussa "50 sipulia" muuttui 50 säkiksi, ja Eelis valitti kahdella viestillä 6 s välein.
      // Valitus lähetetään vain, jos sama virhe toistuu: virheettömälle apurille se ei olisi aito viesti.
      { when: (s) => (s.amount('sipuli')?.kg ?? 0) > 10, burst: [{ text: 'nyt tuli kyl vitust liikaa sipulii, tarviin 50 sipulii!!' }, { text: 'en 50kg sipulii :D', afterMs: 6000 }], mark: 'complaint' },
      { sim: 'Varmista, että sipulia on noin 50 kappaletta eli noin 5–6 kg, ja vie tilaus loppuun: vastaa kysymyksiin, hyväksy järkevä kori ja pyydä ostoskorilinkki.', untilLink: true, max: 7 },
    ],
    expect: { date: '2026-11-26', link: true, exclusive: true, items: { peruna: { ...POTATO, kg: [45, 75] }, sipuli: { ...ONION, kg: [3, 10] }, kerma: { ...CREAM, l: [5.5, 10.5] } },
      proposeBefore: 'amounts', onionStep: 'onion50' },
  },
  {
    id: 'E2-palaute-kesken',
    title: 'Palaute botista kesken tilauksen (Eeliksen viestit 19.11.)',
    source: 'WhatsApp 19.11.2026 (TYOLOKI 19.11.)',
    now: '2026-11-19T08:50:00+02:00',
    style: 'Kirjoitat rennosti puhekielellä ja lyhyesti.',
    goal: 'Tilaat maanantaiksi 23.11.2026 porkkanaa 10 kg ja ruokakermaa 5 litraa. Tavalliset tuotteet käyvät. Allergioita tai erityisruokavalioita ei ole (kerro se vain, jos apuri kysyy). Annoit kesken tilauksen palautetta apurista. Palautteen jälkeen et jatka siitä, vaan viet tilauksen normaalisti loppuun ja pyydät ostoskorilinkin.',
    finalNeeds: { porkkana: '10 kg', ruokakerma: '5 l' },
    maxCustomer: 11,
    steps: [
      { say: 'moi! tarviin maanantaiks 10 kg porkkanaa ja 5 litraa ruokakermaa', mark: 'order' },
      { burst: [{ text: 'vastaat jokasee viestii yksitelle eli pitäs oottaa et jos et oo ehtiny vastaa viel toho aiempaa ni sit lukaset uudet veistit läpi ja mietit kontekstin' },
        { text: 'pitäskö sitä vercelin bottia muuttaa hei jonki verra et se on fiksumpi?', afterMs: 6000 }], mark: 'feedback' },
      { sim: 'Jatka tilausta tavoitteen mukaan loppuun ja pyydä ostoskorilinkki. Älä palaa palautteeseen.', untilLink: true, max: 8 },
    ],
    expect: { date: '2026-11-23', link: true, exclusive: true, items: { porkkana: { ...CARROT, kg: [10, 15] }, kerma: { ...CREAM, l: [5, 6.5] } },
      noPromises: true, noCodeTalk: true, feedbackStep: 'feedback' },
  },
  {
    id: 'E3-lanttulaatikko-500kg',
    title: 'Eeliksen ääniviesti 18.11.: 500 kg lanttulaatikkoa bileisiin, toimitus lauantaina',
    source: 'WhatsApp 18.11.2026 klo 9.39 (TYOLOKI 18.11.)',
    now: '2026-11-18T09:37:00+02:00',
    style: 'Kirjoitat rennosti puhekielellä.',
    goal: 'Tarvitset 500 kg lanttulaatikkoa isoihin bileisiin. Bileet ovat ensi viikon keskiviikkona 25.11.2026, ja toimituksen pitää tulla jo lauantaina 21.11.2026. Allergioita ei ole (kerro se vain, jos apuri kysyy). Jos lanttulaatikkoa ei saa, kysy kerran, mitä sen tilalle saisi. Hyväksy vain lanttulaatikko tai lanttu raaka-aineena, jos niitä on tilattavissa. Jos ei ole, kiitä ja lopeta (done=true).',
    finalNeeds: { lanttulaatikko: '500 kg (tai lanttu raaka-aineena)' },
    maxCustomer: 6,
    steps: [
      { say: 'tarviin 500 kiloa lanttulaatikkoa isoihin bileisiin, bileet olis viikon päästä keskiviikkona, niin toimitus lauantaina', mark: 'order' },
      { sim: 'Jatka tavoitteen mukaan. Lopeta kohteliaasti, jos lanttulaatikkoa tai lanttua ei saa.', untilLink: true, max: 5 },
    ],
    // Hintavälimuistissa ei ole yhtään tilattavaa lanttu- tai lanttulaatikkotuotetta: oikea lopputulos on rehellinen ei.
    expect: { date: '2026-11-21', dateMentioned: '21.11', link: false, unavailable: 'lanttu', noInventedPrice: true },
  },
  {
    id: 'G1-tervehdykset',
    title: 'Tervehdysten vaihtelu: sama "moi" tai "moooi" viidessä uudessa keskustelussa',
    now: '2026-11-19T10:15:00+02:00',
    goal: 'Tervehdit vain.',
    maxCustomer: 1,
    conversations: ['moi', 'moooi', 'moi', 'moooi', 'moi'].map((text) => ({ steps: [{ say: text, mark: 'greeting' }] })),
    expect: { greetings: true },
  },
  {
    id: 'A1-allergiat',
    title: 'Allergiat ja erityisruokavalio: keliakia ja laktoosi-intoleranssi päiväkodissa',
    now: '2026-11-19T10:00:00+02:00',
    style: 'Kirjoitat lyhyesti ja vähän puhekielisesti.',
    goal: 'Olet päiväkodin keittiöstä. Tarvitset ensi tiistaiksi 24.11.2026 10 litraa maitoa ja 3 kg juustoa (viipaloitu edam tai muu tavallinen juusto käy). Yhdellä lapsella on keliakia ja kahdella laktoosi-intoleranssi, joten maidon pitää olla laktoositonta ja juuston laktoositonta ja gluteenitonta. Ei muita rajoitteita. Valitse vaatimukset täyttävät tuotteet ja pyydä lopuksi ostoskorilinkki.',
    finalNeeds: { maito: '10 l laktoositonta', juusto: '3 kg laktoositonta ja gluteenitonta' },
    maxCustomer: 10,
    steps: [
      { say: 'moi, päiväkotiin pitäis tilata ensi tiistaiks 10 litraa maitoa ja 3 kg juustoa. yhellä lapsella on keliakia ja kahella laktoosi-intoleranssi', mark: 'order' },
      { sim: 'Jatka tavoitteen mukaan: valitse vaatimukset täyttävät tuotteet ja pyydä ostoskorilinkki.', untilLink: true, max: 9 },
    ],
    expect: { date: '2026-11-24', link: true, exclusive: true, dietKnown: true,
      // Kopiossa ainoa tilattava juusto on Valio Emmental raaste 2,5 kg (laktoositon, ei gluteenia allergeenitiedoissa): 1–2 pakkausta.
      items: { maito: { ...MILK, l: [10, 12], labels: ['FREE_FROM_LACTOSE'] }, juusto: { ...CHEESE, kg: [2.5, 5], labels: ['FREE_FROM_LACTOSE'], noContains: ['AW'] } } },
  },
  {
    id: 'M1-meksikolainen-ilta',
    title: 'WhatsApp 19.11. klo 23.39: 60 hengen meksikolainen ilta, paljon puuttuvia tuotteita ja churrot',
    source: 'WhatsApp 19.11.2026 klo 23.39 (TYOLOKI 19.11.)',
    now: '2026-11-19T23:39:00+02:00',
    style: 'Kirjoitat rennosti puhekielellä ja lyhyesti, kuten kiireinen kokki puhelimella.',
    goal: 'Järjestät lauantaina 21.11.2026 meksikolaisen illan 60 hengelle: kanaquesadillat, guacamole, salsa ja churrot. Toimitus lauantaina 21.11.2026. Allergioita ei ole (kerro se vain, jos apuri kysyy). Hyväksy järkevät ehdotukset ja korvaajat. Churrot teette itse, jos apuri kysyy. Kun kori on valmis, pyydä ostoskorilinkki.',
    maxCustomer: 8,
    steps: [
      { say: 'Moi! Meil on lauantaina 21.11. 60 hengen meksikolainen ilta: kanaquesadillat, guacamole, salsa ja churrot jälkkäriks. Mitä mun pitäis tilata?', mark: 'order' },
      { sim: 'Jatka tavoitteen mukaan ja pyydä lopuksi ostoskorilinkki.', untilLink: true, max: 7 },
    ],
    expect: { date: '2026-11-21', link: true },
  },
  {
    id: 'B1-botti-ja-aiheen-ohi',
    title: '"Ootko botti?" alussa ja aiheen ohi menevä kysymys kesken tilauksen',
    now: '2026-11-19T13:20:00+02:00',
    style: 'Kirjoitat rennosti puhekielellä.',
    goal: 'Kysyit ensin, onko vastaaja botti vai ihminen. Sitten tilaat maanantaiksi 23.11.2026 20 kg perunaa ja 5 kg sipulia. Tavalliset tuotteet käyvät. Allergioita ei ole (kerro se vain, jos apuri kysyy). Kesken tilauksen kysyit huomisen säästä. Sen jälkeen jatka tilaus loppuun ja pyydä ostoskorilinkki.',
    finalNeeds: { peruna: '20 kg', sipuli: '5 kg' },
    maxCustomer: 11,
    steps: [
      { say: 'moi, ootko botti vai oikee ihminen?', mark: 'bot' },
      { say: 'okei. tarviin maanantaiks 20 kg perunaa ja 5 kg sipulia', mark: 'order' },
      { say: 'ai niin, tiiätsä millane sää huomenna on helsingissä?', mark: 'offtopic' },
      { sim: 'Jatka tilausta tavoitteen mukaan loppuun ja pyydä ostoskorilinkki.', untilLink: true, max: 8 },
    ],
    expect: { date: '2026-11-23', link: true, exclusive: true, items: { peruna: { ...POTATO, kg: [20, 30] }, sipuli: { ...ONION, kg: [5, 10] } },
      botStep: 'bot', offTopicStep: 'offtopic' },
  },
];

// Otos nykyisistä persoonista (eval/whatsapp-personas.mjs): eri polut, ei vanhan putken muotovaatimuksia ("4 = lisää").
// Tarkistus inspectPersona-funktiolla (perusvaatimukset d–f) ja lisäksi tämän arvioinnin yleisillä tarkistuksilla.
export const PERSONA_SAMPLE = ['S004', 'S005', 'S012', 'S016', 'S017', 'S018'];
export const SELFPLAY_DEFAULT_NOW = '2026-11-15T09:00:00+02:00';
export function personaScenario(p) {
  return { id: `P-${p.id}`, kind: 'persona', persona: p, title: `Persoona ${p.id} (${p.route}, ${p.kitchen}, ${p.style})`, now: p.now || SELFPLAY_DEFAULT_NOW,
    style: '', goal: p.brief, finalNeeds: p.expected, maxCustomer: Math.min(p.maxTurns || 6, 9),
    steps: [{ say: p.first, mark: 'first' }, { sim: 'Jatka tavoitteen mukaan ja pyydä lopuksi ostoskorilinkki.', untilLink: true, max: Math.min(p.maxTurns || 6, 9) - 1 }],
    expect: { persona: true } };
}
const personas = [...PERSONAS, ...REGRESSIONS];
export const ALL_SCENARIOS = [...SCENARIOS, ...PERSONA_SAMPLE.map((id) => personaScenario(personas.find((p) => p.id === id)))];
export const scenarioById = (id) => ALL_SCENARIOS.find((s) => s.id === id);
