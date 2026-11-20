// Niputus ja vanhentuneen vastauksen esto (docs/agent-v2.md, kohta Niputus). Eelis 19.11. klo 8.45: "vastaat jokasee
// viestii yksitelle ... lukaset uudet viestit läpi ja mietit kontekstin". Simuloitu kello, chat ja Meta; ei mallia eikä verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel, gatherSettings, supportReply } from '../server/whatsapp/channel.mjs';
import { bootstrapDemoMember, createDemoOrderingChat } from '../server/whatsapp/ordering.mjs';
import { createOrderingConversation } from '../server/order-conversation/index.mjs';
import { openDraftStore } from '../server/order-conversation/store.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { redoWhenAgent } from '../server/whatsapp/runtime.mjs';

const PHONE = '358401234567';
// Eeliksen ensimmäinen viesti 19.11.2026 klo 8.43.32.
const T0 = Date.parse('2026-11-19T08:43:32+02:00');
const settings = { phoneId: '12345', appSecret: 'test-app-secret', verifyToken: 'test-verify', accessToken: 'test-access',
  apiVersion: 'v23.0', supportContact: 'https://example.com/tuki', orderingDemo: true };
const GATHER = { gatherMs: 6000, maxGatherMs: 20_000 };

/** Kanava simuloidulla kellolla. arrive(ms, text) ajastaa asiakkaan viestin hetkeen T0 + ms: viesti tulee jonoon, kun kello
 *  ohittaa sen niputuksen tauolla tai chat-kutsun aikana (chatMs). reply(n) antaa n:nnen chat-kutsun tuloksen. redo on
 *  chatin uusintatuki: tosi kuten v2-agentilla, ellei testi kerro muuta (null = kanavan oletus). */
function fixture(t, { gather = GATHER, chatMs = 0, reply = (n) => ({ text: `Vastaus ${n}` }), redo = true } = {}) {
  let time = T0;
  const store = openWhatsAppStore(':memory:', () => time); t.after(() => store.close());
  const { code } = store.invite(PHONE, 'Ravintola A', 'Anna'); store.pair(PHONE, codeHash(code));
  const due = []; const calls = []; const sent = []; const pauses = [];
  let n = 0;
  const enqueue = (text, extra = {}) => store.enqueue({ id: `m${++n}`, phone: PHONE, text, sentAt: time, ...extra });
  const advance = (ms) => {
    const end = time + ms;
    due.sort((a, b) => a.at - b.at);
    while (due.length && due[0].at <= end) { const next = due.shift(); time = Math.max(time, next.at); enqueue(next.text, next.extra); }
    time = end;
  };
  const channel = createWhatsAppChannel({ settings, store, now: () => time, ...gather, ...(redo === null ? {} : { redo }),
    pause: async (ms) => { pauses.push(ms); advance(ms); },
    chat: async (args) => {
      calls.push(structuredClone({ messageId: args.messageId, messages: args.messages, incoming: args.incoming, discardedReply: args.discardedReply }));
      advance(chatMs);
      const out = reply(calls.length);
      if (out instanceof Error) throw out;
      return out;
    },
    send: async (to, text) => { sent.push(text); return `out-${sent.length}`; } });
  return { store, channel, calls, sent, pauses, enqueue, advance,
    arrive: (ms, text, extra) => due.push({ at: T0 + ms, text, extra }),
    ids: () => calls.map((c) => c.messageId),
    states: () => store.db.prepare('SELECT state FROM inbox ORDER BY rowid').all().map((r) => r.state),
    binding: () => store.member(PHONE).binding };
}

