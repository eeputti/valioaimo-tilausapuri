// AIMO-AGENTTI: ainoa paikka, josta kielimallia kutsutaan.
// Agentti = Aimon ohjeet, skeemat ja tarkistukset valmiin kielimallin päällä. Tehtävät (keittiön reititys ja tarkistus
// WhatsApp-dialogi, pyynnön tulkinta aimo/model.mjs, portin neuvonantaja gateway/advisor.mjs) antavat ohjeen, syötteen ja skeeman;
// tämä moduuli omistaa asiakkaan, mallivalinnan, kutsuasetukset ja laskurit. Mallin tai toimittajan vaihto tehdään täällä.
import { config, llmEnabled } from './config.mjs';

const AGENT_NAME = 'Aimo-agentti';
export const AIMO_AGENT = { name: AGENT_NAME, provider: config.llmProvider };
export const agentEnabled = llmEnabled;

/** Kaksi nopeutta: 'deep' ajattelee rauhassa taustalla, 'fast' vastaa heti (ajattelu pois, matala effort). */
export const modelFor = (tier = 'fast') => (tier === 'deep' ? config.deepModel : config.fastModel);

let clientPromise;
const getClient = () => (clientPromise ||= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => ({ Anthropic, client: new Anthropic({ apiKey: config.anthropicKey, maxRetries: 1, timeout: 120_000 }) })));

/** Lämmitys käynnistyksessä: SDK muistiin, ettei demon ensimmäinen kutsu ole hitain. */
export async function warmAgent() { if (agentEnabled()) await getClient(); }

// inputTokens sisältää kaikki syötetokenit: välimuistista luetut (cacheReadTokens, noin 0,1 × hinta) ja välimuistiin
// kirjoitetut (cacheWriteTokens, 1,25 × hinta) mukaan lukien.
export const agentStats = { calls: 0, failed: 0, lastMs: null, lastError: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, byPurpose: {} };

const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

/**
 * Käyttäjäviestin sisältö. `turns` on kutsusta toiseen vain kasvava alku (esim. keskustelu vuoro kerrallaan): jokainen
 * vuoro on oma lohkonsa ja viimeinen merkitään välimuistiin, joten seuraava kutsu lukee aiemmat vuorot välimuistista.
 * Välimuisti osuu vain lohkon rajaan, siksi yhteen kasvavaan tekstiin koottu keskustelu ei osu koskaan.
 * `user` on tämän kutsun muuttuva loppu, ja se tulee merkinnän jälkeen.
 */
export function userContent(user, turns) {
  if (!turns?.length) return user;
  const blocks = turns.map((t) => (typeof t === 'string' ? { type: 'text', text: t } : { ...t }));
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  const tail = typeof user === 'string' ? (user ? [{ type: 'text', text: user }] : []) : (user || []);
  return [...blocks, ...tail];
}

// Syvän tason kutsu pyytää palvelimelta varamallin siltä varalta, että turvaluokitin hylkää pyynnön.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Vastauksen lopetussyyt, joita ei palauteta kutsujalle tuloksena vaan virheenä.
const STOP_FAILURES = new Map([
  ['refusal', 'Malli kieltäytyi vastaamasta'],
  ['max_tokens', 'Vastaus katkesi (max_tokens)'],
]);

const cachedText = (text) => ({ type: 'text', text, cache_control: { type: 'ephemeral' } });
const msSince = (start) => Math.round(performance.now() - start);

/** Pyynnön runko. Taso ratkaisee mallin, ajattelun ja effortin; skeema pyytää vastauksen JSON-muodossa. */
function requestBody({ tier, system, user, turns, schema, limit }) {
  const deep = tier === 'deep';
  const output = { effort: deep ? 'high' : 'low' };
  if (schema) output.format = { type: 'json_schema', schema };
  return {
    deep,
    body: {
      model: modelFor(tier),
      max_tokens: limit,
      thinking: { type: deep ? 'adaptive' : 'disabled' },
      output_config: output,
      system: [cachedText(system)],
      messages: [{ role: 'user', content: userContent(user, turns) }],
    },
  };
}

/** SDK:n kutsukohtaiset asetukset. Puuttuva arvo jättää voimaan asiakkaan oletuksen. */
function requestOptions(timeoutMs, retries) {
  const options = {};
  if (timeoutMs != null) options.timeout = timeoutMs;
  if (retries != null) options.maxRetries = retries;
  return options;
}

async function sendDeep({ Anthropic, client }, body, options) {
  try {
    const request = { ...body, betas: [FALLBACK_BETA], fallbacks: 'default' };
    return await client.beta.messages.stream(request, options).finalMessage();
  } catch (err) {
    // 400 tarkoittaa, ettei tämä malli tai alusta tunne varamallin betaa: sama pyyntö lähtee ilman sitä.
    if (err instanceof Anthropic.BadRequestError) return client.messages.stream(body, options).finalMessage();
    throw err;
  }
}

