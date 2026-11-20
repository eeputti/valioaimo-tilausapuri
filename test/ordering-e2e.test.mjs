// Päästä päähän (TYONJAKO.md, henkilö 4): allekirjoitettu Meta-webhook → kanava → testiasiakas → tilauskeskustelu
// → tuotetyökalut → gatewayn demotilaus. Oikeat moduulit, simuloitu Valio-rajapinta, säännöt ilman kielimallia,
// omat väliaikaiset kannat. Ei verkkoa: Metalle lähtevä vastaus kerätään muistiin.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-ordering-e2e-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const exists = (file) => fs.existsSync(new URL(file, import.meta.url));
const skip = (!exists('../data/catalog.json') && 'data/catalog.json puuttuu')
  || (!exists('../server/whatsapp/ordering.mjs') && 'tilauskeskustelua ei ole vielä kytketty kanavaan');

const PHONE = '358401234567'; const STRANGER = '358409876543';
const settings = { phoneId: '12345', verifyToken: 'verify', appSecret: 'secret', supportContact: 'Testin ylläpito', orderingDemo: true };

test('WhatsApp-viestistä demotilaukseen: tarkistuslista, valinta, muutos, vahvistus ja yksi tilaus', { skip, timeout: 60_000 }, async (t) => {
  const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
  const { createWhatsAppChannel } = await import('../server/whatsapp/channel.mjs');
  const { createDemoOrderingChat } = await import('../server/whatsapp/ordering.mjs');
  const { orders } = await import('../server/gateway/store.mjs');

  const store = openWhatsAppStore(path.join(dir, 'whatsapp.db'));
  const bridge = createDemoOrderingChat({ store, phoneId: settings.phoneId, draftDb: path.join(dir, 'drafts.db'), quoteDb: path.join(dir, 'quotes.db') });
  const sent = [];
  const channel = createWhatsAppChannel({ settings, store, chat: bridge.chat, send: async (to, text, replyTo) => { sent.push({ to, text, replyTo }); return `out-${sent.length}`; } });
  const server = http.createServer((req, res) => channel.handle(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await channel.stop(); await new Promise((r) => server.close(r)); await bridge.close(); store.close(); });
  const url = `http://127.0.0.1:${server.address().port}/webhooks/whatsapp`;

  // Sama reitti kuin Metalta: allekirjoitettu POST, kuittaus heti, käsittely jonosta.
  async function deliver(id, text, phone = PHONE) {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: settings.phoneId }, messages: [{ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
    const res = await fetch(url, { method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', settings.appSecret).update(body).digest('hex')}` } });
    assert.equal(res.status, 200);
  }
  async function say(id, text, phone = PHONE) {
    const before = sent.length;
    await deliver(id, text, phone);
    while (await channel.processNext());
    assert.equal(sent.length, before + 1, `yksi vastaus viestiin "${text}"`);
    assert.deepEqual([sent.at(-1).to, sent.at(-1).replyTo], [phone, id]);
    // ORDERING_E2E_PRINT=1 tulostaa keskustelun demon harjoittelua varten.
    if (process.env.ORDERING_E2E_PRINT) console.log(`\n> ${text.replace(/^(YHDISTA) .+/i, '$1 <koodi>')}\n${sent.at(-1).text}`);
    return sent.at(-1).text;
  }

  // Tuntematon numero ei saa tuotteita, hintoja eikä luonnosta.
  const stranger = await say('s1', '20 l maitoa maanantaiksi', STRANGER);
  assert.match(stranger, /ei ole yhdistetty/);
  assert.doesNotMatch(stranger, /€|Luonnoksessa/);

  const { code } = store.invite(PHONE, 'Testikeittiö (demo)', 'Anna');
  assert.match(await say('m1', `YHDISTA ${code}`), /yhdistetty: Anna, Testikeittiö \(demo\)/);
  const buyerId = `whatsapp-demo-${store.member(PHONE).binding}`;

  // Päivä ja määrät annettiin jo: vain todellisten vaihtoehtojen relevantti tarkennus.
  const checklist = await say('m2', '20 l maitoa ja 5 l kermaa maanantaiksi');
  assert.match(checklist, /laktoositonta vai käykö tavallinen/);
  assert.doesNotMatch(checklist, /Mille päivälle|Kuinka paljon/);
  assert.doesNotMatch(checklist, /€/); // ei tuotteita ennen tarkistuslistaa

  const options = await say('m3', 'laktoositon');
  assert.match(options, /Toimitus: ma 16\.11\./);
  assert.match(options, /Maito 20 l \(laktoositon\)/);
  assert.match(options, /\*Maito 20 l \(laktoositon\):\*\n1\) [^\n]+€/);
  assert.match(options, /Sen jälkeen valitaan kerma\./);
  assert.doesNotMatch(options, /\*Kerma 5 l:\*/); // yksi tuoterivi kerrallaan
  assert.equal(orders.list(buyerId).length, 0);

  assert.match(await say('m4a', '1'), /\*Kerma 5 l:\*\n1\) [^\n]+€/);
  const summary = await say('m4', '1');
  assert.match(summary, /\*Tilausluonnos\*\nToimitus: ma 16\.11\./);
  assert.match(summary, /laktoositon/i); // rivikohtainen vaatimus säilyy valitussa tuotteessa
  assert.match(summary, /Vahvista vastaamalla \*TILAA\*/);

  // Määrän muutos tuottaa uuden yhteenvedon, eikä pelkkä "joo" ole tilauslupa.
  const changed = await say('m5', 'maitoa 30 litraa');
  assert.match(changed, /yhteensä 30 l/);
  assert.match(changed, /laktoositon/i);
  assert.match(await say('m6', 'joo'), /Vahvista tilaus vastaamalla \*TILAA\*/);
  assert.equal(orders.list(buyerId).length, 0);

  // Meta voi toimittaa saman webhookin uudelleen: ei toista käsittelyä eikä toista vastausta.
  await deliver('m6', 'joo');
  assert.equal(await channel.processNext(), false);

  const done = await say('m7', 'TILAA');
  assert.match(done, /Tilaus AGW-\S+ (on tallennettu|odottaa yrityksesi hyväksyjän kuittausta)/);
  assert.match(done, /oikeaa Valio-tilausta ei lähetetty/);
  await deliver('m7', 'TILAA');
  assert.equal(await channel.processNext(), false);
  assert.match(await say('m8', 'tilaa'), /on jo tallennettu\. Uutta tilausta ei tehty/);

  const saved = orders.list(buyerId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].lines.length, 2);
  assert.match(done, new RegExp(saved[0].id));
});

