import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { createRuleInterpreter } from '../server/order-conversation/interpret.mjs';
import { createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { createWhatsAppChannel } from '../server/whatsapp/channel.mjs';
import { createCartLink } from '../server/whatsapp/cart-link.mjs';
import { KITCHEN_A as PHONE, KITCHEN_B as OTHER, META_PHONE_ID, linkTestKitchens, metaSignature, metaTextWebhook, ordersFromDrafts, serveRoutes,
  stubOrderTools, useSyntheticCatalog } from './helpers/demo-ordering.mjs';

const LIST_ROUTE = '/whatsapp/cart/api';
useSyntheticCatalog('cart-link');
const { understand } = await import('../server/aimo/understand.mjs');

const NOW = Date.parse('2026-11-14T10:00:00Z');
const APP_SECRET = 'test-secret';

// Oikea tilausydin, sääntötulkki ja korilinkki testityökaluilla. Laskurit kertovat tilaukset ja tulkinnat.
async function fixture(t, { ask = null } = {}) {
  let clock = NOW;
  const fixedNow = () => NOW;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-link-'));
  const draftsFile = path.join(tmp, 'drafts.db');
  const wa = openWhatsAppStore(path.join(tmp, 'wa.db'), fixedNow);
  linkTestKitchens(wa);
  let drafts = openDraftStore(draftsFile, fixedNow);
  const counts = { submits: 0, parsed: 0 };
  const interpret = createRuleInterpreter({ understand });
  const tools = stubOrderTools({ now: fixedNow, total: () => 20,
    submit: async () => { counts.submits += 1; return { status: 'confirmed', orderId: 'TEST-ORDER-1', reasons: [] }; } });
  const newTurnHandler = () => createOrderingConversation({ store: drafts, tools, now: fixedNow,
    interpretTurn: async (args) => { counts.parsed += 1; return interpret(args); } });
  let handleTurn = newTurnHandler();
  const bridge = createDemoOrderingChat({ store: wa, phoneId: META_PHONE_ID, loadOrdering: ordersFromDrafts({
    drafts: () => drafts, turn: () => handleTurn, dialogue: () => createOrderingDialogue({ db: wa.db, ask, now: fixedNow }) }) });
  const cart = createCartLink({ store: wa, ordering: bridge, baseUrl: 'https://cart.example.test', secret: 'cart-test-secret', now: () => clock });
  const sent = [];
  const channel = createWhatsAppChannel({ store: wa, chat: cart.chat, now: fixedNow,
    settings: { orderingDemo: true, appSecret: APP_SECRET, phoneId: META_PHONE_ID, supportContact: 'Ylläpito' },
    send: async (...args) => { sent.push(args); return 'meta-reply'; } });
  const site = await serveRoutes([(req, res, url) => channel.handle(req, res, url), (req, res, url) => cart.handle(req, res, url)]);
  t.after(async () => {
    await channel.stop();
    await bridge.close();
    await site.close();
    drafts.close();
    wa.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const auth = (token) => ({ authorization: `Bearer ${token}` });
  const read = (token, extra = {}) => fetch(site.base + LIST_ROUTE, { headers: { ...auth(token), ...extra } });
  const post = (token, input, extra = {}) => fetch(`${site.base}${LIST_ROUTE}/chat`, {
    method: 'POST', headers: { ...auth(token), 'content-type': 'application/json', ...extra }, body: JSON.stringify(input) });
  // Lähettää allekirjoitetun tekstiviestin webhookiin, käsittelee jonon ja palauttaa botin vastauksen.
  async function whatsapp(text, messageId = crypto.randomUUID()) {
    const raw = metaTextWebhook({ id: messageId, from: PHONE, at: NOW, text });
    const response = await fetch(`${site.base}/webhooks/whatsapp`, { method: 'POST', body: raw,
      headers: { 'x-hub-signature-256': metaSignature(raw, APP_SECRET) } });
    assert.equal(response.status, 200);
    await channel.processNext();
    return sent.filter(([, , replyTo]) => replyTo === messageId).map(([, body]) => body).join('\n\n');
  }
  function restartDrafts() {
    drafts.close();
    drafts = openDraftStore(draftsFile, fixedNow);
    handleTurn = newTurnHandler();
  }
  return { wa, bridge, cart, base: site.base, read, post, whatsapp, sent, restartDrafts,
    advance: (ms) => { clock += ms; }, stats: () => ({ ...counts }) };
}
const version = (shoppingList) => shoppingList ? { id: shoppingList.id, revision: shoppingList.revision } : null;

const linkToken = (reply) => new URL(reply.match(/https:\/\/cart\.example\.test\/whatsapp\/cart#[\w.-]+/)[0]).hash.slice(1);
// Korilinkki annetaan vain valmiiseen tilaukseen (Eelis 15.11. klo 2.00): lista viedään valmiiksi sen oman tilan mukaan.
async function openWhenComplete(f) {
  for (let i = 0; i < 6; i += 1) {
    const list = await f.bridge.getShoppingList(f.wa.member(PHONE));
    if (!list || list.status === 'review') break;
    await f.whatsapp(list.missing.includes('deliveryDate') ? 'maanantaiksi' : list.missing.some((m) => m.startsWith('preference')) ? '2' : '1');
  }
  return linkToken(await f.whatsapp('avaa kori'));
}
async function startCart(f, text) { await f.whatsapp(text); return openWhenComplete(f); }
// Kuten korisivun vihreä painike: TILAA lähtee vahvistuslipun kanssa (katselmus #10).
const input = (list, text) => ({ text, messageId: crypto.randomUUID(), expectedList: version(list), ...(text === 'TILAA' ? { confirm: true } : {}) });

test('WhatsApp link opens the same saved basket without copying, quoting or ordering on GET; edits stay shared', async (t) => {
  const f = await fixture(t);
  const token = await startCart(f, '20 l laktoositonta maitoa ja 5 kg voita maanantaiksi');
  const response = await f.read(token, { 'cf-ray': 'public-tunnel', 'x-forwarded-proto': 'https' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const { shoppingList: first } = await response.json();
  assert.equal(first.lines.length, 2); assert.equal(first.deliveryDate, '2026-11-16');
  assert.equal(first.lines[0].quantity.value, 20);
  assert.deepEqual(first, await f.bridge.getShoppingList(f.wa.member(PHONE)));
  assert.doesNotMatch(JSON.stringify(first), /358401234567|bindingVersion|apiKey|quoteId/);
  assert.equal(f.stats().submits, 0); assert.equal(f.stats().parsed, 1);
  f.restartDrafts(); assert.deepEqual((await (await f.read(token)).json()).shoppingList, first);
  const edited = await f.post(token, input(first, 'maitoa sittenkin 30 litraa'));
  assert.equal(edited.status, 200); const { shoppingList: next } = await edited.json();
  assert.equal(next.id, first.id); assert.equal(next.lines[0].quantity.value, 30);
  assert.equal((await f.bridge.getShoppingList(f.wa.member(PHONE))).lines[0].quantity.value, 30);
  assert.match(await f.whatsapp('näytä'), /30 l/);
  assert.equal(f.stats().submits, 0);
});

test('a natural link request reaches the real cart capability through the model without submitting or changing the cart', async (t) => {
  const ask = async ({ purpose, user }) => {
    assert.equal(purpose, 'whatsapp_dialogue');
    const input = JSON.parse(user); assert.equal(input.capabilities.cartLink, true);
    return { json: { route: input.message.includes('näyttää hyvältä') ? 'cart' : 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: input.message.includes('näyttää hyvältä') } };
  };
  const f = await fixture(t, { ask });
  await f.whatsapp('20 l laktoositonta maitoa maanantaiksi'); await f.whatsapp('1'); // valmis tilaus ennen linkkiä
  const before = await f.bridge.getShoppingList(f.wa.member(PHONE));
  const text = await f.whatsapp('ok näyttää hyvältä, laita linkki tulemaan');
  const token = linkToken(text); assert.match(text, /Tässä linkki ostoskoriisi/); assert.doesNotMatch(text, /TILAA|en pysty/);
  const current = (await (await f.read(token)).json()).shoppingList;
  assert.deepEqual(current, before); assert.equal(f.stats().submits, 0);
});

test('browser reviews and explicitly confirms exactly once; a stale version cannot approve unseen WhatsApp changes', async (t) => {
  const f = await fixture(t);
  const token = await startCart(f, '20 l laktoositonta maitoa ja 5 kg voita maanantaiksi');
  const first = (await (await f.read(token)).json()).shoppingList;
  assert.equal(first.status, 'review'); // linkki tuli vasta valmiiseen tilaukseen
  const choice = await (await f.post(token, input(first, 'näytä'))).json();
  assert.equal(choice.status, 'ready'); assert.match(choice.text, /TILAA/);
  await f.whatsapp('maitoa sittenkin 30 litraa');
  assert.equal((await f.post(token, input(choice.shoppingList, 'TILAA'))).status, 409);
  assert.equal(f.stats().submits, 0);
  const current = (await (await f.read(token)).json()).shoppingList;
  const review = await (await f.post(token, input(current, 'näytä'))).json();
  assert.equal(review.status, 'ready'); assert.match(review.text, /30 l/);
  const confirm = input(review.shoppingList, 'TILAA');
  const result = await f.post(token, confirm); assert.equal(result.status, 200);
  assert.equal((await result.json()).status, 'confirmed'); assert.equal(f.stats().submits, 1);
  const retry = await f.post(token, confirm); assert.equal(retry.status, 200);
  assert.equal((await retry.json()).status, 'confirmed'); assert.equal(f.stats().submits, 1);
  assert.equal((await f.read(token)).status, 410);
});

test('capability rejects forgery, expiry, new lists, re-pairing and attempts to choose another buyer', async (t) => {
  // Päivä annetaan suoraan: testi pysyy numerokohtaisen 10 viestin minuuttikaton alla (kello on pysäytetty).
  const f = await fixture(t); const token = await startCart(f, 'maitoa 20 litraa maanantaiksi');
  assert.equal((await f.read('')).status, 410);
  assert.equal((await f.read(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'))).status, 410);
  assert.equal((await f.read(token, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.read(token, { 'sec-fetch-site': 'cross-site' })).status, 403);
  const first = (await (await f.read(token)).json()).shoppingList;
  const edited = await f.post(token, { ...input(first, 'maitoa 25 litraa'), buyerId: 'another-buyer', member: f.wa.member(OTHER) });
  assert.equal(edited.status, 200);
  assert.equal(await f.bridge.getShoppingList(f.wa.member(OTHER)), null);
  await f.whatsapp('aloitetaan alusta'); await f.whatsapp('voita 3 kg maanantaiksi');
  assert.equal((await f.read(token)).status, 410);
  assert.equal((await f.post(token, input(first, 'TILAA'))).status, 409);
  const freshToken = await openWhenComplete(f);
  const invitation = f.wa.invite(PHONE, 'Uusi yritys', 'Testi'); f.wa.pair(PHONE, codeHash(invitation.code));
  assert.equal((await f.read(freshToken)).status, 410);
  await f.whatsapp('maitoa 10 litraa maanantaiksi'); const newToken = await openWhenComplete(f);
  f.advance(24 * 3600_000 + 1); assert.equal((await f.read(newToken)).status, 410);
  assert.equal(f.stats().submits, 0);
});

test('malformed writes and other routes stay closed (the page itself is in whatsapp-storefront-cart.test.mjs)', async (t) => {
  const f = await fixture(t); const token = await startCart(f, 'maitoa 20 litraa');
  assert.equal((await fetch(f.base + '/v1/orders')).status, 404);
  const list = (await (await f.read(token)).json()).shoppingList;
  assert.equal((await f.post(token, { ...input(list, 'TILAA'), expectedList: null })).status, 400);
  assert.equal((await f.post(token, input(list, 'x'.repeat(13000)))).status, 413);
  assert.equal((await f.post(token, input(list, 'näytä'), { 'content-type': 'text/plain' })).status, 415);
  assert.equal(f.stats().submits, 0);
});

test('link route is opt-in and refuses non-HTTPS or ambiguous configured origins', () => {
  assert.equal(createCartLink({}), null);
  for (const baseUrl of ['http://example.test', 'https://example.test/path', 'https://example.test/?token=x', 'https://user:pass@example.test']) {
    assert.throws(() => createCartLink({ baseUrl, secret: 'test' }), /HTTPS/);
  }
});

test('ready WhatsApp summary asks for ok; ok and legacy TILAA open the cart without submitting or invoking the model', async (t) => {
  const f = await fixture(t);
  await f.whatsapp('20 l laktoositonta maitoa ja 5 kg voita maanantaiksi');
  await f.whatsapp('1');
  const review = await f.whatsapp('1');
  assert.match(review, /Vastaa \*ok\*/); assert.doesNotMatch(review, /TILAA/);
  const before = f.stats();
  for (const message of ['ok', 'okei', 'joo', 'TILAA']) {
    const token = linkToken(await f.whatsapp(message));
    assert.equal((await f.read(token)).status, 200);
  }
  assert.deepEqual(f.stats(), before); assert.equal(f.stats().submits, 0);
});

test('browser writes have a per-customer limit without blocking reads or making an order', async (t) => {
  const f = await fixture(t); const token = await startCart(f, 'maitoa 20 litraa');
  for (let i = 0; i < 10; i++) {
    const { shoppingList } = await (await f.read(token)).json();
    assert.equal((await f.post(token, input(shoppingList, 'näytä'))).status, 200);
  }
  const { shoppingList } = await (await f.read(token)).json();
  assert.equal((await f.post(token, input(shoppingList, 'näytä'))).status, 429);
  assert.equal((await f.read(token)).status, 200);
  f.advance(60_001);
  assert.equal((await f.post(token, input(shoppingList, 'näytä'))).status, 200);
  assert.equal(f.stats().submits, 0);
});

test('a cart request on an unfinished order gets what is missing and the next question; the link comes only when complete', async (t) => {
  // Eelis 15.11. klo 2.00: "tä ois just opas tähä". Ei linkkiä keskeneräiseen tilaukseen, ei myöskään suoraan pyydettynä.
  const f = await fixture(t);
  await f.whatsapp('20 l laktoositonta maitoa ja 5 kg voita');
  const noDate = await f.whatsapp('avaa kori');
  assert.doesNotMatch(noDate, /cart\.example\.test/);
  assert.match(noDate, /^Annan ostoskorin linkin, kun tilaus on valmis\. Vielä puuttuu toimituspäivä\./);
  assert.match(noDate, /Mille päivälle toimitus\?/);
  assert.equal((await f.bridge.getShoppingList(f.wa.member(PHONE))).lines.length, 2); // "avaa kori" ei lisännyt tuotetta
  await f.whatsapp('maanantaiksi');
  const choose = await f.whatsapp('TILAA');
  assert.doesNotMatch(choose, /cart\.example\.test/);
  assert.match(choose, /Vielä puuttuu tuotevalinta: maito ja voi\./); assert.match(choose, /1\) /);
  await f.whatsapp('1'); await f.whatsapp('1');
  assert.match(await f.whatsapp('avaa kori'), /Tässä linkki ostoskoriisi/);
  assert.equal(f.stats().submits, 0);
});
