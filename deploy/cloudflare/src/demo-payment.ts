// A demo-only payment gate. No card details, payment provider, or money transfer.
import type { PublicOrder } from "./protocol.ts";

export type DemoPaymentEnv = Pick<Env, "DB" | "SYNC_TOKEN"> & { DEMO_PAYMENTS_ENABLED?: string; WEBCHAT_SECRET?: string };
type PaymentRow = { order_id: string; status: "pending" | "paid"; amount_net_cents: number; created_at: number; expires_at: number; paid_at: number | null };
type EventRow = { json: string };
// Called after every accepted success; the bot sends its WhatsApp thank-you only once per order (order-paid.ts).
type OnPaid = (orderId: string) => void;
const TTL = 24 * 3600_000;
const PREFIX = "/api/demo-payments/";
const ORDER_ID = /^AGW-\d{8}-\d{4,12}$/;
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const enabled = (env: DemoPaymentEnv) => env.DEMO_PAYMENTS_ENABLED === "true";

async function paymentRow(env: DemoPaymentEnv, orderId: string) {
  return env.DB.prepare("SELECT * FROM demo_payments WHERE order_id=?").bind(orderId).first<PaymentRow>();
}
async function eventRow(env: DemoPaymentEnv, orderId: string) {
  return env.DB.prepare("SELECT json FROM order_events WHERE order_id=?").bind(orderId).first<EventRow>();
}
async function signature(env: DemoPaymentEnv, row: PaymentRow) {
  if (!env.SYNC_TOKEN || env.SYNC_TOKEN.length < 32) throw new Error("Payment link secret missing");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.SYNC_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const data = encoder.encode(`aimo-demo-payment-v1\0${row.order_id}\0${row.created_at}\0${row.expires_at}\0${row.amount_net_cents}`);
  return { key, data };
}
async function linkToken(env: DemoPaymentEnv, row: PaymentRow) {
  const { key, data } = await signature(env, row);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const bearer = (request: Request) => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "")?.[1] || null;
const fromBase64Url = (token: string) => Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/") + "="), c => c.charCodeAt(0));
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function authenticate(request: Request, env: DemoPaymentEnv, row: PaymentRow) {
  const token = bearer(request);
  if (!token) return false;
  const { key, data } = await signature(env, row);
  return crypto.subtle.verify("HMAC", key, fromBase64Url(token), data);
}

// ---------- Henkilökohtainen tilauslinkki ----------
// Botti antaa vahvistetulle tilaukselle linkin demo-payment.html#<numero>.<tunniste>, jossa tunniste on
// HMAC(WEBCHAT_SECRET, "aimo-order-link-v1\0<numero>\0<luontiaika>") (server/whatsapp/checkout.mjs). Vain linkin saanut
// puhelinnumero tai selain avaa tilauksen, sen demomaksun ja agentin jäljen. Julkista tilauslistaa ei ole.
async function orderLinkKey(env: DemoPaymentEnv) {
  if (!env.WEBCHAT_SECRET || env.WEBCHAT_SECRET.length < 32) return null;
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.WEBCHAT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const orderLinkData = (orderId: string, createdAt: string) => new TextEncoder().encode(`aimo-order-link-v1\0${orderId}\0${createdAt}`);
/** Same value as the bot computes. Exported for tests and for building the owner's own link. */
export async function orderLinkToken(env: DemoPaymentEnv, orderId: string, createdAt: string) {
  const key = await orderLinkKey(env);
  if (!key) return null;
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, orderLinkData(orderId, createdAt))));
}
/** The stored public order when `token` is this order's own link, else null. */
export async function verifyOrderLinkToken(env: DemoPaymentEnv, orderId: string, token: string | null) {
  if (!ORDER_ID.test(orderId) || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const key = await orderLinkKey(env);
  const event = key && await eventRow(env, orderId);
  if (!event) return null;
  const order = (JSON.parse(event.json) as { order: PublicOrder }).order;
  const ok = order.orderId === orderId && await crypto.subtle.verify("HMAC", key, fromBase64Url(token), orderLinkData(orderId, order.createdAt));
  return ok ? order : null;
}

/** True when the request carries this order's demo payment capability or its owner's link. Other pages of the same order reuse it. */
export async function verifyDemoPaymentLink(env: DemoPaymentEnv, orderId: string, request: Request) {
  if (!ORDER_ID.test(orderId)) return false;
  const row = await paymentRow(env, orderId);
  if (row && await authenticate(request, env, row)) return true;
  return Boolean(await verifyOrderLinkToken(env, orderId, bearer(request)));
}

/**
 * "Omat tilaukset": only orders whose own links this browser holds. Each link is checked; unknown or forged ones are
 * left out without saying why. The returned link is the same personal link, never the payment capability.
 */
export async function ownOrders(env: DemoPaymentEnv, links: { orderId: string; token: string }[], origin: string) {
  const orders = [];
  for (const { orderId, token } of links) {
    const order = await verifyOrderLinkToken(env, orderId, token);
    if (!order) continue;
    const row = await paymentRow(env, orderId);
    const url = `${origin}/demo-payment.html#${orderId}.${token}`;
    orders.push({ ...order, demoPayment: row ? { mode: "demo" as const, status: row.status, expiresAt: row.expires_at, url } : null, link: url });
  }
  return orders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Call after storing the authenticated order event. Returns null when no demo payment applies. An order without a
 * known, valid total gets no demo payment, and the order route and the publisher are not blocked (#25).
 */
export async function registerDemoPayment(env: DemoPaymentEnv, orderId: string, now = Date.now()) {
  if (!enabled(env)) return null;
  const event = await eventRow(env, orderId);
  if (!event) throw new Error("Order event missing");
  const existing = await paymentRow(env, orderId);
  if (existing) return existing;
  const order = (JSON.parse(event.json) as { order: PublicOrder }).order;
  if (order.orderId !== orderId || order.status !== "confirmed") throw new Error("A confirmed order is required");
  const cents = typeof order.net === "number" && Number.isFinite(order.net) && order.net >= 0 ? Math.round(order.net * 100) : NaN;
  if (!Number.isSafeInteger(cents)) {
    console.error(JSON.stringify({ event: "demo_payment_unavailable", orderId, reason: "total_missing" }));
    return null;
  }
  await env.DB.prepare(`INSERT INTO demo_payments(order_id,status,amount_net_cents,created_at,expires_at)
    VALUES(?,'pending',?,?,?) ON CONFLICT(order_id) DO NOTHING`).bind(orderId, cents, now, now + TTL).run();
  return paymentRow(env, orderId);
}

/** Only attach to the intentionally public, synthetic demo order projection. */
export async function describeDemoPayment(env: DemoPaymentEnv, orderId: string, origin: string) {
  const row = await paymentRow(env, orderId);
  if (!row) return null;
  return { mode: "demo" as const, status: row.status, expiresAt: row.expires_at,
    url: `${origin}/demo-payment.html#${row.order_id}.${await linkToken(env, row)}` };
}

async function readAction(request: Request) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let text = "", bytes = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 1024) { await reader.cancel(); return null; }
    text += decoder.decode(part.value, { stream: true });
  }
  try {
    const input = JSON.parse(text + decoder.decode());
    return input && Object.keys(input).length === 1 && ["success", "cancel"].includes(input.simulate) ? input.simulate : null;
  } catch { return null; }
}

