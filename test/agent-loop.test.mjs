// Tilausapuri v2: agentin silmukka käsikirjoitetulla mallilla ilman verkkoa (docs/agent-v2.md, kohdat "Agenttisopimus",
// "Korilinkki" ja "Vartija"). Työkalut ovat väliaikainen olio sopimuksen mukaan (server/agent/tools.mjs tulee omasta haarastaan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../server/sqlite.mjs';
import { createAgent, agentSettings, TURN_LIMITS, splitMessages, echoContent, usesServerFallback, FALLBACK_BETA, BINDING_BETA } from '../server/agent/index.mjs';
import { brandClaims, checkReply, euroAmounts, findLinks, knownAmounts, productNames, repairReply } from '../server/agent/guard.mjs';
import { FALLBACK, FORCE_NOTE, TRUNCATED_NOTE, SYSTEM_PROMPT, TONES, calendarLine, contextText, helsinkiNow, toneFor } from '../server/agent/prompt.mjs';
import { openTranscript } from '../server/agent/transcript.mjs';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { DEMO_PERSON, agentCustomer, bootstrapDemoMember, createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { createCartLink } from '../server/whatsapp/cart-link.mjs';
import { linkButton } from '../server/whatsapp/channel.mjs';

const NOW = Date.parse('2026-11-19T06:38:00Z'); // to 19.11.2026 klo 8.38 Helsingissä
const PHONE = '358401234567';
const CUSTOMER = { customerId: 'demo-customer', buyerId: 'demo-buyer', bindingVersion: 'b1', companyName: 'Testikeittiö (demo)', personName: 'Testaaja',
  source: 'demo', permissions: { readProducts: true, placeOrders: true } };

// --- Käsikirjoitettu malli: palauttaa vastaukset järjestyksessä ja tallentaa pyynnöt. ---
const thinking = (signature) => ({ type: 'thinking', thinking: '', signature });
const text = (value) => ({ type: 'text', text: value });
const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const reply = (...content) => ({ stop_reason: 'end_turn', content });
const tools_ = (...content) => ({ stop_reason: 'tool_use', content });
function scripted(steps) {
  const requests = [];
  let index = 0;
  const client = { beta: { messages: { async create(params, options) {
    requests.push({ params: structuredClone(params), options });
    const step = steps[index++];
    if (!step) throw new Error(`Käsikirjoitus loppui kutsussa ${index}.`);
    if (step instanceof Error) throw step;
    const value = typeof step === 'function' ? step(params) : step;
    return { id: `msg_${index}`, type: 'message', role: 'assistant', model: params.model,
      usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...structuredClone(value) };
  } } } };
  return { client, requests, calls: () => index };
}

// --- Väliaikainen työkaluolio sopimuksen mukaan: muistissa oleva kori ja tarkistuslista. ---
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
function fakeTools({ ready = false } = {}) {
  const state = { draftId: 'WD-test-1', revision: 0, deliveryDate: null, diet: null, lines: [] };
  if (ready) Object.assign(state, { deliveryDate: '2026-11-21', diet: { none: true }, lines: [{ ref: 'r1', term: 'sipuli', productId: 'P1', packs: 1, lineNet: 11.18 }] });
  const calls = [];
  const checklist = () => {
    const products = state.lines.filter((l) => !l.productId).map((l) => l.term);
    const quantities = state.lines.filter((l) => !l.packs).map((l) => l.term);
    return { deliveryDate: { done: Boolean(state.deliveryDate), date: state.deliveryDate }, diet: { done: Boolean(state.diet), none: state.diet?.none === true },
      products: { done: state.lines.length > 0 && !products.length, missing: products }, quantities: { done: !quantities.length, missing: quantities },
      ready: Boolean(state.deliveryDate && state.diet && state.lines.length && !products.length && !quantities.length) };
  };
  const cart = () => ({ draftId: state.lines.length ? state.draftId : null, revision: state.revision, deliveryDate: state.deliveryDate,
    lines: state.lines.map((l) => ({ ref: l.ref, term: l.term, productId: l.productId || null, packs: l.packs || null, lineNet: l.lineNet ?? null })),
    totals: { net: Math.round(state.lines.reduce((s, l) => s + (l.lineNet || 0), 0) * 100) / 100 }, checklist: checklist() });
  const overrides = {};
  return {
    state, calls, overrides,
    definitions: [
      { name: 'set_delivery_date', description: 'Asettaa toimituspäivän.', input_schema: schema({ date: { type: 'string' } }, ['date']), strict: true },
      { name: 'set_diet', description: 'Asettaa allergiat ja ruokavaliot.', input_schema: schema({ none: { type: 'boolean' } }, ['none']), strict: true },
      { name: 'add_items', description: 'Kirjaa tarpeet.', input_schema: schema({ items: { type: 'array', items: schema({ term: { type: 'string' } }, ['term']) } }, ['items']), strict: true },
      { name: 'search_products', description: 'Hakee tuotteita.', input_schema: schema({ query: { type: 'string' } }, ['query']), strict: true },
      { name: 'update_item', description: 'Valitsee tuotteen ja määrän.', input_schema: schema({ ref: { type: 'string' }, productId: { type: 'string' }, packs: { type: 'number' } }, ['ref']), strict: true },
      { name: 'get_cart', description: 'Koko kori.', input_schema: schema(), strict: true },
      { name: 'send_cart_link', description: 'Korilinkki, kun kaikki on valmista.', input_schema: schema(), strict: true },
      { name: 'save_feedback', description: 'Tallentaa asiakkaan palautteen botista.', input_schema: schema({ text: { type: 'string' },
        kind: { type: 'string', enum: ['bug', 'idea', 'praise', 'other'] } }, ['text', 'kind']), strict: true },
    ],
    async run(name, input, ctx) {
      calls.push({ name, input, ctx });
      if (overrides[name]) return overrides[name](input, ctx);
      switch (name) {
        case 'set_delivery_date': state.deliveryDate = input.date; state.revision += 1; return { ok: true, date: input.date, checklist: checklist() };
        case 'set_diet': state.diet = { none: input.none === true }; state.revision += 1; return { ok: true, checklist: checklist() };
        case 'add_items':
          for (const item of input.items) if (!state.lines.some((l) => l.term === item.term)) state.lines.push({ ref: `r${state.lines.length + 1}`, term: item.term });
          state.revision += 1; return { ok: true, lines: state.lines.map((l) => ({ ref: l.ref, term: l.term })), checklist: checklist() };
        case 'search_products': return { options: [{ productId: 'P1', name: 'Sipuli 10 kg säkki', price: 11.18, content: { kg: 10 } },
          { productId: 'P2', name: 'Sipuli 1 kg pussi', price: 1.35, content: { kg: 1 } }], checklist: checklist() };
        case 'update_item': {
          const line = state.lines.find((l) => l.ref === input.ref);
          if (!line) return { error: 'UNKNOWN_REF', message: 'Riviä ei ole.' };
          Object.assign(line, { productId: input.productId, packs: input.packs, lineNet: Math.round(11.18 * input.packs * 100) / 100 });
          state.revision += 1; return { ok: true, packs: line.packs, lineNet: line.lineNet, checklist: checklist() };
        }
        case 'get_cart': return cart();
        case 'save_feedback': state.feedback = [...(state.feedback || []), input]; return { ok: true, saved: true, checklist: checklist() };
        case 'send_cart_link': return checklist().ready ? { ok: true, draftId: state.draftId, revision: state.revision, checklist: checklist() }
          : { ok: false, missing: Object.entries(checklist()).filter(([k, v]) => k !== 'ready' && !v.done).map(([k]) => k), checklist: checklist() };
        default: return { error: 'UNKNOWN' };
      }
    },
    snapshot() { return cart(); },
  };
}

function setup(steps, { tools = fakeTools(), db = openSqlite(':memory:'), ...options } = {}) {
  const model = scripted(steps);
  const events = [];
  const agent = createAgent({ tools, db, client: model.client, now: () => NOW, onEvent: (event, fields) => events.push({ event, ...fields }), ...options });
  const rows = (conversation = 'conv-1') => db.prepare('SELECT seq, turn, role, content FROM agent_transcript WHERE conversation=? ORDER BY seq').all(conversation).map((r) => ({ ...r }));
  return { agent, tools, db, model, events, rows };
}
const turn = (agent, messageId, message, extra = {}) => agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId,
  incoming: [{ text: message, at: NOW }], channel: 'whatsapp', cartLinkAvailable: true, ...extra });
const lastUser = (request) => request.params.messages.at(-1);
const blocks = (message) => message.content.filter((b) => b.type === 'text').map((b) => b.text);