test('kaksi viestiä 6 s välein saavat tuotannon oletuksilla yhden chat-kutsun ja yhden vastauksen', async (t) => {
  // Eelis 19.11. klo 8.43.32 ja 8.43.38: kaksi viestiä 6 s välein saivat kaksi erillistä, keskenään ristiriitaista vastausta.
  const f = fixture(t, { gather: gatherSettings({}) });
  f.enqueue('tarviin perunaa, sipulia ja kermaa 50 hengelle');
  f.arrive(6000, 'toimitus perjantaiks');
  await f.channel.processNext();
  f.advance(60_000); while (await f.channel.processNext());
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].incoming, [
    { text: 'tarviin perunaa, sipulia ja kermaa 50 hengelle', at: T0, round: 0 },
    { text: 'toimitus perjantaiks', at: T0 + 6000, round: 0 }]);
  assert.equal(f.calls[0].messages.at(-1).content, 'tarviin perunaa, sipulia ja kermaa 50 hengelle\ntoimitus perjantaiks');
  assert.deepEqual(f.sent, ['Vastaus 1']);
});

test('chatin aikana tullut viesti hylkää valmiin vastauksen, ja uusi kutsu saa hylätyn vastauksen ja kaikki viestit', async (t) => {
  // Niputus päättyy 6 s kohdalla, ja chat kestää 6–10 s. Toinen viesti tulee 8 s kohdalla, kun vastaus on vielä lähettämättä.
  const f = fixture(t, { chatMs: 4000 });
  f.enqueue('20 l maitoa');
  f.arrive(8000, 'ja 5 kg voita');
  await f.channel.processNext();
  assert.deepEqual(f.ids(), ['m1', 'm1:r1']);
  assert.deepEqual(f.calls[0].incoming, [{ text: '20 l maitoa', at: T0, round: 0 }]);
  assert.equal(f.calls[0].discardedReply, undefined);
  assert.equal(f.calls[1].discardedReply, 'Vastaus 1');
  assert.deepEqual(f.calls[1].incoming, [{ text: '20 l maitoa', at: T0, round: 0 }, { text: 'ja 5 kg voita', at: T0 + 8000, round: 1 }]);
  // Vanha putki on jo käsitellyt ensimmäisen viestin: viimeinen käyttäjävuoro on vain uusi viesti, aiempi on sitä ennen.
  assert.deepEqual(f.calls[1].messages, [{ role: 'user', content: '20 l maitoa' }, { role: 'user', content: 'ja 5 kg voita' }]);
  assert.deepEqual(f.sent, ['Vastaus 2']);
  assert.deepEqual(f.states(), ['done', 'merged']);
  assert.deepEqual(f.store.history(f.binding()), [{ role: 'user', content: '20 l maitoa\nja 5 kg voita' }, { role: 'assistant', content: 'Vastaus 2' }]);
  assert.equal(await f.channel.processNext(), false);
});

test('ilman uusintatukea vastaus lähtee, ja chatin aikana tullut viesti saa oman vuoronsa', async (t) => {
  // Katselmus 19.11.: vanha tilausputki ei osaa käyttää hylättyä vastausta, vaan sen pitää mennä perille (esim. korilinkki
  // tai näytetty vaihtoehtolista). Uusinta tehdään vain chatille, joka tukee sitä. Oletus on pois.
  const failing = async () => { throw new Error('runtime down'); };
  for (const [name, redo] of [['oletus', null], ['false', false], ['agentti ei vastaa', async () => false], ['tarkistus kaatuu', failing]]) {
    await t.test(name, async (t) => {
      const f = fixture(t, { chatMs: 4000, redo });
      f.enqueue('20 l maitoa');
      f.arrive(8000, 'ja 5 kg voita');
      await f.channel.processNext();
      assert.deepEqual(f.sent, ['Vastaus 1']);
      assert.equal(await f.channel.processNext(), true);
      assert.deepEqual(f.ids(), ['m1', 'm2']);
      assert.equal(f.calls[1].discardedReply, undefined);
      assert.deepEqual(f.calls[1].incoming, [{ text: 'ja 5 kg voita', at: T0 + 8000, round: 0 }]);
      assert.deepEqual(f.sent, ['Vastaus 1', 'Vastaus 2']);
      assert.deepEqual(f.states(), ['done', 'done']);
    });
  }
});

