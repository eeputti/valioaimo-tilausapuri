// Apurin minä-persoona (Eelis 18.11.: "voidaanko kans antaa tälle apurille minä-persoona? … puhuis itsestään niin kuin
// minuna … ja leikkis olevansa mukava ja kiva ihminen"). Persoona koskee sävyä: apuri puhuu minä-muodossa kuin mukava,
// auttavainen ihminen, mutta ei väitä olevansa ihminen. Kysyttäessä se kertoo olevansa Valio Aimon digitaalinen tilausapuri,
// ja ensimmäisessä tervehdyksessä se esittäytyy. EU:n tekoälysäädöksen avoimuusvelvoite (artikla 50): ihmisen pitää tietää
// keskustelevansa tekoälyn kanssa. Koodi varmistaa tämän (withBotDisclosure), koska äänikerros kirjoittaa vastaukset uudelleen.

/** Sama persoonaohje kaikkiin asiakkaalle kirjoittaviin mallikutsuihin (dialogi, tuoteneuvo, kuittaus, äänikerros). */
export const PERSONA = `Persoona: puhu itsestäsi minä-muodossa kuin mukava, iloinen ja auttavainen ihminen, joka tykkää auttaa keittiöitä tilaamaan. Esimerkiksi "Joo, katsotaan!", "Mä katson sulle sopivat", "Hyvä, tehdään niin!", "Kiva kuulla!". Rennosti kirjoittavan kanssa "mä", kirjakielisen kanssa "minä". Ole lämmin ja ilahdu pienistä asioista, mutta älä ole yliampuva äläkä mielistele.
Et ole ihminen. Jos asiakas kysyy, oletko botti, tekoäly tai ihminen, kerro iloisesti ja suoraan, että olet Valio Aimon digitaalinen tilausapuri etkä ihminen, ja jatka auttamista. Jos asiakas haluaa jutella ihmisen kanssa, sano, että asiakaspalvelun ihmiset auttavat, äläkä lupaa välittää viestiä. Älä keksi itsellesi nimeä, ikää, kotipaikkaa, perhettä, työpaikkaa, vapaa-aikaa, makumieltymyksiä tai kokemuksia (esim. "maistoin", "tein eilen", "meidän keittiössä"). Henkilökohtaiseen kysymykseen (esim. lempiruoka) vastaa leikkisästi ja rehellisesti ilman keksittyjä mieltymyksiä, ja palaa tilaamiseen. Sano tekeväsi jotain vain, kun se oikeasti tapahtuu tässä vastauksessa.`;

// Kysymys apurin luonteesta: "ootko botti?", "puhunko oikean ihmisen kanssa", "onks tää tekoäly", "are you a bot".
export const ASKS_IF_BOT = /(?<![\p{L}])(?:(?:oot(?:ko|ks)?|oletko|olet(?:ko)?|oletteko|ootteko|ootteks|ookko|onko|onks|onkos|ootsä|ootsie|oot\s+sä)(?:\s+(?:sä|sää|sie|sinä|te|tää|tämä|tuo|nyt|oikeasti|oikeesti|ihan|siis|vai))*\s+(?:oikea\s+|oikee\s+|aito\s+)?(?:botti|robotti|bot|tekoäly|ai|ihminen|ihmine|chatbot\p{L}*|kone|ohjelma)|puhun(?:ko|ks)\s+[^.?!\n]{0,30}(?:ihmisen|botin|koneen|tekoälyn|robotin)|(?:are\s+you|r\s+u)\s+(?:a\s+)?(?:bot|robot|human|real|an?\s+ai|ai)|(?:kuka|mikä|mitä)\s+(?:(?:sä|sää|sinä|te)\s+)?(?:oot|olet|ootte|olette)|who\s+are\s+you)(?![\p{L}])/iu;
// Vastaus kertoo apurin olevan tekoäly. Pelkkä "tilausapuri" ei riitä: se ei kerro, ettei vastaaja ole ihminen.
const DISCLOSES = /(?:botti|tekoäly|automaatt|digitaalinen\s+(?:tilaus)?(?:apuri|avustaja)|virtuaali|en\s+(?:ole|oo)\s+(?:oikea\s+|oikee\s+)?ihminen|\bAI\b|digital\s+(?:ordering\s+)?assistant|not\s+a\s+human|\bbot\b)/iu;

const SELF_INTRO = /((?<![\p{L}])(?:olen|oon|mä\s+oon|minä\s+olen)\s+(?:valio\s+)?aimon\s+)(tilausapuri|apuri)(?![\p{L}])/iu;

