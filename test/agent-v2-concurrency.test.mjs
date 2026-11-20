// Rinnakkaiset asiakkaat oikealla polulla (Eelis 19.11.: demossa 4–5 numeroa yhtä aikaa): allekirjoitettu webhook →
// WhatsApp-kanava (WHATSAPP_CONCURRENCY, oletus 4) → korilinkin kääre (cart-link.mjs) → tilaussilta (ordering.mjs) → v2-agentti
// oikeilla työkaluilla ja luonnosvarastolla. Haku ja tarjous ovat injektoidut kuten test/agent-tools.test.mjs:ssä, ja malli on
// käsikirjoitettu: se toistaa kontekstilohkon asiakkaan nimen ja korin sisällön, joten jokaisen vastauksen omistaja näkyy.
// Ei verkkoa, ei katalogia, ei mallikutsuja.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-concurrency-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { openWhatsAppStore, codeHash } = await import('../server/whatsapp/store.mjs');
const { createWhatsAppChannel, workerCount } = await import('../server/whatsapp/channel.mjs');
const { createDemoOrderingChat } = await import('../server/whatsapp/ordering.mjs');
const { createDemoBuyerResolver } = await import('../server/whatsapp/demo-buyer.mjs');
const { createCartLink } = await import('../server/whatsapp/cart-link.mjs');
const { redoWhenAgent } = await import('../server/whatsapp/runtime.mjs');
const { createAgent } = await import('../server/agent/index.mjs');
const { createAgentTools } = await import('../server/agent/tools.mjs');
const { CONTEXT_PREFIX, CUSTOMER_PREFIX } = await import('../server/agent/prompt.mjs');
const { createOrderingTools } = await import('../server/order-tools/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { shoppingListView } = await import('../server/shopping-list/index.mjs');
const { openSqlite } = await import('../server/sqlite.mjs');
const { unitSizeFor } = await import('../server/gateway/quantity.mjs');
const { roundToStep, stepOf, unitLabel } = await import('../server/catalog.mjs');
const { helsinkiLabel } = await import('../server/gateway/clock.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const PHONE_ID = '12345';
const APP_SECRET = 'concurrency-app-secret';
const BASE = 'https://cart.example.test';
const settings = { phoneId: PHONE_ID, appSecret: APP_SECRET, verifyToken: 'verify', accessToken: 'token', apiVersion: 'v23.0',
  supportContact: 'tuki@example.test', orderingDemo: true };
// Demon kello: to 19.11. klo 10.00 Helsingin aikaa. Toimitus pe 20.11., tilausaika to klo 12.
const T = Date.parse('2026-11-19T08:00:00Z');
const FRIDAY = '2026-11-20';

// Katalogin muotoiset tuotteet ja hinnat. Jokaisella asiakkaalla on oma tuotteensa, joten sekoittuminen näkyy.
const P = Object.fromEntries([
  { id: '410001', name: 'Valio rasvaton maito 1 l', brand: 'Valio', category: '10100', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, labels: [], litres: 1, kg: 1 },
  { id: '470001', name: 'Valio vispikerma 35 % 1 l', brand: 'Valio', category: '10401', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, labels: [], litres: 1, kg: 1 },
  { id: '460195', name: 'SIPULI 10KG SÄKKI SUOMI', category: '17405', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], kg: 10 },
  { id: '460500', name: 'PERUNA 10KG SÄKKI SUOMI', category: '17420', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: [], kg: 10 },
  { id: '450600', name: 'Valio voi 500 g', brand: 'Valio', category: '10500', salesUnit: 'ST', baseUnit: 'ST', perSales: 1, lot: 0.01, temp: 'chilled', country: 'fi', contains: ['AM'], hasAllergenData: true, kg: 0.5 },
].map((p) => [p.id, p]));
const PRICES = { 410001: 1.1, 470001: 4.1, 460195: 9.5, 460500: 8, 450600: 3.2 };
// Mallin tieto tarpeista: tuotesana → valittava tuote ja määrä asiakkaan yksikössä.
const NEEDS = { maito: { productId: '410001', amount: 20, unit: 'l' }, kerma: { productId: '470001', amount: 5, unit: 'l' },
  sipuli: { productId: '460195', amount: 10, unit: 'kg' }, peruna: { productId: '460500', amount: 20, unit: 'kg' }, voi: { productId: '450600', amount: 2, unit: 'kg' } };
const CUSTOMERS = [
  { phone: '358401000001', company: 'Ravintola Aalto', person: 'Anna', term: 'maito', say: ['moi, tarviin 20 l maitoa', 'toimitus perjantaiks', 'ei allergioita'] },
  { phone: '358401000002', company: 'Kahvila Bulevardi', person: 'Benjamin', term: 'kerma', say: ['5 litraa kermaa perjantaiks', 'ei allergioita kiitos'] },
  { phone: '358401000003', company: 'Lounas Cecilia', person: 'Cecilia', term: 'sipuli', say: ['hei! 10 kg sipulia', 'perjantaina', 'ei allergioita'] },
  { phone: '358401000004', company: 'Bistro Delta', person: 'Daniel', term: 'peruna', say: ['perunaa 20 kg perjantaiks', 'ei allergioita'] },
  { phone: '358401000005', company: 'Keittiö Eetu', person: 'Eeva', term: 'voi', say: ['tarviin voita 2 kg', 'toimitus perjantaiks', 'ei allergioita meillä'] },
];

const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length > 4 ? w.slice(0, -1) : w));
const catalog = { get: (id) => P[String(id)], search: (q) => Object.values(P).filter((p) => words(q).every((w) => p.name.toLowerCase().includes(w))).map((product) => ({ product })) };
const cutoffOf = (date) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return `${d.toISOString().slice(0, 10)}T12:00:00+0200`; };
const price = (id) => (PRICES[id] == null ? null : { net: PRICES[id], vatRate: 14 });
/** Oikea createOrderingTools injektoidulla haulla ja tarjouksella (sama muunnoslasku kuin gatewayssa). Kaikki tilattavissa. */
const orderingTools = () => createOrderingTools({ now: () => T, product: (id) => P[String(id)], buyer: (id) => ({ id }), nearby: async () => [],
  search: async (line, date) => {
    const list = Object.values(P).filter((p) => words(line.productTerm).every((w) => p.name.toLowerCase().includes(w))).flatMap((p) => {
      const size = unitSizeFor(p, price(p.id), line.quantity.unit, line.quantity.basis || 'sales');
      if (!size) return [];
      const qty = Math.max(stepOf(p), roundToStep(line.quantity.value / size.value, p, 'up'));
      return [{ id: p.id, name: p.name, brand: p.brand || null, qty, unitLabel: unitLabel(p.salesUnit), unit: p.salesUnit, litres: p.litres ?? null, kg: p.kg ?? null,
        price: PRICES[p.id], labels: p.labels || [], availability: { deliveryDate: date, stock: 500, closingTime: cutoffOf(date) }, typeRank: 0, requested: true, match: 0 }];
    });
    Object.assign(list, { nextDeliveryDate: null, notInCatalog: !list.length, availabilityUnknown: false, requestedUnknown: false, unknownIds: [], ingredientUnavailable: null });
    return list;
  },
  requestQuote: async (buyer, input) => ({ quoteId: `Q-${crypto.randomUUID()}`, needs: input.needs.map((n) => {
    const p = P[n.candidates[0]]; const size = unitSizeFor(p, price(p.id), n.quantity.unit, n.quantity.basis || 'sales');
    const qty = Math.max(stepOf(p), roundToStep(n.quantity.value / size.value, p, 'up'));
    return { ref: n.ref, excluded: [], options: [{ kind: 'exact', deliveryDate: input.deliveryDate, expiresAt: new Date(T + 15 * 60_000).toISOString(),
      cutoff: cutoffOf(input.deliveryDate), cutoffLabel: helsinkiLabel(cutoffOf(input.deliveryDate)), offer: `jws-${n.ref}-${p.id}`,
      lines: [{ productId: p.id, name: p.name, quantity: qty, salesUnitLabel: unitLabel(p.salesUnit), covers: +(qty * size.value).toFixed(2), unitPriceNet: PRICES[p.id],
        lineNet: +(PRICES[p.id] * qty).toFixed(2), vatRate: 14, availability: { stockKnown: true } }] }] };
  }) }),
  placeOrder: async () => { throw new Error('WhatsApp-viesti ei tilaa mitään'); },
});

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${crypto.randomUUID().replaceAll('-', '')}`, name, input });
const message = (stopReason, content) => ({ id: `msg_${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stopReason,
  content, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });

