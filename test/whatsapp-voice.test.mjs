// Äänikerros, viestien niputus ja toinen lukukerta (Eelis 17.11.: botti mukautuu lähettäjään eikä ole jäykkä).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockMessages, sentenceCase, voiceMessages } from '../server/whatsapp/voice.mjs';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createWhatsAppChannel, humanPartPause, gatherSettings } from '../server/whatsapp/channel.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { createModelInterpreter, worthRereading } from '../server/order-conversation/interpret.mjs';

const said = (segments) => async () => ({ json: { segments } });
const voice = (original, rewritten, extra = {}) => voiceMessages({ ask: said(rewritten), messages: original, userText: extra.userText || 'moi', terms: extra.terms || [], onReject: extra.onReject });

test('mallille menevät vain tekstinpätkät: listat, hinnat, vastaussanat ja asiakaspalvelu pysyvät koodilla', () => {
  const locked = lockMessages(['Okei, luonnoksessa nyt:\n- Maito 20 l\n- Voi 5 kg\n\nVastaa *ok*, niin saat linkin.', 'Kakkosvaihtoehdot:\n1) Valio maito 1 l, 20 kpl, 23,40 €\n2) Arla maito, 20 kpl, 21,00 €', 'Asiakaspalvelu: 010 123 4567']);
  assert.deepEqual(locked.segments, ['Okei, luonnoksessa nyt:', 'Vastaa [[T1]], niin saat linkin.', 'Kakkosvaihtoehdot:']);
  assert.deepEqual(locked.layout, ['{{S1}}\n[[L1]]\n\n{{S2}}', '{{S3}}\n[[L2]]', '[[L3]]']);
  assert.deepEqual(locked.tokens, ['*ok*']);
  assert.doesNotMatch(JSON.stringify(locked.segments), /€|20 kpl|010/);
  // Tervehdys ja pelkkä otsikko jäävät koodille.
  const greeted = lockMessages(['Iltaa! Mitä tarvitset?', '*Tilausluonnos*\nMaito 5 l, 12,34 €']);
  assert.equal(greeted.greeting, 'Iltaa!'); assert.deepEqual(greeted.segments, ['Mitä tarvitset?']);
  assert.deepEqual(lockMessages(['Iltaa!']).segments, []);
});

test('viesti ja virke alkavat aina isolla kirjaimella, vaikka malli peilaisi pienillä kirjoittavaa (Eelis 18.11.)', async () => {
  // Livekoe 18.11. klo 0.42: "mikä meno? Kerro vaan, mitä keittiöön tarvitaan." alkoi pienellä, seuraava viesti isolla.
  assert.deepEqual(await voice(['Kerro vaan, mitä keittiöön tarvitaan.'], ['mikä meno? kerro vaan, mitä keittiöön tarvitaan.']), ['Mikä meno? Kerro vaan, mitä keittiöön tarvitaan.']);
  assert.deepEqual(await voice(['Luonnoksessa nyt:\n- maito 20 l\n\nMille päivälle toimitus?'], ['okei, tällänen:', 'millo tarviit?\nja paljonko?']), ['Okei, tällänen:\n- maito 20 l\n\nMillo tarviit?\nJa paljonko?']);
  // Lyhenteen tai päiväyksen jälkeen ei ala uusi virke, eikä lista tai vastaussana muutu.
  assert.equal(sentenceCase('esim. maitoa, toimitus pe 20.11. aamulla. sit muuta'), 'Esim. maitoa, toimitus pe 20.11. aamulla. Sit muuta');
  assert.deepEqual(await voice(['Vastaa *ok*, niin saat linkin.\n- voi 5 kg'], ['[[T1]] riittää, niin tulee linkki.']), ['*ok* riittää, niin tulee linkki.\n- voi 5 kg']);
});

