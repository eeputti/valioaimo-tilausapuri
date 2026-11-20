import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { CHAT_PER_SESSION_DAY } from '../src/web-chat.ts';
import { openWhatsAppStore } from '../../../server/whatsapp/store.mjs';
import { createWebChat } from '../../../server/whatsapp/web-chat.mjs';

const SECRET = 'worker-web-chat-secret-' + 'z'.repeat(30);
const ORIGIN = 'https://demo.example';

// The real bot endpoint (server/whatsapp/web-chat.mjs) with a scripted assistant, plus a stand-in cart page.
async function bot() {
  const store = openWhatsAppStore(':memory:');
  const seen = [];
  let base;
  const web = createWebChat({ store, secret: SECRET,
    chat: async (args) => ({ messages: [`Selvä: ${args.messages.at(-1).content}`, `Tässä linkki ostoskoriisi:\n${base}/whatsapp/cart#abc.def`] }),
    cartLink: (member, list) => `${base}/whatsapp/cart#${list.id}.sig`, shoppingList: async () => ({ id: 'WD-9', lines: [{}] }) });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (await web.handle(req, res, url)) return;
    let body = ''; for await (const c of req) body += c;
    seen.push({ path: url.pathname, method: req.method, origin: req.headers.origin, auth: req.headers.authorization, body });
    if (url.pathname === '/whatsapp/cart') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'x=1', 'content-security-policy': "default-src 'none'" }); res.end('<html><head><title>Kori</title></head><body class="cart"><main>kori</main></body></html>'); return; }
    if (url.pathname === '/whatsapp/cart/api/chat') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, store, seen, close: () => { server.close(); store.close(); } };
}

function worker_(backendUrl) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  if (backendUrl) db.prepare("INSERT INTO landing_settings VALUES('bot_backend_url',?)").run(backendUrl);
  const DB = { prepare(sql) { let p = []; return { bind(...v) { p = v; return this; }, async first() { return db.prepare(sql).get(...p) || null; },
    async run() { await null; return { meta: { changes: db.prepare(sql).run(...p).changes } }; } }; } };
  const env = { DB, SYNC_TOKEN: 'sync-' + 'q'.repeat(40), WEBCHAT_SECRET: SECRET, DEMO_PAYMENTS_ENABLED: 'true' };
  let cookie = '';
  const call = async (path, init = {}) => {
    const response = await worker.fetch(new Request(ORIGIN + path, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers || {}) } }), env);
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return response;
  };
  const post = (path, body, headers = { origin: ORIGIN, 'content-type': 'application/json' }) => call(path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { db, env, call, post, cookie: () => cookie, setCookie: (v) => { cookie = v; } };
}
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('a browser chats with the real bot endpoint through the Worker, keeps its own session and gets same-site cart links', async () => {
  const b = await bot(); const w = worker_(b.base);
  try {
    assert.deepEqual(await (await w.call('/api/chat')).json(), { available: true, messages: [], limit: CHAT_PER_SESSION_DAY });
    assert.equal((await w.post('/api/chat', { text: 'maitoa', messageId: uuid(1) }, { 'content-type': 'application/json' })).status, 403);
    assert.equal((await w.post('/api/chat', { text: 'maitoa', messageId: uuid(1) }, { origin: 'https://evil.example', 'content-type': 'application/json' })).status, 403);
    const first = await w.post('/api/chat', { text: '20 l maitoa perjantaiksi', messageId: uuid(1) });
    assert.equal(first.status, 200);
    assert.match(first.headers.get('set-cookie'), /^aimo_chat=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    const data = await first.json();
    assert.equal(data.parts[0], 'Selvä: 20 l maitoa perjantaiksi');
    // The bot's own host never reaches the browser: the cart opens on this site.
    assert.equal(data.parts[1], `Tässä linkki ostoskoriisi:\n${ORIGIN}/whatsapp/cart#abc.def`);
    assert.doesNotMatch(JSON.stringify(data), /127\.0\.0\.1/);
    await w.post('/api/chat', { text: 'ja voita', messageId: uuid(2) });
    const history = await (await w.call('/api/chat')).json();
    assert.deepEqual(history.messages.map((m) => m.text), ['20 l maitoa perjantaiksi', 'ja voita']);
    assert.doesNotMatch(JSON.stringify(history), /127\.0\.0\.1/);
    assert.equal(b.store.db.prepare("SELECT count(*) n FROM members WHERE phone LIKE '3580000%'").get().n, 1);
    assert.deepEqual(await (await w.call('/api/chat/cart')).json(), { url: '/whatsapp/cart#WD-9.sig', lines: 1 });

    // A new browser is a new test customer with an empty conversation.
    const mine = w.cookie(); w.setCookie('');
    assert.deepEqual((await (await w.call('/api/chat')).json()).messages, []);
    await w.post('/api/chat', { text: 'kermaa', messageId: uuid(3) });
    assert.equal(b.store.db.prepare("SELECT count(*) n FROM members WHERE phone LIKE '3580000%'").get().n, 2);
    w.setCookie(mine);
    const reset = await w.post('/api/chat/reset', {});
    assert.match(reset.headers.get('set-cookie'), /^aimo_chat=; .*Max-Age=0/);
  } finally { b.close(); }
});

test('per-browser and daily limits stop the model calls before they reach the bot', async () => {
  const b = await bot(); const w = worker_(b.base);
  try {
    await w.post('/api/chat', { text: 'moi', messageId: uuid(1) });
    const session = w.cookie().split('=')[1];
    w.db.prepare('UPDATE web_chat_usage SET count=? WHERE session=?').run(CHAT_PER_SESSION_DAY, session);
    const limited = await w.post('/api/chat', { text: 'lisää', messageId: uuid(2) });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'limit');
    assert.equal(b.store.db.prepare("SELECT count(*) n FROM inbox WHERE text='lisää'").get().n, 0);
    w.db.prepare("UPDATE web_chat_usage SET count=300 WHERE session='*'").run();
    w.setCookie('');
    assert.equal((await w.post('/api/chat', { text: 'uusi', messageId: uuid(3) })).status, 429);
  } finally { b.close(); }
});

