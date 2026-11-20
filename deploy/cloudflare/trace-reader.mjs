// Read-only: builds the public "what the agent saw" projection of one published WhatsApp order.
// It opens the WhatsApp, draft and gateway databases read-only and copies an allowlist of fields.
// Phone numbers, bindings, names, keys, signatures and cart links never leave this process.
import { openSqlite } from '../../server/sqlite.mjs';
import { MAX_TEXT, MAX_TURNS, parseAgentTrace } from './src/agent-trace.ts';

// Masks anything that looks like a link, an e-mail address or a phone number in free text.
export function redact(value, max = MAX_TEXT) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/giu, '[linkki]')
    .replace(/[^\s@<>()"',;:]{1,64}@[^\s@<>()"',;:]+\.[a-z]{2,}/giu, '[sähköposti]')
    .replace(/(?<![\w-])\+?\d(?:[\s-]?\d){8,}(?!\w)/gu, '[numero]')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, ' ')
    .slice(0, max);
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max = 180) => (typeof v === 'string' && v ? redact(v, max) : null);
const list = (v, max = 12) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[A-Z0-9_]{1,48}$/.test(x)).slice(0, max) : []);
const qty = (q) => (q && num(q.value) !== null && typeof q.unit === 'string' ? { value: q.value, unit: q.unit.slice(0, 12), ...(q.basis === 'items' ? { basis: 'items' } : {}) } : null);
const iso = (ms) => new Date(ms).toISOString();
const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

// What the shopper did on the cart page; the page sends fixed actions, so the result status names it.
const CART_ACTION = { confirmed: 'Vahvisti demotilauksen ostoskorisivulla', pending_approval: 'Lähetti tilauksen hyväksyttäväksi ostoskorisivulla',
  ready: 'Tarkisti ostoskorin', choosing: 'Muutti ostoskoria', collecting: 'Muutti ostoskoria' };

export function option(o, selectedId) {
  return { productId: String(o.productId).slice(0, 40), name: str(o.name), brand: str(o.brand, 60), salesUnits: num(o.salesUnits), salesUnitLabel: str(o.salesUnitLabel, 24),
    covers: qty(o.covers), unitPriceNet: num(o.unitPriceNet), lineNet: num(o.lineNet), deliveryDate: str(o.deliveryDate, 10),
    labels: list(o.labels), co2PerKg: num(o.co2PerKg), deliveryReliability: num(o.deliveryReliability), warning: str(o.warning, 240),
    // Miksi tämä vaihtoehto näytettiin (server/order-tools/why.mjs). Vanhoissa luonnoksissa sitä ei ole.
    pick: o.pick && typeof o.pick === 'object' ? { place: num(o.pick.place), codes: list(o.pick.codes) } : null, why: str(o.why, 160),
    selected: String(o.productId) === String(selectedId) };
}
// Rivin luvut: montako toimituspäivälle tilattavaa, sopivaa ja pyydettyä tuotetta haku löysi.
export function pool(p) {
  if (!p || typeof p !== 'object') return null;
  return { orderable: num(p.orderable), suitable: num(p.suitable), requested: num(p.requested), shown: num(p.shown), more: p.more === true, nextPage: p.nextPage === true };
}

function quoteNeed(need) {
  return { ref: String(need.ref).slice(0, 12), quantity: qty(need.requested?.quantity), candidates: num(need.requested?.candidates), rank: str(need.requested?.rank, 24),
    options: (need.options || []).slice(0, 6).map((o) => ({ optionId: str(o.optionId, 48), kind: str(o.kind, 24), net: num(o.totals?.net), vat: num(o.totals?.vat), gross: num(o.totals?.gross),
      deliveryDate: str(o.deliveryDate, 10), cutoffLabel: str(o.cutoffLabel, 60), flags: list(o.flags), mandate: str(o.mandatePreview?.status, 32), expiresAt: str(o.expiresAt, 40),
      // The signed offer itself is a bearer artefact; only the fact and algorithm are shown.
      signed: typeof o.offer === 'string' && o.offer.split('.').length === 3,
      lines: (o.lines || []).slice(0, 6).map((l) => ({ productId: String(l.productId).slice(0, 40), name: str(l.name), quantity: num(l.quantity), salesUnitLabel: str(l.salesUnitLabel, 24),
        unitPriceNet: num(l.unitPriceNet), lineNet: num(l.lineNet), vatRate: num(l.vatRate), priceSource: str(l.priceSource, 24),
        logisticModel: str(l.availability?.logisticModel, 24), stockKnown: l.availability?.stockKnown === true, availableDate: str(l.availability?.deliveryDate, 10),
        closingTime: str(l.closingTime, 40), allergens: list(l.allergens), co2PerKg: num(l.co2PerKg), deliveryReliability: num(l.deliveryReliability) })) })) };
}

