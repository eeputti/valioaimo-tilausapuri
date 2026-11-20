// SIIRRY MAKSAMAAN -polku (Eelis 18.11.): ostoskorista maksusivulle siirtyminen kesti liian kauan, ja odottaessa näkyi
// "YRITÄ SAMAA PYYNTÖÄ UUDELLEEN" -painike. Nyt painike pyörii latauksen merkkinä, sivu uusii kadonneen pyynnön itse
// samalla viesti-id:llä, maksusivulle siirrytään heti vahvistuksen jälkeen eikä vastausta kirjoiteta mallilla uudelleen.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { createCartLink } from '../server/whatsapp/cart-link.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { withDemoCheckout } from '../server/whatsapp/checkout.mjs';

const SECRET = 'cart-pay-speed-secret';
async function cartApi(t, reply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-pay-'));
  const wa = openWhatsAppStore(path.join(dir, 'wa.db'));
  const invitation = wa.invite('358401234567', 'Keittiö', 'Testaaja'); wa.pair('358401234567', codeHash(invitation.code));
  const binding = wa.member('358401234567').binding;
  const chats = []; const marks = [];
  const ordering = { chat: async (args) => { chats.push(args); return reply(args); } };
  const link = createCartLink({ store: wa, ordering, baseUrl: 'https://cart.example.test', secret: SECRET });
  const server = http.createServer(async (req, res) => {
    if (!(await link.handle(req, res, new URL(req.url, 'http://localhost')))) { res.writeHead(404); res.end(); }
    marks.push(res.orderPlaced === true);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); wa.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const payload = Buffer.from(JSON.stringify({ binding, draft: 'WD-1', expires: Date.now() + 3600_000 })).toString('base64url');
  const token = `${payload}.${crypto.createHmac('sha256', SECRET).update(`whatsapp-cart-v1\0${payload}`).digest('base64url')}`;
  const post = async (input) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/whatsapp/cart/api/chat`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: crypto.randomUUID(), expectedList: { id: 'WD-1', revision: 3 }, ...input }) });
    return { status: res.status, data: await res.json() };
  };
  return { post, chats, marks };
}

test('the pay path asks for a plain reply and marks only a placed order for publishing', async (t) => {
  const { post, chats, marks } = await cartApi(t, (args) => (/TILAA/.test(args.messages.at(-1).content)
    ? { status: 'confirmed', orderId: 'AGW-20261118-0001', text: 'Tilaus vahvistettu.' } : { status: 'ready', text: 'Yhteenveto' }));
  assert.equal((await post({ text: 'näytä', pay: true })).status, 200);
  assert.equal((await post({ text: 'TILAA', confirm: true, pay: true })).data.status, 'confirmed');
  assert.equal((await post({ text: 'maitoa 5 l' })).status, 200);
  assert.deepEqual(chats.map((c) => c.plain), [true, true, false]);
  // Only the confirmation goes to the payment site: the summary request no longer starts a publish of its own.
  assert.deepEqual(marks, [false, true, false]);
  assert.equal((await post({ text: 'näytä', pay: 'yes' })).status, 400);
  assert.equal(chats.length, 3);
});

test('a plain reply skips the voice model; other replies still get it', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const ready = { status: 'ready', draftId: 'draft-1', revision: 2, text: '- Maito 5 l, 12,34 €\n\nVahvista vastaamalla *TILAA*.' };
  const voiced = [];
  const ask = async ({ purpose }) => {
    if (purpose === 'whatsapp_voice') { voiced.push(purpose); return { json: { segments: ['jos näyttää hyvältä, laita [[T1]] niin mennään'] } }; }
    return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false } };
  };
  const dialogue = createOrderingDialogue({ db: store.db, ask, voice: true, timeOf: () => Date.parse('2026-11-15T12:30:00+02:00') });
  const quick = await dialogue.respond({ binding: 'one', messageId: 'm1', text: 'näytä', runOrder: async () => ready, inCart: true, plain: true });
  assert.equal(quick.text, ready.text); assert.equal(voiced.length, 0);
  const normal = await dialogue.respond({ binding: 'one', messageId: 'm2', text: 'näytä', runOrder: async () => ready, inCart: true });
  assert.equal(normal.voiced, true); assert.equal(voiced.length, 1);
});

// --- The cart page ----------------------------------------------------------------------------------------------

const LIST = { id: 'WD-1', revision: 3, status: 'review', deliveryDate: '2026-11-20', companyName: 'Keittiö', diet: { known: true, claims: [], excludeAllergens: [] },
  lines: [{ ref: 'L1', productTerm: 'maito', quantity: { value: 5, unit: 'L' }, claims: [], excludeAllergens: [], selectedProductId: 'P1', selectedName: 'Maito' }] };
const ORDER = 'AGW-20261118-0001';
const CHECKOUT = `https://pay.example.test/demo-payment.html#${ORDER}.${'a'.repeat(43)}`;
const CHECKOUT_MODULE = new URL('../public/whatsapp-checkout.js', import.meta.url).href;

async function page({ chat, stored = {} }) {
  const elements = new Map(); const listeners = []; const assigned = []; const bodies = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', hidden: false, value: '', disabled: false, dataset: {}, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, replaceChildren() { this.innerHTML = ''; }, addEventListener(type, fn) { listeners.push([id, type, fn]); },
      scrollIntoView() {}, focus() {}, setSelectionRange() {}, append() {}, closest: () => ({ scrollIntoView() {} }) });
    return elements.get(id);
  };
  const storage = new Map(Object.entries(stored));
  const context = {
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible',
      createElement: () => ({}), head: { append() {} } },
    window: { addEventListener() {}, dispatchEvent() {} },
    location: { hash: '#payload.signature', reload() {}, assign: (url) => assigned.push(url) },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    crypto: { randomUUID: () => crypto.randomUUID() }, CustomEvent: class {}, HTMLImageElement: class {}, setTimeout, clearTimeout, console,
    fetch: async (url, init = {}) => {
      if (String(url).endsWith('/export')) return { ok: true, status: 200, json: async () => ({ state: 'ready', id: 'WD-1', revision: 3, lines: [] }) };
      if (String(url).endsWith('/chat')) { const body = JSON.parse(init.body); bodies.push(body); return chat(body, bodies.length); }
      return { ok: true, status: 200, json: async () => ({ shoppingList: LIST }) };
    },
  };
  // vm ei tue dynaamista importia ilman kokeellista lippua: sama kutsu ladataan oikeasta maksulinkkimoduulista.
  const code = fs.readFileSync(new URL('../public/whatsapp-storefront-cart.js', import.meta.url), 'utf8');
  assert.equal(code.split("import('/whatsapp/checkout.js')").length, 2);
  context.loadCheckout = () => import(CHECKOUT_MODULE);
  vm.runInNewContext(code.replace("import('/whatsapp/checkout.js')", 'loadCheckout()'), context, { filename: 'whatsapp-storefront-cart.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const click = (id) => { for (const [el, type, fn] of listeners) if (el === id && type === 'click') fn(); };
  return { el: element, click, assigned, bodies, storage };
}
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test('SIIRRY MAKSAMAAN spins until the payment page opens and there is no retry button', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const p = await page({ chat: async (body) => {
    if (body.text === 'näytä') return ok({ status: 'ready', text: 'Yhteenveto', shoppingList: LIST, draftId: 'WD-1', revision: 3 });
    await gate; return ok({ status: 'confirmed', orderId: ORDER, text: 'Demotilaus vahvistettu.', checkout: { mode: 'demo', url: CHECKOUT } });
  } });
  const pay = p.el('wa-review');
  assert.equal(pay.disabled, false); assert.equal(pay.innerHTML, 'SIIRRY MAKSAMAAN');
  p.click('wa-review'); await settle();
  assert.equal(pay.attrs['aria-busy'], 'true'); assert.equal(pay.disabled, true);
  assert.match(pay.innerHTML, /wa-spinner[\s\S]*SIIRRYTÄÄN MAKSUUN/);
  release(); await settle(80);
  assert.deepEqual(p.assigned, [CHECKOUT]);
  // Still spinning while the browser leaves for the payment page.
  assert.equal(pay.hidden, false); assert.equal(pay.attrs['aria-busy'], 'true');
  assert.deepEqual(p.bodies.map((b) => [b.text, b.pay, b.confirm === true]), [['näytä', true, false], ['TILAA', true, true]]);
  const html = fs.readFileSync(new URL('../public/whatsapp-storefront-cart.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /wa-retry|YRITÄ SAMAA PYYNTÖÄ/);
});

test('a lost response is resent with the same message id, and a stored pay request resumes on load', async () => {
  let failures = 1;
  const p = await page({ chat: async (body) => {
    if (body.text === 'TILAA' && failures-- > 0) throw new TypeError('Failed to fetch');
    return body.text === 'näytä' ? ok({ status: 'ready', text: 'Yhteenveto', shoppingList: LIST })
      : ok({ status: 'confirmed', orderId: ORDER, text: 'ok', checkout: { mode: 'demo', url: CHECKOUT } });
  } });
  p.click('wa-review'); await settle(1100);
  const confirms = p.bodies.filter((b) => b.text === 'TILAA');
  assert.equal(confirms.length, 2); assert.equal(confirms[0].messageId, confirms[1].messageId);
  assert.deepEqual(p.assigned, [CHECKOUT]);
  // The page was reloaded before the confirmation answered: it carries on by itself with the same id.
  const messageId = crypto.randomUUID();
  const key = 'aimo.whatsapp-cart.pending.payload.signature'; // token.slice(-24) of the test hash
  const again = await page({ stored: { [key]: JSON.stringify({ text: 'TILAA', messageId, expectedList: { id: 'WD-1', revision: 3 }, review: false, confirm: true, pay: true }) },
    chat: async () => ok({ status: 'confirmed', orderId: ORDER, text: 'ok', checkout: { mode: 'demo', url: CHECKOUT } }) });
  await settle(80);
  assert.deepEqual(again.bodies.map((b) => b.messageId), [messageId]);
  assert.deepEqual(again.assigned, [CHECKOUT]);
});

test('a failed pay attempt leaves SIIRRY MAKSAMAAN ready to continue the same request', async () => {
  const p = await page({ chat: async (body) => (body.text === 'näytä' ? ok({ status: 'ready', text: 'Yhteenveto', shoppingList: LIST })
    : { ok: false, status: 502, json: async () => ({ error: 'Ostoskorin käsittely ei onnistunut. Yritä uudelleen.' }) }) });
  p.click('wa-review'); await settle(2900);
  const pay = p.el('wa-review');
  assert.equal(pay.attrs['aria-busy'], 'false'); assert.equal(pay.disabled, false); assert.equal(pay.innerHTML, 'SIIRRY MAKSAMAAN');
  assert.match(p.el('wa-status').textContent, /Paina SIIRRY MAKSAMAAN, niin jatketaan samasta kohdasta/);
  const tries = p.bodies.filter((b) => b.text === 'TILAA');
  assert.equal(tries.length, 3); assert.equal(new Set(tries.map((b) => b.messageId)).size, 1);
  assert.deepEqual(p.assigned, []);
});

// --- Payment page wait (Eelis 18.11.: "nopeuta myös maksusivun odotus") -------------------------------------------


test('a confirmed order is handed to the payment site before the cart gets its reply, within a time cap', async () => {
  const secret = 'pay-speed-secret-' + 'x'.repeat(32);
  const signing = { baseUrl: 'https://demo.example/', secret, orderCreatedAt: async () => '2026-11-18T08:00:00.000Z' };
  let result = { status: 'confirmed', orderId: ORDER };
  const ordering = { chat: async () => result };
  const pushed = []; let finished = false;
  const quick = withDemoCheckout(ordering, { ...signing, onCheckout: async (orderId) => { await settle(20); pushed.push(orderId); finished = true; } });
  const reply = await quick.chat({});
  assert.equal(finished, true, 'the push finished before the reply'); assert.deepEqual(pushed, [ORDER]);
  assert.match(reply.checkout.url, new RegExp(`#${ORDER}\\.`));
  // A failing push never blocks the order; a slow one is waited for only up to the cap.
  const failing = withDemoCheckout(ordering, { ...signing, onCheckout: async () => { throw new Error('Worker down'); } });
  assert.ok((await failing.chat({})).checkout);
  const started = Date.now();
  const slow = withDemoCheckout(ordering, { ...signing, checkoutWaitMs: 50, onCheckout: () => new Promise(() => {}) });
  assert.ok((await slow.chat({})).checkout); assert.ok(Date.now() - started < 1000);
  // Nothing to hand over without a confirmed order.
  result = { status: 'ready' }; pushed.length = 0;
  await quick.chat({}); assert.deepEqual(pushed, []);
});

test('publishing sends the order events before the order view snapshot', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-pay-publish-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wa = openWhatsAppStore(path.join(dir, 'wa.db'));
  const invitation = wa.invite('358401234567', 'Keittiö', 'Testaaja'); wa.pair('358401234567', codeHash(invitation.code));
  const binding = wa.member('358401234567').binding; wa.close();
  const { DatabaseSync } = await import('node:sqlite');
  const gw = new DatabaseSync(path.join(dir, 'gateway.db'));
  gw.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, idem_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, buyer_id TEXT, order_id TEXT, quote_id TEXT, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);`);
  const createdAt = new Date().toISOString();
  gw.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)').run(ORDER, `whatsapp-demo-${binding}`, 'k', 'confirmed', createdAt, JSON.stringify({ orderId: ORDER, status: 'confirmed',
    createdAt, deliveryDate: '2026-11-20', totals: { net: 25 }, lines: [{ productId: 'P1', name: 'Maito', quantity: 20, salesUnitLabel: 'kpl', lineNet: 25 }] }));
  gw.close();
  Object.assign(process.env, { CLOUDFLARE_DEMO_URL: 'https://demo.example/', CLOUDFLARE_DEMO_SYNC_TOKEN: 's'.repeat(40), WHATSAPP_DEMO_PHONE: '358401234567',
    GATEWAY_DB: path.join(dir, 'gateway.db'), WHATSAPP_DB: path.join(dir, 'wa.db'), AIMO_DB: path.join(dir, 'aimo.db'), WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db') });
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(new URL(url).pathname); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  t.after(() => { globalThis.fetch = realFetch; });
  const { publishOrders } = await import('../server/cloud.mjs');
  const result = await publishOrders();
  assert.equal(result.events, 1);
  assert.deepEqual(calls, ['/api/order-events', '/api/sync']);
});
