import { MAX_BODY_BYTES, parseSnapshot } from "./protocol.ts";
import { parseOrderEvent, type OrderEvent } from "./order-event.ts";
import { registerDemoPayment, handleDemoPayment, verifyDemoPaymentLink, ownOrders } from "./demo-payment.ts";
import { TRACE_PREFIX, parseAgentTrace, storeAgentTrace, handleAgentTraceRead } from "./agent-trace.ts";
import { handleWebChat, type WebChatEnv } from "./web-chat.ts";
import { notifyOrderPaid } from "./order-paid.ts";

type OrderEnv = Env & { DEMO_PAYMENTS_ENABLED?: string; WEBCHAT_SECRET?: string };
export const MAX_OWN_LINKS = 50;

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/**
 * Store an order event once per order instance (#24). The same order id with the same creation time is the same order:
 * a repeat is a duplicate. A different creation time means the gateway was reset and reused the number: the newer push
 * replaces the old record, and the old order's demo payment and agent trace go with it, so the new customer never sees
 * the old lines or total. An older push never replaces a newer one.
 */
async function storeOrderEvent(env: OrderEnv, event: OrderEvent, now: number) {
  const id = event.order.orderId, json = JSON.stringify(event);
  const stored = await env.DB.prepare("SELECT json FROM order_events WHERE order_id=?").bind(id).first<{ json: string }>();
  if (!stored) {
    const inserted = await env.DB.prepare(`INSERT INTO order_events(order_id,received_at,json) VALUES(?,?,?)
      ON CONFLICT(order_id) DO NOTHING`).bind(id, now, json).run();
    return inserted.meta.changes > 0 ? "stored" : "duplicate";
  }
  const previous = JSON.parse(stored.json) as OrderEvent;
  if (previous.order.createdAt === event.order.createdAt) return "duplicate";
  if (!(event.observedAt > previous.observedAt)) return "superseded";
  // Conditional on the row still holding the old event, so concurrent pushes replace it once.
  const statements = [
    env.DB.prepare("UPDATE order_events SET received_at=?,json=? WHERE order_id=? AND json=?").bind(now, json, id, stored.json),
    env.DB.prepare("DELETE FROM demo_payments WHERE order_id=? AND (SELECT json FROM order_events WHERE order_id=?)=?").bind(id, id, json),
    env.DB.prepare("DELETE FROM agent_traces WHERE order_id=? AND (SELECT json FROM order_events WHERE order_id=?)=?").bind(id, id, json),
  ];
  if (typeof env.DB.batch === "function") await env.DB.batch(statements);
  else for (const statement of statements) await statement.run();
  const after = await env.DB.prepare("SELECT json FROM order_events WHERE order_id=?").bind(id).first<{ json: string }>();
  return after?.json === json ? "replaced" : "duplicate";
}

