// v2-agentin kirjoitusvirheiden oikoluku (server/agent/proofread.mjs). Eelis 19.11.: botti kirjoitti "minä keräären tilauksen".
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/sqlite.mjs';
import { createAgent } from '../server/agent/index.mjs';
import { applyFixes, createProofreader, PROOFREAD_SCHEMA } from '../server/agent/proofread.mjs';
import { FALLBACK } from '../server/agent/prompt.mjs';

const NOW = Date.parse('2026-11-19T15:06:00Z');
const TYPO = 'Moi! Olen Valio Aimon digitaalinen tilausapuri, ja minä keräären tilauksen valmiiksi koriin.';
const FIXED = 'Moi! Olen Valio Aimon digitaalinen tilausapuri, ja minä kerään tilauksen valmiiksi koriin.';

function fakeClient(steps) {
  const requests = []; let i = 0;
  return { requests, client: { beta: { messages: { async create(params, options) {
    requests.push({ params: structuredClone(params), options });
    const step = steps[i++];
    if (step instanceof Error) throw step;
    const value = typeof step === 'function' ? step(params) : step;
    return { id: `msg_${i}`, type: 'message', role: 'assistant', model: params.model,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...value };
  } } } } };
}
const fixes = (list) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ fixes: list }) }] });

test('applyFixes swaps only a misspelt word and keeps numbers, product names and links', () => {
  assert.deepEqual(applyFixes(TYPO, [{ wrong: 'keräären', right: 'kerään' }]), { text: FIXED, applied: [{ wrong: 'keräären', right: 'kerään' }] });
  const text = '6 kpl *Sipuli 1 kg pussi hollanti* (yhteensä 5,16 €). Avaa https://example.test/keräären ja kerro.';
  const products = [{ words: ['sipuli', 'pussi', 'hollanti'] }];
  const out = applyFixes(text, [
    { wrong: '5,16', right: '5,61' }, // numero: hylätään
    { wrong: 'hollanti', right: 'Hollanti' }, // tuotenimen sana: hylätään
    { wrong: 'kerro', right: 'kerma' }, // liian suuri muutos: hylätään
    { wrong: 'keräären', right: 'kerään' }, // vain linkissä: ei muutu
    { wrong: 'kpl', right: 'kpl' }, // sama: hylätään
  ], { products });
  assert.equal(out.text, text); assert.deepEqual(out.applied, []);
  // Vain kokonainen sana: "kerä" ei osu sanaan "keräären".
  assert.equal(applyFixes(TYPO, [{ wrong: 'kerä', right: 'kerää' }]).text, TYPO);
  // Puhekieli ja kaikki osumat: sana vaihtuu joka kohdassa, muu teksti pysyy.
  assert.equal(applyFixes('Kiitos tilauksetsa! Mä katon tilauksetsa vielä.', [{ wrong: 'tilauksetsa', right: 'tilauksesta' }]).text,
    'Kiitos tilauksesta! Mä katon tilauksesta vielä.');
  assert.equal(applyFixes(TYPO, 'ei lista').text, TYPO);
  // Pelkkä lisäys tai poisto saa 2 muutosta lyhyessäkin sanassa (livetesti 19.11.: "mä keräin tilauksen").
  assert.equal(applyFixes('ja mä keräin tilauksen', [{ wrong: 'keräin', right: 'keräisin' }]).text, 'ja mä keräisin tilauksen');
  assert.equal(applyFixes('ja mä keräin tilauksen', [{ wrong: 'keräin', right: 'kerään' }]).text, 'ja mä kerään tilauksen');
  // Kirjainten vaihto toiseen pysyy tiukkana: lyhyt sana ei vaihdu toiseksi sanaksi.
  assert.equal(applyFixes('kerro mitä', [{ wrong: 'kerro', right: 'kerma' }]).text, 'kerro mitä');
  // Lyhyt sana ei saa kahta lisäkirjainta: "on" → "onko" tekisi väitteestä kysymyksen.
  assert.equal(applyFixes('kori on valmis', [{ wrong: 'on', right: 'onko' }]).text, 'kori on valmis');
  assert.equal(applyFixes('voi 5 kg', [{ wrong: 'voi', right: 'voita' }]).text, 'voi 5 kg');
});

