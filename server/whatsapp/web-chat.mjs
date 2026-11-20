// Selainkeskustelu Workers-sivustolta: sama tilausapuri kuin WhatsAppissa, mutta viesti tulee Workerin kautta.
// Vain Worker voi kutsua (jaettu WEBCHAT_SECRET). Selaimen istunnosta johdetaan oma testiasiakas ja oma kori,
// joten kokeilijat eivät näe toistensa luonnoksia. Viestit tallennetaan samaan jonokantaan kuin WhatsApp-viestit
// (tila done), jotta historia, korilinkki ja agentin jälki toimivat samalla tavalla.
import crypto from 'node:crypto';
import { codeHash } from './store.mjs';
import { plainDashes, replyChunks, supportReply, SUPPORT_REQUEST } from './channel.mjs';

const PREFIX = '/webchat/api/';
// "3580…" ei ole koskaan oikea suomalainen numero kansainvälisessä muodossa (suuntanumeron nolla jää pois).
export const WEB_CHAT_PHONE = /^3580000\d{8}$/;
export const WEB_CHAT_PER_DAY = 600;
const SESSION = /^[a-f0-9]{32,64}$/;
const MESSAGE_ID = /^[a-f0-9-]{36}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12_000) throw fail(413, 'Viesti on liian pitkä.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw fail(400, 'Virheellinen pyyntö.'); }
}

/** Selaimen istunnosta pysyvä, oikeasta numerosta erotettava tunniste. */
export function webChatPhone(secret, session) {
  const digest = crypto.createHmac('sha256', secret).update(`aimo-webchat-phone-v1\0${session}`).digest();
  return `3580000${String(digest.readUInt32BE(0) % 100_000_000).padStart(8, '0')}`;
}

/**
 * @param {object} o
 * @param {object} o.store WhatsApp-kanta (store.mjs)
 * @param {Function} o.chat korilinkin chat (cart-link.mjs), sama kuin WhatsApp-kanavalla
 * @param {Function} [o.cartLink] (member) => Promise<string|null> nykyisen luonnoksen korilinkki
 * @param {Function} [o.shoppingList] (member) => Promise<object|null>
 * @param {string} o.secret WEBCHAT_SECRET
 * @param {string} [o.supportContact] sama asiakaspalvelun yhteystieto kuin WhatsAppissa
 */