// Ledger payloads hold idempotency keys and draft references; only these fields are shown per event type.
const LEDGER_FIELDS = {
  QUOTE_REQUESTED: (p) => ({ deliveryDate: str(p.deliveryDate, 10), productsPriced: num(p.productsPriced), priceSource: str(p.priceSource, 24),
    needs: (p.needs || []).slice(0, 20).map((n) => ({ ref: str(n.ref, 12), quantity: qty(n.quantity), candidates: num(n.candidates) })) }),
  CANDIDATES_EXCLUDED: (p) => ({ ref: str(p.ref, 12), summary: Object.fromEntries(Object.entries(p.summary || {}).filter(([k, v]) => /^[A-Z_]{1,40}$/.test(k) && num(v) !== null).slice(0, 10)) }),
  OFFER_ISSUED: (p) => ({ offerId: str(p.offerId, 48), kind: str(p.kind, 24), net: num(p.net), lines: (p.lines || []).slice(0, 6).map((l) => str(l, 80)), flags: list(p.flags), expiresAt: str(p.expiresAt, 40) }),
  ORDER_RECEIVED: (p) => ({ offers: num(p.offers) }),
  OFFER_VERIFIED: (p) => ({ offers: Array.isArray(p.offers) ? p.offers.length : num(p.offers), failures: Array.isArray(p.failures) ? p.failures.length : 0, algorithm: str(p.algorithm, 40) }),
  LIVE_RECHECK: (p) => ({ products: num(p.products), changed: Array.isArray(p.changed) ? p.changed.length : 0, priceSource: str(p.priceSource, 24) }),
  MANDATE_EVALUATED: (p) => ({ approvalLevel: str(p.approvalLevel, 32), outcome: str(p.outcome, 32), reasons: list(p.reasons) }),
  WATCH_EVALUATED: (p) => ({ historyOrders: num(p.historyOrders), outcome: str(p.outcome, 32), findings: Array.isArray(p.findings) ? p.findings.length : 0 }),
  ORDER_CONFIRMED: (p) => ({ net: num(p.net), reasons: list(p.reasons) }),
  ORDER_PENDING_APPROVAL: (p) => ({ net: num(p.net), reasons: list(p.reasons) }),
};

/**
 * @returns the trace (validated with the Worker's own parser) or null when the conversation is no longer stored.
 */
