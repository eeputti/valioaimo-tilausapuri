// "Sama kuin viime kerralla": gatewayn viimeisin vahvistettu tilaus samalle ostajalle uudeksi luonnokseksi.
// Oikeat moduulit (kanava, testiasiakas, tilausmoottori, tuotetyökalut, gateway), säännöt ilman kielimallia,
// simuloidut hinnat, omat väliaikaiset kannat. Ei verkkoa eikä Meta-lähetyksiä.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-reorder-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { lastConfirmedOrder } = await import('../server/order-conversation/index.mjs');

test('viimeisin vahvistettu tilaus luonnosriveiksi: odottavat ja hylätyt ohitetaan, sama tuote yhdistetään, päivää ei kopioida', () => {
  const orders = [
    { orderId: 'AGW-3', status: 'pending_approval', lines: [{ productId: '9', name: 'Kerma', quantity: 1 }] },
    { orderId: 'AGW-2', status: 'rejected', lines: [{ productId: '8', name: 'Juusto', quantity: 1 }] },
    { orderId: 'AGW-1', status: 'confirmed', deliveryDate: '2026-11-16', lines: [
      { productId: 464306, name: 'Valio kevytmaito 1 l laktoositon', quantity: 12 }, { productId: '464306', name: 'Valio kevytmaito 1 l laktoositon', quantity: 8 },
      { productId: '6408432', name: 'Valio voi 500 g', quantity: 10 }, { productId: '', name: 'rikki', quantity: 1 }, { productId: '7', name: 'nolla', quantity: 0 }] },
  ];
  const last = lastConfirmedOrder(orders, (name) => (/kevytmaito/.test(name) ? { productTerm: 'kevytmaito', claims: ['FREE_FROM_LACTOSE'] } : {}));
  assert.equal(last.orderId, 'AGW-1');
  assert.equal(last.deliveryDate, undefined);
  assert.deepEqual(last.lines.map((l) => [l.productTerm, l.selectedProductId, l.quantity, l.claims]), [
    ['kevytmaito', '464306', { value: 20, unit: 'PCS', basis: 'sales' }, ['FREE_FROM_LACTOSE']],
    ['Valio voi 500 g', '6408432', { value: 10, unit: 'PCS', basis: 'sales' }, []]]);
  assert.equal(lastConfirmedOrder(orders.slice(0, 2)), null);
  assert.equal(lastConfirmedOrder([]), null);
});

const skip = !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu';
test('WhatsApp: tilaus, nollaus ja "sama ku viimeks" kopioi gatewayn tilauksen, kysyy päivän ja hinnoittelee uudelleen', { skip, timeout: 90_000 }, async (t) => {
  const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
  const { createWhatsAppChannel } = await import('../server/whatsapp/channel.mjs');
  const { createDemoOrderingChat } = await import('../server/whatsapp/ordering.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  const settings = { phoneId: '12345', verifyToken: 'v', appSecret: 'secret', supportContact: 'Testin tuki', orderingDemo: true };
  // Oma kello: viestikatto (10 / min) ei saa pudottaa testin viestejä.
  let time = Date.now(); const now = () => time;
  const store = openWhatsAppStore(path.join(dir, 'whatsapp.db'), now);
  const bridge = createDemoOrderingChat({ store, phoneId: settings.phoneId, draftDb: path.join(dir, 'drafts.db'), quoteDb: path.join(dir, 'quotes.db') });
  const sent = [];
  const channel = createWhatsAppChannel({ settings, store, chat: bridge.chat, now, pause: async () => {}, send: async (to, text) => { sent.push(text); return `out-${sent.length}`; } });
  t.after(async () => { await channel.stop(); await bridge.close(); store.close(); });
  const PHONE = '358401234567'; let n = 0;
  async function say(text) {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: settings.phoneId },
      messages: [{ id: `r${++n}`, from: PHONE, timestamp: String(Math.floor((time += 61_000) / 1000)), type: 'text', text: { body: text } }] } }] }] }));
    const req = Readable.from([raw]); req.method = 'POST'; req.url = '/webhooks/whatsapp';
    req.headers = { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', settings.appSecret).update(raw).digest('hex')}` };
    const res = { writeHead(s) { this.status = s; }, end() {} };
    await channel.handle(req, res); assert.equal(res.status, 200);
    const before = sent.length;
    while (await channel.processNext()) { /* drain */ }
    return sent.slice(before).join('\n\n');
  }
  const { code } = store.invite(PHONE, 'Testikeittiö (demo)', 'Anna');
  await say(`YHDISTA ${code}`);
  const buyerId = `whatsapp-demo-${store.member(PHONE).binding}`;
  assert.match(await say('sitä samaa ku viimeks'), /En löydä aiempaa tilausta/);

  await say('20 l maitoa ja 5 l kermaa maanantaiksi');
  await say('laktoositon'); await say('1'); await say('1');
  const done = await say('TILAA');
  const first = orders.list(buyerId);
  assert.equal(first.length, 1); assert.equal(first[0].status, 'confirmed', done);

  // Nollaus aloittaa uuden keskustelujakson: aiempi luonnos ei enää löydy keskustelusta, mutta tilaus löytyy gatewaysta.
  assert.match(await say('tyhjää kaikki'), /tyhjä/);
  // Samassa viestissä voi olla lisäys: se tulkitaan, toistofraasi ei (sääntötulkki teki siitä ennen tuotteen "sima").
  const again = await say('sitä samaa ku viimeks ja 5 kg voita');
  assert.match(again, new RegExp(`Kopioin edellisen tilauksen ${first[0].orderId} tuotteet\\. Hinnat ja saatavuus tarkistetaan uudelle toimituspäivälle\\.`));
  assert.match(again, /Mille päivälle/);
  assert.doesNotMatch(again, /€/, 'ei hintoja ennen päivää');
  const list = await bridge.getShoppingList(store.member(PHONE));
  const copied = list.lines.filter((l) => l.selectedProductId);
  assert.deepEqual(copied.map((l) => l.selectedProductId).sort(), first[0].lines.map((l) => String(l.productId)).sort());
  assert.deepEqual(list.lines.filter((l) => !l.selectedProductId).map((l) => [l.productTerm, l.quantity?.value, l.quantity?.unit]), [['voi', 5, 'KG']]);
  assert.doesNotMatch(again, /sima/);
  assert.equal(list.deliveryDate ?? null, null);

  // Päivän jälkeen kopioidut rivit hinnoitellaan uudelle päivälle; lisätylle voille näytetään vaihtoehdot.
  const dated = await say('keskiviikoksi');
  assert.match(dated, /Voi: haluatko laktoositonta vai käykö tavallinen\?/);
  const options = await say('2');
  assert.match(options, /\*Voi 5 kg:\*\n1\) [^\n]+€/);
  const priced = await say('1');
  if (process.env.REORDER_PRINT) console.log(`${again}\n---\n${dated}\n---\n${options}\n---\n${priced}`);
  assert.match(priced, /\*Tilausluonnos\*\nToimitus: ke 18\.11\./);
  assert.match(priced, /Vahvista vastaamalla \*TILAA\*/);
  assert.equal(orders.list(buyerId).length, 1, 'kopio ei tee tilausta ilman vahvistusta');
});
