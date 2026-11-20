// Tilausapurin v2-arviointi (docs/agent-v2.md, kohta Arviointi): sama ajuri ajaa vanhan putken ja v2:n.
// Jokainen skenaario ajetaan omassa lapsiprosessissaan lähdekopiosta (eval/agent-v2-harness.mjs): oikea webhook, jono,
// kanava ja tilauskeskustelu eristetyillä kannoilla, simuloitu Meta ja simuloitu ostaja, oikea katalogi ja Valion
// viimeisimmät tunnetut hinnat (hintavälimuistin kopio). Ei Meta-viestejä, ei Valion pyyntöjä, ei tilauksia.
// Pääprosessi tarkistaa tulokset koodilla (eval/agent-v2-checks.mjs), pyytää arvioijamallilta pisteet
// (eval/agent-v2-judge.mjs) ja kirjoittaa raportit. Kustannukset lasketaan jokaisen mallikutsun usage-kentästä.
// Ajetaan vain käsin; ei ajastu eikä toistu itsestään.
//
//   node --env-file=<repo>/.env scripts/agent-v2-eval.mjs --label vanha --pipeline old --budget 1.5
//   node --env-file=<repo>/.env scripts/agent-v2-eval.mjs --label v2-haiku --pipeline v2 --model claude-haiku-5-5 --effort medium --source-ref origin/main --budget 0.6
//   node scripts/agent-v2-eval.mjs --dry-run [--scenarios core|personas|E1-peruna-sipuli-kerma,...]
//   node scripts/agent-v2-eval.mjs --reinspect data/agent-v2-eval/<ajo>            (tarkistukset uudelleen, ei mallikutsuja)
//   node scripts/agent-v2-eval.mjs --compare data/agent-v2-eval/<a>,data/agent-v2-eval/<b>   (vertailutaulukko)
//
// Valinnat: --scenarios (all, core, personas tai id-lista), --cap (USD skenaariota kohden, oletus 0.4), --concurrency (oletus 3),
// --deep-model (vanhan putken DEEP_MODEL, oletus claude-haiku-5-5 kuten tuotannossa), --judge-model (oletus claude-sonnet-5-5),
// --judge-effort (oletus medium), --no-judge, --price-db (hintavälimuistin kopio, oletus data/agent-v2-eval/price-cache.db),
// --out-dir. Raportit: data/agent-v2-eval/<aikaleima>-<label>/ (Gitin ohittama): results.json, summary.md, transcripts.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(name);
const CORE = ['E1-peruna-sipuli-kerma', 'E2-palaute-kesken', 'E3-lanttulaatikko-500kg', 'G1-tervehdykset', 'A1-allergiat', 'B1-botti-ja-aiheen-ohi'];
const redact = (text) => String(text || '').replace(/https?:\/\/\S+/gu, '[linkki]').replace(/\b\+?358\d{6,}\b/gu, '[numero]');
const usd = (x) => `${(x || 0).toFixed(x >= 1 ? 2 : 3)} $`;
const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`);

// ------------------------------------------------------------------------------------------------ lapsiprosessi
async function childMain() {
  const { scenarioById } = await import('../eval/agent-v2-scenarios.mjs');
  const scenario = scenarioById(arg('--scenario'));
  if (!scenario) throw new Error(`Tuntematon skenaario: ${arg('--scenario')}`);
  const { runChild } = await import('../eval/agent-v2-harness.mjs');
  await runChild({ scenario, priceDb: arg('--price-db'), out: arg('--out'), capUsd: Number(arg('--cap', '0.4')) });
}

// ------------------------------------------------------------------------------------------------ lähdekopio
// Lähdekoodista otetaan ajon alussa kopio, jotta rinnakkain muokattava työpuu ei vaihdu kesken ajon. --source-ref ottaa
// server/-hakemiston Gitistä (esim. origin/main, kun v2 on yhdistetty). Arvioinnin omat tiedostot tulevat aina työpuusta.
function snapshot({ sourceRef, dataDir, priceDb }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-v2eval-src-'));
  if (sourceRef) {
    const archive = execFileSync('git', ['archive', sourceRef, 'server'], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', dir], { input: archive });
  } else fs.cpSync(path.join(ROOT, 'server'), path.join(dir, 'server'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'eval'), path.join(dir, 'eval'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const f of ['agent-v2-eval.mjs', 'whatsapp-selfplay-batch.mjs', 'whatsapp-selfplay.mjs']) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(dir, 'scripts', f));
  fs.mkdirSync(path.join(dir, 'data'));
  for (const f of ['catalog.json', 'packs.json']) if (fs.existsSync(path.join(dataDir, f))) fs.copyFileSync(path.join(dataDir, f), path.join(dir, 'data', f));
  if (!fs.existsSync(path.join(dir, 'data/catalog.json'))) throw new Error(`Katalogi puuttuu: ${path.join(dataDir, 'catalog.json')}`);
  fs.copyFileSync(priceDb, path.join(dir, 'price-cache.db'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  const hash = crypto.createHash('sha256');
  for (const f of fs.readdirSync(path.join(dir, 'server'), { recursive: true }).sort()) { const full = path.join(dir, 'server', f); if (fs.statSync(full).isFile()) hash.update(`${f}\0`).update(fs.readFileSync(full)); }
  const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
  // Mitä v2:sta on lähdekopiossa: silmukka (server/agent/index.mjs) ja palautetyökalu (save_feedback, tulee erillisenä committina).
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  const features = { agentLoop: Boolean(read('server/agent/index.mjs')), agentTools: Boolean(read('server/agent/tools.mjs')), saveFeedback: /save_feedback/u.test(read('server/agent/tools.mjs')) };
  return { dir, features, serverHash: hash.digest('hex').slice(0, 12), commit: git('rev-parse', sourceRef || 'HEAD'), sourceRef: sourceRef || null,
    dirty: git('status', '--porcelain', '--', ...(sourceRef ? ['eval', 'scripts'] : ['server', 'eval', 'scripts'])).split('\n').filter(Boolean).map((l) => l.slice(3)) };
}

function spawnChild(srcDir, id, out, cap, extraEnv) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || os.tmpdir(), ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AIMO_CATALOG: path.join(srcDir, 'data/catalog.json'), ...extraEnv };
  const argv = ['--disable-warning=ExperimentalWarning', path.join(srcDir, 'scripts/agent-v2-eval.mjs'), '--child', '--scenario', id, '--out', out, '--cap', String(cap), '--price-db', path.join(srcDir, 'price-cache.db')];
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, argv, { cwd: srcDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream(`${out}.log`, { mode: 0o600 });
    proc.stdout.pipe(log); proc.stderr.pipe(log);
    proc.on('exit', (code) => { log.end(`\n[lapsiprosessi päättyi koodilla ${code}]\n`); resolve(code); });
  });
}

// ------------------------------------------------------------------------------------------------ yhteenveto
const avg = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
// Toisto k (k > 1) omaan tiedostoonsa; ensimmäinen ajo pitää vanhan nimen, joten aiemmat ajot luetaan sellaisinaan.
export const fileOf = (id, rep = 1) => (rep > 1 ? `${id}.r${rep}.json` : `${id}.json`);
const repLabel = (r) => (r.rep > 1 ? ` (toisto ${r.rep})` : '');

/** Skenaariokohtainen kooste toistoista: läpäisyt, arvion keskiarvo ja vaihteluväli, botin hinta. */
export function perScenario(results) {
  const by = new Map();
  for (const r of results) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
  return [...by.entries()].map(([id, rows]) => {
    const scores = rows.map((r) => r.judgment?.scores?.kokonaisuus?.score).filter((x) => Number.isFinite(x) && x > 0);
    const failures = {}; for (const r of rows) for (const f of r.failures) { const k = f.replace(/[:=].*/u, ''); failures[k] = (failures[k] || 0) + 1; }
    return { id, n: rows.length, passed: rows.filter((r) => !r.failures.length).length, judgeMean: avg(scores), judgeMin: scores.length ? Math.min(...scores) : null,
      judgeMax: scores.length ? Math.max(...scores) : null, botUsd: avg(rows.map((r) => r.cost?.bot || 0)), failures };
  });
}
const cell = (x) => `${x.passed}/${x.n}${x.judgeMean != null ? ` (${x.judgeMean.toFixed(1)}${x.n > 1 && x.judgeMin !== x.judgeMax ? `, ${x.judgeMin}–${x.judgeMax}` : ''})` : ''}`;

/** Ajon kokonaisluvut taulukkoa varten. */
export function aggregate(results, checks) {
  const { stats } = checks;
  const convMetrics = results.flatMap((r) => r.metrics?.conversations || []);
  const orderRuns = results.filter((r) => r.kind !== 'greetings');
  const crit = {}; for (const r of results) for (const [k, v] of Object.entries(r.judgment?.scores || {})) if (v.score > 0) (crit[k] ||= []).push(v.score);
  const chatMs = convMetrics.flatMap((m) => m.chatMs); const e2eMs = convMetrics.flatMap((m) => m.e2eMs);
  const customerMessages = convMetrics.reduce((s, m) => s + m.customerMessages, 0); const botReplies = convMetrics.reduce((s, m) => s + m.botReplies, 0);
  return {
    scenarios: results.length, passed: results.filter((r) => !r.failures.length).length,
    judge: Object.fromEntries(Object.entries(crit).map(([k, v]) => [k, +avg(v).toFixed(2)])),
    botUsd: results.reduce((s, r) => s + (r.cost?.bot || 0), 0), customerUsd: results.reduce((s, r) => s + (r.cost?.customer || 0), 0), judgeUsd: results.reduce((s, r) => s + (r.cost?.judge || 0), 0),
    botUsdPerOrderConversation: avg(orderRuns.map((r) => r.cost?.bot || 0)),
    chatMedianMs: stats.median(chatMs), chatP90Ms: stats.pct(chatMs, 0.9), e2eMedianMs: stats.median(e2eMs), e2eP90Ms: stats.pct(e2eMs, 0.9),
    repliesPerCustomerMessage: customerMessages ? +(botReplies / customerMessages).toFixed(2) : null,
    callsPerReply: botReplies ? +(results.reduce((x, r) => x + (r.calls?.bot || 0), 0) / botReplies).toFixed(1) : null,
    charsPerReply: botReplies ? Math.round(convMetrics.reduce((x, m) => x + m.charsPerReply * m.botReplies, 0) / botReplies) : null,
    bubblesPerReply: botReplies ? +(convMetrics.reduce((x, m) => x + m.botBubbles, 0) / botReplies).toFixed(2) : null,
    runs: results.length,
    burstReplies: (() => { const b = convMetrics.flatMap((m) => m.bursts || []); return b.length ? +(b.reduce((x, y) => x + y.replies, 0) / b.length).toFixed(2) : null; })(),
    repeatedSentences: convMetrics.reduce((s, m) => s + m.repeatedSentences, 0), identicalMessages: convMetrics.reduce((s, m) => s + m.identicalMessages, 0),
    allergyAskedShare: (() => { const o = orderRuns.flatMap((r) => r.metrics?.conversations || []); return o.length ? +(o.filter((m) => m.allergyAsked).length / o.length).toFixed(2) : null; })(),
    turnsToLinkAvg: avg(orderRuns.flatMap((r) => (r.metrics?.conversations || []).map((m) => m.turnsToLink)).filter((x) => x != null)),
    linked: orderRuns.filter((r) => (r.metrics?.conversations || []).some((m) => m.linked)).length,
    autoSelectedShare: (() => { const sel = orderRuns.flatMap((r) => (r.metrics?.conversations || []).map((m) => m.selections).filter(Boolean)); const total = sel.reduce((x, y) => x + y.total, 0); return total ? +(sel.reduce((x, y) => x + y.withoutOptions, 0) / total).toFixed(2) : null; })(),
  };
}

function summarize(meta, results, totals) {
  const a = totals;
  const lines = [
    `# v2-arviointi: ${meta.label} (${meta.created})`, '',
    `Putki: ${meta.pipeline === 'v2' ? `v2, malli ${meta.model}, effort ${meta.effort}` : `vanha, DEEP_MODEL ${meta.deepModel}`}. Lähde: ${meta.sourceRef ? `${meta.sourceRef} = ` : ''}${meta.commit.slice(0, 9)}${meta.dirty.length ? ` + ${meta.dirty.length} muutettua tiedostoa (${meta.dirty.slice(0, 6).join(', ')})` : ''}, server/ ${meta.serverHash}.`,
    `Tila: eristetyt kannat, oikea katalogi, Valion viimeisimmät tunnetut hinnat (hintavälimuistin kopio), simuloitu Meta ja ostaja, ei tilauksia. Niputus ${meta.gather ? `${meta.gather.gatherMs} ms / enint. ${meta.gather.maxGatherMs} ms` : '–'}.`,
    `Simuloitu ostaja ${meta.fastModel} (fast-taso), arvioija ${meta.judge ? `${meta.judgeModel} (effort ${meta.judgeEffort})` : 'ei käytössä'}.${meta.repeat > 1 ? ` Toistot ${meta.repeat}${meta.repeatScenarios ? ` (${meta.repeatScenarios.join(', ')})` : ''}.` : ''}`,
    ...(meta.features ? [`Lähdekopiossa: v2-silmukka ${meta.features.agentLoop ? 'kyllä' : 'ei'}, v2-työkalut ${meta.features.agentTools ? 'kyllä' : 'ei'}, save_feedback ${meta.features.saveFeedback ? 'kyllä' : 'ei (E2:n palautteen kirjaus ei ole mahdollinen)'}.`] : []), '',
    `Skenaariot ${a.scenarios}, koodin tarkistukset läpi ${a.passed}/${a.scenarios}. Korilinkki ${a.linked}/${results.filter((r) => r.kind !== 'greetings').length} tilauskeskustelussa.`,
    `Arvioijan keskiarvot: ${Object.entries(a.judge).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}.`,
    `Hinta: botti ${usd(a.botUsd)} (tilauskeskustelua kohden ${usd(a.botUsdPerOrderConversation)}), simuloitu ostaja ${usd(a.customerUsd)}, arvioija ${usd(a.judgeUsd)}, yhteensä ${usd(a.botUsd + a.customerUsd + a.judgeUsd)}.`,
    `Viive: putken vastaus mediaani ${sec(a.chatMedianMs)}, p90 ${sec(a.chatP90Ms)}; viestistä ensimmäiseen kuplaan (sis. niputuksen odotuksen) mediaani ${sec(a.e2eMedianMs)}, p90 ${sec(a.e2eP90Ms)}.`,
    `Vastauksia asiakasviestiä kohden ${a.repliesPerCustomerMessage ?? '–'}, kahteen 6 s välein tulleeseen viestiin ${a.burstReplies ?? '–'} vastausta. Toistuvia virkkeitä ${a.repeatedSentences}, identtisiä viestejä ${a.identicalMessages}. Allergioista kysyttiin ${a.allergyAskedShare != null ? `${Math.round(a.allergyAskedShare * 100)} %` : '–'} tilauskeskusteluista. Asiakasviestejä korilinkkiin keskimäärin ${a.turnsToLinkAvg != null ? a.turnsToLinkAvg.toFixed(1) : '–'}. Tuotteista valittiin asiakkaan puolesta ilman vaihtoehtoja ${a.autoSelectedShare != null ? `${Math.round(a.autoSelectedShare * 100)} %` : '–'}.`, '',
    ...(results.some((r) => r.rep > 1) ? ['Toistot skenaarioittain (läpi / ajoja, arvion keskiarvo ja vaihteluväli):', '', '| skenaario | läpi | botti $ keskimäärin | virheet |', '|---|---|---|---|',
      ...perScenario(results).map((x) => `| ${x.id} | ${cell(x)} | ${usd(x.botUsd)} | ${Object.entries(x.failures).map(([k, n]) => `${k} ${n}×`).join(', ') || '–'} |`), ''] : []),
    '| skenaario | koodi | virheet | arvio | botti $ | putki mediaani | vastauksia / viesti | viestejä linkkiin |', '|---|---|---|---|---|---|---|---|',
    ...results.map((r) => { const m = r.metrics?.conversations || []; const chat = m.flatMap((x) => x.chatMs);
      return `| ${r.id}${repLabel(r)} | ${r.failures.length ? '✗' : '✓'} | ${r.failures.join(', ') || '–'} | ${r.judgment?.scores?.kokonaisuus?.score ?? '–'} | ${usd(r.cost?.bot)} | ${sec(meta.stats.median(chat))} | ${m.length === 1 ? m[0].repliesPerCustomerMessage : '–'} | ${m.length === 1 ? m[0].turnsToLink ?? '–' : '–'} |`; }),
    '', '## Arvioijan perustelut',
    ...results.flatMap((r) => (r.judgment?.scores ? [`- **${r.id}${repLabel(r)}** (${Object.entries(r.judgment.scores).map(([k, v]) => `${k} ${v.score}`).join(', ')}): ${redact(r.judgment.summary).slice(0, 500)}`,
      ...(r.judgment.problems || []).slice(0, 4).map((p) => `  - ongelma: ${redact(p).slice(0, 300)}`)] : r.judgment?.error ? [`- **${r.id}${repLabel(r)}**: arvio epäonnistui (${r.judgment.error})`] : [])),
  ];
  return lines.join('\n');
}

