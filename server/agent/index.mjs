// Tilausapuri v2: Claude-silmukka omilla työkaluilla (docs/agent-v2.md, kohdat "Arkkitehtuuri" ja "Agenttisopimus").
// Malli näkee koko keskustelun, kutsuu työkaluja (server/agent/tools.mjs) ja kirjoittaa vastauksen itse. Koodi takaa faktat:
// tarkistuslista on työkaluissa, vartija (guard.mjs) tarkistaa euromäärät ja linkit, ja korilinkin lisää cart-link.mjs vasta
// onnistuneen send_cart_link-kutsun jälkeen. Kytkentä: WHATSAPP_AGENT=v2 (server/whatsapp/ordering.mjs).
import { agentStats } from '../aimoAgent.mjs';
import { messageLinks } from '../whatsapp/link-reader.mjs';
import { openTranscript } from './transcript.mjs';
import { checkReply, knownAmounts, productNames, repairReply } from './guard.mjs';
import { createProofreader } from './proofread.mjs';
import { CART_LINK_UNAVAILABLE, CONTEXT_PREFIX, CUSTOMER_PREFIX, FALLBACK, SNAPSHOT_LABEL, FORCE_NOTE, SYSTEM_PROMPT, TRUNCATED_NOTE, contextText, correctionNote,
  customerText, discardedNote, sentNote, toneFor } from './prompt.mjs';

export const PURPOSE = 'whatsapp_agent';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const BINDING_BETA = 'thinking-binding-controls-2026-08-01';
// Työkalut, jotka eivät muuta koria. Kaikki muut muuttavat, jolloin aiempi korilinkki ei enää koske samaa versiota.
const READ_ONLY = new Set(['search_products', 'get_cart', 'product_details', 'previous_orders', 'read_link', 'send_cart_link', 'save_feedback']);
const MAX_TOOL_RESULT = 60_000;
const MAX_CALL_MS = 45_000; // yhden mallikutsun yläraja
const MIN_CALL_MS = 1_000; // tätä lyhyempään jäljellä olevaan aikaan ei aloiteta kutsua
// Tuotannon vuoron rajat (createConfiguredAgent). Demon Opus 5.5 high ei ehtinyt 60 s:ssa: "lohikeittoa 40 hengelle, mitä
// tarvitsen?" katkesi 2/2 kertaa vastaukseen "jäi kesken" (livetesti 19.11. klo 19). Kova raja pysyy alle Workerin 90 s:n
// selainkeskustelun aikakatkaisun (deploy/cloudflare/src/web-chat.ts). Työkalut suljetaan 60 s:n kohdalla, jolloin
// loppuvastaukselle jää 25 s. createAgentin omat oletukset (60/45 s) pysyvät testejä varten ennallaan.
export const TURN_LIMITS = Object.freeze({ turnBudgetMs: 85_000, softDeadlineMs: 60_000 });

/** Asetukset: WHATSAPP_AGENT=v2, WHATSAPP_AGENT_MODEL (oletus claude-sonnet-5-5, Eeliksen valinta 19.11. arvioinnin perusteella), WHATSAPP_AGENT_EFFORT (oletus medium).
 *  WHATSAPP_AGENT_PROOFREAD=false ottaa kirjoitusvirheiden oikoluvun pois (proofread.mjs), WHATSAPP_AGENT_PROOFREAD_MODEL vaihtaa sen mallin.
 *  WHATSAPP_AGENT_SPEED=fast pyytää nopean tilan (speed: "fast", Opus 5.5: sama malli, enintään 2,5 x nopeampi tuotto, kaksinkertainen hinta). */
