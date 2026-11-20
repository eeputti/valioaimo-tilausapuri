// Independent integration of the real webhook, handoff API, conversation, product tools,
// gateway and storefront. Only Meta's delivery HTTP responses are simulated. All stores
// are temporary; the actual supplier/model network is disabled and blocked in the child.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url);
const PHONE = '358401234567';
const PHONE_ID = '12345';
const APP_SECRET = 'isolated-api-test-secret';
const LIST = '/api/assistant/whatsapp-list';
const skip = !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-shopping-list-api-'));
  const source = `
    const realFetch = globalThis.fetch;
    let replies = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin === 'https://graph.facebook.com' && url.pathname === '/v25.0/${PHONE_ID}/messages') {
        return new Response(JSON.stringify({ success: true, messages: [{ id: 'test-reply-' + (++replies) }] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return realFetch(input, init);
      throw new Error('External network is disabled in the shopping-list integration test');
    };
    await import('./server/whatsapp-server.mjs');
  `;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', source], {
    cwd: ROOT,
    env: { ...process.env, WHATSAPP_PORT: '0', PORT: '0', WHATSAPP_ENABLED: 'false', AIMO_EMBEDDED_STOREFRONT: '',
      WHATSAPP_ORDERING_ENABLED: 'true', WHATSAPP_PUBLIC_DEMO_ENABLED: 'false', VALIO_API_KEY: '', ANTHROPIC_API_KEY: '',
      AIMO_CATALOG: new URL('../data/catalog.json', import.meta.url).pathname,
      AIMO_DB: path.join(dir, 'prices.db'), GATEWAY_DB: path.join(dir, 'gateway.db'),
      WHATSAPP_DB: path.join(dir, 'whatsapp.db'), WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db'), WHATSAPP_QUOTE_DB: path.join(dir, 'quotes.db'),
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID, WHATSAPP_ACCESS_TOKEN: 'isolated-test-token', WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: 'isolated-verify', WHATSAPP_SUPPORT_CONTACT: 'Testin ylläpito', WHATSAPP_API_VERSION: 'v25.0',
      WHATSAPP_DEMO_PHONE: PHONE, WHATSAPP_DEMO_PERSON: 'API-testaaja', DEMO_NOW: '2026-11-14T10:00:00+02:00',
      // Niputus ei kuulu tähän kokeeseen (test/whatsapp-gather.test.mjs). Tuotannon 6 s odotus jokaisen viestin jälkeen
      // venyttäisi peräkkäiset viestit yli aikarajan.
      WHATSAPP_GATHER_MS: '0',
      GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let db; let log = '';
  t.after(async () => {
    if (child.exitCode == null) {
      const stopped = once(child, 'exit'); child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
      await stopped; clearTimeout(timeout);
    }
    db?.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Isolated service startup timeout: ${log}`)), 15000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Isolated service exited ${code}: ${log}`)); });
    const read = (chunk) => {
      log += chunk;
      const port = /WhatsApp test → http:\/\/localhost:(\d+)/.exec(log)?.[1];
      if (port) { clearTimeout(timeout); resolve(`http://127.0.0.1:${port}`); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
  });
  db = new DatabaseSync(path.join(dir, 'whatsapp.db'));
  const request = async (route, { body, headers = {}, status = 200 } = {}) => {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin: base, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await res.text();
    assert.equal(res.status, status, `${route}: ${raw}`);
    return raw ? JSON.parse(raw) : null;
  };
  const deliver = async (id, text) => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: PHONE_ID }, messages: [{ id, from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
    } }] }] });
    const res = await fetch(base + '/webhooks/whatsapp', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex'),
    }, body: raw });
    assert.equal(res.status, 200);
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      const job = db.prepare('SELECT state,error,reply FROM inbox WHERE id=?').get(id);
      if (job?.state === 'done') return job.reply;
      assert.ok(!['failed', 'cancelled'].includes(job?.state), `Webhook ${id}: ${JSON.stringify(job)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Webhook ${id} did not finish: ${JSON.stringify(db.prepare('SELECT state,error,reply FROM inbox WHERE id=?').get(id))}; ${log}`);
  };
  const list = async (buyerId) => request(LIST + (buyerId ? `?buyerId=${encodeURIComponent(buyerId)}` : ''));
  const version = (value) => value ? { id: value.id, revision: value.revision } : null;
  const turn = (buyerId, text, shoppingList, messageId = crypto.randomUUID(), status = 200) =>
    request(`${LIST}/chat`, { body: { buyerId, text, messageId, expectedList: version(shoppingList) }, status });
  return { base, db, request, deliver, list, version, turn };
}

