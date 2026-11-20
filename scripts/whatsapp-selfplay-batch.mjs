// 100 synteettisen ostajan itsekeskustelu WhatsApp-tilausapurin kanssa, paloina erillisissä lapsiprosesseissa.
// Käyttää Codexin runSelfplay-ajuria (scripts/whatsapp-selfplay.mjs) sellaisenaan: oikea webhook, jono, kanava ja
// keskusteluydin eristetyillä kannoilla, simuloidut hinnat, ei Meta-lähetyksiä eikä tilauksia. Persoonat ja omat
// tarkistukset: eval/whatsapp-personas.mjs. Ajetaan vain käsin; ei ajastu eikä toistu itsestään.
//
//   node --env-file=.env --env-file=.env.whatsapp scripts/whatsapp-selfplay-batch.mjs --limit 10
//     (.env.whatsapp antaa apurille saman DEEP_MODELin kuin puhelimen palvelimella; ilman sitä apuri käyttää .env:n mallia)
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --offset 10 --limit 90 --concurrency 3 --max-calls 4000
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --set regressions   (R01–R06, baseline-ajon löydökset)
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --set extended      (X001–X100: virheet, murteet, kiire, kysymykset)
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --set data          (V001–V035: vastaus tarkistetaan Valion datasta)
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --set extended --source-ref origin/main   (apurin koodi GitHubista)
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --cases eval/omat-tapaukset.mjs:CASES
//     --cases: mikä tahansa projektin moduuli (polku[:export], useita pilkulla). Tapauksissa runSelfplayn kentät
//     (id, first, brief, expected, date, maxTurns). Moduulin oma inspect(case, turns, list) korvaa inspectPersonan;
//     se voi palauttaa listan virheitä tai { failures, newRequirement, observations, metrics }. Kenttä now asettaa
//     demokellon tapauskohtaisesti (sama now ajetaan samassa lapsiprosessissa).
//   node --env-file=.env scripts/whatsapp-selfplay-batch.mjs --deep-effort medium   (apurin syvän tason effort ajon lähdekopiossa; oletus on sovelluksen high)
//   node scripts/whatsapp-selfplay-batch.mjs --dry-run         (ei mallikutsuja: listaa persoonat)
//   node scripts/whatsapp-selfplay-batch.mjs --reinspect data/selfplay/<ajo>/results.json   (tarkistukset uudelleen tallennetuista vuoroista)
//
// Raportit: data/selfplay/<aikaleima>/ (Gitin ohittama): results.json ja summary.md. Lähdekoodista otetaan ajon alussa
// kopio väliaikaiseen hakemistoon, jotta rinnakkain muokattava työpuu ei vaihdu kesken ajon. Kopion sormenjälki raporttiin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(name);
export const SELFPLAY_DEFAULT_NOW = '2026-11-15T09:00:00+02:00'; // sama kuin runSelfplayn DEMO_NOW
export const CASE_SETS = { default: 'eval/whatsapp-personas.mjs:PERSONAS', regressions: 'eval/whatsapp-personas.mjs:REGRESSIONS',
  extended: 'eval/whatsapp-personas-extended.mjs:EXTENDED', data: 'eval/whatsapp-personas-data.mjs:DATA_CASES',
  all: 'eval/whatsapp-personas.mjs:PERSONAS,eval/whatsapp-personas.mjs:REGRESSIONS,eval/whatsapp-personas-extended.mjs:EXTENDED,eval/whatsapp-personas-data.mjs:DATA_CASES' };