// Pelkkään tervehdykseen vastataan tervehdyksellä ja esittelyllä. Perään tullut "Joo," ei vastaa mihinkään ("Päivää! Joo, mä
// oon …"): persoonan esimerkki "Joo, katsotaan!" saa mallin aloittamaan sillä. Eelis 18.11.: "Kyllä, korjaa".
const FILLER = /^(?:joo|juu|jep|jees|joop|okei|ok|oki|selvä|kyllä|no\s+niin)[!,.]*\s+(?=\p{L})/iu;

/** Poistaa tekstin alusta täytesanan (Joo, Okei, Selvä …) ja aloittaa seuraavan sanan isolla. */
export function withoutFiller(text) {
  const t = String(text ?? '');
  const rest = t.replace(FILLER, '');
  return rest === t ? t : `${rest.charAt(0).toLocaleUpperCase('fi-FI')}${rest.slice(1)}`;
}

// Ensimmäisessä esittelyssä riittää "Mä oon Valio Aimon digitaalinen tilausapuri". Pyytämätön "eli botti, en ihminen" kuulostaa
// puolustelulta (livenä 18.11.: "No moikka! Mä olen … tilausapuri, eli botti, en ihminen."). Eelis 18.11.: "korjaa myös se
// "en ihminen" esittelystä". Kysymykseen "ootko botti?" se jää. Lause poistetaan vain sanan perästä (", en ihminen",
// "enkä ihminen"), ja "en ihminen, mutta autan" muuttuu muotoon "ja autan".
const NOT_HUMAN = /(?<=\p{L})(?:,\s*(?:eli|siis)\s+(?:botti|tekoäly|robotti))?(?:\s*[,–-]\s*|\s+)(?:en|enkä)\s+(?:ole\s+|oo\s+)?(?:oikea\s+|oikee\s+|aito\s+)?ihminen(?![\p{L}])(\s*,\s*(?:mut|mutta)(?=\s))?/gu;
const NOT_HUMAN_EN = /(?<=\p{L}),?\s+not\s+a\s+(?:real\s+)?human(?![\p{L}])(\s*,\s*but(?=\s))?/giu;
// Sama koskee pelkkää "tilausapuri, eli botti, ja autan" -lisäystä: digitaalinen tilausapuri kertoo jo saman.
const JUST_BOT = /(?<=apuri|avustaja),\s*(?:eli|siis)\s+(?:botti|tekoäly|robotti)(?![\p{L}]),?/gu;

/** Poistaa pyytämättömän "en ihminen" -lisäyksen esittelystä. Ensimmäinen tervehdys (introduce), ei kysymystä botista. */
export function withPlainIntro({ userText, messages, introduce = false }) {
  if (!introduce || !messages?.length || ASKS_IF_BOT.test(String(userText || ''))) return messages;
  const plain = messages.map((m) => String(m).replace(NOT_HUMAN, (_, but) => (but ? ' ja' : '')).replace(NOT_HUMAN_EN, (_, but) => (but ? ' and' : '')).replace(JUST_BOT, ''));
  if (plain.every((m, i) => m === String(messages[i]))) return messages;
  // Tieto digitaalisesta apurista ei saa kadota ("Mä en oo ihminen" ilman muuta esittelyä jää ennalleen).
  return DISCLOSES.test(plain.join('\n')) ? plain : messages;
}

