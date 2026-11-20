// Apurin minä-persoona (persona.mjs): mallin ohjeisiin sama persoona, ja koodi varmistaa, että apuri kertoo olevansa
// digitaalinen tilausapuri, kun asiakas kysyy sitä tai tervehtii ensimmäistä kertaa. Ilman mallia, katalogia tai verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { ASKS_IF_BOT, PERSONA, withBotDisclosure, withFullIntro, withoutFiller, withPlainIntro } = await import('../server/whatsapp/persona.mjs');
const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { VOICE_SYSTEM } = await import('../server/whatsapp/voice.mjs');

const at = (hhmm) => Date.parse(`2026-11-18T${hhmm}:00+02:00`);

test('kysymys botista tunnistetaan, tilausviesti ei', () => {
  for (const q of ['Ootko botti vai ihminen?', 'Puhunko nyt oikean ihmisen kanssa?', 'oletko tekoäly', 'onks tää botti', 'ootsä oikee ihminen?',
    'kuka sä oot?', 'Are you a bot?', 'oot sä ihan oikeesti ihminen']) assert.ok(ASKS_IF_BOT.test(q), q);
  for (const q of ['onko maitoa perjantaiksi', 'oletko varma määrästä', 'onks kermaa laktoositonta', '20 l maitoa ja 5 kg voita', 'moi']) {
    assert.ok(!ASKS_IF_BOT.test(q), q);
  }
});

test('persoona on kaikissa ohjeissa eikä väitä apuria ihmiseksi', () => {
  assert.match(PERSONA, /minä-muodossa/);
  assert.match(PERSONA, /Et ole ihminen/);
  assert.ok(VOICE_SYSTEM.includes(PERSONA));
});

test('vastaus kertoo apurin olevan digitaalinen vain tarvittaessa', () => {
  const plain = ['Joo, katsotaan!'];
  assert.equal(withBotDisclosure({ userText: '20 l maitoa', messages: plain }), plain);
  // Malli kertoi jo: ei toisteta.
  const told = ['Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen. Tilataanko jotain?'];
  assert.equal(withBotDisclosure({ userText: 'ootko botti?', messages: told }), told);
  // Malli unohti: lyhyt esittely ensimmäiseen viestiin, rekisteri asiakkaan mukaan.
  assert.deepEqual(withBotDisclosure({ userText: 'ootko botti?', messages: ['Tilataanko jotain?', 'Vastaa 1 tai 2.'] }),
    ['Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen, mut autan mielelläni! Tilataanko jotain?', 'Vastaa 1 tai 2.']);
  assert.deepEqual(withBotDisclosure({ userText: 'Oletteko oikea ihminen?', messages: ['Autan tilauksessa.'] }),
    ['Olen Valio Aimon digitaalinen tilausapuri, en ihminen, mutta autan mielelläni! Autan tilauksessa.']);
  // Vanha esittely saa sanan digitaalinen, ettei esittely tule kahdesti.
  assert.deepEqual(withBotDisclosure({ userText: 'kuka sä oot?', messages: ['Olen Valio Aimon tilausapuri. Mitä tilattais?'] }),
    ['Olen Valio Aimon digitaalinen tilausapuri. Mitä tilattais?']);
  // Ensimmäinen tervehdys: esittely tervehdyksen perään, ilman "en ihminen" -lausetta.
  assert.deepEqual(withBotDisclosure({ userText: 'moro', messages: ['No moikka! Tilataanko jotain?'], greeting: 'No moikka!', introduce: true }),
    ['No moikka! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?']);
});

function dialogue(t, { plan = {}, voice = false, voiced = null } = {}) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const asked = [];
  const d = createOrderingDialogue({ db: store.db, now: () => at('10:30'), voice, ask: async ({ purpose, user, system }) => {
    asked.push({ purpose, system, user: JSON.parse(user) });
    if (purpose === 'whatsapp_voice') return { json: { segments: voiced(JSON.parse(user).segments) } };
    return { json: { route: 'chat', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...plan } };
  } });
  let n = 0;
  const say = (text) => d.respond({ binding: 'one', messageId: `p${++n}`, text, receivedAt: at('10:30'), getShoppingList: () => null,
    runOrder: async () => ({ status: 'collecting', text: 'Mitä tilattais?' }) });
  return { say, asked };
}