test('uusintoja on enintään kaksi, sitten viimeisin vastaus lähtee ja myöhempi viesti saa oman vuoronsa', async (t) => {
  // Chat-kutsut 6–10 s, 10–14 s ja 14–18 s. Jokaisen aikana tulee uusi viesti.
  const f = fixture(t, { chatMs: 4000 });
  f.enqueue('maitoa');
  f.arrive(7000, 'ja voita'); f.arrive(11_000, 'ja kermaa'); f.arrive(15_000, 'ja munia');
  await f.channel.processNext();
  assert.deepEqual(f.ids(), ['m1', 'm1:r1', 'm1:r2']);
  assert.equal(f.calls[2].discardedReply, 'Vastaus 2');
  assert.deepEqual(f.calls[2].incoming.map((m) => [m.text, m.round]), [['maitoa', 0], ['ja voita', 1], ['ja kermaa', 2]]);
  assert.deepEqual(f.sent, ['Vastaus 3']);
  assert.equal(await f.channel.processNext(), true);
  assert.deepEqual(f.ids().slice(3), ['m4']);
  assert.deepEqual(f.calls[3].incoming, [{ text: 'ja munia', at: T0 + 15_000, round: 0 }]);
  assert.deepEqual(f.sent, ['Vastaus 3', 'Vastaus 4']);
});

test('kesken uusinnan kaatunut vuoro jatkuu samasta uusinnasta eikä palaa hylättyyn vastaukseen', async (t) => {
  // Vanha putki palauttaa saman viesti-id:n tallennetun tuloksen, joten uusinta alkuperäisellä id:llä toisi hylätyn vastauksen.
  const f = fixture(t, { chatMs: 4000, reply: (n) => (n === 2 ? new Error('model down') : { text: `Vastaus ${n}` }) });
  f.enqueue('20 l maitoa');
  f.arrive(8000, 'ja 5 kg voita');
  assert.equal(await f.channel.processNext(), false);
  assert.deepEqual(f.sent, []);
  f.advance(31_000);
  assert.equal(await f.channel.processNext(), true);
  assert.deepEqual(f.ids(), ['m1', 'm1:r1', 'm1:r1']);
  assert.equal(f.calls[2].discardedReply, 'Vastaus 1');
  assert.deepEqual(f.calls[2].messages, [{ role: 'user', content: '20 l maitoa' }, { role: 'user', content: 'ja 5 kg voita' }]);
  assert.deepEqual(f.sent, ['Vastaus 3']);
});

test('viimeisellä yrityksellä kaatunut uusinta lähettää virheviestin eikä hylättyä vastausta', async (t) => {
  // Yritykset 1 ja 2 kaatuvat. Yrityksellä 3 ensimmäinen kierros onnistuu, sen aikana tulee viesti, ja uusinta kaatuu.
  const f = fixture(t, { chatMs: 4000, reply: (n) => (n === 3 ? { text: 'Vastaus 3' } : new Error('model down')) });
  f.enqueue('20 l maitoa');
  assert.equal(await f.channel.processNext(), false);
  f.advance(31_000); assert.equal(await f.channel.processNext(), false);
  f.arrive(107_000, 'ja 5 kg voita');
  f.advance(61_000); assert.equal(await f.channel.processNext(), true);
  assert.deepEqual(f.ids(), ['m1', 'm1', 'm1', 'm1:r1']);
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0], /Viestin käsittely ei nyt onnistunut/);
  assert.deepEqual(f.store.history(f.binding()), []);
});

test('pelkkä "tuki" saa kiinteän vastauksen heti ilman niputusta', async (t) => {
  const f = fixture(t);
  f.enqueue('tuki');
  await f.channel.processNext();
  assert.deepEqual(f.pauses, []);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.sent, [supportReply(settings)]);
});