test('one tool round: all results go back in one user message, assistant content is echoed unchanged and the reply splits on ---', async () => {
  const first = tools_(thinking('sig-a'), use('t1', 'add_items', { items: [{ term: 'sipuli' }] }), use('t2', 'set_delivery_date', { date: '2026-11-21' }));
  const { agent, tools, model } = setup([first,
    reply(thinking('sig-b'), text('Moikka! Mä oon Valio Aimon digitaalinen tilausapuri.\n---\nKirjasin sipulin ja lauantain 21.11. Onko allergioita?'))]);
  const result = await turn(agent, 'wamid.1', '50 sipulia lauantaiks');
  assert.deepEqual(result.messages, ['Moikka! Mä oon Valio Aimon digitaalinen tilausapuri.', 'Kirjasin sipulin ja lauantain 21.11. Onko allergioita?']);
  assert.equal(result.text, result.messages.join('\n\n'));
  assert.equal(result.status, 'collecting'); assert.equal(result.draftId, 'WD-test-1'); assert.equal(result.revision, 2);
  assert.equal(result.requestCartLink, false);
  assert.deepEqual(tools.calls.map((c) => c.name), ['add_items', 'set_delivery_date']);
  const ctx = tools.calls[0].ctx;
  assert.equal(ctx.conversationId, 'conv-1'); assert.equal(ctx.channel, 'whatsapp'); assert.equal(ctx.customer, CUSTOMER);
  assert.ok(ctx.now instanceof Date); assert.equal(ctx.now.getTime(), NOW);

  const [one, two] = model.requests;
  // Toinen kutsu: assistentin sisältö sellaisenaan (thinking-lohko allekirjoituksineen) ja tulokset yhdessä viestissä.
  assert.deepEqual(two.params.messages.at(-2), { role: 'assistant', content: first.content });
  assert.deepEqual(lastUser(two).content.map((b) => [b.type, b.tool_use_id, b.is_error]), [['tool_result', 't1', undefined], ['tool_result', 't2', undefined]]);
  assert.match(lastUser(two).content[1].content, /"date":"2026-11-21"/);
  assert.deepEqual(two.params.messages.slice(0, 1), one.params.messages);
  // Vuoron kontekstilohko ensin, asiakkaan viesti omana lohkonaan.
  const [context, customer] = blocks(one.params.messages[0]);
  assert.match(context, /^\[Vuoron tiedot järjestelmältä/);
  assert.match(context, /Nyt: torstai 19\.11\.2026 klo 8\.38 \(Europe\/Helsinki\)/);
  assert.match(context, /Kalenteri: 2026-11-19 to \(tänään\), 2026-11-20 pe \(huomenna\), 2026-11-21 la \(ylihuomenna\), 2026-11-22 su/);
  assert.match(context, /Asiakas: Testikeittiö \(demo\), yhteyshenkilö Testaaja/);
  assert.match(context, /Kanava: WhatsApp/); assert.match(context, /Korilinkki: voidaan lähettää/);
  assert.match(context, /Keskustelu alkaa/);
  assert.match(context, /Kori ja tarkistuslista: \{"draftId":null,"revision":0/);
  assert.equal(customer, 'Asiakkaan viesti (klo 8.38):\n50 sipulia lauantaiks');
});

test('requests: frozen system prompt and tools, adaptive thinking with drop_block, effort, fallbacks for Opus and Sonnet only, caching, no temperature', async () => {
  const opus = setup([reply(text('Moi!'))], { effort: 'medium' });
  await turn(opus.agent, 'm1', 'moi');
  const params = opus.model.requests[0].params;
  assert.equal(params.model, 'claude-sonnet-5-5');
  assert.deepEqual(params.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(params.output_config, { effort: 'medium' });
  assert.deepEqual(params.betas, [FALLBACK_BETA, BINDING_BETA]);
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.system, [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }]);
  assert.deepEqual(params.cache_control, { type: 'ephemeral', ttl: '1h' }); // keskustelun välimuisti kestää WhatsApp-tauon
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  assert.deepEqual(params.tools, opus.tools.definitions);
  for (const key of ['temperature', 'top_p', 'top_k']) assert.equal(key in params, false);
  assert.doesNotMatch(SYSTEM_PROMPT, /\d{4}-\d{2}-\d{2}|klo \d/); // ei muuttuvaa tietoa järjestelmäohjeessa

  const haiku = setup([reply(text('Moi!'))], { model: 'claude-haiku-5-5', effort: 'low' });
  await turn(haiku.agent, 'm1', 'moi');
  const h = haiku.model.requests[0].params;
  assert.equal('fallbacks' in h, false); assert.deepEqual(h.betas, [BINDING_BETA]); assert.deepEqual(h.output_config, { effort: 'low' });
  assert.equal(usesServerFallback('claude-sonnet-5-5'), true); assert.equal(usesServerFallback('claude-haiku-5-5'), false);
  assert.deepEqual(agentSettings({}), { enabled: false, model: 'claude-sonnet-5-5', effort: 'medium', proofread: true, proofreadModel: 'claude-sonnet-5-5', speed: 'standard' });
  assert.deepEqual(agentSettings({ WHATSAPP_AGENT: 'v2', WHATSAPP_AGENT_MODEL: 'claude-sonnet-5-5', WHATSAPP_AGENT_EFFORT: 'HIGH' }),
    { enabled: true, model: 'claude-sonnet-5-5', effort: 'high', proofread: true, proofreadModel: 'claude-sonnet-5-5', speed: 'standard' });
  assert.equal(agentSettings({ WHATSAPP_AGENT_SPEED: 'FAST' }).speed, 'fast');
  assert.equal(agentSettings({ WHATSAPP_AGENT_SPEED: 'turbo' }).speed, 'standard');
  assert.equal(agentSettings({ WHATSAPP_AGENT_PROOFREAD: 'false' }).proofread, false);
  assert.equal(agentSettings({ WHATSAPP_AGENT_EFFORT: 'turbo' }).effort, 'medium');
});

test('fast mode: speed "fast" on every call, a 429 or 529 falls back to standard speed at once, and a 400 turns it off', async () => {
  // Eelis 19.11.: "toi vastaus kestää kyl liian kauan". Aika kuluu tokenien tuottoon, ja nopea tila tuottaa samalla mallilla nopeammin.
  const ok = setup([reply(text('Moi!'))], { speed: 'fast' });
  await turn(ok.agent, 'm1', 'moi');
  assert.equal(ok.model.requests[0].params.speed, 'fast');
  assert.equal(ok.model.requests[0].options.maxRetries, 0);
  const standard = setup([reply(text('Moi!'))]);
  await turn(standard.agent, 'm1', 'moi');
  assert.equal('speed' in standard.model.requests[0].params, false, 'oletus on tavallinen nopeus');

  let t = 0; const naps = [];
  const busy = setup([() => { throw Object.assign(new Error('fast capacity'), { status: 429 }); }, reply(text('Moi!')), reply(text('Taas.'))],
    { speed: 'fast', clock: () => t, sleep: async (ms) => { naps.push(ms); } });
  assert.equal((await turn(busy.agent, 'm1', 'moi')).text, 'Moi!');
  assert.deepEqual(busy.model.requests.map((r) => r.params.speed ?? 'standard'), ['fast', 'standard']);
  assert.deepEqual(naps, [], 'ei odotusta: tavallinen nopeus heti');
  assert.ok(busy.events.some((e) => e.event === 'agent_fast_fallback' && e.status === 429));
  await turn(busy.agent, 'm2', 'moi taas'); // minuutin tauko: seuraava kutsu tavallisella nopeudella
  assert.equal(busy.model.requests.at(-1).params.speed ?? 'standard', 'standard');
  t += 61_000;
  const later = setup([reply(text('Moi!'))], { speed: 'fast', clock: () => t });
  await turn(later.agent, 'm1', 'moi');
  assert.equal(later.model.requests[0].params.speed, 'fast');

  const rejected = setup([() => { throw Object.assign(new Error('speed not supported'), { status: 400 }); }, reply(text('Moi!')), reply(text('Taas.'))], { speed: 'fast' });
  assert.equal((await turn(rejected.agent, 'm1', 'moi')).text, 'Moi!');
  assert.deepEqual(rejected.model.requests.map((r) => r.params.speed ?? 'standard'), ['fast', 'standard']);
  assert.ok('betas' in rejected.model.requests[1].params, 'sama täysi pyyntö ilman nopeaa tilaa, ei pelkistettyä');
  await turn(rejected.agent, 'm2', 'moi taas');
  assert.equal(rejected.model.requests.at(-1).params.speed ?? 'standard', 'standard', 'nopea tila pois tältä prosessilta');
});

test('a failing or unknown tool comes back with is_error and the loop continues', async () => {
  const tools = fakeTools();
  tools.overrides.get_cart = () => { throw new Error('kanta kiinni'); };
  const { agent, model, events } = setup([tools_(use('t1', 'update_item', { ref: 'r9', productId: 'P1', packs: 1 }), use('t2', 'get_cart'), use('t3', 'drop_table')),
    reply(text('Hups, en löytänyt riviä. Mitä tilataan?'))], { tools });
  const result = await turn(agent, 'm1', 'vaihda se');
  assert.equal(result.text, 'Hups, en löytänyt riviä. Mitä tilataan?');
  const results = lastUser(model.requests[1]).content;
  assert.deepEqual(results.map((b) => [b.tool_use_id, b.is_error]), [['t1', true], ['t2', true], ['t3', true]]);
  assert.deepEqual(results.map((b) => JSON.parse(b.content).error), ['UNKNOWN_REF', 'TOOL_FAILED', 'UNKNOWN_TOOL']);
  assert.deepEqual(tools.calls.map((c) => c.name), ['update_item', 'get_cart']); // tuntematonta työkalua ei ajeta
  assert.ok(events.some((e) => e.event === 'agent_tool_failed' && e.tool === 'get_cart'));
});

test('refusal: no tool runs, the customer gets a short reply and the refused turn stays out of the transcript', async () => {
  const { agent, tools, model, rows } = setup([{ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [use('t1', 'add_items', { items: [{ term: 'x' }] })] },
    reply(text('Moi taas!'))]);
  const result = await turn(agent, 'm1', 'jotain outoa');
  assert.equal(tools.calls.length, 0);
  assert.equal(result.text, FALLBACK.refusal); assert.equal(result.agent.outcome, 'refusal'); assert.equal(result.requestCartLink, false);
  assert.equal(rows().length, 0);
  // Seuraava vuoro alkaa puhtaalta pöydältä, ja sama viesti uudelleen palauttaa saman tuloksen ilman mallikutsua.
  await turn(agent, 'm2', 'moi');
  assert.equal(model.requests[1].params.messages.length, 1);
  assert.deepEqual(await turn(agent, 'm1', 'jotain outoa'), result);
  assert.equal(model.calls(), 2);
});

test('a refusal after a tool round drops the turn, keeps the cart and starts a fresh window, so a history cannot refuse forever', async () => {
  // Katselmointi 19.11.: tallennettu kieltäytynyt vuoro saattoi laukaista kieltäytymisen joka kerta 14 päivän ajan.
  const { agent, tools, model, rows } = setup([reply(text('Moi! Mitä tilataan?')), tools_(use('t1', 'add_items', { items: [{ term: 'kerma' }] })),
    { stop_reason: 'refusal', content: [] }, reply(text('Kerma on listalla. Montako litraa?'))]);
  await turn(agent, 'm1', 'moi');
  const kept = rows();
  const result = await turn(agent, 'm2', 'kermaa');
  assert.equal(result.text, FALLBACK.refusal); assert.equal(result.agent.outcome, 'refusal');
  assert.equal(tools.calls.length, 1); assert.deepEqual(tools.state.lines.map((l) => l.term), ['kerma']); // työ jää luonnokseen
  assert.deepEqual(rows(), kept); // kieltäytynyttä vuoroa ei tallennettu
  await turn(agent, 'm3', 'kymmenen litraa');
  const next = model.requests[3].params.messages;
  assert.equal(next.length, 1); // uusi ikkuna: ei historiaa, joka voisi kieltäytyä uudelleen
  const [context] = blocks(next[0]);
  assert.doesNotMatch(context, /Keskustelu alkaa|Sävy/); // sama keskustelu jatkuu ilman uutta esittelyä
  assert.match(context, /"term":"kerma"/); // tilannekuva kertoo korin uudelle ikkunalle
});

test('max_tokens: the cut tool call is not run and the model answers once more without tools', async () => {
  const { agent, tools, model } = setup([{ stop_reason: 'max_tokens', content: [thinking('sig-cut'), use('t1', 'add_items', { items: [{ term: 'x' }] })] },
    reply(text('Selvä! Mille päivälle toimitus?'))]);
  const result = await turn(agent, 'm1', 'tilaus');
  assert.equal(tools.calls.length, 0);
  assert.equal(result.text, 'Selvä! Mille päivälle toimitus?');
  const second = model.requests[1].params;
  assert.deepEqual(second.tool_choice, { type: 'none' });
  assert.equal(second.messages.length, 1); // katkennutta vastausta ei lähetetä takaisin
  assert.equal(blocks(second.messages[0]).at(-1), TRUNCATED_NOTE);

  const twice = setup([{ stop_reason: 'max_tokens', content: [] }, { stop_reason: 'max_tokens', content: [text('Kesk')] }]);
  const failed = await turn(twice.agent, 'm1', 'tilaus');
  assert.equal(failed.text, FALLBACK.failed); assert.equal(failed.agent.outcome, 'max_tokens');
});

test('the same message id returns the stored result without a model call, also from a new agent on the same database', async () => {
  const db = openSqlite(':memory:');
  const { agent, model } = setup([reply(text('Moikka! Mitä tilataan?'))], { db });
  const first = await turn(agent, 'wamid.same', 'moi');
  assert.deepEqual(await turn(agent, 'wamid.same', 'moi'), first);
  const again = setup([], { db });
  assert.deepEqual(await turn(again.agent, 'wamid.same', 'moi'), first);
  assert.equal(model.calls(), 1); assert.equal(again.model.calls(), 0);
  // Sama tulos myös turn_results-taulussa, josta agentin jälki ja korisivun tarkistus lukevat.
  assert.equal(JSON.parse(db.prepare('SELECT json FROM turn_results WHERE message_id=?').get('wamid.same').json).text, first.text);
});

test('the transcript is append-only, survives a restart and is replayed byte for byte', async () => {
  const db = openSqlite(':memory:');
  const a = setup([tools_(thinking('sig-1'), use('t1', 'add_items', { items: [{ term: 'kerma' }] })), reply(thinking('sig-2'), text('Kerma kirjattu. Montako litraa?')),
    reply(thinking('sig-3'), text('Selvä, 10 litraa.'))], { db });
  await turn(a.agent, 'm1', 'kermaa');
  await turn(a.agent, 'm2', '10 litraa');
  const before = a.rows();
  assert.deepEqual(before.map((r) => [r.turn, r.role]), [['m1', 'user'], ['m1', 'assistant'], ['m1', 'user'], ['m1', 'assistant'], ['m2', 'user'], ['m2', 'assistant']]);
  assert.deepEqual(JSON.parse(before[1].content), [thinking('sig-1'), use('t1', 'add_items', { items: [{ term: 'kerma' }] })]);

  const b = setup([reply(thinking('sig-4'), text('Laitetaanko vielä jotain?'))], { db });
  await turn(b.agent, 'm3', 'kiitos');
  const after = b.rows();
  assert.deepEqual(after.slice(0, before.length), before); // vanhat rivit ennallaan
  assert.ok(after.slice(before.length).every((r) => r.turn === 'm3' && r.seq > before.at(-1).seq));
  const replayed = b.model.requests[0].params.messages;
  assert.deepEqual(replayed.slice(0, before.length), before.map((r) => ({ role: r.role, content: JSON.parse(r.content) })));
  assert.doesNotMatch(blocks(replayed.at(-1))[0], /Keskustelu alkaa/);
  // Tallennetussa transkriptissa ei ole välimuistimerkintöjä: ne ovat vain pyynnön ylätasolla ja järjestelmäohjeessa.
  assert.doesNotMatch(JSON.stringify(after.map((r) => r.content)), /cache_control/);
});

test('the guard gives one correction round for an unknown euro amount and a link', async () => {
  const { agent, model } = setup([tools_(use('t1', 'search_products', { query: 'sipuli' })),
    reply(text('10 kg säkki maksaa 11,18 € ja koko tilaus noin 99,99 €. Katso lisää https://valio.fi/tuotteet')),
    reply(text('10 kg säkki maksaa 11,18 €. Laitanko sen?'))]);
  const result = await turn(agent, 'm1', 'paljonko sipuli maksaa?');
  assert.equal(result.text, '10 kg säkki maksaa 11,18 €. Laitanko sen?');
  assert.deepEqual(result.agent.guard, [{ empty: false, amounts: ['99,99 €'], links: 1, brands: [] }]);
  const note = blocks(lastUser(model.requests[2])).at(-1);
  assert.match(note, /^\[Järjestelmä\] Vastaustasi ei lähetetty/);
  assert.match(note, /99,99 €/); assert.match(note, /linkki/);
  assert.deepEqual(model.requests[2].params.tool_choice, { type: 'auto' }); // korjauskierroksella saa hakea korin
});

test('after the single correction round the guard removes links and replaces unverified amounts', async () => {
  const { agent, rows } = setup([reply(text('Kori on noin 45 €. Lisätietoa: www.valio.fi')), reply(text('Kori on noin 45 €. Katso valioaimo.fi'))]);
  const result = await turn(agent, 'm1', 'paljonko?');
  assert.equal(result.agent.outcome, 'repaired');
  assert.equal(result.text, 'Kori on noin (hinta näkyy korissa). Katso');
  assert.match(JSON.parse(rows().at(-1).content).at(-1).text, /Asiakkaalle lähetettiin: «Kori on noin \(hinta näkyy korissa\)/);
});

test('amounts from the cart, this turn\'s tools and the customer\'s own message pass the guard', async () => {
  const tools = fakeTools({ ready: true });
  const { agent } = setup([tools_(use('t1', 'get_cart')), reply(text('Korissa sipulit 11,18 €, yhteensä 11,18 €. Budjettisi 200 € riittää hyvin.'))], { tools });
  const result = await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'm1', channel: 'web',
    incoming: [{ text: 'budjetti on 200 €', at: NOW }], cartLinkAvailable: true });
  assert.equal(result.agent.outcome, 'ok'); assert.deepEqual(result.agent.guard, []);
  assert.equal(result.status, 'ready');
});

