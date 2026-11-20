import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { createOrderPaidNotice, orderPaidMessage, deliveryLabel, ORDER_PAID_PATH } from '../server/whatsapp/order-paid.mjs';
import { webChatPhone } from '../server/whatsapp/web-chat.mjs';

const secret = 'test-only-' + 's'.repeat(40);
function setup({ fail = false } = {}) {
  const store = openWhatsAppStore(':memory:');
  const join = (phone) => { const { code } = store.invite(phone, 'Testikeittiö', 'Kokki'); store.pair(phone, codeHash(code)); return store.member(phone); };
  const member = join('358401234567');
  const web = join(webChatPhone(secret, 'a'.repeat(64)));
  const orders = new Map([
    ['AGW-20261120-0001', { orderId: 'AGW-20261120-0001', status: 'confirmed', buyerId: `whatsapp-demo-${member.binding}`, deliveryDate: '2026-11-24' }],
    ['AGW-20261120-0002', { orderId: 'AGW-20261120-0002', status: 'confirmed', buyerId: `whatsapp-demo-${web.binding}`, deliveryDate: '2026-11-24' }],
    ['AGW-20261120-0003', { orderId: 'AGW-20261120-0003', status: 'confirmed', buyerId: 'whatsapp-demo-unknown', deliveryDate: '2026-11-24' }],
  ]);
  const sent = [];
  let failing = fail;
  const notice = createOrderPaidNotice({ store, secret, findOrder: async (id) => orders.get(id) || null,
    send: async (to, text) => { if (failing) throw new Error('META_HTTP_400'); sent.push({ to, text }); return `wamid.${sent.length}`; } });
  return { store, notice, sent, recover: () => { failing = false; } };
}
function call(notice, body, { auth = `Bearer ${secret}` } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' } });
  const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = JSON.parse(b); } };
  return notice.handle(req, res, new URL(`https://bot.example${ORDER_PAID_PATH}`)).then((handled) => ({ handled, ...res }));
}

test('the thank-you names the order and delivery day', () => {
  assert.equal(deliveryLabel('2026-11-24'), 'ti 24.11.');
  assert.equal(deliveryLabel('nope'), null);
  const text = orderPaidMessage({ orderId: 'AGW-20261120-0001', deliveryDate: '2026-11-24' });
  assert.match(text, /^Kiitos tilauksestasi!/);
  assert.match(text, /AGW-20261120-0001/);
  assert.match(text, /Toimitus on ti 24\.11\., joten tuotteiden pitäisi saapua silloin\./);
  assert.match(text, /Tilaa multa milloin vain uudestaan!$/);
  assert.doesNotMatch(text, /sähköpost/);
  assert.doesNotMatch(orderPaidMessage({ orderId: 'AGW-20261120-0001', deliveryDate: null }), /Toimitus/);
});

test('a paid order sends one WhatsApp thank-you to the number that ordered, however often the Worker calls', async () => {
  const s = setup();
  try {
    const results = await Promise.all([1, 2, 3].map(() => call(s.notice, { orderId: 'AGW-20261120-0001' })));
    for (const r of results) { assert.equal(r.handled, true); assert.equal(r.status, 200); }
    assert.deepEqual(results.map((r) => r.body.outcome).sort(), ['duplicate', 'duplicate', 'sent']);
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].to, '358401234567');
    assert.doesNotMatch(s.sent[0].text, /sähköpost/);
    assert.equal((await call(s.notice, { orderId: 'AGW-20261120-0001' })).body.outcome, 'duplicate');
    assert.equal(s.sent.length, 1);
  } finally { s.store.close(); }
});

test('browser-chat customers, re-linked numbers and unknown orders get no message', async () => {
  const s = setup();
  try {
    assert.equal((await call(s.notice, { orderId: 'AGW-20261120-0002' })).body.outcome, 'web_chat');
    assert.equal((await call(s.notice, { orderId: 'AGW-20261120-0003' })).body.outcome, 'no_member');
    const missing = await call(s.notice, { orderId: 'AGW-20261120-0009' });
    assert.equal(missing.status, 404);
    assert.equal(s.sent.length, 0);
  } finally { s.store.close(); }
});

test('only the Worker can call, with a valid order number; a failed send can be retried', async () => {
  const s = setup({ fail: true });
  try {
    assert.equal((await call(s.notice, { orderId: 'AGW-20261120-0001' }, { auth: 'Bearer wrong' })).status, 401);
    assert.equal((await call(s.notice, { orderId: '../x' })).status, 400);
    const failed = await call(s.notice, { orderId: 'AGW-20261120-0001' });
    assert.equal(failed.status, 502);
    s.recover();
    assert.equal((await call(s.notice, { orderId: 'AGW-20261120-0001' })).body.outcome, 'sent');
    assert.equal(s.sent.length, 1);
    const other = await s.notice.handle({ method: 'GET', headers: {} }, {}, new URL('https://bot.example/webchat/api/chat'));
    assert.equal(other, false);
  } finally { s.store.close(); }
});