test('lihavoitu otsikko pysyy listansa yläpuolella eikä mallille jää sanaa, jonka eteen kirjoittaa "Vastaa"', async () => {
  // Livetarkistus 17.11.: *Maito 30 l:* oli pätkän sisällä sana, ja malli kirjoitti "Vastaa *Maito 30 l:*".
  const options = 'Perjantaiksi pe 20.11. toimitus, hinnat alv 0 %.\n*Maito 30 l:*\n1) Valio maito 1 l, 30 kpl, 35,10 €\n2) Arla maito 1,5 l, 20 kpl, 33,00 €\n3) Näytä lisää vaihtoehtoja';
  const locked = lockMessages([options]);
  assert.deepEqual(locked.segments, ['Perjantaiksi pe 20.11. toimitus, hinnat alv 0 %.']);
  assert.deepEqual(locked.tokens, []); assert.deepEqual(locked.layout, ['{{S1}}\n[[L1]]']);
  assert.deepEqual(await voice([options], ['perjantaiks 20.11. tulossa, hinnat alv 0 %. valitse näistä:'], { terms: ['maito'] }),
    ['Perjantaiks 20.11. tulossa, hinnat alv 0 %. Valitse näistä:\n*Maito 30 l:*\n1) Valio maito 1 l, 30 kpl, 35,10 €\n2) Arla maito 1,5 l, 20 kpl, 33,00 €\n3) Näytä lisää vaihtoehtoja']);
  // Yhteenvedon ja tuotetietojen otsikot kuuluvat samoin listaansa; vastaussana *TILAA* jää lauseeseen.
  const summary = lockMessages(['*Tilausluonnos*, toimitus ke 18.11.\n- Maito: 2 kpl, 2,40 €\nYhteensä 2,40 € (alv 0 %)\n\nVahvista vastaamalla *TILAA*.']);
  assert.deepEqual(summary.segments, ['Vahvista vastaamalla [[T1]].']); assert.deepEqual(summary.tokens, ['*TILAA*']);
  const facts = lockMessages(['Valion tuotetiedoista:\n*Valio kuohukerma* (tuotenro 123): Sisältää maitoa.\n- Allergeenit: maito']);
  assert.deepEqual(facts.segments, ['Valion tuotetiedoista:']);
});

test('Eeliksen pohjan vaihtoehtolista ja tilausluonnos pysyvät sanasta sanaan; edeltävä teksti saa äänen', () => {
  const draft = ['*Tilausluonnos*', 'Toimitus: ke 25.11.', 'Koekeittiö', '', '*Tuotteet*', '- Maito: 2 kpl, 2,40 €', '', 'Yhteensä: 2,40 € (alv 0 %)',
    'Tilaus pitää tehdä viimeistään ma 23.11. klo 12.00.', '', 'Vastaa *ok*, niin saat linkin ostoskoriin.', 'Tarkistat ja vahvistat tilauksen siellä.',
    'Voit vielä muuttaa, esim. "maito 3 kpl", "poista maito" tai "tyhjennä ostoskori".'].join('\n');
  const locked = lockMessages([draft]);
  assert.deepEqual(locked.segments, []); assert.deepEqual(locked.layout, ['[[L1]]']);
  const options = ['Ei tilattavaa tuotetta päivälle ke 25.11.: voi.', '', 'Toimitus: ke 25.11.', 'Hinnat alv 0 %', 'Lanttulaatikolle ei valitettavasti löytynyt osumaa.',
    'Tässä korvaajia (tarve 500 kg):', '1) Maksalaatikko, 186 kpl, 2 293,38 €', '2) Nakkilaatikko, 200 kpl, 2 542,00 €', 'Vastaa 1 tai 2.', 'Jos haluat muita vaihtoehtoja, vastaa 3.'].join('\n');
  const mixed = lockMessages([options]);
  assert.deepEqual(mixed.segments, ['Ei tilattavaa tuotetta päivälle ke 25.11.: voi.']);
  assert.equal(mixed.layout[0], '{{S1}}\n\n[[L1]]');
});

test('kankea pohja kirjoitetaan lähettäjän tyyliin ja lista palaa sanasta sanaan', async () => {
  const original = ['Luonnoksessa nyt:\n- maito 20 l\n- voi\n\nMille päivälle toimitus? Haen sen jälkeen sille päivälle toimitettavat vaihtoehdot.\nPaljonko tarvitset voita?'];
  let seen;
  const out = await voiceMessages({ ask: async ({ user, purpose, tier }) => { seen = { user: JSON.parse(user), purpose, tier };
    return { json: { segments: ['okei, luonnoksessa nyt tällänen:', 'millo tarviit ne, ja paljonko voita?'] } }; },
  messages: original, userText: 'tarviin 20l maitoo ja voita', terms: ['maito', 'voi'] });
  assert.deepEqual(out, ['Okei, luonnoksessa nyt tällänen:\n- maito 20 l\n- voi\n\nMillo tarviit ne, ja paljonko voita?']);
  assert.equal(seen.purpose, 'whatsapp_voice'); assert.equal(seen.tier, 'fast');
  assert.equal(seen.user.message, 'tarviin 20l maitoo ja voita');
  assert.doesNotMatch(JSON.stringify([seen.user.layout, seen.user.segments]), /maito 20 l/);
});