async function sendStreamed(client, body, options, onToken) {
  const stream = client.messages.stream(body, options);
  for await (const part of stream) {
    const isText = part.type === 'content_block_delta' && part.delta.type === 'text_delta';
    if (isText) onToken(part.delta.text);
  }
  return stream.finalMessage();
}

function send(sdk, deep, body, options, onToken) {
  if (deep) return sendDeep(sdk, body, options);
  if (onToken) return sendStreamed(sdk.client, body, options, onToken);
  return sdk.client.messages.create(body, options);
}

/** Tokenit kutsujalle. input on koko syöte: tavallinen, välimuistista luettu ja välimuistiin kirjoitettu yhteensä. */
function usageOf(msg) {
  const u = msg.usage || {};
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  return { input: (u.input_tokens || 0) + cacheRead + cacheWrite, output: u.output_tokens || 0, cacheRead, cacheWrite };
}

const purposeStats = (purpose) => (agentStats.byPurpose[purpose] ||= { calls: 0, failed: 0, lastMs: null });

function countSuccess(purpose, ms, usage) {
  agentStats.calls += 1;
  agentStats.lastMs = ms;
  agentStats.inputTokens += usage.input;
  agentStats.outputTokens += usage.output;
  agentStats.cacheReadTokens += usage.cacheRead;
  agentStats.cacheWriteTokens += usage.cacheWrite;
  // Tarkoituksen tokenit kertovat, mikä tehtävä osuu välimuistiin. Ne kirjataan ennen tarkoituksen calls-kenttää:
  // itsepelin kulujen seuranta (whatsapp-selfplay-batch.mjs) laskee kutsun tokenit sillä hetkellä, kun calls muuttuu.
  const entry = purposeStats(purpose);
  entry.inputTokens = (entry.inputTokens || 0) + usage.input;
  entry.cacheReadTokens = (entry.cacheReadTokens || 0) + usage.cacheRead;
  entry.cacheWriteTokens = (entry.cacheWriteTokens || 0) + usage.cacheWrite;
  entry.calls += 1;
  entry.lastMs = ms;
}

function countFailure(purpose, err) {
  agentStats.failed += 1;
  agentStats.lastError = String(err?.message || err).slice(0, 200);
  purposeStats(purpose).failed += 1;
}

/**
 * Yksi mallikutsu.
 * @param {object} o
 * @param {string} o.purpose   tehtävän nimi laskureihin ja lokiin, esim. 'recipe_ideas'
 * @param {'fast'|'deep'} [o.tier]
 * @param {string} o.system    tehtävän ohje (välimuistitetaan)
 * @param {string|Array<object>} o.user      teksti tai multimodaaliset sisältölohkot
 * @param {Array<string|object>} [o.turns]   kutsusta toiseen kasvava alku ennen `user`-osaa, välimuistiin (userContent)
 * @param {object} [o.schema]  JSON-skeema: vastaus palautetaan myös jäsennettynä kentässä json
 * @param {number} [o.maxTokens]  vastauksen tokenikatto, oletus 1024
 * @param {number} [o.timeoutMs]  kutsukohtainen aikakatkaisu; ilman tätä asiakkaan oletus (120 s)
 * @param {number} [o.retries]    kutsukohtaiset uusintayritykset; ilman tätä asiakkaan oletus (1)
 * @param {(text: string) => void} [o.onToken]  striimaa vastauksen pala kerrallaan
 * @returns {Promise<{text: string, json: any, model: string, ms: number, stopReason: string, usage: {input: number, output: number, cacheRead: number, cacheWrite: number}}>}
 * Heittää virheen, jos malli kieltäytyy, vastaus katkeaa tai kutsu epäonnistuu. Kutsuja päättää, miten jatketaan säännöillä.
 */
export async function askAgent({ purpose, tier = 'fast', system, user, turns, schema, maxTokens = 1024, timeoutMs, retries, onToken }) {
  const started = performance.now();
  const { deep, body } = requestBody({ tier, system, user, turns, schema, limit: maxTokens });
  try {
    const msg = await send(await getClient(), deep, body, requestOptions(timeoutMs, retries), onToken);
    const failure = STOP_FAILURES.get(msg.stop_reason);
    if (failure) throw new Error(failure);
    const text = textOf(msg);
    const json = schema ? JSON.parse(text) : null;
    const ms = msSince(started);
    const usage = usageOf(msg);
    countSuccess(purpose, ms, usage);
    return { text, json, model: msg.model, ms, stopReason: msg.stop_reason, usage };
  } catch (err) {
    countFailure(purpose, err);
    throw err;
  }
}