test('the proofreader asks for word pairs only and returns the text unchanged on any failure', async () => {
  const ok = fakeClient([fixes([{ wrong: 'keräären', right: 'kerään' }])]);
  const sonnet = createProofreader({ client: ok.client, model: 'claude-sonnet-5-5' });
  const out = await sonnet(TYPO, { timeoutMs: 5_000 });
  assert.equal(out.text, FIXED); assert.equal(out.applied.length, 1);
  const p = ok.requests[0].params;
  assert.deepEqual(p.thinking, { type: 'between_tools' });
  assert.deepEqual(p.output_config, { effort: 'low', format: { type: 'json_schema', schema: PROOFREAD_SCHEMA } });
  assert.equal(p.messages[0].content, TYPO);
  assert.equal(ok.requests[0].options.maxRetries, 0); assert.equal(ok.requests[0].options.timeout, 5_000);

  const haiku = fakeClient([fixes([])]);
  await createProofreader({ client: haiku.client, model: 'claude-haiku-5-5' })(TYPO);
  assert.deepEqual(haiku.requests[0].params.thinking, { type: 'disabled' });

  const events = [];
  const failing = createProofreader({ client: fakeClient([Object.assign(new Error('boom'), { status: 529 })]).client, onEvent: (e, f) => events.push({ e, ...f }) });
  assert.equal((await failing(TYPO)).text, TYPO);
  assert.deepEqual(events, [{ e: 'agent_proofread_failed', error: '529' }]);
  const garbage = createProofreader({ client: fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ei json' }] }]).client });
  assert.equal((await garbage(TYPO)).text, TYPO);
  // Liian vähän aikaa: ei kutsua.
  const idle = fakeClient([]);
  assert.equal((await createProofreader({ client: idle.client })(TYPO, { timeoutMs: 500 })).text, TYPO);
  assert.equal(idle.requests.length, 0);
});

function agentWith(steps, proofread) {
  const model = fakeClient(steps);
  const tools = { definitions: [], async run() { return { ok: true }; },
    async snapshot() { return { draftId: null, revision: 0, lines: [{ productId: 'P1', name: 'Sipuli 1 kg pussi hollanti' }], checklist: { ready: false } }; } };
  const events = [];
  const agent = createAgent({ tools, db: openSqlite(':memory:'), client: model.client, now: () => NOW, onEvent: (e, f) => events.push({ e, ...f }), proofread });
  const turn = (id, text) => agent.respond({ customer: { customerId: 'c', buyerId: 'b', bindingVersion: 'v', permissions: { readProducts: true } },
    conversationId: 'conv', messageId: id, incoming: [{ text, at: NOW }], channel: 'web' });
  return { turn, events, model };
}

test('the agent sends the proofread reply and counts the proofreading tokens', async () => {
  const proof = fakeClient([fixes([{ wrong: 'keräären', right: 'kerään' }])]);
  const seen = [];
  const reader = createProofreader({ client: proof.client });
  const { turn, events } = agentWith([{ stop_reason: 'end_turn', content: [{ type: 'text', text: TYPO }] }],
    async (text, options) => { seen.push(options.products); return reader(text, options); });
  const result = await turn('m1', 'Moi');
  assert.equal(result.text, FIXED); assert.deepEqual(result.messages, [FIXED]);
  assert.equal(result.agent.outcome, 'ok'); assert.equal(result.agent.proofread.fixes, 1);
  assert.equal(result.agent.usage.input, 200); assert.equal(result.agent.usage.output, 40);
  assert.ok(seen[0].some((p) => p.words.includes('hollanti')));
  const logged = events.find((e) => e.e === 'agent_turn');
  assert.equal(logged.proofreadFixes, 1); assert.equal(JSON.stringify(logged).includes('keräären'), false);
});

test('a refusal or fallback reply is not proofread, and no proofreader keeps the old behaviour', async () => {
  let called = 0;
  const count = async (text) => { called += 1; return { text, applied: [], usage: null, ms: 0 }; };
  const refused = agentWith([{ stop_reason: 'refusal', content: [] }], count);
  const r = await refused.turn('m1', 'Moi');
  assert.equal(r.text, FALLBACK.refusal); assert.equal(called, 0); assert.equal('proofread' in r.agent, false);
  const plain = agentWith([{ stop_reason: 'end_turn', content: [{ type: 'text', text: TYPO }] }], null);
  assert.equal((await plain.turn('m1', 'Moi')).text, TYPO);
});
