// Selfplay-100:n laajennetun pilotin löydökset (15.11.2026): peruminen ei tyhjentänyt koria (X016), tilausaikaa ei kerrottu
// kysyttäessä (X056, X061, X064) ja apuri väitti, ettei sillä ole yhteystietoja (X084, X088). Ei mallia, katalogia tai verkkoa.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { createOrderingConversation, CANCEL_ALL, DEADLINE_QUESTION } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createOrderingDialogue, createConfiguredDialogue } = await import('../server/whatsapp/dialogue.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');

const at = (hhmm, day = '2026-11-15') => Date.parse(`${day}T${hhmm}:00+02:00`);
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const milk = (date) => ({ intent: 'order', ...(date ? { deliveryDate: date } : {}), ops: [{ op: 'add', productTerm: 'maito', quantity: { value: 20, unit: 'L' }, claims: [], excludeAllergens: [] }] });

// Kello kiinnitetään ennen aikaisinta tilausaikarajaa (10.00), jotta testi ei riipu seinäkellosta.
function core(script, hhmm = '09:00') {
  const t = at(hhmm); let n = 0; const calls = { suggest: 0 };
  const tools = {
    suggest: async ({ draft }) => { calls.suggest += 1; const l = draft.lines[0]; return { issues: [], lines: [{ ref: l.ref, total: 2, more: false, clarify: [], exact: true,
      options: [1, 2].map((i) => ({ productId: `m-${i}`, name: `maito ${i}`, salesUnits: 4, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 * i, labels: [],
        cutoff: `2026-11-15T${i === 1 ? '12' : '10'}:00:00` })) }] }; },
    quote: async ({ draft }) => ({ quoteId: 'Q1', draftId: draft.id, revision: draft.revision, expiresAt: new Date(t + 900_000).toISOString(), issues: [], totals: { net: 10 },
      lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 4, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10, cutoffLabel: 'su 15.11. klo 10.00' })) }),
    submit: async () => ({ status: 'confirmed', orderId: 'AGW-1', reasons: [] }),
  };
  const store = openDraftStore(':memory:', () => t);
  const handleTurn = createOrderingConversation({ store, tools, now: () => t, interpretTurn: async ({ text, draft }) => {
    const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] };
  } });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'c', customer, text, receivedAt: t });
  return { say, store, calls };
}

test('kaikkien rivien poisto ja vapaa peruminen tyhjentävät koko luonnoksen, ja vastaus vastaa tilaa', async () => {
  // X016: malli poisti rivit, mutta tyhjää luonnosta ei tallennettu ja vanha maito jäi kantaan.
  const removed = core({ '20 l maitoa tiistaiks': milk('2026-11-17'), 'poista kaikki': (d) => ({ intent: 'order', ops: d.lines.map((l) => ({ op: 'remove', ref: l.ref })) }), näytä: { intent: 'show', ops: [] } });
  await removed.say('20 l maitoa tiistaiks');
  assert.match((await removed.say('poista kaikki')).text, /^Luonnos on tyhjä/);
  assert.equal(removed.store.active('c'), null);
  const shown = (await removed.say('näytä')).text;
  assert.match(shown, /^(?:Luonnos on tyhjä|Olen Valio Aimon)/); assert.doesNotMatch(shown, /- maito 20 l/);
  const cancelled = core({ '20 l maitoa tiistaiks': milk('2026-11-17') });
  await cancelled.say('20 l maitoa tiistaiks');
  assert.equal((await cancelled.say('unohda koko homma, ei tilata mitään')).text, 'Luonnos tyhjennetty. Tilausta ei tehty.');
  assert.equal(cancelled.store.active('c'), null);
  for (const text of ['unohda koko homma, ei tilata mitään', 'ei tilata mitään', 'ok, unohda koko juttu', 'peru koko tilaus', 'en tilaa sittenkään mitään', 'ei, unohda kaikki']) assert.ok(CANCEL_ALL.test(text), text);
  for (const text of ['älä unohda maitoa', 'ei tilata mitään muuta', 'unohda maito', 'ei tarvi laktoositonta', 'peru se viimeisin']) assert.ok(!CANCEL_ALL.test(text), text);
});

