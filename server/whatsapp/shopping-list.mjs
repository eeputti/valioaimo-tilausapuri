// Paikallisen testikaupan näkymä WhatsApp-luonnokseen. Kauppa lukee ja muokkaa samaa luonnosta tilaussillan kautta,
// eikä luonnosta kopioida selaimen omaksi koriksi. Tuotannossa asiakkaan tunnistaa Valion oma kirjautuminen.
import { createDemoBuyerResolver } from './demo-buyer.mjs';
import { isLocal } from './web-demo.mjs';

export const LIST_ROUTE = '/api/assistant/whatsapp-list';
const CHAT_ROUTE = `${LIST_ROUTE}/chat`;
const BODY_LIMIT = 20_000;
const PASSED_THROUGH = new Set([400, 403, 409, 413]);

const httpError = (status, message) => Object.assign(new Error(message), { status });

function reply(res, status, payload) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const parts = [];
  let total = 0;
  for await (const part of req) {
    total += part.length;
    if (total > BODY_LIMIT) throw httpError(413, 'Pyyntö on liian suuri.');
    parts.push(part);
  }
  const raw = Buffer.concat(parts).toString('utf8');
  try { return JSON.parse(raw); } catch { throw httpError(400, 'Virheellinen pyyntö.'); }
}

// Vain tämän koneen oma selain samalta sivulta: ei tunnelia, välityspalvelinta eikä toisen sivuston pyyntöä.
function fromLocalShop(req) {
  const { headers } = req;
  if (!isLocal(req) || headers['x-forwarded-host'] || headers['x-forwarded-proto']) return false;
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  if (!headers.origin) return true;
  try { return new URL(headers.origin).origin === `http://${headers.host}`; } catch { return false; }
}

// Odotettu versio on joko null (listaa ei vielä ole) tai listan tunniste ja ei-negatiivinen versionumero.
function validExpectedList(expected) {
  if (expected === null) return true;
  if (!expected || typeof expected.id !== 'string' || expected.id.length > 100) return false;
  return Number.isSafeInteger(expected.revision) && expected.revision >= 0;
}

function validChatBody(input) {
  const text = input.text;
  if (typeof text !== 'string' || text.trim() === '' || text.length > 4000) return false;
  if (typeof input.messageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.messageId)) return false;
  return validExpectedList(input.expectedList);
}

export function createShoppingListHandoff(options) {
  const { store, ordering, defaultPhone } = options;
  const resolveBuyer = options.resolveBuyer || createDemoBuyerResolver();
  const listMembers = () => store.db.prepare('SELECT phone,binding,company,person FROM members ORDER BY company,person,binding').all();
  const buyerIdOf = (member) => resolveBuyer(member).buyerId;
  const memberByBuyer = (buyerId) => listMembers().find((member) => buyerIdOf(member) === buyerId);
  const accountOf = (member) => (ordering.getAccount
    ? ordering.getAccount(member)
    : { buyerId: buyerIdOf(member), companyName: member.company, personName: member.person });

  async function showList(res, url) {
    const members = listMembers();
    const requested = url.searchParams.get('buyerId');
    let member;
    if (requested) {
      member = memberByBuyer(requested);
      if (!member) return reply(res, 404, { error: 'Testiasiakkuutta ei löydy.' });
    } else {
      const ownPhone = String(defaultPhone || '').replace(/^\+/, '');
      member = members.find((candidate) => candidate.phone === ownPhone) || members[0];
    }
    let selected = { buyerId: null, shoppingList: null };
    if (member) selected = { buyerId: buyerIdOf(member), shoppingList: await ordering.getShoppingList(member) };
    const accounts = await Promise.all(members.map(accountOf));
    return reply(res, 200, { mode: 'local-demo', accounts, ...selected });
  }

  async function sendMessage(req, res) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'Lähetä JSON-pyyntö.' });
    const input = await readJson(req);
    const member = typeof input?.buyerId === 'string' ? memberByBuyer(input.buyerId) : null;
    if (!member) return reply(res, 404, { error: 'Testiasiakkuutta ei löydy.' });
    if (!validChatBody(input)) return reply(res, 400, { error: 'Tarkista viesti ja ostoslistan versio.' });
    // Selain antaa vain tekstin, viestin tunnisteen ja odotetun listan version. Asiakas, yhteys, historia ja
    // hyväksyntä tulevat palvelimelta. Silta tallentaa vastauksen ja listan yhdessä ja tarkistaa oikeudet työkalujen jälkeen.
    const result = await ordering.chat({
      member,
      messageId: `shop:${member.binding}:${input.messageId}`,
      receivedAt: Date.now(),
      messages: [{ role: 'user', content: input.text.trim() }],
      expectedList: input.expectedList,
    });
    return reply(res, 200, result);
  }

  // Palauttaa false, kun reitti ei kuulu tälle käsittelijälle; muuten vastaus on jo lähetetty.
  async function route(req, res, url) {
    const path = url.pathname;
    if (path !== LIST_ROUTE && path !== CHAT_ROUTE) return false;
    if (!fromLocalShop(req)) {
      reply(res, 403, { error: 'WhatsApp-ostoslista on käytettävissä vain paikallisessa testikaupassa.' });
      return true;
    }
    try {
      if (req.method === 'GET' && path === LIST_ROUTE) await showList(res, url);
      else if (req.method === 'POST' && path === CHAT_ROUTE) await sendMessage(req, res);
      else reply(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      const status = PASSED_THROUGH.has(error.status) ? error.status : 502;
      reply(res, status, { error: status === 502 ? 'Ostoslistan käsittely ei onnistunut. Yritä uudelleen.' : error.message });
    }
    return true;
  }

  return { handle: route };
}
