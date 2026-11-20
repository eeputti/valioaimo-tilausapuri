// Local development entry point for WhatsApp, its signed cart and the shared order gateway.
import http from 'node:http';
import fs from 'node:fs';
import { config } from './config.mjs';
import { loadCatalog } from './catalog.mjs';
import { handleGateway, bootGateway } from './gateway/http.mjs';
import { buyers } from './gateway/store.mjs';
import { createLocalShop } from './local-shop.mjs';
import { createConfiguredWhatsApp, whatsappDbPath } from './whatsapp/runtime.mjs';
import { isLocal } from './whatsapp/web-demo.mjs';

const embedded = process.env.AIMO_EMBEDDED_STOREFRONT === 'true';
const localShop = embedded ? createLocalShop({ whatsappDb: whatsappDbPath(), defaultPhone: process.env.WHATSAPP_DEMO_PHONE, buyers: () => buyers.all() }) : null;
const whatsapp = !embedded && process.env.WHATSAPP_ENABLED === 'true' ? createConfiguredWhatsApp() : null;
const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

// The export name and embedded flag remain compatible with existing WhatsApp deployments.
export async function handleStorefrontRequest(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('Bad request'); return; }
  try {
    if (whatsapp && await whatsapp.handle(req, res, url)) return;
    if (localShop?.handle(req, res, url)) return;
    let sameOrigin = req.headers['sec-fetch-site'] !== 'cross-site';
    try { if (req.headers.origin) sameOrigin &&= new URL(req.headers.origin).origin === `http://${req.headers.host}`; } catch { sameOrigin = false; }
    if (!isLocal(req) || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'] || !sameOrigin) {
      res.writeHead(404); res.end('Not found'); return;
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, channel: 'gateway' });
    // Reset and scenario actions belonged to the retired demos. Never clear orders from this app.
    if (['/console/reset', '/console/demo', '/api/reset'].includes(url.pathname)) return json(res, 403, { error: 'Tilauksia ei voi nollata tästä palvelimesta.' });
    if (await handleGateway(req, res, url)) return;
    const page = ['/', '/index.html'].includes(url.pathname) ? 'index.html' : ['/approve.html', '/approve.js'].includes(url.pathname) ? url.pathname.slice(1) : null;
    if (['GET', 'HEAD'].includes(req.method) && page) {
      res.writeHead(200, { 'content-type': `${page.endsWith('.js') ? 'text/javascript' : 'text/html'}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(new URL(`../public/${page}`, import.meta.url)));
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (error) {
    console.error('[app]', error);
    if (!res.headersSent) json(res, 500, { error: 'Palvelupyyntö epäonnistui.' }); else res.end();
  }
}

if (!embedded) {
  // Startup never seeds kitchen data, starts background planning or resets an existing database.
  const catalog = loadCatalog();
  bootGateway();
  const server = http.createServer(handleStorefrontRequest);
  server.listen(config.port, '127.0.0.1', () => {
    whatsapp?.start();
    console.log(`WhatsApp + ostoskori: ${catalog.products.length} tuotetta\n→ http://localhost:${server.address().port}`);
  });
  async function shutdown() {
    server.close(); await whatsapp?.close(); server.closeAllConnections();
  }
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