test('uusi teksti hylätään, jos se muuttaa luvun, väitteen, lupauksen, kysymyksen, kiellon, tuotteen tai vastaussanan', async () => {
  const reasons = [];
  const onReject = (r) => reasons.push(r);
  assert.equal(await voice(['Mille päivälle toimitus?'], ['huomiseks klo 8?'], { onReject }), null);
  assert.equal(await voice(['Mille päivälle toimitus?'], ['okei katotaan'], { onReject }), null);
  assert.equal(await voice(['Luonnos säilyy. Tilausta ei ole tehty.'], ['Tilaus on nyt tehty!'], { onReject }), null);
  assert.equal(await voice(['Tilausta ei ole tehty.'], ['Jatketaan tilausta.'], { onReject }), null);
  assert.equal(await voice(['Kerma: laktoositonta vai käykö tavallinen?\n1) laktoositon\n2) tavallinen käy'], ['laktoositonta vai tavallista?'], { onReject, terms: ['kerma'] }), null);
  assert.equal(await voice(['Vastaa *ok*, niin saat linkin.'], ['vastaa kyllä, niin saat linkin'], { onReject }), null);
  assert.equal(await voice(['Haen vaihtoehdot perjantaille.'], ['perjantaille onnistuu!'], { onReject }), null);
  assert.equal(await voice(['Mitä tarvitset?', 'Toinen kysymys?'], ['mitä laitetaan?'], { onReject }), null);
  assert.equal(await voice(['Mitä tarvitset?'], ['Katso www.esimerkki.fi, mitä tarvitset?'], { onReject }), null);
  assert.deepEqual(reasons, ['numbers', 'question', 'claims', 'negation', 'product-missing', 'tokens', 'promise', 'shape', 'claims']);
});

test('puuttuvan tuotteen syy säilyy, eikä ohjeeseen lisätä tuotetta (livekoe 17.11.)', async () => {
  const reasons = [];
  const onReject = (r) => reasons.push(r);
  const dropped = 'Hups, banaaneille minulla ei ole nyt hintaa eikä saatavuutta. Tietojani on supistettu: Valion testirajapinta suljettiin, joten minulla on oikea hinta ja saatavuus enää noin 900 tuotteelle 17 500:sta. En löytänyt korvaajaa, joten poistin rivin listalta.';
  assert.equal(await voice([dropped], ['Ei hätää, banaaneja ei nyt löydy meiltä. Tietokantaani on supistettu, joten hinta ja saatavuus ovat käytössä vain noin 900 tuotteelle. Poistin ne listalta.'], { onReject, terms: ['banaani'] }), null);
  assert.equal(await voice(['*Sipuli 3 kg:*\n1) Sipuli 1 kg pussi, 3 kpl, 2,58 €\nVastaa 1, 2, 3 tai 4.'], ['Vastaa tähän 1, 2, 3 tai 4, niin mennään sipuliin.'], { onReject, terms: ['peruna', 'sipuli'] }), null);
  assert.equal(await voice([dropped], ['hups, banaaneja ei nyt löydy meiltä. Valion testirajapinta on suljettu, joten tietoni ovat supistuneet noin 900 tuotteeseen 17 500:sta. En löytänyt korvaajaa, joten poistin rivin listalta.'], { onReject, terms: ['banaani'] }), null);
  assert.deepEqual(reasons, ['reason', 'product-added', 'reason']);
  // Syy saa taivuttaa ja tyyli muuttua, kun testirajapinta mainitaan.
  assert.deepEqual(await voice([dropped], ['Hups, banaaneille mulla ei nyt ole hintaa eikä saatavuutta. Tietoja on supistettu, koska Valion testirajapinta suljettiin, ja jäljellä on noin 900 tuotetta 17 500:sta. En löytänyt korvaajaa, joten poistin rivin listalta.'], { terms: ['banaani'] }),
    ['Hups, banaaneille mulla ei nyt ole hintaa eikä saatavuutta. Tietoja on supistettu, koska Valion testirajapinta suljettiin, ja jäljellä on noin 900 tuotetta 17 500:sta. En löytänyt korvaajaa, joten poistin rivin listalta.']);
  // Lyhyt tuotesana ("voi") ei hylkää verbiä "voit".
  assert.deepEqual(await voice(['Vastaa 1, 2 tai 3.'], ['voit vastata 1, 2 tai 3.'], { terms: ['voi'] }), ['Voit vastata 1, 2 tai 3.']);
});

