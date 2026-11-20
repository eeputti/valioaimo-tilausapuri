import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel, createMetaSender, createMetaTypingIndicator, validSignature, extractMessages, formatReply, replyChunks } from '../server/whatsapp/channel.mjs';
import { whatsappSettings } from '../server/whatsapp/runtime.mjs';

// Kanavan testit ajetaan muistikannalla ja omalla kellolla. Meta, malli ja verkko korvataan kirjaavilla funktioilla.
const NUMBER = '358401234567';
const SECOND = '358409876543';
const START = Date.parse('2026-11-14T12:00:00Z');
const SETTINGS = Object.freeze({
  phoneId: '12345', appSecret: 'test-app-secret', verifyToken: 'test-verify',
  accessToken: 'test-access', apiVersion: 'v23.0', supportContact: 'https://example.com/tuki',
});
const GRAPH_MESSAGES = 'https://graph.facebook.com/v23.0/12345/messages';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Kanava, jonka malli ja lähetys kirjataan. model korvaa chat-vastauksen, transport Metan lähetyksen; muut
 *  avaimet menevät createWhatsAppChannelille sellaisenaan (typing, pause …). */
function harness(t, { model, transport, ...channelOptions } = {}) {
  let time = START;
  const clock = { now: () => time, forward: (ms) => { time += ms; } };
  const store = openWhatsAppStore(':memory:', clock.now);
  const modelCalls = []; const attempts = []; const outbox = [];
  const channel = createWhatsAppChannel({
    settings: SETTINGS, store, now: clock.now, ...channelOptions,
    chat: async (request) => {
      modelCalls.push(request);
      return model ? model(request) : { text: `Mallin vastaus ${modelCalls.length}` };
    },
    send: async (to, text, inboundId) => {
      attempts.push({ to, text });
      const id = transport ? await transport(to, text, inboundId) : `out-${attempts.length}`;
      outbox.push({ to, text, id });
      return id;
    },
  });
  // Kanava pysäytetään ennen kannan sulkemista, jotta kesken jäänyt ilmaisin tai vuoro ei kirjoita suljettuun kantaan.
  t.after(async () => { await channel.stop(); store.close(); });
  let serial = 0;
  return {
    store, channel, clock, modelCalls, attempts, outbox,
    // Viesti jonoon samassa muodossa kuin webhook sen kirjaa. Palauttaa tunnisteen, tai null, jos jono hylkäsi viestin.
    inbound(text, { from = NUMBER, kind } = {}) {
      serial += 1;
      const id = `wamid.${serial}`;
      return store.enqueue({ id, phone: from, text, sentAt: time, ...(kind ? { kind } : {}) }) ? id : null;
    },
    // Liitos suoraan kantaan ilman kanavaa. YHDISTA-viestillä yhdistäminen testataan omissa testeissään.
    link(phone = NUMBER, company = 'Ravintola A', person = 'Anna') {
      const { code } = store.invite(phone, company, person);
      return store.pair(phone, codeHash(code));
    },
    async run(times = 1) {
      let last;
      for (let i = 0; i < times; i += 1) last = await channel.processNext();
      return last;
    },
    row: (id) => store.db.prepare('SELECT * FROM inbox WHERE id=?').get(id),
    count: (where) => store.db.prepare(`SELECT count(*) AS n FROM inbox WHERE ${where}`).get().n,
  };
}

const signatureFor = (raw, secret = SETTINGS.appSecret) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

// Kanavan handle-kutsu ilman oikeaa palvelinta. Allekirjoitus lasketaan rungosta, ellei testi anna omaa.
async function webhook(channel, { method = 'POST', target = '/webhooks/whatsapp', body = '', signature } = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const req = Object.assign(Readable.from([raw]), { method, url: target, headers: { 'x-hub-signature-256': signature ?? signatureFor(raw) } });
  const reply = {};
  const res = {
    writeHead: (status, headers) => { reply.status = status; reply.headers = headers; },
    end: (text = '') => { reply.body = String(text); },
  };
  reply.handled = await channel.handle(req, res);
  return reply;
}

