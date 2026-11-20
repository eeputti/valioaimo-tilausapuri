// Read-only publisher. It never imports or starts the WhatsApp worker or gateway runtime.
import { openSqlite } from '../../server/sqlite.mjs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MAX_LINES, MAX_ORDERS, parseSnapshot } from './src/protocol.ts';
import { readAgentTrace } from './trace-reader.mjs';

const WEB_DEMO_PHONE = '358000000001';
const GENESIS = '0'.repeat(64);
// Selainkeskustelun testiasiakkaat (server/whatsapp/web-chat.mjs): synteettiset 3580000…-tunnisteet, ei oikeita numeroita.
const WEB_CHAT_PHONE = /^3580000\d{8}$/;
// Sama muoto kuin server/whatsapp/demo-buyer.mjs:n WHATSAPP_DEMO_BUYER_ID (julkaisija ei tuo WhatsApp-ajonaikaista koodia).
const BUYER_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/**
 * Julkaistavat tilaukset (#13): jokainen vahvistettu WhatsApp-tilaus saa "Siirry demomaksuun" -linkin
 * (server/whatsapp/checkout.mjs), ja maksusivu löytää tilauksen tästä julkisesta listasta. Siksi mukana ovat kaikkien
 * liittyneiden WhatsApp-jäsenten tilaukset ja WHATSAPP_DEMO_BUYER_ID:n kiinnitetyn ostajan WhatsApp-tilaukset.
 * onlyDemoPhone (CLI --only-demo-phone) palauttaa vanhan rajauksen: vain WHATSAPP_DEMO_PHONE.
 */
export function readSnapshot({ gatewayFile, whatsappFile, phone, includeBrowserDemo = false, includeWebChat = false, onlyDemoPhone = false,
  demoBuyerId = process.env.WHATSAPP_DEMO_BUYER_ID, now = Date.now() }) {
  if (!gatewayFile || !whatsappFile || !/^[1-9]\d{6,14}$/.test(String(phone || '').replace(/^\+/, ''))) throw new Error('WhatsApp-demon omat kantapolut ja testinumero vaaditaan.');
  const mappedBuyer = String(demoBuyerId || '').trim();
  if (mappedBuyer && !BUYER_ID.test(mappedBuyer)) throw new Error('WHATSAPP_DEMO_BUYER_ID ei ole kelvollinen ostajatunnus.');
  const members = openSqlite(whatsappFile, { readOnly: true });
  const channels = new Map();
  try {
    const selected = String(phone).replace(/^\+/, '');
    for (const member of members.prepare('SELECT phone,binding FROM members').all()) {
      const buyerId = `whatsapp-demo-${member.binding}`;
      if (member.phone === WEB_DEMO_PHONE) { if (includeBrowserDemo) channels.set(buyerId, { channel: 'browser-demo' }); continue; }
      if (WEB_CHAT_PHONE.test(member.phone)) { if (includeWebChat) channels.set(buyerId, { channel: 'browser-demo' }); continue; }
      if (member.phone === selected) channels.set(buyerId, { channel: 'whatsapp' });
      else if (!onlyDemoPhone) channels.set(buyerId, { channel: 'whatsapp' });
    }
    // Kiinnitetyn ostajan (esim. kahvila-aalto) muut kanavat (kauppa, MCP-agentit) eivät ole WhatsApp-tilauksia.
    if (mappedBuyer && !channels.has(mappedBuyer)) channels.set(mappedBuyer, { channel: 'whatsapp', whatsappOnly: true });
  } finally { members.close(); }
  const db = openSqlite(gatewayFile, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=3000; BEGIN');
    let head = GENESIS;
    for (const row of db.prepare('SELECT * FROM ledger ORDER BY seq').iterate()) {
      const input = `${head}|${row.ts}|${row.actor}|${row.type}|${row.buyer_id || ''}|${row.order_id || ''}|${row.quote_id || ''}|${row.payload}`;
      const expected = crypto.createHash('sha256').update(input).digest('hex');
      if (row.prev_hash !== head || row.hash !== expected) throw new Error('Tilauskannan päätösketjun tarkistus epäonnistui.');
      head = expected;
    }
    const orders = []; let totalOrders = 0;
    for (const row of db.prepare('SELECT buyer_id,json FROM orders ORDER BY created_at DESC,id DESC').iterate()) {
      const source = channels.get(row.buyer_id);
      if (!source) continue;
      const o = JSON.parse(row.json);
      if (source.whatsappOnly && !String(o.buyerReference || '').startsWith('whatsapp:')) continue;
      const { channel } = source;
      totalOrders++;
      if (orders.length >= MAX_ORDERS) continue;
      // An allowlist projection: names, phone numbers, references, tokens, conversation and mandates never leave this process.
      const lines = (o.lines || []).slice(0, MAX_LINES).map(l => ({ productId: String(l.productId), name: String(l.name || l.productId).slice(0, 180), quantity: l.quantity,
        unit: String(l.salesUnitLabel || l.salesUnit || 'kpl').slice(0, 24), net: l.lineNet }));
      orders.push({ orderId: o.orderId, channel, status: o.status, createdAt: o.createdAt, deliveryDate: o.deliveryDate || null,
        net: o.totals?.net ?? null, lineCount: (o.lines || []).length, lines });
    }
    db.exec('COMMIT');
    const snapshot = parseSnapshot({ version: 1, observedAt: now, totalOrders, ledgerHead: head, orders }, now);
    return snapshot;
  } finally { db.close(); }
}