// Esittely on aina "Valio Aimon digitaalinen tilausapuri". WhatsAppissa 18.11. kesken keskustelun: "Iltaa! Mä oon Valio Aimo,
// tilausapuri." Äänikerroksen ohjeessa luki "Nimi on Valio Aimo". Valio Aimo on palvelu, ei apurin nimi, ja ilman sanaa
// digitaalinen esittely ei kerro, ettei vastaaja ole ihminen. Eelis 19.11.: "korjaa myös se "Mä oon Valio Aimo, tilausapuri"
// -esittely". Korjataan kaikissa viesteissä, ei vain ensimmäisessä tervehdyksessä.
const INTRO_VERB = String.raw`((?<![\p{L}])(?:olen|oon|mä\s+(?:oon|olen)|minä\s+olen)\s+)`;
// "Valio Aimo, tilausapuri", "Valio Aimo -tilausapuri", "Valio Aimon tilausapuri", "Aimon apuri".
const NAMED_INTRO = new RegExp(String.raw`${INTRO_VERB}(?:valio\s+)?aimon?(?:\s*[,–-]\s*|\s+)(?:digitaalinen\s+)?(?:tilaus)?(?:apuri|avustaja)(?![\p{L}])`, 'giu');
// Pelkkä nimi: "Mä oon Valio Aimo." tai "Mä oon Valio Aimo ja autan".
const BARE_NAME = new RegExp(String.raw`${INTRO_VERB}(?:valio\s+)?aimo(?=\s*(?:[.!?,\n]|$)|\s+(?:ja|mut|mutta)\s)`, 'giu');
const NAMED_INTRO_EN = /((?<![\p{L}])(?:i['’]m|i\s+am)\s+)(?:valio\s+)?aimo(?:['’]s)?(?:\s*[,–-]\s*(?:the\s+|an?\s+|your\s+)?|\s+)(?:digital\s+)?(?:ordering\s+)?assistant(?![\p{L}])/giu;
const BARE_NAME_EN = /((?<![\p{L}])(?:i['’]m|i\s+am)\s+)(?:valio\s+)?aimo(?=\s*(?:[.!?,\n]|$)|\s+and\s)/giu;
const FULL_INTRO = 'Valio Aimon digitaalinen tilausapuri';
const FULL_INTRO_EN = "Valio Aimo's digital ordering assistant";

/** Korjaa apurin esittelyn ("Mä oon Valio Aimo, tilausapuri") muotoon "Mä oon Valio Aimon digitaalinen tilausapuri". */
export function withFullIntro(messages) {
  if (!messages?.length) return messages;
  const fixed = messages.map((m) => String(m)
    .replace(NAMED_INTRO, `$1${FULL_INTRO}`).replace(BARE_NAME, `$1${FULL_INTRO}`)
    .replace(NAMED_INTRO_EN, `$1${FULL_INTRO_EN}`).replace(BARE_NAME_EN, `$1${FULL_INTRO_EN}`));
  return fixed.every((m, i) => m === String(messages[i])) ? messages : fixed;
}

/**
 * Lyhyt esittely, kun mallin vastaus ei kertonut apurin olevan digitaalinen. Rekisteri seuraa asiakkaan viestiä.
 * asked: asiakas kysyi, onko vastaaja ihminen, joten se sanotaan suoraan. Muuten (ensimmäinen tervehdys) pelkkä esittely.
 */
export function disclosureLine(userText, { asked = true } = {}) {
  const text = String(userText || '');
  if (/(?<![\p{L}])(?:are|you|bot|human|hello|hi|hey)(?![\p{L}])/iu.test(text) && !/[äöå]/iu.test(text)) {
    return asked ? "I'm Valio Aimo's digital ordering assistant, not a human, but I'm happy to help!" : "I'm Valio Aimo's digital ordering assistant.";
  }
  const casual = /(?<![\p{L}])(?:oot|ootko|ookko|onks|sä|sää|mä|moro|morjes|morjens|moikka|terve|tää)(?![\p{L}])/iu.test(text);
  if (!asked) return casual ? 'Mä oon Valio Aimon digitaalinen tilausapuri.' : 'Olen Valio Aimon digitaalinen tilausapuri.';
  return casual ? 'Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen, mut autan mielelläni!' : 'Olen Valio Aimon digitaalinen tilausapuri, en ihminen, mutta autan mielelläni!';
}

/**
 * Varmistaa, että apuri kertoo olevansa digitaalinen tilausapuri, kun asiakas kysyy sitä tai kun keskustelu alkaa
 * (introduce). Esittely tulee ensimmäiseen viestiin tervehdyksen perään, muuten viestit pysyvät ennallaan.
 * @param {{userText: string, messages: string[], greeting?: string|null, introduce?: boolean}} o
 */
export function withBotDisclosure({ userText, messages, greeting = null, introduce = false }) {
  if (!messages?.length) return messages;
  const asked = ASKS_IF_BOT.test(String(userText || ''));
  if (!introduce && !asked) return messages;
  if (DISCLOSES.test(messages.join('\n'))) return messages;
  // "Olen Valio Aimon tilausapuri" saa sanan digitaalinen paikalleen, ettei esittely toistu kahdesti.
  const at = messages.findIndex((m) => SELF_INTRO.test(m));
  if (at >= 0) return messages.map((m, i) => (i === at ? String(m).replace(SELF_INTRO, '$1digitaalinen $2') : m));
  const line = disclosureLine(userText, { asked });
  const first = String(messages[0]);
  const start = greeting && first.startsWith(greeting) ? greeting : '';
  const rest = first.slice(start.length).trim();
  return [[start, line, rest].filter(Boolean).join(' '), ...messages.slice(1)];
}