/** Tapaukset ja niiden tarkistimet tiedosto:export-listasta. Polut ovat suhteessa projektin (tai lähdekopion) juureen. */
export async function loadCases(root, spec) {
  const { inspectPersona } = await import(pathToFileURL(path.join(root, 'eval/whatsapp-personas.mjs')).href);
  const cases = []; const inspectors = new Map(); const files = [];
  for (const part of String(spec).split(',').map((x) => x.trim()).filter(Boolean)) {
    const [file, name] = part.split(':');
    if (path.isAbsolute(file) || file.split(/[\\/]/u).includes('..')) throw new Error(`Tapaustiedoston pitää olla projektin sisällä: ${file}`);
    const mod = await import(pathToFileURL(path.join(root, file)).href);
    const list = (name ? mod[name] : mod.CASES || mod.PERSONAS || mod.default || Object.values(mod).find(Array.isArray));
    if (!Array.isArray(list)) throw new Error(`Tapauslistaa ei löytynyt: ${part}`);
    const inspect = typeof mod.inspect === 'function' ? mod.inspect : inspectPersona;
    for (const c of list) { if (!c?.id || inspectors.has(c.id)) throw new Error(`Puuttuva tai toistuva tapaus-id: ${c?.id} (${part})`); cases.push(c); inspectors.set(c.id, inspect); }
    files.push(file);
  }
  return { cases, inspectors, files: [...new Set(files)] };
}
const normalize = (r) => (Array.isArray(r) ? { failures: r, newRequirement: [], observations: [], metrics: {} } : { failures: [], newRequirement: [], observations: [], metrics: {}, ...r });

// Hinnat USD / 1M tokenia, claude-api-taidon mallitaulukko (välimuistissa 2026-11-03). Välimuistiluku Opus 5.5: 0,20.
// Ajattelutokenit laskutetaan output-tokeneina. Välimuistiin kirjoitus (5 min) maksaa 1,25 × syötteen hinta.
export const PRICES = { 'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 }, 'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 }, 'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 } };
// Apurin ainoa fast-tason kutsu (Haiku) on lisätuote-ehdotus; sen muut kutsut ovat deep-tasoa (DEEP_MODEL). Simuloitu
// asiakas ja arvioija ovat simTier-tasoa: uusissa ajoissa oletuksena fast, ennen 16.11.2026 tehdyissä ajoissa (meta ilman
// simTieriä) deep. Ennen 17.11.2026 tehdyissä ajoissa välimuistiin kirjoitusta ei laskettu, joten niiden arvio on hieman alakanttiin.
export const FAST_PURPOSES = new Set(['whatsapp_optional_addition']);
export const SIM_PURPOSES = new Set(['whatsapp_selfplay_customer', 'whatsapp_selfplay_review']);
export const simTierFromEnv = (env = process.env) => (env.WHATSAPP_SELFPLAY_SIM_TIER === 'deep' ? 'deep' : 'fast');
export const modelOf = (purpose, deepModel = 'claude-opus-5-5', fastModel = 'claude-haiku-5-5', simTier = 'deep') =>
  (FAST_PURPOSES.has(purpose) || (SIM_PURPOSES.has(purpose) && simTier === 'fast') ? fastModel : deepModel);
export function costUsd(tokens, model) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const write = tokens.cacheWrite || 0;
  return ((tokens.input - tokens.cacheRead - write) * p.input + write * p.input * 1.25 + tokens.cacheRead * p.cacheRead + tokens.output * p.output) / 1e6;
}

