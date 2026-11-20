// Varademo: sama tilauskeskustelu selaimessa, jos Meta ei toimita vastauksia puhelimeen.
// Käyttää samaa siltaa, luonnoskantaa ja gatewayta kuin WhatsApp-kanava. Vain tältä koneelta: tunnelin kautta
// tuleva pyyntö torjutaan, koska sivu tekee malli- ja hintakutsuja ilman kirjautumista.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { codeHash } from './store.mjs';

// Varattu testinumero, jota ei voi lisätä Metan vastaanottajaksi. Selaindemolla on oma asiakkuus ja luonnos.
export const WEB_DEMO_PHONE = '358000000001';
const PAGE = new URL('../../public/whatsapp-demo.html', import.meta.url);
// WhatsApp-palvelin ei jaa public-kansiota. Varademon avatar-logo tarjoillaan siksi omalta reitiltään samoin rajoin kuin sivu.
const LOGO_FILE = new URL('../../public/aimo-logo.png', import.meta.url);
const LOGO_ROUTE = '/demo/logo.png';
const DEMO_ROUTES = new Set(['/demo', '/demo/chat', LOGO_ROUTE]);
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/;
// cloudflared yhdistää paikallisesti, mutta lisää välityspalvelimen otsakkeet. Niiden kanssa pyyntö ei ole paikallinen.
export const isLocal = (req) => LOOPBACK.test(req.socket?.remoteAddress || '')
  && !['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip', 'forwarded'].some((h) => req.headers[h])
  && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    req.on('data', (c) => { bytes += c.length; if (bytes <= 16_000) chunks.push(c); });
    req.on('end', () => (bytes > 16_000 ? reject(new Error('Body limit')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

/** @param {{store: object, chat: Function, readPage?: () => string}} o chat = tilaussillan chat (ordering.mjs) */
export function createWebDemo(options) {
  const { store, chat } = options;
  const readPage = options.readPage || (() => fs.readFileSync(PAGE, 'utf8'));
  const readLogo = options.readLogo || (() => fs.readFileSync(LOGO_FILE));
  let queue = Promise.resolve();
  function sendLogo(req, res) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    let image = null;
    try { image = { bytes: readLogo() }; } catch { /* Logo puuttuu: sivu näyttää sen tilalla tekstin. */ }
    if (!image) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
    return res.end(image.bytes);
  }
  function member() {
    if (!store.member(WEB_DEMO_PHONE)) {
      const invitation = store.invite(WEB_DEMO_PHONE, 'Testikeittiö (selaindemo)', 'Testaaja');
      if (!store.pair(WEB_DEMO_PHONE, codeHash(invitation.code))) throw new Error('Selaindemon asiakkuutta ei voitu luoda.');
    }
    return store.member(WEB_DEMO_PHONE);
  }
  return {
    async handle(req, res, url) {
      if (!DEMO_ROUTES.has(url.pathname)) return false;
      if (!isLocal(req)) { json(res, 403, { error: 'Selaindemo toimii vain palvelinkoneen omasta selaimesta.' }); return true; }
      if (url.pathname === LOGO_ROUTE) { sendLogo(req, res); return true; }
      if (url.pathname === '/demo' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(readPage()); return true;
      }
      if (url.pathname !== '/demo/chat' || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return true; }
      // Selaimen lomake toisesta sivustosta ei saa lähettää viestejä: vaaditaan JSON ja sama alkuperä.
      const origin = req.headers.origin;
      if (!/^application\/json\b/.test(req.headers['content-type'] || '') || (origin && new URL(origin).host !== req.headers.host)) { json(res, 403, { error: 'Pyyntö hylätty.' }); return true; }
      let text;
      try { text = String(JSON.parse(await body(req)).text || '').trim(); } catch { json(res, 400, { error: 'Virheellinen pyyntö.' }); return true; }
      if (!text || text.length > 4000) { json(res, 400, { error: 'Kirjoita enintään 4000 merkin viesti.' }); return true; }
      // Yksi viesti kerrallaan, kuten kanavan jonossa: luonnos ei saa muuttua kahdesta vuorosta yhtä aikaa.
      const turn = queue.then(async () => {
        const started = Date.now();
        const result = await chat({ member: member(), messageId: `web-${crypto.randomUUID()}`, receivedAt: started, messages: [{ role: 'user', content: text }] });
        return { text: String(result?.text || ''), status: result?.status || null, ms: Date.now() - started };
      });
      queue = turn.catch(() => {});
      try { json(res, 200, await turn); } catch { json(res, 502, { error: 'Viestin käsittely ei onnistunut. Luonnos säilyy. Yritä uudelleen.' }); }
      return true;
    },
  };
}
