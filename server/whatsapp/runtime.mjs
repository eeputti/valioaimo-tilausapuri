import { fileURLToPath } from 'node:url';
import { openWhatsAppStore } from './store.mjs';
import { createMetaSender, createMetaTypingIndicator, createWhatsAppChannel, gatherSettings, humanPartPause } from './channel.mjs';
import { bootstrapDemoMember, createDemoOrderingChat, validateOrderingEnvironment } from './ordering.mjs';
import { createShoppingListHandoff } from './shopping-list.mjs';
import { createWebDemo } from './web-demo.mjs';
import { createCartLink } from './cart-link.mjs';
import { createStorefrontCartPage } from './storefront-cart.mjs';
import { withDemoCheckout, handleDemoCheckoutAsset } from './checkout.mjs';
import { createWebChat } from './web-chat.mjs';
import { createOrderPaidNotice } from './order-paid.mjs';
import { createMediaReader, createMetaMediaFetcher } from './media.mjs';
import { createConfiguredTranscriber } from './transcribe.mjs';
import { config, llmEnabled } from '../config.mjs';

// Paikalliset kannat ovat repon data/-hakemistossa, ellei ympäristö anna omaa polkua (pilvessä Turso-osoite).
const dataFile = (name) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
export function whatsappDbPath() {
  return process.env.WHATSAPP_DB || dataFile('whatsapp.db');
}

// Asetuksen nimi botissa → ympäristömuuttuja. Kaikki ovat pakollisia.
const REQUIRED_SETTINGS = {
  phoneId: 'WHATSAPP_PHONE_NUMBER_ID',
  accessToken: 'WHATSAPP_ACCESS_TOKEN',
  appSecret: 'WHATSAPP_APP_SECRET',
  verifyToken: 'WHATSAPP_VERIFY_TOKEN',
  supportContact: 'WHATSAPP_SUPPORT_CONTACT',
  apiVersion: 'WHATSAPP_API_VERSION',
};
export function whatsappSettings(source = process.env) {
  const settings = {};
  for (const [key, variable] of Object.entries(REQUIRED_SETTINGS)) settings[key] = source[variable]?.trim();
  if (Object.values(settings).includes(undefined) || Object.values(settings).includes('')) {
    throw new Error('WhatsApp-asetuksia puuttuu. Katso docs/whatsapp.md.');
  }
  // Numeron tunniste päätyy Graph API -osoitteeseen, joten vain numerot ja muotoa vNN.N oleva versio kelpaavat.
  const plainId = /^\d+$/.test(settings.phoneId);
  const knownVersion = /^v\d+\.\d+$/.test(settings.apiVersion);
  if (!plainId || !knownVersion) throw new Error('WhatsApp-numeron tunniste tai Graph API -versio on virheellinen.');
  return settings;
}

/** Vanhentuneen vastauksen uusinta (channel.mjs) vain, kun v2-agentti vastaa: WHATSAPP_AGENT=v2 ja agentti on käytössä
 *  (ilman API-avainta v2-asetus käyttää vanhaa putkea). Vanha putki kirjaa jokaisen vastauksensa lähetetyksi, joten sen
 *  vastaus lähtee aina, ja myöhempi viesti saa oman vuoronsa (katselmus 19.11.). */
export const redoWhenAgent = (ordering) => async () => Boolean(await ordering?.usesAgent?.());

// Ilman tilaustilaa (WHATSAPP_ORDERING_ENABLED ei ole true) botti ei keskustele: liitetty numero saa vain tämän
// ilmoituksen. Tuotanto ajaa aina tilaustilassa.
const ORDERING_OFF_REPLY = 'Tilausapuri ei ole nyt käytössä.';
const orderingOffChat = async () => ({ text: ORDERING_OFF_REPLY });

// Tilaustilan osat: tilauskeskustelu maksulinkkeineen samaan prosessiin kuin gatewayn kanta.
function createOrdering(store, settings, onCheckout) {
  bootstrapDemoMember(store);
  const conversation = createDemoOrderingChat({ store, phoneId: settings.phoneId, supportContact: settings.supportContact,
    draftDb: process.env.WHATSAPP_DRAFT_DB || dataFile('whatsapp-drafts.db'),
    quoteDb: process.env.WHATSAPP_QUOTE_DB || dataFile('whatsapp-quotes.db'),
  });
  // Maksulinkki on tilauksen oma: sen tunniste lasketaan tilauksen luontiajasta (gatewayn kanta, sama prosessi).
  const gatewayOrder = async (orderId) => (await import('../gateway/store.mjs')).orders.get(orderId);
  return withDemoCheckout(conversation, { baseUrl: process.env.CLOUDFLARE_DEMO_URL, secret: process.env.WEBCHAT_SECRET?.trim(),
    orderCreatedAt: async (orderId) => (await gatewayOrder(orderId))?.createdAt || null, onCheckout });
}