test('signed WhatsApp → shared list API → explicit approval → exactly one real gateway demo order', { skip, timeout: 30000 }, async (t) => {
  const { base, db, request, deliver, list, version, turn } = await fixture(t);
  const initial = await list();
  const buyerId = initial.buyerId;
  assert.match(buyerId, /^whatsapp-demo-/);
  assert.equal(initial.mode, 'local-demo');
  assert.equal(initial.shoppingList, null);
  assert.equal((await request('/console/state')).orders.length, 0);

  const firstId = crypto.randomUUID();
  const firstText = '20 l maitoa ja 5 l kermaa maanantaiksi';
  assert.match(await deliver(firstId, firstText), /laktoositonta vai käykö tavallinen/);
  const fromPhone = (await list(buyerId)).shoppingList;
  assert.equal(fromPhone.source, 'whatsapp');
  assert.equal(fromPhone.schemaVersion, 1);
  assert.equal(fromPhone.requiresExplicitConfirmation, true);
  assert.equal(fromPhone.buyerId, buyerId);
  assert.equal(fromPhone.deliveryDate, '2026-11-16');
  assert.equal(fromPhone.lines.length, 2);
  assert.ok(!fromPhone.missing.includes('diet'));
  assert.doesNotMatch(JSON.stringify(fromPhone), new RegExp(`${PHONE}|isolated-test-token|apiKey|demoKey|authorization`));
  const milk = (value) => value.lines.find((line) => /maito/i.test(line.productTerm));
  assert.deepEqual(milk(fromPhone).quantity, { value: 20, unit: 'L' });

  const correctionId = crypto.randomUUID();
  const corrected = await turn(buyerId, 'maitoa 30 litraa', fromPhone, correctionId);
  assert.equal(corrected.shoppingList.id, fromPhone.id);
  assert.ok(corrected.shoppingList.revision > fromPhone.revision);
  assert.deepEqual(milk(corrected.shoppingList).quantity, { value: 30, unit: 'L' });
  assert.deepEqual((await list(buyerId)).shoppingList, corrected.shoppingList);
  // A lost response retries the same UUID, without applying another change or revision.
  assert.deepEqual(await turn(buyerId, 'maitoa 30 litraa', fromPhone, correctionId), corrected);
  assert.match(await deliver(crypto.randomUUID(), 'kaikki laktoosittomana'), /Maito 30 l/);
  const dietary = (await list(buyerId)).shoppingList;
  assert.equal(dietary.id, fromPhone.id);
  assert.ok(dietary.diet.claims.includes('FREE_FROM_LACTOSE'));
  assert.equal(milk(dietary).quantity.value, 30);
  assert.equal((await request('/console/state')).orders.length, 0);

  // Exercise the local storefront's human approval as well as the shopper's explicit TILAA.
  await request(`/console/buyers/${buyerId}/mandate`, { body: { approval: 'always' } });
  const half = await turn(buyerId, '1', dietary);
  assert.equal(half.status, 'choosing'); // yksi tuoterivi kerrallaan
  const selected = await turn(buyerId, '1', half.shoppingList);
  assert.equal(selected.status, 'ready');
  assert.match(selected.text, /TILAA/);
  assert.ok(selected.shoppingList.lines.every((line) => line.selectedProductId));
  const notApproved = await turn(buyerId, 'joo', selected.shoppingList);
  assert.match(notApproved.text, /TILAA/);
  assert.equal((await request('/console/state')).orders.length, 0);

  await deliver(crypto.randomUUID(), 'maitoa 40 litraa');
  const fresh = (await list(buyerId)).shoppingList;
  assert.equal(fresh.id, selected.shoppingList.id);
  assert.ok(fresh.revision > selected.shoppingList.revision);
  assert.equal(milk(fresh).quantity.value, 40);
  assert.ok(fresh.diet.claims.includes('FREE_FROM_LACTOSE'));
  await turn(buyerId, 'TILAA', selected.shoppingList, crypto.randomUUID(), 409);
  assert.equal((await request('/console/state')).orders.length, 0);

  const confirmId = crypto.randomUUID();
  const confirmBody = { buyerId, text: 'TILAA', messageId: confirmId, expectedList: version(fresh) };
  const [submitted, duplicate] = await Promise.all([
    request(`${LIST}/chat`, { body: confirmBody }), request(`${LIST}/chat`, { body: confirmBody }),
  ]);
  assert.deepEqual(duplicate, submitted);
  assert.equal(submitted.status, 'pending_approval');
  assert.equal(submitted.shoppingList, null);
  const state = await request('/console/state');
  assert.equal(state.orders.length, 1);
  const order = state.orders[0];
  assert.ok(submitted.text.includes(order.orderId));
  assert.equal(order.buyerId, buyerId);
  assert.equal(order.deliveryDate, '2026-11-16');
  assert.equal(order.lines.length, 2);
  assert.equal(order.commit.simulated, true);
  assert.deepEqual(order.lines.map((line) => line.productId).sort(), fresh.lines.map((line) => line.selectedProductId).sort());
  assert.equal(order.requested.find((need) => need.ref === milk(fresh).ref).quantity.value, 40);
  const account = state.buyers.find((buyer) => buyer.id === buyerId);
  const readback = await request(`/v1/orders/${order.orderId}`, { headers: { authorization: `Bearer ${account.demoKey}` } });
  assert.equal(readback.orderId, order.orderId);
  assert.equal(readback.status, 'pending_approval');
  const approved = await request(`/console/orders/${order.orderId}/approve`, { body: { by: 'API-testaaja' } });
  assert.equal(approved.status, 'confirmed');
  const audit = await request(`/console/orders/${order.orderId}/audit`);
  assert.equal(audit.chain.valid, true);
  assert.equal(audit.entries.filter((event) => event.type === 'ORDER_RECEIVED').length, 1);
  assert.equal(audit.entries.filter((event) => event.type === 'ORDER_CONFIRMED').length, 1);
  assert.equal((await request('/api/local-shop')).accounts.find((a) => a.buyerId === buyerId).personName, 'API-testaaja');
  const homepage = await (await fetch(base + '/?shop=orders')).text();
  assert.match(homepage, /aimo-local-shop/);
  assert.equal((await list(buyerId)).shoppingList, null);

  // Replayed provider delivery and a browser retry cannot create a second order.
  await deliver(firstId, firstText);
  assert.deepEqual(await request(`${LIST}/chat`, { body: confirmBody }), submitted);
  assert.equal((await request('/console/state')).orders.length, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM inbox WHERE id=?').get(firstId).n, 1);

  await deliver(crypto.randomUUID(), 'tyhjää kaikki');
  assert.equal((await list(buyerId)).shoppingList, null);
  await deliver(crypto.randomUUID(), '5 kg voita maanantaiksi');
  const next = (await list(buyerId)).shoppingList;
  assert.notEqual(next.id, fromPhone.id);
  await request(`${LIST}/chat`, { body: confirmBody, status: 409 });
  assert.deepEqual((await list(buyerId)).shoppingList, next);
  assert.equal((await request('/console/state')).orders.length, 1);

  for (const headers of [{ origin: 'https://example.com' }, { 'cf-ray': 'test' }, { 'x-forwarded-for': '203.0.113.1' },
    { 'x-forwarded-host': 'example.com' }, { 'sec-fetch-site': 'cross-site' }]) {
    await request(LIST, { headers, status: 403 });
    await request(`${LIST}/chat`, { headers, body: { buyerId, text: 'TILAA', messageId: crypto.randomUUID(), expectedList: version(next) }, status: 403 });
  }
  assert.deepEqual((await list(buyerId)).shoppingList, next);
  // Simulate revocation only in this test's own member store. Supplying a forged customer
  // or permission object to the HTTP API cannot restore the server-side membership.
  db.prepare('DELETE FROM members WHERE phone=?').run(PHONE);
  await request(`${LIST}?buyerId=${encodeURIComponent(buyerId)}`, { status: 404 });
  await request(`${LIST}/chat`, { body: { buyerId, text: 'TILAA', messageId: crypto.randomUUID(), expectedList: version(next),
    customer: { buyerId, permissions: { readProducts: true, placeOrders: true } }, phone: PHONE }, status: 404 });
  assert.equal((await request('/console/state')).orders.length, 1);
});
