// Huomioita ostoskorista WhatsApp-korisivulla: laskenta ja sivun piirto. Eelis 17.11.: huomioita ei kuitata erikseen,
// ostaja näkee korin ja hyväksyy sen SIIRRY MAKSAMAAN -painikkeella.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { cartNotes } from '../server/cart-notes.mjs';
import { storefrontCartProjection } from '../server/storefront-whatsapp-sync.mjs';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { createCartLink } from '../server/whatsapp/cart-link.mjs';

const list = (over = {}) => ({ id: 'WD-1', revision: 3, buyerId: 'B1', companyName: 'Keittiö', deliveryDate: '2026-11-16', status: 'review',
  diet: { known: true, claims: [], excludeAllergens: [] },
  lines: [
    { ref: 'L1', productTerm: 'peruna', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [], selectedProductId: 'P1', selectedName: 'Peruna' },
    { ref: 'L2', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [], selectedProductId: 'P2', selectedName: 'Maito' },
  ], ...over });
const qline = (over) => ({ ref: 'L1', productId: 'P1', name: 'PP PERUNA 2KG', salesUnits: 3, salesUnitLabel: 'sk', covers: { value: 6, unit: 'KG' },
  unitPriceNet: 1, lineNet: 3, vatRate: 14, stockKnown: true, priceCurrent: true, priceFetchedAt: null, ...over });
const quote = (lines) => ({ quoteId: 'Q1', issues: [], lines });
const order = (id, status, lines, over = {}) => ({ orderId: id, status, deliveryDate: '2026-11-10', clockCycle: 0, buyerReference: 'whatsapp:WD-0', lines, ...over });

test('notes come from the quote, the product data and the buyer\'s own orders, with stable keys', () => {
  const lines = [qline({}), qline({ ref: 'L2', productId: 'P2', name: 'Maito 1 l', salesUnits: 20, salesUnitLabel: 'kpl', covers: { value: 20, unit: 'L' } })];
  // Rounding 5 kg → 6 kg is over 10 %: one note. 20 l → 20 l: none. Nothing else without history.
  let notes = cartNotes({ list: list(), quote: quote(lines) });
  assert.deepEqual(notes.map((n) => n.kind), ['rounded']);
  assert.equal(notes[0].productId, 'P1');
  // The product name already shows the pack size, so it is not repeated.
  assert.equal(notes[0].text, 'Pyysit 5 kg. Tuotetta myydään kokonaisina myyntierinä, joten tulee 3 säkkiä, yhteensä 6 kg.');

  // History: maito usually 4 kpl in three confirmed orders; 20 kpl now is unusual. An open order for the same day
  // in the same demo clock cycle already has maito. A rejected order, another cycle and this draft's own order do not count.
  const orders = [
    order('AGW-5', 'confirmed', [{ productId: 'P2', quantity: 4, salesUnitLabel: 'kpl' }], { deliveryDate: '2026-11-16', clockCycle: 2 }),
    order('AGW-4', 'rejected', [{ productId: 'P2', quantity: 4 }], { deliveryDate: '2026-11-16', clockCycle: 2 }),
    order('AGW-3', 'confirmed', [{ productId: 'P2', quantity: 4 }], { deliveryDate: '2026-11-16', clockCycle: 1 }),
    order('AGW-2', 'confirmed', [{ productId: 'P2', quantity: 3 }]),
    order('AGW-9', 'confirmed', [{ productId: 'P1', quantity: 3 }], { deliveryDate: '2026-11-16', clockCycle: 2, buyerReference: 'whatsapp:WD-1' }),
  ];
  notes = cartNotes({ list: list(), quote: quote(lines), orders, cycle: 2 });
  assert.deepEqual(notes.map((n) => `${n.kind}:${n.productId}`), ['rounded:P1', 'duplicate:P2', 'quantity:P2']);
  const dup = notes.find((n) => n.kind === 'duplicate');
  assert.equal(dup.text, 'Tilauksessa AGW-5 (4 kpl) on jo tätä tuotetta samalle toimituspäivälle 16.11.');
  const qty = notes.find((n) => n.kind === 'quantity');
  assert.equal(qty.title, 'Tavallista enemmän');
  assert.equal(qty.text, 'Tilaat 20 kpl, tavallisesti 4 kpl (vertailu 3 aiempaan tilaukseen).');
  // Without a looping clock every open order for that day counts.
  assert.match(cartNotes({ list: list(), quote: quote(lines), orders, cycle: null }).find((n) => n.kind === 'duplicate').text, /AGW-5 \(4 kpl\), AGW-3 \(4 kpl\)/);
  // The key carries the quantity: a changed quantity is a new note to acknowledge, an unchanged one keeps its key.
  const again = cartNotes({ list: list(), quote: quote(lines), orders, cycle: 2 });
  assert.deepEqual(again.map((n) => n.key), notes.map((n) => n.key));
  const changed = cartNotes({ list: list(), quote: quote([lines[0], { ...lines[1], salesUnits: 30 }]), orders, cycle: 2 });
  assert.notEqual(changed.find((n) => n.kind === 'quantity').key, qty.key);
  // Less than half of the usual is noted too.
  assert.equal(cartNotes({ list: list(), quote: quote([lines[0], { ...lines[1], salesUnits: 1 }]), orders }).find((n) => n.kind === 'quantity').title, 'Tavallista vähemmän');
});

