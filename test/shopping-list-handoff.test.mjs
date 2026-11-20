// Paikallisen testikaupan ja WhatsAppin yhteinen ostoslista. Kauppa ei tee omaa koria: se lukee ja muokkaa samaa
// luonnosta, jonka WhatsApp-viesti aloitti, ja tilaus syntyy vain erillisellä vahvistuksella.
// Ajossa on oikea tilausmoottori, sääntötulkki ja dialogi pienellä keksityllä katalogilla. Hinnat, tarjoukset ja
// tilaus ovat valeita, eikä mikään kutsu verkkoa, mallia tai Valion rajapintaa.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { codeHash, openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel } from '../server/whatsapp/channel.mjs';
import { createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { LIST_ROUTE, createShoppingListHandoff } from '../server/whatsapp/shopping-list.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { createRuleInterpreter } from '../server/order-conversation/interpret.mjs';
import { shoppingListView } from '../server/shopping-list/index.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-list-handoff-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// Tulkki lukee katalogin vasta ladattaessa, joten polku asetetaan ennen dynaamista tuontia.
process.env.AIMO_CATALOG = path.join(scratch, 'tuotteet.json');
const tinyCatalog = [
  ['syn-maito', 'Maito', '10400'],
  ['syn-maito-lt', 'Maito laktoositon', '10400'],
  ['syn-voi', 'Voi', '10500'],
  ['syn-voi-st', 'Voi suolaton', '10500'],
].map(([id, name, category]) => ({ id, name, category }));
fs.writeFileSync(process.env.AIMO_CATALOG, JSON.stringify(tinyCatalog));
const { understand } = await import('../server/aimo/understand.mjs');

// Lauantai 14.11.2026, joten "maanantaiksi" on 16.11.
const CLOCK = Date.parse('2026-11-14T10:00:00Z');
const META_PHONE_ID = '12345';
const APP_SECRET = 'handoff-app-secret';
const KITCHEN = { phone: '358401234567', company: 'Keittiö A' };
const NEIGHBOUR = { phone: '358409876543', company: 'Keittiö B' };

const versionOf = (list) => (list ? { id: list.id, revision: list.revision } : null);
// Kaupan viesti: ostaja, se listan versio jonka sivu näki, uusi viestitunniste ja teksti.
const shopTurn = (buyerId, list, text) => ({ buyerId, expectedList: versionOf(list), messageId: crypto.randomUUID(), text });

function join(store, { phone, company }, person = 'Testaaja') {
  const { code } = store.invite(phone, company, person);
  return store.pair(phone, codeHash(code));
}

// Valetyökalut: jokaiselle riville yksi vaihtoehto, kiinteä hinta ja onnistuva tilaus. Laskurit kertovat, kuinka monta
// kertaa tulkki ajettiin ja tilaus lähetettiin.
function fakeOrderTools(counts) {
  const option = (line) => ({
    productId: `SYN-${line.ref}`, name: `${line.productTerm} testituote`, salesUnits: 1, salesUnitLabel: 'ltk', covers: line.quantity, lineNet: 10,
  });
  const quotedLine = (line) => ({ ref: line.ref, name: line.selectedName, salesUnits: 1, salesUnitLabel: 'ltk', lineNet: 10, covers: line.quantity });
  return {
    suggest: async ({ draft }) => ({ issues: [], lines: draft.lines.map((line) => ({ ref: line.ref, options: [option(line)] })) }),
    quote: async ({ draft }) => ({
      quoteId: `QUOTE-${draft.id}-r${draft.revision}`,
      expiresAt: new Date(CLOCK + 60 * 60_000).toISOString(),
      issues: [],
      totals: { net: 10 * draft.lines.length },
      lines: draft.lines.map(quotedLine),
    }),
    submit: async () => {
      counts.submitted += 1;
      return { status: 'confirmed', orderId: 'SYN-ORDER-1', reasons: [] };
    },
  };
}

// Käynnistää WhatsApp-kanavan ja kaupan reitit samalle paikalliselle palvelimelle. Luonnoskanta on tiedostossa,
// jotta restart() voi avata sen uudelleen kuin prosessi olisi käynnistynyt alusta.
async function startHandoff(t) {
  const home = fs.mkdtempSync(path.join(scratch, 'run-'));
  const draftFile = path.join(home, 'luonnokset.db');
  const members = openWhatsAppStore(path.join(home, 'whatsapp.db'), () => CLOCK);
  join(members, KITCHEN);
  join(members, NEIGHBOUR);

  const counts = { submitted: 0, interpreted: 0 };
  const tools = fakeOrderTools(counts);
  const interpretRules = createRuleInterpreter({ understand });
  const engine = { drafts: null, turn: null };
  const boot = () => {
    engine.drafts = openDraftStore(draftFile, () => CLOCK);
    engine.turn = createOrderingConversation({
      store: engine.drafts,
      tools,
      now: () => CLOCK,
      interpretTurn: (args) => { counts.interpreted += 1; return interpretRules(args); },
    });
  };
  boot();

  // Sama viesti saa aiemman tuloksensa vain, jos tulos kuuluu juuri tälle asiakkaalle ja liitokselle.
  const ownsResult = ({ messageId, customer }) => {
    const draftId = engine.drafts.result(messageId)?.draftId;
    const draft = draftId ? engine.drafts.get(draftId) : null;
    return Boolean(draft) && draft.customerId === customer.customerId && draft.bindingVersion === customer.bindingVersion;
  };
  const bridge = createDemoOrderingChat({
    store: members,
    phoneId: META_PHONE_ID,
    loadOrdering: async () => ({
      handleTurn: (args) => engine.turn(args),
      dialogue: createOrderingDialogue({ db: members.db, ask: null, now: () => CLOCK }),
      getShoppingList: ({ conversationId, customer }) => shoppingListView(engine.drafts.active(conversationId), customer),
      hasTurnResult: ownsResult,
      close() {},
    }),
  });

  const outbox = [];
  const channel = createWhatsAppChannel({
    settings: { orderingDemo: true, appSecret: APP_SECRET, phoneId: META_PHONE_ID, supportContact: 'Ylläpito' },
    store: members,
    chat: bridge.chat,
    now: () => CLOCK,
    send: async (to, text) => { outbox.push({ to, text }); return `sent-${outbox.length}`; },
  });
  const handoff = createShoppingListHandoff({ store: members, ordering: bridge, defaultPhone: KITCHEN.phone });

  // Webhook ja kaupan reitit samassa palvelimessa; muu polku on 404.
  async function route(req, res) {
    const target = new URL(req.url, `http://${req.headers.host}`);
    for (const handler of [channel, handoff]) if (await handler.handle(req, res, target)) return;
    res.writeHead(404);
    res.end();
  }
  const server = http.createServer(route);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await channel.stop();
    await bridge.close();
    server.closeAllConnections();
    await new Promise((resolve) => { server.close(resolve); });
    engine.drafts.close();
    members.close();
  });

  // Metan allekirjoittama webhook-viesti keittiön numerosta. Palauttaa viimeisimmän lähetetyn vastauksen.
  async function fromPhone(text, metaId = `wamid.${crypto.randomUUID()}`) {
    const message = { id: metaId, from: KITCHEN.phone, timestamp: String(CLOCK / 1000), type: 'text', text: { body: text } };
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: META_PHONE_ID }, messages: [message] } }] }],
    });
    const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
    const response = await fetch(`${origin}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'x-hub-signature-256': `sha256=${signature}` }, body,
    });
    assert.equal(response.status, 200);
    await channel.processNext();
    return outbox.at(-1)?.text;
  }

  async function shopView(buyerId) {
    const query = buyerId ? `?${new URLSearchParams({ buyerId })}` : '';
    const response = await fetch(`${origin}${LIST_ROUTE}${query}`);
    assert.equal(response.status, 200);
    return response.json();
  }
  const shopSay = (payload, extraHeaders = {}) => fetch(`${origin}${LIST_ROUTE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  });

  return {
    members, bridge, origin, counts, fromPhone, shopView, shopSay,
    restart() { engine.drafts.close(); boot(); },
  };
}

