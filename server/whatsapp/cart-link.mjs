// A short-lived capability for one existing WhatsApp draft. No browser-local cart copy.
import crypto from 'node:crypto';
import { isDirectCartRequest, replyWithCartLink, withCartHandoffHint } from './cart-handoff.mjs';
import { incompleteNote } from './dialogue.mjs';
import { hasLinkAdviceReply } from './link-advice.mjs';
import { CONFIRM } from '../order-conversation/index.mjs';

const PAGE = '/whatsapp/cart';
const API = `${PAGE}/api`;
const EXPORT_ROUTE = `${API}/export`;
// Korisivun omat rajapintareitit: luonnoksen luku, muutosviestit ja hintojen vienti kaupalle.
const API_ROUTES = new Set([API, `${API}/chat`, EXPORT_ROUTE]);
const TTL = 24 * 3600_000;
export const CHAT_PER_DAY = 200;
// Hintojen vienti tekee välimuistin ohi uuden tarjouksen (Valion hinta- ja saatavuuskutsut): raja per korilinkin
// asiakassidos, jotta vuorotellen päivittyvät tai toistuvasti haetut korit eivät aiheuta 429-virheitä (katselmus #23).
export const EXPORT_PER_MINUTE = 30;
const CONFIRM_ONLY_FROM_BUTTON = 'Tilausta ei tehty. Tilaa painamalla SIIRRY MAKSAMAAN.';
const fail = (status, message) => Object.assign(new Error(message), { status });
const unavailable = () => fail(410, 'Korilinkki on vanhentunut tai ostoskori on suljettu. Pyydä WhatsAppissa uusi linkki.');
const headers = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function json(res, status, data) {
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12_000) throw fail(413, 'Pyyntö on liian suuri.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Virheellinen pyyntö.'); }
}

