import fs from 'node:fs';
import crypto from 'node:crypto';

const ORDER_ID = /^AGW-\d{8}-\d{4,12}$/;

export function handleDemoCheckoutAsset(req, res, url) {
  const file = url.pathname === '/whatsapp/checkout.js' ? 'whatsapp-checkout.js'
    : url.pathname === '/whatsapp/checkout.css' ? 'whatsapp-checkout.css' : null;
  if (!file) return false;
  const headers = { 'content-type': `${file.endsWith('.js') ? 'text/javascript' : 'text/css'}; charset=utf-8`, 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' };
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { ...headers, allow: 'GET, HEAD' }); res.end(); return true;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(new URL(`../../public/${file}`, import.meta.url)));
  return true;
}

// Henkilökohtainen tilauslinkki: tilausnumero + tälle tilaukselle laskettu tunniste. Vain linkin saanut (sama puhelinnumero
// tai sama selain) avaa tilauksen, sen demomaksun ja agentin jäljen; julkista tilauslistaa ei ole. Avain johdetaan
// WEBCHAT_SECRETista omalla etuliitteellään (sama salaisuus on botilla ja Workerilla). Luontiaika sitoo linkin tähän
// tilaukseen: jos sama numero joskus toistuisi uudessa kannassa, vanha linkki ei avaa uutta tilausta.
// Sama laskenta Workerissa: deploy/cloudflare/src/demo-payment.ts orderLinkToken.
export function orderLinkToken(secret, orderId, createdAt) {
  return crypto.createHmac('sha256', secret).update(`aimo-order-link-v1\0${orderId}\0${createdAt}`).digest('base64url');
}

// The publisher origin is server configuration. Neither messages nor browser input
// can choose the destination or authorize a payment.
// onCheckout(orderId): pilvi välittää vahvistetun tilauksen maksusivulle ennen vastausta, jotta maksusivu löytää sen
// heti ensimmäisellä haulla. Odotus on rajattu (checkoutWaitMs); virhe tai hitaus ei estä vastausta, ja tavallinen
// julkaisu vastauksen jälkeen ja minuutin ajastin välittävät tilauksen joka tapauksessa.
export function withDemoCheckout(ordering, { baseUrl, secret, orderCreatedAt, onCheckout, checkoutWaitMs = 6000 } = {}) {
  if (!baseUrl?.trim()) return ordering;
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Demomaksun osoitteen on oltava julkinen HTTPS-juuriosoite.');
  }
  // Ilman salaisuutta tai luontiaikaa linkkiä ei voisi avata, joten painiketta ei näytetä lainkaan.
  const signing = typeof secret === 'string' && secret.length >= 32 && typeof orderCreatedAt === 'function';
  return { ...ordering, async chat(args) {
    const result = await ordering.chat(args);
    if (!signing || result.status !== 'confirmed' || !ORDER_ID.test(result.orderId || '')) return result;
    const createdAt = await orderCreatedAt(result.orderId);
    if (typeof createdAt !== 'string' || !createdAt) return result;
    if (typeof onCheckout === 'function') {
      let timer;
      await Promise.race([Promise.resolve().then(() => onCheckout(result.orderId)).catch(() => {}),
        new Promise((resolve) => { timer = setTimeout(resolve, checkoutWaitMs); })]);
      clearTimeout(timer);
    }
    return { ...result, checkout: { mode: 'demo', url: `${base.origin}/demo-payment.html#${result.orderId}.${orderLinkToken(secret, result.orderId, createdAt)}` } };
  } };
}