test('missing label, unknown stock and an old price are noted; a list that is not ready gets none', () => {
  const lines = [qline({ covers: { value: 5, unit: 'KG' }, stockKnown: false }),
    qline({ ref: 'L2', productId: 'P2', name: 'Maito 1 l', salesUnits: 20, salesUnitLabel: 'kpl', covers: { value: 20, unit: 'L' }, stockKnown: false,
      priceCurrent: false, priceFetchedAt: '2026-11-16T21:10:00Z' })];
  const product = (id) => ({ P1: { labels: [] }, P2: { labels: ['FREE_FROM_LACTOSE'] } })[id];
  const withDiet = list({ diet: { known: true, claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [] } });
  const notes = cartNotes({ list: withDiet, quote: quote(lines), product });
  assert.deepEqual(notes.map((n) => `${n.kind}:${n.productId}`), ['label:P1', 'stock:null', 'price:null']);
  assert.equal(notes[0].text, 'Valion tuotetiedoissa tällä tuotteella ei ole merkintää, jota pyysit: laktoositon.');
  // One acknowledgement for the whole order, not the same note on every row.
  assert.equal(notes[1].text, 'Valion rajapinta ei kerro tarkkaa saldoa näille tuotteille: PP peruna 2 kg, Maito 1 l.');
  assert.equal(notes[2].text, 'Valion hintarajapinta ei vastannut, joten hinta on viimeisin tunnettu (haettu 16.11. klo 23.10): Maito 1 l.');
  assert.deepEqual(cartNotes({ list: withDiet, quote: { ...quote(lines), issues: [{ code: 'X' }] }, product }), []);
  // Sales-unit requests are not "rounded": the buyer asked for packs.
  const packs = list({ lines: [{ ...list().lines[0], quantity: { value: 2, unit: 'PCS', basis: 'sales' } }] });
  assert.deepEqual(cartNotes({ list: packs, quote: quote([qline({ salesUnits: 2, covers: { value: 4, unit: 'PCS' } })]) }), []);
  // The page export carries only the public fields, and only for a ready cart.
  const ready = storefrontCartProjection(withDiet, quote(lines), notes.map((n) => ({ ...n, secret: 'x' })));
  assert.equal(ready.notes.length, 3); assert.ok(ready.notes.every((n) => !('secret' in n)));
  assert.equal(storefrontCartProjection({ ...withDiet, status: 'needs_details' }, null, notes).notes, undefined);
});

// --- No acknowledgement step -----------------------------------------------------------------------------------

const SECRET = 'cart-notes-secret';
async function cartApi(t, cart) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-notes-'));
  const wa = openWhatsAppStore(path.join(dir, 'wa.db'));
  const invitation = wa.invite('358401234567', 'Keittiö', 'Testaaja'); wa.pair('358401234567', codeHash(invitation.code));
  const binding = wa.member('358401234567').binding;
  const chats = [];
  const ordering = { getStorefrontCart: async () => { if (cart instanceof Error) throw cart; return cart; },
    chat: async (args) => { chats.push(args); return { status: 'confirmed', orderId: 'AGW-1', text: 'ok' }; } };
  const link = createCartLink({ store: wa, ordering, baseUrl: 'https://cart.example.test', secret: SECRET });
  const server = http.createServer(async (req, res) => { if (!(await link.handle(req, res, new URL(req.url, 'http://localhost')))) { res.writeHead(404); res.end(); } });
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
  return { post, chats };
}
const NOTE_A = { key: 'rounded:P1:3:5', kind: 'rounded', productId: 'P1', title: 'Pyöristetty ylöspäin', text: '…' };
const NOTE_B = { key: 'stock:P1', kind: 'stock', productId: null, title: 'Saldoa ei vahvistettu', text: '…' };

