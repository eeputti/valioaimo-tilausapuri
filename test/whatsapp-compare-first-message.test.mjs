// Haiku-mittauksen V023 (docs/parallel/haiku-quality-2026-11-16.md): tilaus ja vertailukysymys samassa ensimmäisessä viestissä
// ("30 l maitoa keskiviikoks. Mikä näistä toimitetaan varmimmin?"). Kun malli reititti viestin keskusteluksi, eikä luonnosta vielä
// ollut, malli vastasi itse "En pysty itse arvioimaan, mikä toimii varmimmin", vaikka katalogissa on toimitusvarmuus.
// Ei mallia eikä verkkoa: malli ja tilausmoottori korvataan kiinteillä vastauksilla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');

function setup(route) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE members (binding TEXT PRIMARY KEY); CREATE TABLE turns (binding TEXT)');
  const orders = [];
  const ask = async ({ purpose }) => (purpose === 'whatsapp_dialogue'
    ? { json: { route, text: 'En pysty itse arvioimaan, mikä toimii varmimmin.', lookupQuery: '', suggestionTerm: '', openCart: false } }
    : { json: { text: '', suggestionTerm: '', addQuestion: '' } });
  const d = createOrderingDialogue({ db, ask, timeOf: () => Date.parse('2026-11-15T12:00:00+02:00') });
  let n = 0;
  const turn = (text) => d.respond({ binding: 'b1', messageId: `m${++n}`, text, getShoppingList: () => null,
    runOrder: async (orderText) => { orders.push(orderText); return { status: 'choosing', text: 'Toimitusvarmuus: 1) 98 %, 2) 91 %. Paras: 1) maito 1.\n1) maito 1\n2) maito 2' }; } });
  return { turn, orders };
}

test('V023: tilaus ja toimitusvarmuuskysymys samassa ensimmäisessä viestissä menevät tilausmoottorille, ei mallin vastaukseksi', async () => {
  const text = '30 l maitoa keskiviikoks. Mikä näistä toimitetaan varmimmin? Ei saa jäädä tulematta.';
  const { turn, orders } = setup('chat');
  const r = await turn(text);
  assert.equal(orders.length, 1, 'tilausmoottoria ei kutsuttu');
  assert.doesNotMatch(r.text, /En pysty itse arvioimaan/);
  assert.match(r.text, /Toimitusvarmuus: 1\) 98 %/);
  // Sama hiilijalanjäljelle ja hinnalle.
  for (const q of ['20 l maitoa ke. Mikä vaihtoehdoista on ympäristöystävällisin, eli pienin hiilijalanjälki?', '5 kg voita perjantaiks, mikä tulee edullisimmaksi?']) {
    const s = setup('chat'); await s.turn(q);
    assert.equal(s.orders.length, 1, q);
  }
});

test('V023: pelkkä yleinen kysymys ilman tilausta saa yhä mallin vastauksen', async () => {
  const { turn, orders } = setup('chat');
  const r = await turn('Mikä on toimitusvarmuus yleensä?');
  assert.equal(orders.length, 0);
  assert.match(r.text, /En pysty itse arvioimaan/);
});

test('V023: tilausmoottori vastaa ensimmäisen viestin toimitusvarmuuskysymykseen näytetyistä vaihtoehdoista', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-compare-first-'));
  Object.assign(process.env, { AIMO_DB: path.join(dir, 'k.db'), GATEWAY_DB: path.join(dir, 'g.db'), VALIO_API_KEY: '', ANTHROPIC_API_KEY: '' });
  const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
  const { openDraftStore } = await import('../server/order-conversation/store.mjs');
  const t0 = Date.parse('2026-11-15T10:00:00+02:00');
  const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
  const data = [{ lineNet: 110.6, deliveryReliability: 0.91 }, { lineNet: 120, deliveryReliability: 0.98 }, { lineNet: 130, deliveryReliability: null }];
  const tools = {
    suggest: async ({ draft }) => { const l = draft.lines[0]; return { issues: [], lines: [{ ref: l.ref, total: 3, more: false, exact: true, clarify: [],
      options: data.map((x, i) => ({ productId: `m${i + 1}`, name: `maito ${i + 1}`, salesUnits: 3, salesUnitLabel: 'ltk', covers: l.quantity, labels: [], cutoff: null, ...x })) }] }; },
    quote: async () => ({ issues: [{ code: 'X', message: 'ei käytössä' }] }), submit: async () => ({ status: 'rejected', reasons: [] }),
  };
  const text = '30 l maitoa keskiviikoks. Mikä näistä toimitetaan varmimmin? Ei saa jäädä tulematta.';
  const order = { intent: 'order', deliveryDate: '2026-11-18', ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 30, unit: 'L' }, claims: [], excludeAllergens: [] }] };
  const handleTurn = createOrderingConversation({ store: openDraftStore(':memory:', () => t0), tools, now: () => t0, interpretTurn: async () => order });
  const r = await handleTurn({ messageId: 'm1', conversationId: 'c', customer, text, receivedAt: t0 });
  assert.equal(r.status, 'choosing');
  assert.match(r.text, /^Toimitusvarmuus: 1\) 91 %, 2\) 98 %, 3\) ei tietoa\. Paras: 2\) maito 2\./, r.text);
  fs.rmSync(dir, { recursive: true, force: true });
});