// Kuvat ja ääniviestit vain tilaustilassa. Kuvan luku tarvitsee Clauden, ääniviestit erikseen valitun litterointipalvelun.
function createMedia(store, settings) {
  if (process.env.WHATSAPP_MEDIA === 'false') return null;
  const vision = llmEnabled() && config.llmProvider === 'anthropic';
  return createMediaReader({ db: store.db, fetchMedia: createMetaMediaFetcher(settings), vision, transcriber: createConfiguredTranscriber() });
}

export function createConfiguredWhatsApp({ onCheckout } = {}) {
  const settings = { ...whatsappSettings(), orderingDemo: process.env.WHATSAPP_ORDERING_ENABLED === 'true' };
  if (settings.orderingDemo) validateOrderingEnvironment();
  const store = openWhatsAppStore(whatsappDbPath());
  const send = createMetaSender(settings);
  const ordering = settings.orderingDemo ? createOrdering(store, settings, onCheckout) : null;
  const cartLink = ordering && createCartLink({ store, ordering, baseUrl: process.env.WHATSAPP_PUBLIC_URL, secret: settings.appSecret });
  const media = ordering && createMedia(store, settings);

  const channel = createWhatsAppChannel({ settings, store, chat: cartLink?.chat || ordering?.chat || orderingOffChat, media: media || null,
    onPrune: () => { ordering?.prune(); media?.prune(); }, send, typing: createMetaTypingIndicator(settings),
    // Lähekkäin tulleet viestit yhdeksi vuoroksi (WHATSAPP_GATHER_MS, oletus 6 s ja enintään 20 s; 0 = pois) ja ihmismäinen tauko osien välissä.
    // Valmiin vastauksen uusinta asiakkaan kirjoittaessa lisää vain v2-agentille.
    ...gatherSettings(), redo: redoWhenAgent(ordering), partPause: humanPartPause });

  // Korilinkin osat ovat käytössä vain, kun korisivulla on julkinen osoite (WHATSAPP_PUBLIC_URL).
  const cartParts = cartLink ? {
    // Korilinkin sivu kaupan ostoskorin ulkoasulla (vain staattiset tiedostot; API on cartLinkissä).
    page: createStorefrontCartPage(),
    // Workers-sivuston selainkeskustelu: vain WEBCHAT_SECRETin tunteva Worker voi kutsua.
    webChat: createWebChat({ store, chat: cartLink.chat, cartLink: cartLink.linkFor, shoppingList: (member) => ordering.getShoppingList(member),
      secret: process.env.WEBCHAT_SECRET?.trim() }),
  } : null;
  const orderingParts = ordering ? {
    // Maksun jälkeinen kiitosviesti WhatsAppiin: Worker kutsuu, kun demomaksu on hyväksytty (order-paid.mjs).
    orderPaid: createOrderPaidNotice({ store, send, secret: process.env.WEBCHAT_SECRET?.trim(),
      findOrder: async (orderId) => (await import('../gateway/store.mjs')).orders.get(orderId) || null }),
    handoff: createShoppingListHandoff({ store, ordering, defaultPhone: process.env.WHATSAPP_DEMO_PHONE }),
    // Selaindemo on olemassa vain tilaustilassa, jolloin kannat ovat eristetyt.
    webDemo: createWebDemo({ store, chat: ordering.chat }),
  } : null;
  // Reitit tarkistusjärjestyksessä: ensimmäinen, joka tunnistaa polun, vastaa. Ilman tilaustilaa vain webhook on käytössä.
  const routeOf = (part) => part && ((req, res, url) => part.handle(req, res, url));
  const routes = [
    cartLink && handleDemoCheckoutAsset,
    routeOf(cartParts?.page),
    routeOf(cartLink),
    routeOf(orderingParts?.orderPaid),
    routeOf(cartParts?.webChat),
    routeOf(channel),
    routeOf(orderingParts?.handoff),
    routeOf(orderingParts?.webDemo),
  ].filter(Boolean);

  return { ...channel, store,
    // Pilviversio siivoaa ajastetusti, koska siellä ei ole start()-silmukkaa.
    prune() { store.prune(); ordering?.prune(); media?.prune(); },
    async handle(req, res, url = new URL(req.url, 'http://localhost')) {
      for (const route of routes) {
        const handled = await route(req, res, url);
        if (handled) return handled;
      }
      return false;
    },
    async close() {
      try { await channel.stop(); await ordering?.close(); }
      finally { store.close(); }
    } };
}
