// Toimitustukun näköinen WhatsApp-korisivu: rajatut staattiset tiedostot, tunnelirajaus ja sama
// palvelimen luonnos/API. Eristetyt kannat, simuloidut hinnat; ei Meta-, malli- tai Valio-kutsuja.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Kaupalliset fontit (Matter, National 2) eivät ole julkisessa repossa; ne tarkistetaan, kun ne on kopioitu paikallisesti.
const hasFonts = fs.existsSync(new URL('../public/storefront-assets/Matter-Bold.otf', import.meta.url));
const checked = (ref) => hasFonts || !ref.endsWith('.otf');
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createStorefrontCartPage } from '../server/whatsapp/storefront-cart.mjs';

const raw = (base, pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  // Raw request: keeps dot segments and lets the test send tunnel/proxy headers, including Host.
  const { hostname, port } = new URL(base);
  const req = http.request({ hostname, port, path: pathname, method, headers }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject); req.end();
});

async function serveModule(t, options) {
  const page = createStorefrontCartPage(options);
  const server = http.createServer((req, res) => {
    if (!page.handle(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(418); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves the storefront-styled cart page and only allowlisted styles, fonts, icons and cached images', async (t) => {
  const imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-storefront-img-'));
  t.after(() => fs.rmSync(imageDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(imageDir, '123.jpg'), Buffer.from('jpeg-bytes'));
  fs.writeFileSync(path.join(imageDir, '_meta.json'), JSON.stringify({ 123: { file: '123.jpg', type: 'image/jpeg', source: 'valioaimo.fi' }, 456: { miss: 1 },
    789: { file: '../secret.jpg', type: 'image/jpeg', source: 'valioaimo.fi' }, 790: { file: '123.jpg', type: 'text/html', source: 'valioaimo.fi' },
    // Toisen tuotteen kuva, Open Food Facts tai lähteetön merkintä ei ole Valion kuva tästä tuotteesta.
    791: { file: '123.jpg', type: 'image/jpeg', source: 'valioaimo.fi (lähin vastaava)' }, 792: { file: '123.jpg', type: 'image/jpeg', source: 'Open Food Facts (CC BY-SA)' },
    793: { file: '123.jpg', type: 'image/jpeg' } }));
  const base = await serveModule(t, { view: 'storefront', imageDir });

  const page = await fetch(`${base}/whatsapp/cart`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const csp = page.headers.get('content-security-policy');
  for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"]) assert.ok(csp.includes(directive), directive);
  assert.doesNotMatch(csp, /unsafe|\*/);
  const html = await page.text();
  for (const piece of ['class="cart-page wa-cart"', 'class="store-header"', 'id="wa-days"', 'SIIRRY MAKSAMAAN', 'Tilausdemo']) assert.ok(html.includes(piece), piece);
  // The strict CSP blocks inline styles and handlers, so the markup must not rely on them.
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/i);
  assert.doesNotMatch(html, /\/storefront-assets\/|https?:\/\//);
  for (const [, ref] of [...html.matchAll(/(?:href|src)="(\/[^"#]+)"/g)].filter(([, r]) => checked(r))) assert.equal((await fetch(base + ref)).status, 200, ref);

  for (const css of ['/whatsapp/cart/storefront.css', '/whatsapp/cart/storefront-cart.css', '/whatsapp/cart/shop.css']) {
    const response = await fetch(base + css);
    assert.match(response.headers.get('content-type'), /^text\/css/);
    const text = await response.text();
    assert.doesNotMatch(text, /\/storefront-assets\//, `${css} viittaa tunnelin ulkopuoliseen polkuun`);
    for (const [, ref] of [...text.matchAll(/url\('([^']+)'\)/g)].filter(([, r]) => checked(r))) assert.equal((await fetch(base + ref)).status, 200, `${css}: ${ref}`);
  }
  const font = await fetch(`${base}/whatsapp/cart/assets/Matter-Bold.otf`);
  if (hasFonts) assert.equal(font.headers.get('content-type'), 'font/otf'); else assert.equal(font.status, 404);
  assert.equal((await fetch(`${base}/whatsapp/cart/assets/icons/trash.svg`)).headers.get('content-type'), 'image/svg+xml');

  const cached = await fetch(`${base}/whatsapp/cart/img/123`);
  assert.equal(cached.status, 200); assert.equal(cached.headers.get('content-type'), 'image/jpeg');
  assert.equal(await cached.text(), 'jpeg-bytes');
  // A versioned local reference photo of the storefront basket is reused as well.
  const reference = await fetch(`${base}/whatsapp/cart/img/688127`);
  assert.equal(reference.status, 200); assert.equal(reference.headers.get('content-type'), 'image/webp');
  // Uncached, traversing, wrongly typed or malformed ids are 404: no remote image lookup via the tunnel.
  // 9999298 on vertailukorin S-kauppojen kuva: ei Valion palvelimelta, ei näytetä.
  for (const id of ['456', '789', '790', '791', '792', '793', '9999298', '999999', '..%2f..%2f.env', 'a.b', 'x'.repeat(21)]) {
    assert.equal((await raw(base, `/whatsapp/cart/img/${id}`)).status, 404, id);
  }
  for (const asset of ['sources.json', '688127.jpg', 'icons/nope.svg', '..%2fstorefront.js', 'icons/..%2f..%2f..%2fserver%2findex.mjs', 'Matter-Regular.otf.map']) {
    assert.equal((await raw(base, `/whatsapp/cart/assets/${asset}`)).status, 404, asset);
  }
  assert.equal((await raw(base, '/whatsapp/cart', {}, 'POST')).status, 405);
  // The signed API remains in cart-link.mjs; this module never answers it.
  for (const route of ['/whatsapp/cart/api', '/whatsapp/cart/api/chat', '/whatsapp/cart/api/export', '/whatsapp/cart.js', '/cart.html', '/img/123']) {
    assert.equal((await raw(base, route)).status, 418, route);
  }
});

const skip = !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu';
const SECRET = 'storefront-cart-test-secret';
async function standalone(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-storefront-cart-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/whatsapp-server.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, WHATSAPP_PORT: '0', PORT: '0', WHATSAPP_ENABLED: 'false', AIMO_EMBEDDED_STOREFRONT: '',
      WHATSAPP_ORDERING_ENABLED: 'true', WHATSAPP_PUBLIC_URL: 'https://cart.example.test', VALIO_API_KEY: '', ANTHROPIC_API_KEY: '',
      AIMO_DB: path.join(dir, 'prices.db'), GATEWAY_DB: path.join(dir, 'gateway.db'),
      WHATSAPP_DB: path.join(dir, 'whatsapp.db'), WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db'), WHATSAPP_QUOTE_DB: path.join(dir, 'quotes.db'),
      WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_ACCESS_TOKEN: 'test', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'test',
      WHATSAPP_SUPPORT_CONTACT: 'Testin ylläpito', WHATSAPP_API_VERSION: 'v25.0', WHATSAPP_DEMO_PHONE: '', WHATSAPP_CART_SOURCE_URL: '',
      DEMO_NOW: '2026-11-14T10:00:00+02:00',
      GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode == null) { child.kill(); await once(child, 'exit'); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let log = '';
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${log}`)), 15000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exit ${code}: ${log}`)); });
    const read = (chunk) => {
      log += chunk;
      const match = log.match(/WhatsApp test → http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
  });
  return { base, dir };
}
// The same HMAC capability that cart-link.mjs issues in the WhatsApp reply.
function cartToken(dir) {
  const wa = new DatabaseSync(path.join(dir, 'whatsapp.db'), { readOnly: true });
  const drafts = new DatabaseSync(path.join(dir, 'drafts.db'), { readOnly: true });
  try {
    const { binding } = wa.prepare("SELECT binding FROM members WHERE phone='358000000001'").get();
    const active = drafts.prepare("SELECT id FROM drafts WHERE state='active'").all();
    assert.equal(active.length, 1);
    const payload = Buffer.from(JSON.stringify({ binding, draft: active[0].id, expires: Date.now() + 3600_000 })).toString('base64url');
    return `${payload}.${crypto.createHmac('sha256', SECRET).update(`whatsapp-cart-v1\0${payload}`).digest('base64url')}`;
  } finally { wa.close(); drafts.close(); }
}
const TUNNEL = { host: 'cart.example.test', 'cf-connecting-ip': '203.0.113.7', 'cf-ray': 'test', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' };

test('the WhatsApp cart link opens the storefront cart through the tunnel, priced from the same draft, and confirms once', { skip, timeout: 60000 }, async (t) => {
  const { base, dir } = await standalone(t);
  const say = async (text) => {
    const res = await fetch(`${base}/demo/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    assert.ok(res.ok, `${text}: ${res.status}`); return (await res.json()).text;
  };
  await say('20 l maitoa ja 5 l kermaa maanantaiksi');
  await say('laktoositon');
  assert.match(await say('1'), /\*Kerma 5 l:\*/); // yksi tuoterivi kerrallaan
  assert.match(await say('1'), /TILAA/);
  const token = cartToken(dir);

  // Through the tunnel only the cart page, its own assets and the signed API answer.
  for (const route of ['/whatsapp/cart', '/whatsapp/cart/shop.js', '/whatsapp/cart/shop.css', '/whatsapp/cart/storefront.css', '/whatsapp/cart/assets/National2Compressed-Bold.otf', '/whatsapp/cart/assets/logo.svg', '/whatsapp/cart/img/688127']) {
    assert.equal((await raw(base, route, TUNNEL)).status, 200, route);
  }
  const html = (await raw(base, '/whatsapp/cart', TUNNEL)).body.toString();
  assert.match(html, /\/whatsapp\/cart\/shop\.js/);
  for (const route of ['/', '/cart.html', '/storefront.css', '/storefront-cart-store.js', '/storefront-assets/logo.svg', '/img/688127',
    '/api/local-shop', '/api/storefront/whatsapp-cart', '/console/state', '/demo', '/whatsapp/cart/img/999999']) {
    assert.ok([403, 404].includes((await raw(base, route, TUNNEL)).status), route);
  }
  const auth = { ...TUNNEL, authorization: `Bearer ${token}` };
  assert.equal((await raw(base, '/whatsapp/cart/api', TUNNEL)).status, 410, 'API vaatii korilinkin');
  const { shoppingList } = JSON.parse((await raw(base, '/whatsapp/cart/api', auth)).body);
  assert.equal(shoppingList.status, 'review');
  assert.equal(shoppingList.deliveryDate, '2026-11-16');
  assert.equal(shoppingList.lines.length, 2);
  // Prices and sales units for the page come from a checked quote of exactly this draft revision.
  const exported = JSON.parse((await raw(base, '/whatsapp/cart/api/export', auth)).body);
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  assert.equal(exported.state, 'ready');
  assert.equal(exported.id, shoppingList.id); assert.equal(exported.revision, shoppingList.revision);
  assert.equal(exported.lines.length, 2);
  for (const line of exported.lines) {
    assert.ok(shoppingList.lines.some((l) => l.selectedProductId === line.id), line.id);
    assert.ok(line.qty > 0 && Number.isFinite(line.price) && line.name);
    // Nimi Valion tuotetiedoista ja vertailuhinta hintarajapinnasta (tässä simuloitu), ei sivun omaa laskelmaa.
    assert.equal(line.name, catalog.find((p) => p.id === line.id)?.name, line.id);
    assert.ok(line.comparison?.value > 0 && ['L', 'KG'].includes(line.comparison.unit), JSON.stringify(line));
  }
  assert.doesNotMatch(JSON.stringify(exported), /358000000001|binding|Bearer/);
  // Huomiot ostoskorista tulevat samassa viennissä pelkkänä tietona (cart-notes.test.mjs).
  assert.ok(Array.isArray(exported.notes));

  const chat = async (text, expectedList, messageId = crypto.randomUUID()) => {
    const res = await fetch(`${base}/whatsapp/cart/api/chat`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text, messageId, expectedList, ...(text === 'TILAA' ? { confirm: true } : {}) }) });
    return { status: res.status, data: await res.json(), messageId };
  };
  const review = await chat('näytä', { id: shoppingList.id, revision: shoppingList.revision });
  assert.equal(review.status, 200); assert.equal(review.data.status, 'ready');
  const current = review.data.shoppingList;
  const confirm = await chat('TILAA', { id: current.id, revision: current.revision });
  assert.equal(confirm.status, 200);
  assert.ok(['confirmed', 'pending_approval'].includes(confirm.data.status), confirm.data.status);
  // A lost response is retried with the same message id: same result, still one gateway order.
  const retry = await chat('TILAA', { id: current.id, revision: current.revision }, confirm.messageId);
  assert.equal(retry.data.status, confirm.data.status); assert.equal(retry.data.text, confirm.data.text);
  const orders = (await (await fetch(`${base}/console/state`)).json()).orders;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].deliveryDate, '2026-11-16');
});
