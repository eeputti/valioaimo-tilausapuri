// REST- ja MCP-sovittimet samaan sopimukseen (contract.mjs) + ihmisen konsoli (hyväksynnät, mandaatti, aikajana).
import { OPERATIONS, REASONS, GATEWAY, AGENT_INSTRUCTIONS } from './contract.mjs';
import { searchProducts, requestQuote, placeOrder, addToOrder, getOrder, listOrders, decideApproval, acceptSuggestion, auditTrail, mandateOf, productTypes, GatewayError } from './service.mjs';
import { buyers, ledger, onLedger } from './store.mjs';
import { seedBuyers, updateMandate, publicMandate } from './mandate.mjs';
import { jwks } from './signing.mjs';
import { clock } from './clock.mjs';
import { apiMode, config } from '../config.mjs';
import { apiStats } from '../valioApi.mjs';
import { watchReport, WATCH_DISCLOSURE } from './watch.mjs';
import { SUGGEST_DISCLOSURE } from './suggest.mjs';

const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let data = ''; req.on('data', (c) => { data += c; if (data.length > 2e6) reject(new GatewayError(413, 'TOO_LARGE', 'Pyyntö on liian suuri')); }); req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(new GatewayError(400, 'INVALID_JSON', 'Pyynnön runko ei ole kelvollista JSONia')); } }); req.on('error', reject); });
const baseUrlOf = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

function authenticate(req, url) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  const key = bearer || req.headers['x-buyer-key'] || url.searchParams.get('key');
  const buyer = key ? buyers.byKey(String(key).trim()) : null;
  if (!buyer) throw new GatewayError(401, 'UNAUTHENTICATED', 'Ostajan avain puuttuu tai on väärä. Lähetä otsake "Authorization: Bearer <avain>". Demoavaimet: README.');
  return buyer;
}

// Operaatioiden toteutukset: sama taulu REST:lle ja MCP:lle.
const TOOLS = {
  search_products: (buyer, args) => searchProducts(buyer, args),
  request_quote: (buyer, args) => requestQuote(buyer, args),
  place_order: (buyer, args, ctx) => placeOrder(buyer, args, ctx),
  add_to_order: (buyer, args, ctx) => addToOrder(buyer, args, ctx),
  get_order: (buyer, args) => getOrder(buyer, args.orderId),
  get_audit_trail: (buyer, args) => auditTrail(buyer, args.orderId),
  get_mandate: (buyer) => mandateOf(buyer),
};

function capabilities(req) {
  const base = baseUrlOf(req);
  return {
    name: GATEWAY.title, id: GATEWAY.name, version: GATEWAY.version, clock: clock.info(),
    description: 'Avoin ovi ostoagenteille Valio Aimon tukkuun: todennettavat tarjoukset, eurorajoitetut mandaatit, ihmisen hyväksyntä kun sillä on väliä, ja muuttumaton jälki jokaisesta päätöksestä.',
    contract: { openapi: `${base}/openapi.json`, rest: `${base}/v1`, mcp: `${base}/mcp`, jwks: `${base}/.well-known/jwks.json` },
    auth: { type: 'bearer', note: 'Ostajakohtainen avain. Avain määrää mandaatin.' },
    operations: OPERATIONS.map((o) => ({ name: o.name, rest: `${o.method} ${o.path}`, summary: o.summary })),
    offers: { format: 'JWS compact', alg: 'EdDSA (Ed25519)', validityMinutes: 15, verification: 'Julkinen avain: jwks. Portti hylkää muokatun tai vanhentuneen tarjouksen.' },
    orderStatuses: ['confirmed', 'pending_approval', 'rejected'],
    monitoring: WATCH_DISCLOSURE,
    suggestions: SUGGEST_DISCLOSURE,
    reasonCodes: Object.fromEntries(Object.entries(REASONS).map(([k, v]) => [k, v.en])),
    productTypes: productTypes().map((t) => t.id),
    dataSource: apiMode() === 'live' ? 'Valio Aimo Junction 2026 mock API (live price + availability)' : 'SIMULATED price + availability (no API key)',
    commitment: 'The Junction mock API has no order endpoint; commitments are recorded in the gateway ledger.',
  };
}