test('chatin aikana tullut "tuki" ei hylkää vastausta, vaan saa oman vastauksensa perään', async (t) => {
  const f = fixture(t, { chatMs: 4000 });
  f.enqueue('20 l maitoa');
  f.arrive(8000, 'tuki');
  await f.channel.processNext();
  await f.channel.processNext();
  assert.deepEqual(f.ids(), ['m1']);
  assert.deepEqual(f.sent, ['Vastaus 1', supportReply(settings)]);
});

test('vastausta ei hylätä, kun uusi viesti on kuva tai linkki, vuoron viesti on linkki tai vuorossa syntyi tilaus', async (t) => {
  const confirmed = { status: 'confirmed', text: 'Tilaus AGW-20261119-0001 on tallennettu.' };
  const cases = [
    { name: 'kuva', first: '20 l maitoa', arrival: ['', { kind: 'image', mediaId: 'img-1' }], reply: 'Vastaus 1' },
    { name: 'linkki', first: '20 l maitoa', arrival: ['katso tää https://example.com/resepti'], reply: 'Vastaus 1' },
    { name: 'linkkiviesti', first: 'https://example.com/resepti', arrival: ['50 hengelle'], reply: 'Vastaus 1' },
    { name: 'tilaus', first: 'TILAA', arrival: ['ja maitoa'], result: confirmed, reply: confirmed.text },
  ];
  for (const c of cases) {
    await t.test(c.name, async (t) => {
      const f = fixture(t, { chatMs: 4000, reply: (n) => (n === 1 && c.result) || { text: `Vastaus ${n}` } });
      f.enqueue(c.first);
      f.arrive(8000, ...c.arrival);
      await f.channel.processNext();
      assert.deepEqual(f.ids(), ['m1']);
      assert.equal(f.sent.at(-1), c.reply);
      assert.deepEqual(f.states(), ['done', 'pending']);
    });
  }
});

test('pilven aikaraja: niputus ei odota drainin rajan yli eikä uusintaa aloiteta rajan jälkeen', async (t) => {
  // Vercel katkaisee kutsun 300 s kohdalla, ja drain jättää viimeiselle vuorolle 60 s (server/cloud.mjs). Pidempi niputus ja
  // uusinnat eivät saa venyttää vuoroa: rajan jälkeen ei aloiteta uutta mallikutsua.
  const f = fixture(t, { chatMs: 2000 });
  f.enqueue('20 l maitoa');
  f.arrive(5000, 'ja 5 kg voita');
  assert.equal(await f.channel.drain(4000), 1);
  assert.deepEqual(f.pauses, [4000]);
  assert.deepEqual(f.ids(), ['m1']);
  assert.deepEqual(f.sent, ['Vastaus 1']);
  assert.deepEqual(f.states(), ['done', 'pending']);
});

test('drain ei ota uutta työtä, kun aikaa on jäljellä alle varauksen', async (t) => {
  // Katselmus 19.11.: juuri ennen rajaa otettu v2-vuoro voi kestää yli minuutin, jolloin Vercel katkaisee sen ja työ odottaa
  // 6 minuutin käsittelyvarauksen. Pilvi varaa vuorolle 90 s (server/cloud.mjs).
  const f = fixture(t, { chatMs: 2000 });
  f.enqueue('20 l maitoa');
  assert.equal(await f.channel.drain(2999, { reserveMs: 3000 }), 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.states(), ['pending']);
  assert.equal(await f.channel.drain(3000, { reserveMs: 3000 }), 1);
  assert.deepEqual(f.sent, ['Vastaus 1']);
});

