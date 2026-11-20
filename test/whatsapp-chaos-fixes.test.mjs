// WhatsApp-koe 17.11.2026 (docs/parallel/whatsapp-chaos-2026-11-17.md): umpikujat ja robottimaiset fraasit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWhatsAppStore } from '../server/whatsapp/store.mjs';
import { createOrderingDialogue } from '../server/whatsapp/dialogue.mjs';
import { announcedChoice, hasMore, optionsPrompt, unchangedReply, withoutActionClaims, UNCHANGED_FALLBACK } from '../server/whatsapp/unchanged-reply.mjs';
import { CHOOSE_TRANSITIONS, selectionAcknowledgement } from '../server/whatsapp/cart-presentation.mjs';
import { createRuleInterpreter } from '../server/order-conversation/interpret.mjs';
import { understand } from '../server/aimo/understand.mjs';

const OPTIONS = ['Toimitus: to 19.11.', 'Hinnat alv 0 %', '*Kerma 8 l:*', '1) Valio ruokakerma 15 % 1 l UHT laktoositon, 8 kpl, yhteensä 8 l, 21,04 €',
  '2) Valio kevytkerma 1 l UHT laktoositon, 8 kpl, yhteensä 8 l, 23,76 €', '3) Arla Pro Ruokakerma 10% 1 L UHT laktoositon, 8 kpl, yhteensä 8 l, 26,48 €',
  'Vastaa 1, 2 tai 3.', 'Jos haluat muita vaihtoehtoja, vastaa 4.'].join('\n');
const PROMPT = 'Vastaa 1, 2 tai 3.\nJos haluat muita vaihtoehtoja, vastaa 4.';
const choosing = { status: 'choosing', draftId: 'd1', revision: 5, text: OPTIONS };
const list = { id: 'd1', revision: 5, status: 'needs_product_selection', deliveryDate: '2026-11-19', lines: [{ ref: 'L1', productTerm: 'kerma', quantity: { value: 8, unit: 'L' } }] };

function fixture(t, ask) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  store.db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('358401234567', 'Testikeittiö', 'Testaaja', 'one');
  const dialogue = createOrderingDialogue({ db: store.db, ask, timeOf: () => Date.parse('2026-11-17T20:30:00+02:00') });
  const ordered = []; let current = list; let seq = 0;
  const turn = (text, runOrder) => dialogue.respond({ binding: 'one', messageId: `m${++seq}`, text, getShoppingList: () => current,
    runOrder: async (input, options) => { ordered.push(input); const r = await runOrder(input, options); if (r.list) current = r.list; return r.result || r; } });
  return { turn, ordered };
}
const plan = (extra = {}) => ({ json: { route: 'order', text: '', lookupQuery: '', suggestionTerm: '', openCart: false, ...extra } });

test('kysymys tai valitus ei toista samaa vaihtoehtolistaa: vastaus viestiin ja lyhyt ohje', async (t) => {
  const seen = [];
  const f = fixture(t, async ({ purpose, user }) => {
    seen.push(purpose);
    if (purpose === 'whatsapp_unchanged_reply') {
      assert.match(JSON.parse(user).options, /Valio kevytkerma/);
      return { json: { text: 'Äh, nää kaikki on laktoosittomia. Kirjoita 4, niin katsotaan lisää.' } };
    }
    return plan();
  });
  await f.turn('8 l kermaa torstaiks', async () => choosing);
  for (const complaint of ['mulle sanoin et EI laktoositonta. tavallista kuohukermaa', 'haloo?? laktoosillinen kerma kiitos. ei kelpaa noi']) {
    const r = await f.turn(complaint, async () => choosing);
    assert.deepEqual(r.messages, ['Äh, nää kaikki on laktoosittomia. Kirjoita 4, niin katsotaan lisää.', PROMPT], complaint);
    assert.doesNotMatch(r.text, /Valio kevytkerma/);
  }
  assert.ok(seen.includes('whatsapp_unchanged_reply'));
  // Pyyntö näyttää lista uudelleen saa listan, ei vastausta sen sijaan.
  const relist = await f.turn('näytä', async () => choosing);
  assert.match(relist.text, /Valio kevytkerma/);
});