describe('WhatsAppista kauppaan siirtyvä ostoslista', () => {
  it('tekee viestistä rakenteisen listan, jota kauppa jatkaa ja joka tilataan vain erikseen vahvistamalla', async (t) => {
    const shop = await startHandoff(t);
    const order = '20 l laktoositonta maitoa ja 5 kg voita maanantaiksi';
    assert.equal((await shop.shopView()).shoppingList, null, 'ennen ensimmäistä viestiä listaa ei ole');

    assert.match(await shop.fromPhone(order, 'wamid.alku'), /maito/i);
    const opened = await shop.shopView();
    const list = opened.shoppingList;
    assert.equal(list.deliveryDate, '2026-11-16');
    assert.deepEqual(list.lines.map((line) => [line.quantity.value, line.quantity.unit]), [[20, 'L'], [5, 'KG']]);
    assert.ok(list.lines[0].claims.includes('FREE_FROM_LACTOSE'), 'laktoositon toive säilyy rivillä');
    assert.equal(list.requiresExplicitConfirmation, true);
    assert.equal(shop.counts.submitted, 0);

    // Kaupan näkymässä ei ole numeroa, avaimia, liitoksen tunnistetta eikä tarjouksen tunnistetta.
    const exposed = JSON.stringify(opened);
    for (const secret of [KITCHEN.phone, 'apiKey', 'bindingVersion', 'quoteId']) assert.equal(exposed.includes(secret), false, secret);
    const neighbour = opened.accounts.find((account) => account.buyerId !== opened.buyerId);
    assert.equal((await shop.shopView(neighbour.buyerId)).shoppingList, null, 'toisen keittiön valinta ei näytä tätä listaa');

    shop.restart();
    assert.deepEqual((await shop.shopView()).shoppingList, list, 'lista säilyy uudelleenkäynnistyksen yli');
    await shop.fromPhone(order, 'wamid.alku');
    assert.equal(shop.counts.interpreted, 1, 'Metan uudelleenlähetys ei tulkitse viestiä toista kertaa');
    assert.equal((await shop.shopView()).shoppingList.lines.length, 2);

    // Kauppa muokkaa samaa luonnosta. Saman viestin uusinta antaa saman tuloksen ilman uutta tulkintaa.
    const edit = shopTurn(opened.buyerId, list, 'maitoa sittenkin 30 litraa');
    const edited = await (await shop.shopSay(edit)).json();
    assert.equal(edited.shoppingList.id, list.id);
    assert.equal(edited.shoppingList.lines[0].quantity.value, 30);
    assert.equal((await shop.shopView()).shoppingList.lines[0].quantity.value, 30);
    const repeated = await shop.shopSay(edit);
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), edited);
    assert.equal(shop.counts.interpreted, 2);
    assert.equal(shop.counts.submitted, 0);

    // "näytä" WhatsAppissa ei muuta listaa, joten kaupan myöhäinen uusinta kelpaa yhä.
    assert.match(await shop.fromPhone('näytä'), /30 l/);
    assert.equal((await shop.shopSay(edit)).status, 200);

    // Tuotteet valitaan rivi kerrallaan, ja valmis lista pyytää TILAA-vahvistusta tilaamatta mitään.
    const beforeChoice = (await shop.shopView()).shoppingList;
    const firstPick = await (await shop.shopSay(shopTurn(opened.buyerId, beforeChoice, '1'))).json();
    assert.equal(firstPick.status, 'choosing');
    const secondPick = await (await shop.shopSay(shopTurn(opened.buyerId, firstPick.shoppingList, '1'))).json();
    assert.equal(secondPick.status, 'ready');
    assert.match(secondPick.text, /TILAA/);
    assert.equal(shop.counts.submitted, 0);

    const approval = shopTurn(opened.buyerId, secondPick.shoppingList, 'TILAA');
    const placed = await (await shop.shopSay(approval)).json();
    assert.equal(placed.status, 'confirmed');
    assert.equal(placed.shoppingList, null, 'tilattu luonnos ei ole enää avoin lista');
    assert.equal(shop.counts.submitted, 1);
    assert.equal((await shop.shopSay(approval)).status, 200);
    assert.equal(shop.counts.submitted, 1, 'vahvistuksen uusinta ei tilaa toista kertaa');
  });

  it('jättää puuttuvat tiedot puuttuviksi, eikä vanha selainversio muuta tai hyväksy listaa', async (t) => {
    const shop = await startHandoff(t);
    await shop.fromPhone('maitoa');
    const seen = await shop.shopView();
    assert.equal(seen.shoppingList.lines[0].quantity, null);
    assert.ok(seen.shoppingList.missing.includes('quantity:L1'));
    assert.equal(seen.shoppingList.deliveryDate, null);

    await shop.fromPhone('maitoa 10 litraa');
    const outdated = await shop.shopSay(shopTurn(seen.buyerId, seen.shoppingList, 'TILAA'));
    assert.equal(outdated.status, 409);
    assert.equal(shop.counts.submitted, 0);
    assert.equal((await shop.shopView()).shoppingList.lines[0].quantity.value, 10);

    // Jo käsitelty kaupan viesti ei saa uusittuna liittää vanhaa yhteenvetoaan WhatsAppin uudempaan versioon,
    // jonka sivu voisi muuten hyväksyä näkemättä sitä.
    const edit = shopTurn(seen.buyerId, (await shop.shopView()).shoppingList, 'maitoa 12 litraa');
    assert.equal((await shop.shopSay(edit)).status, 200);
    await shop.fromPhone('maitoa 15 litraa');
    assert.equal((await shop.shopSay(edit)).status, 409);
    assert.equal((await shop.shopView()).shoppingList.lines[0].quantity.value, 15);

    // Poistettu numero ei näe listaa sillan kautta eikä kaupassa.
    const removed = shop.members.member(KITCHEN.phone);
    shop.members.revoke(KITCHEN.phone);
    await assert.rejects(shop.bridge.getShoppingList(removed), /voimassa/);
    const afterRevoke = await shop.shopSay({ buyerId: seen.buyerId, expectedList: null, messageId: crypto.randomUUID(), text: 'näytä' });
    assert.equal(afterRevoke.status, 404);
  });

  it('aloita alusta vaihtaa keskustelun, eikä vanha lista palaa uuden listan tai uudelleenkäynnistyksen jälkeen', async (t) => {
    const shop = await startHandoff(t);
    await shop.fromPhone('maitoa 20 litraa');
    const previous = await shop.shopView();
    assert.match(await shop.fromPhone('aloitetaan alusta'), /ostoslista on tyhjä/);
    assert.equal((await shop.shopView()).shoppingList, null);

    await shop.fromPhone('voita 3 kg');
    const current = (await shop.shopView()).shoppingList;
    assert.notEqual(current.id, previous.shoppingList.id);
    assert.equal(current.lines.length, 1);
    assert.equal(current.lines[0].productTerm, 'voi');
    assert.equal(current.lines[0].quantity.value, 3);

    shop.restart();
    assert.deepEqual((await shop.shopView()).shoppingList, current);
    const oldApproval = await shop.shopSay(shopTurn(previous.buyerId, previous.shoppingList, 'TILAA'));
    assert.equal(oldApproval.status, 409);
    assert.equal(shop.counts.submitted, 0);
  });

  it('uusi liitos samalle numerolle saa uuden ostajan eikä peri vanhan yrityksen listaa tai pääsyä', async (t) => {
    const shop = await startHandoff(t);
    await shop.fromPhone('20 l laktoositonta maitoa maanantaiksi', 'wamid.vanha-yritys');
    const before = await shop.shopView();
    const formerMember = shop.members.member(KITCHEN.phone);
    assert.equal(before.shoppingList.lines[0].quantity.value, 20);

    const { code } = shop.members.invite(KITCHEN.phone, 'Uusi testiyritys', 'Uusi testaaja');
    assert.match(await shop.fromPhone(`YHDISTA ${code}`), /Uusi testaaja, Uusi testiyritys/);
    const rebound = await shop.shopView();
    assert.notEqual(rebound.buyerId, before.buyerId);
    assert.equal(rebound.shoppingList, null, 'uusi ostaja aloittaa tyhjästä');
    assert.ok(rebound.accounts.every((account) => account.buyerId !== before.buyerId), 'vanha ostaja ei ole enää valikossa');

    // Vanha ostaja ei avaudu kaupassa, kaupan viestillä eikä sillan kautta.
    const oldView = await fetch(`${shop.origin}${LIST_ROUTE}?${new URLSearchParams({ buyerId: before.buyerId })}`);
    assert.equal(oldView.status, 404);
    assert.equal((await shop.shopSay(shopTurn(before.buyerId, before.shoppingList, 'TILAA'))).status, 404);
    await assert.rejects(shop.bridge.getShoppingList(formerMember), /voimassa/);

    await shop.fromPhone('voita 2 kg');
    const fresh = (await shop.shopView()).shoppingList;
    assert.equal(fresh.companyName, 'Uusi testiyritys');
    assert.deepEqual(fresh.lines.map((line) => line.productTerm), ['voi']);
    assert.equal(fresh.deliveryDate, null, 'vanhan listan toimituspäivä ei siirry');
    assert.equal(fresh.diet.known, false, 'vanhan listan ruokavalio ei siirry');

    // Vanhan liitoksen aikainen viesti uudelleen lähetettynä ei herätä edellistä asiakkuutta.
    await shop.fromPhone('20 l laktoositonta maitoa maanantaiksi', 'wamid.vanha-yritys');
    shop.restart();
    assert.deepEqual((await shop.shopView()).shoppingList, fresh);
    assert.equal(shop.counts.submitted, 0);
  });
});