// Metan viestiwebhook. Jokainen viesti on { id, from, text }; sentAt on lähetysaika millisekunteina.
function metaPayload(messages, { numberId = SETTINGS.phoneId, sentAt = START } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: numberId },
      messages: messages.map(({ id, from = NUMBER, text }) => ({ id, from, timestamp: String(Math.floor(sentAt / 1000)), type: 'text', text: { body: text } })),
    } }] }],
  };
}

// Epäonnistuu nimetysti, jos odotettu asia ei tapahdu ajoissa, eikä jätä testiä roikkumaan.
const within = (promise, ms, what) => Promise.race([
  promise,
  delay(ms, undefined, { ref: false }).then(() => { throw new Error(`${what}: ei tapahtunut ${ms} ms:ssa`); }),
]);

describe('webhook', () => {
  test('vahvistus palauttaa haasteen vain tilauspyyntöön oikealla tunnuksella', async (t) => {
    const h = harness(t);
    const ok = await webhook(h.channel, { method: 'GET', target: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=hello' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, 'hello');
    for (const query of ['hub.mode=subscribe&hub.verify_token=wrong', 'hub.mode=unsubscribe&hub.verify_token=test-verify&hub.challenge=x', 'hub.challenge=x']) {
      const denied = await webhook(h.channel, { method: 'GET', target: `/webhooks/whatsapp?${query}` });
      assert.equal(denied.status, 403, query);
      assert.notEqual(denied.body, 'x', query);
    }
  });

  test('väärä allekirjoitus, rikkinäinen JSON ja liian iso runko hylätään kirjaamatta mitään jonoon', async (t) => {
    const h = harness(t);
    assert.equal((await webhook(h.channel, { body: '{}', signature: 'bad' })).status, 403);
    assert.equal((await webhook(h.channel, { body: '{}', signature: signatureFor(Buffer.from('{}'), 'other-secret') })).status, 403);
    assert.equal((await webhook(h.channel, { body: '{' })).status, 400);
    assert.equal((await webhook(h.channel, { body: 'x'.repeat(256_001) })).status, 413);
    assert.equal(h.count('1=1'), 0);
  });

  test('allekirjoitus tarkistetaan koko rungosta', () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    assert.equal(validSignature(raw, signatureFor(raw), SETTINGS.appSecret), true);
    assert.equal(validSignature(Buffer.from('changed'), signatureFor(raw), SETTINGS.appSecret), false);
    assert.equal(validSignature(Buffer.from('changed'), `sha256=${'0'.repeat(64)}`, SETTINGS.appSecret), false);
    assert.equal(validSignature(raw, undefined, SETTINGS.appSecret), false);
  });

  test('muut metodit saavat 405, ja muut polut jätetään seuraavalle käsittelijälle', async (t) => {
    const h = harness(t);
    assert.equal((await webhook(h.channel, { method: 'DELETE' })).status, 405);
    const elsewhere = await webhook(h.channel, { method: 'GET', target: '/other' });
    assert.equal(elsewhere.handled, false);
    assert.equal(elsewhere.status, undefined);
  });

  test('erän viestit kuitataan jonoon ennen mallia, ja toistettu webhook ei tuplaa niitä', async (t) => {
    const h = harness(t); h.link();
    const body = JSON.stringify(metaPayload([{ id: 'one', text: 'munia' }, { id: 'two', text: 'jauhoja' }]));
    const first = await webhook(h.channel, { body });
    assert.equal(first.status, 200);
    assert.deepEqual(JSON.parse(first.body), { received: true });
    assert.equal((await webhook(h.channel, { body })).status, 200);
    assert.equal(h.modelCalls.length, 0, 'webhook ei odota mallia');
    assert.equal(h.count("state='pending'"), 2);
    await h.run(2);
    assert.deepEqual(h.modelCalls.map((call) => call.messages.at(-1).content), ['munia', 'jauhoja']);
  });

  test('viestien poiminta ohittaa toisen numeron, liian vanhat viestit ja pelkät tilapäivitykset', () => {
    const at = START;
    const one = [{ id: 'm', text: 'x' }];
    assert.deepEqual(extractMessages(metaPayload(one, { numberId: 'different' }), SETTINGS.phoneId, at), []);
    assert.deepEqual(extractMessages(metaPayload(one, { sentAt: at - 24 * HOUR }), SETTINGS.phoneId, at), []);
    const statuses = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: SETTINGS.phoneId }, statuses: [{ id: 's', status: 'read' }] } }] }] };
    assert.deepEqual(extractMessages(statuses, SETTINGS.phoneId, at), []);
    assert.deepEqual(extractMessages(metaPayload(one), SETTINGS.phoneId, at).map(({ id, phone, kind, text }) => ({ id, phone, kind, text })),
      [{ id: 'm', phone: NUMBER, kind: 'text', text: 'x' }]);
  });
});