test('dialogi: ensimmäinen tervehdys esittäytyy, toinen ei', async (t) => {
  const { say, asked } = dialogue(t, { plan: { text: 'Tilataanko jotain?' } });
  const first = await say('moi');
  assert.equal(first.text, 'Päivää! Olen Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
  assert.match(asked[0].user.task, /esittäydy ensin/);
  assert.ok(asked[0].system.includes(PERSONA));
  const second = await say('moi');
  assert.doesNotMatch(second.text, /digitaalinen/);
  assert.doesNotMatch(asked[1].user.task, /esittäydy/);
});

test('dialogi: botti-kysymykseen rehellinen vastaus, vaikka malli unohtaisi sen', async (t) => {
  const { say } = dialogue(t, { plan: { text: 'Hehe, mä autan sua tilaamaan!' } });
  await say('moi');
  const reply = await say('ootko oikee ihminen?');
  assert.match(reply.text, /digitaalinen tilausapuri, en ihminen/);
  assert.match(reply.text, /Hehe, mä autan sua tilaamaan!/);
});

test('äänikerros ei saa pudottaa tietoa digitaalisesta apurista', async (t) => {
  const { say } = dialogue(t, { voice: true, plan: { text: 'Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen. Tilataanko jotain?' },
    voiced: (segments) => segments.map(() => 'Joo, mä oon ihan tavallinen tyyppi! Tilataanko jotain?') });
  await say('moi');
  const reply = await say('ootko botti?');
  assert.match(reply.text, /digitaalinen tilausapuri, en ihminen/);
  assert.doesNotMatch(reply.text, /tavallinen tyyppi/);
});

test('täytesana pois tekstin alusta, muu teksti ennallaan', () => {
  assert.equal(withoutFiller('Joo, mä oon Valio Aimon digitaalinen tilausapuri.'), 'Mä oon Valio Aimon digitaalinen tilausapuri.');
  assert.equal(withoutFiller('Okei! Tilataanko jotain?'), 'Tilataanko jotain?');
  assert.equal(withoutFiller('No niin, mitä tilattais?'), 'Mitä tilattais?');
  for (const t of ['Joonas tilaa?', 'Jos tarvitset, kerro.', 'Joo', 'Kerro, mitä tarvitaan.']) assert.equal(withoutFiller(t), t);
});

test('pelkkään tervehdykseen ei "Päivää! Joo, …", kysymykseen vastaava Joo jää', async (t) => {
  // Malli aloittaa jatkon sanalla Joo (kuten livenä 18.11. klo 11.37).
  const own = dialogue(t, { plan: { text: 'Joo, mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?' } });
  assert.equal((await own.say('moi')).text, 'Päivää! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
  // Äänikerros lisää Joon.
  const voiced = dialogue(t, { voice: true, plan: { text: 'Tilataanko jotain?' }, voiced: (segments) => segments.map((s) => `Joo, ${s.charAt(0).toLowerCase()}${s.slice(1)}`) });
  assert.equal((await voiced.say('moi')).text, 'Päivää! Olen Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
  // Tervehdys ja kysymys: Joo vastaa kysymykseen.
  const asked = dialogue(t, { voice: true, plan: { text: 'Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen. Tilataanko jotain?' },
    voiced: (segments) => segments.map(() => 'Joo, mä oon Valio Aimon digitaalinen tilausapuri, en ihminen. Tilataanko jotain?') });
  assert.match((await asked.say('moi, ootko botti?')).text, /! Joo, mä oon Valio Aimon digitaalinen tilausapuri/u);
});

test('esittelystä pois pyytämätön "en ihminen", kysymykseen se jää', () => {
  const intro = (userText, text) => withPlainIntro({ userText, messages: [text], introduce: true })[0];
  // Livenä 18.11. "moro"-tervehdykseen.
  assert.equal(intro('moro', 'No moikka! Mä olen Valio Aimon digitaalinen tilausapuri, eli botti, en ihminen. Autan sua tilaamaan.'),
    'No moikka! Mä olen Valio Aimon digitaalinen tilausapuri. Autan sua tilaamaan.');
  assert.equal(intro('moi', 'Päivää! Olen Valio Aimon digitaalinen tilausapuri, en ihminen, mutta autan mielelläni!'),
    'Päivää! Olen Valio Aimon digitaalinen tilausapuri ja autan mielelläni!');
  assert.equal(intro('moi', 'Mä oon digitaalinen tilausapuri enkä oikee ihminen. Tilataanko jotain?'), 'Mä oon digitaalinen tilausapuri. Tilataanko jotain?');
  // Malli 18.11. "morjens"-tervehdykseen.
  assert.equal(intro('morjens', 'Morjes! Mä oon Valio Aimon digitaalinen tilausapuri, eli botti, ja autan keittiöitä tilaamaan.'),
    'Morjes! Mä oon Valio Aimon digitaalinen tilausapuri ja autan keittiöitä tilaamaan.');
  assert.equal(intro('moi', 'Moi! Olen Valio Aimon digitaalinen tilausapuri, siis tekoäly. Tilataanko jotain?'), 'Moi! Olen Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
  assert.equal(intro('hi', "Hi! I'm Valio Aimo's digital ordering assistant, not a human, but happy to help."),
    "Hi! I'm Valio Aimo's digital ordering assistant and happy to help.");
  // Ennallaan: kysymys botista, muu kuin ensimmäinen tervehdys, ja esittely, jossa "en ihminen" on ainoa tieto.
  assert.match(intro('moi, ootko botti?', 'Päivää! Joo, mä oon Valio Aimon digitaalinen tilausapuri, en ihminen.'), /en ihminen/);
  const later = ['Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen.'];
  assert.equal(withPlainIntro({ userText: 'moi', messages: later, introduce: false }), later);
  assert.equal(intro('moi', 'Moi! Mä en oo ihminen. Tilataanko jotain?'), 'Moi! Mä en oo ihminen. Tilataanko jotain?');
  const plain = ['Päivää! Olen Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?'];
  assert.equal(withPlainIntro({ userText: 'moi', messages: plain, introduce: true }), plain);
});

test('dialogi: ensimmäisen tervehdyksen esittely ilman "en ihminen", myös äänikerroksen jälkeen', async (t) => {
  const own = dialogue(t, { plan: { text: 'Mä oon Valio Aimon digitaalinen tilausapuri, eli botti, en ihminen. Tilataanko jotain?' } });
  assert.match((await own.say('moro')).text, /^[^.]+! Mä oon Valio Aimon digitaalinen tilausapuri\. Tilataanko jotain\?$/u);
  // Mallin esittelyssä on "en ihminen": äänikerros saa tekstin jo ilman sitä, ja uudelleenkirjoitus kelpaa.
  const voiced = dialogue(t, { voice: true, plan: { text: 'Mä oon Valio Aimon digitaalinen tilausapuri, en ihminen, mut autan mielelläni. Tilataanko jotain?' },
    voiced: (segments) => segments.map((s) => s.replace('autan mielelläni', 'autan tosi mielelläni')) });
  const reply = await voiced.say('moro');
  assert.match(reply.text, /^[^.]+! Mä oon Valio Aimon digitaalinen tilausapuri ja autan tosi mielelläni\. Tilataanko jotain\?$/u);
  assert.equal(reply.voiced, true);
});

test('kaksi tervehdystä peräkkäin: koodin tervehdyksen perään ei jää toista', async (t) => {
  const own = dialogue(t, { plan: { text: 'Moi! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?' } });
  assert.equal((await own.say('moikka')).text, 'No moikka! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
  // Äänikerros toistaa tervehdyksen ja lisää toisen (livenä 18.11.: "No moikka! Moi! Mä oon …").
  const voiced = dialogue(t, { voice: true, plan: { text: 'Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?' },
    voiced: (segments) => segments.map((s) => `No moikka! Moi! ${s}`) });
  assert.equal((await voiced.say('moikka')).text, 'No moikka! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
});

test('esittely aina "Valio Aimon digitaalinen tilausapuri", ei "Mä oon Valio Aimo, tilausapuri"', () => {
  const fix = (text) => withFullIntro([text])[0];
  // WhatsAppissa 18.11. kesken keskustelun.
  assert.equal(fix('Iltaa! Mä oon Valio Aimo, tilausapuri. Tilataanko jotain?'), 'Iltaa! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?');
  assert.equal(fix('Olen Valio Aimo -tilausapuri.'), 'Olen Valio Aimon digitaalinen tilausapuri.');
  assert.equal(fix('Mä oon Valio Aimo, digitaalinen tilausapuri!'), 'Mä oon Valio Aimon digitaalinen tilausapuri!');
  assert.equal(fix('Moi, mä oon Valio Aimon tilausapuri ja autan sua.'), 'Moi, mä oon Valio Aimon digitaalinen tilausapuri ja autan sua.');
  assert.equal(fix('Oon Aimon apuri.'), 'Oon Valio Aimon digitaalinen tilausapuri.');
  assert.equal(fix('Mä oon Valio Aimo.'), 'Mä oon Valio Aimon digitaalinen tilausapuri.');
  assert.equal(fix('Minä olen Valio Aimo ja autan mielelläni.'), 'Minä olen Valio Aimon digitaalinen tilausapuri ja autan mielelläni.');
  assert.equal(fix("Hi! I'm Valio Aimo, the ordering assistant."), "Hi! I'm Valio Aimo's digital ordering assistant.");
  assert.equal(fix("I'm Valio Aimo."), "I'm Valio Aimo's digital ordering assistant.");
  // Oikea esittely ja muut maininnat pysyvät ennallaan (sama viite takaisin).
  for (const same of ['Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?', 'Tilaus menee Valio Aimon kautta.',
    'Valio Aimo toimittaa ma 23.11.', 'Olen Valio Aimon asiakkaana kiitollinen.']) {
    const list = [same];
    assert.equal(withFullIntro(list), list, same);
  }
});

test('dialogi: esittely korjataan myös kesken keskustelun ja äänikerroksen jälkeen', async (t) => {
  const own = dialogue(t, { plan: { text: 'Mä oon Valio Aimo, tilausapuri. Tilataanko jotain?' } });
  await own.say('moi');
  const later = await own.say('moi');
  assert.match(later.text, /^[^.]+! Mä oon Valio Aimon digitaalinen tilausapuri\. Tilataanko jotain\?$/u);
  assert.doesNotMatch(later.text, /Valio Aimo,/);
  // Ensimmäisessä tervehdyksessä esittely ei tuplaannu (withBotDisclosure näkee jo korjatun esittelyn).
  const first = dialogue(t, { plan: { text: 'Mä oon Valio Aimo, tilausapuri. Tilataanko jotain?' } });
  const intro = (await first.say('moro')).text;
  assert.equal(intro.match(/tilausapuri/g).length, 1, intro);
  assert.match(intro, /Mä oon Valio Aimon digitaalinen tilausapuri\./u);
  // Äänikerros kirjoittaa "Mä oon Valio Aimo, tilausapuri": korjataan, ja uudelleenkirjoitus kelpaa.
  const voiced = dialogue(t, { voice: true, plan: { text: 'Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?' },
    voiced: (segments) => segments.map((s) => s.replace('Valio Aimon digitaalinen tilausapuri', 'Valio Aimo, tilausapuri')) });
  const reply = await voiced.say('moro');
  assert.match(reply.text, /^[^.]+! Mä oon Valio Aimon digitaalinen tilausapuri\. Tilataanko jotain\?$/u);
  assert.equal(reply.voiced, true);
});

test('äänikerroksen ohje ei anna apurille nimeä Valio Aimo', () => {
  assert.doesNotMatch(VOICE_SYSTEM, /Nimi on Valio Aimo/);
  assert.match(VOICE_SYSTEM, /Valio Aimon digitaalinen tilausapuri/);
});

test('äänikerroksen "Joo, moi!" ei jätä toista tervehdystä koodin tervehdyksen perään', async (t) => {
  // Oikealla mallilla 19.11.: toiseen "moi"-viestiin äänikerros palautti "Joo, moi! Mitä tilataan tänään?" ja asiakas sai
  // "Iltaa! Moi! Mitä tilataan tänään?".
  const voiced = dialogue(t, { voice: true, plan: { text: 'Tilataanko jotain?' }, voiced: (segments) => segments.map(() => 'Joo, moi! Mitä tilataan tänään?') });
  await voiced.say('moi');
  const reply = await voiced.say('moi');
  assert.match(reply.text, /^[^\s!]+! Mitä tilataan tänään\?$/u);
  assert.equal(reply.voiced, true);
  // Toisessa järjestyksessä sama: "Moi! Joo, …".
  const other = dialogue(t, { voice: true, plan: { text: 'Tilataanko jotain?' }, voiced: (segments) => segments.map(() => 'Moi! Joo, mitä tilataan?') });
  await other.say('moi');
  assert.match((await other.say('moi')).text, /^[^\s!]+! Mitä tilataan\?$/u);
});
