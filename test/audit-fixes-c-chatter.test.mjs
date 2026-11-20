// Katselmus 15.11. ilta #21: sääntötulkki teki jutustelusta tuoterivejä ("mihin mennessä pitää tilata?" -> "mirin pit tila",
// "onks tää halvin" -> "half"). Sanat tulevat oikean katalogin sanastosta, joten testi tarvitsee data/catalog.json-tiedoston.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-audit-c-chatter-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', AIMO_DB: path.join(dir, 'k.db'), GATEWAY_DB: path.join(dir, 'g.db') });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const skip = !fs.existsSync(CATALOG) && 'data/catalog.json puuttuu';

const NOW = Date.parse('2026-11-14T08:00:00Z'); // lauantai
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };

async function engine() {
  const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
  const { openDraftStore } = await import('../server/order-conversation/store.mjs');
  const { createRuleInterpreter } = await import('../server/order-conversation/interpret.mjs');
  const { understand } = await import('../server/aimo/understand.mjs');
  const calls = { submit: 0 };
  // Testityökalut: kaksi vaihtoehtoa riviä kohden ilman laktoositarkennusta, tarjous ja vahvistus aina onnistuvat.
  const tools = {
    async suggest({ draft }) { return { issues: [], lines: draft.lines.map((l) => ({ ref: l.ref, total: 2, clarify: [],
      options: [1, 2].map((i) => ({ productId: `${l.productTerm}-${i}`, name: `${l.productTerm} ${i}`, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 * i })) })) }; },
    async quote({ draft }) { return { quoteId: `Q-${draft.revision}`, draftId: draft.id, revision: draft.revision, expiresAt: new Date(NOW + 900_000).toISOString(), issues: [], totals: { net: 20 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 })) }; },
    async submit({ draft }) { calls.submit += 1; return { status: 'confirmed', orderId: 'AGW-1', deliveryDate: draft.deliveryDate, totals: { net: 20 }, reasons: [] }; },
  };
  const store = openDraftStore(':memory:', () => NOW);
  let n = 0;
  const handleTurn = createOrderingConversation({ store, tools, now: () => NOW, interpretTurn: createRuleInterpreter({ understand }) });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'conv', customer, text, receivedAt: NOW });
  const terms = () => store.active('conv').lines.map((l) => l.productTerm);
  return { say, calls, terms };
}

test('#21 jutustelu valmiissa yhteenvedossa ei lisää tuoterivejä, ja TILAA toimii sen jälkeen', { skip }, async () => {
  const { say, calls, terms } = await engine();
  await say('5 kg voita maanantaiksi');
  assert.equal((await say('1')).status, 'ready');
  const before = terms();
  for (const question of ['mihin mennessä pitää tilata?', 'milloin pitää viimeistään tilata?', 'onks tää halvin', 'mikä näistä on halvin?',
    'onko muita vaihtoehtoja?', 'listaa vaihtoehdot hintoineen']) {
    const reply = await say(question);
    assert.deepEqual(terms(), before, `${question}: ${terms().join(', ')}`);
    // Vaihtoehtojen näyttäminen tai vertailu avaa valinnan tarkoituksella (V025): valitaan sama uudelleen.
    if (reply.status === 'choosing') assert.equal((await say('1')).status, 'ready', question);
    else assert.equal(reply.status, 'ready', `${question}: ${reply.text}`);
  }
  const deadline = await say('mihin mennessä pitää tilata?');
  assert.equal(deadline.status, 'ready');
  assert.match(deadline.text, /Vahvista vastaamalla \*TILAA\*/);
  const confirmed = await say('TILAA');
  assert.equal(confirmed.status, 'confirmed'); assert.equal(calls.submit, 1);
});

test('#21 määrä samassa viestissä on tilausmuutos, vaikka mukana on kysymys', { skip }, async () => {
  const { say, terms } = await engine();
  await say('5 kg voita maanantaiksi');
  await say('mihin mennessä pitää tilata, ja 20 l maitoa');
  assert.deepEqual(terms().sort(), ['maito', 'voi']);
});