function openapi(req) {
  const paths = {};
  for (const op of OPERATIONS) {
    const item = (paths[op.path] ||= {});
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    item[op.method.toLowerCase()] = {
      operationId: op.name, summary: op.summary, description: op.description, tags: ['Agent API'], security: [{ buyerKey: [] }],
      ...(params.length ? { parameters: params } : {}),
      // polkuparametri (esim. orderId) kulkee REST:ssä polussa, joten se jätetään pois rungon skeemasta
      ...(op.method === 'POST' ? { requestBody: { required: true, content: { 'application/json': { schema: params.length ? { ...op.input, required: (op.input.required || []).filter((r) => !params.some((x) => x.name === r)), properties: Object.fromEntries(Object.entries(op.input.properties).filter(([k]) => !params.some((x) => x.name === k))) } : op.input } } } } : {}),
      responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } }, 400: { $ref: '#/components/responses/Error' }, 401: { $ref: '#/components/responses/Error' } },
    };
  }
  return {
    openapi: '3.1.0', info: { title: GATEWAY.title, version: GATEWAY.version, description: 'Sama sopimus on tarjolla myös MCP-työkaluina osoitteessa /mcp. Syykoodit: x-reason-codes.' },
    servers: [{ url: baseUrlOf(req) }], paths,
    components: {
      securitySchemes: { buyerKey: { type: 'http', scheme: 'bearer' } },
      responses: { Error: { description: 'Virhe', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } } } } },
    },
    'x-reason-codes': REASONS,
    'x-monitoring': WATCH_DISCLOSURE,
    'x-suggestions': SUGGEST_DISCLOSURE,
  };
}

