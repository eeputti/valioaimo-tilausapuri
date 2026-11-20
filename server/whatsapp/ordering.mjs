// Explicit demo adapter. Production customer identity remains Valio's integration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createDemoBuyerResolver } from './demo-buyer.mjs';
import { codeHash, phoneNumber } from './store.mjs';
import { createConfiguredLinkAdvice } from './link-advice.mjs';


const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// The demo writes orders and price cache rows, so it must never share the storefront's own databases.
export function validateOrderingEnvironment(env = process.env, { cwd = process.cwd(), exists = fs.existsSync } = {}) {
  for (const [name, shared] of [['GATEWAY_DB', 'gateway.db'], ['AIMO_DB', 'aimo.db']]) {
    if (!env[name] || path.resolve(cwd, env[name]) === path.join(ROOT, 'data', shared)) {
      throw new Error(`WhatsApp-tilausdemo tarvitsee oman ${name}-kannan. Katso docs/whatsapp.md.`);
    }
  }
  if (!exists(env.AIMO_CATALOG || path.join(ROOT, 'data', 'catalog.json'))) {
    throw new Error('WhatsApp-tilausdemo tarvitsee paikallisen katalogin (npm run catalog). Katso docs/whatsapp.md.');
  }
}

// Demo-ostajan mandaatti. Ylläpitäjän kutsuma testiasiakas saa tilata 6 000 €:oon asti ilman kuittausta.
// Landing-sivulta itse ilmoittautunut saa pienen rajan: sen ylittävä tilaus jää odottamaan ihmisen hyväksyntää
// (SPEND_CAP_ORDER / SPEND_CAP_DAY), vaikka numero onkin todistettu WhatsApp-viestillä (audit #14).
export const DEMO_BUYER_LIMITS = { admin: { maxOrderNet: 6000, maxDayNet: 8000 }, landing: { maxOrderNet: 300, maxDayNet: 600 } };
export function demoMandate(source, base) {
  return { ...structuredClone(base), approval: 'exceptions', ...(DEMO_BUYER_LIMITS[source] || DEMO_BUYER_LIMITS.landing) };
}

// Koodin omat paikkanimet: testiasiakas ilman WHATSAPP_DEMO_PERSONia ja selainkeskustelun asiakas (web-chat.mjs).
export const DEMO_PERSON = 'Testaaja';
const PLACEHOLDER_PERSONS = new Set([DEMO_PERSON, 'Kokeilija']);

/**
 * v2-agentille annettava asiakas: paikkanimi ei ole henkilön nimi, eikä agentti saa puhutella sillä (livetesti 19.11.:
 * selainkeskustelussa "Moi Kokeilija"). Selainkeskustelun asiakas on aina synteettinen.
 */
export function agentCustomer(customer, channel) {
  const person = String(customer?.personName || '').trim();
  return channel === 'web' || PLACEHOLDER_PERSONS.has(person) ? { ...customer, personName: null } : customer;
}

export function bootstrapDemoMember(store, env = process.env) {
  if (!env.WHATSAPP_DEMO_PHONE) return;
  const phone = phoneNumber(env.WHATSAPP_DEMO_PHONE);
  if (store.member(phone)) return; // preserve the binding and draft on restart
  const invitation = store.invite(phone, 'Testikeittiö (demo)', env.WHATSAPP_DEMO_PERSON || DEMO_PERSON);
  if (!store.pair(phone, codeHash(invitation.code))) throw new Error('Testiasiakkaan yhdistäminen epäonnistui.');
}

// Saman avaimen työt ajetaan yksi kerrallaan saapumisjärjestyksessä. Epäonnistunut työ ei pysäytä seuraavaa, ja
// avain poistuu, kun sen viimeinen työ on valmis.
function createKeyedQueue() {
  const tails = new Map();
  return function enqueue(key, task) {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => task());
    const settled = result.then(() => undefined, () => undefined);
    tails.set(key, settled);
    settled.then(() => { if (tails.get(key) === settled) tails.delete(key); });
    return result;
  };
}

