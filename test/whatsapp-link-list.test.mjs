// Reseptilinkin vastaus 17.11.: Eeliksen oikeassa kokeessa jokainen aines (pasta, sipuli, mustapippuri…) sai rivin
// "Sopivaa katalogiosumaa ei löytynyt", koska Haikun täsmäyskutsu katkesi 3000 tokenin rajaan ajatteluineen. Lisäksi
// "parmesaani" ei löytänyt mitään, vaikka "parmesan" löytää. Nyt lista on selkeä, puuttuva merkitään sulkeisiin vain,
// kun haku ei löydä mitään, ja haku kokeilee perusmuodon ja kirjoitusasut. Ei verkkoa, ei mallia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { bootstrapDemoMember } = await import('../server/whatsapp/ordering.mjs');
const { createLinkAdvice, lookupForms } = await import('../server/whatsapp/link-advice.mjs');

const PHONE = '358401234567';
const page = { title: 'Kermainen kanapasta', recipes: [],
  text: 'Kermainen kanapasta, 4 annosta. 300 g spaghettia, 400 g broilerin fileesuikaleita, 2 dl ruokakermaa, 50 g parmesaania ja 1 rkl tryffeliöljyä.' };
const analysis = { summary: 'Kanapastan resepti.', servings: 4, servingsEvidence: '4 annosta', ingredients: [
  { term: 'spaghetti', source: '300 g spaghettia', amount: '300 g' },
  { term: 'broilerin fileesuikaleet', source: '400 g broilerin fileesuikaleita', amount: '400 g' },
  { term: 'ruokakerma', source: '2 dl ruokakermaa', amount: '2 dl' },
  { term: 'parmesaani', source: '50 g parmesaania', amount: '50 g' },
  { term: 'tryffeliöljy', source: '1 rkl tryffeliöljyä', amount: '1 rkl' },
] };

function fixture(t, { match }) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  bootstrapDemoMember(store, { WHATSAPP_DEMO_PHONE: PHONE });
  const member = store.member(PHONE); const asks = [];
  const links = createLinkAdvice({ db: store.db, readPage: async () => page,
    ask: async (args) => { asks.push(args); if (args.purpose === 'whatsapp_link_match') return match(args); return { json: structuredClone(analysis) }; },
    // Valikoimassa on kaikkea muuta paitsi tryffeliöljyä.
    lookup: async (term) => (term === 'tryffeliöljy' ? [] : [{ id: `p-${term}`, name: `Testi ${term}`, labels: [], hasAllergenData: true, contains: [], mayContain: [] }]) });
  const turn = (text) => links.respond({ binding: member.binding, messageId: `m-${asks.length}-${text.length}`, text, shoppingList: null,
    runOrder: async () => ({ status: 'collecting', text: 'ok' }) });
  return { turn, asks };
}

test('täsmäyskutsun katkeaminen ei merkitse löytyneitä aineksia puuttuviksi, ja lista on selkeä ilman hakuosumia', async (t) => {
  const f = fixture(t, { match: async () => { throw new Error('Vastaus katkesi (max_tokens)'); } });
  const out = await f.turn('https://example.com/kanapasta');
  assert.match(out.text, /^Luin (?:sivun|reseptin): Kermainen kanapasta/);
  assert.match(out.text, /Ainekset:\n- spaghetti, 0,3 kg\n- broilerin fileesuikaleet, 0,4 kg\n- ruokakerma, 0,2 l\n- parmesaani, 0,05 kg\n- tryffeliöljy, 0,015 l \(ei löytynyt valikoimasta\)\n/);
  assert.doesNotMatch(out.text, /katalog|Sopivaa|Testi /);
  // Syvän tason ajattelu kuuluu tokenirajaan: 3000 katkaisi Haikun vastauksen. Nopea taso ei ajattele.
  const match = f.asks.find((a) => a.purpose === 'whatsapp_link_match');
  assert.ok(match.tier === 'fast' || match.maxTokens >= 8000, `${match.tier} ${match.maxTokens}`);
});

test('onnistunut täsmäys ei myöskään näytä tuotenimiä, ja valikoimasta puuttuva näkyy sulkeissa', async (t) => {
  const f = fixture(t, { match: async ({ user }) => ({ json: { rows: JSON.parse(user).rows.map((r) => ({ index: r.index, productIds: r.candidates.map((p) => p.id), needsQuantityCheck: false })) } }) });
  const out = await f.turn('https://example.com/kanapasta');
  assert.match(out.text, /- tryffeliöljy, 0,015 l \(ei löytynyt valikoimasta\)/);
  assert.equal((out.text.match(/ei löytynyt valikoimasta/g) || []).length, 1);
  assert.doesNotMatch(out.text, /Testi /);
});

test('hakumuodot: perusmuoto jäsentimeltä ja gh-kirjoitusasu molemmin päin', () => {
  const parse = (q) => ({ parmesaani: 'parmesan', spaghetti: 'spagetti', spagettipasta: 'spagetti' }[q] || null);
  assert.deepEqual(lookupForms('parmesaani', parse), ['parmesaani', 'parmesan']);
  assert.deepEqual(lookupForms('spaghetti', parse), ['spaghetti', 'spagetti']);
  assert.deepEqual(lookupForms('spagettipasta', parse), ['spagettipasta', 'spagetti', 'spaghettipasta', 'spaghetti']);
  assert.deepEqual(lookupForms('pakastemustikka'), ['pakastemustikka', 'mustikka']);
  assert.deepEqual(lookupForms('kerma', () => { throw new Error('ei'); }), ['kerma']);
});

const skip = !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu';
test('oikea katalogi: parmesaani, spaghetti ja spagettipasta löytävät tuotteita jäsentimen kautta', { skip }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const { understand } = await import('../server/aimo/understand.mjs');
  const hits = (term) => lookupForms(term, (q) => understand(q).items[0]?.productTerm)
    .flatMap((q) => loadCatalog().search(q, { limit: 8 }).filter((h) => h.match === 'core').map((h) => h.product.name));
  assert.equal(loadCatalog().search('parmesaani', { limit: 8 }).filter((h) => h.match === 'core').length, 0, 'lähtötilanne: suora haku ei löydä');
  assert.ok(hits('parmesaani').some((n) => /parmesan/i.test(n)));
  assert.ok(hits('spaghetti').some((n) => /spaghetti/i.test(n)) && hits('spaghetti').some((n) => /spagetti/i.test(n)));
  assert.ok(hits('spagettipasta').some((n) => /spag(h)?etti/i.test(n)));
});