// ------------------------------------------------------------------------------------------------ lapsiprosessi
async function child() {
  const ids = arg('--ids', '').split(',').filter(Boolean);
  const out = arg('--out');
  // Ulkoiset pyynnöt estetään: vain paikallinen testipalvelin ja mallirajapinta. Asetetaan ennen yhtäkään palvelinmoduulia.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost', 'api.anthropic.com'].includes(url.hostname)) throw new Error(`Selfplay blocked external request: ${url.hostname}`);
    return realFetch(input, init);
  };
  const { cases } = await loadCases(ROOT, arg('--cases', CASE_SETS.default)).then((x) => ({ cases: x.cases.filter((c) => ids.includes(c.id)) }));
  // Demokello luetaan kerran gateway/clock.mjs:n latauksessa. Ladataan se tapauksen ajalla ennen runSelfplayta, joka
  // asettaa muuten kiinteän DEMO_NOW-arvon. Erässä on vain saman now-arvon tapauksia (pääprosessi ryhmittelee).
  // Ilman tapauskohtaista now-arvoa kello kiinnitetään runSelfplayn oletukseen (su 15.11.2026 klo 9). Muuten kello latautuu
  // oikeana ennen runSelfplayn DEMO_NOW-asetusta ja suhteelliset päivät ("tiistaiksi") ja tilausajat siirtyvät ajohetken mukana.
  const now = cases[0]?.now || SELFPLAY_DEFAULT_NOW;
  process.env.DEMO_NOW = now;
  const { clock } = await import(pathToFileURL(path.join(ROOT, 'server/gateway/clock.mjs')).href);
  const clockAt = clock.now().toISOString();
  // aimoAgent lukee vain mallin asetukset (config.mjs). Kantapolut luetaan vasta runSelfplayn eristämässä ympäristössä.
  const { agentStats } = await import(pathToFileURL(path.join(ROOT, 'server/aimoAgent.mjs')).href);
  const tokens = {}; let seen = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const track = (purpose, entry) => {
    let calls = entry.calls || 0;
    Object.defineProperty(entry, 'calls', { enumerable: true, get: () => calls, set: (value) => {
      // askAgent kasvattaa tokenilaskurit ja tarkoituksen kutsumäärän samassa synkronisessa jaksossa: erotus kuuluu tälle kutsulle.
      const now = { input: agentStats.inputTokens, output: agentStats.outputTokens, cacheRead: agentStats.cacheReadTokens, cacheWrite: agentStats.cacheWriteTokens };
      const t = (tokens[purpose] ||= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      t.calls += value - calls; t.input += now.input - seen.input; t.output += now.output - seen.output; t.cacheRead += now.cacheRead - seen.cacheRead; t.cacheWrite += now.cacheWrite - seen.cacheWrite;
      seen = now; calls = value;
    } });
    return entry;
  };
  agentStats.byPurpose = new Proxy(agentStats.byPurpose, { set(target, key, value) { target[key] = track(String(key), value); return true; } });
  const { runSelfplay } = await import(pathToFileURL(path.join(ROOT, 'scripts/whatsapp-selfplay.mjs')).href);
  const started = Date.now();
  let report = null; let error = null;
  try { report = await runSelfplay({ cases, maxTurns: Number(arg('--max-turns')) || undefined, out: null }); }
  catch (err) { error = String(err?.message || err).slice(0, 500); }
  fs.writeFileSync(out, JSON.stringify({ ids, error, ms: Date.now() - started, report, tokens, clock: { requested: now, at: clockAt },
    stats: { calls: agentStats.calls, failed: agentStats.failed, input: agentStats.inputTokens, output: agentStats.outputTokens, cacheRead: agentStats.cacheReadTokens, cacheWrite: agentStats.cacheWriteTokens } }, null, 1), { mode: 0o600 });
}

// ------------------------------------------------------------------------------------------------ yhteenveto
const redact = (text) => String(text || '').replace(/https?:\/\/\S+/gu, '[linkki]').replace(/\b\+?358\d{6,}\b/gu, '[numero]');