test('a discarded reply becomes a note in the new turn and messages already seen are not repeated', async () => {
  const { agent, model, rows } = setup([reply(text('Montako kiloa sipulia?')), reply(text('Selvä: sipulit ja kerma. Mille päivälle?'))]);
  await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'job-7', incoming: [{ text: '50 sipulia', at: NOW }], cartLinkAvailable: true });
  const result = await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'job-7:r1', discardedReply: 'Montako kiloa sipulia?', cartLinkAvailable: true,
    incoming: [{ text: '50 sipulia', at: NOW }, { text: 'ja 10 l kermaa', at: NOW + 6000 }] });
  assert.equal(result.text, 'Selvä: sipulit ja kerma. Mille päivälle?');
  const content = blocks(lastUser(model.requests[1]));
  assert.equal(content.length, 3);
  assert.match(content[1], /^\[Järjestelmä\] Edellistä vastaustasi ei lähetetty, koska asiakas kirjoitti lisää/);
  assert.match(content[1], /«Montako kiloa sipulia\?»/);
  assert.equal(content[2], 'Asiakkaan viesti (klo 8.38):\nja 10 l kermaa');
  // Hylätty vastaus pysyy transkriptissa sellaisenaan: sitä ei muokata jälkikäteen.
  assert.deepEqual(rows().map((r) => [r.turn, r.role]), [['job-7', 'user'], ['job-7', 'assistant'], ['job-7:r1', 'user'], ['job-7:r1', 'assistant']]);
  assert.equal(JSON.parse(rows()[1].content)[0].text, 'Montako kiloa sipulia?');
});

test('a retry after a refused first round still shows the customer every message, because the model never saw them', async () => {
  const { agent, model } = setup([{ stop_reason: 'refusal', content: [] }, reply(text('Selvä, sipulit ja kerma.'))]);
  await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'job-8', incoming: [{ text: '50 sipulia', at: NOW, round: 0 }] });
  await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'job-8:r1', discardedReply: FALLBACK.refusal,
    incoming: [{ text: '50 sipulia', at: NOW, round: 0 }, { text: 'ja kermaa', at: NOW + 4000, round: 1 }] });
  assert.deepEqual(blocks(lastUser(model.requests[1])).slice(2), ['Asiakkaan viesti (klo 8.38):\n50 sipulia', 'Asiakkaan viesti (klo 8.38):\nja kermaa']);
});

test('the cart link is requested only after a successful send_cart_link with no later cart change', async () => {
  const ok = setup([tools_(use('t1', 'send_cart_link')), reply(text('Kaikki valmiina! Tästä pääset tarkistamaan korin:'))], { tools: fakeTools({ ready: true }) });
  const sent = await turn(ok.agent, 'm1', 'ok');
  assert.equal(sent.requestCartLink, true); assert.equal(sent.status, 'ready');

  const missing = setup([tools_(use('t1', 'send_cart_link')), reply(text('Vielä puuttuu toimituspäivä. Mille päivälle?'))]);
  assert.equal((await turn(missing.agent, 'm1', 'laita linkki')).requestCartLink, false);

  const wordsOnly = setup([reply(text('Tässä linkki koriin!'))], { tools: fakeTools({ ready: true }) });
  assert.equal((await turn(wordsOnly.agent, 'm1', 'ok')).requestCartLink, false);

  const changed = setup([tools_(use('t1', 'send_cart_link')), tools_(use('t2', 'update_item', { ref: 'r1', productId: 'P1', packs: 2 })),
    reply(text('Vaihdoin kahteen säkkiin.'))], { tools: fakeTools({ ready: true }) });
  assert.equal((await turn(changed.agent, 'm1', 'ok ja sittenkin kaksi säkkiä')).requestCartLink, false);

  const tools = fakeTools({ ready: true });
  const offline = setup([tools_(use('t1', 'send_cart_link')), reply(text('Kori on tallessa.'))], { tools });
  const result = await turn(offline.agent, 'm1', 'ok', { cartLinkAvailable: false });
  assert.equal(result.requestCartLink, false); assert.equal(tools.calls.length, 0);
  const outcome = lastUser(offline.model.requests[1]).content[0];
  assert.equal(outcome.is_error, true); assert.equal(JSON.parse(outcome.content).error, 'CART_LINK_UNAVAILABLE');
});

test('feedback about the bot is saved with save_feedback and does not cancel a cart link of the same turn', async () => {
  assert.match(SYSTEM_PROMPT, /tallenna palaute save_feedback-työkalulla ja hoida varsinainen asia nyt\. Älä lupaa muutoksia tulevaisuuteen/);
  const tools = fakeTools({ ready: true });
  const { agent } = setup([tools_(use('t1', 'save_feedback', { text: 'vastaat jokaiseen viestiin erikseen', kind: 'bug' }), use('t2', 'send_cart_link')),
    reply(text('Kiitos palautteesta, kirjasin sen! Tässä koko tilaus yhdellä kertaa:'))], { tools });
  const result = await turn(agent, 'm1', 'vastaat jokaiseen viestiin erikseen, laita nyt se linkki');
  assert.deepEqual(tools.state.feedback, [{ text: 'vastaat jokaiseen viestiin erikseen', kind: 'bug' }]);
  assert.equal(result.requestCartLink, true);
});

test('read_link gets only the links the customer sent, never links from tool results', async () => {
  const { agent, tools } = setup([reply(text('Katsotaan resepti.')),
    tools_(use('t1', 'search_products', { query: 'kerma' })), reply(text('Löysin kerman.')),
    tools_(use('t2', 'get_cart')), reply(text('Tässä kori.'))]);
  tools.overrides.search_products = () => ({ options: [], note: 'Lisätietoa https://evil.example/ohje' });
  await turn(agent, 'm1', 'katso tää https://resepti.example/kakku.');
  await turn(agent, 'm2', 'ja www.toinen.example/x');
  await turn(agent, 'm3', 'näytä kori'); // työkalun tuloksen linkki on nyt ikkunassa, mutta ei asiakkaan viestissä
  for (const call of tools.calls) assert.deepEqual(call.ctx.links, ['https://resepti.example/kakku', 'https://www.toinen.example/x']);
  assert.equal(tools.calls.length, 2);
});

