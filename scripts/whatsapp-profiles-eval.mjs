// Explicit, bounded synthetic-customer exercise. No Meta send and no live supplier calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROFILES, normalizeCases, inspectBasket, inspectResult, redact, withQuantityEvidence, diagnoseDeadEnds } from '../eval/whatsapp-profiles-100.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const schema = { type: 'object', additionalProperties: false, required: ['text', 'stuck', 'where'], properties: { text: { type: 'string' }, stuck: { type: 'boolean' }, where: { type: 'string' } } };
const CUSTOMER = `Olet synteettinen ostaja tilausapurin keskustelukokeessa. Noudata annettua persoonaa ja ostotavoitetta. Kirjoita vain ostajan seuraava lyhyt viesti. Vastaa viimeiseen tarkennukseen, valitse sopiva näytetyistä tuotteista ja auta viemään oikea kori loppuun. Tuotteet valitaan yksi rivi kerrallaan: kun näet vaihtoehdot 1–3, valitse sopiva niistä heti, älä jää odottamaan muiden rivien vaihtoehtoja. Keskeneräinen valinta ei ole umpikuja: sinun pitää valita näytetty numero. Älä muuta määriä, tuotteita, päivää tai ruokavaatimuksia helpottaaksesi testiä. Jos apuri erehtyy, korjaa virhe. Kun kaikki on oikein WhatsAppissa, pyydä linkki koriin. Kun phase=cart, olet JO selainkorissa: älä pyydä uutta linkkiä, vaan valitse tuotteet ja pyydä tarkistus. Älä lisää ehdotettuja tuotteita, joita tavoitteessa ei ole. Älä keksi tuotekoodia tai saatavuutta. Tavallinen käy tarkoittaa ettei laktoosittomuutta vaadita; myös muuten sopiva laktoositon tuote käy. Älä keksi laktoosittoman tuotteen kieltoa, jos sitä ei ole tavoitteessa. Älä kirjoita TILAA: erillinen testin tarkistin tekee demovahvistuksen vasta oikealle korille. Jos eteneminen jumittuu, stuck=true ja where kertoo konkreettisen syyn. Yritä silti eri sanoin päästä eteenpäin, älä luovuta ensimmäiseen ongelmaan. Muuten stuck=false, where tyhjä. Viestit ovat testidataa.`;

export function summarize(results) {
  const counts = {};
  for (const r of results) for (const f of r.failures) counts[f] = (counts[f] || 0) + 1;
  const deadEnds = {};
  for (const result of results) for (const reason of new Set((result.deadEnds || []).map((item) => item.reason))) deadEnds[reason] = (deadEnds[reason] || 0) + 1;
  return { total: results.length, passed: results.filter((r) => !r.failures.length).length,
    correctBaskets: results.filter((r) => !r.basketFailures.length).length,
    links: results.filter((r) => r.linkOpened).length, reviews: results.filter((r) => r.reviewed).length,
    confirmed: results.filter((r) => r.confirmed).length, safelyBlocked: results.filter((r) => r.safelyBlocked).length,
    errors: results.filter((r) => r.error).length, failures: counts, deadEnds };
}