test('notes do not block the order: SIIRRY MAKSAMAAN confirms without acknowledging them', async (t) => {
  const { post, chats } = await cartApi(t, { state: 'ready', id: 'WD-1', revision: 3, lines: [], notes: [NOTE_A, NOTE_B] });
  const r = await post({ text: 'TILAA', confirm: true });
  assert.equal(r.status, 200); assert.equal(r.data.status, 'confirmed'); assert.equal(chats.length, 1);
});

// --- The cart page --------------------------------------------------------------------------------------------

async function page({ shoppingList, exportData, stored = {} }) {
  const elements = new Map(); const listeners = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', hidden: false, value: '', disabled: false, dataset: {},
      setAttribute() {}, replaceChildren() { this.innerHTML = ''; }, addEventListener() {}, scrollIntoView() {}, focus() {}, setSelectionRange() {},
      closest: () => ({ scrollIntoView() {} }) });
    return elements.get(id);
  };
  const storage = new Map(Object.entries(stored));
  const context = {
    document: { getElementById: element, querySelectorAll: () => [], addEventListener: (type, fn) => listeners.push([type, fn]), visibilityState: 'visible' },
    window: { addEventListener() {}, dispatchEvent() {} }, location: { hash: '#payload.signature', reload() {} },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    crypto: { randomUUID: () => crypto.randomUUID() }, CustomEvent: class {}, HTMLImageElement: class {}, setTimeout, clearTimeout, console,
    fetch: async (url) => ({ ok: true, status: 200, json: async () => (String(url).endsWith('/export') ? exportData : { shoppingList }) }),
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/whatsapp-storefront-cart.js', import.meta.url), 'utf8'), context, { filename: 'whatsapp-storefront-cart.js' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const click = (ack) => { for (const [type, fn] of listeners) if (type === 'click') fn({ target: { closest: (sel) => (sel === 'button' ? { dataset: { ack } } : null) } }); };
  return { el: (id) => element(id), click, storage };
}

test('the cart page shows notes as information on their rows, leaves SIIRRY MAKSAMAAN open and escapes the text', async () => {
  const shoppingList = { ...list(), lines: [list().lines[0]] };
  const hostile = '<img src=x onerror=alert(1)>';
  const exportData = { state: 'ready', id: 'WD-1', revision: 3, lines: [{ id: 'P1', name: 'Peruna', qty: 3, unit: 'sk', price: 1, vat: 14, requested: { value: 6, unit: 'KG' } }],
    notes: [{ ...NOTE_A, text: hostile }, { ...NOTE_B, title: hostile }] };
  const p = await page({ shoppingList, exportData });
  assert.equal(p.el('wa-review').disabled, false);
  assert.equal(p.el('wa-checks').hidden, false);
  // The product note sits under its own row; the order-wide note is in the box above the table. Nothing to tick off.
  assert.match(p.el('wa-lines').innerHTML, /wa-check-row[\s\S]*data-kind="rounded"/);
  assert.match(p.el('wa-checks-list').innerHTML, /data-kind="stock"/);
  assert.match(p.el('wa-checks-list').innerHTML, /1 huomio on tuoterivien alla/);
  for (const id of ['wa-lines', 'wa-checks-list']) {
    assert.doesNotMatch(p.el(id).innerHTML, /<img src=x/, id);
    assert.doesNotMatch(p.el(id).innerHTML, /data-ack|Selvä|Kuitattu/, id);
  }
  // No notes: the box stays hidden.
  const clean = await page({ shoppingList, exportData: { ...exportData, notes: [] } });
  assert.equal(clean.el('wa-review').disabled, false); assert.equal(clean.el('wa-checks').hidden, true);
});
