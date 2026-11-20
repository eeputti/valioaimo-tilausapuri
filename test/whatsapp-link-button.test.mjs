// Pitkä allekirjoitettu korilinkki näkyy WhatsAppissa painikkeena (Meta cta_url), ei koko osoitteena.
// Simuloitu Meta-rajapinta: pyynnön muoto, varatie tavalliseen tekstiin ja virheiden käsittely.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createMetaSender, linkButton, replyChunks } from '../server/whatsapp/channel.mjs';
import { replyWithCartLink } from '../server/whatsapp/cart-handoff.mjs';

const settings = { apiVersion: 'v23.0', phoneId: '12345', accessToken: 'test-access' };
const PHONE = '358401234567';
// Same shape as cart-link.mjs issues: base64url claims, a dot and a 43-character HMAC.
const payload = Buffer.from(JSON.stringify({ binding: crypto.randomUUID(), draft: 'WD-1', expires: Date.now() + 3600_000 })).toString('base64url');
const CART = `https://demo.trycloudflare.com/whatsapp/cart#${payload}.${crypto.createHmac('sha256', 'k').update(payload).digest('base64url')}`;
const PAYMENT = 'https://aimo-order-demo.example.workers.dev/demo-payment.html#AGW-20261115-0007';

function meta(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    const next = responses.shift() || { status: 200, id: `wamid.${calls.length}` };
    return { ok: next.status < 300, status: next.status, json: async () => ({ messages: [{ id: next.id }] }) };
  };
  return { calls, fetchImpl };
}

test('the real cart handoff reply is sent as an "Avaa ostoskori" button with the full signed link behind it', async () => {
  const shoppingList = { id: 'WD-1', revision: 3, status: 'review', lines: [{ productTerm: 'maito' }] };
  const result = await replyWithCartLink({ text: 'avaa kori', shoppingList, cartHandoff: async () => CART });
  const [part] = replyChunks(result.messages);
  assert.ok(part.endsWith(CART), 'tallennettu vastaus säilyttää linkin tekstivaratietä varten');
  const { calls, fetchImpl } = meta([]);
  assert.equal(await createMetaSender(settings, fetchImpl, { linkButtons: true })(PHONE, part, 'inbound'), 'wamid.1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://graph.facebook.com/v23.0/12345/messages');
  assert.equal(calls[0].headers.authorization, 'Bearer test-access');
  assert.deepEqual(calls[0].body, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: PHONE, type: 'interactive',
    interactive: { type: 'cta_url', body: { text: 'Tässä linkki ostoskoriisi. Tarkista tuotteet ja vahvista tilaus siellä.' },
      action: { name: 'cta_url', parameters: { display_text: 'Avaa ostoskori', url: CART } } },
  });
  // The token is only in the button URL, never in the visible text.
  assert.doesNotMatch(calls[0].body.interactive.body.text, /https?:|#/);
  assert.ok(calls[0].body.interactive.action.parameters.display_text.length <= 20);
});

test('a demo payment link becomes a "Siirry maksamaan" button', async () => {
  const { calls, fetchImpl } = meta([]);
  await createMetaSender(settings, fetchImpl, { linkButtons: true })(PHONE, `Tilaus on vahvistettu. Maksa demomaksu tästä:\n${PAYMENT}`);
  assert.equal(calls[0].body.type, 'interactive');
  assert.deepEqual(calls[0].body.interactive.action.parameters, { display_text: 'Siirry maksamaan', url: PAYMENT });
  assert.equal(calls[0].body.interactive.body.text, 'Tilaus on vahvistettu. Maksa demomaksu tästä.');
});

test('ordinary replies and unrecognised or ambiguous links stay plain text messages', async () => {
  for (const text of ['Hei! Mitä tilataan?', `${CART}`, `Avaa:\n${CART}\nKiitos`, `Linkki ${CART} ja\n${CART}`,
    'Katso:\nhttps://example.com/whatsapp/cart#lyhyt', `Katso:\n${CART.replace('https:', 'http:')}`,
    `Katso:\n${CART}?x=1`, `${'a'.repeat(1025)}\n${CART}`, 'Toinen sivu:\nhttps://evil.example/demo-payment.html#AGW-20261115-0007x']) {
    assert.equal(linkButton(text), null, text.slice(0, 60));
    const { calls, fetchImpl } = meta([]);
    await createMetaSender(settings, fetchImpl, { linkButtons: true })(PHONE, text);
    assert.equal(calls.length, 1); assert.equal(calls[0].body.type, 'text');
    assert.deepEqual(calls[0].body.text, { preview_url: false, body: text });
  }
});

test('a rejected button falls back once to the same text with the plain link; other errors are not retried here', async () => {
  const text = `Tässä linkki ostoskoriisi. Tarkista tuotteet ja vahvista tilaus siellä:\n${CART}`;
  const rejected = meta([{ status: 400 }, { status: 200, id: 'wamid.text' }]);
  assert.equal(await createMetaSender(settings, rejected.fetchImpl, { linkButtons: true })(PHONE, text), 'wamid.text');
  assert.deepEqual(rejected.calls.map((c) => c.body.type), ['interactive', 'text']);
  assert.equal(rejected.calls[1].body.text.body, text);
  // Authentication or rate errors would fail for text too: the queue retries the whole part later.
  for (const status of [401, 403, 429, 500]) {
    const failing = meta([{ status }]);
    await assert.rejects(createMetaSender(settings, failing.fetchImpl, { linkButtons: true })(PHONE, text), new RegExp(`META_HTTP_${status}`));
    assert.equal(failing.calls.length, 1);
  }
  // Fallback that also fails surfaces the text error, and a missing message id is still an error.
  const both = meta([{ status: 400 }, { status: 400 }]);
  await assert.rejects(createMetaSender(settings, both.fetchImpl, { linkButtons: true })(PHONE, text), /META_HTTP_400/);
  const noId = createMetaSender(settings, async () => ({ ok: true, status: 200, json: async () => ({}) }), { linkButtons: true });
  await assert.rejects(noId(PHONE, text), /META_NO_MESSAGE_ID/);
});

test('WHATSAPP_LINK_BUTTONS=false keeps the earlier plain-text link', async () => {
  const { calls, fetchImpl } = meta([]);
  await createMetaSender(settings, fetchImpl, { linkButtons: false })(PHONE, `Tässä linkki ostoskoriisi:\n${CART}`);
  assert.equal(calls[0].body.type, 'text');
});