/** Tiivis löydösraportti Markdownina. results: persoonakohtaiset rivit, totals: kutsut ja tokenit. */
export function summarize(results, totals, meta) {
  // Codexin vertailusarake vain tilaaville persoonille: pelkkä kysymys tai peruminen ei kuulu sen tilausodotuksiin.
  const count = (pick) => { const c = {}; for (const r of results) for (const f of pick(r)) { const k = f.replace(/:.*/u, ''); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const ok = results.filter((r) => !r.error);
  const base = count((r) => r.failures || []); const fresh = count((r) => r.newRequirement || []); const codex = count((r) => (r.persona?.expectEmpty ? [] : r.codexFailures || [])); const obs = count((r) => r.observations || []);
  const scores = {}; for (const r of ok) { const s = r.judgment?.score ?? 'ei arviota'; scores[s] = (scores[s] || 0) + 1; }
  const byCat = {}; for (const r of results) if (r.persona?.category) { const x = (byCat[r.persona.category] ||= { n: 0, pass: 0, fresh: 0 }); x.n += 1; if (!r.error && !r.failures.length) x.pass += 1; if (!r.error && !r.newRequirement.length) x.fresh += 1; }
  const byRoute = {}; for (const r of results) { const x = (byRoute[r.route] ||= { n: 0, pass: 0, fresh: 0 }); x.n += 1; if (!r.error && !r.failures.length) x.pass += 1; if (!r.error && !r.newRequirement.length) x.fresh += 1; }
  const example = (key, pick) => {
    const r = results.find((x) => pick(x).some((f) => f.startsWith(key))); if (!r?.turns?.length) return '';
    const want = /diet/u.test(key) ? (x) => /(laktoos|gluteen|maidot|allergi|ruokavalio)[^?\n]*\?/iu.test(x.assistant)
      : /option|more|four/u.test(key) ? (x) => /^\s*\d[.)]/mu.test(x.assistant) : /cart_claim/u.test(key) ? (x) => /päivitin|lisäsin|ostoskorissasi/iu.test(x.assistant) : /date/u.test(key) ? () => true : null;
    const t = (want && r.turns.find(want)) || r.turns.at(-1);
    return t ? ` Esim. ${r.id} (${r.route}): ostaja "${redact(t.user).slice(0, 120)}" / apuri "${redact(t.assistant).replace(/\n+/gu, ' / ').slice(0, 220)}"` : ` Esim. ${r.id}.`;
  };
  const cost = Object.entries(totals.byPurpose).reduce((sum, [k, t]) => sum + costUsd(t, modelOf(k, meta.deepModel, meta.fastModel, meta.simTier)), 0);
  const perPersona = ok.length ? cost / ok.length : 0;
  const lines = [
    `# Itsekeskustelu ${meta.created}${meta.reinspected ? ` (tarkistukset ajettu uudelleen ${meta.reinspected})` : ''}`, '',
    `Lähde: ${meta.sourceRef ? `${meta.sourceRef} = ` : ''}${meta.commit}${meta.dirty.length ? ` + ${meta.dirty.length} commitoimatonta tiedostoa (${meta.dirty.slice(0, 8).join(', ')}${meta.dirty.length > 8 ? ', …' : ''})` : ''}, lähdekopion sormenjälki ${meta.snapshotHash.slice(0, 12)}.`,
    `Tila: eristetyt kannat, simuloidut hinnat, ei Meta-lähetyksiä, ei tilauksia (tilauksia ${totals.orders}).`,
    `Mallit: apuri ${meta.deepModel || 'claude-opus-5-5'}${meta.deepEffort ? ` (effort ${meta.deepEffort})` : ''} (lisätuote ${meta.fastModel || 'claude-haiku-5-5'}), simuloitu asiakas ja arvioija ${modelOf('whatsapp_selfplay_customer', meta.deepModel, meta.fastModel, meta.simTier)}.`, '',
    `Persoonat ${results.length}, ajettu ${ok.length}, ajovirheitä ${results.length - ok.length}. Perusvaatimukset läpi ${ok.filter((r) => !r.failures.length).length}/${ok.length}, uusi vaatimus (a–c) läpi ${ok.filter((r) => !r.newRequirement.length).length}/${ok.length}.`,
    `Mallikutsut ${totals.calls} (epäonnistuneita ${totals.failed}), ${ok.length ? (totals.calls / ok.length).toFixed(1) : 0} / persoona. Tokenit sisään ${totals.input} (välimuistista ${totals.cacheRead}, välimuistiin ${totals.cacheWrite}), ulos ${totals.output}. Kustannusarvio ${cost.toFixed(2)} USD, ${perPersona.toFixed(3)} USD / persoona (välimuistiin kirjoitus puuttuu laskurista). Kesto ${(totals.ms / 60000).toFixed(1)} min, persoonaa kohden ${(ok.length ? totals.personaMs / ok.length / 1000 : 0).toFixed(0)} s seinäkelloa, josta apurin vastaukset ${(ok.length ? totals.assistantMs / ok.length / 1000 : 0).toFixed(0)} s.`, '',
    '## Perusvaatimukset (d–f)', ...base.map(([k, n]) => `- ${k}: ${n}.${example(k, (r) => r.failures || [])}`), ...(base.length ? [] : ['- ei virheitä']), '',
    '## Uusi vaatimus (a–c ja tervehdys): päivä ensin, numeroidut vaihtoehdot, 4 = lisää, tervehdys kellonajan mukaan', ...fresh.map(([k, n]) => `- ${k}: ${n}.${example(k, (r) => r.newRequirement || [])}`), ...(fresh.length ? [] : ['- ei virheitä']), '',
    '## Lisähavainnot (deterministiset, eivät kaada persoonaa)', ...obs.map(([k, n]) => `- ${k}: ${n}.${example(k, (r) => r.observations || [])}`), ...(obs.length ? [] : ['- ei havaintoja']), '',
    '## Codexin inspectConversation (vertailu, vain tilaavat persoonat)', ...codex.map(([k, n]) => `- ${k}: ${n}`), ...(codex.length ? [] : ['- ei virheitä']), '',
    ...(Object.keys(byCat).length ? ['## Luokat', '| luokka | n | perus läpi | uusi läpi |', '|---|---|---|---|', ...Object.entries(byCat).map(([k, x]) => `| ${k} | ${x.n} | ${x.pass} | ${x.fresh} |`), ''] : []),
    '## Polut', '| polku | n | perus läpi | uusi läpi |', '|---|---|---|---|', ...Object.entries(byRoute).map(([k, x]) => `| ${k} | ${x.n} | ${x.pass} | ${x.fresh} |`), '',
    '## Arvioijan pisteet (1–5)', ...Object.entries(scores).sort().map(([k, n]) => `- ${k}: ${n}`), '',
    '## Mallikutsut tarkoituksittain', '| tarkoitus | kutsut | sisään | välimuistista | ulos | USD |', '|---|---|---|---|---|---|',
    ...Object.entries(totals.byPurpose).sort((a, b) => b[1].calls - a[1].calls).map(([k, t]) => `| ${k} | ${t.calls} | ${t.input} | ${t.cacheRead} | ${t.output} | ${costUsd(t, modelOf(k, meta.deepModel, meta.fastModel, meta.simTier)).toFixed(2)} |`), '',
    ...(results.some((r) => r.error) ? ['## Ajovirheet', ...results.filter((r) => r.error).map((r) => `- ${r.id}: ${redact(r.error).slice(0, 200)}`), ''] : []),
    '## Arvioijan nimeämät ongelmat (otos)', ...ok.filter((r) => r.judgment?.problems?.length).slice(0, 15).map((r) => `- ${r.id} (${r.route}, ${r.judgment.score}): ${redact(r.judgment.problems.slice(0, 2).join(' | ')).slice(0, 300)}`),
  ];
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ pääprosessi
// sourceRef (esim. origin/main): apurin koodi (server/, runSelfplay ja sen tapaukset) Gitistä eikä työpuusta, jotta tulos
// vastaa julkaistua versiota. Tämän ajurin ja persoonien tiedostot tulevat aina työpuusta.
/** Kiinnittää syvän tason effort-arvon ajon lähdekopioon (ei sovelluskoodiin): vertailuajoja varten. Heittää, jos rivi on muuttunut. */
export function patchDeepEffort(source, effort) {
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error(`Tuntematon effort: ${effort}`);
  const from = "effort: deep ? 'high' : 'low'";
  if (!source.includes(from)) throw new Error('server/aimoAgent.mjs:n effort-rivi ei vastaa odotettua: effort-asetusta ei voi kiinnittää');
  return source.replace(from, `effort: deep ? '${effort}' : 'low'`);
}

function snapshot(caseFiles = [], sourceRef = null, deepEffort = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-selfplay100-src-'));
  fs.cpSync(path.join(ROOT, 'server'), path.join(dir, 'server'), { recursive: true });
  const fromRef = ['server', 'scripts/whatsapp-selfplay.mjs', 'eval/whatsapp-selfplay-cases.mjs'];
  for (const f of new Set(['scripts/whatsapp-selfplay.mjs', 'scripts/whatsapp-selfplay-batch.mjs', 'eval/whatsapp-selfplay-cases.mjs', 'eval/whatsapp-personas.mjs', 'eval/whatsapp-personas-extended.mjs', 'eval/whatsapp-personas-data.mjs', ...caseFiles])) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  fs.mkdirSync(path.join(dir, 'data')); fs.mkdirSync(path.join(dir, 'public'));
  for (const f of ['catalog.json', 'packs.json']) if (fs.existsSync(path.join(ROOT, 'data', f))) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(dir, 'data', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((x) => /^whatsapp-[\w-]+\.(html|js|css)$/u.test(x))) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(dir, 'public', f));
  if (sourceRef) {
    fs.rmSync(path.join(dir, 'server'), { recursive: true, force: true });
    const archive = execFileSync('git', ['archive', sourceRef, ...fromRef], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: archive });
  }
  if (deepEffort) { const agentFile = path.join(dir, 'server/aimoAgent.mjs'); fs.writeFileSync(agentFile, patchDeepEffort(fs.readFileSync(agentFile, 'utf8'), deepEffort)); }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  const hash = crypto.createHash('sha256');
  for (const f of fs.readdirSync(dir, { recursive: true }).filter((x) => !String(x).startsWith('node_modules') && !String(x).startsWith('data')).sort()) {
    const full = path.join(dir, f); if (fs.statSync(full).isFile()) hash.update(`${f}\0`).update(fs.readFileSync(full));
  }
  const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }); } catch { return ''; } };
  const own = ['eval/whatsapp-personas.mjs', 'eval/whatsapp-personas-extended.mjs', 'eval/whatsapp-personas-data.mjs', 'scripts/whatsapp-selfplay-batch.mjs', ...caseFiles];
  const dirty = (sourceRef ? git('status', '--porcelain', '--', ...own) : git('status', '--porcelain', '--', ...fromRef, ...own))
    .split('\n').filter(Boolean).map((l) => l.slice(3));
  return { dir, hash: hash.digest('hex'), commit: git('rev-parse', sourceRef || 'HEAD').trim(), sourceRef, dirty };
}