test('valinnan kuittaukseen ei tule uutta kieltoa eikä pyyntöä valita uudelleen (livekoe 18.11.)', async () => {
  const reasons = [];
  const onReject = (r) => reasons.push(r);
  const picked = ['Selvä, valitaan Porkkana pesty 1 kg PSS suomi.'];
  const opts = { onReject, userText: '2', terms: ['porkkana'] };
  assert.equal(await voice(picked, ['Joo, porkkanalaatikkoa ei nyt löydy tilattavana, mutta sopiva tilalle on porkkana. Kerro, mikä vaihtoehto sulle käy, niin mä jatkan.'], opts), null);
  assert.equal(await voice(picked, ['Okei, otetaan Porkkana pesty 1 kg PSS suomi. Kerro, jos haluat muuttaa.'], opts), null);
  assert.equal(await voice(picked, ['Selvä, Porkkana pesty 1 kg PSS suomi ei käy, otetaan toinen.'], opts), null);
  assert.deepEqual(reasons, ['instruction', 'instruction', 'negation-added']);
  // Kuittaus omin sanoin kelpaa, ja kysymyksen saa yhä muotoilla pyynnöksi.
  assert.deepEqual(await voice(picked, ['Okei, otetaan Porkkana pesty 1 kg PSS suomi.'], { userText: '2', terms: ['porkkana'] }), ['Okei, otetaan Porkkana pesty 1 kg PSS suomi.']);
  assert.deepEqual(await voice(['Paljonko voita?'], ['Kerro vielä, paljonko voita laitetaan?'], { terms: ['voi'] }), ['Kerro vielä, paljonko voita laitetaan?']);
});

test('sallittu uudelleenkirjoitus säilyttää tuotteen ja kiellon, ja tervehdys tulee aina koodista', async () => {
  assert.deepEqual(await voice(['Kerma: laktoositonta vai käykö tavallinen?\n1) laktoositon\n2) tavallinen käy'], ['kerma, otetaanko laktoositonta vai käykö tavallinen?'], { terms: ['kerma'] }),
    ['Kerma, otetaanko laktoositonta vai käykö tavallinen?\n1) laktoositon\n2) tavallinen käy']);
  assert.deepEqual(await voice(['Luonnos säilyy. Tilausta ei ole tehty.'], ['lista on tallessa, eikä mitään oo vielä tehty.']), ['Lista on tallessa, eikä mitään oo vielä tehty.']);
  // Mallin "Huomenta!" illalla vaihtuu koodin tervehdykseen, ja kesken keskustelun malli ei tervehdi.
  assert.deepEqual(await voice(['Iltaa! Mitä tarvitset?'], ['Huomenta! mitä laitetaan?']), ['Iltaa! Mitä laitetaan?']);
  assert.deepEqual(await voice(['Mitä tarvitset?'], ['Moi! mitä laitetaan?']), ['Mitä laitetaan?']);
  assert.deepEqual(await voice(['Toimitus ke 18.11. Mitä muuta?'], ['keskiviikoksi 18.11., mitä muuta?']), ['Keskiviikoksi 18.11., mitä muuta?']);
  assert.deepEqual(await voice(['Vastaa *ok*, niin saat linkin.'], ['laita [[T1]] niin tulee linkki']), ['Laita *ok* niin tulee linkki']);
});

test('linkkiviestiä tai pelkkää tervehdystä ei kirjoiteta uudelleen, ja mallin virhe pitää alkuperäisen tekstin', async () => {
  let calls = 0;
  const count = async () => { calls++; return { json: { segments: ['x'] } }; };
  assert.equal(await voiceMessages({ ask: count, messages: ['Tässä linkki:\nhttps://example.com/whatsapp/cart#a.b'], userText: 'ok' }), null);
  assert.equal(await voiceMessages({ ask: count, messages: ['Iltaa!'], userText: 'moi' }), null);
  assert.equal(calls, 0);
  const reasons = [];
  assert.equal(await voiceMessages({ ask: async () => { throw new Error('timeout'); }, messages: ['Mitä tarvitset?'], userText: 'moi', onReject: (r) => reasons.push(r) }), null);
  assert.deepEqual(reasons, ['model']);
});

