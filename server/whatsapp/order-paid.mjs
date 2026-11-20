// Kiitosviesti WhatsAppiin, kun demomaksu on hyväksytty (Eeliksen pyyntö 20.11.2026).
// Maksusivu on Workerilla: kun maksu hyväksytään, Worker kutsuu tätä reittiä jaetulla WEBCHAT_SECRETilla
// (deploy/cloudflare/src/order-paid.ts). Botti etsii tilauksen tehneen numeron gatewayn tilauksesta (buyerId
// whatsapp-demo-<binding>) ja lähettää yhden viestin. Sama tilaus saa viestin vain kerran (order_notices).
// Tämä viesti on tilausvahvistus: sähköpostia ei lähetetä.
import crypto from 'node:crypto';
import { WEB_CHAT_PHONE } from './web-chat.mjs';

export const ORDER_PAID_PATH = '/webchat/api/order-paid';
const ORDER_ID = /^AGW-\d{8}-\d{4,12}$/;
const WEEKDAY = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
// Keskeytynyt lähetys (kaatunut kutsu) saa yrittää uudelleen tämän jälkeen.
const SENDING_LEASE_MS = 2 * 60_000;

/** "2026-11-24" → "ti 24.11." */
export function deliveryLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

export function orderPaidMessage({ orderId, deliveryDate }) {
  const day = deliveryLabel(deliveryDate);
  return [
    `Kiitos tilauksestasi! Maksu on hyväksytty ja tilaus ${orderId} on vahvistettu.`,
    day ? `Toimitus on ${day}, joten tuotteiden pitäisi saapua silloin.` : null,
    'Tilaa multa milloin vain uudestaan!',
  ].filter(Boolean).join('\n\n');
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2000) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return null; }
}

/**
 * @param {object} o
 * @param {object} o.store WhatsApp-kanta (store.mjs)
 * @param {Function} o.send (phone, text) => Promise<messageId>, sama Meta-lähetin kuin kanavalla
 * @param {string} o.secret WEBCHAT_SECRET
 * @param {Function} o.findOrder (orderId) => Promise<gatewayn tilaus|null>
 */
export function createOrderPaidNotice({ store, send, secret, findOrder, now = Date.now }) {
  if (!secret || secret.length < 32 || typeof send !== 'function' || typeof findOrder !== 'function') return null;
  store.db.exec(`CREATE TABLE IF NOT EXISTS order_notices (order_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL,
    reply_id TEXT, error TEXT)`);
  const expected = crypto.createHash('sha256').update(secret).digest();
  const authorized = (req) => {
    const supplied = /^Bearer (\S{1,256})$/.exec(req.headers.authorization || '')?.[1];
    return Boolean(supplied) && crypto.timingSafeEqual(expected, crypto.createHash('sha256').update(supplied).digest());
  };
  const log = (outcome, orderId) => console.log(JSON.stringify({ event: 'order_paid_notice', outcome, orderId }));

  /** Varaa tilauksen viestin. false = viesti on jo lähetetty tai lähtemässä toisessa kutsussa. */
  function claim(orderId) {
    const t = now();
    if (store.db.prepare("INSERT OR IGNORE INTO order_notices(order_id,state,updated) VALUES(?,'sending',?)").run(orderId, t).changes) return true;
    return store.db.prepare(`UPDATE order_notices SET state='sending',updated=?,error=NULL
      WHERE order_id=? AND (state='failed' OR (state='sending' AND updated<?))`).run(t, orderId, t - SENDING_LEASE_MS).changes > 0;
  }

  async function notify(orderId) {
    const order = await findOrder(orderId);
    if (!order || order.orderId !== orderId || order.status !== 'confirmed') return { status: 404, outcome: 'order_missing' };
    const binding = /^whatsapp-demo-(.+)$/.exec(order.buyerId || '')?.[1];
    const member = binding && store.db.prepare('SELECT phone,binding FROM members WHERE binding=?').get(binding);
    // Numero on liitetty uudelleen tai poistettu: viestiä ei lähetetä kenellekään muulle.
    if (!member) return { status: 200, outcome: 'no_member' };
    // Selainkeskustelun asiakas näkee vahvistuksen maksusivulla; keksittyyn numeroon ei lähetetä Metan kautta.
    if (WEB_CHAT_PHONE.test(member.phone)) return { status: 200, outcome: 'web_chat' };
    if (!claim(orderId)) return { status: 200, outcome: 'duplicate' };
    try {
      const replyId = await send(member.phone, orderPaidMessage({ orderId, deliveryDate: order.deliveryDate }));
      store.db.prepare("UPDATE order_notices SET state='sent',updated=?,reply_id=? WHERE order_id=?").run(now(), String(replyId || ''), orderId);
      return { status: 200, outcome: 'sent' };
    } catch (error) {
      // Ei Metan vastausta eikä numeroa lokiin. Esim. yli 24 h vanha keskustelu: Meta ei ota vapaata viestiä vastaan.
      store.db.prepare("UPDATE order_notices SET state='failed',updated=?,error=? WHERE order_id=?")
        .run(now(), String(error?.message || 'SEND_FAILED').slice(0, 60), orderId);
      return { status: 502, outcome: 'send_failed' };
    }
  }

  return {
    notify,
    async handle(req, res, url) {
      if (url.pathname !== ORDER_PAID_PATH) return false;
      if (!authorized(req)) { json(res, 401, { error: 'Ei oikeutta.' }); return true; }
      if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return true; }
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { json(res, 415, { error: 'Lähetä JSON-pyyntö.' }); return true; }
      const input = await body(req);
      if (!input || typeof input.orderId !== 'string' || !ORDER_ID.test(input.orderId)) { json(res, 400, { error: 'Virheellinen tilausnumero.' }); return true; }
      try {
        const { status, outcome } = await notify(input.orderId);
        log(outcome, input.orderId);
        json(res, status, { ok: status === 200, outcome });
      } catch {
        log('failed', input.orderId);
        json(res, 503, { ok: false, outcome: 'failed' });
      }
      return true;
    },
  };
}