test('tilausaikaa kysyttäessä kerrotaan aikaisin raja työkalujen tiedoista, ei arvausta', async () => {
  for (const text of ['no harmi. otetaan sit ma 16.11. mihin asti ehtii tilaa et tulee maanantaina?', 'mihin mennessä pitää tilata et tiistaiks ehtii?',
    'mihin mennessä tilaus pitää olla sisässä et ehtii maanantaille?', 'ehtiikö vielä tilata?', 'mikä on takaraja?']) assert.ok(DEADLINE_QUESTION.test(text), text);
  for (const text of ['toimitus viimeistään tiistaina', '50 kananmunaa', 'mihin asti maito säilyy?']) assert.ok(!DEADLINE_QUESTION.test(text), text);
  const q = 'mihin mennessä pitää tilata et huomiseks ehtii?';
  const { say, calls } = core({ '20 l maitoa': milk(null), [q]: { intent: 'order', deliveryDate: '2026-11-16', ops: [] }, 'mikä on takaraja?': { intent: 'other', ops: [] } });
  const noDate = await say('mikä on takaraja?');
  assert.match(noDate.text, /^Tilausaikaraja riippuu tuotteista ja toimituspäivästä\./);
  await say('20 l maitoa');
  const asked = await say(q);
  assert.equal(asked.status, 'choosing');
  assert.match(asked.text, /^Huomiselle \(ma 16\.11\.\) ehtii tilata su 15\.11\. klo 10\.00 asti\.\nToimitus: ma 16\.11\./); // aikaisin näytetyistä
  assert.equal(calls.suggest, 1); // näytetyt vaihtoehdot riittävät, ei toista hakua
});

test('mennyttä tilausaikarajaa ei luvata: kerrotaan aikaisin voimassa oleva raja tai että kaikki ovat umpeutuneet', async () => {
  const q = 'mihin mennessä pitää tilata et huomiseks ehtii?';
  const script = { '20 l maitoa': milk(null), [q]: { intent: 'order', deliveryDate: '2026-11-16', ops: [] } };
  const later = core(script, '11:00'); // 10.00-raja mennyt, 12.00 voimassa
  await later.say('20 l maitoa');
  const one = (await later.say(q)).text;
  assert.match(one, /^Huomiselle \(ma 16\.11\.\) ehtii tilata su 15\.11\. klo 12\.00 asti\./);
  assert.doesNotMatch(one, /klo 10\.00 asti/);
  const late = core(script, '13:00'); // molemmat rajat menneet
  await late.say('20 l maitoa');
  const none = (await late.say(q)).text;
  assert.match(none, /^Huomiselle \(ma 16\.11\.\) tilausaika on jo umpeutunut \(su 15\.11\. klo 12\.00\)\./);
  assert.doesNotMatch(none, /ehtii tilata/);
});

function dialogueFixture(t, plan, { supportContact } = {}) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const asked = []; const ordered = [];
  const dialogue = createOrderingDialogue({ db: store.db, supportContact, now: () => at('14:00'), ask: async ({ user }) => {
    asked.push(JSON.parse(user)); return { json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...plan } };
  } });
  let n = 0;
  const say = (text) => dialogue.respond({ binding: 'one', messageId: `d${++n}`, text, receivedAt: at('14:00'),
    runOrder: async (input) => { ordered.push(input); return { status: 'collecting', draftId: 'd1', revision: 2, text: 'Huomiselle (ma 16.11.) ehtii tilata su 15.11. klo 12.00 asti.\nToimitus ma 16.11.' }; } });
  return { say, asked, ordered };
}

