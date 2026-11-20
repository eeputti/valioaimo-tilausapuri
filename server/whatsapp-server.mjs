// Erillinen WhatsApp-palvelin (Mac). Tilausdemo käyttää omaa, eristettyä gateway-kantaa.
import http from 'node:http';
import { createConfiguredWhatsApp } from './whatsapp/runtime.mjs';
import { isLocal } from './whatsapp/web-demo.mjs';

const whatsapp = createConfiguredWhatsApp();
const orderingOn = () => process.env.WHATSAPP_ORDERING_ENABLED === 'true';

// Paikalliset tilaustyökalut ladataan vasta ensimmäisellä pyynnöllä. Ne käyttävät samaa gateway-yhteyttä, allekirjoittajaa
// ja kirjanpitoa. Upotettu tila jättää vanhan kaupan ja keittiön lataamatta, eikä tuonti käynnistä palvelinta tai työtä.
let localTools = null;
function openLocalTools() {
  process.env.AIMO_EMBEDDED_STOREFRONT = 'true';
  localTools ??= import('./index.mjs');
  return localTools;
}

// Virhe kirjataan lokiin, ja asiakas saa 500-vastauksen, jos otsakkeita ei ole vielä lähetetty.
function failWith(res, tag, error, message) {
  console.error(tag, error);
  if (res.headersSent) { res.end(); return; }
  res.writeHead(500, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

async function route(req, res, url) {
  if (await whatsapp.handle(req, res, url)) return;
  if (req.method === 'GET' && url.pathname === '/healthz') {
    const mode = orderingOn() ? 'ordering-demo' : 'read-only-test';
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, channel: 'whatsapp', mode }));
    return;
  }
  if (orderingOn() && isLocal(req)) {
    try {
      const tools = await openLocalTools();
      await tools.handleStorefrontRequest(req, res);
    } catch (error) {
      failWith(res, '[local-orders]', error, 'Paikallisten tilaustyökalujen avaaminen epäonnistui.');
    }
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

// Jokainen pyyntö päättyy vastaukseen: heittävä async-käsittelijä olisi käsittelemätön hylkäys, joka pysäyttää koko
// prosessin. Jäsentymätön kohde saa 400:n ja muu virhe 500:n.
async function onRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  try {
    await route(req, res, url);
  } catch (error) {
    failWith(res, '[whatsapp-http]', error, 'Palvelinvirhe');
  }
}

const server = http.createServer(onRequest);
const port = Number(process.env.WHATSAPP_PORT || process.env.PORT || 4748);
server.listen(port, () => {
  whatsapp.start();
  const { port: bound } = server.address();
  console.log(`WhatsApp test → http://localhost:${bound}/webhooks/whatsapp`);
});

// Sammutus kerran, vaikka sekä SIGINT että SIGTERM tulisivat.
let stopping = null;
function stopServer() {
  stopping ??= (async () => {
    server.close();
    await whatsapp.close();
    server.closeAllConnections();
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stopServer);
