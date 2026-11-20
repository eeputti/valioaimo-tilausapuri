// Reseptissä ei ole spagetin määrää (Eelis 17.11.: "miks tä ei antanu spaghetille painoa tai määrää koska sitä ei ollu
// reseptissä"). Lista näytti "spagetti, määrä tarkennettava" ilman syytä, vaikka annosmäärä oli tiedossa. Nyt puuttuva
// määrä arvioidaan annosta kohti, se merkitään arvioksi, syy kerrotaan ja arvio menee hyväksynnän jälkeen listalle.
// Ei verkkoa, ei oikeaa mallia: arviomalli on testissä kiinteä vastaus.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VALIO_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { bootstrapDemoMember } = await import('../server/whatsapp/ordering.mjs');
const { createLinkAdvice } = await import('../server/whatsapp/link-advice.mjs');

const PHONE = '358401234567';
const page = { title: 'Kermainen kanapasta', recipes: [],
  text: 'Kermainen kanapasta, 4 annosta. 600 g broilerin fileesuikaleita, spagettia, 2 dl ruokakermaa ja 2 valkosipulinkynttä. Halutessa 1 tölkki kookosmaitoa.' };
const analysis = (servings = 4, extra = []) => ({ summary: 'Kanapastan resepti.', servings, servingsEvidence: servings ? '4 annosta' : '', ingredients: [
  { term: 'broilerin fileesuikale', source: '600 g broilerin fileesuikaleita', amount: '600 g' },
  { term: 'spagetti', source: 'spagettia', amount: '' },
  { term: 'ruokakerma', source: '2 dl ruokakermaa', amount: '2 dl' },
  { term: 'valkosipuli', source: '2 valkosipulinkynttä', amount: '' },
  ...extra,
] });
// Spagetti annosarviona, valkosipuli kappaleina: sourcen 2 kynttä × 5 g jaetaan koodissa 4 annoksella (2,5 g annokselle).
const sensible = { rows: [{ index: 1, perPortion: 0.1, unit: 'KG', count: 0, unitWeight: 0 }, { index: 3, perPortion: 0, unit: 'KG', count: 2, unitWeight: 0.005 }] };

function fixture(t, { estimate = async () => ({ json: sensible }), servings = 4, extra = [] } = {}) {
  const store = openWhatsAppStore(':memory:'); t.after(() => store.close());
  bootstrapDemoMember(store, { WHATSAPP_DEMO_PHONE: PHONE });
  const member = store.member(PHONE); const asks = []; const orders = [];
  const links = createLinkAdvice({ db: store.db, readPage: async () => page,
    ask: async (args) => {
      asks.push(args);
      if (args.purpose === 'whatsapp_link_estimate') return estimate(args);
      if (args.purpose === 'whatsapp_link_match') return { json: { rows: JSON.parse(args.user).rows.map((r) => ({ index: r.index, productIds: r.candidates.map((p) => p.id), needsQuantityCheck: false })) } };
      return { json: analysis(servings, extra) };
    },
    lookup: async (term) => [{ id: `p-${term}`, name: `Testi ${term}`, labels: [], hasAllergenData: true, contains: [], mayContain: [] }] });
  let n = 0;
  const turn = (text) => links.respond({ binding: member.binding, messageId: `m${++n}`, text, shoppingList: null,
    runOrder: async (orderText) => { orders.push(orderText); return { status: 'collecting', text: 'ok' }; } });
  return { turn, asks, orders };
}

test('spagetilla ei ole määrää: arvio 100 g annokselle eli 2 kg 20 annokselle, ja syy kerrotaan', async (t) => {
  const f = fixture(t);
  const out = await f.turn('https://example.com/kanapasta tää 20 annokselle');
  assert.match(out.text, /Määrät 20 annokselle\./u);
  assert.match(out.text, /- spagetti, noin 2 kg, arvio\n/u);
  assert.match(out.text, /- valkosipuli, noin 0,05 kg, arvio/u);
  assert.match(out.text, /- broilerin fileesuikale, 3 kg\n/u);
  assert.match(out.text, /Arvioin määrät, joita reseptissä ei ollut painona tai tilavuutena: spagetti 100 g annokselle \(reseptissä ei ole määrää\) ja valkosipuli 2,5 g annokselle \(reseptissä "2 valkosipulinkynttä"\)\./u);
  const estimate = f.asks.find((a) => a.purpose === 'whatsapp_link_estimate');
  assert.deepEqual(JSON.parse(estimate.user).rows.map((r) => r.term), ['spagetti', 'valkosipuli'], 'vain määrää vailla olevat arvioidaan');
  await f.turn('joo');
  assert.match(f.orders.at(-1), /broilerin fileesuikale 3 kg, spagetti 2 kg, ruokakerma 1 l, valkosipuli 0,05 kg/u);
});