export function readAgentTrace({ orderId, gatewayFile, whatsappFile, draftFile, ledgerHead = null, now = Date.now() }) {
  if (!gatewayFile || !whatsappFile || !draftFile) throw new Error('Jäljen kantapolut puuttuvat.');
  const g = openSqlite(gatewayFile, { readOnly: true });
  const w = openSqlite(whatsappFile, { readOnly: true });
  const d = openSqlite(draftFile, { readOnly: true });
  try {
    const row = g.prepare('SELECT buyer_id,json FROM orders WHERE id=?').get(orderId);
    if (!row) return null;
    const order = JSON.parse(row.json);
    const binding = String(row.buyer_id).replace(/^whatsapp-demo-/, '');
    const phone = w.prepare('SELECT phone FROM members WHERE binding=?').get(binding)?.phone;
    const draftId = /^whatsapp:(WD-[\w-]{1,80})$/.exec(order.buyerReference || '')?.[1];
    const draftRow = draftId && d.prepare('SELECT conversation,json FROM drafts WHERE id=?').get(draftId);
    if (!phone || !draftRow) return null;
    const draft = JSON.parse(draftRow.json);

    // Turns of this draft, in order. Turn results are keyed by the WhatsApp message id or a cart-page action id.
    // Turn results in the order they were written (the draft store may run on the demo clock); only inbox rows carry real times.
    const results = d.prepare('SELECT rowid,message_id,created,json FROM turn_results WHERE conversation=? ORDER BY rowid').all(draftRow.conversation)
      .map((r) => ({ id: r.message_id, created: r.created, result: json(r.json) || {} })).filter((r) => r.result.draftId === draftId);
    if (!results.length) return null;
    const byId = new Map(results.map((r) => [r.id, r]));
    const inbox = (id) => w.prepare("SELECT id,text,kind,received,reply FROM inbox WHERE id=? AND phone=?").get(id, phone);
    const parts = (id, fallback) => {
      const stored = w.prepare('SELECT text FROM reply_parts WHERE message_id=? ORDER BY part').all(id).map((p) => p.text);
      return (stored.length ? stored : fallback ? [fallback] : []).slice(0, 8).map((t) => redact(t));
    };
    const real = results.map((r) => inbox(r.id)?.received).filter((t) => typeof t === 'number');
    const first = real.length ? Math.min(...real) : Math.min(...results.map((r) => r.created));
    const lastReal = real.length ? Math.max(...real) : first;
    // Messages the ordering core did not record (for example "ok" → cart link) up to 10 minutes after the last turn,
    // and up to two greetings just before the first turn. Messages of another draft end the window.
    const window = w.prepare("SELECT id,text,kind,received,reply FROM inbox WHERE phone=? AND kind='text' AND received BETWEEN ? AND ? ORDER BY received,rowid").all(phone, first - 180_000, lastReal + 600_000);
    const otherDraft = (id) => { const r = d.prepare('SELECT json FROM turn_results WHERE message_id=?').get(id); const j = r && json(r.json); return j?.draftId && j.draftId !== draftId; };
    const before = window.filter((m) => m.received < first && !otherDraft(m.id)).slice(-2);
    const stop = window.find((m) => m.received > lastReal && otherDraft(m.id))?.received ?? Infinity;
    const during = window.filter((m) => m.received >= first && m.received < stop && !byId.has(m.id) && !otherDraft(m.id));

    const items = [];
    for (const m of [...before, ...during]) items.push({ key: m.received, turn: { at: iso(m.received), source: 'whatsapp', customer: redact(m.text, 1200), action: null, replies: parts(m.id, m.reply), status: null, revision: null } });
    results.forEach((r, i) => {
      const m = inbox(r.id);
      if (m && m.kind !== 'text') return;
      // Vain ostoskorisivun toiminnot ovat ilman viestiriviä; vanhan paikallisen /demo-sivun viestejä ei tallennettu.
      if (!m && !String(r.id).startsWith('cart:')) return;
      if (m) { items.push({ key: m.received, turn: { at: iso(m.received), source: 'whatsapp', customer: redact(m.text, 1200), action: null, replies: parts(m.id, m.reply), status: str(r.result.status, 32), revision: num(r.result.revision) } }); return; }
      // A cart action happened before the next recorded chat turn (or at the end); its own timestamp may be demo time.
      const next = results.slice(i + 1).map((x) => inbox(x.id)?.received).find((t) => typeof t === 'number');
      items.push({ key: (next ?? Number.MAX_SAFE_INTEGER) - 0.5 + i / 1e6, cart: true, turn: { at: null, source: 'cart', customer: null, action: CART_ACTION[r.result.status] || 'Toiminto ostoskorisivulla',
        replies: r.result.text ? [redact(r.result.text)] : [], status: str(r.result.status, 32), revision: num(r.result.revision) } });
    });
    items.sort((a, b) => a.key - b.key);
    let clock = first;
    const turns = items.map((x) => { if (!x.cart) clock = x.key; return x.cart ? { ...x.turn, at: iso(clock) } : x.turn; });
    if (!turns.length) return null;

    const lines = (draft.lines || []).slice(0, 30);
    const understood = { deliveryDate: str(draft.deliveryDate, 10),
      diet: { claims: list(draft.diet?.claims), excludeAllergens: list(draft.diet?.excludeAllergens) },
      lines: lines.map((l) => ({ ref: String(l.ref).slice(0, 12), term: str(l.productTerm, 80), quantity: qty(l.quantity), claims: list(l.claims), excludeAllergens: list(l.excludeAllergens),
        selectedProductId: l.selectedProductId ? String(l.selectedProductId).slice(0, 40) : null, selectedName: str(l.selectedName) })) };
    const options = lines.map((l) => ({ ref: String(l.ref).slice(0, 12), term: str(l.productTerm, 80),
      seen: Array.isArray(draft.seen?.[l.ref]) ? draft.seen[l.ref].length : null,
      pool: pool(draft.offered?.[l.ref]?.[0]?.pool),
      shown: (draft.offered?.[l.ref] || []).slice(0, 8).map((o) => option(o, l.selectedProductId)) }));

    // Every quote this draft asked for: the buyer's quotes between the first turn and the order.
    const finalQuoteId = order.offers?.[0]?.quoteId || draft.quote?.quoteId || null;
    const quoteRows = g.prepare('SELECT id,created_at FROM quotes WHERE buyer_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at').all(row.buyer_id, iso(Math.min(...results.map((r) => r.created))), order.createdAt);
    const quoteIds = [...new Set([...quoteRows.map((q) => q.id), ...(finalQuoteId ? [finalQuoteId] : [])])];
    const finalQuote = finalQuoteId && json(g.prepare('SELECT json FROM quotes WHERE id=?').get(finalQuoteId)?.json || '');
    const ledgerRows = g.prepare(`SELECT seq,ts,actor,type,quote_id,order_id,payload,hash FROM ledger WHERE order_id=? OR quote_id IN (${quoteIds.map(() => '?').join(',') || "''"}) ORDER BY seq`).all(orderId, ...quoteIds);
    const events = ledgerRows.filter((e) => LEDGER_FIELDS[e.type]).slice(-70).map((e) => ({ seq: e.seq, at: e.ts, type: e.type,
      actor: String(e.actor).startsWith('agent:') ? 'agent' : String(e.actor).slice(0, 24), hash: String(e.hash).slice(0, 12), detail: LEDGER_FIELDS[e.type](json(e.payload) || {}) }));

    const trace = {
      version: 1, orderId, observedAt: now,
      order: { status: order.status, createdAt: order.createdAt, deliveryDate: order.deliveryDate || null, requestedDeliveryDate: order.requestedDeliveryDate || null,
        cutoffLabel: str(order.cutoffLabel, 60), net: num(order.totals?.net), vat: num(order.totals?.vat), gross: num(order.totals?.gross), simulated: order.commit?.simulated === true,
        lines: (order.lines || []).slice(0, 50).map((l) => ({ productId: String(l.productId).slice(0, 40), name: str(l.name), quantity: num(l.quantity), unit: str(l.salesUnitLabel || l.salesUnit, 24),
          unitPriceNet: num(l.unitPriceNet), net: num(l.lineNet), vatRate: num(l.vatRate), allergens: list(l.allergens) })) },
      turns: turns.slice(-MAX_TURNS),
      understood, options,
      quotes: { count: quoteIds.length, final: finalQuote ? { quoteId: str(finalQuote.quoteId, 48), createdAt: str(finalQuote.createdAt, 40), deliveryDate: str(finalQuote.deliveryDate, 10),
        needs: (finalQuote.needs || []).slice(0, 30).map(quoteNeed) } : null },
      ledger: { head: ledgerHead, events },
    };
    return parseAgentTrace(trace, now);
  } finally { g.close(); w.close(); d.close(); }
}