test('mallin oma vastaus kelpaa sellaisenaan, eikä listaa liitetä perään', async (t) => {
  const f = fixture(t, async ({ purpose }) => {
    assert.notEqual(purpose, 'whatsapp_unchanged_reply');
    return plan({ text: 'Joo, tuo näyttää oudolta. Vastaa 1, jos käy, tai 4, niin näytän lisää.' });
  });
  await f.turn('8 l kermaa torstaiks', async () => choosing);
  const r = await f.turn('hetkinen miks kakkonen on noin kallis??', async () => choosing);
  assert.deepEqual(r.messages, ['Joo, tuo näyttää oudolta. Vastaa 1, jos käy, tai 4, niin näytän lisää.', PROMPT]);
});

test('mallin ilmoittama valinta myös tehdään ("Valitsen vaihtoehdon 3"), ei samaa listaa perään', async (t) => {
  const f = fixture(t, async () => plan({ text: 'Joo, otetaan rasvaton. Valitsen vaihtoehdon 3.' }));
  await f.turn('8 l kermaa torstaiks', async () => choosing);
  const picked = { status: 'ready', draftId: 'd1', revision: 6, text: '*Tilausluonnos*, toimitus to 19.11.\n1. Arla Pro Ruokakerma 10% 1 L UHT laktoositon, 8 kpl' };
  const r = await f.turn('otan sen joka on terveellisin. sä päätät', async (input) => (input === '3'
    ? { result: picked, list: { ...list, revision: 6, status: 'review' } } : choosing));
  assert.deepEqual(f.ordered.slice(-2), ['otan sen joka on terveellisin. sä päätät', '3']);
  assert.match(r.text, /^Joo, otetaan rasvaton\. Valitsen vaihtoehdon 3\./);
  assert.match(r.text, /Tilausluonnos/);
});

test('apufunktiot: valinnan tunnistus, ohjerivi ja toimintaväitteiden hylkäys', async () => {
  assert.equal(announcedChoice('Joo, rasvaton on terveellisin. Valitsen vaihtoehdon 3, rasvattoman Eila 1 l.'), 3);
  assert.equal(announcedChoice('Valitaan nyt vaihtoehto 2.'), 2);
  assert.equal(announcedChoice('Voit valita vaihtoehdon 3, jos haluat.'), null);
  assert.equal(announcedChoice(''), null);
  assert.equal(optionsPrompt(`${OPTIONS}`), PROMPT);
  assert.equal(optionsPrompt('...\nVastaa 1. Sen jälkeen valitaan jauho ja jogurtti.'), 'Vastaa 1.');
  assert.equal(optionsPrompt(''), 'Vastaa vaihtoehdon numerolla.');
  assert.equal(await unchangedReply({ ask: null, message: 'x', options: OPTIONS }), UNCHANGED_FALLBACK);
  assert.equal(await unchangedReply({ ask: async () => ({ json: { text: 'Nää on fileitä. Etsitään lisää sopivia lohifileitä.' } }), message: 'x', options: OPTIONS }), 'Nää on fileitä.');
  assert.equal(withoutActionClaims('Joo, ymmärsin, laktoositon ei kelpaa. Laitan laktoosillisen kerman 8 l torstaiksi.'), 'Joo, ymmärsin, laktoositon ei kelpaa.');
  for (const bad of ['Valitsen sinulle ykkösen.', 'Kysyn asiakaspalvelusta pikatoimitusta.', 'x'.repeat(600), '']) {
    assert.equal(await unchangedReply({ ask: async () => ({ json: { text: bad } }), message: 'x', options: OPTIONS }), UNCHANGED_FALLBACK, bad);
  }
  assert.equal(await unchangedReply({ ask: async () => { throw new Error('timeout'); }, message: 'x', options: OPTIONS }), UNCHANGED_FALLBACK);
});

