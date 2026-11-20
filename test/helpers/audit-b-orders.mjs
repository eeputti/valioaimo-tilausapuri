// Katselmoinnin #6 koeajuri: oikea gateway (service.mjs + store.mjs) omassa prosessissaan, simuloitu toimittajarajapinta
// viiveellä, jotta kaksi tilausta on yhtä aikaa tuoreen hintatarkistuksen await-kohdassa. Ympäristö (GATEWAY_DB ym.) tulee
// kutsujalta: tavallinen tiedostopolku = node:sqlite, file:-osoite = Turso/libsql-polku (server/sqlite.mjs).
// Tulostaa yhden JSON-rivin. Ei ulkoisia kutsuja.
import { DEFAULT_MANDATE } from '../../server/gateway/mandate.mjs';

const { requestQuote, placeOrder } = await import('../../server/gateway/service.mjs');
const { orders } = await import('../../server/gateway/store.mjs');

const delayMs = Number(process.env.AUDIT_B_DELAY_MS || 25);
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://supplier.invalid/api/')) throw new Error(`unexpected request ${url}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const body = JSON.parse(init.body);
  const products = body.products.map((productId) => (String(url).endsWith('/availability')
    ? { productId, salesBlock: false, logisticModel: 'Stock', closingTime: '2026-11-20T12:00:00+02:00', scheduleLines: [{ availableDate: '2026-11-18', availableAmount: 500, salesBlock: false, salesUnit: 'PCE' }] }
    : { productId, quantity: 1, error: false, netPriceFound: true, catalogPrice: { value: 2, valueWithTax: 2.27 }, tax: { taxRate: 13.5 } }));
  return new Response(JSON.stringify({ products }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const buyer = (id) => ({ id, name: `Testi ${id}`, mandate: { ...DEFAULT_MANDATE, approval: 'autonomous' } });
const quoteFor = async (b, qty = 2) => (await requestQuote(b, { deliveryDate: '2026-11-18', needs: [{ ref: 'milk', candidates: ['460013'], quantity: { value: qty, unit: 'PCS', basis: 'sales' }, allowSubstitutes: false }] })).needs[0].options[0].offer;
const brief = (o) => ({ orderId: o.orderId, buyerId: o.buyerId, status: o.status, duplicate: !!o.duplicate, reasons: (o.reasons || []).map((r) => r.code) });

const mode = process.argv[2];
const tag = process.env.AUDIT_B_TAG || 'p';
let out;
if (mode === 'race') {
  const a = buyer(`${tag}-a`), b = buyer(`${tag}-b`), c = buyer(`${tag}-c`), d = buyer(`${tag}-d`);
  const [offerA, offerB, offerC, offerD] = [await quoteFor(a), await quoteFor(b), await quoteFor(c), await quoteFor(d)];
  // 1) Kaksi eri ostajaa samaan aikaan: ennen korjausta sama numero (COUNT(*)+1) ja toinen ylikirjoitti toisen.
  const twoBuyers = await Promise.all([placeOrder(a, { offers: [offerA], idempotencyKey: `${tag}-key-a` }), placeOrder(b, { offers: [offerB], idempotencyKey: `${tag}-key-b` })]);
  const retryA = await placeOrder(a, { offers: [offerA], idempotencyKey: `${tag}-key-a` });
  // 2) Sama tarjous kahdella avaimella samaan aikaan: vain yksi saa käyttää sen.
  const sameOffer = await Promise.all([placeOrder(c, { offers: [offerC], idempotencyKey: `${tag}-key-c1` }), placeOrder(c, { offers: [offerC], idempotencyKey: `${tag}-key-c2` })]);
  // 3) Sama pyyntö kahdesti samaan aikaan (kadonnut vastaus + uusinta): yksi tilaus.
  const sameRequest = await Promise.all([placeOrder(d, { offers: [offerD], idempotencyKey: `${tag}-key-d` }), placeOrder(d, { offers: [offerD], idempotencyKey: `${tag}-key-d` })]);
  out = {
    twoBuyers: twoBuyers.map(brief), retryA: brief(retryA), sameOffer: sameOffer.map(brief), sameRequest: sameRequest.map(brief),
    stored: Object.fromEntries([...twoBuyers, ...sameOffer, ...sameRequest].map((o) => [o.orderId, orders.get(o.orderId) && { buyerId: orders.get(o.orderId).buyerId, status: orders.get(o.orderId).status }])),
    total: orders.list(null, 500).length,
  };
} else if (mode === 'burst') {
  // Useampi prosessi samaan kantaan: jokainen tekee N tilausta rinnakkain omalla ostajallaan.
  const n = Number(process.env.AUDIT_B_COUNT || 5);
  const b = buyer(`${tag}-burst`);
  const offers = [];
  for (let i = 0; i < n; i++) offers.push(await quoteFor(b, 1 + i));
  const placed = await Promise.all(offers.map((offer, i) => placeOrder(b, { offers: [offer], idempotencyKey: `${tag}-burst-${i}` })));
  out = { placed: placed.map(brief) };
} else throw new Error(`tuntematon tila ${mode}`);
console.log(JSON.stringify(out));
