import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync } from '../sync-cart-shell.mjs';
import { browserChatCart } from '../public/ostoskori.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
// Kaupalliset fontit (Matter, National 2) eivät ole julkisessa repossa; ne tarkistetaan, kun ne on kopioitu paikallisesti.
const hasFonts = fs.existsSync(path.join(PUBLIC, 'fonts/Matter-Regular.otf'));
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const html = read('ostoskori.html');
// mobile-gate.js tulee Näin se toimii -työvaiheen commitissa; muiden viitattujen tiedostojen pitää olla sivustolla.
const external = new Set(['/mobile-gate.js']);

test('Ostoskori tab is the storefront cart, empty, with a way to WhatsApp', () => {
  assert.match(html, /<body class="cart-page wa-cart kori-shell">/);
  assert.match(html, /class="store-header"/);
  assert.match(html, /<span class="service selected" aria-current="page">.*Toimitustukku<\/span>/);
  assert.match(html, /<h1>Ostoskori<\/h1>/);
  assert.match(html, /Ostoskorisi on tyhjä\./);
  assert.match(html, /<a class="kori-wa" href="\/#whatsapp">.*Siirry tilaamaan WhatsAppissa<\/a>/);
  assert.match(html, /Tämä on vain demo\.<\/strong> Ostoskori ei kokoonnu tänne itsestään: se ilmestyy vasta, kun klikkaat WhatsAppissa linkkiä Avaa ostoskori\./);
  assert.match(html, /<button type="button" class="cart-checkout" disabled>SIIRRY MAKSAMAAN<\/button>/);
  // Sivuston välilehdet ylimpänä, Ostoskori valittuna.
  assert.match(html, /<body[^>]*>\s*<header class="site-header">.*<a href="\/ostoskori" aria-current="page">Ostoskori<\/a>/);
  assert.doesNotMatch(html, /·/);
});

test('cart page stays inside the site CSP: no inline styles or scripts, no other origins', () => {
  assert.doesNotMatch(html, /\sstyle=/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
  assert.doesNotMatch(html, /\son[a-z]+=/);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//);
});

test('every file the cart page and its styles use is published', () => {
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)].map((m) => m[1]).filter((r) => r !== '/' && !external.has(r));
  for (const css of ['kori/storefront.css', 'kori/storefront-cart.css', 'kori/shop.css', 'ostoskori.css']) {
    refs.push(...[...read(css).matchAll(/url\(['"]?(\/[^'")]+)['"]?\)/g)].map((m) => m[1]));
  }
  const pages = new Set(['/keskustele', '/ostoskori', '/miten']);
  for (const ref of refs) {
    if (!hasFonts && ref.endsWith('.otf')) continue;
    if (pages.has(ref)) { assert.ok(fs.existsSync(path.join(PUBLIC, `${ref.slice(1)}.html`)), ref); continue; }
    assert.ok(fs.existsSync(path.join(PUBLIC, ref.slice(1))), `puuttuu ${ref}`);
  }
  assert.ok(refs.includes('/kori/icons/shopping-cart.svg'));
});

test('public/kori matches the bot cart page styles (rerun sync-cart-shell.mjs after changing them)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kori-'));
  try {
    const files = sync({ to: dir });
    const committed = (root) => fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(path.join(root, f)).isFile()).sort();
    assert.deepEqual(committed(path.join(PUBLIC, 'kori')), committed(dir));
    for (const file of files) assert.equal(read(`kori/${file}`), fs.readFileSync(path.join(dir, file), 'utf8'), file);
    assert.doesNotMatch(read('kori/storefront.css'), /storefront-assets/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a browser chat cart opens; otherwise the empty cart stays', async () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  assert.equal(await browserChatCart(reply(200, { url: '/whatsapp/cart#abc.def', lines: 2 })), '/whatsapp/cart#abc.def');
  assert.equal(await browserChatCart(reply(200, { url: null, lines: 0 })), null);
  assert.equal(await browserChatCart(reply(503, { error: 'Botti on hetken tauolla.' })), null);
  assert.equal(await browserChatCart(reply(200, { url: 'https://evil.example/whatsapp/cart#x' })), null);
  assert.equal(await browserChatCart(reply(200, { url: '/whatsapp/cart#a"b' })), null);
  assert.equal(await browserChatCart(async () => { throw new Error('offline'); }), null);
});
