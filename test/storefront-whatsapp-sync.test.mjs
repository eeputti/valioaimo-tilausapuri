// Korisivun hintanäkymä WhatsApp-luonnoksesta: rivit tulevat tarjouksen myyntieristä ja hinnoista, eikä keskeneräiselle
// listalle keksitä tuotteita. Vienti avautuu vain voimassa olevalla allekirjoitetulla korilinkillä.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { storefrontCartProjection } from '../server/storefront-whatsapp-sync.mjs';
import { createCartLink } from '../server/whatsapp/cart-link.mjs';
import { codeHash, openWhatsAppStore } from '../server/whatsapp/store.mjs';

const KITCHEN_PHONE = '358401234567';
const reviewedList = {
  id: 'luonnos-1', revision: 2, buyerId: 'ostaja', companyName: 'Keittiö', status: 'review', deliveryDate: '2026-11-18',
};
const quotedMilk = {
  productId: 'syn-maito', name: '6 x 1 l', salesUnits: 4, unitPriceNet: 12, vatRate: 13.5, salesUnitLabel: 'ltk', covers: { value: 24, unit: 'L' },
};

test('valmis lista näyttää tarjouksen tarkat myyntierät ja hinnat', () => {
  const cart = storefrontCartProjection(reviewedList, { issues: [], lines: [quotedMilk] });
  assert.equal(cart.state, 'ready');
  assert.equal(cart.source, 'whatsapp:ostaja');
  assert.equal(cart.id, reviewedList.id);
  assert.equal(cart.revision, reviewedList.revision);
  const [row] = cart.lines;
  assert.equal(row.qty, 4, 'määrä on myyntieriä eikä litroja');
  assert.equal(row.requested.value, 24);
  assert.equal(row.price, 12);
  assert.equal(row.vat, 13.5);
  assert.equal(row.unit, 'ltk');
});

test('keskeneräinen tai tarjoukseton lista odottaa eikä keksi rivejä', () => {
  const choosing = storefrontCartProjection({ ...reviewedList, status: 'needs_product_selection' }, null);
  assert.equal(choosing.state, 'waiting');
  assert.deepEqual(choosing.lines, []);
  assert.match(choosing.message, /WhatsAppissa/);

  const blocked = storefrontCartProjection(reviewedList, { issues: [{ code: 'PRICE_UNKNOWN' }], lines: [quotedMilk] });
  assert.equal(blocked.state, 'waiting', 'tarjouksen ongelma pitää korin odottamassa');
});

test('vienti avautuu korilinkillä, mutta ei väärällä avaimella eikä poistetulle numerolle', async (t) => {
  const store = openWhatsAppStore(':memory:');
  t.after(() => store.close());
  const member = store.pair(KITCHEN_PHONE, codeHash(store.invite(KITCHEN_PHONE, 'Keittiö', 'Testaaja').code));
  const row = { id: 'syn-maito', name: 'Testimaito 6 x 1 l', qty: 4, price: 12, vat: 13.5, unit: 'ltk' };
  const exported = { source: 'whatsapp:ostaja', id: 'luonnos-1', revision: 1, state: 'ready', deliveryDate: '2026-11-18', lines: [row] };
  const link = createCartLink({
    store,
    baseUrl: 'https://cart.example',
    secret: 'cart-link-test-secret',
    ordering: {
      getShoppingList: async () => ({ id: 'luonnos-1', revision: 1, buyerId: 'ostaja', status: 'review', lines: [row] }),
      getStorefrontCart: async () => ({ ...exported }),
    },
  });

  // "avaa kori" valmiiseen listaan antaa linkin viimeiselle riville; avain on osoitteen #-osassa.
  const answer = await link.chat({ member, messages: [{ content: 'avaa kori' }] });
  const issued = new URL(answer.text.split('\n').at(-1));
  assert.equal(issued.origin, 'https://cart.example');
  const token = issued.hash.slice(1);

  const server = http.createServer((req, res) => link.handle(req, res, new URL(req.url, 'http://localhost')));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => { server.close(resolve); });
  });
  const exportUrl = `http://127.0.0.1:${server.address().port}/whatsapp/cart/api/export`;
  const exportWith = (credential) => fetch(exportUrl, { headers: { authorization: `Bearer ${credential}` } });

  const ok = await exportWith(token);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).lines, [row]);
  assert.equal((await exportWith('invalid')).status, 410);

  store.revoke(member.phone);
  assert.equal((await exportWith(token)).status, 410, 'poistettu numero menettää linkin heti');
});
