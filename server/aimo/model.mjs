// AIMO-MALLIN KIELIMALLIOSA. Tätä kutsutaan vain, kun sääntökerros (understand.mjs) ilmoittaa itse, ettei ymmärtänyt.
// "Oma malli" ei ole erikseen koulutettu verkko, vaan valmis kielimalli (Claude Haiku) + Aimon datasta generoitu
// toimialakortti + tiukka tulosskeema + tarkistus Aimon sanastoa vasten. Sama rakenne kuin DM Champilla ja
// Zalando Assistantilla: kielimalli tulkitsee, tuotteet ja faktat tulevat aina omasta datasta.
import { askAgent, warmAgent, agentEnabled, modelFor } from '../aimoAgent.mjs';
import { loadLexicon, conceptOf } from './lexicon.mjs';

export const CLAIM_CODES = ['FREE_FROM_LACTOSE', 'LOW_LACTOSE', 'FREE_FROM_GLUTEN', 'VEGAN', 'VEGETARIAN', 'EU_ORGANIC_FARMING', 'MARINE_STEWARDSHIP_COUNCIL_LABEL', 'FAIR_TRADE_MARK'];

export const REQUEST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['intent', 'items', 'deliveryDate', 'unclear'],
  properties: {
    intent: { type: 'string', enum: ['order', 'search', 'question', 'other'] },
    deliveryDate: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD tai null, jos päivää ei mainita' },
    unclear: { type: 'array', items: { type: 'string' }, description: 'Viestin kohdat, joita et pystynyt tulkitsemaan varmasti' },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['productTerm', 'heard', 'claims', 'quantity'],
        properties: {
          heard: { type: 'string', description: 'Sana täsmälleen sellaisena kuin ostaja sen kirjoitti, esim. "pottuu", "maetoo", "jätskii"' },
          productTerm: { type: 'string', description: 'Tuotteen pääsana suomeksi perusmuodossa, esim. "maito", "kuohukerma", "broilerin rintafilee"' },
          claims: { type: 'array', items: { type: 'string', enum: CLAIM_CODES } },
          excludeAllergens: { type: 'array', items: { type: 'string' } },
          // Nullattavat kentät anyOf-muodossa: rajapinta hylkää enum-listan, jossa on null merkkijonotyypin rinnalla.
          brand: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          countryOfOrigin: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          fat: { anyOf: [{ type: 'string', enum: ['fat-free', 'semi-skimmed', 'whole'] }, { type: 'null' }] },
          quantity: { anyOf: [{ type: 'object', additionalProperties: false, required: ['value', 'unit', 'basis'], properties: { value: { type: 'number' }, unit: { type: 'string', enum: ['L', 'KG', 'PCS'] }, basis: { type: 'string', enum: ['items', 'sales'] } } }, { type: 'null' }] },
        },
      },
    },
  },
};

let cardCache;
/** Toimialakortti: generoidaan Aimon katalogista, ei kirjoiteta käsin. Sama teksti joka kutsulla → välimuistiin (prompt caching). */
export function domainCard() {
  if (cardCache) return cardCache;
  const { categories, brands, stats } = loadLexicon();
  const groups = [...categories.values()].filter((c) => c.size >= 15 && c.words.length).sort((a, b) => b.size - a.size).slice(0, 140).map((c) => `${c.id}: ${c.words.slice(0, 4).join(', ')} (${c.size})`).join('\n');
  const topBrands = [...brands.values()].sort((a, b) => b.n - a.n).slice(0, 80).map((b) => b.name).join(', ');
  cardCache = `# Rooli ja tavoite
Olet Valio Aimon tilausten tulkki. Muunnat ammattikeittiön ostajan vapaamuotoisen pyynnön (suomea, englantia, puhekieltä, sanelua, lyhenteitä) rakenteiseksi ostopyynnöksi. Yksi tavoite: jokainen pyydetty tuote omaksi rivikseen oikealla määrällä, yksiköllä ja rajauksilla. Et valitse tuotteita, et kerro hintoja etkä lupaa saatavuutta: ne tekee Aimon rajapinta sinun jälkeesi.

# Aimon valikoima (generoitu tuotedatasta: ${stats.products} tuotetta, ${stats.categories} tuoteryhmää, ${stats.brands} merkkiä)
Tuoteryhmät muodossa "koodi: tyypillisimmät sanat (tuotemäärä)":
${groups}

Yleisimmät merkit: ${topBrands}

# Säännöt
- productTerm on aina suomeksi ja perusmuodossa, ja sen pitää olla sana, jolla tuote löytyy yllä olevista ryhmistä. Käännä englanti suomeksi ("whipping cream" → "kuohukerma", "skimmed milk" → "rasvaton maito" → productTerm "maito", fat "fat-free").
- Ruokavaliorajaus on väittämä (claims), ei osa tuotesanaa. "Laktoositon" on FREE_FROM_LACTOSE; "vähälaktoosinen" on LOW_LACTOSE. Ne eivät ole sama asia, älä koskaan vaihda toista toiseen.
- "Ilman pähkinää", "nut-free", "ei soijaa" ovat excludeAllergens (GS1-koodit: AN pähkinät, AP maapähkinä, AY soija, AE kananmuna, AF kala, AM maito, AS seesami, UW vehnä).
- Määrä ostajan omassa yksikössä: L (litrat), KG (kilot) tai PCS (kappaleet, laatikot, tölkit, pussit). Muunna dl, cl, ml ja g. Älä muunna litroja laatikoiksi: sen tekee rajapinta tuotedatasta.
- PCS-määrän basis erottaa yksittäiset tuotteet ja myyntipakkaukset: "100 kananmunaa" ja "100 kpl kananmunia" ovat basis "items"; "100 rasiaa kananmunia" on basis "sales". Sama koskee kaikkia tuotteita: "10 kpl leivoksia", "10 leivosta" ja "12 kurkkua" ovat basis "items" (kappaleita), "2 laatikkoa", "3 pakettia", "5 rasiaa" ja "4 säkkiä" basis "sales" (myyntipakkauksia). Älä päättele kappaleiden määrää pakkauksessa, se luetaan tuotetiedoista.
- Jos määrää ei sanota, quantity on null. Älä arvaa määrää.
- Päivä: laske suhteelliset päivät ("maanantaiksi", "tomorrow") käyttäjän viestin mukana annetusta nykyhetkestä. Jos päivää ei sanota, deliveryDate on null.
- Ostajat kirjoittavat puhekieltä, murretta ja kirjoitusvirheitä ("pottuu", "maetoo", "jätskii", "limsaa"). Päättele tarkoitettu tuote ja anna productTerm valikoiman sanalla ("peruna", "maito", "jäätelö", "virvoitusjuoma"). Kenttään heard tulee ostajan oma sana muuttamattomana.
- Älä lisää rivejä, joita viestissä ei pyydetä. Älä keksi merkkiä.

# Kulku
1. Tunnista aikomus: order (tilaa), search (kysyy valikoimasta), question (kysyy tilauksesta tai toimituksesta), other.
2. Pilko viesti tuoteriveiksi.
3. Täytä jokaiselle riville kentät.
4. Listaa kohtaan unclear kaikki, mitä et pystynyt tulkitsemaan varmasti.

# Ohjaa ihmiselle kun
Viesti ei ole ostopyyntö (reklamaatio, laskutus, sopimus) tai et tunnista siitä yhtään tuotetta: palauta intent "other" ja tyhjä items. Älä yritä vastata itse.

# Valmis kun
Jokainen viestin tuote on rivinä tai mainittu kohdassa unclear. Palauta vain skeeman mukainen JSON.`;
  return cardCache;
}