test('the tool round limit and the time budget end with one answer without tools', async () => {
  const steps = [...Array.from({ length: 8 }, (_, i) => tools_(use(`t${i}`, 'get_cart'))), reply(text('Kori on tallessa. Mitä lisätään?'))];
  const { agent, model } = setup(steps);
  const result = await turn(agent, 'm1', 'näytä kori');
  assert.equal(result.agent.rounds, 8); assert.equal(model.calls(), 9);
  assert.deepEqual(model.requests[8].params.tool_choice, { type: 'none' });
  assert.equal(blocks(lastUser(model.requests[8])).at(-1), FORCE_NOTE);
  assert.ok(model.requests.slice(0, 8).every((r) => r.params.tool_choice.type === 'auto'));

  let elapsed = 0;
  const slow = setup([(params) => { elapsed += 50_000; return tools_(use('t1', 'get_cart')); }, reply(text('Tässä tilanne.'))], { clock: () => elapsed });
  const late = await turn(slow.agent, 'm1', 'näytä kori');
  assert.equal(late.text, 'Tässä tilanne.');
  assert.deepEqual(slow.model.requests[1].params.tool_choice, { type: 'none' });
  assert.equal(slow.model.requests[0].options.timeout, 45_000); assert.equal(slow.model.requests[1].options.timeout, 10_000); // vain jäljellä oleva aika
  assert.ok(slow.model.requests.every((r) => r.options.maxRetries === 0));
});

test('the window is trimmed only from the start, at a customer turn, and the start then stays put', async () => {
  const steps = Array.from({ length: 6 }, (_, i) => reply(text(`Vastaus ${i + 1}.`)));
  const { agent, model, db } = setup(steps, { window: { maxTurns: 3 } });
  for (let i = 1; i <= 6; i += 1) await turn(agent, `m${i}`, `viesti ${i}`);
  const firstCustomer = (request) => blocks(request.params.messages[0]).at(-1);
  assert.equal(firstCustomer(model.requests[3]), 'Asiakkaan viesti (klo 8.38):\nviesti 1'); // 3 vuoroa: ei lyhennystä
  assert.equal(firstCustomer(model.requests[4]), 'Asiakkaan viesti (klo 8.38):\nviesti 3'); // 4 vuoroa > 3: vanhin puolisko pois
  assert.equal(firstCustomer(model.requests[5]), 'Asiakkaan viesti (klo 8.38):\nviesti 3'); // alku pysyy: välimuisti osuu
  assert.ok(model.requests.every((r) => r.params.messages[0].role === 'user'));
  assert.equal(db.prepare("SELECT count(*) n FROM agent_transcript WHERE conversation='conv-1'").get().n, 12); // mitään ei poistettu

  // Edellisen kutsun syötteen koko käynnistää saman lyhennyksen.
  const large = (value) => ({ ...reply(text(value)), usage: { input_tokens: 90_000, output_tokens: 10 } });
  const big = setup([large('Yksi.'), large('Kaksi.'), reply(text('Kolme.'))], { window: { maxInputTokens: 50_000 } });
  await turn(big.agent, 'm1', 'eka'); await turn(big.agent, 'm2', 'toka'); await turn(big.agent, 'm3', 'kolmas');
  assert.equal(blocks(big.model.requests[2].params.messages[0]).at(-1), 'Asiakkaan viesti (klo 8.38):\ntoka');
});

test('a 400 on the beta request retries once without beta features and remembers it; a broken history is skipped once', async () => {
  const badRequest = () => Object.assign(new Error('bad request'), { status: 400 });
  const { agent, model, events } = setup([badRequest(), reply(text('Moi!')), reply(text('Moi taas!'))]);
  await turn(agent, 'm1', 'moi'); await turn(agent, 'm2', 'moi');
  assert.equal('betas' in model.requests[1].params, false); assert.equal('fallbacks' in model.requests[1].params, false);
  assert.deepEqual(model.requests[1].params.thinking, { type: 'adaptive' });
  assert.equal('betas' in model.requests[2].params, false);
  assert.ok(events.some((e) => e.event === 'agent_plain_requests'));

  const db = openSqlite(':memory:');
  const first = setup([reply(text('Moi!'))], { db });
  await turn(first.agent, 'm1', 'moi');
  const broken = setup([badRequest(), badRequest(), reply(text('Jatketaan!')), reply(text('Ja taas.'))], { db });
  const result = await turn(broken.agent, 'm2', 'moi');
  assert.equal(result.text, 'Jatketaan!');
  assert.equal(broken.model.requests[2].params.messages.length, 1);
  await turn(broken.agent, 'm3', 'moi');
  assert.deepEqual(broken.model.requests[3].params.messages.map((m) => m.role), ['user', 'assistant', 'user']); // alku siirtyi
  assert.ok(broken.events.some((e) => e.event === 'agent_history_reset'));
});

test('echoContent drops only the declined partial before a fallback block; splitMessages keeps at most three parts', () => {
  const plainContent = [thinking('s'), text('Moi'), use('t1', 'get_cart')];
  assert.equal(echoContent(plainContent), plainContent);
  const fallback = { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } };
  assert.deepEqual(echoContent([thinking('s1'), text('Mo'), use('t0', 'get_cart'), fallback, thinking('s2'), use('t1', 'get_cart')]),
    [text('Mo'), fallback, thinking('s2'), use('t1', 'get_cart')]);
  assert.deepEqual(splitMessages('Yksi\n---\nKaksi\n  ---  \nKolme\n---\nNeljä'), ['Yksi', 'Kaksi', 'Kolme\n\nNeljä']);
  assert.deepEqual(splitMessages('- maito 10 l\n- voi 5 kg'), ['- maito 10 l\n- voi 5 kg']);
  assert.deepEqual(splitMessages('\n---\n'), []);
});

test('guard: euro amounts, money fields, links and the ±0,01 € tolerance', () => {
  assert.deepEqual(euroAmounts('Säkki 11,18 €, pussi 1,35€, yhteensä 1 234,50 € ja noin 10–12 €. Myös 3 euroa ja €4.20.').map((a) => a.value),
    [11.18, 1.35, 1234.5, 10, 12, 3, 4.2]);
  assert.deepEqual(euroAmounts('Toimitus 21.11. klo 8.30, 50 hengelle 10 kg, alv 0 %, 12,50 € 3 kg:n säkki').map((a) => a.value), [12.5]);
  // Kenttien nimet kuten server/agent/tools.mjs:n tuloksissa: total on määrä ja vatRate verokanta, eivät euroja.
  const known = knownAmounts([{ lines: [{ productId: 123, packs: 3, netWeight: 10, total: { value: 30, unit: 'kg' }, vatRate: 14, excess: 0.5,
    unitPriceNet: 11.18, lineNet: 33.54, pricePer: { value: 1.12, unit: 'kg' } }], totals: { net: 33.54, vat: 4.7, gross: 38.24 }, comparisonPrice: 2.2,
  message: 'Hinta 2,49 €/kg' }], ['budjetti 200 €']);
  for (const value of [33.54, 11.18, 1.12, 4.7, 38.24, 2.2, 2.49, 200]) assert.ok(known.includes(value), String(value));
  for (const value of [123, 3, 10, 30, 14, 0.5]) assert.ok(!known.includes(value), String(value));
  assert.equal(checkReply('Yhteensä 33,55 €', { known }).ok, true);
  assert.equal(checkReply('Yhteensä 33,56 €', { known }).ok, false);
  assert.deepEqual(findLinks('Katso https://x.example/a, www.valio.fi, valioaimo.fi/kori tai info@valio.fi.'),
    ['https://x.example/a', 'www.valio.fi', 'info@valio.fi', 'valioaimo.fi/kori']);
  assert.deepEqual(findLinks('Kiitos.Tänään esim. 5 kg, klo 8.30 ja mukaan.Se on 1.5 l.'), []);
  assert.equal(checkReply('   ').empty, true);
  assert.equal(repairReply('Hinta 45 € tai 40–50 €. Lue www.x.fi', { unknownAmounts: [{ value: 45 }, { value: 40 }], links: ['www.x.fi'] }),
    'Hinta (hinta näkyy korissa) tai (hinta näkyy korissa). Lue');
});

test('guard: Valio is not attached to another producer\'s product, and real Valio products and the service name pass', () => {
  // Arviointi 19.11. (Haiku 5.5): "Valio-kiinteää perunaa", vaikka tuote 471033 on Pietilän Perunan eikä katalogissa ole merkkiä.
  const products = productNames([{ options: [{ productId: '471033', name: 'PP KIINTEÄ PERUNA 2KG PUSSI PESTY', brand: null },
    { productId: '460351', name: 'SIPULI 1KG PUSSI HOLLANTI', brand: null }, { productId: '9001', name: 'Arla Lempi ruokakerma 15 % 1 l', brand: 'Arla' }] },
  { lines: [{ ref: 'L3', productId: '464249', product: 'Valio ruokakerma 15 % 1 l UHT laktoositon' }] },
  { product: { productId: '475797', name: 'Valio voi 500 g normaalisuolainen', brand: 'Valio' } }]);
  const claims = (text, customerTexts = []) => brandClaims(text, { products, customerTexts }).map((c) => c.raw);
  assert.deepEqual(claims('Laitoin koriin 25 kpl Valio-kiinteää perunaa 2 kg pusseissa.'), ['Valio-kiinteää']);
  assert.deepEqual(claims('Valion kiinteä peruna sopii kermaperunoihin.'), ['Valion']);
  assert.deepEqual(claims('- Valio sipuli 1 kg pussi, 6 kpl'), ['Valio']);
  for (const fine of ['Mä oon Valio Aimon digitaalinen tilausapuri.', 'Tilaus menee Valio Aimon kautta.', 'Valion ruokakerma 15 % on laktoositonta.',
    'Voiksi laitoin Valio voi 500 g normaalisuolainen.', '- Ruokakerma: Valio 15 % 1 l, 4 kpl', 'Valion valikoimasta löytyi kiinteä peruna 2 kg pussissa.',
    'Hinnat ovat Valion hintoja ilman alv:tä.', 'Tämä on demo: oikeaa Valio-tilausta ei lähetetä.', 'Valion kiinteää perunaa ei ole tälle päivälle.',
    'Valio voi ja Arla Lempi ruokakerma ovat korissa.', 'Kiinteä peruna on Pietilän Perunan, ei Valion.']) assert.deepEqual(claims(fine), [], fine);
  assert.deepEqual(claims('Valion kiinteää perunaa löytyy?', ['Onko teillä Valion perunaa?']), []); // asiakas puhui Valiosta itse
  assert.deepEqual(brandClaims('Valio-kiinteää perunaa', { products: [] }), []); // ei vertailukohtaa: ei väitettä
  const check = checkReply('Selvä!\n- Valio-kiinteää perunaa 25 pussia', { products });
  assert.equal(check.ok, false); assert.deepEqual(check.brands.map((b) => b.raw), ['Valio-kiinteää']);
  assert.equal(repairReply('Selvä!\n- Valio-kiinteää perunaa 25 pussia', check), 'Selvä!\n- Kiinteää perunaa 25 pussia');
  assert.equal(repairReply('Laitoin Valion kiinteää perunaa.', checkReply('Laitoin Valion kiinteää perunaa.', { products })), 'Laitoin kiinteää perunaa.');
});

