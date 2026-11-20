// v2-arvioinnin mittari: estää ulkoiset pyynnöt ja laskee jokaisen Anthropic-kutsun tokenit ja hinnan.
// Asennetaan ennen yhtäkään palvelinmoduulia, koska Anthropic-asiakas ottaa globaalin fetchin talteen luodessaan
// (SDK:n getDefaultFetch). Mittari näkee siksi sekä vanhan putken askAgent-kutsut että v2-agentin oman asiakkaan
// kutsut samalla tavalla, eikä sovelluskoodiin tarvita muutoksia. Rooli (botti, simuloitu asiakas, arvioija) päätellään
// pyynnön järjestelmäohjeesta: arvioinnin omat ohjeet rekisteröidään, kaikki muu on bottia.
import { PRICES as BATCH_PRICES } from '../scripts/whatsapp-selfplay-batch.mjs';

// USD / 1M tokenia (claude-api-taito, välimuistissa 2026-11-03), samat kuin itsekeskusteluerän laskurissa.
// Välimuistiin kirjoitus: 5 min = 1,25 × syöte, 1 h = 2 × syöte. Ajattelu laskutetaan output-tokeneina.
export const PRICES = { ...BATCH_PRICES };

/** Yhden vastauksen hinta. usage on Messages API:n usage-objekti (input_tokens ei sisällä välimuistiosuuksia). */
export function usageCost(usage, model) {
  if (!usage) return 0;
  if (Array.isArray(usage.iterations) && usage.iterations.length && usage.iterations.every((it) => it && typeof it === 'object' && it.model)) {
    // Palvelinpuolen fallback: jokainen ajettu malli laskutetaan omilla hinnoillaan.
    return usage.iterations.reduce((sum, it) => sum + usageCost({ ...it, iterations: undefined }, it.model), 0);
  }
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  const writeAll = usage.cache_creation_input_tokens || 0;
  const write5m = Math.max(0, writeAll - write1h);
  return ((usage.input_tokens || 0) * p.input + write5m * p.input * 1.25 + write1h * p.input * 2
    + (usage.cache_read_input_tokens || 0) * p.cacheRead + (usage.output_tokens || 0) * p.output) / 1e6;
}

const systemText = (body) => {
  const s = body?.system;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  return '';
};

/** SSE-virran usage: message_start antaa syötteen ja mallin, message_delta lopullisen tulosteen ja pysähtymissyyn. */
export function parseEventStream(text) {
  const out = { model: null, usage: null, stop: null, toolUses: [] };
  for (const block of String(text).split(/\r?\n\r?\n/u)) {
    const data = block.split(/\r?\n/u).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!data) continue;
    let event; try { event = JSON.parse(data); } catch { continue; }
    if (event.type === 'message_start' && event.message) {
      out.model = event.message.model || out.model;
      out.usage = { ...(event.message.usage || {}) };
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      out.toolUses.push(event.content_block.name);
    } else if (event.type === 'message_delta') {
      out.usage = { ...(out.usage || {}), ...Object.fromEntries(Object.entries(event.usage || {}).filter(([, v]) => v != null)) };
      out.stop = event.delta?.stop_reason || out.stop;
    }
  }
  return out;
}

/**
 * Asentaa mittarin globaaliin fetchiin. allowHosts: muut osoitteet heittävät virheen (Valion rajapinta, Meta, linkit).
 * Palauttaa { calls, tag(systemText, role), settle(), totals(filter) }.
 */
export function installMeter({ allowHosts = ['127.0.0.1', 'localhost', 'api.anthropic.com'], onBlocked = () => {} } = {}) {
  const realFetch = globalThis.fetch;
  const calls = []; const pending = new Set(); const roles = new Map(); const blocked = [];
  const meter = {
    calls, blocked,
    tag(text, role) { roles.set(String(text), role); },
    async settle() { while (pending.size) await Promise.allSettled([...pending]); },
    totals(filter = () => true) {
      const t = { calls: 0, failed: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0, byModel: {} };
      for (const c of calls.filter(filter)) {
        t.calls += 1; if (c.status >= 400 || c.error) t.failed += 1;
        const u = c.usage || {};
        t.input += u.input_tokens || 0; t.output += u.output_tokens || 0; t.cacheRead += u.cache_read_input_tokens || 0; t.cacheWrite += u.cache_creation_input_tokens || 0;
        t.usd += c.usd || 0; t.ms += c.ms || 0;
        const m = (t.byModel[c.model || c.requested || '?'] ||= { calls: 0, usd: 0 }); m.calls += 1; m.usd += c.usd || 0;
      }
      return t;
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const href = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(href);
    if (!allowHosts.includes(url.hostname)) {
      blocked.push({ host: url.hostname, at: Date.now() }); onBlocked(url.hostname);
      throw new Error(`Arviointi esti ulkoisen pyynnön: ${url.hostname}`);
    }
    if (url.hostname !== 'api.anthropic.com') return realFetch(input, init);
    let body = null;
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
    const sys = systemText(body);
    const role = roles.get(sys) || [...roles.entries()].find(([k]) => k && sys.startsWith(k))?.[1] || 'bot';
    // Uudet työkalutulokset (pyynnön viimeisen käyttäjäviestin tool_result-lohkot): merkkitarkistus vertaa vastauksen merkkejä niihin.
    const last = Array.isArray(body?.messages) ? body.messages[body.messages.length - 1] : null;
    const toolResults = role === 'bot' && last?.role === 'user' && Array.isArray(last.content) ? last.content.filter((b) => b?.type === 'tool_result')
      .map((b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '').slice(0, 40_000)) : [];
    const entry = { role, requested: body?.model || null, path: url.pathname, stream: Boolean(body?.stream), started: Date.now(), ms: null, status: null, model: null, usage: null, stop: null, usd: 0, toolResults,
      effort: body?.output_config?.effort || null, thinking: body?.thinking?.type || null, tools: Array.isArray(body?.tools) ? body.tools.length : 0 };
    calls.push(entry);
    let res;
    try { res = await realFetch(input, init); } catch (err) { entry.error = String(err?.message || err).slice(0, 200); entry.ms = Date.now() - entry.started; throw err; }
    entry.status = res.status;
    if (!/\/v1\/messages$/u.test(url.pathname) || !res.ok) { entry.ms = Date.now() - entry.started; return res; }
    const copy = res.clone();
    const work = (async () => {
      try {
        if ((copy.headers.get('content-type') || '').includes('text/event-stream')) Object.assign(entry, parseEventStream(await copy.text()));
        else { const json = await copy.json(); Object.assign(entry, { model: json.model || null, usage: json.usage || null, stop: json.stop_reason || null, toolUses: (json.content || []).filter((b) => b.type === 'tool_use').map((b) => b.name) }); }
      } catch (err) { entry.error = `usage: ${String(err?.message || err).slice(0, 120)}`; }
      entry.ms = Date.now() - entry.started;
      entry.usd = usageCost(entry.usage, entry.model || entry.requested);
    })();
    pending.add(work); work.finally(() => pending.delete(work));
    return res;
  };
  meter.uninstall = () => { globalThis.fetch = realFetch; };
  return meter;
}