test('kuittaukset: luettava tuotenimi, ei "Päivitetty:", vaihteleva siirtymä', () => {
  const line = (ref, term, quantity, extra = {}) => ({ ref, productTerm: term, quantity, ...extra });
  const before = { id: 'd2', revision: 4, deliveryDate: '2026-11-19', status: 'needs_product_selection', lines: [line('L1', 'peruna', { value: 30, unit: 'KG' }), line('L2', 'kerma', { value: 8, unit: 'L' })] };
  const picked = { ...before, revision: 5, lines: [line('L1', 'peruna', { value: 30, unit: 'KG' }, { selectedProductId: 'P', selectedName: 'PP PESTY PERUNA 50-60MM 15KG/LTK' }), before.lines[1]] };
  const [ack] = selectionAcknowledgement({ previousList: before, shoppingList: picked, status: 'choosing' });
  assert.match(ack, /PP pesty peruna 50-60mm 15kg\/ltk\.$/u);
  const changed = selectionAcknowledgement({ previousList: before, shoppingList: { ...before, revision: 6, lines: [line('L1', 'peruna', { value: 40, unit: 'KG' }), before.lines[1]] }, status: 'choosing' });
  assert.equal(changed.length, 1); assert.match(changed[0], /^(?:Joo|Selvä|Okei), nyt peruna 40 kg\.$/u); assert.doesNotMatch(changed[0], /Päivitetty/u);
  // Siirtymä valintaan vaihtelee korin mukaan; Eeliksen alkuperäinen lause on yksi vaihtoehdoista.
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const out = selectionAcknowledgement({ previousList: null, shoppingList: { ...before, id: `d${i}`, revision: i, lines: [line('L1', 'maito', { value: 10, unit: 'L' })] }, status: 'choosing' });
    assert.ok(CHOOSE_TRANSITIONS.includes(out.at(-1)), out.at(-1)); seen.add(out.at(-1));
  }
  assert.ok(seen.size >= 3);
});

const CATALOG = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data/catalog.json');

test('"ei laktoosittomia" ja "laktoosillinen" eivät muutu laktoosittomuusvaatimukseksi (sääntötulkki)', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const interpret = createRuleInterpreter({ understand });
  const draft = { lines: [], turn: 1, pending: null };
  for (const text of ['30 kiloo pottuu ja vähä kermaa, ei mittää laktoosittomii hommii', 'EI laktoositonta kermaa', 'laktoosillista kermaa 2 l']) {
    const r = await interpret({ text, draft, now: Date.parse('2026-11-17T12:00:00Z') });
    assert.ok(r.ops.some((o) => o.op === 'no_preference'), text);
    for (const o of r.ops) {
      assert.ok(!(o.claims || []).includes('FREE_FROM_LACTOSE') && !(o.addClaims || []).includes('FREE_FROM_LACTOSE'), `${text}: ${JSON.stringify(o)}`);
    }
  }
  const wanted = await interpret({ text: '20 l laktoositonta maitoa', draft, now: Date.parse('2026-11-17T12:00:00Z') });
  assert.ok(!wanted.ops.some((o) => o.op === 'no_preference'));
});

test('saman päivän tilattavattomat rivit yhdeksi lauseeksi, muut ongelmat ennallaan', async () => {
  const { mergeUnavailable } = await import('../server/order-conversation/index.mjs');
  assert.deepEqual(mergeUnavailable(['Ei tilattavaa tuotetta päivälle ke 18.11.: maito.', 'Ei tilattavaa tuotetta päivälle ke 18.11.: voi.',
    'Tarkkaa osumaa ei löytynyt: strutsinmuna.', 'Ei tilattavaa tuotetta päivälle ke 18.11.: kananmuna.']),
  ['Ei tilattavaa tuotetta päivälle ke 18.11.: maito, voi ja kananmuna.', 'Tarkkaa osumaa ei löytynyt: strutsinmuna.']);
  assert.deepEqual(mergeUnavailable(['Ei tilattavaa tuotetta päivälle pe 20.11.: spagetti.']), ['Ei tilattavaa tuotetta päivälle pe 20.11.: spagetti.']);
});

test('"Kirjoita 4" vain, kun listassa on lisävaihtoehtojen rivi', async () => {
  const three = OPTIONS.replace('\nJos haluat muita vaihtoehtoja, vastaa 4.', '');
  assert.equal(hasMore(OPTIONS), true); assert.equal(hasMore(three), false);
  assert.equal(hasMore('1) A\n2) B\n3) C\n4) Näytä lisää vaihtoehtoja\nVastaa 1, 2, 3 tai 4.'), true); // vanha lista tallennetussa keskustelussa
  let seen;
  const ask = async ({ user }) => { seen = JSON.parse(user); return { json: { text: 'Äh, kaikki on laktoosittomia. Kirjoita 4, niin katsotaan lisää.' } }; };
  assert.equal(await unchangedReply({ ask, message: 'laktoosillinen kiitos', options: three }), 'Äh, kaikki on laktoosittomia.');
  assert.equal(seen.moreNumber, null);
  assert.equal(await unchangedReply({ ask, message: 'laktoosillinen kiitos', options: OPTIONS }), 'Äh, kaikki on laktoosittomia. Kirjoita 4, niin katsotaan lisää.');
  assert.equal(seen.moreNumber, 4);
  assert.equal(optionsPrompt(three), 'Vastaa 1, 2 tai 3.');
});
