// Pilviversio (Vercel): sama WhatsApp-palvelin ilman jatkuvasti käynnissä olevaa prosessia.
// - Webhook kuitataan heti, ja jono käsitellään samassa kutsussa vastauksen jälkeen (waitUntil).
// - Ajastettu /internal/tick (Cloudflaren cron kerran minuutissa) palauttaa keskeytyneet käsittelyt, uusii
//   epäonnistuneet lähetykset, välittää vahvistetut tilaukset tilausnäkymään.
// Kannat ovat Tursossa (server/sqlite.mjs), joten mikä tahansa instanssi näkee saman jonon, korit ja tilaukset.
import crypto from 'node:crypto';
import '@libsql/client/web'; // Varmistaa, että Vercel paketoi Turso-säikeen tarvitseman kirjaston.
import { createConfiguredWhatsApp } from './whatsapp/runtime.mjs';

const DRAIN_MS = 240_000;
// Vercel katkaisee kutsun 300 s kohdalla (vercel.json maxDuration). Uutta työtä ei oteta eikä uusintaa aloiteta, kun drainin
// aikaa on alle 90 s: v2-vuoro voi kestää yli minuutin, ja katkaistu työ odottaisi 6 minuutin käsittelyvarauksen
// (katselmus 19.11.). Yksittäisen vuoron ylärajan pitää v2-agentti.
const TURN_RESERVE_MS = 90_000;
// Vain koneen sisäiset reitit. Sovellus estää ne myös itse, koska pilven pyynnöt eivät tule localhostista.
const INTERNAL = /^\/(demo|mcp|v1|console|api\/assistant)(\/|$)|^\/(openapi\.json|approve\.html|\.well-known\/agent)/;

let app;
// Vahvistettu tilaus maksusivulle jo ennen korisivun vastausta: maksusivu löytää sen ensimmäisellä haulla eikä odota.
const load = () => (app ||= createConfiguredWhatsApp({ onCheckout: () => step('order-event', pushEvents) }));

/** Käsittelee jonon rinnakkain (channel.drain, sama poolin koko kuin Macilla), kunnes se on tyhjä tai aikaa on käytetty.
 *  Saman numeron viestit kulkevat järjestyksessä; saman instanssin useampi drain jakaa paikat. */
export async function drain(budgetMs = DRAIN_MS) {
  return load().drain(budgetMs, { reserveMs: TURN_RESERVE_MS });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const publisherReady = (env = process.env) => !!(env.CLOUDFLARE_DEMO_URL && env.CLOUDFLARE_DEMO_SYNC_TOKEN && env.WHATSAPP_DEMO_PHONE);

/** Uudet vahvistetut tilaukset maksusivulle (Workerin /api/order-events). Maksusivu odottaa vain tätä, ei tilannekuvaa. */
export async function pushEvents() {
  const env = process.env;
  if (!publisherReady(env)) return null;
  const [{ readSnapshot, pushOrderEvents }, { kv }] = await Promise.all([import('../deploy/cloudflare/publish-orders.mjs'), import('./db.mjs')]);
  const url = env.CLOUDFLARE_DEMO_URL, token = env.CLOUDFLARE_DEMO_SYNC_TOKEN;
  const snapshot = readSnapshot({ gatewayFile: env.GATEWAY_DB, whatsappFile: env.WHATSAPP_DB, phone: env.WHATSAPP_DEMO_PHONE,
    includeWebChat: true }); // Kuten Macin julkaisija (--include-web-chat): Workers-sivuston selainkeskustelujen tilaukset.
  const known = new Set(kv.get('cloud:order-events', []));
  const events = await pushOrderEvents({ url, token, snapshot, known });
  kv.set('cloud:order-events', [...known]);
  return { snapshot, events };
}

/** Vahvistetut tilaukset tilausnäkymään ja maksusivulle. Worker käsittelee samat tilaukset vain kerran. */
export async function publishOrders() {
  const env = process.env;
  if (!publisherReady(env)) return null;
  const [{ publishOnce, pushAgentTraces }, { readAgentTrace }, { kv }] = await Promise.all([
    import('../deploy/cloudflare/publish-orders.mjs'), import('../deploy/cloudflare/trace-reader.mjs'), import('./db.mjs')]);
  const url = env.CLOUDFLARE_DEMO_URL, token = env.CLOUDFLARE_DEMO_SYNC_TOKEN;
  // Tilaustapahtumat ensin: maksusivu odottaa niitä, tilausnäkymän tilannekuva ja agentin jäljet voivat tulla perässä.
  const { snapshot, events } = await pushEvents();
  await publishOnce({ url, token, snapshot });
  const traced = new Set(kv.get('cloud:agent-traces', []));
  const read = (orderId) => readAgentTrace({ orderId, gatewayFile: env.GATEWAY_DB, whatsappFile: env.WHATSAPP_DB,
    draftFile: env.WHATSAPP_DRAFT_DB, ledgerHead: snapshot.ledgerHead });
  const traces = await pushAgentTraces({ url, token, snapshot, known: traced, read });
  kv.set('cloud:agent-traces', [...traced]);
  return { orders: snapshot.orders.length, events: events.length, traces: traces.length };
}

async function step(name, work) {
  try { return await work(); }
  catch (err) { console.error(JSON.stringify({ event: 'tick_failed', step: name, error: String(err.message || err).slice(0, 200) })); return { error: true }; }
}

export async function tick() {
  const channel = load();
  const recovered = channel.store.recoverStale();
  const processed = await drain(120_000);
  const published = await step('publish', publishOrders);
  if (new Date().getUTCMinutes() % 15 === 0) await step('prune', () => channel.prune());
  return { recovered, processed, published };
}

/** Vercel-funktion käsittelijä. waitUntil pitää kutsun elossa vastauksen jälkeen. */
export async function handle(req, res, { waitUntil }) {
  const url = new URL(req.url, 'https://aimo.invalid');
  if (url.pathname === '/internal/tick') {
    const secret = process.env.TICK_SECRET || '';
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (req.method !== 'POST' || secret.length < 32 || !same(given, secret)) return json(res, 404, { error: 'Not found' });
    return json(res, 200, await tick());
  }
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return json(res, 200, { ok: true, channel: 'whatsapp', mode: process.env.WHATSAPP_ORDERING_ENABLED === 'true' ? 'ordering-demo' : 'read-only-test', host: 'cloud' });
  }
  if (INTERNAL.test(url.pathname)) return json(res, 404, { error: 'Not found' });
  const channel = load();
  if (await channel.handle(req, res, url)) {
    // Kirjoittaa-ilmaisin lähtee ensin ja jono käsitellään vasta sen jälkeen (channel.typingSettled).
    if (req.method === 'POST' && url.pathname === '/webhooks/whatsapp') waitUntil(channel.typingSettled().then(() => drain()).catch((err) => console.error('[drain]', err.message)));
    // Korisivun vahvistus: tilaus heti tilausnäkymään, jotta maksusivu löytää sen. Vain kun tilaus syntyi (cart-link.mjs
    // merkitsee vastauksen): yhteenvedon jälkeinen julkaisu oli turha ja hidasti saman instanssin seuraavaa vahvistusta.
    if (req.method === 'POST' && url.pathname.startsWith('/whatsapp/cart/api') && res.orderPlaced) waitUntil(step('publish', publishOrders));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}