describe('kaupan ostoslistareittien rajat', () => {
  it('torjuu välityspalvelimen, toisen sivuston, keksityn ostajan ja virheelliset pyynnöt', async (t) => {
    const shop = await startHandoff(t);
    await shop.fromPhone('maitoa');
    const view = await shop.shopView();

    const refused = [
      ['Cloudflare-tunneli', { 'cf-ray': 'test' }],
      ['välityspalvelimen osoite', { 'x-forwarded-for': '198.51.100.1' }],
      ['välitetty isäntä', { 'x-forwarded-host': 'example.com' }],
      ['välitetty protokolla', { 'x-forwarded-proto': 'https' }],
      ['toinen alkuperä', { origin: 'https://example.com' }],
      ['rikkinäinen alkuperä', { origin: 'invalid' }],
      ['toisen sivuston pyyntö', { 'sec-fetch-site': 'cross-site' }],
    ];
    for (const [label, headers] of refused) {
      const response = await fetch(`${shop.origin}${LIST_ROUTE}`, { headers });
      assert.equal(response.status, 403, label);
      const text = await response.text();
      assert.equal(/Keittiö A|maito/.test(text), false, `${label}: vastaus ei paljasta listaa`);
    }

    assert.equal((await fetch(`${shop.origin}${LIST_ROUTE}?buyerId=forged`)).status, 404);
    const valid = shopTurn(view.buyerId, view.shoppingList, 'näytä');
    const statusOf = async (payload, headers) => (await shop.shopSay(payload, headers)).status;
    assert.equal(await statusOf({ ...valid, buyerId: 'forged' }), 404);
    assert.equal(await statusOf({ ...valid, expectedList: undefined }), 400);
    assert.equal(await statusOf({ ...valid, text: '' }), 400);
    assert.equal(await statusOf({ ...valid, text: 'x'.repeat(21_000) }), 413);
    assert.equal(await statusOf(valid, { 'content-type': 'text/plain' }), 415);
    assert.equal((await fetch(`${shop.origin}${LIST_ROUTE}`, { method: 'DELETE' })).status, 405);
  });

  it('saman liitoksen vuorot jonottavat, mutta toisen asiakkaan vuoro etenee', async (t) => {
    const members = openWhatsAppStore(':memory:');
    t.after(() => members.close());
    join(members, { ...KITCHEN, company: 'Demo' }, 'Test');
    join(members, { ...NEIGHBOUR, company: 'Demo' }, 'Test');

    const started = [];
    let entered; const slowEntered = new Promise((resolve) => { entered = resolve; });
    let unblock; const blocker = new Promise((resolve) => { unblock = resolve; });
    const bridge = createDemoOrderingChat({
      store: members,
      phoneId: META_PHONE_ID,
      loadOrdering: async () => ({
        close() {},
        async handleTurn({ messageId }) {
          started.push(messageId);
          if (messageId === 'hidas') { entered(); await blocker; }
          return { text: `vastaus ${messageId}` };
        },
      }),
    });
    t.after(() => bridge.close());
    const send = (who, messageId) => bridge.chat({ member: members.member(who.phone), messageId, messages: [{ role: 'user', content: 'maitoa' }] });

    const slow = send(KITCHEN, 'hidas');
    await slowEntered;
    const queued = send(KITCHEN, 'jonossa');
    assert.equal((await send(NEIGHBOUR, 'naapuri')).text, 'vastaus naapuri');
    assert.deepEqual(started, ['hidas', 'naapuri'], 'saman numeron toinen vuoro odottaa ensimmäistä');
    unblock();
    const replies = await Promise.all([slow, queued]);
    assert.deepEqual(started, ['hidas', 'naapuri', 'jonossa']);
    assert.deepEqual(replies.map((reply) => reply.text), ['vastaus hidas', 'vastaus jonossa']);
  });
});