test('without a configured bot the page says it is offline instead of failing', async () => {
  const w = worker_(null);
  assert.deepEqual(await (await w.call('/api/chat')).json(), { available: false, messages: [] });
  const offline = await w.post('/api/chat', { text: 'moi', messageId: uuid(1) });
  assert.equal(offline.status, 503);
  assert.equal((await offline.json()).code, 'offline');
  assert.equal((await w.call('/whatsapp/cart')).status, 503);
  // A bot that does not know the chat route yet (older server) counts as offline, not as a failed message.
  const old = http.createServer((req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  try {
    const legacy = worker_(`http://127.0.0.1:${old.address().port}`);
    const response = await legacy.post('/api/chat', { text: 'moi', messageId: uuid(2) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'offline');
  } finally { old.close(); }
  const plain = worker_('ftp://bot.example');
  assert.equal((await plain.call('/api/chat/cart')).status, 503);
});

test('the cart page is served on this site with the site tabs, and its API calls pass the bot origin check', async () => {
  const b = await bot(); const w = worker_(b.base);
  try {
    const page = await w.call('/whatsapp/cart');
    const html = await page.text();
    assert.equal(page.headers.get('set-cookie'), null);
    assert.equal(page.headers.get('content-security-policy'), "default-src 'none'");
    assert.match(html, /<link rel="stylesheet" href="\/site\.css"><script src="\/mobile-gate\.js"><\/script><\/head>/);
    assert.match(html, /<body class="cart"><header class="site-header">.*<a href="\/ostoskori" aria-current="page">Ostoskori<\/a>.*<\/header><main>kori<\/main>/);
    const ok = await w.call('/whatsapp/cart/api/chat', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer cap.sig' }, body: '{"text":"näytä"}' });
    assert.equal(ok.status, 200);
    const forwarded = b.seen.find((s) => s.path === '/whatsapp/cart/api/chat');
    assert.equal(forwarded.origin, b.base);
    assert.equal(forwarded.auth, 'Bearer cap.sig');
    assert.equal(forwarded.body, '{"text":"näytä"}');
    assert.equal((await w.call('/whatsapp/cart/api/chat', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await w.call('/whatsapp/../secret')).status, 404);
  } finally { b.close(); }
});

test('the "Näin se toimii" example trace is public only for the order chosen in D1', async () => {
  const w = worker_(null);
  assert.equal((await w.call('/api/agent-traces/esimerkki')).status, 404);
  const trace = { version: 1, orderId: 'AGW-20261115-0008', observedAt: Date.now(), order: {}, understood: {}, quotes: {}, ledger: {}, options: [],
    turns: [{ at: '2026-11-15T14:52:56.000Z', source: 'whatsapp', customer: 'maitoa', action: null, replies: ['Joo'], status: null, revision: null }] };
  const stored = await w.call('/api/agent-traces', { method: 'POST', headers: { authorization: `Bearer ${w.env.SYNC_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(trace) });
  assert.equal(stored.status, 200);
  assert.equal((await w.call('/api/agent-traces/esimerkki')).status, 404);
  w.db.prepare("INSERT INTO landing_settings VALUES('example_trace_order','AGW-20261115-0008')").run();
  const example = await w.call('/api/agent-traces/esimerkki');
  assert.equal(example.status, 200);
  assert.equal((await example.json()).trace.turns[0].customer, 'maitoa');
  // Other orders still need their own payment link.
  assert.equal((await w.call('/api/agent-traces/AGW-20261115-0008')).status, 404);
});