test('a reply that names another producer\'s product as Valio gets one correction round, and Valio is removed if it stays', async () => {
  const tools = fakeTools();
  tools.overrides.search_products = () => ({ options: [{ productId: '471033', name: 'PP KIINTEÄ PERUNA 2KG PUSSI PESTY', brand: null, pricePerPack: 3.1 }] });
  const fixed = setup([tools_(use('t1', 'search_products', { query: 'peruna' })), reply(text('Löysin Valio-kiinteää perunaa 2 kg pusseissa.')),
    reply(text('Löysin kiinteää perunaa 2 kg pusseissa (PP).'))], { tools });
  const result = await turn(fixed.agent, 'm1', 'kiinteää perunaa');
  assert.equal(result.text, 'Löysin kiinteää perunaa 2 kg pusseissa (PP).');
  assert.deepEqual(result.agent.guard[0].brands, ['Valio-kiinteää']);
  assert.match(blocks(lastUser(fixed.model.requests[2])).at(-1), /Liitit Valion tuotteeseen, jota työkalujen tulokset eivät nimeä Valion tuotteeksi \(«Valio-kiinteää»\)/);

  const again = fakeTools(); again.overrides.search_products = tools.overrides.search_products;
  const stubborn = setup([tools_(use('t1', 'search_products', { query: 'peruna' })), reply(text('Löysin Valio-kiinteää perunaa.')),
    reply(text('Löysin Valio-kiinteää perunaa.'))], { tools: again });
  const repaired = await turn(stubborn.agent, 'm1', 'kiinteää perunaa');
  assert.equal(repaired.agent.outcome, 'repaired'); assert.equal(repaired.text, 'Löysin kiinteää perunaa.');
});

test('a conversation starts with a tone in its context that stays in the transcript; later turns carry none', async () => {
  // Arviointi 19.11.: kaikkien v2-mallien avaukset olivat lähes samat. Vaihtelu tulee syötteestä, ei pohjista.
  const { agent, model, rows } = setup([reply(text('Huomenta!')), reply(text('Selvä.'))]);
  await turn(agent, 'wamid.first', 'moi');
  await turn(agent, 'wamid.second', 'tarviin maitoa');
  const [first] = blocks(model.requests[0].params.messages[0]);
  const tone = toneFor('conv-1:wamid.first');
  assert.ok(TONES.includes(tone));
  assert.match(first, new RegExp(`\\nSävy tähän keskusteluun: ${tone}, asiakkaan oman tyylin sisällä\\. Kirjoita sillä sävyllä omin sanoin, älä mainitse sävyä\\.\\n`));
  assert.doesNotMatch(blocks(model.requests[1].params.messages.at(-1))[0], /Sävy/);
  assert.match(JSON.parse(rows()[0].content)[0].text, /Sävy tähän keskusteluun/); // pysyy keskustelun historiassa
  assert.equal(toneFor('conv-1:wamid.first'), tone); // uusittu vuoro saa saman sävyn
  assert.deepEqual(new Set(Array.from({ length: 200 }, (_, i) => toneFor(`c:${i}`))), new Set(TONES));
  assert.match(SYSTEM_PROMPT, /Kun keskustelu alkaa, esittäydy Valio Aimon digitaalisena tilausapurina omin sanoin\./);
  assert.match(SYSTEM_PROMPT, /Vuoron tiedoissa on keskustelun sävy ja kellonaika, joten avaus voi vaihdella\./);
});

test('the prompt keeps the data-limit reason light and single, admits only real mistakes and keeps replies short', () => {
  // Arviointi 19.11.: Sonnet toisti "Valion hintarajapinta ei vastannut" 9 keskustelussa 16:sta, Opus myönsi virheen, jota ei
  // tapahtunut (niputus oli yhdistänyt viestit), ja vastaukset olivat keskimäärin 310–400 merkkiä.
  assert.match(SYSTEM_PROMPT, /Kun tuotteelle ei ole hintaa tai saatavuutta, koska tietojasi on supistettu, kerro se kerran kevyesti ilman teknisiä sanoja\./);
  assert.match(SYSTEM_PROMPT, /myönnä oikea virhe lyhyesti ja korjaa se heti\. Jos havainto ei pidä paikkaansa, sano se ystävällisesti\./);
  assert.match(SYSTEM_PROMPT, /Kirjoita kuin hyvä myyjä kirjoittaisi WhatsAppiin: lyhyesti, selkeästi ja asiakkaan omaan tyyliin\./);
  // Ohje kuvaa tavoitteen eikä lukumäärärajaa: sanamäärä- ja virkerajat jäykistivät vastauksia (uudelleenkirjoitus 19.11.).
  assert.doesNotMatch(SYSTEM_PROMPT, /\d+–\d+ lyhyellä virkkeellä|2–4 lyhyttä virkettä/);
});

test('the prompt infers the product from its use, offers to swap or show options, and picks a regular product unless a diet needs one', () => {
  // Eelis 19.11.: ehdottelun sijaan apurin pitää aavistaa, millaista perunaa mihinkin tarvitaan. Periaate ja muutama esimerkki
  // ohjeessa, ei esimerkkilistaa koodissa: malli käyttää omaa ruokaosaamistaan.
  assert.match(SYSTEM_PROMPT, /Päättele käytöstä sopivin tuote ja valitse se, esimerkiksi keittoon kiinteä peruna tai kakkuun vispikerma\./);
  assert.match(SYSTEM_PROMPT, /Kerro valinta ja peruste lyhyesti, jotta asiakas voi vaihtaa sen\./);
  assert.match(SYSTEM_PROMPT, /Vaihtoehtoja tarvitaan heti vain, kun valinta riippuu asiakkaan omasta mieltymyksestä, jota et tiedä\./);
  // Eelis 19.11. illalla: "eka ehottaa sopivinta tuotetta, mut sitte niit voi kans vaihtaa … tai kattoo muit vaihtoehtoi".
  assert.match(SYSTEM_PROMPT, /Kun valitset tuotteita, kerro samalla, että minkä tahansa niistä voi vaihtaa ja että voit näyttää muita vaihtoehtoja/);
  assert.match(SYSTEM_PROMPT, /Siitä riittää maininta silloin, kun tuotteet valitaan, ei joka viestissä\./);
  // Sama viesti: "varmistaa ettei tuote oo laktoositon tai gluteeniton". WhatsApp-testissä allergiattomalle valittiin
  // laktoositon UHT-maito, joka on haun suosituin ja kalliimpi kuin tavallinen kevytmaito.
  assert.match(SYSTEM_PROMPT, /Valitse tavallinen tuote, ellei asiakas ole kertonut tarvitsevansa laktoositonta, gluteenitonta tai muuta erityistuotetta\./);
  assert.match(SYSTEM_PROMPT, /koska haun ensimmäinen tai suosituin tuote voi olla erityistuote\./);
  assert.doesNotMatch(SYSTEM_PROMPT, /näytä 2–3 vaihtoehtoa/);
});

test('add_items brings the options when the date is known, so a separate search is only for more options', () => {
  // Eelis 19.11. klo 19.36: "toi vastaus kestää kyl liian kauan". Monen tuotteen viestissä oli viisi mallikierrosta.
  assert.match(SYSTEM_PROMPT, /Kun toimituspäivä on tiedossa, add_items palauttaa uusille riveille myös vaihtoehdot, joten valitse niistä suoraan update_item-työkalulla\./);
  assert.match(SYSTEM_PROMPT, /Erillinen haku on asiakkaalle yksi odotuskierros lisää, joten tee se vain, kun tarvitset muita vaihtoehtoja tai toisen hakusanan\./);
  assert.match(SYSTEM_PROMPT, /Jos toimituspäivä selviää samasta viestistä, kutsu set_delivery_date samassa vastauksessa ennen add_itemsia/);
});

test('the prompt keeps product names and brands exact and sends the cart link in the same round as the last selection', () => {
  assert.match(SYSTEM_PROMPT, /Käytä tuotteiden nimiä ja merkkejä täsmälleen tuloksen mukaan\./);
  assert.match(SYSTEM_PROMPT, /älä kutsu tuotetta Valion tuotteeksi, ellei tulos sano niin\./);
  assert.match(SYSTEM_PROMPT, /kutsu send_cart_link samassa vastauksessa heti viimeisen update_item-kutsun perään/);
});

test('each turn logs model and tool durations and counts only, without text or identifiers', async () => {
  let t = 0;
  const tools = fakeTools();
  const run = tools.run;
  tools.run = async (...args) => { t += 40; return run(...args); };
  const { agent, events } = setup([(params) => { t += 900; return tools_(use('t1', 'add_items', { items: [{ term: 'sipuli' }] })); },
    (params) => { t += 700; return reply(text('Sipuli kirjattu. Montako kiloa?')); }], { tools, clock: () => t });
  const result = await turn(agent, 'wamid.secret-id', 'sipulia');
  assert.equal(result.agent.modelMs, 1600); assert.equal(result.agent.toolMs, 40);
  const [event] = events.filter((e) => e.event === 'agent_turn');
  assert.deepEqual(Object.keys(event).sort(), ['cacheRead', 'cacheWrite', 'calls', 'event', 'fastCalls', 'guard', 'input', 'link', 'modelMs', 'ms', 'outcome', 'output',
    'rounds', 'toolCalls', 'toolMs', 'trimmed']);
  assert.equal(event.fastCalls, 0); // nopea tila näkyy lokissa kutsujen määränä (usage.speed)
  assert.equal(event.modelMs, 1600); assert.equal(event.toolMs, 40); assert.equal(event.rounds, 1);
  assert.doesNotMatch(JSON.stringify(event), /wamid|sipuli|conv-1|Testikeittiö/);
});

test('transcript: a concurrent duplicate turn keeps the first result and the window start never moves back', () => {
  const db = openSqlite(':memory:');
  const transcript = openTranscript(db, { now: () => NOW });
  const user = { role: 'user', content: [{ type: 'text', text: 'moi' }] };
  const first = transcript.append('c', 'm1', [user, { role: 'assistant', content: [text('Moi!')] }], { text: 'Moi!' }, { start: 5 });
  const second = transcript.append('c', 'm1', [user, { role: 'assistant', content: [text('Hei!')] }], { text: 'Hei!' }, { start: 1 });
  assert.deepEqual(second, first);
  assert.equal(db.prepare('SELECT count(*) n FROM agent_transcript').get().n, 2);
  transcript.append('c', 'm2', [], { text: 'x' }, { start: 2, inputTokens: 10 });
  assert.equal(db.prepare("SELECT start_seq FROM agent_window WHERE conversation='c'").get().start_seq, 5);
  assert.equal(helsinkiNow(new Date(NOW)), 'torstai 19.11.2026 klo 8.38');
  assert.match(calendarLine(new Date(Date.parse('2026-12-30T10:00:00Z')), 4), /2026-12-31 to \(huomenna\), 2027-01-01 pe \(ylihuomenna\), 2027-01-02 la$/);
});