export function agentSettings(env = process.env) {
  const effort = String(env.WHATSAPP_AGENT_EFFORT || '').trim().toLowerCase();
  return {
    enabled: String(env.WHATSAPP_AGENT || '').trim().toLowerCase() === 'v2',
    model: String(env.WHATSAPP_AGENT_MODEL || '').trim() || 'claude-sonnet-5-5',
    effort: EFFORTS.includes(effort) ? effort : 'medium',
    proofread: String(env.WHATSAPP_AGENT_PROOFREAD || '').trim().toLowerCase() !== 'false',
    proofreadModel: String(env.WHATSAPP_AGENT_PROOFREAD_MODEL || '').trim() || 'claude-sonnet-5-5',
    speed: String(env.WHATSAPP_AGENT_SPEED || '').trim().toLowerCase() === 'fast' ? 'fast' : 'standard',
  };
}

/** Palvelinpuolen fallback Opukselle ja Sonnetille (myös Fable ja Mythos), ei Haikulle: sillä varamallia ei ole. */
export const usesServerFallback = (model) => /^claude-(?:opus|sonnet|fable|mythos)-/.test(String(model));

/** Vastaus 1–3 erilliseksi viestiksi rivillä, jossa on pelkkä ---. Ylimääräiset osat yhdistetään viimeiseen. */
export function splitMessages(text, max = 3) {
  const parts = String(text ?? '').split(/^[ \t]*-{3,}[ \t]*$/mu).map((part) => part.trim()).filter(Boolean);
  return parts.length <= max ? parts : [...parts.slice(0, max - 1), parts.slice(max - 1).join('\n\n')];
}

export const textOf = (content) => (content || []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('');

/**
 * Assistentin sisältö takaisin muuttamattomana. Ainoa poikkeus on dokumentoitu fallback-raja: viimeisen fallback-lohkon edellä
 * olevat thinking- ja tool_use-lohkot (hylätyn mallin keskeneräinen osuus) jätetään pois. Ilman striimausta API ei palauta
 * sellaisia, joten tavallisesti sisältö pysyy sellaisenaan.
 */
export function echoContent(content) {
  const list = Array.isArray(content) ? content : [];
  const boundary = list.findLastIndex((b) => b?.type === 'fallback');
  if (boundary <= 0) return list;
  const partial = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
  return list.filter((b, i) => i >= boundary || !partial.has(b?.type));
}

const defaultEvent = (event, fields) => { if (process.env.VERCEL) console.info(JSON.stringify({ event, ...fields })); };
/**
 * Ikkunan faktat vartijalle: aiempien vuorojen työkalutulokset ja vuoron tietojen tilannekuvat. Lyhennetystä tuloksesta
 * luetaan rahakentät avain–arvo-pareina.
 */
function windowFacts(messages) {
  const parse = (text) => {
    try { return JSON.parse(text); } catch {
      return [...String(text).matchAll(/"([A-Za-z_]\w*)":\s*(-?\d+(?:\.\d+)?)/g)].map(([, key, value]) => ({ [key]: Number(value) }));
    }
  };
  const out = [];
  for (const m of messages) {
    if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b?.type === 'tool_result' && typeof b.content === 'string') out.push(parse(b.content));
      else if (b?.type === 'text' && String(b.text).startsWith(CONTEXT_PREFIX)) {
        const at = b.text.lastIndexOf(SNAPSHOT_LABEL);
        if (at >= 0) out.push(parse(b.text.slice(at + SNAPSHOT_LABEL.length)));
      }
    }
  }
  return out;
}
/** Asiakkaan omien viestilohkojen linkit transkriptista (customerText-muoto). */
const customerLinks = (messages) => messages.filter((m) => m.role === 'user' && Array.isArray(m.content)).flatMap((m) => m.content)
  .filter((b) => b?.type === 'text' && String(b.text).startsWith(CUSTOMER_PREFIX)).flatMap((b) => messageLinks(b.text));
const hasText = (value) => (Array.isArray(value) ? value.some((v) => String(v ?? '').trim()) : Boolean(String(value ?? '').trim()));
const incomingKey = (m) => `${m.at ?? ''}\u0000${m.text}`;