test('dialogi ei vastaa tilausaikaan itse eikä väitä ettei näe sitä, ja vapaa peruminen tyhjentää listan', async (t) => {
  const f = dialogueFixture(t, { route: 'chat', text: 'Tarkkaa tilausaikarajaa en valitettavasti näe, joten en halua arvata.' });
  const r = await f.say('mihin mennessä pitää tilata?');
  assert.deepEqual(f.ordered, ['mihin mennessä pitää tilata?']); // tilausmoottori vastaa
  assert.doesNotMatch(r.text, /en valitettavasti näe|en halua arvata/);
  assert.match(r.text, /ehtii tilata su 15\.11\. klo 12\.00 asti/);
  const c = dialogueFixture(t, {});
  const cleared = await c.say('unohda koko homma, ei tilata mitään');
  assert.equal(cleared.text, 'Selvä, tyhjensin ostoslistan, eikä mitään tilattu. Kirjoita, kun tarvitset jotain.');
  assert.deepEqual(c.ordered, ['aloita alusta']);
  assert.equal(c.asked.length, 0);
});

test('tukiyhteystieto liitetään koodissa ihmisen, valituksen ja laskun pyyntöihin, eikä puuttumista väitetä', async (t) => {
  const plan = { route: 'chat', text: 'Ymmärrän! Mulla ei valitettavasti ole täällä varmoja yhteystietoja. Ota yhteyttä Valion asiakaspalveluun.' };
  for (const text of ['Haluan puhua ihmisen kanssa.', 'Viime toimituksessa puolet kananmunista oli rikki. Mitä nyt?', 'laskussa on virhe, kenelle soitan?']) {
    const f = dialogueFixture(t, plan, { supportContact: 'Testin ylläpito' });
    const r = await f.say(text);
    assert.equal(r.messages.at(-1), 'Asiakaspalvelu: Testin ylläpito', text);
    assert.doesNotMatch(r.text, /ei valitettavasti ole täällä varmoja yhteystietoja/);
    assert.equal(f.asked[0].capabilities.supportContact, true);
  }
  const plain = dialogueFixture(t, { route: 'chat', text: 'Ota yhteyttä asiakaspalveluun.' });
  assert.doesNotMatch((await plain.say('Haluan puhua ihmisen kanssa.')).text, /Asiakaspalvelu:/); // ei yhteystietoa ilman asetusta
  const order = dialogueFixture(t, {}, { supportContact: 'Testin ylläpito' });
  assert.doesNotMatch((await order.say('20 l maitoa huomiseks')).text, /Asiakaspalvelu:/); // tavallinen tilaus ilman lisäriviä
  // Sama asetus kuin kanavan tuki-komennossa.
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  process.env.WHATSAPP_SUPPORT_CONTACT = 'Ympäristön tuki';
  const configured = await createConfiguredDialogue(store, {});
  const r = await configured.respond({ binding: 'one', messageId: 'c1', text: 'haluan ihmisen', runOrder: async () => ({ status: 'collecting', text: 'Luonnos on tyhjä.' }) });
  assert.equal(r.messages.at(-1), 'Asiakaspalvelu: Ympäristön tuki');
  const explicit = await createConfiguredDialogue(store, { supportContact: 'Kanavan tuki' });
  assert.equal((await explicit.respond({ binding: 'one', messageId: 'c2', text: 'haluan ihmisen', runOrder: async () => ({ status: 'collecting', text: 'Luonnos on tyhjä.' }) })).messages.at(-1), 'Asiakaspalvelu: Kanavan tuki');
  delete process.env.WHATSAPP_SUPPORT_CONTACT;
});

test('yhteystieto annetaan jatkokysymykseen mutta ei toisteta kiitosviestiin', async (t) => {
  const f = dialogueFixture(t, { route: 'chat', text: 'Selvä, ohjaan asiakaspalveluun.' }, { supportContact: 'Testin ylläpito' });
  assert.equal((await f.say('Haluan puhua ihmisen kanssa.')).messages.at(-1), 'Asiakaspalvelu: Testin ylläpito');
  assert.equal((await f.say('Ok, mut miten sinne pääsee? Onks numero tai chat?')).messages.at(-1), 'Asiakaspalvelu: Testin ylläpito');
  assert.doesNotMatch((await f.say('Okei, laitan asiakaspalveluun viestiä aamulla. Kiitti, moi!')).text, /Asiakaspalvelu: Testin ylläpito/);
});