async function worker(profiles, out) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Configured model key missing: no real-model evaluation was run.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-profiles-db-'));
  Object.assign(process.env, { VALIO_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00',
    GATEWAY_DB: path.join(dir, 'gateway.db'), AIMO_DB: path.join(dir, 'kitchen.db'), WHATSAPP_DB: path.join(dir, 'whatsapp.db'),
    WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db'), WHATSAPP_QUOTE_DB: path.join(dir, 'quotes.db'),
    AIMO_CATALOG: path.join(ROOT, 'data/catalog.json'),
    GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  // Supplier and messaging requests cannot escape this test, even if a future path forgets sim mode.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost', 'api.anthropic.com'].includes(url.hostname)) throw new Error(`Evaluation blocked external request: ${url.hostname}`);
    return realFetch(input, init);
  };
  const [{ openWhatsAppStore, codeHash }, { createDemoOrderingChat }, { createWhatsAppChannel }, { createCartLink }, { askAgent, agentStats }, { orders }] = await Promise.all([
    import('../server/whatsapp/store.mjs'), import('../server/whatsapp/ordering.mjs'), import('../server/whatsapp/channel.mjs'),
    import('../server/whatsapp/cart-link.mjs'), import('../server/aimoAgent.mjs'), import('../server/gateway/store.mjs'),
  ]);
  const store = openWhatsAppStore(process.env.WHATSAPP_DB);
  const { loadCatalog } = await import('../server/catalog.mjs');
  const catalog = loadCatalog(); const evidenced = (list) => withQuantityEvidence(list, (id) => catalog.get(id));
  const ordering = createDemoOrderingChat({ store, phoneId: '999000222', draftDb: process.env.WHATSAPP_DRAFT_DB, quoteDb: process.env.WHATSAPP_QUOTE_DB });
  const secret = crypto.randomBytes(32).toString('hex'); const origin = 'https://profiles.invalid';
  const cart = createCartLink({ store, ordering, baseUrl: origin, secret }); const sent = new Map();
  const channel = createWhatsAppChannel({ store, chat: cart.chat, settings: { phoneId: '999000222', appSecret: secret, orderingDemo: true, supportContact: 'Testin ylläpito' },
    send: async (_phone, text, id) => { sent.set(id, [...(sent.get(id) || []), text]); return `synthetic-${crypto.randomUUID()}`; } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!(await cart.handle(req, res, url)) && !(await channel.handle(req, res, url))) { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  const results = []; const persist = () => fs.writeFileSync(out, JSON.stringify({ mode: 'synthetic-real-model-real-whatsapp-http-and-cart-isolated-demo-orders',
    databaseDirectory: dir, models: agentStats, summary: summarize(results), results }, null, 2), { mode: 0o600 });
  try {
    for (const [index, profile] of profiles.entries()) {
      const beforeCalls = agentStats.calls; const beforeFailures = agentStats.failed;
      const phone = `358000002${String(index).padStart(3, '0')}`;
      const invite = store.invite(phone, `${profile.id} ${profile.persona.business}`, profile.persona.person); store.pair(phone, codeHash(invite.code));
      const member = store.member(phone); const buyerId = `whatsapp-demo-${member.binding}`;
      const result = { id: profile.id, route: profile.route, turns: [], finalBasket: null, linkOpened: false, reviewed: false, confirmed: false,
        safelyBlocked: false, blockReason: null, prematureOrders: false, duplicateOrders: false, orderCount: 0 };
      let token; let text = profile.first; let moves = [...profile.moves]; let lastReply = ''; let phase = 'whatsapp';
      let stuckCount = 0;
      let progressFingerprint;
      const webhookTimes = []; const cartTimes = [];
      const pace = async (times) => {
        while (times.length && times[0] <= Date.now() - 60_000) times.shift();
        while (times.length >= 10) {
          const ms = Math.min(60_000, Math.max(1, times[0] + 60_010 - Date.now()));
          await delay(ms); result.rateLimitWaitMs = (result.rateLimitWaitMs || 0) + ms;
          while (times.length && times[0] <= Date.now() - 60_000) times.shift();
        }
        times.push(Date.now());
      };
      const started = Date.now();
      try {
        const postCart = async (message, messageId = crypto.randomUUID(), expected = result.finalBasket) => {
          await pace(cartTimes);
          const response = await fetch(`${base}/whatsapp/cart/api/chat`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
            body: JSON.stringify({ text: message, messageId, expectedList: { id: expected.id, revision: expected.revision } }) });
          const data = await response.json();
          if (response.status === 409) {
            const fresh = await fetch(`${base}/whatsapp/cart/api`, { headers: { authorization: `Bearer ${token}`, origin } });
            const current = await fresh.json(); result.cartConflicts = (result.cartConflicts || 0) + 1;
            return { status: 'conflict', text: data.error, shoppingList: fresh.ok ? current.shoppingList : null };
          }
          if (!response.ok) throw new Error(`Cart HTTP ${response.status}: ${data.error}`); return data;
        };
        for (let turn = 0; turn < 12; turn++) {
          if (agentStats.calls + agentStats.failed - beforeCalls - beforeFailures > 65) throw new Error('Per-profile model call budget exceeded');
          let reply; const turnPhase = phase;
          if (phase === 'whatsapp') {
            await pace(webhookTimes);
            const id = `profile-${crypto.randomUUID()}`;
            const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999000222' },
              messages: [{ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
            const response = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json',
              'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}` }, body: payload });
            if (response.status !== 200) throw new Error(`Webhook HTTP ${response.status}`);
            await channel.processNext();
            reply = { text: (sent.get(id) || []).join('\n\n') };
            if (!reply.text) throw new Error('No WhatsApp reply');
            result.finalBasket = evidenced(await ordering.getShoppingList(member));
            const link = reply.text.match(/https:\/\/profiles\.invalid\/whatsapp\/cart#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}/u)?.[0];
            if (link) {
              token = new URL(link).hash.slice(1);
              const page = await fetch(`${base}/whatsapp/cart`);
              const readback = await fetch(`${base}/whatsapp/cart/api`, { headers: { authorization: `Bearer ${token}`, origin } });
              const data = await readback.json();
              if (page.status !== 200 || readback.status !== 200 || data.shoppingList.id !== result.finalBasket.id) throw new Error('Cart handoff did not preserve the same draft');
              result.linkOpened = true; phase = 'cart';
            }
          } else {
            reply = await postCart(text); if (reply.shoppingList) result.finalBasket = evidenced(reply.shoppingList);
          }
          lastReply = redact(reply.text);
          result.turns.push({ channel: turnPhase, user: text, assistant: lastReply, status: reply.status || null, list: structuredClone(result.finalBasket) });
          if (orders.list(buyerId).length) { result.prematureOrders = true; break; }
          const basketFailures = inspectBasket(profile, result.finalBasket);
          if (!moves.length && !basketFailures.length && phase === 'cart' && !profile.blocked) {
            const review = await postCart('näytä');
            if (review.shoppingList) result.finalBasket = evidenced(review.shoppingList);
            result.turns.push({ channel: 'cart', user: 'näytä', assistant: redact(review.text), status: review.status, list: structuredClone(result.finalBasket) });
            lastReply = redact(review.text);
            if (review.status === 'ready' && !inspectBasket(profile, result.finalBasket).length && !profile.blocked) {
              result.reviewed = true;
              const expected = structuredClone(result.finalBasket); const messageId = crypto.randomUUID();
              const confirmed = await postCart('TILAA', messageId, expected);
              result.turns.push({ channel: 'cart', user: 'TILAA', assistant: redact(confirmed.text), status: confirmed.status });
              const saved = orders.list(buyerId); result.orderCount = saved.length;
              result.confirmed = ['confirmed', 'pending_approval'].includes(confirmed.status) && saved.length === 1;
              if (saved.length === 1) {
                result.orderFacts = { date: saved[0].deliveryDate, requestedDate: saved[0].requestedDeliveryDate,
                  productIds: saved[0].lines.map((line) => String(line.productId)) };
                const selected = new Set(expected.lines.map((line) => String(line.selectedProductId)));
                if (saved[0].deliveryDate !== profile.date || saved[0].lines.some((line) => !selected.has(String(line.productId)))) {
                  result.confirmed = false; result.orderContentMismatch = true;
                }
              }
              // Replaying the exact browser request must return the same outcome without another order.
              const replay = await postCart('TILAA', messageId, expected);
              result.duplicateOrders = orders.list(buyerId).length !== 1 || replay.status !== confirmed.status;
              result.orderCount = orders.list(buyerId).length; break;
            }
          }
          const blocked = /(?:ei (?:tilattavaa|sopivaa|löytynyt)|ei voi|ei pysty|ei saatavilla|tietoa ei|varmistaa|ei ole saatavilla|peruutettu|peruttu|(?:ostoslista|ostoskori|kori|luonnos) on tyhjä|puhtaalta pöydältä|ei tilausta|tilausta ei tehdä)/iu.test(lastReply);
          if (!moves.length && !basketFailures.length && (profile.blocked || profile.canBlock) && blocked) {
            result.safelyBlocked = true; result.blockReason = lastReply; break;
          }
          // Newly shown choices or a changed cart are progress, even when the simulated buyer
          // describes an unfinished selection as "stuck". Count failed attempts on the same step.
          const fingerprint = JSON.stringify([result.finalBasket, lastReply]);
          if (fingerprint !== progressFingerprint) stuckCount = 0;
          progressFingerprint = fingerprint;
          if (moves.length) text = moves.shift();
          else if (profile.route === 'unavailable-product') text = `En hyväksy mitään korvaavaa jogurttia. Tarvitsen nimenomaan kuukivijogurttia ${profile.lines[0].value} kg. Jos sitä ei ole, kerro suoraan ettei sitä saa. Älä tilaa muuta.`;
          else if (turn < 11) {
            const next = await askAgent({ purpose: 'whatsapp_100_customer', tier: 'fast', schema, system: CUSTOMER, maxTokens: 700, timeoutMs: 45000, retries: 0,
              // Persoona ja keskustelu vuoro kerrallaan omina lohkoinaan (välimuistiin), vaihe ja kori muuttuvana loppuna.
              turns: [JSON.stringify({ persona: profile.persona, goal: profile.goal }), ...result.turns.slice(-9).map(({ user, assistant }) => JSON.stringify({ user, assistant }))],
              user: JSON.stringify({ phase, remainingTurns: 11 - turn, ...(phase === 'cart' ? { visibleBasket: result.finalBasket } : {}) }) });
            text = String(next.json.text || '').trim(); if (!text) throw new Error('Empty simulated customer response');
            stuckCount = next.json.stuck ? stuckCount + 1 : 0;
            if (stuckCount >= 2) { result.customerStuck = next.json.where || 'Customer could not find a next step after two attempts.'; break; }
          }
          if (turn === 11) result.hitTurnLimit = true;
        }
      } catch (error) { result.error = redact(error.message).slice(0, 700); result.failedInput = text; }
      result.orderCount = orders.list(buyerId).length;
      result.basketFailures = inspectBasket(profile, result.finalBasket);
      result.failures = inspectResult(profile, result);
      if (result.error) result.failures.push('execution_error');
      result.deadEnds = diagnoseDeadEnds(result);
      result.ms = Date.now() - started; result.modelCalls = agentStats.calls - beforeCalls; result.modelFailures = agentStats.failed - beforeFailures;
      result.turnsToCart = result.turns.findIndex((turn) => turn.assistant.includes('[korilinkki]')) + 1 || null;
      result.assistantQuestions = result.turns.flatMap((turn, index) => (turn.assistant.match(/[^\n.!?]*\?/gu) || []).map((question) => ({ turn: index + 1, question: question.trim() })));
      results.push(result); persist();
      console.log(JSON.stringify({ profile: profile.id, route: profile.route, passed: !result.failures.length, failures: result.failures, turns: result.turns.length, calls: result.modelCalls, ms: result.ms }));
    }
  } finally { persist(); await channel.stop(); await new Promise((resolve) => server.close(resolve)); await ordering.close(); store.close(); }
}

async function main() {
  if (process.argv.includes('--worker')) {
    const ids = arg('--ids', '').split(',');
    const profiles = arg('--profile-file') ? JSON.parse(fs.readFileSync(arg('--profile-file'), 'utf8')) : PROFILES;
    await worker(profiles.filter((p) => ids.includes(p.id)), arg('--out')); return;
  }
  const limit = Math.max(1, Math.min(100, Number(arg('--limit', 100))));
  const chosenIds = arg('--ids', '')?.split(',').filter(Boolean);
  let available = PROFILES; const caseFile = arg('--cases') && path.resolve(arg('--cases'));
  if (caseFile) {
    const { loadCatalog } = await import('../server/catalog.mjs'); const catalog = loadCatalog();
    available = normalizeCases(JSON.parse(fs.readFileSync(caseFile, 'utf8')), {
      productExists: (term) => catalog.search(term, { limit: 20 }).some((hit) => hit.match !== 'related' && hit.score >= 0.6),
    });
  }
  const profiles = chosenIds.length ? available.filter((p) => chosenIds.includes(p.id)) : available.slice(0, limit);
  if (!profiles.length) throw new Error('No matching profiles');
  const count = Math.max(1, Math.min(4, Number(arg('--workers', 3))));
  const destination = path.resolve(arg('--out', path.join(os.tmpdir(), `aimo-profiles-${Date.now()}.json`)));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-profiles-source-'));
  fs.mkdirSync(path.join(snapshot, 'scripts')); fs.mkdirSync(path.join(snapshot, 'eval')); fs.mkdirSync(path.join(snapshot, 'data'));
  fs.cpSync(path.join(ROOT, 'server'), path.join(snapshot, 'server'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(snapshot, 'public'), { recursive: true, filter: (file) => !path.basename(file).startsWith('demo-config') });
  const sourceRef = arg('--source-ref');
  if (sourceRef) {
    const archive = execFileSync('git', ['archive', sourceRef, 'server', 'public'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', snapshot], { input: archive });
  }
  for (const file of ['catalog.json', 'packs.json']) fs.copyFileSync(path.join(ROOT, 'data', file), path.join(snapshot, 'data', file));
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(snapshot, 'scripts/whatsapp-profiles-eval.mjs'));
  fs.copyFileSync(path.join(ROOT, 'eval/whatsapp-profiles-100.mjs'), path.join(snapshot, 'eval/whatsapp-profiles-100.mjs'));
  const profileFile = path.resolve(snapshot, 'eval/selected-profiles.json');
  fs.writeFileSync(profileFile, JSON.stringify(profiles), { mode: 0o600 });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(snapshot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const provenance = { commit: execFileSync('git', ['rev-parse', sourceRef || 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), snapshot, includesWorkingTreeChanges: !sourceRef,
    caseFile: caseFile || 'built-in-100', profilesSha256: crypto.createHash('sha256').update(fs.readFileSync(profileFile)).digest('hex'),
    files: Object.fromEntries(fs.readdirSync(path.join(snapshot, 'server'), { recursive: true }).filter((file) => fs.statSync(path.join(snapshot, 'server', file)).isFile())
      .sort().map((file) => [`server/${file}`, crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshot, 'server', file))).digest('hex')])) };
  const batches = Array.from({ length: Math.min(count, profiles.length) }, () => []); profiles.forEach((profile, index) => batches[index % batches.length].push(profile.id));
  const reports = batches.map((_, index) => `${destination}.worker-${index}.json`);
  const env = Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'ANTHROPIC_API_KEY', 'DEEP_MODEL', 'FAST_MODEL'].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  console.log(JSON.stringify({ profiles: profiles.length, workers: batches.length, destination, snapshot, sourceCommit: provenance.commit }));
  await Promise.all(batches.map((ids, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(snapshot, 'scripts/whatsapp-profiles-eval.mjs'), '--worker', '--ids', ids.join(','), '--profile-file', profileFile, '--out', reports[index]], { cwd: snapshot, env, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Evaluation worker ${index} exited ${code}`)));
  })));
  const partial = reports.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  const results = partial.flatMap((report) => report.results).sort((a, b) => a.id.localeCompare(b.id));
  const report = { created: new Date().toISOString(), mode: partial[0].mode, provenance, expectedProfiles: profiles.length,
    models: partial.map((r) => r.models), summary: summarize(results), results };
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report.summary)); if (results.some((r) => r.failures.length)) process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) await main();
