// Local diagnostics and request gate for WhatsApp orders. Never starts a channel worker.
import { createDemoBuyerResolver } from './whatsapp/demo-buyer.mjs';
import { DatabaseSync } from 'node:sqlite';
import { isLocal } from './whatsapp/web-demo.mjs';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
// Paikallisen testikaupan asiakasvalikko: vain WhatsApp-jäsenet, joille kaupassa on jo ostaja.
export function createLocalShop(options) {
  const { whatsappDb, defaultPhone, buyers } = options;
  const buyerIdOf = options.resolveBuyer || createDemoBuyerResolver();
  const readMembers = () => {
    // Vain luku: kaupan avaaminen ei saa palauttaa töitä, yhdistää numeroa eikä käynnistää toista kanavan käsittelijää.
    const db = new DatabaseSync(whatsappDb, { readOnly: true });
    try { return db.prepare('SELECT phone,binding,company,person FROM members').all(); }
    finally { db.close(); }
  };
  function context() {
    const members = readMembers();
    const knownBuyers = new Map();
    for (const buyer of buyers()) knownBuyers.set(buyer.id, buyer);
    const accounts = [];
    let defaultBuyerId = null;
    const ownPhone = String(defaultPhone || '').replace(/^\+/, '');
    for (const member of members) {
      const id = buyerIdOf(member).buyerId;
      const buyer = knownBuyers.get(id);
      if (!buyer) continue;
      accounts.push({ buyerId: id, name: buyer.name || member.company, personName: member.person, deliverySite: 'Testikeittiö' });
    }
    // Oletukseksi palvelimen oma demonumero, jos sille on ostaja; muuten listan ensimmäinen.
    const own = members.find((member) => member.phone === ownPhone);
    if (own) {
      const ownId = buyerIdOf(own).buyerId;
      if (accounts.some((account) => account.buyerId === ownId)) defaultBuyerId = ownId;
    }
    return { mode: 'local-demo', accounts, defaultBuyerId: defaultBuyerId || accounts[0]?.buyerId || null };
  }
  return {
    context,
    handle(req, res, url) {
      let originAllowed = true;
      try { if (req.headers.origin) originAllowed = new URL(req.headers.origin).origin === `http://${req.headers.host}`; }
      catch { originAllowed = false; }
      if (!isLocal(req) || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto']
          || !originAllowed || req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, 403, { error: 'Testikauppa toimii vain palvelinkoneen omasta selaimesta.' }); return true;
      }
      if (['/console/reset', '/console/demo', '/api/reset'].includes(url.pathname)) {
        json(res, 403, { error: 'WhatsAppin tilauksia ei voi nollata tästä testikaupasta.' }); return true;
      }
      if (url.pathname === '/api/local-shop' && req.method === 'GET') { json(res, 200, context()); return true; }
      return false;
    },
  };
}