function transcripts(results, childOf) {
  const out = [];
  for (const r of results) {
    const res = childOf(r.id, r.rep); out.push(`## ${r.id}${repLabel(r)}: ${r.title}`, '');
    if (!res) { out.push('(ei tulosta)', ''); continue; }
    for (const c of res.conversations || []) {
      if ((res.conversations || []).length > 1) out.push(`### Keskustelu ${c.index + 1}`, '');
      for (const t of c.turns) {
        t.customer.forEach((m, j) => out.push(`**Asiakas${j ? ` (+${Math.round((m.at - t.customer[j - 1].at) / 1000)} s)` : ''}:** ${redact(m.text)}`, ''));
        t.replies.forEach((rep, k) => out.push(`**Apuri${t.replies.length > 1 ? ` ${k + 1}` : ''}** (${sec(rep.e2eMs)}):`, '', ...rep.parts.map((p) => `> ${redact(p).replace(/\n/gu, '\n> ')}`), ''));
        if (!t.replies.length) out.push('_(ei vastausta)_', '');
      }
      const sf = c.final?.storefront;
      out.push(`Päättyi: ${c.ended}. Kori: ${sf?.state === 'ready' ? `${sf.deliveryDate}; ${sf.lines.map((l) => `${l.name} ${l.qty} × ${l.unit}${l.totalKg ? ` (${l.totalKg} kg)` : ''}${l.totalL ? ` (${l.totalL} l)` : ''}`).join('; ')}` : `ei valmis (${c.final?.list?.status || 'ei luonnosta'})`}.`, '');
    }
    out.push(`Tarkistukset: ${r.failures.join(', ') || 'kaikki läpi'}${r.notes?.length ? ` (huomiot: ${r.notes.join(', ')})` : ''}.`, '');
  }
  return out.join('\n');
}