// --- Kytkentä: ordering.mjs ja cart-link.mjs. ---
function bridgeFixture(t, { agentMode, steps = [], tools = fakeTools(), person } = {}) {
  const store = openWhatsAppStore(':memory:', () => NOW); t.after(() => store.close());
  bootstrapDemoMember(store, { WHATSAPP_DEMO_PHONE: PHONE, ...(person ? { WHATSAPP_DEMO_PERSON: person } : {}) });
  const model = scripted(steps);
  const agent = createAgent({ tools, db: openSqlite(':memory:'), client: model.client, now: () => NOW, onEvent: () => {} });
  const respond = agent.respond; const agentCalls = [];
  agent.respond = (args) => { agentCalls.push(args); return respond(args); };
  const oldTurns = [];
  const list = () => (tools.state.lines.length ? { id: tools.state.draftId, revision: tools.state.revision, lines: tools.state.lines,
    status: tools.snapshot().checklist.ready ? 'review' : 'needs_details' } : null);
  const bridge = createDemoOrderingChat({ store, phoneId: '12345', agentMode, loadOrdering: async () => ({
    agent, handleTurn: async (args) => { oldTurns.push(args); return { status: 'collecting', text: 'Vanha putki vastasi.', draftId: null, revision: null }; },
    getShoppingList: () => list(), hasTurnResult: () => false, ensureBuyer() {}, prune() {}, close() {} }) });
  t.after(() => bridge.close());
  const cart = createCartLink({ store, ordering: bridge, baseUrl: 'https://cart.example.test', secret: 'cart-test-secret', now: () => NOW });
  return { store, bridge, cart, model, agentCalls, oldTurns, tools, member: () => store.member(PHONE) };
}

test('without WHATSAPP_AGENT the old pipeline answers exactly as before and the agent is never called', async (t) => {
  const saved = process.env.WHATSAPP_AGENT; delete process.env.WHATSAPP_AGENT;
  t.after(() => { if (saved === undefined) delete process.env.WHATSAPP_AGENT; else process.env.WHATSAPP_AGENT = saved; });
  const f = bridgeFixture(t, { agentMode: undefined });
  assert.equal(await f.bridge.usesAgent(), false);
  const result = await f.cart.chat({ member: f.member(), messageId: 'wamid.old', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'maitoa' }] });
  assert.equal(result.text, 'Vanha putki vastasi.');
  assert.equal(f.oldTurns.length, 1); assert.equal(f.oldTurns[0].messageId, 'wamid.old');
  assert.equal(f.agentCalls.length, 0); assert.equal(f.model.calls(), 0);
});

test('with WHATSAPP_AGENT=v2 WhatsApp and the browser chat go to the agent, and the cart page stays on the old engine', async (t) => {
  const f = bridgeFixture(t, { agentMode: 'v2', steps: [reply(text('Moikka! Mitä tilataan?')), reply(text('Selvä!'))] });
  assert.equal(await f.bridge.usesAgent(), true);
  const whatsapp = await f.cart.chat({ member: f.member(), messageId: 'wamid.1', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'moi\nja voita' }],
    incoming: [{ text: 'moi', at: NOW }, { text: 'ja voita', at: NOW + 2000 }] });
  assert.equal(whatsapp.text, 'Moikka! Mitä tilataan?');
  const [args] = f.agentCalls;
  assert.equal(args.messageId, 'wamid.1'); assert.equal(args.channel, 'whatsapp'); assert.equal(args.cartLinkAvailable, true);
  assert.deepEqual(args.incoming, [{ text: 'moi', at: NOW }, { text: 'ja voita', at: NOW + 2000 }]);
  assert.match(args.conversationId, /^12345:/); assert.equal(args.customer.source, 'demo');

  await f.cart.chat({ member: f.member(), messageId: 'web-1', receivedAt: NOW, channel: 'web', messages: [{ role: 'user', content: 'voita' }] });
  assert.equal(f.agentCalls[1].channel, 'web'); assert.deepEqual(f.agentCalls[1].incoming, [{ text: 'voita', at: NOW }]);

  await f.bridge.chat({ member: f.member(), messageId: 'cart:1', receivedAt: NOW, messages: [{ role: 'user', content: 'TILAA' }], expectedList: null });
  assert.equal(f.oldTurns.length, 1); assert.equal(f.agentCalls.length, 2); // korisivun vahvistus vanhalla moottorilla
});

test('cart-link appends the signed cart link to the last message only after send_cart_link succeeded', async (t) => {
  const f = bridgeFixture(t, { agentMode: 'v2', tools: fakeTools({ ready: true }), steps: [
    tools_(use('t1', 'send_cart_link')), reply(text('Kaikki valmista!\n---\nTästä pääset tarkistamaan ja vahvistamaan tilauksen:')),
    reply(text('Kerro, jos haluat vielä muuttaa jotain.'))] });
  const result = await f.cart.chat({ member: f.member(), messageId: 'wamid.ok', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'ok' }] });
  assert.equal(result.messages.length, 2); assert.equal(result.messages[0], 'Kaikki valmista!');
  assert.match(result.messages[1], /^Tästä pääset tarkistamaan ja vahvistamaan tilauksen:\nhttps:\/\/cart\.example\.test\/whatsapp\/cart#[\w-]+\.[\w-]{43}$/);
  assert.deepEqual(linkButton(result.messages[1]), { body: 'Tästä pääset tarkistamaan ja vahvistamaan tilauksen.', label: 'Avaa ostoskori',
    url: result.messages[1].split('\n').at(-1) });
  assert.equal(result.text, result.messages.join('\n\n'));

  const later = await f.cart.chat({ member: f.member(), messageId: 'wamid.next', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'kiitos' }] });
  assert.doesNotMatch(later.text, /https:/);
});

test('cart-link adds no link when the draft is no longer ready and says the cart is safe', async (t) => {
  const tools = fakeTools({ ready: true });
  const f = bridgeFixture(t, { agentMode: 'v2', tools, steps: [tools_(use('t1', 'send_cart_link')), reply(text('Tässä linkki:'))] });
  const respond = f.bridge.chat;
  // Korisivu tai toinen kanava muutti korin juuri ennen linkin tekoa.
  f.bridge.chat = async (args) => { const r = await respond(args); tools.state.deliveryDate = null; return r; };
  const result = await f.cart.chat({ member: f.member(), messageId: 'wamid.race', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'ok' }] });
  assert.doesNotMatch(result.text, /https:/);
  assert.match(result.messages.at(-1), /Ostoskorilinkki ei nyt avaudu\. Ostoskorisi on tallessa\./);
  assert.equal(result.requestCartLink, false);
});

// --- Riippumattoman katselmoinnin löydökset 19.11. ---
test('review 1: an empty correction never sends the rejected reply as is', async () => {
  const { agent } = setup([reply(text('Kori maksaa 99,99 €. Maksa täällä: https://evil.example/pay')), reply(text(''))]);
  const result = await turn(agent, 'm1', 'paljonko?');
  assert.equal(result.agent.outcome, 'repaired');
  assert.equal(result.text, 'Kori maksaa (hinta näkyy korissa). Maksa täällä:');
  const silent = setup([reply(text('')), reply(text(''))]);
  assert.equal((await turn(silent.agent, 'm1', 'moi')).text, FALLBACK.failed);
});

test('review 2: euro amounts are recognised in every reviewed form, without false hits', () => {
  const cases = [['20 eurolla', 20], ['45 euroon', 45], ['100 eurosta', 100], ['15 euroksi', 15], ['50 snt', 0.5], ['50 senttiä', 0.5],
    ['1.234,50 €', 1234.5], ['1,234.50 €', 1234.5], ['0,125 €', 0.125], ['€ 12,50', 12.5], ['12,50 e', 12.5]];
  for (const [form, value] of cases) assert.deepEqual(euroAmounts(`Hinta on ${form}.`).map((a) => a.value), [value], form);
  for (const fine of ['Eurooppalainen juusto, 12 kpl', '2 e-luokan munaa ja 3 erää', 'Toimitus 21.11. klo 8.30, 50 hengelle 10 kg, alv 0 %']) {
    assert.deepEqual(euroAmounts(fine), [], fine);
  }
  assert.deepEqual(euroAmounts('12,50 € 3 kg:n säkki').map((a) => a.value), [12.5]);
  const check = checkReply('Säästät 20 eurolla, ja pussi maksaa 50 snt.', { known: [] });
  assert.deepEqual(check.unknownAmounts.map((a) => a.value), [20, 0.5]);
  assert.equal(repairReply('Säästät 20 eurolla, ja pussi maksaa 50 snt.', check), 'Säästät (hinta näkyy korissa), ja pussi maksaa (hinta näkyy korissa).');
  assert.equal(checkReply('Pussi maksaa 50 snt.', { known: [0.5] }).ok, true);
});

test('review 3: prices from earlier tool results in the window pass the guard in a follow-up, also from a cut result', async () => {
  const { agent, model } = setup([tools_(use('t1', 'search_products', { query: 'sipuli' })), reply(text('Löysin sipulit. Mille päivälle?')),
    reply(text('Sipulisäkki maksaa 11,18 €.'))]);
  await turn(agent, 'm1', 'sipulia');
  const result = await turn(agent, 'm2', 'paljonko se säkki maksoi?');
  assert.equal(result.text, 'Sipulisäkki maksaa 11,18 €.'); assert.deepEqual(result.agent.guard, []); assert.equal(model.calls(), 3);

  const tools = fakeTools();
  tools.overrides.search_products = () => ({ options: [{ productId: 'P9', name: 'Kerma 10 l', pricePerPack: 7.77 }], filler: 'x'.repeat(70_000) });
  const cut = setup([tools_(use('t1', 'search_products', { query: 'kerma' })), reply(text('Löysin kerman.')), reply(text('Kerma maksaa 7,77 €.'))], { tools });
  await turn(cut.agent, 'm1', 'kermaa');
  assert.match(lastUser(cut.model.requests[1]).content[0].content, /…\(lyhennetty\)$/);
  assert.deepEqual((await turn(cut.agent, 'm2', 'hinta?')).agent.guard, []);
});

test('review 5: the turn budget is a hard limit for retries and the plain request', async () => {
  let t = 0;
  const bad = setup([() => { t += 50_000; throw Object.assign(new Error('bad'), { status: 400 }); }, reply(text('Moi!'))], { clock: () => t });
  await turn(bad.agent, 'm1', 'moi');
  assert.deepEqual(bad.model.requests.map((r) => r.options.timeout), [45_000, 10_000]); // simple vain jäljellä olevalla ajalla

  t = 0; const naps = [];
  const busy = setup([() => { t += 2_000; throw Object.assign(new Error('overloaded'), { status: 529 }); }, reply(text('Moi!'))],
    { clock: () => t, sleep: async (ms) => { naps.push(ms); } });
  assert.equal((await turn(busy.agent, 'm1', 'moi')).text, 'Moi!'); assert.deepEqual(naps, [400]);

  t = 0;
  const late = setup([() => { t += 56_000; throw Object.assign(new Error('overloaded'), { status: 529 }); }, reply(text('ei saa tulla'))],
    { clock: () => t, sleep: async () => {} });
  await assert.rejects(turn(late.agent, 'm1', 'moi'), /overloaded/); // alle 5 s jäljellä: ei uusintaa, kanava uusii vuoron
  assert.equal(late.model.calls(), 1);

  t = 0;
  const spent = setup([() => { t += 59_500; return tools_(use('t1', 'add_items', { items: [{ term: 'kerma' }] })); }, reply(text('ei saa tulla'))], { clock: () => t });
  const result = await turn(spent.agent, 'm1', 'kermaa');
  assert.equal(result.agent.outcome, 'timeout'); assert.equal(result.text, FALLBACK.failed); assert.equal(spent.model.calls(), 1);
  assert.deepEqual(spent.rows().map((r) => r.role), ['user', 'assistant', 'user']); // tehty työ talteen
  assert.match(JSON.parse(spent.rows().at(-1).content).at(-1).text, /Asiakkaalle lähetettiin/);

  t = 0;
  const timeout = setup([() => { t += 45_000; throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }); }], { clock: () => t });
  await assert.rejects(turn(timeout.agent, 'm1', 'moi'), /timed out/); // ensimmäinen kutsu: ei tallennettavaa, kanava uusii
  assert.equal(timeout.rows().length, 0);
});

