// Ajaa server/cloud.mjs:n (Vercelin käsittelijän) HTTP-palvelimena test/cloud-handler.test.mjs:ää varten.
// Metan kutsut kirjataan ja kuitataan, muu ulkoinen verkko estetään. Taustatyö odotetaan /__test/settle-reitillä.
import http from 'node:http';

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname === 'graph.facebook.com') {
    sent.push({ path: url.pathname, body: options.body ? JSON.parse(options.body) : null });
    return new Response(JSON.stringify({ success: true, messages: [{ id: `wamid.test.${sent.length}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) return realFetch(input, options);
  throw new Error(`Ulkoinen verkko estetty testissä: ${url.hostname}`);
};

const { handle } = await import('../../server/cloud.mjs');
const { default: vercelHandler } = await import('../../api/index.mjs');
const pending = [];
const server = http.createServer(async (req, res) => {
  if (req.url === '/__test/settle') {
    await Promise.allSettled(pending.splice(0));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sent }));
    return;
  }
  if (req.url.startsWith('/api/index')) return vercelHandler(req, res);
  await handle(req, res, { waitUntil: (promise) => pending.push(promise) });
});
server.listen(0, '127.0.0.1', () => console.log(`READY ${server.address().port}`));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