describe('yhdistäminen', () => {
  test('liittämätön numero ei pääse malliin, ja koodi on numerokohtainen, kertakäyttöinen, tiivistetty ja vanhenee', async (t) => {
    const h = harness(t);
    h.inbound('Hae munat'); await h.run();
    assert.equal(h.modelCalls.length, 0);
    assert.match(h.outbox.at(-1).text, /YHDISTA/);

    const { code } = h.store.invite(NUMBER, 'Ravintola A', 'Anna');
    h.inbound(`YHDISTA ${code}`, { from: SECOND }); await h.run();
    assert.equal(h.store.member(SECOND), undefined, 'toisen numeron kutsukoodi ei yhdistä');
    h.inbound(`YHDISTA ${code}`); await h.run();
    assert.equal(h.store.member(NUMBER).company, 'Ravintola A');
    assert.equal(h.store.pair(NUMBER, codeHash(code)), null, 'koodi kelpaa vain kerran');
    assert.equal(JSON.stringify(h.store.db.prepare('SELECT * FROM inbox').all()).includes(code), false, 'koodia ei tallenneta selväkielisenä');

    const third = '358405550000';
    const early = h.store.invite(third, 'Ravintola C', 'Liisa');
    const late = h.store.invite(SECOND, 'Ravintola B', 'Mikko');
    h.clock.forward(10 * MINUTE - 1_000);
    assert.equal(h.store.pair(third, codeHash(early.code)).company, 'Ravintola C');
    h.clock.forward(1_001);
    assert.equal(h.store.pair(SECOND, codeHash(late.code)), null, 'kymmenen minuutin jälkeen koodi on vanhentunut');
  });

  test('viides väärä yritys lukitsee yhdistämisen, vaikka oikea koodi tulisi perään', async (t) => {
    const h = harness(t);
    const { code } = h.store.invite(NUMBER, 'Ravintola A', 'Anna');
    for (let i = 0; i < 5; i += 1) { h.inbound('YHDISTA vaara-koodi'); await h.run(); }
    h.inbound(`YHDISTA ${code}`); await h.run();
    assert.equal(h.store.member(NUMBER), undefined);
    assert.match(h.outbox.at(-1).text, /virheellinen/);
  });

  test('yhdestä numerosta otetaan jonoon enintään kymmenen viestiä minuutissa', (t) => {
    const h = harness(t);
    for (let i = 1; i <= 10; i += 1) assert.notEqual(h.inbound(`viesti ${i}`), null, `viesti ${i}`);
    assert.equal(h.inbound('liikaa'), null);
    assert.notEqual(h.inbound('toiselta', { from: SECOND }), null, 'raja on numerokohtainen');
    h.clock.forward(MINUTE + 1);
    assert.notEqual(h.inbound('minuutin päästä'), null);
  });

  test('uusi yhdistäminen vahvistaa uuden yrityksen ja peruu vanhan liitoksen jonossa olevat viestit', async (t) => {
    const h = harness(t);
    const before = h.link().binding;
    const { code } = h.store.invite(NUMBER, 'Ravintola B', 'Mikko');
    h.inbound(`YHDISTA ${code}`);
    const stale = h.inbound('vanhan yrityksen pyyntö');
    await h.run();
    assert.match(h.outbox.at(-1).text, /Mikko, Ravintola B/);
    assert.notEqual(h.store.member(NUMBER).binding, before);
    const sentSoFar = h.outbox.length;
    await h.run();
    assert.equal(h.outbox.length, sentSoFar);
    assert.equal(h.modelCalls.length, 0);
    assert.equal(h.row(stale).state, 'cancelled');
  });
});

