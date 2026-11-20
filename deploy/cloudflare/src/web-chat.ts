// Selainkeskustelu ja ostoskori Workers-sivustolla. Botti pyörii omalla palvelimellaan (BACKEND, D1-asetus
// bot_backend_url); selain puhuu vain tälle Workerille. Worker antaa jokaiselle selaimelle oman istunnon (HttpOnly-eväste),
// rajaa viestimäärät ja välittää viestit botille jaetulla WEBCHAT_SECRETilla. Ostoskorisivu ja sen API välitetään
// samaan alkuperään, jolloin korin linkki, maksu ja agentin jälki pysyvät samalla sivustolla.
export const CHAT_PER_SESSION_DAY = 30;
export const CHAT_PER_DAY = 300;
const COOKIE = "aimo_chat";
const SESSION = /^[a-f0-9]{64}$/;
const MESSAGE_ID = /^[a-f0-9-]{36}$/i;
// Korisivu, sen tiedostot ja API sekä demomaksun painike, jotka botin palvelin tarjoaa.
const PROXIED = /^\/whatsapp\/(?:cart(?:\/[A-Za-z0-9._/-]{0,200}|\.js|\.css)?|checkout\.(?:js|css))$/;

export type WebChatEnv = Pick<Env, "DB"> & { WEBCHAT_SECRET?: string };
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
const unavailable = () => json({ error: "Botti on hetken tauolla. Kokeile hetken päästä uudelleen tai pyydä oikea WhatsApp-kokeilu etusivulta.", code: "offline" }, 503);

/** Botin palvelimen alkuperä (D1-asetus bot_backend_url), kun jaettu salaisuus on asetettu. */
export async function backend(env: WebChatEnv) {
  if (!env.WEBCHAT_SECRET || env.WEBCHAT_SECRET.length < 32) return null;
  const row = await env.DB.prepare("SELECT value FROM landing_settings WHERE key='bot_backend_url'").first<{ value: string }>().catch(() => null);
  try {
    const url = new URL(row?.value || "");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
function session(request: Request) {
  const value = /(?:^|;\s*)aimo_chat=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get("cookie") || "")?.[1];
  return value && SESSION.test(value) ? value : null;
}
function newSession() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
const cookie = (value: string, secure: boolean, maxAge = 7 * 86400) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
const sameOrigin = (request: Request, url: URL) => request.headers.get("origin") === url.origin && request.headers.get("sec-fetch-site") !== "cross-site";

async function readJson(request: Request) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return null;
  const text = await request.text();
  if (text.length > 8000) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
}
async function callBot(origin: string, env: WebChatEnv, action: string, body: Record<string, unknown>) {
  // Workers tukee vain follow/manual-asetuksia; uudelleenohjaus botilta on virhe.
  const response = await fetch(`${origin}/webchat/api/${action}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(90_000),
    headers: { authorization: `Bearer ${env.WEBCHAT_SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.status >= 300 && response.status < 400) return { status: 502, data: {} as Record<string, unknown> };
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, data };
}
// Botin korilinkit osoittavat sen omaan osoitteeseen; sivustolla sama kori avataan tältä alkuperältä.
const localLinks = (text: string, from: string, to: string) => text.split(`${from}/whatsapp/cart#`).join(`${to}/whatsapp/cart#`);

/** Kasvattaa päivän laskuria vain rajan alla. false = raja täynnä. */
async function count(env: WebChatEnv, key: string, limit: number) {
  const day = new Date().toISOString().slice(0, 10);
  const result = await env.DB.prepare(`INSERT INTO web_chat_usage(day,session,count) VALUES(?,?,1)
    ON CONFLICT(day,session) DO UPDATE SET count=count+1 WHERE web_chat_usage.count < ?`).bind(day, key, limit).run();
  return result.meta.changes > 0;
}

async function proxy(request: Request, url: URL, origin: string) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) return json({ error: "Menetelmä ei ole sallittu." }, 405);
  if (request.method === "POST" && !sameOrigin(request, url)) return json({ error: "Pyyntö ei tullut ostoskorisivulta." }, 403);
  const forward = new Headers();
  for (const name of ["accept", "content-type", "authorization"]) {
    const value = request.headers.get(name);
    if (value) forward.set(name, value);
  }
  // Korin API vertaa alkuperää omaan julkiseen osoitteeseensa; tämä Worker on sille sama sivu.
  if (request.method === "POST") { forward.set("origin", origin); forward.set("sec-fetch-site", "same-origin"); }
  let response: Response;
  try {
    response = await fetch(`${origin}${url.pathname}${url.search}`, { method: request.method, headers: forward, redirect: "manual", signal: AbortSignal.timeout(90_000),
      body: request.method === "POST" ? await request.arrayBuffer() : undefined });
  } catch { return unavailable(); }
  const out = new Headers(response.headers);
  for (const name of ["set-cookie", "server", "cf-ray", "nel", "report-to", "alt-svc"]) out.delete(name);
  if (url.pathname !== "/whatsapp/cart" || !/text\/html/i.test(out.get("content-type") || "") || request.method !== "GET") {
    return new Response(response.body, { status: response.status, headers: out });
  }
  // Sivuston välilehdet korisivun yläreunaan. Vain staattista HTML:ää ja saman alkuperän tiedostoja: korin CSP pysyy ennallaan.
  // Puhelimella mobile-gate.js (saman alkuperän skripti) piilottaa Keskustele-välilehden kuten sivuston muilla sivuilla.
  const html = (await response.text()).replace(/<\/head>/i, '<link rel="stylesheet" href="/site.css"><script src="/mobile-gate.js"></script></head>')
    .replace(/<body([^>]*)>/i, (tag) => `${tag}${siteHeader("ostoskori")}`);
  out.delete("content-length");
  return new Response(html, { status: response.status, headers: out });
}