/**
 * Käsikirjoitettu malli: lukee vuoron kontekstilohkosta asiakkaan (yritys ja yhteyshenkilö) ja asiakkaan viestit. Ensin se kirjaa
 * mainitut tarpeet, päivän ja ruokavalion ja lukee korin, sitten valitsee tuotteen, pyytää valmiille korille linkin ja vastaa
 * "Selvä, <asiakas>. Korissa: <tarpeet>." Satunnainen viive lomittaa asiakkaiden vuorot. Tilaton: sama olio kaikille. peak kertoo,
 * monenko eri asiakkaan mallikutsu oli enimmillään käynnissä yhtä aikaa (silta ei saa sarjallistaa eri numeroita), ja overlaps
 * asiakkaat, joiden kaksi vuoroa kutsui mallia yhtä aikaa (samaan transkriptiin ja koriin).
 */
function kitchenModel() {
  const turns = []; const active = new Map(); const overlaps = []; let peak = 0;
  const client = { beta: { messages: { async create(params) {
    const at = params.messages.findLastIndex((m) => m.role === 'user' && Array.isArray(m.content) && String(m.content[0]?.text ?? '').startsWith(CONTEXT_PREFIX));
    const turn = params.messages.slice(at);
    const who = /^Asiakas: (.*)$/mu.exec(turn[0].content[0].text)?.[1] ?? '';
    const texts = turn[0].content.map((b) => String(b.text ?? '')).filter((t) => t.startsWith(CUSTOMER_PREFIX)).map((t) => t.slice(t.indexOf(':\n') + 2));
    const used = turn.filter((m) => m.role === 'assistant').flatMap((m) => m.content).filter((b) => b.type === 'tool_use');
    const results = turn.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((b) => b.type === 'tool_result').map((b) => JSON.parse(b.content));
    active.set(who, (active.get(who) || 0) + 1); peak = Math.max(peak, active.size);
    if (active.get(who) > 1) overlaps.push(who);
    try { await sleep(1 + Math.floor(Math.random() * 12)); } finally { if (active.get(who) > 1) active.set(who, active.get(who) - 1); else active.delete(who); }
    if (!used.length) {
      turns.push({ who, texts });
      const said = texts.join('\n').toLowerCase();
      const term = Object.keys(NEEDS).find((t) => said.includes(t.slice(0, 4)));
      return message('tool_use', [
        ...(term ? [toolUse('add_items', { items: [{ term, amount: NEEDS[term].amount, unit: NEEDS[term].unit, note: null }] })] : []),
        ...(said.includes('perjanta') ? [toolUse('set_delivery_date', { date: FRIDAY })] : []),
        ...(said.includes('allergi') ? [toolUse('set_diet', { allergens: [], diets: [], none: true, note: null })] : []),
        toolUse('get_cart', {})]);
    }
    const lines = results.findLast((r) => Array.isArray(r.lines))?.lines || [];
    const updated = new Set(used.filter((u) => u.name === 'update_item').map((u) => u.input.ref));
    const open = lines.find((l) => !l.product && NEEDS[l.term] && !updated.has(l.ref));
    if (open) {
      const need = NEEDS[open.term];
      return message('tool_use', [toolUse('update_item', { ref: open.ref, productId: need.productId, packs: null, amount: need.amount, unit: need.unit, term: null })]);
    }
    if (!used.some((u) => u.name === 'send_cart_link') && results.at(-1)?.checklist?.ready) return message('tool_use', [toolUse('send_cart_link', {})]);
    const linked = results.some((r) => r.ok === true && r.draftId);
    return message('end_turn', [{ type: 'text', text: `Selvä, ${who}. Korissa: ${lines.map((l) => l.term).join(', ') || 'ei vielä mitään'}.${linked ? ' Ostoskori aukeaa tästä.' : ''}` }]);
  } } } };
  return { client, turns, overlaps, peak: () => peak };
}

