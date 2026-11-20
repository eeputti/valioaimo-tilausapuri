// Kiinnitetty demo-ostaja (Kahvila Aalto). Vain asetuksissa nimetty numero saa ostajan, ja sama ostaja näkyy
// WhatsApp-vuorossa, kaupan asiakasvalikossa, ostoslistan siirrossa ja korisivun hintanäkymässä.
// Katalogi on keksitty, hinnat ovat valeita eikä tilausta lähetetä.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeHash, openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel } from '../server/whatsapp/channel.mjs';
import { createDemoBuyerResolver } from '../server/whatsapp/demo-buyer.mjs';
import { createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { createShoppingListHandoff } from '../server/whatsapp/shopping-list.mjs';
import { createLocalShop } from '../server/local-shop.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { createRuleInterpreter } from '../server/order-conversation/interpret.mjs';
import { shoppingListView } from '../server/shopping-list/index.mjs';
import { storefrontCartProjection } from '../server/storefront-whatsapp-sync.mjs';

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-kahvila-'));
after(() => fs.rmSync(workdir, { recursive: true, force: true }));
// Sääntötulkki lukee katalogin ladattaessa, joten se tuodaan vasta, kun polku on asetettu.
process.env.AIMO_CATALOG = path.join(workdir, 'tuotteet.json');
fs.writeFileSync(process.env.AIMO_CATALOG, JSON.stringify([
  { id: 'syn-maito', name: 'Maito', category: '10400' },
  { id: 'syn-maito-lt', name: 'Maito laktoositon', category: '10400' },
]));
const { understand } = await import('../server/aimo/understand.mjs');

const CLOCK = Date.parse('2026-11-14T10:00:00Z');
const PINNED_PHONE = '358401234567';
const STRANGER_PHONE = '358409876543';
const CAFE_ID = 'kahvila-aalto';
const pinnedEnv = { WHATSAPP_DEMO_PHONE: PINNED_PHONE, WHATSAPP_DEMO_BUYER_ID: CAFE_ID };

// Kuuden litran laatikko: tarve pyöristetään ylös täysiin laatikoihin.
const PACK = 6;
const boxesFor = (litres) => Math.ceil(litres / PACK);

test('vain asetuksissa nimetty numero saa Kahvila Aallon; samanniminen yritys toisesta numerosta ei saa', () => {
  const resolve = createDemoBuyerResolver(pinnedEnv);
  const pinned = resolve({ phone: PINNED_PHONE, binding: 'liitos-a' });
  assert.equal(pinned.buyerId, CAFE_ID);
  assert.notEqual(pinned.customerId, 'whatsapp-demo:liitos-a', 'kiinnitetty ostaja saa oman asiakastunnuksensa');

  const lookalike = resolve({ phone: STRANGER_PHONE, binding: 'b', company: 'Kahvila Aalto' });
  assert.equal(lookalike.buyerId, 'whatsapp-demo-b');

  assert.throws(() => createDemoBuyerResolver({ WHATSAPP_DEMO_BUYER_ID: CAFE_ID }), /WHATSAPP_DEMO_PHONE/);
});

test('kiinnitetty numero pitää saman ostajan ja korinäkymän, kun määrää korjataan', async (t) => {
  const resolveBuyer = createDemoBuyerResolver(pinnedEnv);
  const memberFile = path.join(workdir, 'whatsapp.db');
  const members = openWhatsAppStore(memberFile, () => CLOCK);
  t.after(() => members.close());
  for (const phone of [PINNED_PHONE, STRANGER_PHONE]) {
    const { code } = members.invite(phone, 'Testikeittiö', 'Testaaja');
    members.pair(phone, codeHash(code));
  }
  const pinnedMember = members.member(PINNED_PHONE);
  const drafts = openDraftStore(':memory:', () => CLOCK);
  t.after(() => drafts.close());

  const cafe = { id: CAFE_ID, name: 'Kahvila Aalto', apiKey: 'private-demo-key', mandate: { approval: 'always', maxOrderNet: 75 } };
  const cafeBefore = structuredClone(cafe);
  const seenCustomers = [];
  let submitAttempts = 0;

  const milkBoxes = (line) => ({ productId: 'syn-maito', name: 'Maito 6 x 1 l', salesUnits: boxesFor(line.quantity.value), salesUnitLabel: 'ltk' });
  const fakeQuote = (draft) => ({
    quoteId: 'syn-quote',
    expiresAt: new Date(CLOCK + 60_000).toISOString(),
    issues: [],
    totals: { net: 10 },
    lines: draft.lines.map((line) => {
      const boxes = milkBoxes(line);
      return { ...boxes, ref: line.ref, covers: { value: boxes.salesUnits * PACK, unit: 'L' }, unitPriceNet: 12, lineNet: 12 * boxes.salesUnits, vatRate: 13.5 };
    }),
  });
  const handleTurn = createOrderingConversation({
    store: drafts,
    now: () => CLOCK,
    interpretTurn: createRuleInterpreter({ understand }),
    tools: {
      suggest: async ({ draft }) => ({
        issues: [],
        lines: draft.lines.map((line) => ({ ref: line.ref, options: [{ ...milkBoxes(line), lineNet: 12 }] })),
      }),
      quote: async ({ draft }) => fakeQuote(draft),
      // Korinäkymän päivitys ei koskaan tilaa. Jos tilausta yritettäisiin, testi huomaa sen.
      submit: async () => { submitAttempts += 1; throw new Error('Korin synkronointi ei saa tilata.'); },
    },
  });

  const listFor = ({ conversationId, customer }) => shoppingListView(drafts.active(conversationId), customer);
  const bridge = createDemoOrderingChat({
    store: members,
    phoneId: '12345',
    resolveBuyer,
    loadOrdering: async () => ({
      buyerName: (id) => (id === cafe.id ? cafe.name : undefined),
      ensureBuyer(customer) { assert.equal(customer.buyerId, cafe.id); },
      handleTurn(args) { seenCustomers.push(args.customer); return handleTurn(args); },
      getShoppingList: listFor,
      getStorefrontCart({ conversationId, customer }) {
        const draft = drafts.active(conversationId);
        return storefrontCartProjection(listFor({ conversationId, customer }), fakeQuote(draft));
      },
      close() {},
    }),
  });
  t.after(() => bridge.close());

  const channel = createWhatsAppChannel({
    store: members,
    settings: { orderingDemo: true, supportContact: 'Test' },
    now: () => CLOCK,
    chat: bridge.chat,
    send: async () => 'simulated-meta-delivery',
  });
  let counter = 0;
  async function pinnedSays(text) {
    counter += 1;
    members.enqueue({ id: `kahvila-${counter}`, phone: PINNED_PHONE, text, sentAt: CLOCK });
    await channel.processNext();
  }

  await pinnedSays('20 l laktoositonta maitoa maanantaiksi');
  await pinnedSays('1');
  const lastCustomer = seenCustomers.at(-1);
  assert.equal(lastCustomer.buyerId, CAFE_ID);
  assert.equal(lastCustomer.companyName, 'Kahvila Aalto', 'nimi tulee kaupan ostajalta eikä kutsusta');
  const list = await bridge.getShoppingList(pinnedMember);
  assert.equal(list.buyerId, CAFE_ID);

  // Kaupan asiakasvalikko lukee saman jäsenkannan vain luku -tilassa.
  const localShop = createLocalShop({ whatsappDb: memberFile, defaultPhone: PINNED_PHONE, buyers: () => [cafe], resolveBuyer });
  const menu = localShop.context();
  assert.equal(menu.defaultBuyerId, CAFE_ID);
  assert.equal(menu.accounts[0].name, 'Kahvila Aalto');

  // Ostoslistan siirto: paikallinen GET-pyyntö ostajan tunnuksella.
  const handoff = createShoppingListHandoff({ store: members, ordering: bridge, defaultPhone: PINNED_PHONE, resolveBuyer });
  const reply = { status: 0, payload: null };
  const fakeRes = { writeHead(status) { reply.status = status; }, end(raw) { reply.payload = JSON.parse(raw); } };
  const localGet = { method: 'GET', headers: { host: 'localhost:4749' }, socket: { remoteAddress: '127.0.0.1' } };
  const handled = await handoff.handle(localGet, fakeRes, new URL(`http://localhost/api/assistant/whatsapp-list?buyerId=${CAFE_ID}`));
  assert.equal(handled, true);
  assert.equal(reply.status, 200);
  assert.equal(reply.payload.shoppingList.buyerId, CAFE_ID);
  const cafeAccount = reply.payload.accounts.find((account) => account.buyerId === CAFE_ID);
  assert.equal(cafeAccount.companyName, 'Kahvila Aalto');

  // Korinäkymä: 20 l on neljä kuuden litran laatikkoa, ja 30 l:n korjaus tekee siitä viisi uudessa versiossa.
  const first = await bridge.getStorefrontCart(pinnedMember, list.id);
  assert.equal(first.source, `whatsapp:${CAFE_ID}`);
  assert.equal(first.lines[0].qty, boxesFor(20));
  assert.equal(first.lines[0].qty, 4);

  await pinnedSays('maitoa 30 litraa');
  const corrected = await bridge.getStorefrontCart(pinnedMember, list.id);
  assert.equal(corrected.lines.length, 1, 'korjaus ei lisää toista riviä');
  assert.equal(corrected.lines[0].qty, 5);
  assert.ok(corrected.revision > first.revision);
  assert.deepEqual(await bridge.getStorefrontCart(pinnedMember, list.id), corrected, 'toistuva luku antaa saman näkymän');

  assert.equal(submitAttempts, 0);
  assert.deepEqual(cafe, cafeBefore, 'synkronointi ei muuta ostajan tietoja');
});
