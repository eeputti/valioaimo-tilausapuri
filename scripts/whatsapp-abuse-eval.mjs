// Väärinkäyttökeskustelut oikealla kielimallilla: oikea allekirjoitettu webhook, jono, dialogi, tilausmoottori,
// tuotetyökalut ja korilinkin API. Eristetyt väliaikaiset kannat ja avaimet, simuloitu Meta-lähetys, tyhjä
// VALIO_API_KEY (simuloidut hinnat), ei käyttäjän kantoja. Ajetaan vain käsin: node --env-file=.env scripts/whatsapp-abuse-eval.mjs
// Valinnaiset: --cases a,b  --max-calls 150  --out /tmp/raportti.json. Tapaukset ja tarkistukset: eval/whatsapp-abuse-cases.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ABUSE_CASES, inspectAbuse } from '../eval/whatsapp-abuse-cases.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const option = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const safeText = (text) => String(text || '').replace(/https:\/\/abuse\.invalid\/whatsapp\/cart#[^\s]+/gu, '[ostoskorilinkki]');

export async function runAbuseEval({ cases = ABUSE_CASES, maxModelCalls = 150, out = null } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Tarvitaan mallin avain (node --env-file=.env). Mallikoetta ei ajettu.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-abuse-'));
  Object.assign(process.env, { VALIO_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00',
    GATEWAY_DB: path.join(dir, 'gateway.db'), AIMO_DB: path.join(dir, 'kitchen.db'),
    WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db'), WHATSAPP_QUOTE_DB: path.join(dir, 'quotes.db'), AIMO_LEARNED: path.join(dir, 'learned.json'),
    AIMO_CATALOG: process.env.AIMO_CATALOG || path.join(ROOT, 'data/catalog.json'),
    GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  // Oikean palvelimen numerot, tunnukset ja kannat eivät kuulu kokeeseen.
  for (const name of ['WHATSAPP_DEMO_PHONE', 'WHATSAPP_DEMO_BUYER_ID', 'WHATSAPP_DB', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'CLOUDFLARE_DEMO_URL', 'WHATSAPP_PUBLIC_URL']) delete process.env[name];
  // Vain mallipalvelu saa verkkoyhteyden: Meta-lähetys on simuloitu eikä Valion rajapintaa kutsuta.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const target = new URL(typeof url === 'string' ? url : url.url);
    if (target.hostname === '127.0.0.1' || target.hostname.endsWith('anthropic.com')) return realFetch(url, init);
    return Promise.reject(new Error(`Estetty ulkoinen pyyntö: ${target.hostname}`));
  };
  const [{ openWhatsAppStore, codeHash }, { createDemoOrderingChat }, { createWhatsAppChannel }, { createCartLink }, { createShoppingListHandoff }, { agentStats }] = await Promise.all([
    import('../server/whatsapp/store.mjs'), import('../server/whatsapp/ordering.mjs'), import('../server/whatsapp/channel.mjs'),
    import('../server/whatsapp/cart-link.mjs'), import('../server/whatsapp/shopping-list.mjs'), import('../server/aimoAgent.mjs')]);
  const store = openWhatsAppStore(path.join(dir, 'whatsapp.db'));
  const ordering = createDemoOrderingChat({ store, phoneId: '999000222', draftDb: process.env.WHATSAPP_DRAFT_DB, quoteDb: process.env.WHATSAPP_QUOTE_DB });
  const secret = crypto.randomBytes(32).toString('hex');
  const cart = createCartLink({ store, ordering, baseUrl: 'https://abuse.invalid', secret });
  const sent = new Map();
  const channel = createWhatsAppChannel({ store, chat: cart.chat, settings: { phoneId: '999000222', appSecret: secret, orderingDemo: true, supportContact: 'Testin ylläpito' },
    send: async (_phone, text, id) => { sent.set(id, [...(sent.get(id) || []), text]); return `simulated-${crypto.randomUUID()}`; } });
  const handoff = createShoppingListHandoff({ store, ordering });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!(await channel.handle(req, res, url)) && !(await cart.handle(req, res, url)) && !(await handoff.handle(req, res, url))) { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const { DatabaseSync } = await import('node:sqlite');
  const orderCount = () => { try { const gw = new DatabaseSync(process.env.GATEWAY_DB, { readOnly: true }); try { return gw.prepare('SELECT count(*) n FROM orders').get().n; } finally { gw.close(); } } catch { return 0; } };
  const results = [];
  try {
    for (const [index, scenario] of cases.entries()) {
      if (agentStats.calls >= maxModelCalls) { results.push({ id: scenario.id, skipped: 'kutsubudjetti täynnä' }); continue; }
      const phone = `3580000002${String(index).padStart(2, '0')}`;
      const invite = store.invite(phone, `Väärinkäyttö ${scenario.id}`, 'Simuloitu ostaja'); store.pair(phone, codeHash(invite.code));
      const buyerId = `whatsapp-demo-${store.member(phone).binding}`;
      const before = orderCount(); const turns = []; const raw = []; let token = null;
      for (const step of [scenario.first, ...(scenario.script || [])]) {
        if (agentStats.calls >= maxModelCalls) break;
        const started = Date.now(); let reply;
        if (typeof step === 'object' && step.cart) {
          if (!token) { reply = '[ei korilinkkiä]'; turns.push({ user: step, assistant: reply }); continue; }
          const headers = { authorization: `Bearer ${token}` };
          const current = await (await fetch(`${base}/whatsapp/cart/api`, { headers })).json();
          const list = current.shoppingList;
          const response = await fetch(`${base}/whatsapp/cart/api/chat`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ text: step.cart, messageId: crypto.randomUUID(), expectedList: list ? { id: list.id, revision: list.revision } : null }) });
          const data = await response.json().catch(() => ({}));
          reply = `[${response.status}] ${data.text || data.error || ''}`;
        } else {
          const id = `abuse-${crypto.randomUUID()}`;
          const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999000222' },
            messages: [{ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: step } }] } }] }] });
          const response = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}` }, body: payload });
          if (response.status !== 200) throw new Error(`Webhook ${response.status}`);
          await channel.processNext();
          reply = (sent.get(id) || []).join('\n\n');
          const link = reply.match(/https:\/\/abuse\.invalid\/whatsapp\/cart#([\w.-]+)/u); if (link) token = link[1];
        }
        raw.push(reply);
        turns.push({ user: step, assistant: safeText(reply), ms: Date.now() - started });
        console.log(JSON.stringify({ case: scenario.id, user: step, assistant: safeText(reply) }));
      }
      const state = await (await fetch(`${base}/api/assistant/whatsapp-list?buyerId=${encodeURIComponent(buyerId)}`)).json();
      const failures = inspectAbuse(scenario, turns, { orders: orderCount() - before, list: state.shoppingList, rawAssistant: raw });
      results.push({ id: scenario.id, passed: !failures.length, failures, orders: orderCount() - before, turns });
      console.log(JSON.stringify({ case: scenario.id, failures }));
    }
  } finally {
    globalThis.fetch = realFetch;
    await channel.stop(); await new Promise((resolve) => server.close(resolve)); await ordering.close(); store.close();
  }
  const report = { created: new Date().toISOString(), mode: 'isolated-real-http-real-model-simulated-delivery-and-prices', dir,
    models: { calls: agentStats.calls, failed: agentStats.failed, byPurpose: agentStats.byPurpose }, results };
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, total: results.length, modelCalls: agentStats.calls, modelFailures: agentStats.failed, report: out }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selected = option('--cases')?.split(',');
  const report = await runAbuseEval({ cases: selected ? ABUSE_CASES.filter((c) => selected.includes(c.id)) : ABUSE_CASES,
    maxModelCalls: Number(option('--max-calls')) || 150, out: option('--out') });
  if (report.results.some((r) => r.passed === false)) process.exitCode = 1;
}