export function createCartLink({ store, ordering, baseUrl, secret, now = Date.now }) {
  if (!baseUrl?.trim()) return null;
  const base = new URL(baseUrl.trim());
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !secret) {
    throw new Error('WHATSAPP_PUBLIC_URL tarvitsee julkisen HTTPS-alkuperän ilman polkua.');
  }
  const sign = (payload) => crypto.createHmac('sha256', secret).update(`whatsapp-cart-v1\0${payload}`).digest('base64url');
  const requests = new Map(); const daily = new Map(); const exportsPerMinute = new Map();
  const issue = (member, list) => {
    const payload = Buffer.from(JSON.stringify({ binding: member.binding, draft: list.id, expires: now() + TTL })).toString('base64url');
    return `${base.origin}${PAGE}#${payload}.${sign(payload)}`;
  };
  function authenticate(req) {
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    if (!token || token.length > 1500) throw unavailable();
    const [payload, signature] = token.split('.');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) throw unavailable();
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw unavailable(); }
    if (!claims || typeof claims.binding !== 'string' || typeof claims.draft !== 'string'
        || !Number.isSafeInteger(claims.expires) || claims.expires <= now() || claims.expires > now() + TTL) throw unavailable();
    const member = store.db.prepare('SELECT phone,binding,company,person FROM members WHERE binding=?').get(claims.binding);
    if (!member) throw unavailable();
    return { member, draftId: claims.draft };
  }
  // v2-agentti (WHATSAPP_AGENT=v2): malli kirjoittaa vastauksen itse, ja linkki lisätään viimeisen viestin loppuun vain, kun
  // send_cart_link onnistui tässä vuorossa (requestCartLink) ja nykyinen luonnos on sama ja valmis (status review).
  // createMetaSender näyttää viimeisen rivin linkin painikkeena "Avaa ostoskori".
  async function withAgentCartLink(args, result) {
    if (!result?.requestCartLink) return result;
    const list = await ordering.getShoppingList(args.member);
    let url = null;
    if (list && list.id === result.draftId && list.status === 'review') {
      try {
        const parsed = new URL(issue(args.member, list));
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed.href;
      } catch { /* Puuttuva linkki ei koskaan johda tilaukseen. */ }
    }
    const parts = result.messages?.length ? [...result.messages] : [String(result.text || '')];
    parts[parts.length - 1] = url ? `${parts.at(-1)}\n${url}`
      : `${parts.at(-1)}\n\nOstoskorilinkki ei nyt avaudu. Ostoskorisi on tallessa. Pyydä linkkiä hetken kuluttua uudelleen.`;
    return { ...result, messages: parts, text: parts.join('\n\n'), ...(url ? {} : { requestCartLink: false }) };
  }

  // Hintojen vienti kaupalle: minuuttiraja asiakassidosta kohden, ja vastaus koskee vain linkin omaa luonnosta.
  async function exportCart(member, draftId) {
    for (const [binding, window] of exportsPerMinute) if (window.until <= now()) exportsPerMinute.delete(binding);
    const window = exportsPerMinute.get(member.binding) || { until: now() + 60_000, count: 0 };
    if (window.count >= EXPORT_PER_MINUTE) throw fail(429, 'Liian monta hintatarkistusta. Odota minuutti ja yritä uudelleen.');
    window.count++; exportsPerMinute.set(member.binding, window);
    const exported = await ordering.getStorefrontCart(member, draftId);
    // Tyhjällä korilla ei ole tunnistetta. Toisen luonnoksen kori tarkoittaa, että linkki on jo vanhentunut.
    if (exported.id && exported.id !== draftId) throw unavailable();
    return exported;
  }

  return {
    // Selainkeskustelun Ostoskori-välilehti: sama allekirjoitettu linkki nykyiseen luonnokseen.
    linkFor: (member, list) => issue(member, list),
    async chat(args) {
      if (await ordering.usesAgent?.()) return withAgentCartLink(args, await ordering.chat({ ...args, cartLinkAvailable: true }));
      const list = await ordering.getShoppingList(args.member);
      let dialogue = {};
      if (store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wa_dialogue'").get()) {
        const row = store.db.prepare('SELECT json FROM wa_dialogue WHERE binding=?').get(args.member.binding);
        if (row) dialogue = JSON.parse(row.json);
      }
      const input = args.messages.at(-1)?.content || '';
      const handoff = hasLinkAdviceReply(store.db, args.member.binding, input, now()) ? null : await replyWithCartLink({ text: input, shoppingList: list,
        lastOrder: dialogue.lastOrder, pendingSuggestion: dialogue.pendingSuggestion, cartHandoff: () => issue(args.member, list) });
      if (handoff) return handoff; // Acknowledgement opens the cart, never submits an order.
      // Suora koripyyntö keskeneräiseen tilaukseen: ei linkkiä eikä tuotetulkintaa, vaan puuttuvat tiedot ja seuraava kysymys.
      const lastText = args.messages.at(-1)?.content || '';
      if (list && list.status !== 'review' && isDirectCartRequest(lastText)) {
        const shown = await ordering.chat({ ...args, messages: [...args.messages.slice(0, -1), { role: 'user', content: 'näytä' }], cartLinkAvailable: true });
        const note = incompleteNote(list); const parts = shown.messages?.length ? shown.messages : [shown.text];
        return withCartHandoffHint({ ...shown, cartRequested: false, messages: [note, ...parts], text: [note, ...parts].join('\n\n') });
      }
      const result = await ordering.chat({ ...args, cartLinkAvailable: true });
      if (result.cartRequested) {
        const current = await ordering.getShoppingList(args.member);
        if (current) {
          const handoff = await replyWithCartLink({ text: 'avaa kori', shoppingList: current, cartHandoff: () => issue(args.member, current) });
          // Keskeneräinen tilaus: ei linkkiä. Tilausmoottorin vastaus kysyy jo seuraavan puuttuvan asian.
          if (!handoff) {
            const note = incompleteNote(current); const messages = result.messages?.length ? result.messages : [result.text];
            return withCartHandoffHint({ ...result, cartRequested: false, messages: [note, ...messages], text: [note, ...messages].join('\n\n') });
          }
          if (result.conversationAnswer) return { ...handoff, messages: [result.conversationAnswer, ...handoff.messages], text: `${result.conversationAnswer}\n\n${handoff.text}` };
          return handoff;
        }
      }
      return withCartHandoffHint(result);
    },
    async handle(req, res, url) {
      if (!API_ROUTES.has(url.pathname)) return false;
      try {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== base.origin)) {
          throw fail(403, 'Pyyntö ei tullut ostoskorisivulta.');
        }
        const { member, draftId } = authenticate(req);
        if (url.pathname === EXPORT_ROUTE && req.method === 'GET') {
          json(res, 200, await exportCart(member, draftId));
          return true;
        }
        if (req.method === 'GET' && url.pathname === API) {
          const list = await ordering.getShoppingList(member);
          if (!list || list.id !== draftId) throw unavailable();
          json(res, 200, { shoppingList: list }); return true;
        }
        if (req.method !== 'POST' || url.pathname !== `${API}/chat`) throw fail(405, 'Method not allowed');
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw fail(415, 'Lähetä JSON-pyyntö.');
        const input = await body(req);
        if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 4000
            || typeof input.messageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.messageId)
            || input.expectedList?.id !== draftId || !Number.isSafeInteger(input.expectedList?.revision) || input.expectedList.revision < 0
            || (input.confirm !== undefined && typeof input.confirm !== 'boolean') || (input.pay !== undefined && typeof input.pay !== 'boolean')) {
          throw fail(400, 'Tarkista viesti ja ostoskorin versio.');
        }
        // Tilauksen vahvistus vain SIIRRY MAKSAMAAN -painikkeesta (se pyytää ensin yhteenvedon ja vahvistaa sen perään).
        // Muutoskenttään kirjoitettu "hyväksyn" tai "tilaa" ei tee tilausta (katselmus #10), ja painike lähettää vain vahvistuksen.
        const confirming = CONFIRM.test(input.text.trim());
        if (confirming !== (input.confirm === true)) throw fail(400, confirming ? CONFIRM_ONLY_FROM_BUTTON : 'Vahvistuspainike lähettää vain tilauksen vahvistuksen.');
        const recent = requests.get(member.binding);
        const limit = recent && recent.until > now() ? recent : { until: now() + 60_000, count: 0 };
        if (limit.count >= 10) throw fail(429, 'Liian monta pyyntöä. Odota minuutti ja yritä uudelleen.');
        // Linkki on voimassa vuorokauden: välitetty tai vuotanut linkki ei saa käynnistää rajattomasti mallikutsuja.
        const today = daily.get(member.binding);
        const day = today && today.until > now() ? today : { until: now() + 86400_000, count: 0 };
        if (day.count >= CHAT_PER_DAY) throw fail(429, 'Ostoskorin muutosten päiväraja täyttyi. Jatka WhatsAppissa tai pyydä uusi linkki huomenna.');
        for (const [binding, window] of requests) if (window.until <= now()) requests.delete(binding);
        for (const [binding, window] of daily) if (window.until <= now()) daily.delete(binding);
        limit.count++; requests.set(member.binding, limit);
        day.count++; daily.set(member.binding, day);
        // A server-owned binding and expected draft version go through the existing serialized,
        // idempotent ordering bridge. An old link cannot edit or confirm a replacement draft.
        // pay = SIIRRY MAKSAMAAN -polku (yhteenveto ja vahvistus): vastausta ei kirjoiteta mallilla uudelleen, koska
        // yhteenvetoa ei näytetä ja tilaus jatkuu heti maksusivulle. Kaksi äänikerroksen kutsua hidasti siirtymää.
        const result = await ordering.chat({ member, messageId: `cart:${member.binding}:${input.messageId}`, receivedAt: now(),
          messages: [{ role: 'user', content: input.text.trim() }], expectedList: input.expectedList, plain: input.pay === true });
        // Pilvi välittää tilauksen maksusivulle vain, kun tilaus syntyi (server/cloud.mjs).
        if (['confirmed', 'pending_approval'].includes(result?.status)) res.orderPlaced = true;
        json(res, 200, result); return true;
      } catch (error) {
        const status = [400, 403, 409, 410, 413, 415, 405, 429].includes(error.status) ? error.status : 502;
        json(res, status, { error: status === 502 ? 'Ostoskorin käsittely ei onnistunut. Yritä uudelleen.' : error.message }); return true;
      }
    },
  };
}
