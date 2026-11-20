// Sivuston yhteiset osat: puhelimella vain Keskustele estetty, Keskustele-sivun live-näkymän rivit ja yhteinen koodinäkymä.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { liveLines, replyOptions } from '../public/keskustele-live.js';
import * as agentCode from '../public/agent-code.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pages = ['../index.html', ...readdirSync(new URL('../public/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `../public/${f}`)];
const text = (lines) => lines.map((l) => l.code ?? (l.res !== undefined ? `→ ${l.res}` : '')).join('\n');

test('every page loads the phone gate in <head> right after the shared stylesheet', () => {
  for (const page of pages) {
    const html = read(page);
    if (!html.includes('href="/site.css"')) continue;
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<link rel="stylesheet" href="\/site.css">\s*<script src="\/mobile-gate.js"><\/script>/, page);
  }
  assert.match(read('../src/web-chat.ts'), /<link rel="stylesheet" href="\/site.css"><script src="\/mobile-gate.js"><\/script><\/head>/);
});

function gate(userAgent, pathname = '/keskustele', { coarse = false, width = 1440 } = {}) {
  const children = [{ inert: false, setAttribute() {} }];
  const classes = [];
  let added = null;
  const element = () => ({ setAttribute() {}, querySelector: () => ({ focus() {} }), innerHTML: '' });
  const context = {
    navigator: { userAgent }, screen: { width, height: 900 }, location: { pathname },
    matchMedia: () => ({ matches: coarse }),
    document: { documentElement: { classList: { add(c) { classes.push(c); } } }, createElement: element,
      body: { children, append(node) { added = node; } }, addEventListener() {} },
  };
  vm.runInNewContext(read('../public/mobile-gate.js'), context);
  return { classes, gate: added, hidden: children.every((c) => c.inert) };
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';

test('phones see the Keskustele page as a WhatsApp prompt with a call button, desktops and tablets do not', () => {
  const iphone = gate(IPHONE);
  assert.deepEqual(iphone.classes, ['is-phone', 'phone-gate']);
  assert.ok(iphone.hidden, 'page content is inert behind the gate');
  assert.match(iphone.gate.innerHTML, /Keskustele WhatsAppissa/);
  assert.match(iphone.gate.innerHTML, /jutellaan oikeassa WhatsAppissa\. Olethan yhteydessä Eelikseen/);
  assert.match(iphone.gate.innerHTML, /href="tel:\+358503260441"/);
  assert.match(iphone.gate.innerHTML, /class="gate-home" href="\/"/);
  for (const path of ['/keskustele.html', '/keskustele/']) assert.ok(gate(ANDROID, path).gate, path);
  assert.equal(gate('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15').gate, null);
  assert.equal(gate('Mozilla/5.0 (Linux; Android 15; Tab S9) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', '/keskustele', { coarse: true, width: 1600 }).gate, null);
  assert.ok(gate('Mozilla/5.0 (X11; Linux x86_64)', '/keskustele', { coarse: true, width: 390 }).gate, 'small touch screen without a phone user agent');
});

test('every other page works on a phone: no gate, only the Keskustele links are hidden', () => {
  for (const path of ['/', '/index.html', '/ostoskori', '/miten', '/agentti.html', '/tilaukset.html', '/demo-payment.html', '/whatsapp/cart', '/keskustelee']) {
    const phone = gate(IPHONE, path);
    assert.equal(phone.gate, null, path);
    assert.deepEqual(phone.classes, ['is-phone'], path);
  }
  assert.deepEqual(gate('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15', '/').classes, []);
  const css = read('../public/site.css');
  assert.match(css, /html\.is-phone a\[href\^="\/keskustele"\],html\.is-phone \.no-phone\{display:none!important\}/);
  // The text that only introduces a Keskustele link goes with it.
  assert.match(read('../index.html'), /<p class="try-note no-phone">/);
  assert.match(read('../public/miten.html'), /<p class="site-lead no-phone">Juttele itse täältä:<\/p>\s*<a class="miten-cta" href="\/keskustele">/);
});

test('the live view starts as a dimmed skeleton and follows the conversation', () => {
  const empty = liveLines();
  assert.match(text(empty), /selain\.vastaanota\(\)/);
  assert.ok(empty.some((l) => l.later && /portti\.post\("\/v1\/orders"/.test(l.code)), 'the order step waits, dimmed');

  const busy = liveLines({ messages: ['tarviin 20 l maitoo perjantaiks'], busy: true });
  assert.match(text(busy), /→ "tarviin 20 l maitoo perjantaiks"/);
  assert.match(text(busy).split('\n').at(-1), /tulkitaan uusinta viestiä/);

  const list = {
    id: 'd1', revision: 3, deliveryDate: '2026-11-20', diet: { known: true, claims: [], excludeAllergens: [] }, status: 'needs_product_selection', missing: [],
    lines: [
      { ref: 'r1', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: ['FREE_FROM_LACTOSE'], excludeAllergens: [], selectedName: 'Valio Eila 3 % maitojuoma 1 l laktoositon' },
      { ref: 'r2', productTerm: 'voi', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [], selectedName: null },
    ],
  };
  const replies = ['Voille löytyi nämä:\n1) Valio voi 500 g normaalisuolainen, 10 kpl (5 kg), 31,90 €\n2) Valio Eila voi 500 g, 10 kpl (5 kg), 33,10 €\n3) Näytä lisää vaihtoehtoja'];
  const live = text(liveLines({ messages: ['tarviin 20 l maitoo ja 5 kg voita perjantaiks'], replies, list }));
  assert.match(live, /→ maito 20 l, laktoositon/);
  assert.match(live, /→ toimitus pe 20\.11\./);
  assert.match(live, /const maito = await tuotteet\.hae\("maito", \{ toimitus: "2026-11-20", vaatimus: \["laktoositon"\] \}\)/);
  assert.match(live, /→ valittu: Valio Eila 3 % maitojuoma 1 l laktoositon/);
  assert.match(live, /→ 2 tilattavaa vaihtoehtoa, kokki valitsee numerolla/);
  assert.match(live, /→ 1\) Valio voi 500 g normaalisuolainen/);
  assert.doesNotMatch(live, /Näytä lisää/);
  assert.match(live, /ostoskori\.päivitä\(tarve\)   \/\/ kori v3/);
  assert.match(live, /→ 1\/2 tuotetta valittu/);

  const noDate = text(liveLines({ messages: ['voita'], list: { ...list, deliveryDate: null, status: 'needs_details', missing: ['deliveryDate'] } }));
  assert.match(noDate, /toimituspäivä puuttuu: agentti kysyy sen ensin/);
  assert.match(noDate, /odottaa toimituspäivää: tuotteita ei haeta ennen sitä/);

  const ready = text(liveLines({ messages: ['ok'], list: { ...list, status: 'review', lines: list.lines.map((l) => ({ ...l, selectedName: l.selectedName || 'Valio voi' })) }, linkSent: true }));
  assert.match(ready, /→ 2 riviä valmiina, kokki tarkistaa ja vahvistaa itse/);
  assert.match(ready, /→ korilinkki lähetetty/);
});

test('reply options keep only numbered product rows', () => {
  assert.deepEqual(replyOptions(['Valitse:\n1) A, 3,00 €\n2) B, 4,00 €\n3) Näytä lisää vaihtoehtoja', 'Tilausluonnos\n1. A: 2 kpl']), [{ n: 1, text: 'A, 3,00 €' }, { n: 2, text: 'B, 4,00 €' }]);
});

test('the agent page imports only names the shared code module exports', () => {
  const names = /import \{([^}]+)\} from '\.\/agent-code\.js'/.exec(read('../public/agentti.js'))[1].split(',').map((n) => n.trim());
  for (const name of names) assert.ok(name in agentCode, name);
  const lines = agentCode.codeLines({
    orderId: 'AGW-20261115-0001', turns: [], options: [], understood: { lines: [], diet: { claims: [], excludeAllergens: [] }, deliveryDate: '2026-11-20' },
    ledger: { events: [] }, quotes: { count: 0, final: null }, order: { status: 'confirmed', lines: [] },
  });
  assert.equal(lines[0].code, 'import { whatsapp, tulkki, tuotteet, valio, portti, ostoskori } from "aimo"');
});
