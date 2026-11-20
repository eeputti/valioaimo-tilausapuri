import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

// Run the shipped landing script against a minimal DOM: the button and the contact panel.
function page(hash = '') {
  const listeners = {}, windowListeners = {};
  const button = { attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(e, fn) { listeners[e] = fn; } };
  const panel = { hidden: true, scrolled: 0, focused: 0, scrollIntoView() { this.scrolled++; }, focus() { this.focused++; } };
  const location = { hash };
  const context = vm.createContext({
    document: { getElementById: (id) => ({ 'wa-toggle': button, whatsapp: panel })[id] },
    window: { addEventListener(e, fn) { windowListeners[e] = fn; } },
    location,
  });
  vm.runInContext(read('../public/landing.js'), context);
  return { button, panel, click: () => listeners.click(), navigate(h) { location.hash = h; windowListeners.hashchange(); } };
}

test('Kokeile WhatsAppissa opens and closes the contact panel', () => {
  const p = page();
  assert.equal(p.panel.hidden, true);
  p.click();
  assert.equal(p.panel.hidden, false);
  assert.equal(p.button.attributes['aria-expanded'], 'true');
  assert.equal(p.panel.focused, 1);
  p.click();
  assert.equal(p.panel.hidden, true);
  assert.equal(p.button.attributes['aria-expanded'], 'false');
});

test('the browser chat link /#whatsapp opens the panel on arrival and on a hash change', () => {
  const arrived = page('#whatsapp');
  assert.equal(arrived.panel.hidden, false);
  assert.equal(arrived.panel.scrolled, 1);
  const later = page();
  later.navigate('#muu');
  assert.equal(later.panel.hidden, true);
  later.navigate('#whatsapp');
  assert.equal(later.panel.hidden, false);
});

test('the landing page has no sign-up form, only the call instruction for Eelis', () => {
  const html = read('../index.html');
  assert.doesNotMatch(html, /<form|<input|signup/i);
  assert.match(html, /<a href="tel:\+358503260441">050 326 0441<\/a>/);
  assert.match(html, /Olethan yhteydessä Eelikseen!/);
  assert.ok(html.indexOf('Kokeile heti selaimessa') < html.indexOf('Kokeile WhatsAppissa'));
  assert.doesNotMatch(html, /href="\/tilaukset"/);
});

test('the browser chat has no ready-made quick replies and links to WhatsApp on the landing page', () => {
  const html = read('../public/keskustele.html');
  assert.doesNotMatch(html, /data-text=|id="quick"/);
  assert.match(html, /class="aside-button" href="\/#whatsapp"/);
  assert.match(html, /class="notice-wa" href="\/#whatsapp"/);
  assert.doesNotMatch(html, /href="\/tilaukset"/);
  assert.doesNotMatch(read('../public/keskustele.js'), /\$\('quick'\)/);
});
