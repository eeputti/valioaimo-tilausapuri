// Selaimen varademo: sama tilauskeskustelu kuin WhatsAppissa omalle testiasiakkaalle, vain tämän koneen omasta selaimesta.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { WEB_DEMO_PHONE, createWebDemo, isLocal } from '../server/whatsapp/web-demo.mjs';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const tunnelled = { 'x-forwarded-for': '203.0.113.9' };

// Demo omalla muistikannallaan ja paikallisella palvelimella. chat korvaa tilaussillan.
async function startDemo(t, chat) {
  const store = openWhatsAppStore(':memory:');
  const demo = createWebDemo({ store, chat });
  const server = http.createServer(async (req, res) => {
    const handled = await demo.handle(req, res, new URL(req.url, 'http://localhost'));
    if (!handled) { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); });
    store.close();
  });
  const root = `http://127.0.0.1:${server.address().port}/demo`;
  const say = (text, headers = {}) => fetch(`${root}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text }),
  });
  return { store, root, say };
}

test('selaindemo ajaa tilauskeskustelua omalle testiasiakkaalle vuoro kerrallaan', async (t) => {
  const turns = [];
  let running = 0;
  let peak = 0;
  const { store, root, say } = await startDemo(t, async ({ member, messageId, messages }) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    running -= 1;
    const text = messages.at(-1).content;
    turns.push({ phone: member.phone, binding: member.binding, messageId, text });
    return { text: `*Luonnos* ${text}`, status: 'collecting' };
  });

  const page = await fetch(root);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Valio Aimo Tilausapuri/);

  const responses = await Promise.all([say('20 l maitoa'), say('laktoositon')]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const firstReply = await responses[0].json();
  assert.equal(firstReply.text, '*Luonnos* 20 l maitoa');
  assert.equal(firstReply.status, 'collecting');
  assert.equal(peak, 1, 'kaksi samanaikaista viestiä käsitellään peräkkäin');

  assert.equal(turns.length, 2);
  const demoBinding = store.member(WEB_DEMO_PHONE).binding;
  for (const turn of turns) {
    assert.equal(turn.phone, WEB_DEMO_PHONE);
    assert.equal(turn.binding, demoBinding);
    assert.match(turn.messageId, /^web-/);
  }
  assert.notEqual(turns[0].messageId, turns[1].messageId, 'jokainen viesti saa oman tunnisteen');

  const logo = await fetch(`${root}/logo.png`);
  assert.deepEqual([logo.status, logo.headers.get('content-type')], [200, 'image/png']);
  const head = Array.from(new Uint8Array(await logo.arrayBuffer()).subarray(0, PNG_MAGIC.length));
  assert.deepEqual(head, PNG_MAGIC);
  assert.equal((await fetch(`${root}/logo.png`, { headers: tunnelled })).status, 403, 'logo noudattaa samaa paikallisuusrajaa');

  assert.equal((await say('')).status, 400);
  assert.equal((await say('x'.repeat(4001))).status, 400);
});

test('selaindemo torjuu tunnelin, toisen sivuston ja lomakepostin, eikä virhe väitä tilauksesta mitään', async (t) => {
  let chatCalls = 0;
  const { root, say } = await startDemo(t, async () => {
    chatCalls += 1;
    throw new Error('palvelu alhaalla');
  });

  for (const headers of [{ 'cf-connecting-ip': '203.0.113.9' }, tunnelled, { origin: 'https://example.com' }]) {
    assert.equal((await say('maitoa', headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal((await fetch(root, { headers: { 'cf-ray': 'abc' } })).status, 403);
  const formPost = await fetch(`${root}/chat`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"text":"maitoa"}' });
  assert.equal(formPost.status, 403);
  assert.equal(chatCalls, 0, 'torjuttu pyyntö ei koskaan päädy keskusteluun');

  const failed = await say('maitoa');
  assert.equal(failed.status, 502);
  const { error } = await failed.json();
  assert.equal(/tilau/i.test(error), false, 'virheviesti ei puhu tilauksesta');
});

test('isLocal hyväksyy vain silmukkaosoitteen ja paikallisen isäntänimen', () => {
  const request = (remoteAddress, host) => ({ socket: { remoteAddress }, headers: { host } });
  assert.equal(isLocal(request('127.0.0.1', 'localhost:4749')), true);
  assert.equal(isLocal(request('192.168.1.20', 'localhost:4749')), false, 'lähiverkon kone ei ole paikallinen');
  assert.equal(isLocal(request('127.0.0.1', 'tournaments.trycloudflare.com')), false, 'tunnelin isäntänimi ei ole paikallinen');
});