/** Route before the Worker's final 404. */
export async function handleDemoPayment(request: Request, env: DemoPaymentEnv, now = Date.now(), onPaid?: OnPaid): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const orderId = url.pathname.slice(PREFIX.length);
  if (!ORDER_ID.test(orderId)) return json({ error: "Demomaksua ei löydy." }, 404);
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Menetelmä ei ole sallittu." }, 405);
  try {
    const row = await paymentRow(env, orderId);
    // Either the payment capability or the owner's personal order link opens the same demo payment.
    const allowed = (row && await authenticate(request, env, row)) || await verifyOrderLinkToken(env, orderId, bearer(request));
    if (!allowed) return json({ error: "Demomaksulinkki ei ole voimassa." }, 404);
    if (!row) return json({ error: "Tällä tilauksella ei ole demomaksua." }, 404);
    if (row.status !== "paid" && row.expires_at <= now) return json({ error: "Demomaksulinkki vanhentui. Ota yhteys demon ylläpitäjään." }, 410);
    const event = await eventRow(env, orderId);
    if (!event) return json({ error: "Tilausta ei löydy." }, 404);
    const order = (JSON.parse(event.json) as { order: PublicOrder }).order;
    if (request.method === "GET") {
      return json({ mode: "demo", order, payment: { status: row.status, amountNetCents: row.amount_net_cents, currency: "EUR", paidAt: row.paid_at } });
    }
    if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ error: "Avaa maksusivu alkuperäisestä linkistä." }, 403);
    }
    const action = await readAction(request);
    if (!action) return json({ error: "Valitse demomaksun hyväksyminen tai keskeyttäminen." }, 400);
    if (action === "cancel") return json({ mode: "demo", status: row.status });
    // Retried, double-clicked, or concurrent successes preserve the original paid_at.
    await env.DB.prepare("UPDATE demo_payments SET status='paid',paid_at=? WHERE order_id=? AND status='pending' AND expires_at>?")
      .bind(now, orderId, now).run();
    const paid = await paymentRow(env, orderId);
    if (paid?.status !== "paid") return json({ error: "Demomaksulinkki vanhentui." }, 410);
    onPaid?.(orderId);
    return json({ mode: "demo", status: "paid", paidAt: paid.paid_at });
  } catch {
    // Never log request URLs or capabilities.
    console.error(JSON.stringify({ event: "demo_payment_failed", orderId }));
    return json({ error: "Demomaksun käsittely ei onnistunut. Voit yrittää samaa toimintoa uudelleen." }, 503);
  }
}