export function siteHeader(current: string) {
  const tabs: [string, string, string][] = [["etusivu", "/", "Etusivu"], ["keskustele", "/keskustele", "Keskustele"], ["ostoskori", "/ostoskori", "Ostoskori"],
    ["miten", "/miten", "Näin se toimii"]];
  return `<header class="site-header"><a class="site-logo" href="/" aria-label="Aimo-tilausapurin etusivu"><img src="/aimo-logo.png" alt="Valio Aimo" width="120" height="42"></a><nav class="site-tabs" aria-label="Sivut">${
    tabs.map(([id, href, label]) => `<a href="${href}"${id === current ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav></header>`;
}

export async function handleWebChat(request: Request, env: WebChatEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (PROXIED.test(url.pathname)) {
    const origin = await backend(env);
    return origin ? proxy(request, url, origin) : unavailable();
  }
  if (!url.pathname.startsWith("/api/chat")) return null;
  const secure = url.protocol === "https:";
  const current = session(request);
  try {
    if (url.pathname === "/api/chat/reset" && request.method === "POST") {
      if (!sameOrigin(request, url)) return json({ error: "Pyyntö hylätty." }, 403);
      return json({ ok: true }, 200, { "set-cookie": cookie("", secure, 0) });
    }
    const origin = await backend(env);
    if (url.pathname === "/api/chat" && request.method === "GET") {
      if (!origin) return json({ available: false, messages: [] });
      if (!current) return json({ available: true, messages: [], limit: CHAT_PER_SESSION_DAY });
      const { status, data } = await callBot(origin, env, "history", { session: current });
      if (status !== 200) return json({ available: false, messages: [] });
      const messages = (Array.isArray(data.messages) ? data.messages : []) as { parts?: string[] }[];
      for (const m of messages) m.parts = (m.parts || []).map(p => localLinks(String(p), origin, url.origin));
      return json({ available: true, messages, limit: CHAT_PER_SESSION_DAY });
    }
    if (url.pathname === "/api/chat/cart" && request.method === "GET") {
      if (!origin) return unavailable();
      if (!current) return json({ url: null, lines: 0 });
      const { status, data } = await callBot(origin, env, "cart", { session: current });
      if (status !== 200) return unavailable();
      const link = typeof data.url === "string" ? new URL(data.url) : null;
      return json({ url: link && link.pathname === "/whatsapp/cart" ? `/whatsapp/cart${link.hash}` : null, lines: Number(data.lines) || 0 });
    }
    if (url.pathname !== "/api/chat" || request.method !== "POST") return json({ error: "Reittiä ei ole." }, 404);
    if (!sameOrigin(request, url)) return json({ error: "Pyyntö hylätty." }, 403);
    const input = await readJson(request);
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    if (!text || text.length > 2000) return json({ error: "Kirjoita enintään 2000 merkin viesti." }, 400);
    if (typeof input?.messageId !== "string" || !MESSAGE_ID.test(input.messageId)) return json({ error: "Virheellinen viesti." }, 400);
    if (!origin) return unavailable();
    const id = current || newSession();
    const setCookie: Record<string, string> = current ? {} : { "set-cookie": cookie(id, secure) };
    if (!await count(env, "*", CHAT_PER_DAY)) return json({ error: "Selainkokeilun päiväraja täyttyi. Kokeile WhatsAppissa: ohje on etusivulla.", code: "limit" }, 429, setCookie);
    if (!await count(env, id, CHAT_PER_SESSION_DAY)) return json({ error: `Tämän selaimen ${CHAT_PER_SESSION_DAY} viestin päiväraja täyttyi. Kokeile WhatsAppissa: ohje on etusivulla.`, code: "limit" }, 429, setCookie);
    let reply;
    try { reply = await callBot(origin, env, "chat", { session: id, text, messageId: input.messageId }); }
    catch { return unavailable(); }
    // Ei reittiä, ei avainta tai vastaus ei tullut botilta (tunneli alhaalla): botti on tauolla, ei viestin virhe.
    if ([401, 404].includes(reply.status) || (reply.status !== 200 && !reply.data.error)) return unavailable();
    if (reply.status !== 200) return json({ error: String(reply.data.error) }, reply.status === 429 ? 429 : 502, setCookie);
    const parts = (Array.isArray(reply.data.parts) ? reply.data.parts : []).map(p => localLinks(String(p), origin, url.origin));
    return json({ parts, status: reply.data.status ?? null }, 200, setCookie);
  } catch {
    console.error(JSON.stringify({ event: "web_chat_failed" }));
    return unavailable();
  }
}
