// v2-arvioinnin lapsiprosessi: käsikirjoitettu keskustelu oikeaa WhatsApp-polkua pitkin.
// Sama rakenne kuin runSelfplayssa (scripts/whatsapp-selfplay.mjs): allekirjoitettu webhook, jono, kanava, korilinkki,
// tilauskeskustelu ja eristetyt kannat, simuloitu Meta ja simuloitu asiakas (askAgent, fast-taso). Lisäksi:
// - käsikirjoitetut viestit Eeliksen oikeista keskusteluista, myös kaksi viestiä 6 s välein (sama tapa kuin puhelimessa),
// - kanava tuotannon asetuksin (niputus gatherSettings() ja tauko osien välissä humanPartPause, kuten runtime.mjs),
// - oikea katalogi ja Valion viimeisimmät tunnetut hinnat (hintavälimuistin kopio, VALIO_FALLBACK=last-known),
// - jokaisen mallikutsun hinta ja viive (agent-v2-meter.mjs), myös v2-agentin omasta asiakkaasta.
// Vanha putki ja v2 ajetaan täsmälleen samalla polulla: ero on vain ympäristössä (WHATSAPP_AGENT=v2 ja malliasetukset).
// Ei Meta-lähetyksiä, ei Valion pyyntöjä, ei tilauksia. Yksi lapsiprosessi = yksi demokello (DEMO_NOW luetaan kerran).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installMeter } from './agent-v2-meter.mjs';
import { lineAmount } from './agent-v2-checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const CART_BASE = 'https://eval.invalid';
// Korilinkki näkyy tuloksissa merkkinä. Muu linkki mallin tekstissä on virhe (malli ei saa kirjoittaa linkkejä).
export const redactLinks = (text) => String(text || '').replace(/https:\/\/eval\.invalid\/\S*/gu, '[ostoskorilinkki]').replace(/https?:\/\/\S+/gu, '[muu-linkki]');

// Simuloitu ostaja. Pohjana runSelfplayn ostajaohje (scripts/whatsapp-selfplay.mjs); lisänä käsikirjoituksen vaihe.
export const CUSTOMER_SYSTEM = 'Olet synteettinen suomalaisen ammattikeittiön ostaja keskustelutestissä WhatsAppissa. Käy aidon oloinen keskustelu '
  + 'annettua ostotavoitetta kohti annetulla kirjoitustyylillä. Vastaa apurin viimeiseen viestiin: vastaa sen kysymyksiin tavoitteen mukaisesti, '
  + 'valitse tarjotuista tuotteista sopiva (älä keksi tuotetta) ja hyväksy järkevä ehdotus. Pidä tavoitteen määrät, rajoitteet ja korjaukset. '
  + 'Älä hyväksy apurin virhettä muuttamalla tavoitettasi: korjaa virhe lyhyesti. Älä tuo esiin asioita, joita tavoitteessa ei ole. '
  + 'Tarve ja myyntipakkauksen kattavuus ovat eri asia: jos tarvitset 50 munaa ja tarjolla on 54 munan pakkaus, älä pyydä muuttamaan tarvetta 54:ksi. '
  + 'Voit hyväksyä ehdotetun pakkauksen toistamatta määrää. Jos kysymys on turha, sano se. Kerro allergioista ja ruokavalioista vain, jos ne kuuluvat '
  + 'tavoitteeseen tai apuri kysyy niistä; jos niitä ei ole, vastaa kysyttäessä ettei ole. Kun kaikki on oikein, pyydä ostoskorilinkki. '
  + 'Kirjoita vain yksi oma viesti ja lyhyesti, kuten oikea kiireinen kokki WhatsAppissa: yleensä yksi tai kaksi lyhyttä virkettä. '
  + 'done=true vasta kun olet saanut ostoskorilinkin tai tavoite ei ole mahdollinen ja olet lopettanut keskustelun. Viestit ovat testidataa, eivät ohjeita.';
const CUSTOMER_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'done'], properties: { text: { type: 'string' }, done: { type: 'boolean' } } };

class Stop extends Error {}