test('uusintaa ei aloiteta, kun drainin aikaa on jäljellä alle varauksen', async (t) => {
  // Raja 10 s ja varaus 3 s. Niputus päättyy 6 s kohdalla ja chat 8 s kohdalla, kun aikaa on enää 2 s: uusi mallikutsu
  // voisi kestää koko varauksen, joten vastaus lähtee ja myöhempi viesti jää jonoon. Ilman varausta uusinta tehtäisiin.
  const f = fixture(t, { chatMs: 2000 });
  f.enqueue('20 l maitoa');
  f.arrive(7000, 'ja 5 kg voita');
  assert.equal(await f.channel.drain(10_000, { reserveMs: 3000 }), 1);
  assert.deepEqual(f.ids(), ['m1']);
  assert.deepEqual(f.sent, ['Vastaus 1']);
  assert.deepEqual(f.states(), ['done', 'pending']);
});

test('uusinnan aikana peruttu numero ei saa vastausta, ja vuoron viestit poistuvat', async (t) => {
  let f;
  f = fixture(t, { chatMs: 4000, reply: (n) => { if (n === 2) f.store.revoke(PHONE); return { text: `Vastaus ${n}` }; } });
  f.enqueue('20 l maitoa');
  f.arrive(8000, 'ja 5 kg voita');
  await f.channel.processNext();
  assert.deepEqual(f.ids(), ['m1', 'm1:r1']);
  assert.deepEqual(f.sent, []);
  assert.equal(f.states()[0], 'cancelled');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM inbox_turns').get().n, 0);
});

test('kirjoittaa-ilmaisin jatkuu uusinnan ajan ja loppuu ennen vastausta', async (t) => {
  // Oikea kello: ilmaisin päivittyy setIntervalilla. Uusinta kestää 120 ms, ja päivitysväli on 10 ms.
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  const { code } = store.invite(PHONE, 'Ravintola A', 'Anna'); store.pair(PHONE, codeHash(code));
  const events = []; let calls = 0;
  const channel = createWhatsAppChannel({ settings, store, gatherMs: 5, maxGatherMs: 50, typingRefreshMs: 10, redo: true,
    typing: async (id) => { events.push(`typing:${id}`); },
    chat: async () => {
      calls += 1; events.push(`chat:${calls}`);
      if (calls === 1) store.enqueue({ id: 'm2', phone: PHONE, text: 'ja voita', sentAt: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, calls === 1 ? 5 : 120));
      return { text: `Vastaus ${calls}` };
    },
    send: async (to, text) => { events.push(`send:${text}`); return 'out-1'; } });
  store.enqueue({ id: 'm1', phone: PHONE, text: 'maitoa', sentAt: Date.now() });
  await channel.processNext();
  const during = events.slice(events.indexOf('chat:2'), events.indexOf('send:Vastaus 2'));
  assert.ok(during.filter((e) => e === 'typing:m1').length >= 2, events.join(' '));
  assert.deepEqual(events.filter((e) => e.startsWith('send:')), ['send:Vastaus 2']);
  assert.equal(events.at(-1), 'send:Vastaus 2');
});

/** Oikea WhatsApp-silta (ordering.mjs), luonnosmoottori ja vanha dialogi käsikirjoitetulla tulkilla, kytkettynä kanavaan kuten
 *  runtime.mjs: uusinta vain, kun v2-agentti vastaa (redoWhenAgent). Toinen viesti tulee, kun ensimmäisen vastaus on valmis
 *  mutta lähettämättä. */
