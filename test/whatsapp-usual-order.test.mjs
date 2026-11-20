// "Se tavallinen": ostajan toistuvat tuotteet tavallisella määrällä uudeksi luonnokseksi (Mankelin S.I.MO:n "my usual").
// Sääntö ja ilmaukset ilman verkkoa; koko WhatsApp-ketju oikeilla moduuleilla, säännöillä ilman kielimallia, simuloiduilla
// hinnoilla ja omilla väliaikaisilla kannoilla. Ei Meta-lähetyksiä eikä Valion rajapintaa.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-usual-'));
process.env.AIMO_DB = path.join(dir, 'kitchen.db');
process.env.GATEWAY_DB = path.join(dir, 'gateway.db');
process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEMO_NOW = '2026-11-14T10:00:00+02:00';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { usualOrder, USUAL_ORDER, REPEAT_LAST } = await import('../server/order-conversation/index.mjs');

const order = (orderId, status, lines) => ({ orderId, status, lines: lines.map(([productId, quantity, name = `Tuote ${productId}`]) => ({ productId, quantity, name, salesUnitLabel: 'PKT' })) });

test('tavallinen tilaus: tuote vähintään kahdessa ja puolessa 8 viime vahvistetusta tilauksesta, määränä mediaani', () => {
  const orders = [
    order('AGW-7', 'pending_approval', [['1', 99]]),
    order('AGW-6', 'rejected', [['5', 3]]),
    order('AGW-5', 'confirmed', [['1', 10], ['1', 4], ['2', 5]]), // sama tuote kahdesti samassa tilauksessa = 14
    order('AGW-4', 'confirmed', [['1', 12], ['3', 2]]),
    order('AGW-3', 'confirmed', [['1', 10], ['2', 7]]),
    order('AGW-2', 'confirmed', [['1', 14], ['4', 1], ['', 1], ['6', 0]]),
  ];
  const usual = usualOrder(orders, (name) => ({ productTerm: name.toLowerCase() }));
  assert.equal(usual.ofOrders, 4);
  assert.equal(usual.single, undefined);
  // 1: 4/4 tilauksessa, mediaani 13 (10, 12, 14, 14). 2: 2/4 = puolet, mediaani 6. 3 ja 4: vain 1/4. Odottava ja hylätty ohitetaan.
  assert.deepEqual(usual.lines.map((l) => [l.selectedProductId, l.quantity, l.productTerm, l.packLabel]), [
    ['1', { value: 13, unit: 'PCS', basis: 'sales' }, 'tuote 1', 'PKT'],
    ['2', { value: 6, unit: 'PCS', basis: 'sales' }, 'tuote 2', 'PKT']]);

  // Vain 8 viimeisintä vahvistettua lasketaan: vanha toistuva tuote ei nouse tavalliseksi.
  const many = [...Array.from({ length: 8 }, (_, i) => order(`N${i}`, 'confirmed', [['1', 2]])), order('O1', 'confirmed', [['9', 1]]), order('O2', 'confirmed', [['9', 1]])];
  assert.deepEqual(usualOrder(many).lines.map((l) => l.selectedProductId), ['1']);
  // Yksi vahvistettu tilaus: kopioidaan se ja kerrotaan siitä. Ei tilauksia tai ei toistuvia tuotteita: ei rivejä.
  const single = usualOrder([order('AGW-1', 'confirmed', [['1', 3]])]);
  assert.equal(single.single, 'AGW-1'); assert.deepEqual(single.lines.map((l) => [l.selectedProductId, l.quantity.value]), [['1', 3]]);
  assert.deepEqual(usualOrder([]), { lines: [], ofOrders: 0 });
  assert.deepEqual(usualOrder([order('A', 'confirmed', [['1', 1]]), order('B', 'confirmed', [['2', 1]])]), { lines: [], ofOrders: 2 });
});

test('ilmaukset: "se tavallinen" on tilaus, "tavallinen käy" ja "se tavallinen maito" eivät ole', () => {
  for (const s of ['se tavallinen', 'Se tavallinen kiitos', 'moi, se tavallinen perjantaiks', 'tavallinen tilaus', 'Tilaan tavallisen tilauksen keskiviikoksi',
    'sitä tavallista', 'ne tavalliset taas', 'normi setti huomiseks', 'vakiotilaus maanantaille', 'samaa ku aina', 'tilaa niinku aina', 'tavalliseen tapaan ja 5 kg voita']) {
    assert.ok(USUAL_ORDER.test(s), s);
  }
  for (const s of ['tavallinen käy', 'tavallinen', 'se tavallinen maito', 'se tavallinen voi 5 kg', 'tavallista enemmän maitoa', 'normaali maito', 'kuten aina, 10 l maitoa', 'sama ku viimeks']) {
    assert.ok(!USUAL_ORDER.test(s), s);
  }
  assert.ok(!REPEAT_LAST.test('se tavallinen'));
});