function usageOf(msg) {
  const u = msg?.usage || {};
  // Fallback-ajossa usage.iterations kertoo jokaisen yrityksen kulutuksen; ylätason usage vain palautetun viestin.
  const parts = Array.isArray(u.iterations) && u.iterations.length > 1 ? u.iterations : [u];
  const sum = (field) => parts.reduce((total, p) => total + (Number(p?.[field]) || 0), 0);
  const cacheRead = sum('cache_read_input_tokens'); const cacheWrite = sum('cache_creation_input_tokens');
  return { input: sum('input_tokens') + cacheRead + cacheWrite, output: sum('output_tokens'), cacheRead, cacheWrite,
    // Ikkunan lyhennys: viimeisen pyynnön koko syöte (ylätason usage on se pyyntö, joka tuotti vastauksen).
    context: (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) };
}

// Samat laskurit kuin askAgent (server/aimoAgent.mjs). Tokenit ennen calls-kenttää: itsepelin kustannusseuranta
// (scripts/whatsapp-selfplay-batch.mjs) lukee ne tarkoituksen calls-kentän muutoshetkellä.
function record(usage, ms) {
  agentStats.calls += 1; agentStats.lastMs = ms;
  agentStats.inputTokens += usage.input; agentStats.outputTokens += usage.output;
  agentStats.cacheReadTokens += usage.cacheRead; agentStats.cacheWriteTokens += usage.cacheWrite;
  const p = (agentStats.byPurpose[PURPOSE] ||= { calls: 0, failed: 0, lastMs: null });
  p.inputTokens = (p.inputTokens || 0) + usage.input; p.outputTokens = (p.outputTokens || 0) + usage.output;
  p.cacheReadTokens = (p.cacheReadTokens || 0) + usage.cacheRead; p.cacheWriteTokens = (p.cacheWriteTokens || 0) + usage.cacheWrite;
  p.calls += 1; p.lastMs = ms;
}
function recordFailure(err) {
  agentStats.failed += 1; agentStats.lastError = String(err?.message || err).slice(0, 200);
  (agentStats.byPurpose[PURPOSE] ||= { calls: 0, failed: 0, lastMs: null }).failed += 1;
}

/**
 * @param {object} o
 * @param {{definitions: object[], run: Function, snapshot: Function}} o.tools työkalusopimus (server/agent/tools.mjs)
 * @param {object} o.db transkriptin kanta (luonnoskanta openSqlite-yhteytenä)
 * @param {{beta: {messages: {create: Function}}}} o.client Anthropic-asiakas tai testin käsikirjoitettu malli
 * @param {string} [o.model] @param {string} [o.effort]
 * @param {() => number} [o.now] portin kello (demokello) vuoron päivämäärälle ja työkaluille
 * @param {() => number} [o.clock] kulunut aika vuoron rajoille (ms), oletus performance.now
 * @param {Function|null} [o.proofread] kirjoitusvirheiden oikoluku valmiille vastaukselle (proofread.mjs createProofreader), null = ei oikolukua
 */