async function authorized(request: Request, token: string) {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!supplied || supplied.length > 256) return false;
  // Compare fixed-size HMACs through Web Crypto, without an early-exit string comparison.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(token));
  return crypto.subtle.verify("HMAC", key, signature, enc.encode(supplied));
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Tyhjä pyyntö.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Liian suuri pyyntö."); }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true, mode: "public-order-demo", readOnly: false, demoPayments: true });
    // Tilaukset eivät ole julkisia: kukin näkee vain ne, joiden oman linkin hänen selaimensa tuntee (/api/my-orders).
    // Vanha julkinen lista vastaa yhä, mutta ilman tilauksia, jotta vanhat sivut ja tarkistukset eivät kaadu.
    if (url.pathname === "/api/orders" && request.method === "GET") {
      try {
        const row = await env.DB.prepare("SELECT received_at FROM demo_snapshot WHERE id=1").first<{ received_at: number }>();
        return json({ orders: [], totalOrders: 0, personal: true, receivedAt: row?.received_at ?? null, serverTime: Date.now() });
      } catch { return json({ error: "Tilausyhteyttä valmistellaan." }, 503); }
    }
    if (url.pathname === "/api/my-orders" && request.method === "POST") {
      if (!/^application\/json\b/.test(request.headers.get("content-type") || "")) return json({ error: "JSON vaaditaan." }, 415);
      let links: { orderId: string; token: string }[];
      try {
        const body = await readBody(request) as { links?: unknown };
        if (!Array.isArray(body?.links) || body.links.length > MAX_OWN_LINKS) throw new Error("links");
        links = body.links.map((l) => {
          const { orderId, token } = (l || {}) as Record<string, unknown>;
          if (typeof orderId !== "string" || typeof token !== "string" || orderId.length > 64 || token.length > 64) throw new Error("link");
          return { orderId, token };
        });
      } catch { return json({ error: "Virheellinen pyyntö." }, 400); }
      try {
        const row = await env.DB.prepare("SELECT received_at FROM demo_snapshot WHERE id=1").first<{ received_at: number }>();
        return json({ orders: await ownOrders(env as OrderEnv, links, url.origin), receivedAt: row?.received_at ?? null, serverTime: Date.now() });
      } catch { return json({ error: "Tilausyhteyttä valmistellaan." }, 503); }
    }
    if (url.pathname === "/api/sync" && request.method === "POST") {
      if (!(await authorized(request, env.SYNC_TOKEN))) return json({ error: "Ei julkaisuoikeutta." }, 401);
      if (!/^application\/json\b/.test(request.headers.get("content-type") || "")) return json({ error: "JSON vaaditaan." }, 415);
      let snapshot;
      try { snapshot = parseSnapshot(await readBody(request)); }
      catch { return json({ error: "Virheellinen tilannekuva." }, 400); }
      try {
        const result = await env.DB.prepare(`INSERT INTO demo_snapshot(id,observed_at,received_at,json) VALUES(1,?,?,?)
          ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,received_at=excluded.received_at,json=excluded.json
          WHERE excluded.observed_at > demo_snapshot.observed_at`)
          .bind(snapshot.observedAt, Date.now(), JSON.stringify(snapshot)).run();
        return json({ ok: true, updated: result.meta.changes > 0, orders: snapshot.orders.length });
      } catch { console.error(JSON.stringify({ event: "snapshot_write_failed" })); return json({ error: "Tallennus ei onnistunut." }, 503); }
    }
    if (url.pathname === "/api/order-events" && request.method === "POST") {
      if (!(await authorized(request, env.SYNC_TOKEN))) return json({ error: "Ei julkaisuoikeutta." }, 401);
      if (!/^application\/json\b/.test(request.headers.get("content-type") || "")) return json({ error: "JSON vaaditaan." }, 415);
      let event;
      try { event = parseOrderEvent(await readBody(request)); }
      catch { return json({ error: "Virheellinen tilaustapahtuma." }, 400); }
      try {
        const stored = await storeOrderEvent(env as OrderEnv, event, Date.now());
        // A newer order already holds this id: acknowledge, so the publisher stops resending the older one.
        if (stored === "superseded") return json({ ok: true, orderId: event.order.orderId, duplicate: true, superseded: true });
        // An order without a known total gets no demo payment; it must not block the publisher (#25).
        await registerDemoPayment(env as OrderEnv, event.order.orderId);
        return json({ ok: true, orderId: event.order.orderId, duplicate: stored === "duplicate", replaced: stored === "replaced" });
      } catch { console.error(JSON.stringify({ event: "order_event_write_failed" })); return json({ error: "Tallennus ei onnistunut." }, 503); }
    }
    if (url.pathname === TRACE_PREFIX && request.method === "POST") {
      if (!(await authorized(request, env.SYNC_TOKEN))) return json({ error: "Ei julkaisuoikeutta." }, 401);
      if (!/^application\/json\b/.test(request.headers.get("content-type") || "")) return json({ error: "JSON vaaditaan." }, 415);
      let trace;
      try { trace = parseAgentTrace(await readBody(request)); }
      catch { return json({ error: "Virheellinen agentin jälki." }, 400); }
      try { return json({ ok: true, orderId: trace.orderId, updated: await storeAgentTrace(env, trace) }); }
      catch { console.error(JSON.stringify({ event: "agent_trace_write_failed" })); return json({ error: "Tallennus ei onnistunut." }, 503); }
    }
    // "Katso, mitä agentti näki": readable only with the order's own demo payment link.
    const trace = await handleAgentTraceRead(request, env, (orderId, req) => verifyDemoPaymentLink(env as OrderEnv, orderId, req));
    if (trace) return trace;
    // Selainkeskustelu botin kanssa ja saman keskustelun ostoskori tällä sivustolla.
    const chat = await handleWebChat(request, env as WebChatEnv);
    if (chat) return chat;
    // Hyväksytty maksu: botti lähettää asiakkaalle kiitosviestin WhatsAppiin taustalla, maksusivun vastaus ei odota sitä.
    const payment = await handleDemoPayment(request, env as OrderEnv, Date.now(),
      orderId => ctx?.waitUntil(notifyOrderPaid(env as WebChatEnv, orderId)));
    if (payment) return payment;
    // Payment actions only simulate a payment. Publishing order events still needs the server's token.
    return json({ error: "Reittiä ei ole." }, 404);
  },
} satisfies ExportedHandler<Env>;