test('dialogi lähettää äänikerroksen viestit ja tallentaa ne historiaan, hinnat ja TILAA ennallaan', async (t) => {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const ready = { status: 'ready', draftId: 'draft-1', revision: 2, text: '- Maito 5 l, 12,34 €\n\nVahvista vastaamalla *TILAA*.' };
  let voiceInput;
  const ask = async ({ purpose, user }) => {
    if (purpose === 'whatsapp_dialogue') return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false } };
    if (purpose === 'whatsapp_voice') { voiceInput = JSON.parse(user); return { json: { segments: ['jos näyttää hyvältä, laita [[T1]] niin mennään'] } }; }
    return { json: {} };
  };
  const dialogue = createOrderingDialogue({ db: store.db, ask, voice: true, timeOf: () => Date.parse('2026-11-15T02:30:00+02:00') });
  const out = await dialogue.respond({ binding: 'one', messageId: 'm1', text: 'maitoo 5l', runOrder: async () => ready });
  assert.deepEqual(out.messages, ['- Maito 5 l, 12,34 €\n\nJos näyttää hyvältä, laita *TILAA* niin mennään']);
  assert.equal(out.voiced, true);
  assert.doesNotMatch(JSON.stringify([voiceInput.layout, voiceInput.segments]), /12,34|TILAA/);
  const saved = JSON.parse(store.db.prepare('SELECT json FROM wa_dialogue WHERE binding=?').get('one').json);
  assert.match(saved.history.at(-1).text, /laita \*TILAA\* niin mennään/);
  // Ilman voice-asetusta vanha teksti sellaisenaan.
  const plain = createOrderingDialogue({ db: store.db, ask, timeOf: () => Date.parse('2026-11-15T02:30:00+02:00') });
  const again = await plain.respond({ binding: 'one', messageId: 'm2', text: 'maitoo 5l', runOrder: async () => ready });
  assert.equal(again.text, ready.text);
});

const PHONE = '358401234567';
// Kanavan asetukset äänikerroksen kokeisiin: Metaa ei kutsuta, joten arvot ovat vain muodollisesti kelvollisia.
const settings = {
  phoneId: '60001', apiVersion: 'v23.0', supportContact: 'https://example.com/tuki',
  appSecret: 'voice-app-secret', verifyToken: 'voice-verify', accessToken: 'voice-access',
};
function channelFixture(t, options = {}) {
  let time = Date.parse('2026-11-17T12:00:00Z');
  const now = () => time;
  const store = openWhatsAppStore(':memory:', now); t.after(() => store.close());
  const sent = []; const calls = []; const pauses = [];
  let n = 0;
  const enqueue = (text, extra = {}) => store.enqueue({ id: `message-${++n}`, phone: PHONE, text, sentAt: now(), ...extra });
  const channel = createWhatsAppChannel({ settings, store, now, gatherMs: 3000, maxGatherMs: 10_000,
    pause: async (ms) => { pauses.push(ms); time += ms; options.onPause?.({ enqueue, pauses }); },
    chat: async (args) => { calls.push(args.messages.at(-1).content); return { text: 'Selvä!' }; },
    send: async (to, text) => { sent.push(text); return `out-${sent.length}`; } });
  return { store, channel, calls, sent, pauses, enqueue, advance: (ms) => { time += ms; },
    async pair() { const { code } = store.invite(PHONE, 'Ravintola A', 'Anna'); enqueue(`YHDISTA ${code}`); await channel.processNext(); sent.length = 0; } };
}