const DIALOGUE_TABLE = "SELECT name FROM sqlite_master WHERE name = 'wa_dialogue' AND type = 'table'";
const demoSites = () => [{ id: 'demo-keittio', label: 'Testikeittiö' }];
const LIST_CHANGED = 'Ostoslista muuttui toisessa kanavassa. Päivitä ja avaa lista uudelleen.';
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Listan versio on tunniste ja versionumero. Puuttuva lista ja puuttuva odotus ovat sama versio (null, null).
function sameListVersion(list, expected) {
  return (list?.id || null) === (expected?.id || null) && (list?.revision ?? null) === (expected?.revision ?? null);
}

// agentMode: WHATSAPP_AGENT=v2 kytkee Claude-agentin (server/agent, docs/agent-v2.md) WhatsAppiin ja selainkeskusteluun.
// Ilman asetusta vanha putki toimii täsmälleen ennallaan. Korisivun polku (expectedList) pysyy vanhalla moottorilla myös v2:ssa.
export function createDemoOrderingChat({ store, phoneId, draftDb, quoteDb, loadOrdering, resolveBuyer = createDemoBuyerResolver(), supportContact,
  agentMode = process.env.WHATSAPP_AGENT } = {}) {
  const v2 = String(agentMode || '').trim().toLowerCase() === 'v2';
  let runtime; let pending;
  const enqueue = createKeyedQueue();
  const memberByBinding = (binding) => store.db.prepare('SELECT * FROM members WHERE binding = ?').get(binding);

  // Aloita alusta vaihtaa dialogin epookin, jolloin tilausmoottori aloittaa uuden keskustelun samalla yhteydellä.
  function dialogueEpoch(binding) {
    if (!store.db.prepare(DIALOGUE_TABLE).get()) return '';
    const saved = store.db.prepare('SELECT json FROM wa_dialogue WHERE binding = ?').get(binding);
    return saved ? JSON.parse(saved.json).epoch || '' : '';
  }
  // Ilman epookkia käytetään dialogin nykyistä. Tyhjä merkkijono tarkoittaa yhteyden alkuperäistä keskustelua.
  function conversationKey(customer, epoch) {
    const session = epoch === undefined ? dialogueEpoch(customer.bindingVersion) : epoch;
    const base = [phoneId, customer.customerId, customer.bindingVersion].join(':');
    return session ? `${base}:session:${session}` : base;
  }

  // Tilausmoottorin asiakas johdetaan aina palvelimen jäsentiedoista, ei viestistä eikä selaimesta.
  function customerFor(member) {
    const { customerId, buyerId } = resolveBuyer(member);
    const companyName = runtime?.buyerName?.(buyerId) || member.company;
    return {
      customerId, buyerId, bindingVersion: member.binding, companyName, personName: member.person,
      source: 'demo', deliverySites: demoSites(), permissions: { readProducts: true, placeOrders: true },
    };
  }
  // Oikeudet tarkistetaan kannasta joka kerta: poistettu tai uudelleen liitetty numero menettää ne heti.
  function currentRights(customer) {
    const member = memberByBinding(customer?.bindingVersion || '');
    let allowed = false;
    if (member) {
      const expected = resolveBuyer(member);
      allowed = customer.source === 'demo' && customer.customerId === expected.customerId && customer.buyerId === expected.buyerId;
    }
    return { readProducts: allowed, placeOrders: allowed };
  }
  // Jäsen kelpaa vain, jos numeron nykyinen yhteys on sama kuin pyynnön.
  function liveMember(member) {
    const current = member?.phone ? store.member(member.phone) : null;
    return current && current.binding === member.binding ? current : null;
  }

  const load = loadOrdering || (async (permissions) => {
    const [{ createConfiguredOrdering }, { buyers }, { DEFAULT_MANDATE }, { createConfiguredDialogue }] = await Promise.all([
      import('../order-conversation/runtime.mjs'), import('../gateway/store.mjs'), import('../gateway/mandate.mjs'), import('./dialogue.mjs'),
    ]);
    const ordering = await createConfiguredOrdering({ draftDb, quoteDb, permissions });
    // v2: agentti käyttää samaa luonnosvarastoa, joten korilinkki, korisivu, tarjous ja maksu toimivat ennallaan.
    const agent = v2 ? await (await import('../agent/index.mjs')).createConfiguredAgent({ store: ordering.store,
      orderingTools: ordering.tools, draftDb: draftDb || ':memory:' }) : null;
    // Demon ostaja luodaan kauppaan ensimmäisellä vuorolla. Asetuksilla kiinnitetty ostaja pitää alustaa etukäteen.
    function ensureBuyer(customer) {
      if (buyers.byId(customer.buyerId)) return;
      const member = memberByBinding(customer.bindingVersion);
      if (member && resolveBuyer(member).mapped) throw new Error('Valittua demoasiakasta ei löydy. Alusta kaupan asiakas ennen numeroliitosta.');
      const source = store.memberSource?.(customer.bindingVersion) || 'admin';
      buyers.save({
        id: customer.buyerId, name: customer.companyName, kind: source === 'landing' ? 'WhatsApp-kokeilija (itse ilmoittautunut)' : 'WhatsApp-testiasiakas',
        apiKey: crypto.randomBytes(32).toString('hex'), approver: 'Testaaja',
        mandate: demoMandate(source, DEFAULT_MANDATE),
      });
    }
    return { ...ordering, agent, close() { agent?.close(); ordering.close(); }, buyerName: (id) => buyers.byId(id)?.name,
      dialogue: await createConfiguredDialogue(store, { supportContact }), links: await createConfiguredLinkAdvice(store), ensureBuyer };
  });
  const getRuntime = () => (pending ||= Promise.resolve().then(() => load(currentRights)).then((value) => (runtime = value)));

  // Kaupan ja korisivun lukupyynnöt: sama jono kuin viesteillä, voimassa oleva yhteys ja lukuoikeus.
  function readAs(member, deniedText, read) {
    return enqueue(member?.binding, async () => {
      const current = liveMember(member);
      if (!current) throw httpError(403, 'Testiyhteys ei ole voimassa.');
      const ordering = await getRuntime();
      const customer = customerFor(current);
      if (!currentRights(customer).readProducts) throw httpError(403, deniedText);
      return read({ ordering, customer, current });
    });
  }

  const bridge = {
    getAccount(member) {
      return readAs(member, 'Ei käyttöoikeutta.', ({ customer, current }) =>
        ({ buyerId: customer.buyerId, companyName: customer.companyName, personName: current.person }));
    },
    getShoppingList(member) {
      return readAs(member, 'Testiyhteys ei ole enää voimassa.', ({ ordering, customer }) =>
        ordering.getShoppingList?.({ conversationId: conversationKey(customer), customer }) || null);
    },
    getStorefrontCart(member, expectedDraftId) {
      return readAs(member, 'Ei käyttöoikeutta.', async ({ ordering, customer }) => {
        const conversationId = conversationKey(customer);
        const list = ordering.getShoppingList({ conversationId, customer });
        // Korilinkki koskee yhtä luonnosta. Uusi luonnos tarkoittaa, että linkki on vanhentunut.
        if (list && list.id !== expectedDraftId) throw httpError(410, 'Korilinkki ei koske nykyistä koria.');
        const cart = await ordering.getStorefrontCart({ conversationId, customer });
        if (!currentRights(customer).readProducts) throw httpError(403, 'Ei käyttöoikeutta.');
        return cart;
      });
    },
    chat(args) {
      return enqueue(args.member?.binding, () => bridge.chatTurn(args));
    },
    /** Vastaako v2-agentti WhatsAppin ja selainkeskustelun viesteihin. cart-link.mjs ohittaa silloin vanhan korilinkkilogiikan. */
    async usesAgent() { return v2 && Boolean((await getRuntime())?.agent); },
    async chatTurn({ member, messageId, receivedAt, messages, expectedList, cartLinkAvailable = false, channel = '', plain = false, incoming, discardedReply }) {
      const current = liveMember(member);
      if (!current || !messageId) return { text: 'Testiyhteys ei ole voimassa. Pyydä ylläpitäjältä uusi yhdistäminen.' };
      const ordering = await getRuntime();
      const customer = customerFor(current);
      const allowed = () => currentRights(customer).readProducts;
      if (!allowed()) return { text: 'Testiyhteys ei ole enää voimassa.' };
      const fromCart = expectedList !== undefined;
      if (v2 && ordering.agent && !fromCart) {
        // v2: Claude-agentti vastaa. Niputettu vuoro tuo viestit erikseen (incoming); muuten vuoron viesti on viimeinen viesti.
        ordering.ensureBuyer?.(customer);
        const text = String(messages?.at(-1)?.content || '');
        const result = await ordering.agent.respond({ customer: agentCustomer(customer, channel), conversationId: conversationKey(customer), messageId,
          incoming: Array.isArray(incoming) && incoming.length ? incoming : [{ text, at: receivedAt ?? null }], discardedReply,
          channel: channel === 'web' ? 'web' : 'whatsapp', cartLinkAvailable: cartLinkAvailable === true });
        if (!allowed()) return { status: 'error', text: 'Testiyhteys ei ole enää voimassa.' };
        return result;
      }
      const currentList = (epoch) => ordering.getShoppingList?.({ conversationId: conversationKey(customer, epoch), customer }) || null;
      // Korisivun muutos koskee vain sitä versiota, jonka sivu näki. Jo käsitellyn viestin uusinta saa aiemman tuloksensa.
      if (fromCart && !ordering.hasTurnResult?.({ messageId, customer }) && !sameListVersion(currentList(), expectedList)) {
        throw httpError(409, LIST_CHANGED);
      }
      ordering.ensureBuyer?.(customer);
      const runOrder = (text, { epoch = '', operation = '', context } = {}) => ordering.handleTurn({
        messageId: operation ? `${messageId}:${operation}` : messageId,
        conversationId: conversationKey(customer, epoch),
        receivedAt, customer, context, text,
      });
      const listForEpoch = ({ epoch = '' } = {}) => currentList(epoch);
      let text = messages.at(-1)?.content || '';
      const respond = (input) => ordering.dialogue ? ordering.dialogue.respond({ binding: current.binding, messageId, text: input, runOrder,
        getShoppingList: listForEpoch,
        canOpenCart: cartLinkAvailable === true && !fromCart,
        inCart: fromCart, receivedAt, plain, allowed }) : runOrder(input);
      // "unohda kaikki. katso tää https://…": nollaus ensin, sitten linkki. Muuten linkkipolku ohitti nollauksen ja vanha kori
      // jäi voimaan (WhatsApp-koe 17.11.).
      let resetNote = null;
      if (ordering.dialogue && /(?:https?:\/\/|www\.)\S+/iu.test(text)) {
        // Vain virkkeen raja (välimerkki ja väli tai rivinvaihto): osoitteen pisteet eivät pilko viestiä.
        const [head, ...rest] = text.split(/(?<=[.!?])\s+|\n+/u);
        if (rest.length && ordering.dialogue.isFreshStart?.(head)) {
          await ordering.dialogue.respond({ binding: current.binding, messageId: `${messageId}:reset`, text: head, runOrder,
            getShoppingList: listForEpoch, canOpenCart: false, inCart: fromCart, receivedAt, allowed });
          resetNote = 'Selvä, tyhjensin vanhan ostoslistan.';
          text = rest.join(' ').trim();
        }
      }
      const linked = await ordering.links?.respond({ binding: current.binding, messageId, text,
        shoppingList: currentList(), runOrder: respond, allowed, customer, channel });
      let result = linked || await respond(text);
      if (resetNote) result = { ...result, messages: [resetNote, ...(result.messages || [result.text])], text: [resetNote, result.text].filter(Boolean).join('\n\n') };
      if (!allowed()) return { status: 'error', text: 'Testiyhteys ei ole enää voimassa.' };
      if (!fromCart) return result;
      // Korisivulle luettava lista: oikeus tarkistetaan vielä juuri ennen lukua. Pilvessä toinen instanssi voi poistaa
      // numeron kahden kantakyselyn välissä.
      if (!allowed()) throw httpError(403, 'Testiyhteys ei ole enää voimassa.');
      // Vastaus ja luonnos luetaan saman asiakasjonon sisällä: myöhempi WhatsApp-vuoro ei saa liittää uudempaa versiota
      // vanhempaan yhteenvetoon ja näin hyväksyä sitä vahingossa.
      const latest = currentList();
      const drifted = latest && result.draftId && !(latest.id === result.draftId && latest.revision === result.revision);
      if (drifted) throw httpError(409, LIST_CHANGED);
      return { ...result, shoppingList: latest };
    },
    prune() { runtime?.prune(); runtime?.dialogue?.prune(); runtime?.links?.prune(); runtime?.agent?.prune?.(); },
    async close() { if (pending) (await pending).close(); },
  };
  return bridge;
}