export async function publishOnce({ url, token, snapshot, fetcher = fetch, allowLocal = false }) {
  const endpoint = new URL('/api/sync', url);
  if (endpoint.protocol !== 'https:' && !(allowLocal && endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) throw new Error('Julkaisu vaatii HTTPS-osoitteen.');
  if (!token || token.length < 32) throw new Error('Julkaisuavain puuttuu.');
  const body = JSON.stringify(snapshot);
  const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body });
  if (!response.ok) throw new Error(`Julkaisu epäonnistui (HTTP ${response.status}).`);
  const result = await response.json();
  if (result.ok !== true) throw new Error('Julkaisua ei vahvistettu.');
  return result;
}

// One key per order instance: a reset gateway may reuse an order id, but not with the same creation time (#24).
// A bare order id in `known` (older publisher state) still counts as sent.
export const orderEventKey = (order) => `${order.orderId}@${order.createdAt}`;
const seen = (known, order) => known.has(orderEventKey(order)) || known.has(order.orderId);
export const RETRY_BASE_MS = 5000, RETRY_MAX_MS = 5 * 60_000;

// Push each newly confirmed order once. The Worker deduplicates per order instance, so a restart or a
// lost response only repeats a harmless POST; `known` just avoids re-sending every 5 seconds.
// One failing order never stops the others or the rest of the cycle (#25): it is retried with backoff
// (`failures`, kept by the caller across cycles), and a permanent 4xx refusal is not retried.
// A wrong token (401/403) concerns every order, so it still stops the cycle.
export async function pushOrderEvents({ url, token, snapshot, known, fetcher = fetch, allowLocal = false, failures = new Map(), now = Date.now() }) {
  const endpoint = new URL('/api/order-events', url);
  if (endpoint.protocol !== 'https:' && !(allowLocal && endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) throw new Error('Julkaisu vaatii HTTPS-osoitteen.');
  if (!token || token.length < 32) throw new Error('Julkaisuavain puuttuu.');
  const results = [];
  const retryLater = (key, orderId, error) => {
    const attempts = (failures.get(key)?.attempts || 0) + 1;
    failures.set(key, { attempts, retryAt: now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1)) });
    results.push({ orderId, error, attempts });
  };
  for (const order of snapshot.orders) {
    const key = orderEventKey(order);
    if (order.status !== 'confirmed' || seen(known, order)) continue;
    if (now < (failures.get(key)?.retryAt ?? 0)) continue;
    let response;
    try {
      response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, observedAt: snapshot.observedAt, ledgerHead: snapshot.ledgerHead, order }) });
    } catch { retryLater(key, order.orderId, 'network'); continue; }
    if (response.status === 401 || response.status === 403) throw new Error(`Tilauksen välitys epäonnistui (HTTP ${response.status}).`);
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
        known.add(key); failures.delete(key);
        results.push({ orderId: order.orderId, error: `HTTP ${response.status}`, gaveUp: true });
      } else retryLater(key, order.orderId, `HTTP ${response.status}`);
      continue;
    }
    const result = await response.json().catch(() => null);
    if (result?.ok !== true) { retryLater(key, order.orderId, 'unconfirmed'); continue; }
    failures.delete(key);
    known.add(key);
    results.push({ orderId: order.orderId, duplicate: result.duplicate, ...(result.replaced ? { replaced: true } : {}) });
  }
  return results;
}