export function createWebChat({ store, chat, cartLink, shoppingList, secret, supportContact = process.env.WHATSAPP_SUPPORT_CONTACT?.trim(), now = Date.now }) {
  if (!secret) return null;
  if (secret.length < 32) throw new Error('WEBCHAT_SECRET on liian lyhyt (vähintään 32 merkkiä).');
  const expected = crypto.createHash('sha256').update(secret).digest();
  const authorized = (req) => {
    const supplied = /^Bearer (\S{1,256})$/.exec(req.headers.authorization || '')?.[1];
    return Boolean(supplied) && crypto.timingSafeEqual(expected, crypto.createHash('sha256').update(supplied).digest());
  };
  function member(session) {
    const phone = webChatPhone(secret, session);
    if (!store.member(phone)) {
      const invitation = store.invite(phone, 'Testikeittiö (selain)', 'Kokeilija');
      if (!store.pair(phone, codeHash(invitation.code))) throw fail(503, 'Testiasiakasta ei voitu luoda.');
    }
    return store.member(phone);
  }
  // Näytetään kuten WhatsAppissa: rivin alun "- " ajatusviivana. Tallennettu vastaus pysyy ennallaan.
  const shown = (rows) => rows.map((p) => plainDashes(p.text));
  const history = (phone) => store.db.prepare("SELECT id,text,received,reply FROM inbox WHERE phone=? AND kind='text' AND state='done' ORDER BY received DESC,rowid DESC LIMIT 40")
    .all(phone).reverse().map((m) => ({ id: m.id, at: m.received, text: m.text,
      parts: shown(store.db.prepare('SELECT text FROM reply_parts WHERE message_id=? ORDER BY part').all(m.id)) }));

  async function turn(session, text, messageId) {
    const current = member(session);
    const id = `web-${messageId}`;
    const done = store.db.prepare('SELECT id,phone,state FROM inbox WHERE id=?').get(id);
    if (done && done.phone !== current.phone) throw fail(409, 'Viestitunniste on jo käytössä.');
    if (done?.state === 'done') return { parts: shown(store.db.prepare('SELECT text FROM reply_parts WHERE message_id=? ORDER BY part').all(id)), repeated: true };
    const day = store.db.prepare("SELECT count(*) n FROM inbox WHERE id LIKE 'web-%' AND received>=?").get(now() - 86400_000).n;
    if (day >= WEB_CHAT_PER_DAY) throw fail(429, 'Selainkokeilun päiväraja täyttyi. Pyydä oikea WhatsApp-kokeilu etusivulta.');
    const received = now();
    // Oma tila 'web': WhatsApp-jono (next, recover, recoverStale) käsittelee vain pending/processing-rivejä, joten
    // kesken jäänyttä selainviestiä ei koskaan lähetetä Metan kautta keksittyyn numeroon.
    if (!done) store.db.prepare("INSERT INTO inbox(id,phone,text,kind,binding,received,sent_at,state,attempts) VALUES(?,?,?,'text',?,?,?,'web',1)")
      .run(id, current.phone, text, current.binding, received, received);
    if (supportContact && SUPPORT_REQUEST.test(text)) {
      // Sama kiinteä vastaus kuin WhatsAppissa. Ei mallikutsua, eikä se mene mallin keskusteluhistoriaan.
      const reply = supportReply({ orderingDemo: true, supportContact });
      const parts = replyChunks([reply]);
      store.saveReply({ id, text }, reply, null, parts);
      store.finish(id, 'done');
      return { parts: parts.map(plainDashes), status: null };
    }
    try {
      const result = await chat({ member: current, messageId: id, receivedAt: received, channel: 'web',
        messages: [...store.history(current.binding), { role: 'user', content: text }] });
      const parts = replyChunks(Array.isArray(result?.messages) && result.messages.length ? result.messages : [String(result?.text || '')]);
      store.saveReply({ id, text }, parts.join('\n\n'), current.binding, parts);
      store.finish(id, 'done');
      return { parts: parts.map(plainDashes), status: result?.status || null };
    } catch (error) {
      store.db.prepare("UPDATE inbox SET state='failed',error=? WHERE id=?").run('WEB_CHAT_FAILED', id);
      throw error;
    }
  }

  return {
    async handle(req, res, url) {
      if (!url.pathname.startsWith(PREFIX)) return false;
      try {
        if (!authorized(req)) throw fail(401, 'Ei oikeutta.');
        if (req.method !== 'POST') throw fail(405, 'Method not allowed');
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw fail(415, 'Lähetä JSON-pyyntö.');
        const input = await body(req);
        if (typeof input.session !== 'string' || !SESSION.test(input.session)) throw fail(400, 'Virheellinen istunto.');
        const action = url.pathname.slice(PREFIX.length);
        if (action === 'chat') {
          const text = typeof input.text === 'string' ? input.text.trim() : '';
          if (!text || text.length > 2000) throw fail(400, 'Kirjoita enintään 2000 merkin viesti.');
          if (typeof input.messageId !== 'string' || !MESSAGE_ID.test(input.messageId)) throw fail(400, 'Virheellinen viestitunniste.');
          json(res, 200, await turn(input.session, text, input.messageId.toLowerCase())); return true;
        }
        if (action === 'history') {
          const phone = webChatPhone(secret, input.session);
          json(res, 200, { messages: store.member(phone) ? history(phone) : [] }); return true;
        }
        if (action === 'cart') {
          const phone = webChatPhone(secret, input.session);
          const current = store.member(phone);
          const list = current && shoppingList ? await shoppingList(current) : null;
          json(res, 200, { url: list && cartLink ? cartLink(current, list) : null, lines: list?.lines?.length || 0 }); return true;
        }
        throw fail(404, 'Reittiä ei ole.');
      } catch (error) {
        const status = [400, 401, 404, 405, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 502;
        json(res, status, { error: status === 502 ? 'Viestin käsittely ei onnistunut. Luonnos säilyy. Yritä uudelleen.' : error.message });
        return true;
      }
    },
  };
}