test('annosmäärän muutos laskee arvion uudelleen', async (t) => {
  const f = fixture(t);
  await f.turn('https://example.com/kanapasta tää 20 annokselle');
  const out = await f.turn('30 annosta');
  assert.match(out.text, /- spagetti, noin 3 kg, arvio/u);
});

test('epäuskottava tai epäonnistunut arvio: määrä jää tarkennettavaksi, ja syy kerrotaan silti', async (t) => {
  for (const estimate of [async () => ({ json: { rows: [{ index: 1, perPortion: 5, unit: 'KG' }, { index: 3, perPortion: 0, unit: '' }] } }),
    async () => { throw new Error('aikakatkaisu'); }]) {
    const f = fixture(t, { estimate });
    const out = await f.turn('https://example.com/kanapasta tää 20 annokselle');
    assert.match(out.text, /- spagetti, määrä tarkennettava, reseptissä ei ole määrää\n/u);
    assert.match(out.text, /- valkosipuli, määrä tarkennettava\n/u);
    assert.doesNotMatch(out.text, /Arvioin|arvio\b/u);
    await f.turn('joo');
    assert.match(f.orders.at(-1), /spagetti, ruokakerma 1 l, valkosipuli\./u);
  }
});

test('annosmäärä ei tiedossa: arviota ei näytetä kokonaismääränä', async (t) => {
  const f = fixture(t, { servings: 0 });
  const out = await f.turn('https://example.com/kanapasta');
  assert.match(out.text, /Määrät ovat reseptin alkuperäiset/u);
  assert.match(out.text, /- spagetti, määrä tarkennettava, reseptissä ei ole määrää\n/u);
  assert.doesNotMatch(out.text, /Arvioin/u);
});

test('kappalemäärä lasketaan koodissa: mallin oma annosmäärä ei kelpaa, eikä luku, jota sourcessa ei ole', async (t) => {
  // Malli antoi suoraan 5 g annokselle (live 17.11.). Kappalepolulla se ohitetaan, ja koodi laskee 2 × 5 g / 4 annosta.
  const f = fixture(t, { estimate: async () => ({ json: { rows: [{ index: 3, perPortion: 0.005, unit: 'KG', count: 2, unitWeight: 0.005 }] } }) });
  const out = await f.turn('https://example.com/kanapasta tää 20 annokselle');
  assert.match(out.text, /- valkosipuli, noin 0,05 kg, arvio/u);
  for (const row of [{ index: 3, perPortion: 0, unit: 'KG', count: 3, unitWeight: 0.005 }, { index: 3, perPortion: 0.005, unit: 'KG', count: 2, unitWeight: 9 }]) {
    const g = fixture(t, { estimate: async () => ({ json: { rows: [row] } }) });
    const bad = await g.turn('https://example.com/kanapasta tää 20 annokselle');
    assert.match(bad.text, /- valkosipuli, määrä tarkennettava\n/u, JSON.stringify(row));
  }
  const unknown = fixture(t, { servings: 0, estimate: async () => ({ json: { rows: [{ index: 3, perPortion: 0, unit: 'KG', count: 2, unitWeight: 0.005 }] } }) });
  assert.doesNotMatch((await unknown.turn('https://example.com/kanapasta')).text, /Arvioin/u);
});

test('kappalerivin yksikkö tyhjä (tuotannon Haiku 17.11.): valkosipulin yksikkö päätellään, nesteelle litrat', async (t) => {
  // Tuotannon arviovastaus valkosipulille sellaisenaan: count ja unitWeight oikein, unit tyhjä.
  const f = fixture(t, { extra: [{ term: 'kookosmaito', source: '1 tölkki kookosmaitoa', amount: '' }],
    estimate: async () => ({ json: { rows: [{ index: 1, perPortion: 0.1, unit: 'KG', count: 0, unitWeight: 0 },
      { index: 3, perPortion: 0, unit: '', count: 2, unitWeight: 0.005 }, { index: 4, perPortion: 0, unit: '', count: 1, unitWeight: 0.4 }] } }) });
  const out = await f.turn('https://example.com/kanapasta tää 20 annokselle');
  assert.match(out.text, /- valkosipuli, noin 0,05 kg, arvio/u);
  assert.match(out.text, /- kookosmaito, noin 2 l, arvio/u);
  assert.match(out.text, /valkosipuli 2,5 g annokselle \(reseptissä "2 valkosipulinkynttä"\)/u);
  assert.match(out.text, /kookosmaito 1 dl annokselle \(reseptissä "1 tölkki kookosmaitoa"\)/u);
  // Tyhjä yksikkö ilman kappaleita ei edelleenkään kelpaa: spagetti jää tarkennettavaksi.
  const g = fixture(t, { estimate: async () => ({ json: { rows: [{ index: 1, perPortion: 0.1, unit: '', count: 0, unitWeight: 0 }] } }) });
  assert.match((await g.turn('https://example.com/kanapasta tää 20 annokselle')).text, /- spagetti, määrä tarkennettava, reseptissä ei ole määrää\n/u);
});
