// Pilviversio (server/cloud.mjs, api/index.mjs) oikealla WhatsApp-runtimella ja Turso-yhteydellä (libsql file:).
// Allekirjoitettu webhook kuitataan heti, viesti käsitellään vastauksen jälkeen, sisäiset reitit pysyvät piilossa
// ja ajastettu tick vaatii salaisuuden. Ei malli-, Valio- eikä Meta-kutsuja (Meta kirjataan paikallisesti).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = process.env.AIMO_CATALOG || path.join(ROOT, 'data', 'catalog.json');
const PHONE = '358401234567';
const SECRET = 'app-secret-for-tests';
const TICK = 't'.repeat(40);

async function start(dir) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const db = (name) => `file:${path.join(dir, name)}`;
  const env = {
    PATH: process.env.PATH, HOME: dir, NODE_NO_WARNINGS: '1',
    WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_ACCESS_TOKEN: 'test-access', WHATSAPP_APP_SECRET: SECRET,
    WHATSAPP_VERIFY_TOKEN: 'verify-token', WHATSAPP_SUPPORT_CONTACT: 'tuki@example.test', WHATSAPP_API_VERSION: 'v23.0',
    WHATSAPP_ORDERING_ENABLED: 'true', WHATSAPP_DEMO_PHONE: `+${PHONE}`, WHATSAPP_PUBLIC_URL: 'https://aimo.example.test',
    WHATSAPP_DB: db('whatsapp.db'), WHATSAPP_DRAFT_DB: db('drafts.db'), WHATSAPP_QUOTE_DB: db('quotes.db'),
    GATEWAY_DB: db('gateway.db'), AIMO_DB: db('kitchen.db'), AIMO_LEARNED: path.join(dir, 'learned.json'), AIMO_CATALOG: CATALOG,
    GATEWAY_PRIVATE_KEY_PEM: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'),
    DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_ANCHOR: new Date().toISOString(), TICK_SECRET: TICK,
    ANTHROPIC_API_KEY: '', VALIO_API_KEY: '', WHATSAPP_LINK_BUTTONS: 'false',
  };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'test/helpers/cloud-child.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (d) => { errors += d; });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { const m = /READY (\d+)/.exec(String(d)); if (m) resolve(Number(m[1])); });
    child.on('exit', (code) => reject(new Error(`Lapsiprosessi pysähtyi (${code}): ${errors}`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill('SIGTERM') };
}

const webhook = (text, id) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: '12345' },
  messages: [{ from: PHONE, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

test('pilven käsittelijä: webhook, jono, vastaus, sisäiset reitit ja ajastettu tick', { skip: !fs.existsSync(CATALOG) && 'katalogi puuttuu' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-cloud-'));
  const app = await start(dir);
  t.after(() => { app.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const health = await (await fetch(`${app.base}/healthz`)).json();
  assert.deepEqual(health, { ok: true, channel: 'whatsapp', mode: 'ordering-demo', host: 'cloud' });
  // vercel.json ohjaa polun ?__path=-parametrina; api/index.mjs palauttaa sen.
  assert.equal((await (await fetch(`${app.base}/api/index?__path=healthz`)).json()).host, 'cloud');
  for (const route of ['/demo', '/mcp', '/v1/orders', '/openapi.json', '/approve.html', '/api/assistant/whatsapp-list'])
    assert.equal((await fetch(`${app.base}${route}`)).status, 404, route);
  const verify = await fetch(`${app.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc`);
  assert.equal(await verify.text(), 'abc');

  const raw = webhook('Moi! Tarvitsisin 20 litraa maitoa', 'wamid.in.1');
  assert.equal((await fetch(`${app.base}/webhooks/whatsapp`, { method: 'POST', body: raw, headers: { 'x-hub-signature-256': sign('x') } })).status, 403);
  const accepted = await fetch(`${app.base}/webhooks/whatsapp`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) } });
  assert.equal(accepted.status, 200);
  const { sent } = await (await fetch(`${app.base}/__test/settle`)).json();
  const texts = sent.filter((s) => s.body?.type === 'text' && s.body.to === PHONE).map((s) => s.body.text.body);
  assert.ok(texts.length >= 1, 'vastaus lähetettiin');
  assert.doesNotMatch(texts.join('\n'), /ei ole yhdistetty|ei nyt onnistunut/);
  // Päivä kysytään ensin: viesti kulki oikean tilauskeskustelun läpi.
  assert.match(texts.join('\n'), /päivä/i);

  // Sama Metan uusinta ei käynnistä toista vastausta.
  await fetch(`${app.base}/webhooks/whatsapp`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) } });
  const again = await (await fetch(`${app.base}/__test/settle`)).json();
  assert.equal(again.sent.filter((s) => s.body?.type === 'text').length, sent.filter((s) => s.body?.type === 'text').length);

  assert.equal((await fetch(`${app.base}/internal/tick`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${app.base}/internal/tick`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 404);
  const tick = await fetch(`${app.base}/internal/tick`, { method: 'POST', headers: { authorization: `Bearer ${TICK}` } });
  assert.equal(tick.status, 200);
  const result = await tick.json();
  assert.equal(result.recovered, 0);
  assert.equal(result.processed, 0);
});