/**
 * Yksi palvelininstanssi kuten Vercelissä: oma WhatsApp-kanta-, luonnos- ja transkriptiyhteys samoihin tiedostoihin, oma silta,
 * agentti, korilinkki ja kanava. track(phone, +1/-1) kirjaa käynnissä olevat vuorot kaikkien instanssien yli, ja outbox on
 * Metalle lähteneet viestit aikajärjestyksessä (yhteinen, kun instansseja on useampi).
 */
function instance(name, { waFile, draftFile, model, track, gather = { gatherMs: 80, maxGatherMs: 600 }, outbox = [] }) {
  const store = openWhatsAppStore(waFile);
  const drafts = openDraftStore(draftFile, () => T);
  const db = openSqlite(draftFile);
  const tools = orderingTools();
  const agentTools = createAgentTools({ store: drafts, orderingTools: tools, catalog, gatewayOrders: { list: () => [] }, now: () => T, readPage: false, db });
  const agent = createAgent({ tools: agentTools, db, client: model.client, now: () => T });
  const conversations = new Map(); // yhteyshenkilö → keskustelutunniste
  const bridge = createDemoOrderingChat({ store, phoneId: PHONE_ID, agentMode: 'v2', resolveBuyer: createDemoBuyerResolver({}),
    loadOrdering: async () => ({ store: drafts, tools,
      agent: { async respond(args) { conversations.set(args.customer.personName, args.conversationId); return agent.respond(args); }, prune() {}, close() {} },
      getShoppingList: ({ conversationId, customer }) => shoppingListView(drafts.active(conversationId), customer),
      prune() {}, close() { db.close(); drafts.close(); } }) });
  const cartLink = createCartLink({ store, ordering: bridge, baseUrl: BASE, secret: APP_SECRET });
  const sent = outbox; let processed = 0; let redos = 0;
  const channel = createWhatsAppChannel({ settings, store, ...gather, redo: redoWhenAgent(bridge), typing: async () => {},
    chat: async (args) => {
      track(args.member.phone, 1);
      processed += 1; if (/:r\d+$/.test(args.messageId)) redos += 1;
      try { return await cartLink.chat(args); } finally { track(args.member.phone, -1); }
    },
    send: async (to, text, replyTo) => { sent.push({ to, text, replyTo, by: name }); return `wamid.${crypto.randomUUID()}`; } });
  return { name, store, drafts, db, bridge, cartLink, channel, sent, conversations, processed: () => processed, redos: () => redos,
    async close() { await channel.stop(); await bridge.close(); store.close(); } };
}

