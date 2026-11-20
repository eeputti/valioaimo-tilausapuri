import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel } from '../server/whatsapp/channel.mjs';

// Oikea HTTP-palvelin ja kanavan oma käsittelijä (start). Meta ja malli ovat testin omia funktioita.
const CUSTOMER = '358401234567';
const META = { phoneId: '123', verifyToken: 'verify', appSecret: 'secret', supportContact: 'https://example.com/support' };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Odottaa, kunnes ehto täyttyy, enintään noin kaksi sekuntia.
async function eventually(check, what) {
  for (let i = 0; i < 2000; i += 1) {
    if (check()) return;
    await nextTurn();
  }
  throw new Error(`${what} ei toteutunut`);
}

function inboundText(id, body) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: META.phoneId },
      messages: [{ id, from: CUSTOMER, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body } }],
    } }] }],
  });
}

test('webhook vastaa heti, vaikka malli on vielä kesken, ja taustakäsittelijä lähettää vastauksen perille', { timeout: 8000 }, async (t) => {
  // Tiedostokanta kuten Macin palvelussa: webhook ja taustakäsittelijä käyttävät samaa tiedostoa.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-wa-http-'));
  const store = openWhatsAppStore(path.join(dir, 'whatsapp.db'));
  const { code } = store.invite(CUSTOMER, 'Ravintola A', 'Anna');
  const typed = [];
  const modelRunning = deferred(); const modelAnswer = deferred(); const answered = deferred();
  const channel = createWhatsAppChannel({
    settings: META, store,
    typing: async (id) => { typed.push(id); },
    chat: async () => { modelRunning.resolve(typed.slice()); return modelAnswer.promise; },
    send: async (to, text) => { if (!/yhdistetty/.test(text)) answered.resolve({ to, text }); return 'out'; },
  });
  // Kanava vastaa vain omasta polustaan; muut pyynnöt saavat palvelimelta 404.
  const server = http.createServer(async (req, res) => {
    if (!(await channel.handle(req, res))) { res.writeHead(404); res.end(); }
  });
  t.after(async () => {
    modelAnswer.resolve({ text: 'peruttu' });
    await channel.stop();
    server.close(); await once(server, 'close');
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  channel.start();
  const endpoint = `http://127.0.0.1:${server.address().port}/webhooks/whatsapp`;
  const deliver = (body) => fetch(endpoint, {
    method: 'POST', body,
    headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', META.appSecret).update(body).digest('hex')}` },
  });

  const verified = await fetch(`${endpoint}?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123`);
  assert.equal(verified.status, 200);
  assert.equal(await verified.text(), '123');
  assert.equal((await deliver('x'.repeat(256_001))).status, 413);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/muu`)).status, 404);

  // Yhdistäminen käsitellään ensin loppuun, jotta tilausviesti kirjataan jo liitetylle numerolle.
  assert.equal((await deliver(inboundText('pair', `YHDISTA ${code}`))).status, 200);
  await eventually(() => store.member(CUSTOMER), 'yhdistäminen');

  const ack = await deliver(inboundText('ask', '60 munaa maanantaiksi'));
  assert.equal(ack.status, 200);
  assert.deepEqual(await ack.json(), { received: true });
  const typingAtModelStart = await modelRunning.promise;
  assert.equal(typingAtModelStart.at(-1), 'ask', 'ilmaisin lähti ennen mallikutsua');
  assert.equal(store.db.prepare("SELECT state FROM inbox WHERE id='ask'").get().state, 'processing');

  modelAnswer.resolve({ text: '60 munaa: toimitus maanantaina.' });
  const { to, text } = await answered.promise;
  assert.equal(to, CUSTOMER);
  assert.match(text, /60 munaa/);
});