function runChild(src, ids, out, maxTurns, spec) {
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir(), HOME: process.env.HOME, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DEEP_MODEL: process.env.DEEP_MODEL || '', FAST_MODEL: process.env.FAST_MODEL || '', VALIO_API_KEY: '', WHATSAPP_SELFPLAY_SIM_TIER: simTierFromEnv(), AIMO_LEARNED: path.join(path.dirname(out), `learned-${path.basename(out)}`) };
  for (const k of ['DEEP_MODEL', 'FAST_MODEL']) if (!env[k]) delete env[k];
  const argv = ['--disable-warning=ExperimentalWarning', path.join(src, 'scripts/whatsapp-selfplay-batch.mjs'), '--child', '--cases', spec, '--ids', ids.join(','), '--out', out, ...(maxTurns ? ['--max-turns', String(maxTurns)] : [])];
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, argv, { cwd: src, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream(`${out}.log`, { mode: 0o600 });
    proc.stdout.pipe(log); proc.stderr.pipe(log);
    proc.stdout.on('data', (d) => { for (const line of String(d).split('\n')) { try { const j = JSON.parse(line); if (j.failures) console.log(`  ${j.case}: ${j.failures.length ? j.failures.join(', ') : 'ok'} (arvio ${j.judgment?.score ?? '-'})`); } catch { /* lokirivi */ } } });
    proc.on('exit', (code) => { log.end(`\n[lapsiprosessi päättyi koodilla ${code}]\n`); resolve(code); });
  });
}

