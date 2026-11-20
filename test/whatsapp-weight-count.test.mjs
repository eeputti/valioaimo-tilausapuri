// Kappalemäärä kiloina myytävälle tuotteelle (puhelinkuva 17.11.): "kanan fileesuikale 100 kpl" näytti vaihtoehdot
// "2 kg, 100 kg (100 kg), 899,00 €", koska kiloina myytävän tuotteen myyntierä on 1 kg ja 100 kpl luettiin 100 myyntieräksi.
// Nyt kappaleriville ei tarjota kiloina myytävää tuotetta: kilot kysytään, ja seuraava pelkkä luku on kiloja.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-weight-count-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createRuleInterpreter } = await import('../server/order-conversation/interpret.mjs');
const { understand } = await import('../server/aimo/understand.mjs');

const customer = { customerId: 'c1', buyerId: 'demo-nordic', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const NOW = Date.parse('2026-11-15T09:00:00+02:00');
const kg = (id, name, price) => ({ productId: id, name, salesUnits: 1, salesUnitLabel: 'kg', covers: { value: 1, unit: 'KG' }, lineNet: price });
const pcs = (id, name, price) => ({ productId: id, name, salesUnits: 1, salesUnitLabel: 'kpl', covers: { value: 3, unit: 'KG' }, lineNet: price });

function setup(optionsFor) {
  const asked = [];
  const tools = {
    suggest: async ({ draft }) => ({ issues: [], lines: draft.lines.map((l) => { asked.push(structuredClone(l.quantity)); return { ref: l.ref, total: 3, clarify: [], exact: true, more: false, options: optionsFor(l) }; }) }),
    quote: async () => { throw new Error('ei tarjousta tässä testissä'); }, submit: async () => { throw new Error('ei tilausta'); },
  };
  const store = openDraftStore(':memory:', () => NOW);
  const handleTurn = createOrderingConversation({ store, tools, now: () => NOW, interpretTurn: createRuleInterpreter({ understand }) });
  let n = 0;
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'conv', customer, text, receivedAt: NOW });
  return { say, asked, list: () => store.active('conv') };
}

test('kappalerivi ja pelkät kiloina myytävät vaihtoehdot: kilot kysytään, ja vastaus "30" on 30 kg', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const f = setup((l) => (l.quantity.unit === 'KG' ? [kg('462306', 'Kariniemen Kananpojan fileesuikale maustamaton 2 kg', 8.99 * l.quantity.value)]
    : [kg('462306', 'Kariniemen Kananpojan fileesuikale maustamaton 2 kg', 899), kg('462270', 'Kariniemen Kananpojan fileesuikale hunaja 4 kg', 928)]));
  const first = await f.say('100 kpl kanan fileesuikaletta tiistaiksi');
  assert.match(first.text, /^Kanan fileesuikale myydään kiloina, joten määrästä 100 kpl en voi laskea tilattavia kiloja\./u);
  assert.match(first.text, /Kuinka monta kiloa laitetaan: kanan fileesuikale\?$/u);
  assert.doesNotMatch(first.text, /100 kg|899/u);
  assert.equal(first.status, 'collecting');
  assert.equal(f.list().lines[0].quantity, null);
  const next = await f.say('30');
  assert.deepEqual(f.list().lines[0].quantity, { value: 30, unit: 'KG' });
  assert.deepEqual(f.asked.at(-1), { value: 30, unit: 'KG' });
  assert.equal(next.status, 'choosing');
  assert.match(next.text, /\*Kanan fileesuikale 30 kg:\*\n1\) Kariniemen Kananpojan fileesuikale maustamaton 2 kg/u);
});

test('enimmäkseen kiloina myytävä tuote kysyy kilot; enimmäkseen kappaletavarasta jäävät kappaleina myytävät', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const f = setup(() => [kg('A', 'Fileesuikale 2 kg', 899), pcs('B', 'Fileesuikale kypsä 3 kg', 1200), kg('C', 'Fileesuikale hunaja 4 kg', 928)]);
  const r = await f.say('100 kpl kanan fileesuikaletta tiistaiksi');
  assert.match(r.text, /myydään kiloina/u); assert.doesNotMatch(r.text, /1200|300 kg/u);
  const bread = setup(() => [pcs('B1', 'Ruisleipä 12 kpl', 30), kg('B2', 'Ruisleipä irto', 9), pcs('B3', 'Ruisvuokaleipä', 25)]);
  const b = await bread.say('10 kpl ruisleipää tiistaiksi');
  assert.equal(b.status, 'choosing');
  assert.match(b.text, /1\) Ruisleipä 12 kpl/u); assert.match(b.text, /2\) Ruisvuokaleipä/u);
  assert.doesNotMatch(b.text, /irto/u);
  const eggs = setup(() => [kg('E', 'Kananmuna irto', 4)]);
  const e = await eggs.say('100 kananmunaa tiistaiksi');
  assert.match(e.text, /1\) Kananmuna irto/u); // munien kappalemäärä (items) ei ole tämän säännön piirissä
});

test('oikea katalogi ja simuloidut hinnat: kanan fileesuikale 100 kpl ei näytä 100 kilon vaihtoehtoja', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const { createOrderingTools } = await import('../server/order-tools/index.mjs');
  const tools = createOrderingTools();
  const store = openDraftStore(':memory:', () => NOW);
  const handleTurn = createOrderingConversation({ store, tools, now: () => NOW, interpretTurn: createRuleInterpreter({ understand }) });
  let n = 0;
  const say = (text) => handleTurn({ messageId: `r${++n}`, conversationId: 'real', customer, text, receivedAt: NOW });
  const first = await say('100 kpl kanan fileesuikaletta maanantaiksi');
  assert.doesNotMatch(first.text, /100 kg \(100 kg\)/u);
  const options = (first.text.match(/^\d\) .*$/gmu) || []);
  // Joko kilot kysytään, tai näytetään vain kappaleina myytäviä vaihtoehtoja (ei "N kg" -myyntieriä).
  if (/myydään kiloina/u.test(first.text)) {
    const kilos = await say('30');
    assert.doesNotMatch(kilos.text, /myydään kiloina/u);
    assert.deepEqual(store.active('real').lines[0].quantity, { value: 30, unit: 'KG' });
  } else for (const o of options) assert.doesNotMatch(o, /, \d+(?:,\d+)? kg[ ,(]/u, o);
});
