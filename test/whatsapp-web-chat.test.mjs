import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createWebChat, webChatPhone, WEB_CHAT_PHONE } from '../server/whatsapp/web-chat.mjs';
import { supportReply } from '../server/whatsapp/channel.mjs';

const SECRET = 'web-chat-test-secret-' + 'x'.repeat(30);
const A = 'a'.repeat(32), B = 'b'.repeat(32);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function server(options = {}) {
  const store = openWhatsAppStore(':memory:');
  const calls = [];
  const chat = options.chat || (async (args) => {
    calls.push(args);
    const said = args.messages.at(-1).content;
    return { text: `Vastaus: ${said}`, messages: [`Vastaus: ${said}`, 'Mitä muuta?'], status: 'collecting' };
  });
  const web = createWebChat({ store, chat, secret: SECRET, supportContact: options.supportContact ?? 'https://example.com/tuki', cartLink: (member, list) => `https://tunnel.example/whatsapp/cart#${member.binding}.${list.id}`,
    shoppingList: async (member) => (member ? { id: 'WD-1', lines: [{}] } : null), now: options.now });
  const srv = http.createServer(async (req, res) => { if (!(await web.handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body, auth = SECRET) => fetch(`${base}/webchat/api/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
  return { store, calls, post, close: () => { srv.close(); store.close(); } };
}

test('each browser session gets its own test customer, history and reply parts; retries do not repeat the turn', async () => {
  const s = await server();
  try {
    const first = await (await s.post('chat', { session: A, text: 'tarvitsen maitoa', messageId: uuid(1) })).json();
    assert.deepEqual(first.parts, ['Vastaus: tarvitsen maitoa', 'Mitä muuta?']);
    const retry = await (await s.post('chat', { session: A, text: 'tarvitsen maitoa', messageId: uuid(1) })).json();
    assert.deepEqual(retry.parts, first.parts);
    assert.equal(s.calls.length, 1);
    await s.post('chat', { session: B, text: 'kermaa', messageId: uuid(2) });
    await s.post('chat', { session: A, text: '20 litraa', messageId: uuid(3) });
    assert.notEqual(s.calls[0].member.binding, s.calls[1].member.binding);
    assert.equal(s.calls[2].member.binding, s.calls[0].member.binding);
    // The second turn of the same session sees the first one as history, like WhatsApp.
    assert.deepEqual(s.calls[2].messages.map((m) => m.content), ['tarvitsen maitoa', 'Vastaus: tarvitsen maitoa\n\nMitä muuta?', '20 litraa']);
    const phoneA = webChatPhone(SECRET, A);
    assert.match(phoneA, WEB_CHAT_PHONE);
    assert.equal(s.store.member(phoneA).company, 'Testikeittiö (selain)');
    const history = await (await s.post('history', { session: A })).json();
    assert.deepEqual(history.messages.map((m) => [m.text, m.parts.length]), [['tarvitsen maitoa', 2], ['20 litraa', 2]]);
    assert.deepEqual((await (await s.post('history', { session: 'c'.repeat(32) })).json()).messages, []);
    // Stored like WhatsApp turns, so the agent trace can read them.
    assert.equal(s.store.db.prepare("SELECT count(*) n FROM inbox WHERE phone=? AND state='done' AND id LIKE 'web-%'").get(phoneA).n, 2);
    const cart = await (await s.post('cart', { session: A })).json();
    assert.equal(cart.url, `https://tunnel.example/whatsapp/cart#${s.calls[0].member.binding}.WD-1`);
  } finally { s.close(); }
});

test('only the Worker with the shared secret can call, and bad input or a failed model call is refused cleanly', async () => {
  const s = await server({ chat: async (args) => { if (args.messages.at(-1).content === 'kaadu') throw new Error('model down'); return { text: 'ok' }; } });
  try {
    assert.equal((await s.post('chat', { session: A, text: 'moi', messageId: uuid(1) }, null)).status, 401);
    assert.equal((await s.post('chat', { session: A, text: 'moi', messageId: uuid(1) }, 'wrong-secret-' + 'y'.repeat(30))).status, 401);
    assert.equal((await s.post('chat', { session: 'short', text: 'moi', messageId: uuid(1) })).status, 400);
    assert.equal((await s.post('chat', { session: A, text: '', messageId: uuid(1) })).status, 400);
    assert.equal((await s.post('chat', { session: A, text: 'x'.repeat(2001), messageId: uuid(1) })).status, 400);
    assert.equal((await s.post('chat', { session: A, text: 'moi', messageId: 'not-a-uuid' })).status, 400);
    assert.equal((await s.post('nope', { session: A })).status, 404);
    const failed = await s.post('chat', { session: A, text: 'kaadu', messageId: uuid(2) });
    assert.equal(failed.status, 502);
    assert.doesNotMatch(JSON.stringify(await failed.json()), /model down/);
    assert.equal(s.store.db.prepare("SELECT state FROM inbox WHERE id=?").get(`web-${uuid(2)}`).state, 'failed');
    // A turn that never finished is not picked up by the WhatsApp queue, even after a restart or a cloud recovery.
    s.store.db.prepare("UPDATE inbox SET state='web' WHERE id=?").run(`web-${uuid(2)}`);
    s.store.recover();
    if (s.store.recoverStale) s.store.recoverStale();
    assert.equal(s.store.next(), null);
    // Another session cannot reuse a message id that belongs to someone else.
    await s.post('chat', { session: A, text: 'moi', messageId: uuid(3) });
    assert.equal((await s.post('chat', { session: B, text: 'moi', messageId: uuid(3) })).status, 409);
  } finally { s.close(); }
});

test('a daily cap across all browser sessions protects the model budget', async () => {
  let t = Date.parse('2026-11-15T12:00:00Z');
  const s = await server({ now: () => t });
  try {
    for (let i = 0; i < 600; i++) s.store.db.prepare("INSERT INTO inbox(id,phone,text,kind,received,sent_at,state) VALUES(?,?,?,'text',?,?,'done')").run(`web-x${i}`, '358000012345678', 'x', t, t);
    const capped = await s.post('chat', { session: A, text: 'moi', messageId: uuid(9) });
    assert.equal(capped.status, 429);
    t += 86400_000 + 1;
    assert.equal((await s.post('chat', { session: A, text: 'moi', messageId: uuid(9) })).status, 200);
  } finally { s.close(); }
});

test('a bare "tuki" gets the same fixed WhatsApp answer without a model call and stays out of the model history', async () => {
  const s = await server();
  try {
    const reply = await (await s.post('chat', { session: A, text: 'Tuki', messageId: uuid(1) })).json();
    assert.deepEqual(reply.parts, [supportReply({ orderingDemo: true, supportContact: 'https://example.com/tuki' })]);
    assert.match(reply.parts[0], /Asiakaspalvelu: https:\/\/example.com\/tuki$/);
    assert.equal(s.calls.length, 0);
    // A longer message that only mentions support still goes to the order conversation.
    await s.post('chat', { session: A, text: 'tarvitsen tukea tilauksen kanssa', messageId: uuid(2) });
    assert.equal(s.calls.length, 1);
    assert.deepEqual(s.calls[0].messages.map((m) => m.content), ['tarvitsen tukea tilauksen kanssa']);
    const history = await (await s.post('history', { session: A })).json();
    assert.deepEqual(history.messages.map((m) => m.text), ['Tuki', 'tarvitsen tukea tilauksen kanssa']);
  } finally { s.close(); }
});

test('reply lines that start with "- " are shown with an en dash like in WhatsApp; the stored reply keeps "- "', async () => {
  const list = 'Ostoskorissasi nyt:\n- maito, 20 l\n- voi, 5 kg\nToimitus pe 20.11. - tarkista ennen tilausta.';
  const s = await server({ chat: async () => ({ text: list, messages: [list] }) });
  try {
    const shown = 'Ostoskorissasi nyt:\n– maito, 20 l\n– voi, 5 kg\nToimitus pe 20.11. - tarkista ennen tilausta.';
    assert.deepEqual((await (await s.post('chat', { session: A, text: 'maitoa ja voita', messageId: uuid(1) })).json()).parts, [shown]);
    assert.deepEqual((await (await s.post('chat', { session: A, text: 'maitoa ja voita', messageId: uuid(1) })).json()).parts, [shown]);
    assert.deepEqual((await (await s.post('history', { session: A })).json()).messages[0].parts, [shown]);
    assert.equal(s.store.db.prepare('SELECT text FROM reply_parts WHERE message_id=?').get(`web-${uuid(1)}`).text, list);
  } finally { s.close(); }
});