describe('keskustelu', () => {
  test('liitetyn numeron historia jatkuu, ja toisen yrityksen keskustelu pysyy erillään', async (t) => {
    const h = harness(t);
    h.link(); h.link(SECOND, 'Ravintola B', 'Mikko');
    h.inbound('60 kananmunaa maanantaiksi'); await h.run();
    h.inbound('Entä korvaava tuote?'); await h.run();
    const followUp = h.modelCalls[1];
    assert.equal(followUp.channel, 'whatsapp');
    assert.deepEqual(followUp.messages.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.equal(followUp.messages[0].content, '60 kananmunaa maanantaiksi');

    h.inbound('Jauhoja', { from: SECOND }); await h.run();
    const other = h.modelCalls[2];
    assert.deepEqual(other.messages, [{ role: 'user', content: 'Jauhoja' }]);
    assert.equal(other.member.company, 'Ravintola B');
    assert.equal(h.outbox.at(-1).to, SECOND);
  });

  test('kesken mallivuoron poistettu numero ei saa vastausta, historiaa eikä jonon seuraavaa viestiä', async (t) => {
    let h;
    h = harness(t, { model: async () => { h.store.revoke(NUMBER); return { text: 'yksityinen vastaus' }; } });
    h.link();
    h.inbound('Munia');
    const queued = h.inbound('Jauhoja');
    await h.run(2);
    assert.equal(h.attempts.length, 0);
    assert.equal(h.modelCalls.length, 1);
    assert.equal(h.store.member(NUMBER), undefined);
    assert.equal(h.store.db.prepare('SELECT count(*) AS n FROM turns').get().n, 0);
    assert.equal(h.row(queued).state, 'cancelled');
  });

  test('muu kuin teksti, tukipyyntö ja mallin virhe saavat hallitun vastauksen ilman sisäisiä tietoja', async (t) => {
    const h = harness(t, { model: async () => { throw new Error('secret-token-should-not-leak'); } });
    h.link();
    h.inbound('', { kind: 'unsupported' }); await h.run();
    assert.match(h.outbox.at(-1).text, /tekstiviesti/);
    h.inbound('tuki'); await h.run();
    assert.match(h.outbox.at(-1).text, /https:\/\/example\.com\/tuki/);
    assert.equal(h.modelCalls.length, 0, 'kiinteät vastaukset eivät kutsu mallia');
    h.inbound('Munia'); await h.run();
    const failure = h.outbox.at(-1).text;
    assert.match(failure, /ei nyt onnistunut/);
    assert.doesNotMatch(failure, /secret-token/);
  });

  test('yksittäinen ylipitkä vastaus lyhennetään WhatsAppin rajan alle', () => {
    const shortened = formatReply('x'.repeat(5000));
    assert.ok(shortened.length < 4096);
    assert.match(shortened, /lyhennetty/);
    assert.equal(formatReply('**Maito** 10 l'), '*Maito* 10 l');
  });
});

describe('jono ja lähetys', () => {
  test('epäonnistunut lähetys yritetään uudelleen tallennetulla vastauksella ilman uutta mallikutsua', async (t) => {
    let down = true;
    const h = harness(t, { transport: async () => { if (down) throw new Error('META_HTTP_503'); return 'delivered'; } });
    h.link();
    const id = h.inbound('Munia'); await h.run();
    assert.equal(h.modelCalls.length, 1);
    assert.equal(h.row(id).error, 'META_HTTP_503');
    h.clock.forward(30_001); down = false;
    await h.run();
    assert.equal(h.modelCalls.length, 1);
    assert.equal(h.attempts.length, 2);
    assert.equal(h.attempts[0].text, h.attempts[1].text);
    assert.equal(h.row(id).state, 'done');
  });

  test('viivästynyt vastaus pitää saman numeron seuraavat viestit jonossa, mutta muut asiakkaat etenevät', async (t) => {
    let failing = true;
    const h = harness(t, { transport: async (to) => { if (failing && to === NUMBER) throw new Error('META_HTTP_503'); return 'sent'; } });
    h.link(); h.link(SECOND, 'Ravintola B', 'Mikko');
    h.inbound('Munia'); h.inbound('Jauhoja'); h.inbound('Maitoa', { from: SECOND });
    await h.run();
    assert.equal(h.modelCalls.length, 1);
    await h.run();
    assert.equal(h.modelCalls.length, 2);
    assert.equal(h.modelCalls[1].messages.at(-1).content, 'Maitoa');
    assert.equal(await h.run(), false, 'Jauhoja odottaa Munia-vastauksen takana');
    h.clock.forward(30_001); failing = false;
    await h.run(2);
    assert.equal(h.modelCalls.length, 3);
    assert.equal(h.modelCalls[2].messages.at(-1).content, 'Jauhoja');
  });

  test('yli 23 tuntia vanhaan viestiin ei enää vastata', async (t) => {
    const h = harness(t);
    h.link();
    const id = h.inbound('Munia');
    h.clock.forward(23 * HOUR);
    await h.run();
    assert.equal(h.modelCalls.length, 0);
    assert.equal(h.attempts.length, 0);
    assert.equal(h.row(id).state, 'expired');
  });

  test('toistuva virhe luovutetaan kolmannen yrityksen jälkeen yleisellä virhekoodilla', async (t) => {
    const h = harness(t, { transport: async () => { throw new Error('secret'); } });
    h.link();
    const id = h.inbound('Jauhoja');
    for (let i = 0; i < 3; i += 1) { await h.run(); h.clock.forward(100_000); }
    assert.equal(await h.run(), false);
    const job = h.row(id);
    assert.equal(job.state, 'failed');
    assert.equal(job.attempts, 3);
    assert.equal(job.error, 'PROCESSING_OR_DELIVERY_ERROR');
  });

  test('tiedostokanta säilyttää liitoksen, historian, tuplien eston ja tallennetun vastauksen uudelleenkäynnistyksessä', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-wa-restart-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'wa.db');
    const before = openWhatsAppStore(file);
    const { code } = before.invite(NUMBER, 'Ravintola A', 'Anna');
    const binding = before.pair(NUMBER, codeHash(code)).binding;
    before.enqueue({ id: 'kept', phone: NUMBER, text: 'Munia', sentAt: Date.now() });
    before.saveReply(before.next(), 'Vastaus', binding);
    before.close();

    const after = openWhatsAppStore(file);
    t.after(() => after.close());
    after.recover();
    assert.equal(after.member(NUMBER).binding, binding);
    const resumed = after.next();
    assert.equal(resumed.id, 'kept');
    assert.equal(resumed.reply, 'Vastaus');
    assert.deepEqual(after.history(binding), [{ role: 'user', content: 'Munia' }, { role: 'assistant', content: 'Vastaus' }]);
    assert.equal(after.enqueue({ id: 'kept', phone: NUMBER, text: 'tupla', sentAt: Date.now() }), false);
  });

  test('a partial multi-message delivery retries only the unacknowledged part without rerunning the model', async (t) => {
    let fail = true; const delivered = []; const pauses = [];
    let models = 0;
    const h = harness(t, { pause: async (ms) => pauses.push(ms),
      model: async () => { models++; return { text: 'Lista\n\nKysymys', messages: ['Lista', 'Kysymys'] }; },
      transport: async (phone, text) => { if (text === 'Kysymys' && fail) throw new Error('META_HTTP_503'); delivered.push(text); return `out-${text}`; },
    });
    h.link();
    const id = h.inbound('Maitoa'); await h.run();
    assert.deepEqual(delivered, ['Lista']);
    h.clock.forward(31_000); fail = false;
    await h.run();
    assert.deepEqual(delivered, ['Lista', 'Kysymys']); assert.equal(models, 1);
    assert.equal(h.row(id).state, 'done');
    assert.deepEqual(pauses, [400, 400]);
  });

  test('long replies split without losing product facts or breaking an emoji', () => {
    const text = 'x'.repeat(3799) + '🥛' + '\nTuotteen hinta 12,34 € ja toimituspäivä 16.11.2026.';
    const chunks = replyChunks([text]);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every((part) => part.length <= 3800));
  });

  test('restart preserves the acknowledged parts of a multi-message reply', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-wa-parts-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filename = path.join(dir, 'whatsapp.db'); let time = Date.now();
    const first = openWhatsAppStore(filename, () => time);
    const invite = first.invite(NUMBER, 'Keittiö', 'Testaaja'); first.pair(NUMBER, codeHash(invite.code));
    first.enqueue({ id: 'multi', phone: NUMBER, text: 'Maitoa', sentAt: time });
    const channel = createWhatsAppChannel({ settings: SETTINGS, store: first, now: () => time, pause: async () => {},
      chat: async () => ({ messages: ['Lista', 'Kysymys'], text: 'Lista\n\nKysymys' }),
      send: async (phone, text) => { if (text === 'Kysymys') throw new Error('META_HTTP_503'); return 'first-accepted'; },
    });
    await channel.processNext(); first.close(); time += 31_000;
    const second = openWhatsAppStore(filename, () => time); t.after(() => second.close());
    const sent = [];
    const restarted = createWhatsAppChannel({ settings: SETTINGS, store: second, now: () => time, pause: async () => {},
      chat: async () => { throw new Error('must not run model again'); },
      send: async (phone, text) => { sent.push(text); return 'second-accepted'; },
    });
    await restarted.processNext();
    assert.deepEqual(sent, ['Kysymys']);
    assert.equal(second.db.prepare("SELECT state FROM inbox WHERE id='multi'").get().state, 'done');
  });
});

