// Tarjouksessa kaatunut valinta (puhelinkuva 17.11. klo 9.40): "Sipuli 5 kpl", valinta 3 → "Ei tilattavissa: sipuli. Määrää ei voi
// muuntaa tämän tuotteen myyntiyksiköiksi" ja samat vaihtoehdot uudelleen. Nyt viesti nimeää tuotteen, tuote jää pois seuraavista
// vaihtoehdoista, ja kappalemääräksi tallennettu sipuli menee tarjouksesta läpi samoin kuin vaihtoehto näytettiin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-quote-failure-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-17T09:00:00+02:00', GATEWAY_DB: path.join(dir, 'g.db'), AIMO_DB: path.join(dir, 'k.db'),
  AIMO_LEARNED: path.join(dir, 'learned.json'), GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createRuleInterpreter } = await import('../server/order-conversation/interpret.mjs');
const { understand } = await import('../server/aimo/understand.mjs');

const customer = { customerId: 'c1', buyerId: 'ravintola-kulma', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const NOW = Date.parse('2026-11-17T09:00:00+02:00');
const opt = (id, name, net) => ({ productId: id, name, salesUnits: 5, salesUnitLabel: 'kpl', covers: null, lineNet: net, labels: [] });
const ALL = [opt('A', 'SIPULI 1KG PUSSI HOLLANTI', 4.3), opt('B', 'SIPULI NIPPU SUOMI', 6.95), opt('C', 'SIPULI 10KG SÄKKI NL/EG', 36.25)];

test('kaatunut valinta nimetään, muistetaan rivillä ja jää pois seuraavista vaihtoehdoista', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async () => {
  const seenLines = [];
  const tools = {
    // Jäljittelee order-toolsin sääntöä: rivin failedOptions pudottaa samalle päivälle ja määrälle kaatuneet tuotteet.
    suggest: async ({ draft }) => ({ issues: [], lines: draft.lines.map((l) => {
      seenLines.push(structuredClone(l));
      const failed = new Set(l.failedOptions?.deliveryDate === draft.deliveryDate ? l.failedOptions.ids : []);
      return { ref: l.ref, total: 3, clarify: [], exact: true, more: false, options: ALL.filter((o) => !failed.has(o.productId)) };
    }) }),
    quote: async ({ draft }) => {
      const l = draft.lines[0];
      return l.selectedProductId === 'C'
        ? { issues: [{ code: 'UNIT_NOT_CONVERTIBLE', message: 'Ei tilattavissa: sipuli. Määrää ei voi muuntaa tämän tuotteen myyntiyksiköiksi', ref: l.ref, productId: 'C', reason: 'Määrää ei voi muuntaa tämän tuotteen myyntiyksiköiksi' }] }
        : { quoteId: 'q1', issues: [], expiresAt: new Date(NOW + 600_000).toISOString(), deliveryDate: draft.deliveryDate,
          lines: [{ ref: l.ref, productId: l.selectedProductId, name: 'Sipuli', salesUnits: 5, salesUnitLabel: 'kpl', covers: { value: 5, unit: 'PCS' }, lineNet: 4.3, vatRate: 13.5, stockKnown: true }],
          totals: { net: 4.3, vat: 0.58, gross: 4.88, currency: 'EUR' } };
    },
    submit: async () => { throw new Error('ei tilausta tässä testissä'); },
  };
  const store = openDraftStore(':memory:', () => NOW);
  const handleTurn = createOrderingConversation({ store, tools, now: () => NOW, interpretTurn: createRuleInterpreter({ understand }) });
  let n = 0;
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'conv', customer, text, receivedAt: NOW });

  const first = await say('5 kpl sipulia lauantaiksi');
  assert.match(first.text, /3\) Sipuli 10 kg säkki nl\/eg/u);
  const failed = await say('3');
  assert.match(failed.text, /^Sipuli 10 kg säkki nl\/eg ei käy: Määrää ei voi muuntaa tämän tuotteen myyntiyksiköiksi\. Jätin sen pois vaihtoehdoista\.\nTilausta ei ole tehty\./u);
  assert.doesNotMatch(failed.text, /Ei tilattavissa: sipuli/u);
  assert.doesNotMatch(failed.text, /\d\) Sipuli 10 kg säkki/u);
  assert.match(failed.text, /1\) Sipuli 1 kg pussi hollanti/u);
  assert.match(failed.text, /2\) Sipuli nippu suomi/u);
  const line = store.active('conv').lines[0];
  assert.deepEqual(line.failedOptions, { deliveryDate: '2026-11-21', quantity: line.quantity, ids: ['C'] });
  assert.equal(line.selectedProductId, null);
  assert.deepEqual(seenLines.at(-1).failedOptions?.ids, ['C']);

  const ok = await say('1');
  assert.equal(ok.status, 'ready');
  assert.match(ok.text, /Vahvista vastaamalla \*TILAA\*/u);
});

test('oikea katalogi: kappalemääräksi tallennettu sipuli menee tarjouksesta läpi, ja kaatunut tuote jää pois vaihtoehdoista', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const { seedBuyers } = await import('../server/gateway/mandate.mjs');
  seedBuyers();
  const { createOrderingTools } = await import('../server/order-tools/index.mjs');
  const tools = createOrderingTools();
  const draft = { id: 'd1', revision: 1, deliveryDate: '2026-11-21', diet: { claims: [], excludeAllergens: [] },
    lines: [{ ref: 'a', productTerm: 'sipuli', quantity: { value: 5, unit: 'PCS', basis: 'items' }, claims: [], excludeAllergens: [] }] };
  const s = await tools.suggest({ customer, draft });
  const options = s.lines[0].options;
  assert.ok(options.length >= 2, JSON.stringify(s.issues));
  // Ennen korjausta jokainen näistä kaatui tarjouksessa UNIT_NOT_CONVERTIBLE-virheeseen.
  for (const o of options) {
    draft.lines[0].selectedProductId = o.productId;
    const q = await tools.quote({ customer, draft });
    assert.deepEqual(q.issues, [], `${o.name}: ${JSON.stringify(q.issues)}`);
    assert.equal(q.lines[0].salesUnits, o.salesUnits);
  }
  draft.lines[0].selectedProductId = null;
  const first = options[0].productId;
  draft.lines[0].failedOptions = { deliveryDate: '2026-11-21', quantity: { ...draft.lines[0].quantity }, ids: [first] };
  const again = await tools.suggest({ customer, draft });
  assert.ok(again.lines[0].options.length, JSON.stringify(again.issues));
  assert.ok(again.lines[0].options.every((o) => o.productId !== first));
  // Toinen määrä tai päivä voi taas käydä: kaatuneen muisti ei koske sitä.
  draft.lines[0].quantity = { value: 6, unit: 'PCS', basis: 'items' };
  const other = await tools.suggest({ customer, draft });
  assert.ok(other.lines[0].options.some((o) => o.productId === first));
});
