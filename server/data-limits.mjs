// Valion testirajapinta suljettiin 17.11.2026 (osoite ei enää ratkea). Botti toimii VALIO_FALLBACK=last-known-tilassa ja
// tuntee oikean hinnan ja saatavuuden vain niille tuotteille, joita se ehti kysyä ennen sulkemista: välimuistissa 881 tuotetta,
// joilla on sekä hinta että saatavuus "ok", katalogin 17 546:sta. Eelis päätti, ettei hintoja arvioida, ja pyysi, että botti
// kertoo puutteen ja sen syyn selvästi ja kevyesti ("tietojani on supistettu", 17.11.).
import { allative } from './fi-words.mjs';

const joinFi = (names) => (names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} ja ${names.at(-1)}`);

/** Rajapinta on poissa ja käytössä on viimeisin tunnettu arvo: vain silloin puute selitetään supistetuilla tiedoilla. */
export const dataLimited = () => (process.env.VALIO_FALLBACK || '').trim() === 'last-known';

export const DATA_REASON = 'Tietojani on supistettu: Valion testirajapinta suljettiin, joten minulla on oikea hinta ja saatavuus enää noin 900 tuotteelle 17 500:sta.';

// Tuoteryhmät, joissa välimuistissa on useita tilattavia tuotteita (laskettu 17.11. välimuistikannasta). Heikot: juustot
// (vain Emmental-raaste), jogurtit (ei yhtään), hedelmät (sitruuna) ja kahvi (yksi laatikko).
export const HAVE = 'maidot ja kermat, voit, kananmunat, kaurajuomat, kana ja broileri, kala, naudan jauheliha, perunat ja juurekset, salaatit, jauhot, sokerit, riisit ja pastat';
export const FEW = 'juustoja, jogurtteja, hedelmiä ja kahvia';

/** "Hups, juustolle minulla ei ole nyt hintaa eikä saatavuutta." Usea tuote yhdessä lauseessa. */
export const noDataFor = (terms) => `Hups, ${joinFi(terms.map(allative))} minulla ei ole nyt hintaa eikä saatavuutta.`;
export const NO_DATA = /^Hups, (.+) minulla ei ole nyt hintaa eikä saatavuutta\.$/u;

/** Vastaus kysymykseen valikoimasta ("mitä tuotteita teillä on?"). */
export function assortmentReply() {
  return `Heh, rehellinen vastaus: valikoimani on nyt pieni. ${DATA_REASON}\n\nHyvin löytyy esimerkiksi ${HAVE}. ${FEW[0].toUpperCase()}${FEW.slice(1)} on enää muutama tai ei yhtään.\n\nKerro, mitä tarvitset ja mille päivälle, niin katson. Esim. "20 l maitoa ja 5 kg voita perjantaiksi".`;
}

// Kysymys koko valikoimasta, ei yksittäisestä tuotteesta: "mitä tuotteita teillä on?", "mitä teiltä voi tilata?", "mitä teillä on?".
const ASSORTMENT = /^(?:no\s+|ok\s+|okei\s+|hei\s+|moi\s+)?(?:mitä|mitkä|millaisia|minkälaisia)\s+(?:kaikkea\s+|kaikki\s+)?(?:tuottei\p{L}*\s+)?(?:teillä|teiltä|sulla|sulta|sinulla|sinulta|täältä|täällä|voi|voin|saa|saan|on|löytyy|myytte|valikoima\p{L}*)(?:\s+\p{L}+){0,4}[?!.\s]*$/iu;
export const isAssortmentQuestion = (text) => {
  const t = String(text || '').trim();
  return t.length <= 80 && !/\d/u.test(t) && ASSORTMENT.test(t) && /tuott|valikoim|teillä|teiltä|sulla|sulta|sinulla|sinulta|tilata|myytte|tarjolla|löytyy/iu.test(t);
};