function writeReports(outDir, meta, results, checks) {
  const childOf = (id, rep) => { try { return JSON.parse(fs.readFileSync(path.join(outDir, fileOf(id, rep)), 'utf8')); } catch { return null; } };
  const totals = aggregate(results, checks);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ meta, totals, results }, null, 1), { mode: 0o600 });
  fs.writeFileSync(path.join(outDir, 'summary.md'), `${summarize({ ...meta, stats: checks.stats }, results, totals)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(outDir, 'transcripts.md'), `${transcripts(results, childOf)}\n`, { mode: 0o600 });
  return totals;
}

/** Tulosrivi skenaariolle: koodin tarkistukset ja kustannukset lapsen tuloksesta. */
function resultRow(scenario, child, inspection, judgment, judgeUsd, rep = 1) {
  return { id: scenario.id, rep, title: scenario.title, kind: scenario.expect?.greetings ? 'greetings' : scenario.kind || 'scripted', failures: inspection.failures, notes: inspection.notes, metrics: inspection.metrics,
    judgment, error: child?.error || null, ms: child?.ms || null, orders: child?.orders || 0, lastKnownServed: child?.apiStats?.lastKnownServed ?? null,
    calls: { bot: child?.cost?.bot?.calls || 0, customer: child?.cost?.customer?.calls || 0, botByModel: child?.cost?.bot?.byModel || {} },
    cost: { bot: child?.cost?.bot?.usd || 0, customer: child?.cost?.customer?.usd || 0, judge: judgeUsd } };
}

// ------------------------------------------------------------------------------------------------ pääprosessi
/** Katalogin tuotteet merkkitarkistuksen varanäytöksi (ajot, joista työkalutuloksia ei tallennettu). Vain merkilliset tuotteet. */
function catalogEvidence(dataDir, checks) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
    const any = new RegExp(checks.BRANDS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/nen$/u, '')).join('|'), 'iu');
    return raw.filter((p) => any.test(p.name) || any.test(p.brand || '')).map((p) => ({ name: p.name, brand: p.brand || '' }));
  } catch { return null; }
}
/** Tuotenimien sanasto (sanojen viisi ensimmäistä kirjainta): merkin perässä oleva sana on tuotesana vain, jos se on tässä. */
function productVocab(dataDir) {
  try {
    const vocab = new Set();
    for (const p of JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'))) for (const w of String(p.name).toLowerCase().split(/[^\p{L}]+/u)) if (w.length >= 4) vocab.add(w.slice(0, 5));
    return vocab;
  } catch { return null; }
}

async function main() {
  const checks = await import('../eval/agent-v2-checks.mjs');
  if (arg('--compare')) return compare(arg('--compare').split(','), checks);
  const { ALL_SCENARIOS } = await import('../eval/agent-v2-scenarios.mjs');
  const evidenceDir = path.resolve(arg('--data-dir', path.join(ROOT, 'data')));
  const ctx = { catalog: catalogEvidence(evidenceDir, checks), vocab: productVocab(evidenceDir) };
  if (arg('--reinspect')) { for (const d of arg('--reinspect').split(',')) await reinspect(path.resolve(d), ALL_SCENARIOS, checks, ctx); return; }
  if (arg('--rejudge')) return rejudge(arg('--rejudge').split(',').map((d) => path.resolve(d)), (arg('--rejudge-scenarios') || '').split(',').filter(Boolean), ALL_SCENARIOS, checks, Number(arg('--budget', '0.5')));
  const pick = arg('--scenarios', 'all');
  const scenarios = pick === 'all' ? ALL_SCENARIOS : pick === 'core' ? ALL_SCENARIOS.filter((s) => CORE.includes(s.id)) : pick === 'personas' ? ALL_SCENARIOS.filter((s) => s.kind === 'persona')
    : ALL_SCENARIOS.filter((s) => pick.split(',').includes(s.id));
  if (!scenarios.length) throw new Error(`Ei valittuja skenaarioita: ${pick}`);
  if (flag('--dry-run')) { for (const s of scenarios) console.log(`${s.id} ${s.now}: ${s.title}`); return; }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY puuttuu (aja: node --env-file=<repo>/.env ...). Mallikoetta ei ajettu.');
  const pipeline = arg('--pipeline', 'old');
  if (!['old', 'v2'].includes(pipeline)) throw new Error('--pipeline: old tai v2');
  const model = arg('--model', 'claude-opus-5-5'); const effort = arg('--effort', 'medium');
  const budget = Number(arg('--budget', '1.5')); const cap = Number(arg('--cap', '0.4')); const concurrency = Math.max(1, Math.min(4, Number(arg('--concurrency', '3'))));
  const judgeOn = !flag('--no-judge'); const judgeModel = arg('--judge-model', 'claude-sonnet-5-5'); const judgeEffort = arg('--judge-effort', 'medium');
  const deepModel = arg('--deep-model', 'claude-haiku-5-5');
  const dataDir = path.resolve(arg('--data-dir', path.join(ROOT, 'data')));
  const priceDb = path.resolve(arg('--price-db', process.env.AGENT_V2_EVAL_PRICE_DB || path.join(dataDir, 'agent-v2-eval/price-cache.db')));
  if (!fs.existsSync(priceDb)) throw new Error(`Hintavälimuistin kopio puuttuu: ${priceDb}`);
  const label = arg('--label', pipeline === 'v2' ? `v2-${model.replace(/^claude-/u, '')}-${effort}` : 'vanha');
  const created = new Date().toISOString();
  const outDir = path.resolve(arg('--out-dir', path.join(dataDir, 'agent-v2-eval', `${created.replace(/[:.]/gu, '-')}-${label}`)));
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const src = snapshot({ sourceRef: arg('--source-ref'), dataDir, priceDb });
  const childEnv = { DEEP_MODEL: deepModel, FAST_MODEL: 'claude-haiku-5-5', ...(pipeline === 'v2' ? { WHATSAPP_AGENT: 'v2', WHATSAPP_AGENT_MODEL: model, WHATSAPP_AGENT_EFFORT: effort } : {}) };
  const meta = { label, created, pipeline, model: pipeline === 'v2' ? model : null, effort: pipeline === 'v2' ? effort : null, deepModel, fastModel: 'claude-haiku-5-5',
    judge: judgeOn, judgeModel, judgeEffort, budget, cap, concurrency, scenarios: scenarios.map((s) => s.id), commit: src.commit, sourceRef: src.sourceRef, dirty: src.dirty, serverHash: src.serverHash, features: src.features, gather: null };
  if (pipeline === 'v2' && !src.features.agentLoop) throw new Error('Lähdekopiossa ei ole v2-silmukkaa (server/agent/index.mjs). Käytä --source-ref, kun v2 on mainissa.');
  console.log(JSON.stringify({ label, pipeline, model: meta.model, effort: meta.effort, scenarios: scenarios.length, budget, cap, outDir, commit: src.commit.slice(0, 9), serverHash: src.serverHash }));

  const { installMeter } = await import('../eval/agent-v2-meter.mjs');
  const { judge, JUDGE_SYSTEM } = await import('../eval/agent-v2-judge.mjs');
  const meter = installMeter(); meter.tag(JUDGE_SYSTEM, 'judge');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 180_000 });
  // --repeat N ajaa jokaisen skenaarion N kertaa; --repeat-scenarios rajaa toistot annettuihin skenaarioihin. Jonossa ensin kaikkien
  // ensimmäiset ajot, jotta budjetin loppuessa jokainen skenaario on ajettu vähintään kerran.
  const reps = Math.max(1, Math.min(10, Number(arg('--repeat', '1')))); const repOnly = arg('--repeat-scenarios')?.split(',') || null;
  const queue = []; for (let k = 1; k <= reps; k++) for (const s of scenarios) if (k === 1 || !repOnly || repOnly.includes(s.id)) queue.push({ scenario: s, rep: k });
  meta.repeat = reps; meta.repeatScenarios = repOnly;
  const results = []; let childUsd = 0; const running = new Set(); const skipped = [];
  const spent = () => childUsd + meter.totals((c) => c.role === 'judge').usd;
  const judgeReserve = judgeOn ? 0.08 : 0;
  const runOne = async ({ scenario, rep: k }) => {
    const out = path.join(outDir, fileOf(scenario.id, k));
    console.log(`aloitetaan ${scenario.id}${k > 1 ? ` (toisto ${k})` : ''}`);
    await spawnChild(src.dir, scenario.id, out, cap, childEnv);
    let child = null; try { child = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { child = { id: scenario.id, error: 'Lapsiprosessi päättyi ilman tulosta (katso .log)', conversations: [] }; }
    meta.gather ||= child.gather || null;
    childUsd += (child.cost?.bot?.usd || 0) + (child.cost?.customer?.usd || 0);
    const inspection = checks.inspectScenario(scenario, child, ctx);
    let judgment = null; const before = meter.totals((c) => c.role === 'judge').usd;
    if (judgeOn && child.conversations?.some((c) => c.turns.length)) {
      try { judgment = await judge({ client, model: judgeModel, effort: judgeEffort, scenario, result: child }); } catch (err) { judgment = { error: String(err?.message || err).slice(0, 200) }; }
      await meter.settle();
    }
    const row = resultRow(scenario, child, inspection, judgment, meter.totals((c) => c.role === 'judge').usd - before, k);
    // v2-ajossa botin kutsujen pitää mennä pyydetylle mallille: muuten ajo mittaisi vanhaa putkea v2:n nimellä.
    if (pipeline === 'v2' && child.conversations?.length && !Object.keys(row.calls.botByModel).includes(model)) row.failures.push('v2_not_active');
    results.push(row);
    console.log(`  ${scenario.id}${k > 1 ? ` (toisto ${k})` : ''}: ${row.failures.length ? row.failures.join(', ') : 'ok'} | arvio ${judgment?.scores?.kokonaisuus?.score ?? '-'} | botti ${usd(row.cost.bot)} | yhteensä ${usd(spent())}`);
  };
  await new Promise((resolve) => {
    const pump = () => {
      while (queue.length && running.size < concurrency) {
        if (spent() + (running.size + 1) * (cap + judgeReserve) > budget) { if (!running.size) { skipped.push(...queue.splice(0).map((j) => `${j.scenario.id}${j.rep > 1 ? `.r${j.rep}` : ''}`)); } break; }
        const job = queue.shift(); const p = runOne(job).catch((err) => console.error(`${job.scenario.id}: ${err?.stack || err}`)).finally(() => { running.delete(p); pump(); });
        running.add(p);
      }
      if (!queue.length && !running.size) resolve();
    };
    pump();
  });
  meta.skipped = skipped; meta.finished = new Date().toISOString();
  results.sort((a, b) => scenarios.findIndex((s) => s.id === a.id) - scenarios.findIndex((s) => s.id === b.id) || a.rep - b.rep);
  const totals = writeReports(outDir, meta, results, checks);
  console.log(`\nvalmis: koodi läpi ${totals.passed}/${totals.scenarios}, botti ${usd(totals.botUsd)}, yhteensä ${usd(totals.botUsd + totals.customerUsd + totals.judgeUsd)}${skipped.length ? `, ohitettu budjetin vuoksi: ${skipped.join(', ')}` : ''}\nraportti: ${outDir}/summary.md`);
  fs.rmSync(src.dir, { recursive: true, force: true });
}

async function reinspect(dir, all, checks, ctx = {}) {
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  for (const r of report.results) {
    const scenario = all.find((s) => s.id === r.id); if (!scenario) continue;
    let child; try { child = JSON.parse(fs.readFileSync(path.join(dir, fileOf(r.id, r.rep || 1)), 'utf8')); } catch { continue; }
    const inspection = checks.inspectScenario(scenario, child, ctx);
    Object.assign(r, { failures: [...inspection.failures, ...(r.failures || []).filter((f) => f === 'v2_not_active')], notes: inspection.notes, metrics: inspection.metrics });
  }
  report.meta.reinspected = new Date().toISOString();
  const totals = writeReports(dir, report.meta, report.results, checks);
  console.log(`tarkistettu uudelleen: koodi läpi ${totals.passed}/${totals.scenarios} (${dir})`);
}

/**
 * Arvioi valitut skenaariot uudelleen nykyisellä arvioijalla (esim. kun arvioijan syöte korjattiin). Vanha arvio jää kenttään
 * judgmentPrevious, ja kustannus lisätään rivin arvioijakuluun. Ei botti- eikä ostajakutsuja. Budjetti rajaa arvioijan kulut.
 */
async function rejudge(dirs, ids, all, checks, budget) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY puuttuu.');
  const { installMeter } = await import('../eval/agent-v2-meter.mjs');
  const { judge, JUDGE_SYSTEM, JUDGE_VERSION } = await import('../eval/agent-v2-judge.mjs');
  const meter = installMeter(); meter.tag(JUDGE_SYSTEM, 'judge');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 180_000 });
  for (const dir of dirs) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
    const rows = report.results.filter((r) => (!ids.length || ids.includes(r.id)) && r.judgment?.version !== JUDGE_VERSION);
    await Promise.all(rows.map(async (r) => {
      const scenario = all.find((s) => s.id === r.id); if (!scenario) return;
      if (meter.totals().usd > budget) { console.log(`  ${r.id}: ohitettu, uudelleenarvioinnin budjetti täynnä`); return; }
      let child; try { child = JSON.parse(fs.readFileSync(path.join(dir, fileOf(r.id, r.rep || 1)), 'utf8')); } catch { return; }
      const before = meter.totals().usd;
      try {
        const next = await judge({ client, model: report.meta.judgeModel || 'claude-sonnet-5-5', effort: report.meta.judgeEffort || 'medium', scenario, result: child });
        await meter.settle();
        Object.assign(r, { judgmentPrevious: r.judgment, judgment: next });
        r.cost = { ...r.cost, judge: (r.cost?.judge || 0) + meter.totals().usd - before };
        console.log(`  ${path.basename(dir)} ${r.id}${repLabel(r)}: ${r.judgmentPrevious?.scores?.kokonaisuus?.score ?? '–'} → ${next.scores.kokonaisuus.score}`);
      } catch (err) { console.log(`  ${r.id}: uudelleenarvio epäonnistui (${String(err?.message || err).slice(0, 120)})`); }
    }));
    report.meta.rejudged = { at: new Date().toISOString(), version: JUDGE_VERSION, scenarios: ids };
    writeReports(dir, report.meta, report.results, checks);
  }
  console.log(`uudelleenarviointi valmis, kulut ${usd(meter.totals().usd)}`);
}

/** Vertailutaulukko usean ajon välillä (raporttia varten). */
function compare(dirs, checks) {
  // Taulukko lasketaan vain kaikille ajoille yhteisistä skenaarioista, jotta kokoonpanot ovat vertailukelpoisia
  // (esim. Opus ajetaan budjetin vuoksi vain ydinskenaarioilla). Skenaariomatriisi näyttää kaikki.
  // Kokoonpano voi koostua useasta ajohakemistosta: "a+b" yhdistää esim. ydinskenaariot ja niiden lisätoistot samaksi riviksi.
  const loaded = dirs.map((group) => group.split('+').map((d) => JSON.parse(fs.readFileSync(path.join(path.resolve(d), 'results.json'), 'utf8'))))
    .map((parts) => ({ meta: parts[0].meta, results: parts.flatMap((p) => p.results.map((x) => ({ rep: 1, ...x }))) }));
  const common = loaded.map((r) => new Set(r.results.map((x) => x.id))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  const runs = loaded.map((r) => ({ ...r, all: r.results, totals: aggregate(r.results.filter((x) => common.has(x.id)), checks) }));
  const name = (r) => (r.meta.pipeline === 'v2' ? `v2 ${r.meta.model.replace(/^claude-/u, '')} (${r.meta.effort})`
    : `vanha ${r.meta.deepModel.replace(/^claude-/u, '')} (${r.meta.commit.slice(0, 7)}, niputus ${r.meta.gather ? r.meta.gather.gatherMs / 1000 : '?'} s)`);
  const j = (t, k) => (t.judge[k] != null ? t.judge[k].toFixed(1) : '–');
  const lines = [
    '| kokoonpano | ajoja | koodi läpi | kokonaisuus | ihmismäisyys | tehokkuus | vaihtelu | rehellisyys | virheiden korjaus | botti $ / tilauskeskustelu |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => { const t = r.totals; return `| ${name(r)} | ${t.runs} | ${t.passed}/${t.scenarios} | ${j(t, 'kokonaisuus')} | ${j(t, 'ihmismaisyys')} | ${j(t, 'tehokkuus')} | ${j(t, 'vaihtelu')} | ${j(t, 'rehellisyys')} | ${j(t, 'virheiden_korjaus')} | ${usd(t.botUsdPerOrderConversation)} |`; }),
    '',
    '| kokoonpano | putken viive mediaani | p90 | mallikutsuja / vastaus | viestistä vastaukseen mediaani | p90 | merkkejä / vastaus | kuplia / vastaus | vastauksia / 2 nopeaa viestiä | asiakasviestejä linkkiin | allergiat kysytty | valittu asiakkaan puolesta |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => { const t = r.totals; return `| ${name(r)} | ${sec(t.chatMedianMs)} | ${sec(t.chatP90Ms)} | ${t.callsPerReply ?? '–'} | ${sec(t.e2eMedianMs)} | ${sec(t.e2eP90Ms)} | ${t.charsPerReply ?? '–'} | ${t.bubblesPerReply ?? '–'} | ${t.burstReplies ?? '–'} | ${t.turnsToLinkAvg != null ? t.turnsToLinkAvg.toFixed(1) : '–'} | ${pct(t.allergyAskedShare)} | ${pct(t.autoSelectedShare)} |`; }),
    '', `Taulukon luvut ${common.size} yhteisestä skenaariosta (${[...common].join(', ')}).`,
    '', 'Solu: koodin tarkistukset läpi / ajoja (arvioijan kokonaisuus keskimäärin, vaihteluväli).',
    '', `| skenaario | ${runs.map(name).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`,
    ...[...new Set(runs.flatMap((r) => r.all.map((x) => x.id)))].map((id) => `| ${id} | ${runs.map((r) => { const x = perScenario(r.all).find((y) => y.id === id); return x ? `${cell(x)}${x.passed < x.n ? ` ✗ ${Object.keys(x.failures).slice(0, 3).join(', ')}` : ''}` : '–'; }).join(' | ')} |`),
  ];
  const text = lines.join('\n');
  console.log(text);
  return text;
}

const real = (file) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };
if (process.argv[1] && real(process.argv[1]) === real(SELF)) {
  try { if (flag('--child')) await childMain(); else await main(); }
  catch (err) { console.error(err?.stack || err); process.exitCode = 1; }
}