// "Katso, mitä agentti näki": push each published WhatsApp order's trace once. Opt-in (--agent-traces), because the
// trace carries the conversation text. A trace is read only after the order has settled, so the cart page's own
// confirmation turn is already stored. Orders whose conversation has been pruned are skipped.
export const TRACE_SETTLE_MS = 10_000;
export async function pushAgentTraces({ url, token, snapshot, known, read, fetcher = fetch, allowLocal = false, now = Date.now() }) {
  const endpoint = new URL('/api/agent-traces', url);
  if (endpoint.protocol !== 'https:' && !(allowLocal && endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) throw new Error('Julkaisu vaatii HTTPS-osoitteen.');
  if (!token || token.length < 32) throw new Error('Julkaisuavain puuttuu.');
  const results = [];
  for (const order of snapshot.orders) {
    if (seen(known, order) || now - Date.parse(order.createdAt) < TRACE_SETTLE_MS) continue;
    let trace;
    // One unreadable or refused trace must not stop the others (or the order publishing) on every cycle.
    try { trace = read(order.orderId); } catch { trace = undefined; }
    if (!trace) { known.add(orderEventKey(order)); results.push({ orderId: order.orderId, skipped: trace === null ? 'conversation_missing' : 'invalid' }); continue; }
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(trace) });
    if (!response.ok) throw new Error(`Agentin jäljen välitys epäonnistui (HTTP ${response.status}).`);
    const result = await response.json();
    if (result.ok !== true) throw new Error('Agentin jäljen välitystä ei vahvistettu.');
    known.add(orderEventKey(order));
    results.push({ orderId: order.orderId, turns: trace.turns.length, updated: result.updated });
  }
  return results;
}

async function main() {
  const env = process.env, watch = process.argv.includes('--watch');
  let stop = false, wake;
  const orderEvents = process.argv.includes('--order-events'), backfill = process.argv.includes('--order-events-backfill');
  // Without backfill, orders already confirmed when the publisher starts are not pushed again.
  let known = null;
  const failures = new Map(); // tilauskohtainen uudelleenyritys, ei koko kierroksen pysäytys
  const traces = process.argv.includes('--agent-traces'), traced = new Set();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop = true; wake?.(); });
  do {
    try {
      const snapshot = readSnapshot({ gatewayFile: env.GATEWAY_DB, whatsappFile: env.WHATSAPP_DB, phone: env.WHATSAPP_DEMO_PHONE,
        includeBrowserDemo: process.argv.includes('--include-browser-demo'), includeWebChat: process.argv.includes('--include-web-chat'),
        onlyDemoPhone: process.argv.includes('--only-demo-phone') });
      await publishOnce({ url: env.CLOUDFLARE_DEMO_URL, token: env.CLOUDFLARE_DEMO_SYNC_TOKEN, snapshot });
      console.log(JSON.stringify({ event: 'demo_published', orders: snapshot.orders.length, at: new Date().toISOString() }));
      if (orderEvents) {
        if (!known) known = new Set(backfill ? [] : snapshot.orders.filter(o => o.status === 'confirmed').map(orderEventKey));
        for (const r of await pushOrderEvents({ url: env.CLOUDFLARE_DEMO_URL, token: env.CLOUDFLARE_DEMO_SYNC_TOKEN, snapshot, known, failures }))
          (r.error ? console.error : console.log)(JSON.stringify({ event: r.error ? 'order_event_failed' : 'order_event_pushed', ...r }));
      }
      if (traces) {
        const read = (orderId) => readAgentTrace({ orderId, gatewayFile: env.GATEWAY_DB, whatsappFile: env.WHATSAPP_DB, draftFile: env.WHATSAPP_DRAFT_DB, ledgerHead: snapshot.ledgerHead });
        for (const r of await pushAgentTraces({ url: env.CLOUDFLARE_DEMO_URL, token: env.CLOUDFLARE_DEMO_SYNC_TOKEN, snapshot, known: traced, read }))
          console.log(JSON.stringify({ event: 'agent_trace_pushed', ...r }));
      }
    } catch (error) {
      // Do not log upstream responses, tokens, database paths, or customer records.
      console.error(JSON.stringify({ event: 'demo_publish_failed', error: error.message?.startsWith('Julkaisu') || error.message?.startsWith('Tilauskannan') || error.message?.startsWith('Tilauksen') || error.message?.startsWith('Agentin') ? error.message : 'Tarkista julkaisun asetukset ja kannat.' }));
      if (!watch) { process.exitCode = 1; return; }
    }
    if (watch && !stop) await new Promise(resolve => { const timer = setTimeout(resolve, 5000); wake = () => { clearTimeout(timer); resolve(); }; });
  } while (watch && !stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
