// "Katso, mitä agentti näki": the conversation, interpretation, options and gateway checks behind one
// published demo order. The publisher machine pushes it with the sync token; a browser reads it only with
// the order's demo payment link, so the trace is never listed on its own.
export const TRACE_PREFIX = "/api/agent-traces";
export const MAX_TRACE_BYTES = 200_000;
export const MAX_TURNS = 80;
export const MAX_TEXT = 2400;

const ORDER_ID = /^AGW-\d{8}-\d{4,12}$/;
// Key names that belong to private records. The publisher never sends them; the Worker refuses them anyway.
const PRIVATE_KEY = /^(?:phone|binding|email|emailTo|token|offer|idempotencyKey|buyerReference|buyerId|buyerName|requestedBy|apiKey|signature)$/i;
// Strings that could leak a capability link or a phone number.
const LINK = /https?:\/\/|www\./i;
const PHONE = /(?<![\w-])\+?\d(?:[\s-]?\d){8,}(?!\w)/u;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

export type AgentTrace = { version: 1; orderId: string; observedAt: number; [key: string]: unknown };
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function clean(value: unknown, depth: number, path: string): Json {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Virheellinen luku: ${path}`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_TEXT || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) throw new Error(`Virheellinen teksti: ${path}`);
    if (LINK.test(value)) throw new Error(`Linkki tekstissä: ${path}`);
    return value;
  }
  if (depth > 10) throw new Error(`Liian syvä rakenne: ${path}`);
  if (Array.isArray(value)) {
    if (value.length > MAX_TURNS) throw new Error(`Liian pitkä lista: ${path}`);
    return value.map((item, i) => clean(item, depth + 1, `${path}[${i}]`));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 40) throw new Error(`Liian monta kenttää: ${path}`);
    const out: { [key: string]: Json } = {};
    for (const [key, item] of entries) {
      if (!KEY.test(key) || PRIVATE_KEY.test(key)) throw new Error(`Kenttä ei ole sallittu: ${path}.${key}`);
      out[key] = clean(item, depth + 1, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`Virheellinen arvo: ${path}`);
}

export function parseAgentTrace(value: unknown, now = Date.now()): AgentTrace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Virheellinen jälki.");
  const t = value as Record<string, unknown>;
  if (t.version !== 1) throw new Error("Virheellinen versio.");
  if (typeof t.orderId !== "string" || !ORDER_ID.test(t.orderId)) throw new Error("Virheellinen tilausnumero.");
  if (!Number.isSafeInteger(t.observedAt) || Math.abs(now - (t.observedAt as number)) > 300000) throw new Error("Jälki on liian vanha.");
  if (!Array.isArray(t.turns) || !t.turns.length || t.turns.length > MAX_TURNS) throw new Error("Keskustelu puuttuu.");
  for (const turn of t.turns) {
    const r = turn as Record<string, unknown>;
    if (!r || typeof r !== "object" || !["whatsapp", "cart"].includes(r.source as string)) throw new Error("Virheellinen viesti.");
    if (r.customer !== null && typeof r.customer !== "string") throw new Error("Virheellinen asiakasviesti.");
    if (!Array.isArray(r.replies) || r.replies.length > 8 || r.replies.some(x => typeof x !== "string")) throw new Error("Virheellinen vastaus.");
    // Free text written by people or the model: a phone number must have been masked by the publisher.
    if ([r.customer, ...r.replies].some(x => typeof x === "string" && PHONE.test(x))) throw new Error("Numero viestissä.");
  }
  for (const key of ["order", "understood", "quotes", "ledger"]) {
    if (!t[key] || typeof t[key] !== "object" || Array.isArray(t[key])) throw new Error(`Puuttuva osa: ${key}`);
  }
  if (!Array.isArray(t.options)) throw new Error("Puuttuva osa: options");
  const trace = clean(value, 0, "trace") as AgentTrace;
  if (JSON.stringify(trace).length > MAX_TRACE_BYTES) throw new Error("Liian suuri jälki.");
  return trace;
}

type TraceEnv = Pick<Env, "DB">;
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

/** The publisher's write. A newer observation of the same order replaces the stored one. */
export async function storeAgentTrace(env: TraceEnv, trace: AgentTrace, now = Date.now()) {
  const result = await env.DB.prepare(`INSERT INTO agent_traces(order_id,observed_at,received_at,json) VALUES(?,?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET observed_at=excluded.observed_at,received_at=excluded.received_at,json=excluded.json
    WHERE excluded.observed_at > agent_traces.observed_at`).bind(trace.orderId, trace.observedAt, now, JSON.stringify(trace)).run();
  return result.meta.changes > 0;
}

/**
 * GET /api/agent-traces/:orderId with the order's demo payment capability as the bearer token.
 * `verify` checks that capability; the payment module owns its secret and format.
 */
export async function handleAgentTraceRead(request: Request, env: TraceEnv, verify: (orderId: string, request: Request) => Promise<boolean>) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${TRACE_PREFIX}/`) || request.method !== "GET") return null;
  let orderId = url.pathname.slice(TRACE_PREFIX.length + 1);
  // "Näin se toimii" -sivun esimerkki: yksi ylläpitäjän D1:ssä valitsema tilaus (landing_settings.example_trace_order).
  const example = orderId === "esimerkki";
  if (!example && !ORDER_ID.test(orderId)) return json({ error: "Agentin jälkeä ei löydy." }, 404);
  try {
    if (example) {
      const chosen = await env.DB.prepare("SELECT value FROM landing_settings WHERE key='example_trace_order'").first<{ value: string }>();
      if (!chosen || !ORDER_ID.test(chosen.value)) return json({ error: "Esimerkkiä ei ole valittu.", code: "not_published" }, 404);
      orderId = chosen.value;
    } else if (!await verify(orderId, request)) return json({ error: "Linkki ei ole voimassa. Avaa jälki tilauksen maksusivulta." }, 404);
    const row = await env.DB.prepare("SELECT json,received_at FROM agent_traces WHERE order_id=?").bind(orderId).first<{ json: string; received_at: number }>();
    if (!row) return json({ error: "Agentin jälkeä ei ole vielä julkaistu tälle tilaukselle.", code: "not_published" }, 404);
    return json({ trace: JSON.parse(row.json), receivedAt: row.received_at });
  } catch {
    console.error(JSON.stringify({ event: "agent_trace_read_failed", orderId }));
    return json({ error: "Jäljen haku ei onnistunut. Yritä hetken kuluttua uudelleen." }, 503);
  }
}