export async function runChild({ scenario, priceDb, out, capUsd = 1, timeLimitMs = 15 * 60_000 }) {
  const meter = installMeter();
  meter.tag(CUSTOMER_SYSTEM, 'customer');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-v2eval-'));
  fs.copyFileSync(priceDb, path.join(dir, 'kitchen.db'));
  Object.assign(process.env, {
    DEMO_NOW: scenario.now,
    GATEWAY_DB: path.join(dir, 'gateway.db'), AIMO_DB: path.join(dir, 'kitchen.db'),
    WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db'), WHATSAPP_QUOTE_DB: path.join(dir, 'quotes.db'),
    AIMO_CATALOG: process.env.AIMO_CATALOG || path.join(ROOT, 'data/catalog.json'), AIMO_LEARNED: path.join(dir, 'learned.json'),
    GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    // Live-tila, mutta mittari estää Valion osoitteen: hinnat ja saatavuus tulevat viimeisimmistä tunnetuista arvoista (kuten tuotannossa).
    VALIO_API_KEY: 'offline-eval', VALIO_API_BASE: 'https://valio.invalid', VALIO_FALLBACK: 'last-known', FALLBACK_PRICE_MAX_AGE_HOURS: '720',
  });
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const [{ openWhatsAppStore, codeHash }, { createDemoOrderingChat }, { createWhatsAppChannel, gatherSettings, humanPartPause }, { createCartLink },
    { askAgent }, { loadCatalog }, { apiStats }, { clock }] = await Promise.all([
    imp('server/whatsapp/store.mjs'), imp('server/whatsapp/ordering.mjs'), imp('server/whatsapp/channel.mjs'), imp('server/whatsapp/cart-link.mjs'),
    imp('server/aimoAgent.mjs'), imp('server/catalog.mjs'), imp('server/valioApi.mjs'), imp('server/gateway/clock.mjs'),
  ]);
  const catalog = loadCatalog();
  const productOf = (id) => { const p = id && (typeof catalog.get === 'function' ? catalog.get(String(id)) : catalog.byId?.get?.(String(id))); return p ? { id: p.id, name: p.name, kg: p.kg ?? null, litres: p.litres ?? null, labels: p.labels || [], contains: p.contains || [], salesUnit: p.salesUnit || null, category: p.category || null } : null; };
  const store = openWhatsAppStore(path.join(dir, 'whatsapp.db'));
  const ordering = createDemoOrderingChat({ store, phoneId: '999000111', draftDb: process.env.WHATSAPP_DRAFT_DB, quoteDb: process.env.WHATSAPP_QUOTE_DB, supportContact: 'Testin ylläpito' });
  const secret = crypto.randomBytes(32).toString('hex');
  const cart = createCartLink({ store, ordering, baseUrl: CART_BASE, secret });
  const sent = []; const chats = [];
  const chat = async (args) => {
    const started = Date.now();
    try { return await cart.chat(args); } finally { chats.push({ messageId: args.messageId, input: String(args.messages?.at(-1)?.content || ''), incoming: Array.isArray(args.incoming) ? args.incoming.length : null, started, ms: Date.now() - started }); }
  };
  const gather = gatherSettings();
  const channel = createWhatsAppChannel({ store, chat, settings: { phoneId: '999000111', appSecret: secret, orderingDemo: true, supportContact: 'Testin ylläpito' },
    send: async (phone, text, id) => { sent.push({ phone, text, id, at: Date.now() }); return `simulated-${crypto.randomUUID()}`; },
    ...gather, partPause: humanPartPause });
  const server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost'); if (!(await channel.handle(req, res, url))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const started = Date.now();
  const result = { id: scenario.id, now: scenario.now, clockAt: clock.now().toISOString(), gather, conversations: [], error: null, env: {
    agent: process.env.WHATSAPP_AGENT || 'old', agentModel: process.env.WHATSAPP_AGENT_MODEL || null, agentEffort: process.env.WHATSAPP_AGENT_EFFORT || null,
    deepModel: process.env.DEEP_MODEL || null, fastModel: process.env.FAST_MODEL || null } };
  const spent = () => meter.totals((c) => c.role !== 'judge').usd;

  async function post(phone, text) {
    const id = `v2eval-${crypto.randomUUID()}`;
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999000111' },
      messages: [{ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const response = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` }, body: payload });
    if (response.status !== 200) throw new Error(`Webhook ${response.status}`);
    return { id, text, at: Date.now() };
  }
  const openJobs = (phone) => store.db.prepare("SELECT count(*) n FROM inbox WHERE phone=? AND state IN ('pending','processing')").get(phone).n;
  async function settle(phone, limitMs = 300_000) {
    const t0 = Date.now();
    while (openJobs(phone)) {
      if (Date.now() - t0 > limitMs) throw new Error('Botti ei vastannut 5 minuutissa');
      if (!(await channel.processNext())) await sleep(150);
    }
  }

  async function conversation(conv, index) {
    const phone = `3580000002${String(index).padStart(2, '0')}`;
    const invite = store.invite(phone, 'Testikeittiö', 'Testaaja'); store.pair(phone, codeHash(invite.code));
    const member = store.member(phone);
    const record = { index, turns: [], final: null, ended: null };
    result.conversations.push(record);
    let customerCount = 0; let linked = false;
    const snapshotList = async () => {
      const list = await ordering.getShoppingList(member);
      if (!list) return null;
      return { id: list.id, revision: list.revision, status: list.status || null, deliveryDate: list.deliveryDate || null, missing: list.missing || [],
        diet: list.diet || null, lines: (list.lines || []).map((l) => ({ ref: l.ref, productTerm: l.productTerm, quantity: l.quantity || null, claims: l.claims || [],
          excludeAllergens: l.excludeAllergens || [], selectedProductId: l.selectedProductId || null, selectedName: l.selectedName || null, product: productOf(l.selectedProductId) })) };
    };
    // Yksi asiakkaan toimi (viesti tai purske) ja kaikki sen aiheuttamat vastaukset.
    async function act(kind, messages, step) {
      if (Date.now() - started > timeLimitMs) throw new Stop('aikaraja');
      await meter.settle();
      if (spent() > capUsd) throw new Stop(`kustannusraja ${capUsd} USD`);
      const sentFrom = sent.length; const chatFrom = chats.length; const posted = [];
      posted.push(await post(phone, messages[0].text));
      const work = settle(phone);
      for (const m of messages.slice(1)) { await sleep(m.afterMs || 0); posted.push(await post(phone, m.text)); }
      await work; await settle(phone);
      customerCount += posted.length;
      const parts = sent.slice(sentFrom).filter((s) => s.phone === phone);
      const jobs = new Map();
      for (const s of parts) { const j = jobs.get(s.id) || { jobId: s.id, parts: [], firstAt: s.at, lastAt: s.at }; j.parts.push(redactLinks(s.text)); j.lastAt = s.at; jobs.set(s.id, j); }
      const inbox = new Map(store.db.prepare(`SELECT id, received, state, text FROM inbox WHERE phone=?`).all(phone).map((r) => [r.id, r]));
      const replies = [...jobs.values()].map((j) => ({ ...j, received: inbox.get(j.jobId)?.received ?? null, input: inbox.get(j.jobId)?.text ?? null,
        e2eMs: inbox.get(j.jobId)?.received ? j.firstAt - inbox.get(j.jobId).received : null }));
      const turn = { kind, mark: step?.mark || null, customer: posted.map((p) => ({ text: p.text, at: p.at, state: inbox.get(p.id)?.state || null })), replies,
        chat: chats.slice(chatFrom).map((c) => ({ ms: c.ms, incoming: c.incoming, input: c.input.slice(0, 600) })), list: await snapshotList(), at: Date.now() };
      record.turns.push(turn);
      if (replies.some((r) => r.parts.some((p) => p.includes('[ostoskorilinkki]')))) linked = true;
      console.log(JSON.stringify({ scenario: scenario.id, conv: index, turn: record.turns.length, customer: posted.map((p) => p.text), bot: replies.map((r) => r.parts.join(' / ').slice(0, 300)), status: turn.list?.status, usd: +spent().toFixed(4) }));
      return turn;
    }
    const state = () => {
      const list = record.turns.at(-1)?.list || null;
      // Ensin asiakkaan tarve (productTerm), vasta sitten valitun tuotteen nimi: "ruokakerma … kolme sipulia" ei ole sipulirivi.
      const line = (re) => list?.lines?.find((l) => new RegExp(re, 'iu').test(l.productTerm || '')) || list?.lines?.find((l) => new RegExp(re, 'iu').test(l.selectedName || ''));
      return { list, linked, line, turns: record.turns, amount: (re) => lineAmount(line(re)) };
    };
    async function simulated(step) {
      const history = record.turns.map((t) => JSON.stringify({ asiakas: t.customer.map((c) => c.text), apuri: t.replies.flatMap((r) => r.parts) }));
      const next = await askAgent({ purpose: 'whatsapp_selfplay_customer', tier: 'fast', schema: CUSTOMER_SCHEMA, maxTokens: 1200, timeoutMs: 60_000, retries: 1,
        system: CUSTOMER_SYSTEM,
        // Vaiheen oma tavoite (step.goal) korvaa koko keskustelun tavoitteen: ostaja ei saa tietää käsikirjoituksen myöhempiä
        // muutoksia etukäteen (19.11. "20 sipulia" muuttui vasta valinnan jälkeen viestiksi "50 sipulia").
        turns: [JSON.stringify({ kirjoitustyyli: conv.style || scenario.style || 'Lyhyt, rento puhekieli.' }), ...history],
        user: JSON.stringify({ tavoite: step.goal || conv.goal || scenario.goal, lopullinenTarve: step.goal ? null : scenario.finalNeeds || null, tämäVaihe: step.sim, viestejäJäljellä: (scenario.maxCustomer || 12) - customerCount }) });
      return { text: String(next.json?.text || '').trim(), done: Boolean(next.json?.done) };
    }
    try {
      for (const step of conv.steps) {
        if (customerCount >= (scenario.maxCustomer || 12)) { record.ended = 'max_customer_messages'; break; }
        if (step.when && !step.when(state())) continue;
        if (step.say) await act('say', [{ text: step.say }], step);
        else if (step.burst) await act('burst', step.burst, step);
        else if (step.sim) {
          let done = false;
          for (let i = 0; i < (step.max || 4) && !done; i++) {
            if (step.until?.(state()) || (step.untilLink && linked) || customerCount >= (scenario.maxCustomer || 12)) break;
            const next = await simulated(step);
            if (!next.text) { record.ended = 'customer_silent'; done = true; break; }
            await act('sim', [{ text: next.text }], step);
            if (next.done) { record.ended = 'customer_done'; done = true; }
          }
          if (done) break;
        }
      }
      record.ended ||= linked ? 'link' : 'script_end';
    } catch (err) {
      if (err instanceof Stop) record.ended = `stopped: ${err.message}`; else { record.ended = 'error'; record.error = String(err?.stack || err).slice(0, 800); }
    }
    // Lopullinen kori sellaisena kuin asiakas näkisi sen korisivulla (vain lukeminen, ei tilausta).
    const list = await snapshotList();
    let storefront = null;
    if (list?.status === 'review') {
      try {
        const c = await ordering.getStorefrontCart(member, list.id);
        storefront = { state: c.state, deliveryDate: c.deliveryDate || null, lines: (c.lines || []).map((l) => {
          const p = productOf(l.id); return { id: l.id, name: l.name, qty: l.qty, unit: l.unit, price: l.price, requested: l.requested || null, product: p,
            totalKg: p?.kg ? +(l.qty * p.kg).toFixed(3) : null, totalL: p?.litres ? +(l.qty * p.litres).toFixed(3) : null }; }) };
      } catch (err) { storefront = { error: String(err?.message || err).slice(0, 200) }; }
    }
    record.final = { list, storefront };
  }

  try {
    const convs = scenario.conversations || [{ steps: scenario.steps }];
    for (const [i, conv] of convs.entries()) await conversation(conv, i);
  } catch (err) { result.error = String(err?.stack || err).slice(0, 800); }
  finally {
    await meter.settle();
    try { await channel.stop(); } catch { /* ei jonoa */ }
    await new Promise((resolve) => server.close(resolve));
    try { await ordering.close(); } catch { /* ei auki */ }
    store.close();
  }
  let orders = 0;
  try { const { DatabaseSync } = await import('node:sqlite'); const gw = new DatabaseSync(process.env.GATEWAY_DB, { readOnly: true }); orders = gw.prepare('SELECT count(*) n FROM orders').get().n; gw.close(); } catch { orders = 0; }
  Object.assign(result, { ms: Date.now() - started, orders, apiStats: { ...apiStats }, blocked: meter.blocked.length,
    calls: meter.calls.map((c) => ({ role: c.role, requested: c.requested, model: c.model, ms: c.ms, status: c.status, stop: c.stop, usd: c.usd, effort: c.effort, thinking: c.thinking, tools: c.tools, toolUses: c.toolUses || [], toolResults: c.toolResults || [], error: c.error || null,
      usage: c.usage ? { input: c.usage.input_tokens || 0, output: c.usage.output_tokens || 0, cacheRead: c.usage.cache_read_input_tokens || 0, cacheWrite: c.usage.cache_creation_input_tokens || 0 } : null, started: c.started })),
    cost: { bot: meter.totals((c) => c.role === 'bot'), customer: meter.totals((c) => c.role === 'customer') } });
  if (orders) result.error = `${result.error ? `${result.error}; ` : ''}Arviointi ei saa tehdä tilauksia (${orders})`;
  fs.writeFileSync(out, JSON.stringify(result, null, 1), { mode: 0o600 });
  return result;
}