test('lähekkäin tulleet viestit niputetaan yhdeksi vuoroksi ja yhdeksi vastaukseksi', async (t) => {
  const f = channelFixture(t); await f.pair();
  f.enqueue('20l maitoa'); f.advance(800); f.enqueue('ja voita'); f.advance(900); f.enqueue('maanantaiks');
  await f.channel.processNext();
  assert.deepEqual(f.calls, ['20l maitoa\nja voita\nmaanantaiks']);
  assert.deepEqual(f.sent, ['Selvä!']);
  const states = f.store.db.prepare("SELECT id, state FROM inbox WHERE kind='text' ORDER BY rowid").all().map((r) => r.state);
  assert.deepEqual(states, ['done', 'merged', 'merged']);
  assert.equal(await f.channel.processNext(), false);
  // Historiassa on koko niputettu viesti.
  assert.equal(f.store.history(f.store.member(PHONE).binding).at(-2).content, '20l maitoa\nja voita\nmaanantaiks');
});

test('odotuksen aikana tullut viesti pidentää ikkunaa, kuva katkaisee niputuksen', async (t) => {
  let added = false;
  const f = channelFixture(t, { onPause: ({ enqueue }) => { if (!added) { added = true; enqueue('ja 5 kg voita'); } } });
  await f.pair();
  f.enqueue('30 l maitoa');
  await f.channel.processNext();
  assert.deepEqual(f.calls, ['30 l maitoa\nja 5 kg voita']);
  assert.equal(f.pauses.length, 2);
  f.calls.length = 0;
  f.enqueue('kermaa'); f.enqueue('', { kind: 'image', mediaId: 'img-1' }); f.enqueue('kiitos');
  await f.channel.processNext();
  assert.deepEqual(f.calls, ['kermaa']);
});

test('tuotannon rytmi: oletuksena 6 s niputus (enintään 20 s), pidempi osa saa pidemmän tauon', () => {
  // Eelis 19.11.: kaksi viestiä 6 s välein saivat kaksi vastausta 3 s niputuksella (test/whatsapp-gather.test.mjs).
  assert.deepEqual(gatherSettings({}), { gatherMs: 6000, maxGatherMs: 20_000 });
  assert.deepEqual(gatherSettings({ WHATSAPP_GATHER_MS: '0' }), { gatherMs: 0, maxGatherMs: 20_000 });
  assert.deepEqual(gatherSettings({ WHATSAPP_GATHER_MS: '3000', WHATSAPP_GATHER_MAX_MS: '10000' }), { gatherMs: 3000, maxGatherMs: 10_000 });
  assert.ok(humanPartPause('ok') < humanPartPause('x'.repeat(120)));
  assert.equal(humanPartPause('x'.repeat(5000)), 2500);
});

test('tyhjä tulkinta luetaan toiseen kertaan ennen kuin viesti jää ymmärtämättä', async () => {
  const purposes = [];
  const op = { op: 'add', ref: '', productTerm: 'maito', quantityValue: 20, quantityUnit: 'L', quantityBasis: '', addClaims: [], removeClaims: [], excludeAllergens: [], option: 0 };
  const ask = async ({ purpose, user }) => { purposes.push(purpose);
    return { json: purpose === 'whatsapp_order_reread' ? (assert.match(user, /Lue viesti uudelleen/), { intent: 'order', deliveryDate: '', ops: [op] }) : { intent: 'other', deliveryDate: '', ops: [] } }; };
  const draft = { deliveryDate: null, lines: [], offered: {}, pending: null };
  const fallback = async () => { throw new Error('ei sääntöjä'); };
  const interpret = createModelInterpreter({ ask, fallback, reread: true });
  const r = await interpret({ text: '🥛 20 pliis', draft, today: '2026-11-17', now: Date.parse('2026-11-17T10:00:00Z') });
  assert.deepEqual(purposes, ['whatsapp_order_turn', 'whatsapp_order_reread']);
  assert.equal(r.ops[0].op, 'add'); assert.deepEqual(r.ops[0].quantity, { value: 20, unit: 'L' });
  // Kiitos tai tervehdys ei tarvitse toista kertaa, eikä vanha tulkki (reread pois) tee sitä.
  purposes.length = 0;
  await interpret({ text: 'kiitos!', draft, today: '2026-11-17', now: Date.parse('2026-11-17T10:00:00Z') });
  await createModelInterpreter({ ask, fallback })({ text: '🥛 20 pliis', draft, today: '2026-11-17', now: Date.parse('2026-11-17T10:00:00Z') });
  assert.deepEqual(purposes, ['whatsapp_order_turn', 'whatsapp_order_turn']);
  assert.equal(worthRereading('ok'), false); assert.equal(worthRereading('🥛🥛'), true);
});