test('production turn limits: a recipe turn with 50 s of tools and a 15 s reply gets through, as it did not with 60/45 s', async () => {
  // Livetesti 19.11.: Opus 5.5 high, "lohikeittoa 40 hengelle, mitä tarvitsen?" katkesi 60 s:n rajaan 2/2 kertaa.
  assert.ok(TURN_LIMITS.turnBudgetMs < 90_000); // Workerin selainkeskustelun aikakatkaisu
  assert.ok(TURN_LIMITS.turnBudgetMs - TURN_LIMITS.softDeadlineMs >= 20_000); // loppuvastaukselle aikaa
  const recipe = (options) => {
    let t = 0; let ref = null;
    const search = (i) => () => { t += 10_000; return tools_(use(`t${i}`, 'get_cart')); };
    // Loppuvastaus vie 15 s: jos kutsulle annettu aika on lyhyempi, SDK katkaisee sen kuten oikeassa ajossa.
    const answer = () => {
      const limit = ref.model.requests.at(-1).options.timeout;
      if (limit < 15_000) { t += limit; throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }); }
      t += 15_000; return reply(text('Tässä lista 40 hengelle.'));
    };
    ref = setup([search(1), search(2), search(3), search(4), search(5), answer], { clock: () => t, ...options });
    return ref;
  };
  const old = await turn(recipe({}).agent, 'm1', 'lohikeittoa 40 hengelle');
  assert.equal(old.agent.outcome, 'timeout'); assert.equal(old.text, FALLBACK.failed);
  const now = recipe(TURN_LIMITS);
  const done = await turn(now.agent, 'm1', 'lohikeittoa 40 hengelle');
  assert.equal(done.agent.outcome, 'ok'); assert.equal(done.text, 'Tässä lista 40 hengelle.');
  assert.ok(now.model.requests.slice(0, 5).every((r) => r.params.tool_choice.type === 'auto')); // työkalut auki 50 s:n jälkeenkin
});

test('review 6: a cart link in the discarded reply never reaches the transcript or the API', async () => {
  const { agent, model, rows } = setup([reply(text('Kori valmis!')), reply(text('Lisäsin voin.'))]);
  await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'job-5', incoming: [{ text: 'laita linkki', at: NOW }] });
  await agent.respond({ customer: CUSTOMER, conversationId: 'conv-1', messageId: 'job-5:r1', incoming: [{ text: 'laita linkki', at: NOW }, { text: 'ja voita', at: NOW + 3000 }],
    discardedReply: 'Kori valmis! Tästä pääset koriin:\nhttps://cart.example.test/whatsapp/cart#eyJiaW5kaW5nIjoiYiJ9.c2lnbmF0dXJl' });
  const stored = JSON.stringify(rows());
  const note = rows().filter((r) => r.turn === 'job-5:r1' && r.role === 'user').flatMap((r) => JSON.parse(r.content)).map((b) => b.text)
    .find((t) => t.startsWith('[Järjestelmä] Edellistä vastaustasi'));
  assert.match(note, /«Kori valmis! Tästä pääset koriin:\n\[korilinkki\]»/);
  assert.doesNotMatch(stored, /cart\.example\.test|eyJiaW5k/);
  assert.doesNotMatch(JSON.stringify(model.requests[1].params.messages), /cart\.example\.test/);
});

test('the first message guides the customer when the conversation opens with a greeting, and stays short when it opens with an order', async () => {
  // Eelis 19.11. klo 11: "toi eka viesti ois just ohjeellistava et voit tilata täältä mitä vain valion tukusta ni mä kerään sulle
  // tilauksen … voit myös lähettää ääniviestiä tai suoraan reseptilinkkejä, tai kuva ostoslistasta". Ohje, ei pohjateksti.
  assert.match(SYSTEM_PROMPT, /Jos asiakkaan ensimmäinen viesti on pelkkä tervehdys tai epämääräinen, kerro tiiviisti parilla tavallisella lauseella, miten täällä tilataan/);
  assert.match(SYSTEM_PROMPT, /täältä voi tilata mitä tahansa Valio Aimon tukun valikoimasta, ja tilaus hoituu tässä keskustelussa valmiiksi ostoskoriin\./);
  // Eelis 19.11. klo 23.45: "Kerro: – mitä tarvitset … – mille päivälle" oli kömpelö. Aluksi riittää, mitä tarvitaan, ja botti
  // kysyy päivän ja allergiat myöhemmin itse.
  assert.match(SYSTEM_PROMPT, /Asiakkaan tarvitsee aluksi kertoa vain, mitä hän tarvitsee, koska kysyt toimituspäivän ja allergiat myöhemmin, kun niitä tarvitaan\. Älä luettele, mitä kaikkea asiakkaan pitää kertoa\./);
  assert.match(SYSTEM_PROMPT, /kun asiakas aloittaa alusta, kuittaa lyhyesti ja kysy, mitä tilataan\./);
  assert.doesNotMatch(SYSTEM_PROMPT, /Asiakas kertoo, mitä tarvitsee, mille päivälle/);
  assert.match(SYSTEM_PROMPT, /WhatsAppissa viestin voi kirjoittaa tai lähettää ääniviestinä, reseptilinkkinä tai kuvana ostoslistasta\./);
  // Selainkeskustelu ottaa vastaan vain tekstiä (web-chat.mjs). Eelis 19.11. illalla: "siel selaimes toimii vaa keskustelu",
  // joten siellä ei luvata ääntä, reseptilinkkejä eikä kuvia.
  assert.match(SYSTEM_PROMPT, /Selainkeskustelussa viestin voi vain kirjoittaa\./);
  assert.doesNotMatch(SYSTEM_PROMPT, /Selainkeskustelussa[^.]*reseptilink/);
  assert.match(SYSTEM_PROMPT, /Jos ensimmäinen viesti on jo tilaus, yksi esittelylause riittää ja siirryt asiaan\./);
  assert.match(SYSTEM_PROMPT, /WhatsAppissa lyhyt maininta ääniviesteistä, linkeistä ja kuvista sopii, jos se tuntuu luontevalta\. Selainkeskustelussa niitä ei mainita\./);
  const { agent, model } = setup([reply(text('Huomenta!'))]);
  await agent.respond({ customer: CUSTOMER, conversationId: 'conv-web', messageId: 'web-1', channel: 'web', incoming: [{ text: 'moi', at: NOW }] });
  const [context] = blocks(model.requests[0].params.messages[0]);
  assert.match(context, /Kanava: selainkeskustelu/);
  assert.match(context, /Keskustelu alkaa: aiempaa keskustelua ei ole, joten tämä on ensimmäinen viestisi asiakkaalle \(esittely ja tarvittaessa ohjeet\)\./);
});

test('the agent gets a person name only when it is a real one, never the placeholder of the browser chat or the demo member', async (t) => {
  // Livetesti 19.11.: selainkeskustelun synteettinen asiakas (web-chat.mjs, henkilö "Kokeilija") sai tervehdyksen "Moi Kokeilija".
  const named = bridgeFixture(t, { agentMode: 'v2', person: 'Maija', steps: [reply(text('Huomenta, Maija!')), reply(text('Huomenta!'))] });
  await named.cart.chat({ member: named.member(), messageId: 'wamid.n1', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'moi' }] });
  await named.cart.chat({ member: named.member(), messageId: 'web-n1', receivedAt: NOW, channel: 'web', messages: [{ role: 'user', content: 'moi' }] });
  assert.equal(named.agentCalls[0].customer.personName, 'Maija');
  assert.equal(named.agentCalls[1].customer.personName, null); // selainkeskustelun asiakas on aina synteettinen
  assert.equal(named.agentCalls[1].customer.buyerId, named.agentCalls[0].customer.buyerId);
  assert.equal(named.agentCalls[1].conversationId, named.agentCalls[0].conversationId);
  const context = (request) => blocks(request.params.messages.at(-1))[0];
  assert.match(context(named.model.requests[0]), /Asiakas: [^\n]*, yhteyshenkilö Maija/);
  assert.doesNotMatch(context(named.model.requests[1]), /yhteyshenkilö/);

  // Testiasiakas ilman WHATSAPP_DEMO_PERSONia saa paikkanimen "Testaaja", joka ei ole nimi WhatsAppissakaan.
  const placeholder = bridgeFixture(t, { agentMode: 'v2', steps: [reply(text('Huomenta!'))] });
  assert.equal(placeholder.member().person, DEMO_PERSON);
  await placeholder.cart.chat({ member: placeholder.member(), messageId: 'wamid.p1', receivedAt: NOW, channel: 'whatsapp', messages: [{ role: 'user', content: 'moi' }] });
  assert.equal(placeholder.agentCalls[0].customer.personName, null);
  assert.doesNotMatch(context(placeholder.model.requests[0]), /yhteyshenkilö|Testaaja/);
  assert.equal(agentCustomer({ personName: 'Kokeilija' }, 'whatsapp').personName, null);
  assert.match(SYSTEM_PROMPT, /Puhuttele asiakasta nimellä vain, jos vuoron tiedoissa on oikea etunimi\. Yrityksen nimi tai yleisnimi, kuten Kokeilija tai Testaaja, ei ole henkilön nimi\./);
});

test('the tone stays inside the customer\'s own register, and emojis are rare and only for casual customers', () => {
  // Livetesti 19.11.: kirjakielellä kirjoittanut koulun keittiö sai "Moikka! … 🎉" ja "Kori on valmis! 🥳".
  assert.match(SYSTEM_PROMPT, /Puhekielisen asiakkaan kanssa voit puhua rennosti \("mä"\), ja asiallisesti kirjoittavan kanssa kirjoitat asiallisesti \("minä"\) ilman emojeja\./);
  assert.match(SYSTEM_PROMPT, /Emojeja on korkeintaan yksi viestissä ja vain rennossa keskustelussa\./);
  const context = contextText({ now: new Date(NOW), customer: CUSTOMER, channel: 'whatsapp', snapshot: {}, cartLinkAvailable: true, first: true, tone: 'leikkisä' });
  assert.match(context, /Sävy tähän keskusteluun: leikkisä, asiakkaan oman tyylin sisällä\./);
});

