// Maksusivu: jokainen skriptin käyttämä elementti on sivulla, ja puhelimella maksusivu ja sen jatkolinkit aukeavat ilman estoa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/demo-payment.html');
const script = read('../public/demo-payment.js');

test('every element the payment script uses exists on the page', () => {
  const used = new Set([...script.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1]));
  for (const id of ["pay", "cancel"]) used.add(id);
  assert.ok(used.size > 20);
  for (const id of used) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('payment page has a pay button, a success view with a way home, and never asks for real card data', () => {
  assert.match(html, /id="checkout"[\s\S]*name="method" value="card"[\s\S]*name="method" value="invoice"/);
  assert.match(html, /id="done"[\s\S]*Maksu onnistui[\s\S]*href="\/">Palaa etusivulle/);
  assert.doesNotMatch(html, /<input(?![^>]*type="radio")/, 'only payment method radios, no card number or other free inputs');
  assert.match(html, /font-src 'self'/, 'Matter font loads under the page CSP');
  for (const file of [html, script, read('../public/demo-payment.css')]) assert.doesNotMatch(file, /·/);
});

function gate(pathname) {
  let added = null;
  const context = {
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
    screen: { width: 390, height: 844 }, location: { pathname }, matchMedia: () => ({ matches: true }),
    document: { documentElement: { classList: { add() {} } }, addEventListener() {},
      createElement: () => ({ setAttribute() {}, querySelector: () => ({ focus() {} }), innerHTML: '' }),
      body: { children: [], append(node) { added = node; } } },
  };
  vm.runInNewContext(read('../public/mobile-gate.js'), context);
  return added;
}

test('phones open the payment page from the WhatsApp cart, only Keskustele keeps the gate', () => {
  assert.equal(gate('/demo-payment.html'), null);
  assert.equal(gate('/demo-payment'), null);
  assert.ok(gate('/keskustele'));
  assert.ok(gate('/keskustele.html'));
  assert.equal(gate('/agentti.html'), null, 'the agent trace behind Katso, miten agentti kokosi tilauksen opens on a phone');
});