export const modelStats = { calls: 0, lastMs: null, cacheReadTokens: 0, rejectedTerms: 0 };

/** Lämmitys käynnistyksessä: SDK ja sanasto muistiin, ettei demon ensimmäinen kutsu ole hitain. */
export async function warm() { loadLexicon(); await warmAgent(); }

/**
 * Kielimallin tulkinta. Tulos tarkistetaan Aimon sanastoa vasten: tuotesana, jota katalogi ei tunne, ei mene läpi
 * vaan päätyy kohtaan unparsed. Kielimalli ehdottaa, koodi päättää.
 */
export async function interpretWithModel(text, now) {
  if (!agentEnabled()) return null;
  const today = new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Hidas malli ei saa jumittaa tilausta: aikakatkaisun jälkeen jatketaan säännöillä.
  const r = await askAgent({ purpose: 'interpret_request', system: domainCard(), user: `Nykyhetki (Europe/Helsinki): ${today}\n\nOstajan viesti:\n${text}`, schema: REQUEST_SCHEMA, timeoutMs: 6000, retries: 0 });
  modelStats.calls += 1;
  modelStats.lastMs = r.ms;
  modelStats.cacheReadTokens += r.usage.cacheRead;
  const out = r.json;

  const lex = loadLexicon();
  const items = []; const unparsed = [...(out.unclear || [])];
  for (const it of out.items || []) {
    const words = String(it.productTerm || '').toLowerCase().split(/\s+/).filter(Boolean);
    const concepts = words.map(conceptOf).filter(Boolean);
    if (!concepts.length) { modelStats.rejectedTerms += 1; unparsed.push(it.productTerm); continue; } // malli ehdotti sanaa, jota Aimon data ei tunne
    const head = concepts.at(-1);
    const quantity = it.quantity && it.quantity.value > 0 ? it.quantity : null;
    const brand = it.brand && lex.brands.get(it.brand.toLowerCase()) ? lex.brands.get(it.brand.toLowerCase()).name : null; // merkki vain jos se on katalogissa
    items.push({
      heard: String(it.heard || '').toLowerCase().trim(),
      raw: it.productTerm, productTerm: concepts.map((c) => c.word).join(' '), productType: null,
      category: head.top[0].share >= 0.3 ? head.top[0].category : null,
      categories: head.top[0].share < 0.5 ? head.top.filter((t) => t.share >= 0.12).map((t) => t.category) : undefined,
      categoryLabel: lex.categories.get(head.top[0].category)?.label || null,
      claims: (it.claims || []).filter((c) => CLAIM_CODES.includes(c)), excludeAllergens: (it.excludeAllergens || []).filter((a) => /^[A-Z]{2}$/.test(a)),
      brand, countryOfOrigin: it.countryOfOrigin === 'fi' ? 'fi' : null, attributes: it.fat ? { fat: it.fat } : {}, quantity,
    });
  }
  return { intent: out.intent, items, deliveryDate: /^\d{4}-\d{2}-\d{2}$/.test(out.deliveryDate || '') ? out.deliveryDate : null, unparsed, via: modelFor('fast'), modelMs: modelStats.lastMs };
}
