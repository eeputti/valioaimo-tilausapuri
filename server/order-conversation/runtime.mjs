// Valmis kokoonpano kytkentää varten (henkilö 1): luonnoskanta, tuotetyökalut ja tulkki oletusriippuvuuksilla.
// Ilman Anthropic-avainta keskustelu tulkitaan säännöillä.
import { storefrontCartProjection } from '../storefront-whatsapp-sync.mjs';
import { cartNotes } from '../cart-notes.mjs';
import { shoppingListView } from '../shopping-list/index.mjs';
import { openDraftStore } from './store.mjs';
import { createOrderingConversation, lastConfirmedOrder, popularityCounts, usualOrder } from './index.mjs';
import { createRuleInterpreter, createModelInterpreter } from './interpret.mjs';
import { createOrderingTools } from '../order-tools/index.mjs';

// Hintojen vienti korisivulle ja kaupan synkronoinnille: useampi välimuistipaikka, jotta eri asiakkaat ja korin versiot
// eivät syrjäytä toisiaan, ja saman avaimen samanaikaiset pyynnöt odottavat yhtä tarjousta. Arvo on voimassa enintään
// ttl-ajan tai tarjouksen voimassaolon loppuun. Vanhentuneet poistetaan, ja koko on rajattu (katselmus #23).
export function createExportCache({ now = Date.now, slots = 64, ttl = 30000 } = {}) {
  const values = new Map(); const inflight = new Map();
  return async function cached(key, compute) {
    const hit = values.get(key);
    if (hit?.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      const { value, expiresAt } = await compute();
      for (const [k, v] of values) if (v.until <= now()) values.delete(k);
      values.delete(key); values.set(key, { value, until: Math.min(now() + ttl, Number.isFinite(expiresAt) ? expiresAt : now()) });
      while (values.size > slots) values.delete(values.keys().next().value);
      return value;
    })();
    inflight.set(key, pending);
    try { return await pending; } finally { inflight.delete(key); }
  };
}

/** @param {{draftDb?: string, quoteDb?: string, permissions?: Function, now?: () => number}} [o] */
export async function createConfiguredOrdering({ draftDb = ':memory:', quoteDb = ':memory:', permissions, now } = {}) {
  const [{ understand, deliveryDatesIn, deliveryDateCue }, { askAgent, agentEnabled }, { clock }] = await Promise.all([import('../aimo/understand.mjs'), import('../aimoAgent.mjs'), import('../gateway/clock.mjs')]);
  const time = now || (() => clock.now().getTime());
  const store = openDraftStore(draftDb, time);
  // Suosituimmat: kaikkien asiakkaiden vahvistetut tilaukset, laskettu enintään kerran minuutissa.
  let popular = null;
  const popularity = async () => {
    if (popular && popular.until > Date.now()) return popular.counts;
    const { orders } = await import('../gateway/store.mjs');
    popular = { counts: popularityCounts(orders.list(null, 500)), until: Date.now() + 60_000 };
    return popular.counts;
  };
  const tools = createOrderingTools({ dbPath: quoteDb, now: time, popularity, ...(permissions ? { permissions } : {}) });
  const rules = createRuleInterpreter({ understand });
  const interpretTurn = agentEnabled() ? createModelInterpreter({ ask: askAgent, fallback: rules, datesIn: deliveryDatesIn, dateCue: deliveryDateCue, reread: true }) : rules;
  // "Sama kuin viime kerralla": saman ostajan viimeisin vahvistettu tilaus gatewaysta, hakusana tuotenimestä.
  const termOf = (name) => { const item = understand(name).items[0]; return item ? { productTerm: item.productTerm, claims: item.claims || [] } : {}; };
  const lastOrder = async (customer) => {
    const { orders } = await import('../gateway/store.mjs');
    return lastConfirmedOrder(orders.list(customer.buyerId, 20), termOf);
  };
  // "Se tavallinen": saman ostajan toistuvat tuotteet vahvistetuista gateway-tilauksista tavallisella määrällä.
  const usual = async (customer) => {
    const { orders } = await import('../gateway/store.mjs');
    return usualOrder(orders.list(customer.buyerId, 50), termOf);
  };
  const handleTurn = createOrderingConversation({ store, tools, interpretTurn, now: time, lastOrder, usualOrder: usual });
  const cachedExport = createExportCache({ now: time });
  // Korisivun huomiot samasta tarjouksesta, Valion tuotetiedoista ja ostajan omista gateway-tilauksista (ei mallia).
  const notesFor = async (list, quote, customer) => {
    if (quote.issues?.length) return [];
    const [{ orders }, { loadCatalog }] = await Promise.all([import('../gateway/store.mjs'), import('../catalog.mjs')]);
    const cat = loadCatalog();
    return cartNotes({ list, quote, orders: orders.list(customer.buyerId, 50), product: (id) => cat.get(String(id)), cycle: clock.looping ? clock.cycle() : null });
  };
  // Luonnos näkyy korisivulle vain sen omistajalle (shoppingListView tarkistaa asiakkaan ja yhteyden version).
  const emptyCart = (customer) => ({ source: `whatsapp:${customer.buyerId}`, state: 'empty', lines: [] });
  const listFor = (conversationId, customer) => shoppingListView(store.active(conversationId), customer);
  async function storefrontCart({ conversationId, customer }) {
    const draft = store.active(conversationId);
    const list = shoppingListView(draft, customer);
    if (!list) return emptyCart(customer);
    // Keskeneräiselle korille ei pyydetä tarjousta: sivu näyttää vain, mitä WhatsAppissa pitää vielä täydentää.
    if (list.status === 'review') {
      const key = [customer.customerId, customer.bindingVersion, list.id, list.revision].join(':');
      return cachedExport(key, async () => {
        const quote = await tools.quote({ customer, draft });
        return { value: storefrontCartProjection(list, quote, await notesFor(list, quote, customer)), expiresAt: Date.parse(quote.expiresAt) };
      });
    }
    return storefrontCartProjection(list, null);
  }
  // Onko viestille jo tallennettu tulos, ja kuuluuko sen luonnos juuri tälle asiakkaalle ja yhteydelle.
  function ownsTurnResult({ messageId, customer }) {
    const draftId = store.result(messageId)?.draftId;
    const draft = draftId ? store.get(draftId) : null;
    if (!draft) return false;
    return draft.customerId === customer.customerId && draft.bindingVersion === customer.bindingVersion;
  }
  // store ja tools: v2-agentin työkalut käyttävät samaa luonnosvarastoa ja samoja tuotetyökaluja, jotta korisivu ja TILAA
  // näkevät saman luonnoksen ja tarjouksen (docs/agent-v2.md).
  return {
    handleTurn, store, tools,
    getStorefrontCart: storefrontCart,
    getShoppingList: ({ conversationId, customer }) => listFor(conversationId, customer),
    hasTurnResult: ownsTurnResult,
    prune: () => { store.prune(); tools.prune(); },
    close: () => { store.close(); tools.close(); },
  };
}