/** Tallennetut vuorot takaisin inspectPersonan muotoon. Ref = tuotesana, koska vuoroissa ei tallenneta rivin tunnistetta. */
export function restoreTurns(result) {
  const asList = (t, diet) => ({ deliveryDate: t.deliveryDate, status: t.status || null, missing: t.missing || [], diet, lines: t.lines.map((l) => ({ ref: l.term, productTerm: l.term, quantity: l.quantity, claims: l.claims || [], excludeAllergens: l.excludeAllergens || [], selectedProductId: l.selected })) });
  const diet = result.finalList?.diet || { known: false, claims: [], excludeAllergens: [] };
  return result.turns.map((t) => ({ user: t.user, assistant: t.assistant, ms: t.ms, list: asList(t, diet) }));
}

async function reinspect(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { cases, inspectors } = await loadCases(ROOT, report.meta.cases || CASE_SETS.all);
  for (const r of report.results) {
    if (r.error) continue;
    // Nykyinen määritelmä, jos keskustelu alkoi samalla viestillä (tarkistuslippuja on voitu lisätä); muuten ajon aikainen.
    const current = cases.find((p) => p.id === r.id);
    const persona = current && (!r.persona || r.persona.first === current.first) ? current : r.persona;
    const own = normalize((inspectors.get(r.id) || inspectors.values().next().value)(persona, restoreTurns(r), r.finalList));
    Object.assign(r, { failures: own.failures, newRequirement: own.newRequirement, observations: own.observations, metrics: own.metrics });
  }
  report.meta.reinspected = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 1), { mode: 0o600 });
  const md = summarize(report.results, report.totals, report.meta);
  fs.writeFileSync(path.join(path.dirname(file), 'summary.md'), `${md}\n`, { mode: 0o600 });
  console.log(md.split('\n').slice(0, 8).join('\n'));
}