export function createAgent({ tools, db, client, model = 'claude-sonnet-5-5', effort = 'medium', speed = 'standard', now = Date.now, clock = () => performance.now(),
  wallClock = Date.now, maxToolRounds = 8, turnBudgetMs = 60_000, softDeadlineMs = 45_000, maxTokens = 16_000, window: windowLimits = {},
  onEvent = defaultEvent, ownsDb = false, proofread = null, sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) } = {}) {
  if (!tools || !Array.isArray(tools.definitions) || typeof tools.run !== 'function' || typeof tools.snapshot !== 'function') {
    throw new Error('createAgent tarvitsee työkalut: definitions, run ja snapshot.');
  }
  if (!db) throw new Error('createAgent tarvitsee kannan transkriptille.');
  if (!client?.beta?.messages?.create) throw new Error('createAgent tarvitsee Anthropic-asiakkaan.');
  const transcript = openTranscript(db, { now: wallClock });
  // Jäädytetty työkalulista: sama joka kutsussa, jotta välimuisti ja thinking-lohkojen sidonta pysyvät voimassa.
  const definitions = structuredClone(tools.definitions);
  const names = new Set(definitions.map((d) => d.name));
  const fallback = usesServerFallback(model);
  let plain = false; // malli tai alusta ei tue beta-ominaisuuksia: sama pyyntö ilman niitä
  // Nopea tila (Eelis 19.11.: "toi vastaus kestää kyl liian kauan"): kapasiteetin loppuessa (429/529) sama kutsu tavallisella
  // nopeudella ja nopea tila minuutiksi tauolle. 400 tarkoittaa, ettei malli tai alusta hyväksy kenttää: nopea tila pois.
  let fast = speed === 'fast'; let fastPausedUntil = 0;

  // Vuoron aikaraja on kova (katselmointi 19.11.): jokainen yritys saa vain jäljellä olevan ajan, eikä SDK uusi kutsuja itse.
  // Ohimenevä virhe (429, 5xx, yhteys) uusitaan kerran, jos aikaa on vielä vähintään 5 s.
  const retryable = (err) => [408, 409, 429].includes(err?.status) || err?.status >= 500 || (err?.status == null && err?.name === 'APIConnectionError');
  async function create(params, deadline, { retry = true } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const remaining = deadline - clock();
      if (remaining < MIN_CALL_MS) throw Object.assign(new Error('Vuoron aikaraja täyttyi.'), { code: 'AGENT_BUDGET' });
      try { return await client.beta.messages.create(params, { timeout: Math.round(Math.min(MAX_CALL_MS, remaining)), maxRetries: 0 }); }
      catch (err) {
        if (!retry || attempt > 0 || !retryable(err) || deadline - clock() < 5_000) throw err;
        await sleep(400);
      }
    }
  }

  async function createAtSpeed(params, deadline) {
    if (!fast || clock() < fastPausedUntil) return create(params, deadline);
    try { return await create({ ...params, speed: 'fast' }, deadline, { retry: false }); }
    catch (err) {
      if ([429, 529].includes(err?.status)) fastPausedUntil = clock() + 60_000;
      else if (err?.status === 400) fast = false;
      else throw err;
      onEvent('agent_fast_fallback', { model, status: err.status });
      return create(params, deadline);
    }
  }

  async function call(messages, { toolChoice, deadline }) {
    const base = { model, max_tokens: maxTokens,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      tools: definitions, tool_choice: { type: toolChoice }, messages, output_config: { effort },
      // Automaattinen välimuistimerkki viimeiseen viestiin: transkriptin lohkoja ei muokata merkintää varten. 1 h, koska
      // WhatsApp-asiakas vastaa usein yli 5 minuutin päästä, ja silloin koko historia kirjoitettaisiin uudelleen (koordinaattori 19.11.).
      cache_control: { type: 'ephemeral', ttl: '1h' } };
    const full = { ...base, thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      betas: [...(fallback ? [FALLBACK_BETA] : []), BINDING_BETA], ...(fallback ? { fallbacks: 'default' } : {}) };
    const simple = { ...base, thinking: { type: 'adaptive' } };
    const t0 = clock();
    try {
      let msg;
      if (plain) msg = await createAtSpeed(simple, deadline);
      else {
        try { msg = await createAtSpeed(full, deadline); }
        catch (err) {
          if (err?.status !== 400) throw err;
          msg = await createAtSpeed(simple, deadline); // vain jäljellä olevan ajan sisällä
          plain = true; onEvent('agent_plain_requests', { model });
        }
      }
      record(usageOf(msg), Math.round(clock() - t0));
      return msg;
    } catch (err) { recordFailure(err); throw err; }
  }

  async function snapshot(ctx) {
    try { return await tools.snapshot(ctx); }
    catch (err) { onEvent('agent_snapshot_failed', { error: String(err?.code || err?.name || 'Error').slice(0, 60) }); return { error: 'SNAPSHOT_FAILED' }; }
  }

  async function runTool(use, ctx, cartLinkAvailable) {
    if (!names.has(use.name)) return { value: { error: 'UNKNOWN_TOOL', message: `Työkalua ${use.name} ei ole.` }, error: true };
    if (use.name === 'send_cart_link' && !cartLinkAvailable) return { value: CART_LINK_UNAVAILABLE, error: true };
    try {
      const value = (await tools.run(use.name, use.input ?? {}, ctx)) ?? { ok: true };
      return { value, error: Boolean(value && typeof value === 'object' && value.error) };
    } catch (err) {
      onEvent('agent_tool_failed', { tool: use.name, error: String(err?.code || err?.name || 'Error').slice(0, 60) });
      return { value: { error: 'TOOL_FAILED', message: 'Työkalu ei nyt vastannut. Yritä uudelleen tai jatka ilman sitä.' }, error: true };
    }
  }

  // Niputuksen uusinta (`${id}:r1`): edellisillä yrityksillä jo kirjatut asiakasviestit eivät tule uudelleen.
  function freshIncoming(messageId, incoming) {
    const list = (Array.isArray(incoming) ? incoming : []).map((m) => ({ text: String(m?.text ?? ''), at: m?.at ?? null })).filter((m) => m.text.trim());
    const id = String(messageId); const family = id.replace(/:r\d+$/u, '');
    if (family === id) return list;
    const seen = new Set();
    for (const earlier of [family, ...Array.from({ length: 8 }, (_, i) => `${family}:r${i + 1}`)]) {
      if (earlier === id) break;
      for (const m of transcript.result(earlier)?.agent?.incoming || []) seen.add(incomingKey(m));
    }
    const rest = list.filter((m) => !seen.has(incomingKey(m)));
    return rest.length ? rest : list;
  }

  return {
    /**
     * Yksi asiakasvuoro. incoming = tämän vuoron asiakasviestit aikaleimoineen, discardedReply = edellinen vastaus, jota ei
     * lähetetty, koska asiakas kirjoitti lisää. Sama messageId palauttaa tallennetun tuloksen ilman mallikutsua.
     * @returns {Promise<{status: 'ready'|'collecting', draftId: string|null, revision: number|null, text: string, messages: string[], requestCartLink: boolean}>}
     */
    async respond({ customer, conversationId, messageId, incoming = [], discardedReply = null, channel = 'whatsapp', cartLinkAvailable = false } = {}) {
      if (!messageId || !conversationId) throw new Error('respond tarvitsee viesti- ja keskustelutunnisteen.');
      const stored = transcript.result(messageId);
      if (stored) return stored;
      const t0 = clock();
      const deadline = t0 + turnBudgetMs;
      let win = transcript.window(conversationId, windowLimits);
      // Vartijan aineisto ikkunasta: aiempien vuorojen työkalutulokset ja tilannekuvat, jotka malli on nähnyt (katselmointi 19.11.).
      let windowData = windowFacts(win.messages);
      const fresh = freshIncoming(messageId, incoming);
      // messageId: työkalut liittävät sen luonnoksen tallennusten tunnisteisiin. links: read_link avaa vain asiakkaan itse
      // lähettämät linkit (tämä vuoro ja aiemmat asiakasviestit ikkunassa), ei työkalujen tuloksissa tai sivuilla olevia.
      const links = [...new Set([...customerLinks(win.messages), ...fresh.flatMap((m) => messageLinks(m.text))])];
      const ctx = { customer, conversationId, messageId: String(messageId), now: new Date(now()), channel: channel === 'web' ? 'web' : 'whatsapp', links };
      const before = await snapshot(ctx);
      const turn = [{ role: 'user', content: [
        { type: 'text', text: contextText({ now: ctx.now, customer, channel: ctx.channel, snapshot: before, cartLinkAvailable, first: win.first,
          tone: win.first ? toneFor(`${conversationId}:${messageId}`) : null }) },
        ...(hasText(discardedReply) ? [{ type: 'text', text: discardedNote(discardedReply) }] : []),
        ...(fresh.length ? fresh : [{ text: '', at: null }]).map((m) => ({ type: 'text', text: customerText(m) })),
      ] }];
      // Vartijan aineisto: ikkunan ja tämän vuoron työkalutulokset, kori vuoron alussa ja lopussa sekä asiakkaan omat viestit.
      const data = [before]; const customerTexts = fresh.map((m) => m.text);
      const factsNow = () => { const all = [...windowData, ...data, after]; return { known: knownAmounts(all, customerTexts), products: productNames(all), customerTexts }; };
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      const guard = [];
      let calls = 0; let toolCalls = 0; let rounds = 0; let forced = false; let corrected = false; let linkOk = false; let fastCalls = 0;
      let context = 0; let reply = null; let outcome = 'ok'; let after = null; let modelText = null;
      // Kestot lokiin ja tulokseen: mallikutsut ja työkalut erikseen (koordinaattori 19.11.). Ei tekstiä eikä tunnisteita.
      let modelMs = 0; let toolMs = 0;
      const note = (text) => {
        const last = turn.at(-1);
        if (last.role === 'user') last.content.push({ type: 'text', text });
        else turn.push({ role: 'user', content: [{ type: 'text', text }] });
      };

      while (true) {
        const elapsed = clock() - t0;
        if (!forced && (rounds >= maxToolRounds || elapsed >= softDeadlineMs)) { forced = true; note(FORCE_NOTE); }
        if (calls >= maxToolRounds + 4) { outcome = 'calls'; reply = FALLBACK.failed; break; }
        let msg; const c0 = clock();
        try {
          msg = await call([...win.messages, ...turn], { toolChoice: forced ? 'none' : 'auto', deadline });
          modelMs += clock() - c0;
        } catch (err) {
          modelMs += clock() - c0;
          // Vuoron ensimmäinen kutsu hylättiin (400), vaikka pyyntö ilman beta-ominaisuuksiakin yritettiin: aiempi historia
          // ohitetaan kerran, ettei rikkinäinen transkripti kaada keskustelua pysyvästi. Rivit jäävät kantaan ennalleen.
          if (err?.status === 400 && calls === 0 && win.messages.length) {
            onEvent('agent_history_reset', { model, turns: win.turns });
            win = { ...win, messages: [], start: win.next, trimmed: true }; windowData = [];
            continue;
          }
          // Aikaraja täyttyi, kun työtä on jo tehty: työ talteen ja lyhyt vastaus. Ilman yhtään vastausta kanava uusii vuoron.
          if (calls > 0 && (err?.code === 'AGENT_BUDGET' || err?.name === 'APIConnectionTimeoutError')) { outcome = 'timeout'; reply = FALLBACK.failed; break; }
          throw err;
        }
        calls += 1;
        if (msg?.usage?.speed === 'fast') fastCalls += 1;
        const u = usageOf(msg);
        for (const k of Object.keys(usage)) usage[k] += u[k];
        context = u.context;
        // Kieltäytyminen tai katkennut vastaus ennen työkaluja: keskeneräisiä tool_use-lohkoja ei ajeta.
        if (msg.stop_reason === 'refusal') { outcome = 'refusal'; reply = FALLBACK.refusal; break; }
        if (msg.stop_reason === 'max_tokens') {
          if (!forced) { forced = true; note(TRUNCATED_NOTE); continue; }
          outcome = 'max_tokens'; reply = FALLBACK.failed; break;
        }
        const content = echoContent(msg.content);
        turn.push({ role: 'assistant', content });
        const uses = content.filter((b) => b?.type === 'tool_use');
        if (uses.length) {
          // Saman vuoron kaikki tulokset yhteen käyttäjäviestiin, järjestyksessä. Epäonnistunut työkalu is_error-merkinnällä.
          if (!forced) rounds += 1;
          after = null; // kori voi muuttua: tilannekuva lasketaan uudelleen
          const results = [];
          for (const use of uses) {
            const r0 = clock();
            const out = forced ? { value: { error: 'TOOLS_CLOSED', message: 'Työkaluja ei voi enää käyttää tässä vuorossa.' }, error: true }
              : await runTool(use, ctx, cartLinkAvailable === true);
            toolMs += clock() - r0; toolCalls += 1;
            data.push(out.value);
            if (use.name === 'send_cart_link') linkOk = !out.error && out.value?.ok === true;
            else if (!out.error && !READ_ONLY.has(use.name)) linkOk = false;
            let body = JSON.stringify(out.value);
            if (body.length > MAX_TOOL_RESULT) body = `${body.slice(0, MAX_TOOL_RESULT)}…(lyhennetty)`;
            results.push({ type: 'tool_result', tool_use_id: use.id, content: body, ...(out.error ? { is_error: true } : {}) });
          }
          turn.push({ role: 'user', content: results });
          continue;
        }
        const text = textOf(content).trim();
        if (text) modelText = text;
        after = await snapshot(ctx);
        const facts = factsNow();
        const check = checkReply(text, facts);
        if (check.ok) { reply = text; break; }
        guard.push({ empty: check.empty, amounts: check.unknownAmounts.map((a) => a.raw), links: check.links.length, brands: check.brands.map((b) => b.raw) });
        if (!corrected) { corrected = true; note(correctionNote(check)); continue; }
        // Korjauskierroksen jälkeenkin vikaa: linkit pois ja tarkistamaton euromäärä korvataan viittauksella koriin. Tyhjä vastaus:
        // viimeisin mallin teksti tarkistetaan ja korjataan samoin, eikä hylättyä tekstiä lähetetä koskaan sellaisenaan.
        const source = check.empty ? modelText || '' : text;
        const final = check.empty ? checkReply(source, facts) : check;
        const repaired = final.ok ? source : final.empty ? '' : repairReply(source, final);
        reply = repaired.trim() ? repaired : FALLBACK.failed;
        outcome = 'repaired'; break;
      }

      after ||= await snapshot(ctx);
      // Kirjoitusvirheet pois ennen lähetystä (Eelis 19.11.: "ei saisi olla kirjotusvirheitä"). Vain vaihdetut sanat muuttuvat:
      // luvut, hinnat, tuotenimet ja linkit eivät (proofread.mjs). Epäonnistunut tai liian myöhäinen oikoluku jättää vastauksen ennalleen.
      let proof = null;
      if (proofread && ['ok', 'repaired'].includes(outcome) && hasText(reply) && reply !== FALLBACK.failed && deadline - clock() >= 3_000) {
        proof = await proofread(reply, { products: factsNow().products, timeoutMs: Math.min(8_000, deadline - clock() - 500) });
        if (proof?.applied?.length && hasText(proof.text)) reply = proof.text;
        if (proof?.usage) { const u = usageOf({ usage: proof.usage }); for (const k of Object.keys(usage)) usage[k] += u[k]; }
      }
      // Kieltäytynyt vuoro jätetään aina pois, ja seuraava vuoro alkaa uudesta ikkunasta. Jos historia aiheutti kieltäytymisen,
      // se ei toistu joka vuorossa (katselmointi 19.11.). Työkalujen muutokset jäävät luonnokseen, ja tilannekuva kertoo ne.
      const refused = outcome === 'refusal';
      const persist = refused ? [] : turn;
      if (persist.length && outcome !== 'ok') note(sentNote(reply));
      const messages = splitMessages(reply);
      const ready = after?.checklist?.ready === true;
      const result = { status: ready ? 'ready' : 'collecting', draftId: after?.draftId ?? after?.id ?? null, revision: after?.revision ?? null,
        text: messages.join('\n\n'), messages, requestCartLink: ['ok', 'repaired'].includes(outcome) && linkOk && ready,
        // incoming vain, kun vuoro on transkriptissa: uusinta (`:r1`) jättää pois vain viestit, jotka malli on jo nähnyt.
        agent: { model, outcome, calls, toolCalls, rounds, ms: Math.round(clock() - t0), modelMs: Math.round(modelMs), toolMs: Math.round(toolMs),
          usage, guard, incoming: persist.length ? fresh : [], ...(proof ? { proofread: { ms: proof.ms, fixes: proof.applied?.length || 0 } } : {}) } };
      const saved = transcript.append(conversationId, messageId, persist, result, { start: refused ? win.next : win.start, inputTokens: refused ? 0 : context });
      // Vain kestot ja määrät: ei viestien sisältöä, numeroita eikä tunnisteita.
      onEvent('agent_turn', { outcome, calls, rounds, toolCalls, ms: result.agent.ms, modelMs: result.agent.modelMs, toolMs: result.agent.toolMs,
        input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, guard: guard.length, trimmed: win.trimmed || refused,
        link: result.requestCartLink, fastCalls, ...(proof ? { proofreadMs: proof.ms, proofreadFixes: proof.applied?.length || 0 } : {}) });
      return saved;
    },
    // Työkalujen oma säilytys (esim. palautteet) siivotaan samalla.
    prune() { transcript.prune(); tools.prune?.(); },
    close() { if (ownsDb) db.close(); },
  };
}