function pipeline(t, { agentMode = '', agent = null } = {}) {
  let time = T0;
  const store = openWhatsAppStore(':memory:', () => time); t.after(() => store.close());
  bootstrapDemoMember(store, { WHATSAPP_DEMO_PHONE: PHONE });
  const drafts = openDraftStore(':memory:', () => time);
  const read = []; let conversationId;
  const handleTurn = createOrderingConversation({ store: drafts, now: () => time,
    tools: { suggest() { throw new Error('Tuotteet haetaan vasta, kun päivä ja ruokavalio tiedetään'); } },
    interpretTurn: async ({ text }) => {
      read.push(text);
      const ops = [];
      if (/maito/.test(text)) ops.push({ op: 'add', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [] });
      if (/voi/.test(text)) ops.push({ op: 'add', productTerm: 'voi', quantity: { value: 5, unit: 'KG' }, claims: [], excludeAllergens: [] });
      return { intent: 'order', ops };
    } });
  const bridge = createDemoOrderingChat({ store, phoneId: '12345', agentMode, loadOrdering: async () => ({
    handleTurn: (args) => { conversationId = args.conversationId; return handleTurn(args); },
    dialogue: createOrderingDialogue({ db: store.db, now: () => time }), ...(agent ? { agent } : {}), prune() {}, close() { drafts.close(); } }) });
  t.after(() => bridge.close());
  const sent = []; const ids = [];
  const channel = createWhatsAppChannel({ settings, store, now: () => time, ...GATHER, redo: redoWhenAgent(bridge),
    pause: async (ms) => { time += ms; },
    chat: async (args) => {
      ids.push(args.messageId);
      const out = await bridge.chat(args);
      if (args.messageId === 'm1') { time += 2000; store.enqueue({ id: 'm2', phone: PHONE, text: 'ja 5 kg voita', sentAt: time }); }
      return out;
    },
    send: async (to, text) => { sent.push(text); return `out-${sent.length}`; } });
  store.enqueue({ id: 'm1', phone: PHONE, text: '20 l maitoa', sentAt: time });
  return { channel, sent, ids, read, lines: () => drafts.active(conversationId).lines.map((l) => [l.productTerm, l.quantity]) };
}

test('vanha tilausputki lähettää ensimmäisen vastauksen eikä tee uusintaa, myöskään v2-asetuksella ilman agenttia', async (t) => {
  // Katselmus 19.11.: vanha ydin kirjaa jokaisen vastauksensa lähetetyksi (historia, lastOrder, näytetty lista). Hylätty
  // vastaus ei siksi saa jäädä matkalle. WHATSAPP_AGENT=v2 ilman API-avainta käyttää vanhaa putkea (server/agent/index.mjs).
  for (const agentMode of ['', 'v2']) {
    await t.test(agentMode || 'ei asetusta', async (t) => {
      const p = pipeline(t, { agentMode });
      await p.channel.processNext();
      assert.equal(p.sent.length, 1);
      assert.match(p.sent[0], /maito 20 l/); assert.doesNotMatch(p.sent[0], /voi/);
      await p.channel.processNext();
      assert.deepEqual(p.ids, ['m1', 'm2']);
      assert.deepEqual(p.read, ['20 l maitoa', 'ja 5 kg voita']);
      assert.equal(p.sent.length, 2);
      assert.match(p.sent[1], /voi 5 kg/);
      assert.deepEqual(p.lines(), [['maito', { value: 20, unit: 'L' }], ['voi', { value: 5, unit: 'KG' }]]);
    });
  }
});

test('v2-agentti saa uusinnan: hylätty vastaus ja kaikki viestit kulkevat sillan läpi agentille', async (t) => {
  const asked = [];
  const agent = { respond: async (args) => {
    asked.push({ messageId: args.messageId, incoming: args.incoming, discardedReply: args.discardedReply });
    const text = `Agentti ${asked.length}`;
    return { status: 'collecting', draftId: null, revision: null, text, messages: [text], requestCartLink: false };
  } };
  const p = pipeline(t, { agentMode: 'v2', agent });
  await p.channel.processNext();
  assert.deepEqual(p.ids, ['m1', 'm1:r1']);
  assert.deepEqual(asked.map((a) => a.messageId), ['m1', 'm1:r1']);
  assert.equal(asked[1].discardedReply, 'Agentti 1');
  assert.deepEqual(asked[1].incoming.map((m) => [m.text, m.round]), [['20 l maitoa', 0], ['ja 5 kg voita', 1]]);
  assert.deepEqual(p.sent, ['Agentti 2']);
  assert.deepEqual(p.read, []); // vanha tulkki ei lukenut mitään
  assert.equal(await p.channel.processNext(), false);
});