async function main() {
  if (arg('--reinspect')) { await reinspect(path.resolve(arg('--reinspect'))); return; }
  const spec = arg('--cases') || CASE_SETS[arg('--set') || 'default'];
  if (!spec) throw new Error(`Tuntematon --set: ${arg('--set')} (${Object.keys(CASE_SETS).join(', ')})`);
  const { cases: PERSONAS, inspectors, files: caseFiles } = await loadCases(ROOT, spec);
  const ids = arg('--ids')?.split(',').filter(Boolean);
  const offset = Math.max(0, Number(arg('--offset', 0)));
  const limit = Math.max(1, Math.min(200, Number(arg('--limit', 200))));
  const selected = ids ? PERSONAS.filter((p) => ids.includes(p.id)) : PERSONAS.slice(offset, offset + limit);
  if (!selected.length) throw new Error('Ei valittuja persoonia');
  if (flag('--dry-run')) { for (const p of selected) console.log(`${p.id} ${p.route || ''} ${p.kitchen || ''} ${p.style || ''}${p.now ? ` ${p.now.slice(11, 16)}` : ''}: ${p.first}`); return; }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY puuttuu (aja: node --env-file=.env ...). Mallikoetta ei ajettu.');
  const chunk = Math.max(1, Math.min(10, Number(arg('--chunk', 1))));
  const concurrency = Math.max(1, Math.min(4, Number(arg('--concurrency', 2))));
  const maxCalls = Math.max(1, Number(arg('--max-calls', 3000)));
  const maxTurns = Number(arg('--max-turns')) || null;
  const created = new Date().toISOString();
  const outDir = path.resolve(arg('--out-dir', path.join(ROOT, 'data/selfplay', created.replace(/[:.]/gu, '-'))));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const deepEffort = arg('--deep-effort') || process.env.WHATSAPP_SELFPLAY_DEEP_EFFORT || null;
  const src = snapshot(caseFiles, arg('--source-ref'), deepEffort);
  const meta = { created, cases: spec, deepEffort, sourceRef: src.sourceRef, commit: src.commit, dirty: src.dirty, snapshotHash: src.hash, deepModel: process.env.DEEP_MODEL || 'claude-opus-5-5', fastModel: process.env.FAST_MODEL || 'claude-haiku-5-5', simTier: simTierFromEnv(), chunk, concurrency, maxCalls };
  console.log(JSON.stringify({ personas: selected.length, chunk, concurrency, maxCalls, outDir, commit: src.commit.slice(0, 9), dirty: src.dirty.length, snapshot: src.dir }));

  // Erät saman demokellon mukaan, koska kello ladataan kerran lapsiprosessia kohden.
  const groups = new Map(); for (const p of selected) { const k = p.now || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p.id); }
  const queue = []; for (const ids0 of groups.values()) for (let i = 0; i < ids0.length; i += chunk) queue.push(ids0.slice(i, i + chunk));
  const totals = { calls: 0, failed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, orders: 0, ms: 0, personaMs: 0, assistantMs: 0, byPurpose: {} };
  const raw = new Map(); const skipped = []; const t0 = Date.now(); let n = 0;
  const work = async () => {
    while (queue.length) {
      if (totals.calls + totals.failed >= maxCalls) { skipped.push(...queue.splice(0).flat()); break; }
      const batch = queue.shift(); const out = path.join(outDir, `chunk-${String(++n).padStart(3, '0')}.json`);
      console.log(`aloitetaan ${batch.join(', ')}`);
      await runChild(src.dir, batch, out, maxTurns, spec);
      let result; try { result = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { result = { ids: batch, error: 'Lapsiprosessi päättyi ilman tulosta (katso .log)', tokens: {}, stats: {} }; }
      totals.calls += result.stats.calls || 0; totals.failed += result.stats.failed || 0; totals.input += result.stats.input || 0; totals.output += result.stats.output || 0; totals.cacheRead += result.stats.cacheRead || 0; totals.cacheWrite += result.stats.cacheWrite || 0;
      totals.orders += result.report?.orders || 0;
      if (/must not submit orders/iu.test(result.error || '')) totals.orders += 1;
      for (const [k, t] of Object.entries(result.tokens || {})) { const x = (totals.byPurpose[k] ||= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }); for (const f of Object.keys(x)) x[f] += t[f] || 0; }
      result.out = out; for (const id of batch) raw.set(id, { result, id });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));
  totals.ms = Date.now() - t0;

  const results = selected.map((persona) => {
    if (skipped.includes(persona.id)) return { id: persona.id, route: persona.route, kitchen: persona.kitchen, style: persona.style, error: 'ohitettu: kutsubudjetti täynnä', failures: [], newRequirement: [], turns: [] };
    const { result } = raw.get(persona.id);
    const r = result.report?.results?.find((x) => x.id === persona.id);
    if (!r) {
      // Keskeytynyt keskustelu: vuorot talteen lokista esimerkeiksi, ei tarkistuksia (korin tila puuttuu).
      let partial = []; try { partial = fs.readFileSync(`${result.out}.log`, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((j) => j?.case === persona.id && j.turn).map((j) => ({ user: redact(j.user), assistant: redact(j.assistant) })); } catch { /* ei lokia */ }
      return { id: persona.id, route: persona.route, kitchen: persona.kitchen, style: persona.style, error: result.error || 'ei tulosta', failures: [], newRequirement: [], turns: partial };
    }
    const list = r.turns.at(-1)?.list || null;
    const own = normalize(inspectors.get(persona.id)(persona, r.turns, list));
    const ms = r.turns.reduce((s, t) => s + (t.ms || 0), 0); totals.assistantMs += ms; totals.personaMs += (result.ms || 0) / Math.max(1, result.ids.length);
    return { id: persona.id, route: persona.route, kitchen: persona.kitchen, style: persona.style, persona, clock: result.clock, failures: own.failures, newRequirement: own.newRequirement, observations: own.observations, metrics: own.metrics,
      codexFailures: r.failures, judgment: r.judgment, assistantMs: ms, finalList: list,
      turns: r.turns.map((t) => ({ user: redact(t.user), assistant: redact(t.assistant), ms: t.ms, deliveryDate: t.list?.deliveryDate || null, status: t.list?.status || null, missing: t.list?.missing || [],
        lines: (t.list?.lines || []).map((l) => ({ term: l.productTerm, quantity: l.quantity, claims: l.claims, excludeAllergens: l.excludeAllergens, selected: l.selectedName || null })) })) };
  });
  const report = { meta, totals, results };
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 1), { mode: 0o600 });
  const md = summarize(results, totals, meta);
  fs.writeFileSync(path.join(outDir, 'summary.md'), `${md}\n`, { mode: 0o600 });
  console.log(`\n${md.split('\n').slice(0, 8).join('\n')}\n\nraportti: ${outDir}/summary.md`);
  fs.rmSync(src.dir, { recursive: true, force: true });
}

// realpath: macOS:n /var on linkki /private/var-hakemistoon, ja import.meta.url osoittaa todelliseen polkuun.
const real = (file) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };
if (process.argv[1] && real(process.argv[1]) === real(SELF)) {
  if (flag('--child')) await child(); else await main();
}