/** Allekirjoitettu Meta-webhook kanavan oikealle reitille. */
async function webhook(app, phone, id, text) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID },
    messages: [{ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
  const req = Readable.from([Buffer.from(raw)]); req.method = 'POST'; req.url = '/webhooks/whatsapp';
  req.headers = { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` };
  const res = { writeHead(status) { this.status = status; }, end() {} };
  assert.equal(await app.channel.handle(req, res), true);
  assert.equal(res.status, 200);
}

/** Odottaa, että jonossa ei ole odottavaa eikä käsittelyssä olevaa viestiä. */
async function settled(store, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (store.db.prepare("SELECT count(*) n FROM inbox WHERE state IN ('pending','processing')").get().n) {
    if (Date.now() > until) throw new Error(`Jono ei tyhjentynyt: ${JSON.stringify(store.db.prepare('SELECT id,state,error FROM inbox').all())}`);
    await sleep(20);
  }
}

/** Käynnissä olevat vuorot numeroittain: sama numero ei koskaan kahdesti yhtä aikaa, ja eri numeroita rinnakkain. */
function tracker() {
  const active = new Map(); let peak = 0; const overlaps = [];
  return { peak: () => peak, overlaps,
    track(phone, delta) {
      const n = (active.get(phone) || 0) + delta;
      if (n > 1) overlaps.push(phone);
      if (n) active.set(phone, n); else active.delete(phone);
      peak = Math.max(peak, active.size);
    } };
}

function invite(store, { phone, company, person }) {
  const { code } = store.invite(phone, company, person);
  assert.ok(store.pair(phone, codeHash(code)));
  return store.member(phone);
}

const cartPayload = (text) => {
  const token = /\/whatsapp\/cart#([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{43}/.exec(text)?.[1];
  return token ? JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) : null;
};
const transcriptTexts = (db, conversation) => db.prepare("SELECT content FROM agent_transcript WHERE conversation=? AND role='user' ORDER BY seq").all(conversation)
  .flatMap((r) => JSON.parse(r.content)).map((b) => String(b.text ?? '')).filter((t) => t.startsWith(CUSTOMER_PREFIX)).map((t) => t.slice(t.indexOf(':\n') + 2));

/** Yhteiset tarkistukset: vastaukset, korit, luonnokset, transkriptit ja korilinkit kuuluvat vain omalle asiakkaalle. */
function assertIsolated({ apps, members }) {
  const sent = outboxOf(apps);
  const store = apps[0].store;
  const db = apps[0].db;
  const conversations = new Map(apps.flatMap((a) => [...a.conversations]));
  for (const c of CUSTOMERS) {
    const others = CUSTOMERS.filter((o) => o !== c);
    const mine = sent.filter((s) => s.to === c.phone);
    assert.ok(mine.length >= 1, `${c.person}: ei vastausta`);
    for (const s of mine) {
      assert.match(s.text, new RegExp(`${c.company}, yhteyshenkilö ${c.person}\\.`), `${c.person} sai vastauksen: ${s.text}`);
      for (const o of others) assert.doesNotMatch(s.text, new RegExp(`${o.person}|${o.company}|\\b${o.term}\\b`), `${c.person} sai toisen asiakkaan tietoja: ${s.text}`);
    }
    // Ei kadonneita eikä tuplattuja: jokainen viesti on käsitelty tai liitetty, ja jokaiseen käsiteltyyn vastataan kerran.
    const rows = store.db.prepare('SELECT id,state FROM inbox WHERE phone=? ORDER BY rowid').all(c.phone);
    assert.deepEqual(rows.map((r) => r.state).filter((s) => !['done', 'merged'].includes(s)), [], `${c.person}: ${JSON.stringify(rows)}`);
    const answered = rows.filter((r) => r.state === 'done').map((r) => r.id);
    // Vastaukset lähtivät samassa järjestyksessä kuin viestit tulivat, myös eri instansseista.
    assert.deepEqual([...new Set(mine.map((s) => s.replyTo))], answered, `${c.person}: vastaukset eivät vastaa käsiteltyjä viestejä järjestyksessä`);
    assert.equal(new Set(mine.map((s) => `${s.replyTo}\u0000${s.text}`)).size, mine.length, `${c.person}: sama vastaus lähti kahdesti`);
    // Agentti näki asiakkaan viestit kerran, lähetysjärjestyksessä, eikä yhtään toisen asiakkaan viestiä.
    const conversation = conversations.get(c.person);
    assert.ok(conversation, `${c.person}: agentti ei saanut vuoroa`);
    assert.deepEqual(transcriptTexts(db, conversation), c.say, `${c.person}: transkriptin asiakasviestit`);
    const rowsText = db.prepare('SELECT content FROM agent_transcript WHERE conversation=?').all(conversation).map((r) => r.content).join('\n');
    for (const o of others) assert.doesNotMatch(rowsText, new RegExp(`${o.person}|${o.company}`), `${c.person}: toisen asiakkaan tietoja transkriptissa`);
    // Luonnos: vain oma tuote ja määrä, toimituspäivä ja ruokavalio kirjattu.
    const draft = apps[0].drafts.active(conversation);
    assert.equal(draft.bindingVersion, members.get(c.phone).binding);
    assert.deepEqual(draft.lines.map((l) => [l.productTerm, l.selectedProductId]), [[c.term, NEEDS[c.term].productId]], `${c.person}: luonnoksen rivit`);
    assert.equal(draft.deliveryDate, FRIDAY);
    // Viimeisessä vastauksessa korilinkki tämän numeron sidokseen ja tähän luonnokseen.
    const link = cartPayload(mine.at(-1).text);
    assert.ok(link, `${c.person}: viimeisessä vastauksessa ei korilinkkiä: ${mine.at(-1).text}`);
    assert.equal(link.binding, members.get(c.phone).binding);
    assert.equal(link.draft, draft.id);
  }
  // Luonnokset ja keskustelut ovat eri asiakkaiden välillä erillisiä.
  assert.equal(new Set(conversations.values()).size, CUSTOMERS.length);
  assert.equal(new Set(CUSTOMERS.map((c) => apps[0].drafts.active(conversations.get(c.person)).id)).size, CUSTOMERS.length);
}

/** Jokainen asiakas kirjoittaa viestinsä peräkkäin tauoin (gap ms), ja kaikki asiakkaat yhtä aikaa. route valitsee instanssin,
 *  ja delivered(app) ajetaan jokaisen webhookin jälkeen (pilvessä drain). */
const typeAll = (route, { gap = [2, 12], delivered = () => {} } = {}) => Promise.all(CUSTOMERS.map(async (c, ci) => {
  for (const [i, text] of c.say.entries()) {
    await sleep(gap[0] + Math.floor(Math.random() * (gap[1] - gap[0])));
    const app = route(ci, i);
    await webhook(app, c.phone, `wamid.${c.phone}.${i}`, text);
    delivered(app);
  }
}));

test('viisi numeroa yhtä aikaa: jokainen saa vain omat vastauksensa, korinsa ja korilinkkinsä', async (t) => {
  // Rinnakkaisten asiakkaiden määrä tulee WHATSAPP_CONCURRENCY-asetuksesta (oletus 4, demossa 8).
  const model = kitchenModel(); const live = tracker();
  const app = instance('A', { waFile: path.join(dir, 'one-wa.db'), draftFile: path.join(dir, 'one-drafts.db'), model, track: live.track });
  t.after(() => app.close());
  const members = new Map(CUSTOMERS.map((c) => [c.phone, invite(app.store, c)]));
  app.channel.start();
  await typeAll(() => app);
  await settled(app.store);
  assertIsolated({ apps: [app], members });
  assert.deepEqual(live.overlaps, [], 'saman numeron kaksi vuoroa yhtä aikaa');
  assert.deepEqual(model.overlaps, [], 'saman asiakkaan kaksi agentin vuoroa yhtä aikaa');
  assert.ok(live.peak() >= 2, `eri numerot käsiteltiin rinnakkain (huippu ${live.peak()})`);
  assert.ok(live.peak() <= workerCount(), `enintään ${workerCount()} yhtä aikaa (huippu ${live.peak()})`);
  assert.ok(model.peak() >= 2, `eri asiakkaiden mallikutsut kulkivat rinnakkain (huippu ${model.peak()})`);
  t.diagnostic(summary([app], model, live));
});

/** Metalle lähteneet viestit aikajärjestyksessä: instanssien yhteinen lista otetaan kerran. */
const outboxOf = (apps) => [...new Set(apps.map((a) => a.sent))].flat();

/** Ajon luvut testin tulosteeseen: rinnakkaisuuden huippu, chat-kutsut, agentin vuorot ja vastaukset numeroittain. */
function summary(apps, model, live) {
  const rows = apps[0].store.db.prepare("SELECT state, count(*) n FROM inbox WHERE kind='text' GROUP BY state").all().map((r) => `${r.state} ${r.n}`).join(', ');
  return `huippu ${live.peak()} numeroa ja ${model.peak()} mallikutsua yhtä aikaa; chat-kutsuja ${apps.map((a) => `${a.name} ${a.processed()}`).join(', ')} (uusintoja ${apps.reduce((n, a) => n + a.redos(), 0)}); agentin vuoroja ${model.turns.length}; `
    + `viestit: ${rows}; vastauksia ${outboxOf(apps).length}`;
}

test('viestit harvemmin: vuorot jakautuvat ja uusinnat lomittuvat, eikä mikään viesti katoa tai tuplaannu', async (t) => {
  // Lyhyt niputus ja 30–90 ms tauot: osa viesteistä tulee mallikutsun aikana (uusinta) ja osa vastauksen jälkeen (oma vuoro).
  const model = kitchenModel(); const live = tracker();
  const app = instance('A', { waFile: path.join(dir, 'split-wa.db'), draftFile: path.join(dir, 'split-drafts.db'), model, track: live.track,
    gather: { gatherMs: 10, maxGatherMs: 40 } });
  t.after(() => app.close());
  const members = new Map(CUSTOMERS.map((c) => [c.phone, invite(app.store, c)]));
  app.channel.start();
  await typeAll(() => app, { gap: [30, 90] });
  await settled(app.store);
  assertIsolated({ apps: [app], members });
  assert.deepEqual(live.overlaps, [], 'saman numeron kaksi vuoroa yhtä aikaa');
  assert.deepEqual(model.overlaps, [], 'saman asiakkaan kaksi agentin vuoroa yhtä aikaa');
  assert.ok(model.turns.length > CUSTOMERS.length, `vuorot jakautuivat (${model.turns.length})`);
  t.diagnostic(summary([app], model, live));
});

test('kaksi pilvi-instanssia samoilla kannoilla: webhookit kumpaankin, saman numeron viestit eivät käsittele rinnakkain', async (t) => {
  // Kuten Vercel: kumpikin instanssi ajaa drainin oman webhookinsa jälkeen (server/cloud.mjs), ja saman numeron viestit
  // menevät vuorotellen eri instanssiin. Yhteinen seuranta kattaa molemmat.
  const model = kitchenModel(); const live = tracker();
  const files = { waFile: path.join(dir, 'cloud-wa.db'), draftFile: path.join(dir, 'cloud-drafts.db') }; const outbox = [];
  const a = instance('A', { ...files, model, track: live.track, gather: { gatherMs: 10, maxGatherMs: 40 }, outbox });
  const b = instance('B', { ...files, model, track: live.track, gather: { gatherMs: 10, maxGatherMs: 40 }, outbox });
  t.after(async () => { await a.close(); await b.close(); });
  const members = new Map(CUSTOMERS.map((c) => [c.phone, invite(a.store, c)]));
  const drains = [];
  await typeAll((ci, i) => ((ci + i) % 2 ? b : a), { gap: [5, 60], delivered: (app) => drains.push(app.channel.drain(20_000)) });
  await Promise.all(drains);
  await settled(a.store);
  assertIsolated({ apps: [a, b], members });
  assert.deepEqual(live.overlaps, [], 'saman numeron kaksi vuoroa yhtä aikaa eri instansseissa');
  assert.deepEqual(model.overlaps, [], 'saman asiakkaan kaksi agentin vuoroa yhtä aikaa eri instansseissa');
  t.diagnostic(summary([a, b], model, live));
});

test('jonon varaus kahdella kantayhteydellä: saman numeron seuraava viesti odottaa, toinen numero etenee', () => {
  // Atominen varaus (store.next, NOT EXISTS prior): kaksi instanssia eivät saa saman numeron viestejä yhtä aikaa.
  const file = path.join(dir, 'queue.db');
  const a = openWhatsAppStore(file); const b = openWhatsAppStore(file);
  try {
    const at = Date.now();
    a.enqueue({ id: 'p1', phone: '358401000001', text: 'eka', sentAt: at });
    b.enqueue({ id: 'p2', phone: '358401000001', text: 'toka', sentAt: at });
    a.enqueue({ id: 'q1', phone: '358401000002', text: 'muu numero', sentAt: at });
    assert.equal(a.next().id, 'p1');
    assert.equal(b.next().id, 'q1');
    assert.equal(b.next(), null, 'p2 odottaa, kun p1 on käsittelyssä toisessa instanssissa');
    assert.equal(a.next(), null);
    a.finish('p1', 'done');
    assert.equal(b.next().id, 'p2');
    assert.equal(a.next(), null);
  } finally { a.close(); b.close(); }
});

test('uusi kutsuttu jäsen: kutsu, YHDISTA-koodi ja ensimmäinen viesti, ja agentti saa kutsun nimen', async (t) => {
  const model = kitchenModel(); const live = tracker();
  const app = instance('A', { waFile: path.join(dir, 'new-wa.db'), draftFile: path.join(dir, 'new-drafts.db'), model, track: live.track });
  t.after(() => app.close());
  const phone = '358401000009';
  const { code } = app.store.invite(phone, 'Ravintola Uusi', 'Ulla');
  app.channel.start();
  await webhook(app, phone, 'wamid.new.0', `YHDISTA ${code}`);
  await settled(app.store);
  assert.match(app.sent.at(-1).text, /^Testiyhteys yhdistetty: Ulla, Ravintola Uusi\./);
  assert.equal(app.store.member(phone).person, 'Ulla');
  await webhook(app, phone, 'wamid.new.1', 'moi, tarviin 10 kg sipulia perjantaiks, ei allergioita');
  await settled(app.store);
  assert.deepEqual(model.turns.map((m) => m.who), ['Ravintola Uusi, yhteyshenkilö Ulla']);
  const reply = app.sent.at(-1);
  assert.equal(reply.to, phone);
  assert.match(reply.text, /^Selvä, Ravintola Uusi, yhteyshenkilö Ulla\. Korissa: sipuli\./);
  assert.equal(cartPayload(reply.text)?.binding, app.store.member(phone).binding);
  // Koodi kelpaa vain kerran.
  await webhook(app, phone, 'wamid.new.2', `YHDISTA ${code}`);
  await settled(app.store);
  assert.match(app.sent.at(-1).text, /virheellinen, käytetty tai vanhentunut/);
});