let clientPromise;
/** Anthropic-asiakas kuten server/aimoAgent.mjs: avain palvelinasetuksista, yksi uusinta, kutsukohtainen aikaraja. */
export function anthropicClient(apiKey) {
  return (clientPromise ||= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })));
}

/**
 * Valmis kokoonpano ordering.mjs:lle: työkalut nykyiselle luonnosvarastolle ja tuotetyökaluille, transkripti samaan
 * luonnoskantaan. Palauttaa null, jos agenttia ei voi ajaa (ei Anthropic-avainta).
 */
export async function createConfiguredAgent({ store, orderingTools, draftDb = ':memory:', settings = agentSettings(), now } = {}) {
  const [{ config }, { openSqlite }, { createAgentTools }, { loadCatalog }, { orders }, { clock }] = await Promise.all([
    import('../config.mjs'), import('../sqlite.mjs'), import('./tools.mjs'), import('../catalog.mjs'), import('../gateway/store.mjs'), import('../gateway/clock.mjs'),
  ]);
  if (config.llmProvider !== 'anthropic' || !config.anthropicKey) {
    console.warn('[agent] WHATSAPP_AGENT=v2 tarvitsee ANTHROPIC_API_KEY:n ja Anthropic-mallit. Käytetään vanhaa putkea.');
    return null;
  }
  const time = now || (() => clock.now().getTime());
  // Sama luonnoskannan yhteys transkriptille ja työkaluille (save_feedback tallentaa palautteen samaan kantaan).
  const db = openSqlite(draftDb);
  const tools = createAgentTools({ store, orderingTools, catalog: loadCatalog(), gatewayOrders: orders, now: time, db });
  const client = await anthropicClient(config.anthropicKey);
  const proofread = settings.proofread === false ? null : createProofreader({ client, model: settings.proofreadModel || 'claude-sonnet-5-5', onEvent: defaultEvent });
  return createAgent({ tools, db, ownsDb: true, client, model: settings.model, effort: settings.effort, speed: settings.speed, now: time, proofread, ...TURN_LIMITS });
}