describe('Metan rajapinta', () => {
  test('lähettäjä kutsuu oman numeron Graph-osoitetta tunnuksella ja lähettää tavallisen viestin ilman lainausta', async () => {
    const requests = [];
    const send = createMetaSender(SETTINGS, async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.out' }] }) };
    });
    assert.equal(await send(NUMBER, 'Hei', 'wamid.in'), 'wamid.out');
    assert.equal(requests.length, 1);
    const [{ url, options, body }] = requests;
    assert.deepEqual({ url, method: options.method, auth: options.headers.authorization }, { url: GRAPH_MESSAGES, method: 'POST', auth: 'Bearer test-access' });
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.to, NUMBER);
    assert.equal(body.type, 'text');
    assert.equal(body.text.body, 'Hei');
    assert.equal('context' in body, false, 'vastaus ei lainaa asiakkaan viestiä');
  });

  test('lähettäjän virheessä kerrotaan vain HTTP-tila', async () => {
    const rejected = createMetaSender(SETTINGS, async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'token test-access invalid' } }) }));
    await assert.rejects(rejected(NUMBER, 'Hei', 'wamid.in'), (err) => err.message === 'META_HTTP_401');
    const silent = createMetaSender(SETTINGS, async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await assert.rejects(silent(NUMBER, 'Hei', 'wamid.in'), /META_NO_MESSAGE_ID/);
  });

  test('kirjoitusilmaisin merkitsee saapuneen viestin luetuksi lähettämättä keskusteluviestiä', async () => {
    const requests = [];
    const typing = createMetaTypingIndicator(SETTINGS, async (url, options) => { requests.push({ url, options }); return { ok: true }; });
    await typing('wamid.in');
    assert.equal(requests.length, 1);
    const [{ url, options }] = requests;
    assert.deepEqual({ url, method: options.method, auth: options.headers.authorization }, { url: GRAPH_MESSAGES, method: 'POST', auth: 'Bearer test-access' });
    assert.deepEqual(JSON.parse(options.body), { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.in', typing_indicator: { type: 'text' } });
    const refused = createMetaTypingIndicator(SETTINGS, async () => ({ ok: false, status: 403 }));
    await assert.rejects(refused('wamid.in'), (err) => err.message === 'META_TYPING_HTTP_403');
  });
});