// ---------- MCP (Streamable HTTP, tilaton): JSON-RPC 2.0 POST /mcp ----------
async function mcpMessage(msg, req, url) {
  const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid Request');
  if (msg.id === undefined) return null; // ilmoitus (esim. notifications/initialized): ei vastausta
  switch (msg.method) {
    case 'initialize': return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: GATEWAY.name, title: GATEWAY.title, version: GATEWAY.version }, instructions: AGENT_INSTRUCTIONS });;
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: OPERATIONS.map((o) => ({ name: o.name, title: o.summary, description: o.description, inputSchema: o.input })) });
    case 'tools/call': {
      const fn = TOOLS[msg.params?.name];
      if (!fn) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const result = await fn(authenticate(req, url), msg.params.arguments || {}, { baseUrl: baseUrlOf(req) });
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
      } catch (err) {
        if (!(err instanceof GatewayError)) console.error('[mcp]', err);
        return ok({ content: [{ type: 'text', text: JSON.stringify({ error: { code: err.code || 'INTERNAL', message: err.message } }) }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}


/** @returns {Promise<boolean>} true jos pyyntö käsiteltiin */
export async function handleGateway(req, res, url) {
  const p = url.pathname; const m = req.method;
  const isGateway = p.startsWith('/v1/') || p.startsWith('/console/') || p === '/mcp' || p === '/openapi.json' || p.startsWith('/.well-known/');
  if (!isGateway) return false;
  try {
    if (m === 'OPTIONS') { send(res, 204, undefined, { 'access-control-allow-headers': 'authorization, content-type, x-buyer-key, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' }); return true; }
    if (p === '/.well-known/jwks.json') return send(res, 200, jwks()), true;
    if (p === '/.well-known/agent-gateway.json') return send(res, 200, capabilities(req)), true;
    if (p === '/openapi.json') return send(res, 200, openapi(req)), true;

    if (p === '/mcp') {
      if (m !== 'POST') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'MCP: lähetä JSON-RPC POST-pyyntönä' } }, { allow: 'POST' }), true;
      const body = await readBody(req);
      const out = Array.isArray(body) ? (await Promise.all(body.map((x) => mcpMessage(x, req, url)))).filter(Boolean) : await mcpMessage(body, req, url);
      if (!out || (Array.isArray(out) && !out.length)) return send(res, 202), true;
      return send(res, 200, out), true;
    }

    // ----- Agent API -----
    if (p.startsWith('/v1/')) {
      const buyer = authenticate(req, url);
      const ctx = { baseUrl: baseUrlOf(req) };
      if (p === '/v1/products/search') {
        const args = m === 'POST' ? await readBody(req) : { query: url.searchParams.get('query') || url.searchParams.get('q') || undefined, productType: url.searchParams.get('productType') || undefined, claims: url.searchParams.get('claims')?.split(',').filter(Boolean), excludeAllergens: url.searchParams.get('excludeAllergens')?.split(',').filter(Boolean), limit: url.searchParams.get('limit') || undefined };
        return send(res, 200, searchProducts(buyer, args)), true;
      }
      if (p === '/v1/product-types' && m === 'GET') return send(res, 200, { items: productTypes() }), true;
      if (p === '/v1/mandate' && m === 'GET') return send(res, 200, mandateOf(buyer)), true;
      if (p === '/v1/quotes' && m === 'POST') return send(res, 200, await requestQuote(buyer, await readBody(req))), true;
      if (p === '/v1/orders' && m === 'POST') { const o = await placeOrder(buyer, await readBody(req), ctx); return send(res, o.duplicate ? 200 : 201, o), true; }
      if (p === '/v1/orders' && m === 'GET') return send(res, 200, { items: listOrders(buyer) }), true;
      const lm = /^\/v1\/orders\/([\w-]+)\/lines$/.exec(p);
      if (lm && m === 'POST') { const a = await addToOrder(buyer, { ...(await readBody(req)), orderId: lm[1] }, ctx); return send(res, a.duplicate ? 200 : 201, a), true; }
      const om = /^\/v1\/orders\/([\w-]+)(\/audit)?$/.exec(p);
      if (om && m === 'GET') return send(res, 200, om[2] ? auditTrail(buyer, om[1]) : getOrder(buyer, om[1])), true;
      throw new GatewayError(404, 'NOT_FOUND', 'Tuntematon reitti. Sopimus: /openapi.json');
    }

    // ----- Ihmisen konsoli (demossa avoin; tuotannossa ostajan kirjautumisen takana) -----
    if (p === '/console/state' && m === 'GET') {
      return send(res, 200, {
        clock: clock.info(), mode: { api: apiMode(), base: config.valioBase }, apiStats,
        buyers: buyers.all().map((b) => ({ id: b.id, name: b.name, kind: b.kind, approver: b.approver, demoKey: b.apiKey, ...publicMandate(b) })),
        orders: listOrders(null), ledger: ledger.recent(80), chain: ledger.verify(),
      }), true;
    }
    if (p === '/console/watch' && m === 'GET') return send(res, 200, watchReport(buyers.all())), true;
    if (p === '/console/events' && m === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      const off = onLedger((entry) => res.write(`event: ledger\ndata: ${JSON.stringify(entry)}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { off(); clearInterval(ping); });
      return true;
    }
    const sm = /^\/console\/orders\/([\w-]+)\/suggestions\/([\w-]+)$/.exec(p); // "Unohtuiko tämä?": yksi nappi hyväksyntänäkymässä
    if (sm && m === 'POST') { const body = await readBody(req); return send(res, 200, await acceptSuggestion(sm[1], sm[2], String(body.by || 'ostaja').slice(0, 60), { baseUrl: baseUrlOf(req) })), true; }
    const am = /^\/console\/orders\/([\w-]+)(\/(approve|reject|audit))?$/.exec(p);
    if (am && m === 'POST' && am[3] !== 'audit') { const body = await readBody(req); return send(res, 200, decideApproval(am[1], am[3], String(body.by || 'ostaja').slice(0, 60))), true; }
    if (am && m === 'GET') return send(res, 200, am[3] === 'audit' ? auditTrail(null, am[1]) : getOrder(null, am[1])), true;
    const bm = /^\/console\/buyers\/([\w-]+)\/mandate$/.exec(p);
    if (bm && m === 'POST') {
      const patch = await readBody(req);
      const b = updateMandate(bm[1], patch);
      if (!b) throw new GatewayError(404, 'BUYER_NOT_FOUND', 'Ostajaa ei löydy');
      ledger.append(`human:${b.approver || 'ostaja'}`, 'MANDATE_UPDATED', { patch, mandate: b.mandate }, { buyerId: b.id });
      return send(res, 200, publicMandate(b)), true;
    }
    throw new GatewayError(404, 'NOT_FOUND', 'Tuntematon reitti');
  } catch (err) {
    if (!(err instanceof GatewayError)) console.error('[gateway]', err);
    if (!res.headersSent) send(res, err.status || 500, { error: { code: err.code || 'INTERNAL', message: err.message, detail: err.detail }, clock: clock.info() });
    else res.end();
    return true;
  }
}

export function bootGateway() { seedBuyers(); }
