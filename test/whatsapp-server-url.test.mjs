// A request target that the URL parser rejects must get an error response, not stop the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function serve(t, entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-server-url-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, WHATSAPP_PORT: '0', PORT: '0', WHATSAPP_ENABLED: 'false', AIMO_EMBEDDED_STOREFRONT: '',
      WHATSAPP_ORDERING_ENABLED: 'true', VALIO_API_KEY: '', ANTHROPIC_API_KEY: '',
      AIMO_DB: path.join(dir, 'prices.db'), GATEWAY_DB: path.join(dir, 'gateway.db'),
      WHATSAPP_DB: path.join(dir, 'whatsapp.db'), WHATSAPP_DRAFT_DB: path.join(dir, 'drafts.db'), WHATSAPP_QUOTE_DB: path.join(dir, 'quotes.db'),
      WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_ACCESS_TOKEN: 'test', WHATSAPP_APP_SECRET: 'test', WHATSAPP_VERIFY_TOKEN: 'test',
      WHATSAPP_SUPPORT_CONTACT: 'Testin ylläpito', WHATSAPP_API_VERSION: 'v25.0', WHATSAPP_DEMO_PHONE: '', WHATSAPP_PUBLIC_URL: '',
      DEMO_NOW: '2026-11-14T10:00:00+02:00',
      GATEWAY_PRIVATE_KEY_PEM: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode == null) { child.kill(); await once(child, 'exit'); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let log = '';
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${log}`)), 15000);
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exit ${code}: ${log}`)); });
    const read = (chunk) => {
      log += chunk;
      const match = log.match(/→ http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
  });
  return { child, port };
}

// Raw socket: fetch() would normalise the target before sending it.
function rawStatus(port, target, { method = 'GET', headers = '', body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: localhost\r\n${headers}Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`));
    let data = '';
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(Number(data.match(/^HTTP\/1\.1 (\d{3})/)?.[1])));
    socket.on('error', reject);
  });
}

for (const entry of ['server/whatsapp-server.mjs', 'server/index.mjs']) {
  test(`${entry} answers a malformed request target with 400 and keeps serving`, { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, async (t) => {
    const { child, port } = await serve(t, entry);
    const malformed = `//${'host'}:not-a-port/path`;
    assert.throws(() => new URL(malformed, 'http://localhost'));
    assert.equal(await rawStatus(port, malformed), 400);
    assert.equal(await rawStatus(port, malformed), 400);
    // A handler that throws on a bad header (here the local browser demo's Origin check) ends in an error response too.
    const badOrigin = await rawStatus(port, '/demo/chat', { method: 'POST', headers: 'Origin: not a url\r\nContent-Type: application/json\r\n', body: '{"text":"moi"}' });
    assert.ok(badOrigin >= 400 && badOrigin < 600, `status ${badOrigin}`);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(child.exitCode, null);
  });
}