test('a diet of only some diners does not restrict the whole order, and the agent searches before it says a product is missing', () => {
  // Livetesti 19.11.: "80 hengelle … Yksi vieras on vegaani." rajasi koko tilauksen vegaaniseksi, ja malli väitti, ettei
  // tavallista raakaa perunaa löydy, sekä selitti haun sisäistä toimintaa ("antaa tuotteille pelkän varoituksen").
  assert.match(SYSTEM_PROMPT, /Ne koskevat jokaista tilauksen tuotetta, ja uusi kutsu korvaa aiemmat, joten lähetä aina koko lista\./);
  assert.match(SYSTEM_PROMPT, /Jos vain osa ruokailijoista tarvitsee erityisruokavalion, esimerkiksi yksi vegaani 80:stä, älä tee siitä koko tilauksen ruokavaliota, ellei asiakas sitä pyydä\./);
  assert.match(SYSTEM_PROMPT, /Käytä silloin none: true, kirjaa tarve note-kenttään ja kysy, tarvitaanko heille omia tuotteita omille riveilleen\./);
  assert.match(SYSTEM_PROMPT, /Jos osalla ruokailijoista on allergia, kysy, koskeeko se koko tilausta\./);
  assert.match(SYSTEM_PROMPT, /Jos tuotetta ei löydy valikoimasta, hae myös pelkällä perussanalla ja katso lisää vaihtoehtoja ennen kuin sanot, ettei sitä ole, ja tarjoa lähin vaihtoehto\./);
  assert.match(SYSTEM_PROMPT, /Älä kuvaile työkaluja, hakuja tai järjestelmän toimintaa/);
});

test('small amounts of pantry staples are asked about before they are ordered', () => {
  assert.match(SYSTEM_PROMPT, /Pienistä perustarvikkeista, joita asiakas ei itse pyytänyt \(jauhot, suola, öljy\), kysy ensin, onko niitä jo keittiössä\./);
  // Eelis 19.11.: 50 sipulille (noin 6 kg) valittu 10 kg:n säkki on hävikkiä. Vanha esimerkki ohjasi juuri säkkiin.
  assert.match(SYSTEM_PROMPT, /Valitse pakkaus tai pakkausyhdistelmä, josta jää vähiten yli, koska ylijäävä tuoretavara on keittiölle hävikkiä\./);
  assert.doesNotMatch(SYSTEM_PROMPT, /10 kg:n säkkiä/);
});

test('the full cart is shown as a dash list when it is ready, and an unusual amount is questioned without blocking it', () => {
  // Eelis 19.11.: "täl hetkel ostoskoris on tämmöset tuotteet ja sit sillee ranskalaisin viivoin näyttäs mitä sielt nyt löytyypi"
  // ja "jos sipulia tilattais vaiks 200kg? … onko tarkotuksella näin paljon". Klo 23.45 WhatsApp-testin jälkeen: viestit liian
  // isoja, joten lista pysyy lyhyenä: vain korissa olevat tuotteet, ei puuttuvia.
  assert.match(SYSTEM_PROMPT, /Kun tuotteita valitaan tai kori muuttuu, kerro lyhyesti, mitä teit, ja näytä korissa olevat tuotteet viivalistana\./);
  assert.match(SYSTEM_PROMPT, /Pidä lista lyhyenä: tuotteet, joita ei saa, eivät kuulu listaan\./);
  // Eelis 20.11. klo 0.00 tuotannon viestistä (da561df): "sano aina hinnat ja sano aina noi tuotteet tollee kunnolla. tä oli esim
  // tosi hyvä viesti … annetaa ehkä vaa olla näi". Kolmen viestin kokeilu (384e85a, b491c2d) peruttiin.
  assert.match(SYSTEM_PROMPT, /Jokaisella rivillä on tuote ja määrä sekä valitun tuotteen koko nimi ja hinta tai kilohinta, kun tuote on valittu\./);
  assert.doesNotMatch(SYSTEM_PROMPT, /Ostoskorissasi nyt:|Perustelut ja vaihtoehdot jätetään pois/);
  assert.match(SYSTEM_PROMPT, /Jos mikään ei muuttunut, listaa ei tarvitse toistaa\./);
  assert.match(SYSTEM_PROMPT, /Jos määrä tuntuu epätavallisen suurelta tai pieneltä käyttöön nähden, esimerkiksi 200 kg sipulia 50 hengelle, kysy ystävällisesti, onko se tarkoituksellinen/);
  assert.match(SYSTEM_PROMPT, /Jos asiakas vahvistaa määrän, jatka sillä\./);
});

test('the agent speaks of products and the list in the customer\'s words, and a passed deadline gets a reason and a day, not a new search', () => {
  // Eelis 19.11. illalla: "miks toi sanoo kirjasin rivit: eiks toi oo vähä tyhmäst sanottu?". Sessio E klo 17.18: "perjantaiks"
  // kesti 24 s ja vastasi vain, ettei tilattavaa löydy: tilausaika oli mennyt, ja malli haki turhaan muilla sanoilla.
  assert.match(SYSTEM_PROMPT, /Puhu tuotteista, allergioista ja ostoslistasta asiakkaan sanoin, koska asiakas näkee listan eikä järjestelmän rivejä tai työkaluja\./);
  // WhatsApp-testi 19.11. klo 19.15 (Opus): "allergiat jätin rajaamatta" toisti set_dietin sanaa.
  assert.match(SYSTEM_PROMPT, /Työkalujen kuvauksissa ja tuloksissa on järjestelmän sanoja, kuten rivi, kirjata ja rajata, joita asiakas ei käytä\./);
  // Tuotanto 19.11. klo 19.27 (89e3caa): "mennäänkö ilman rajauksia?" yhä 1/2 ajossa, koska ohje itse puhui rajaamisesta.
  // Sana on poistettu ohjeen ja työkalujen omista teksteistä, jotta malli ei toista sitä.
  assert.doesNotMatch(SYSTEM_PROMPT.replace('kuten rivi, kirjata ja rajata,', ''), /rajaa|rajat|rajau|rajaam/);
  assert.match(SYSTEM_PROMPT, /Jos tuotetta ei saa valitulle päivälle, esimerkiksi koska tilausaika on jo mennyt, kerro syy suoraan/);
  assert.match(SYSTEM_PROMPT, /Silloin ei tarvitse hakea muilla sanoilla, koska syy on päivä eikä tuote\./);
});

test('Eelis\'s morning conversation: correct Finnish, one allergy question, colloquial questions, counted onions and no tool talk', () => {
  // Uusinta tuotannossa 19.11. Eeliksen aamun viesteillä (Sonnet 5.5): ensimmäinen viesti "mä keräin tilauksen" (myös "minä
  // keräären"), allergiat kysyttiin lähes joka viestissä, "paljo menis 50 henkilöl" luettiin "koska määrää on paljon" ja peruna
  // tuplattiin 20 kg:aan, "20 sipulii" oletettiin kiloiksi, ja "valkosipulin tilalle ehdotettu tavallinen sipuli ei ole oikea
  // korvike". Ohje, ei koodia: testi tarkistaa, että säännöt ovat ohjeessa.
  // 1. Ensimmäisen viestin ohje ei vaadi taivuttamaan verbiä minä-muotoon, ja suomi tarkistetaan.
  assert.doesNotMatch(SYSTEM_PROMPT, /sinä keräät|keräät tilauksen/);
  assert.match(SYSTEM_PROMPT, /ja tilaus hoituu tässä keskustelussa valmiiksi ostoskoriin\./);
  assert.match(SYSTEM_PROMPT, /Kirjoita aina virheetöntä suomea, myös puhekielessä: isot alkukirjaimet, välimerkit ja sanojen taivutukset kohdalleen\. Jos et ole varma jonkin sanan muodosta, muotoile lause toisin\./);
  // 2. Allergiat kerran alussa ja uudelleen vasta yhteenvedossa; avointa kysymystä ei toisteta.
  assert.match(SYSTEM_PROMPT, /ja allergiat siksi, että ne vaikuttavat siihen, mitkä tuotteet sopivat\./);
  assert.doesNotMatch(SYSTEM_PROMPT, /allergiat aikaisin/);
  assert.match(SYSTEM_PROMPT, /Älä toista avointa kysymystä joka viestissä: jos asiakas ohittaa sen, jatka sillä, mitä hän kertoi, ja palaa asiaan, kun sitä oikeasti tarvitaan\./);
  assert.match(SYSTEM_PROMPT, /Allergioista riittää yleensä kysyä kerran alussa ja tarvittaessa vielä kerran ennen korilinkkiä\./);
  // 3. Puhekielinen kysymys ilman kysymysmerkkiä ja johdonmukaiset määrät.
  assert.match(SYSTEM_PROMPT, /Puhekielinen kysymys voi tulla ilman kysymysmerkkiä: "paljo menis 50 henkilöl" kysyy, paljonko menisi 50 hengelle\./);
  assert.match(SYSTEM_PROMPT, /Pysy ehdotuksissasi johdonmukaisena ja muuta niitä vain uuden tiedon vuoksi\./);
  // 4. Laskettavan tuotteen pelkkä luku on kappaleita.
  assert.match(SYSTEM_PROMPT, /Laskettavien tuotteiden \(sipuli, sitruuna, kananmuna\) pelkkä luku tarkoittaa kappaleita, vaikka muut tuotteet olisi annettu kiloina\./);
  // 5. Työkalujen toimintaa ei kuvailla.
  assert.match(SYSTEM_PROMPT, /Kerro asiakkaalle vain lopputulos\./);
  assert.match(SYSTEM_PROMPT, /ehdota aikaisinta mahdollista päivää, jonka haun tulos antaa/);
});

test('replies move step by step and stay short, missing products fit in one sentence, and a ready-made dish can become a recipe', () => {
  // Eelis 19.11. klo 23.45 WhatsApp-testissä: 60 hengen meksikolaiseen iltaan tuli 13 rivin lista "ei nyt tilattavissa"-riveineen
  // ja ehdotuksineen yhdessä viestissä. "eiks toi voi olla … tän pitäs olla vaa nopee juttu", "et tää etenis sit vaiheitain"
  // ja churroista: "haluuks valmischurroi vai sitte et haluuks et etitään joku churroresepti valion valikoimasta".
  assert.match(SYSTEM_PROMPT, /Etene vaiheittain ja pidä viestit lyhyinä: yleensä muutama rivi\./);
  assert.match(SYSTEM_PROMPT, /Kun asiakas kertoo ison tilauksen tai koko menun, älä käy kaikkea läpi yhdessä viestissä/);
  assert.match(SYSTEM_PROMPT, /Tuotteet, joita ei nyt saa, mainitset yhdessä lauseessa nimeltä etkä rivi kerrallaan\./);
  assert.match(SYSTEM_PROMPT, /Kysy kysymykset tavallisina lauseina, älä viiva- tai numerolistana\./);
  // "se vaa sit ain kyselis noi eriksee et oliks jotai allergioi tms?"
  assert.match(SYSTEM_PROMPT, /Kysy vain sitä, mitä tarvitset seuraavaksi, yksi asia kerrallaan, kuten ihminen kysyisi/);
  assert.match(SYSTEM_PROMPT, /esimerkiksi churroja, kysy lyhyesti, tekeekö keittiö sen itse\. Jos tekee, ehdota tavallisen reseptin raaka-aineet ja määrät valikoimasta\./);
});