test('selaindemo: sama ketju HTTP:n yli oikeilla moduuleilla tuottaa yhden demotilauksen omalle testiasiakkaalle', { skip, timeout: 60_000 }, async (t) => {
  const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
  const { createDemoOrderingChat } = await import('../server/whatsapp/ordering.mjs');
  const { createWebDemo, WEB_DEMO_PHONE } = await import('../server/whatsapp/web-demo.mjs');
  const { orders } = await import('../server/gateway/store.mjs');

  const store = openWhatsAppStore(path.join(dir, 'whatsapp-web.db'));
  const bridge = createDemoOrderingChat({ store, phoneId: settings.phoneId, draftDb: path.join(dir, 'web-drafts.db'), quoteDb: path.join(dir, 'web-quotes.db') });
  const demo = createWebDemo({ store, chat: bridge.chat });
  const server = http.createServer(async (req, res) => { if (!(await demo.handle(req, res, new URL(req.url, 'http://localhost')))) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((r) => server.close(r)); await bridge.close(); store.close(); });
  const say = async (text) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/demo/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    assert.equal(res.status, 200, text);
    return res.json();
  };

  assert.match((await say('20 l maitoa ja 5 l kermaa maanantaiksi')).text, /laktoositonta vai käykö tavallinen/);
  const options = await say('laktoositon');
  assert.equal(options.status, 'choosing');
  assert.match(options.text, /\*Maito 20 l \(laktoositon\):\*\n1\) [^\n]+€/);
  assert.equal((await say('1')).status, 'choosing');
  assert.equal((await say('1')).status, 'ready');
  const done = await say('TILAA');
  assert.match(done.text, /Tilaus AGW-\S+ (on tallennettu|odottaa yrityksesi hyväksyjän kuittausta)/);
  assert.match((await say('tilaa')).text, /on jo tallennettu\. Uutta tilausta ei tehty/);
  const saved = orders.list(`whatsapp-demo-${store.member(WEB_DEMO_PHONE).binding}`);
  assert.equal(saved.length, 1);
  assert.match(done.text, new RegExp(saved[0].id));
});