const skip = !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu';
test('WhatsApp: "se tavallinen" ilman tilauksia, yhden ja kahden tilauksen jälkeen; päivä kysytään ensin ja hinnoitellaan uudelleen', { skip, timeout: 120_000 }, async (t) => {
  const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
  const { createWhatsAppChannel } = await import('../server/whatsapp/channel.mjs');
  const { createDemoOrderingChat } = await import('../server/whatsapp/ordering.mjs');
  const { orders } = await import('../server/gateway/store.mjs');
  const settings = { phoneId: '12345', verifyToken: 'v', appSecret: 'secret', supportContact: 'Testin tuki', orderingDemo: true };
  let time = Date.now(); const now = () => time; // oma kello: viestikatto (10 / min) ei pudota viestejä
  const store = openWhatsAppStore(path.join(dir, 'whatsapp.db'), now);
  const bridge = createDemoOrderingChat({ store, phoneId: settings.phoneId, draftDb: path.join(dir, 'drafts.db'), quoteDb: path.join(dir, 'quotes.db') });
  const sent = [];
  const channel = createWhatsAppChannel({ settings, store, chat: bridge.chat, now, pause: async () => {}, send: async (to, text) => { sent.push(text); return `out-${sent.length}`; } });
  t.after(async () => { await channel.stop(); await bridge.close(); store.close(); });
  const PHONE = '358401234568'; let n = 0;
  async function say(text) {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: settings.phoneId },
      messages: [{ id: `u${++n}`, from: PHONE, timestamp: String(Math.floor((time += 61_000) / 1000)), type: 'text', text: { body: text } }] } }] }] }));
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
  const none = await say('se tavallinen');
  assert.match(none, /En löydä aiempia tilauksia, joten tavallista tilausta ei vielä ole\./);
  assert.doesNotMatch(none, /tavallinen:/i, 'fraasi ei tullut tuoteriviksi');
  assert.equal((await bridge.getShoppingList(store.member(PHONE)))?.lines?.length ?? 0, 0);

  // Ensimmäinen tilaus: maito ja kerma maanantaiksi.
  await say('20 l maitoa ja 5 l kermaa maanantaiksi');
  await say('laktoositon'); await say('1'); await say('1');
  const firstDone = await say('TILAA');
  assert.equal(orders.list(buyerId)[0]?.status, 'confirmed', firstDone);
  const first = orders.list(buyerId)[0];

  // Yksi tilaus: se kopioidaan ja kerrotaan, että tilauksia on vasta yksi.
  await say('tyhjää kaikki');
  const one = await say('se tavallinen');
  assert.match(one, new RegExp(`Löysin vasta yhden aiemman tilauksen \\(${first.orderId}\\), joten kopioin sen tuotteet tavalliseksi tilaukseksi\\.`));
  assert.match(one, /Mille päivälle/);
  assert.deepEqual((await bridge.getShoppingList(store.member(PHONE))).lines.map((l) => l.selectedProductId).sort(), first.lines.map((l) => String(l.productId)).sort());

  // Toinen tilaus: vain sama maito tiistaiksi (eri päivä, jottei tuplatilauksen vahti pysäytä sitä).
  await say('tyhjää kaikki');
  await say("20 l maitoa tiistaiksi");
  await say('laktoositon'); await say('1');
  const secondDone = await say('TILAA');
  const second = orders.list(buyerId)[0];
  assert.equal(second.status, 'confirmed', secondDone);
  assert.notEqual(second.orderId, first.orderId);
  const milk = String(second.lines[0].productId);
  assert.ok(first.lines.some((l) => String(l.productId) === milk), `sama maito molemmissa tilauksissa: ${JSON.stringify([first.lines, second.lines].map((ls) => ls.map((l) => [l.productId, l.name, l.quantity])))}`);
  const milkQty = (o) => o.lines.filter((l) => String(l.productId) === milk).reduce((s, l) => s + l.quantity, 0);

  // Kaksi tilausta: tavalliseen tulee vain molemmissa ollut maito, määränä mediaani. Kerma oli vain toisessa.
  await say('tyhjää kaikki');
  const usual = await say('moi, se tavallinen');
  assert.match(usual, /Kokosin tavallisen tilauksesi 2 viime tilauksesta: tuotteet, jotka ovat olleet mukana vähintään puolessa niistä, tavallisella määrällä\. Hinnat ja saatavuus tarkistetaan uudelle toimituspäivälle\./);
  assert.match(usual, /Mille päivälle/);
  assert.doesNotMatch(usual, /€/, 'ei hintoja ennen päivää');
  const list = await bridge.getShoppingList(store.member(PHONE));
  assert.deepEqual(list.lines.map((l) => [l.selectedProductId, l.quantity.value]), [[milk, Math.round((milkQty(first) + milkQty(second)) / 2)]]);
  assert.equal(list.deliveryDate ?? null, null);

  const priced = await say('keskiviikoksi');
  if (process.env.USUAL_PRINT) console.log(`${none}\n---\n${one}\n---\n${usual}\n---\n${priced}`);
  assert.match(priced, /\*Tilausluonnos\*\nToimitus: ke 18\.11\./);
  assert.equal(orders.list(buyerId).length, 2, 'tavallinen tilaus ei tee tilausta ilman vahvistusta');
});