describe('kirjoitusilmaisin', () => {
  test('typing starts before the model and its failure cannot fail or retry the reply', async (t) => {
    const events = [];
    const h = harness(t, {
      typing: async (id) => { events.push(['typing', id]); throw new Error('private-upstream-error'); },
      model: async () => { events.push(['model']); return { text: 'Vastaus' }; },
      transport: async () => { events.push(['reply']); return 'out'; },
    });
    h.link();
    const id = h.inbound('Maitoa'); await h.run();
    assert.deepEqual(events.map(([kind]) => kind), ['typing', 'model', 'reply']);
    assert.equal(events[0][1], id);
    const job = h.row(id);
    assert.equal(job.state, 'done'); assert.equal(job.attempts, 1); assert.equal(job.error, null);
  });

  test('hidas ilmaisinpyyntö ei viivästä mallia, mutta vastaus lähtee vasta sen jälkeen', async (t) => {
    let typingDone; let modelStarted;
    const started = new Promise((resolve) => { modelStarted = resolve; });
    const h = harness(t, {
      typing: () => new Promise((resolve) => { typingDone = resolve; }),
      model: async () => { modelStarted(); return { text: 'Vastaus' }; },
    });
    h.link(); h.inbound('Maitoa');
    const work = h.run();
    await within(started, 2000, 'malli ei käynnistynyt ilmaisimen ollessa kesken');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.attempts.length, 0, 'vastaus odottaa ilmaisinpyynnön valmistumista');
    typingDone();
    await work;
    assert.equal(h.outbox.length, 1);
  });

  test('ilmaisin päivittyy hitaan mallivuoron aikana ja loppuu vastaukseen', async (t) => {
    let finish; const typed = [];
    const h = harness(t, {
      typing: async (id) => { typed.push(id); },
      model: () => new Promise((resolve) => { finish = () => resolve({ text: 'Vastaus' }); }),
    });
    h.link();
    t.mock.timers.enable({ apis: ['setInterval'] });
    h.inbound('Maitoa');
    const work = h.run();
    assert.equal(typed.length, 1);
    h.clock.forward(20_000); t.mock.timers.tick(20_000);
    assert.equal(typed.length, 2);
    finish(); await work;
    t.mock.timers.tick(40_000);
    assert.equal(typed.length, 2);
  });

  test('uusi allekirjoitettu viesti näyttää ilmaisimen heti toisen vuoron aikana, mutta tupla ja väärä allekirjoitus eivät', async (t) => {
    const typed = []; let finish;
    const h = harness(t, {
      typing: async (id) => { typed.push(id); },
      model: () => new Promise((resolve) => { finish = () => resolve({ text: 'Vastaus' }); }),
    });
    h.link();
    const busy = h.inbound('Maitoa');
    const work = h.run();
    const body = JSON.stringify(metaPayload([{ id: 'new-during-work', from: SECOND, text: 'Moi' }], { sentAt: h.clock.now() }));
    assert.equal((await webhook(h.channel, { body })).status, 200);
    assert.deepEqual(typed, [busy, 'new-during-work']);
    await webhook(h.channel, { body });
    assert.equal((await webhook(h.channel, { body, signature: 'invalid' })).status, 403);
    assert.equal(typed.length, 2);
    finish(); await work; await h.channel.stop();
  });

  test('expired or revoked jobs never show typing', async (t) => {
    const calls = [];
    const h = harness(t, { typing: async (id) => { calls.push(id); } });
    h.link();
    h.inbound('Maitoa'); h.clock.forward(23 * HOUR); await h.run();
    h.inbound('Kermaa'); h.store.revoke(NUMBER); await h.run();
    assert.deepEqual(calls, []);
  });
});

describe('asetukset', () => {
  const complete = {
    WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_ACCESS_TOKEN: 'test-access', WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_VERIFY_TOKEN: 'test-verify', WHATSAPP_SUPPORT_CONTACT: 'https://example.com/tuki', WHATSAPP_API_VERSION: 'v23.0',
  };

  test('kanava otetaan käyttöön vain, kun jokainen asetus on annettu', () => {
    // Ei mitään tai vain osa asetuksista: kanava ei käynnisty.
    for (const partial of [{}, { WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_API_VERSION: 'v23.0' }]) assert.throws(() => whatsappSettings(partial), /puuttuu/);
    for (const name of Object.keys(complete)) assert.throws(() => whatsappSettings({ ...complete, [name]: '  ' }), /puuttuu/, name);
    const parsed = whatsappSettings({ ...complete, WHATSAPP_PHONE_NUMBER_ID: ' 12345 ' });
    assert.equal(parsed.phoneId, '12345');
    assert.equal(parsed.apiVersion, 'v23.0');
  });

  test('Graph-osoitteeseen menevät numero ja versio tarkistetaan', () => {
    assert.throws(() => whatsappSettings({ ...complete, WHATSAPP_API_VERSION: '../bad' }), /virheellinen/);
    assert.throws(() => whatsappSettings({ ...complete, WHATSAPP_PHONE_NUMBER_ID: '12345/messages' }), /virheellinen/);
  });
});
