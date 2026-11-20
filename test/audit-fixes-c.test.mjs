// Katselmuksen 15.11. ilta (docs/parallel/code-audit-2026-11-15-ilta.md) keskustelu- ja korisivuviat #10, #11, #18, #20,
// #23 (#21: audit-fixes-c-chatter.test.mjs oikealla katalogilla). #9 (korisivun sivunsisäiset linkit) on selainkäytöstä ja varmennettiin selaimessa (docs/parallel/audit-fixes-c.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.ANTHROPIC_API_KEY = '';
process.env.VALIO_API_KEY = '';
// Synteettinen katalogi ennen tilausytimen tuontia: sääntötulkki ilman challenge-aineistoa.
const { KITCHEN_A, KITCHEN_B, linkTestKitchens, useSyntheticCatalog } = await import('./helpers/demo-ordering.mjs');
useSyntheticCatalog('audit-fixes-c');

const { createOrderingConversation } = await import('../server/order-conversation/index.mjs');
const { openDraftStore } = await import('../server/order-conversation/store.mjs');
const { createExportCache } = await import('../server/order-conversation/runtime.mjs');
const { helsinkiLabel } = await import('../server/gateway/clock.mjs');
const { openWhatsAppStore } = await import('../server/whatsapp/store.mjs');
const { createCartLink, EXPORT_PER_MINUTE } = await import('../server/whatsapp/cart-link.mjs');

const NOW = Date.parse('2026-11-14T08:00:00Z'); // lauantai
const customer = { customerId: 'c1', buyerId: 'b1', bindingVersion: 'v1', deliverySites: [{ id: 's1', label: 'Keittiö' }], permissions: { readProducts: true, placeOrders: true } };
const add = (productTerm, quantity = null, claims = []) => ({ op: 'add', productTerm, quantity, claims, excludeAllergens: [] });

// Testityökalut: kaksi vaihtoehtoa riviä kohden, maidolle laktoositarkennus. quote antaa rivikohtaiset tilausaikarajat.
function engine({ script = {}, interpret, cutoffs = {} } = {}) {
  const calls = { suggest: [], quote: 0, submit: 0 };
  const tools = {
    async suggest({ draft }) {
      calls.suggest.push(structuredClone(draft));
      return { issues: [], lines: draft.lines.map((l) => ({ ref: l.ref, total: 2, clarify: l.productTerm === 'maito' && !l.claims.length ? ['FREE_FROM_LACTOSE'] : [],
        options: [1, 2].map((i) => ({ productId: `${l.productTerm}-${i}`, name: `${l.productTerm} ${i}`, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10 * i })) })) };
    },
    async quote({ draft }) {
      calls.quote += 1;
      return { quoteId: `Q${calls.quote}`, draftId: draft.id, revision: draft.revision, expiresAt: new Date(NOW + 900_000).toISOString(), issues: [], totals: { net: 20 },
        lines: draft.lines.map((l) => ({ ref: l.ref, name: l.selectedName, salesUnits: 2, salesUnitLabel: 'ltk', covers: l.quantity, lineNet: 10,
          ...(cutoffs[l.productTerm] ? { cutoff: cutoffs[l.productTerm], cutoffLabel: helsinkiLabel(cutoffs[l.productTerm]) } : {}) })) };
    },
    async submit({ draft }) { calls.submit += 1; return { status: 'confirmed', orderId: 'AGW-1', deliveryDate: draft.deliveryDate, totals: { net: 20 }, reasons: [] }; },
  };
  const store = openDraftStore(':memory:', () => NOW);
  let n = 0;
  const handleTurn = createOrderingConversation({ store, tools, now: () => NOW,
    interpretTurn: interpret || (async ({ text, draft }) => { const r = script[text]; return typeof r === 'function' ? r(draft) : r || { intent: 'other', ops: [] }; }) });
  const say = (text) => handleTurn({ messageId: `m${++n}`, conversationId: 'conv', customer, text, receivedAt: NOW });
  return { say, calls, store };
}

test('#11 pelkkä päivä tai ruokavalio ennen tuotteita säilyy, eikä päivää kysytä uudelleen', async () => {
  const { say, store, calls } = engine({ script: {
    perjantaiksi: { intent: 'order', deliveryDate: '2026-11-20', ops: [] },
    'pähkinätön': { intent: 'order', ops: [{ op: 'diet', addClaims: [], excludeAllergens: ['AN'] }] },
    '5 kg voita': { intent: 'order', ops: [add('voi', { value: 5, unit: 'KG' })] },
  } });
  const date = await say('perjantaiksi');
  assert.equal(date.status, 'collecting');
  assert.match(date.text, /^Toimitus pe 20\.11\. Mitä tarvitset\?/);
  assert.doesNotMatch(date.text, /Mille päivälle|Luonnos on tyhjä/);
  assert.equal(store.active('conv').deliveryDate, '2026-11-20');
  assert.equal(store.active('conv').lines.length, 0);
  const diet = await say('pähkinätön');
  assert.match(diet.text, /^Toimitus pe 20\.11\. Huomioitu: pähkinätön\. Mitä tarvitset\?/);
  const products = await say('5 kg voita');
  assert.equal(products.status, 'choosing'); // päivä on jo tiedossa: suoraan vaihtoehdot
  assert.doesNotMatch(products.text, /Mille päivälle/);
  assert.match(products.text, /Toimitus: pe 20\.11\.\nHinnat alv 0 %\nHuomioitu: pähkinätön\n/);
  const searched = calls.suggest.at(-1);
  assert.equal(searched.deliveryDate, '2026-11-20');
  assert.deepEqual(searched.diet.excludeAllergens, ['AN']); // ennen tuotteita ilmoitettu rajaus koskee ehdotuksia
});

test('#11 tuotteiden kaikki rivit poistettaessa luonnos suljetaan kuten ennen, ja pelkkä tervehdys ei tallenna mitään', async () => {
  const { say, store } = engine({ script: {
    '20 l maitoa ti': { intent: 'order', deliveryDate: '2026-11-17', ops: [add('maito', { value: 20, unit: 'L' }, ['FREE_FROM_LACTOSE'])] },
    'poista kaikki': (d) => ({ intent: 'order', ops: d.lines.map((l) => ({ op: 'remove', ref: l.ref })) }),
  } });
  assert.match((await say('moi')).text, /^Olen Valio Aimon digitaalinen tilausapuri/);
  assert.equal(store.active('conv'), null);
  await say('20 l maitoa ti');
  assert.match((await say('poista kaikki')).text, /^Luonnos on tyhjä/);
  assert.equal(store.active('conv'), null);
});

test('#18 yhteenvedon "Tilattava viimeistään" on aikaisin tilausaikaraja, ei ensimmäisen rivin', async () => {
  const late = '2026-11-15T17:00:00+02:00'; const early = '2026-11-15T12:00:00+02:00';
  const { say } = engine({ cutoffs: { maito: late, voi: early }, script: {
    tuotteet: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('maito', { value: 20, unit: 'L' }, ['FREE_FROM_LACTOSE']), add('voi', { value: 5, unit: 'KG' })] },
  } });
  await say('tuotteet'); await say('1');
  const ready = await say('1');
  assert.equal(ready.status, 'ready');
  assert.ok(ready.text.includes(`Tilaus pitää tehdä viimeistään ${helsinkiLabel(early)}.`), ready.text);
  assert.ok(!ready.text.includes(helsinkiLabel(late)), ready.text);
});

test('#20 "sopii", "ok", "hyvä" ja "käy" laktoosikysymykseen eivät lisää vaatimusta eivätkä toista kysymystä', async () => {
  for (const answer of ['sopii', 'ok', 'hyvä', 'käy', 'Käy!', 'joo käy', 'ok kiitos', 'sopii hyvin']) {
    const { say, store } = engine({ script: { maitoa: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('maito', { value: 20, unit: 'L' })] } } });
    assert.match((await say('maitoa')).text, /Maito: haluatko laktoositonta vai käykö tavallinen\?/);
    const reply = await say(answer);
    assert.equal(reply.status, 'choosing', answer);
    assert.doesNotMatch(reply.text, /haluatko laktoositonta/, answer);
    const line = store.active('conv').lines[0];
    assert.deepEqual(line.claims, [], answer);
    assert.deepEqual(line.answeredClaims, ['FREE_FROM_LACTOSE'], answer);
  }
  // "joo" ja "1" vastaavat edelleen ensimmäiseen kysymykseen: laktoositon.
  for (const answer of ['joo', '1', 'laktoositonta']) {
    const { say, store } = engine({ script: { maitoa: { intent: 'order', deliveryDate: '2026-11-16', ops: [add('maito', { value: 20, unit: 'L' })] } } });
    await say('maitoa');
    assert.equal((await say(answer)).status, 'choosing', answer);
    assert.deepEqual(store.active('conv').lines[0].claims, ['FREE_FROM_LACTOSE'], answer);
  }
});

// Korisivun HTTP-reitti oikealla korilinkillä ja testitilausmoottorilla: vahvistus ja hintojen vienti.
async function cartRoute(t) {
  let clock = NOW;
  const wa = openWhatsAppStore(':memory:', () => NOW);
  linkTestKitchens(wa);
  const list = { id: 'WD-1', revision: 3, status: 'review', lines: [{ ref: 'L1', productTerm: 'voi', selectedProductId: 'B1', quantity: { value: 5, unit: 'KG' } }] };
  const chats = []; let exports = 0;
  const ordering = {
    getShoppingList: async () => list,
    chat: async (args) => { chats.push(args); return { status: 'ready', text: 'ok', shoppingList: list }; },
    getStorefrontCart: async () => { exports += 1; return { state: 'ready', id: list.id, revision: list.revision, lines: [] }; },
  };
  const cart = createCartLink({ store: wa, ordering, baseUrl: 'https://cart.example.test', secret: 'cart-test-secret', now: () => clock });
  const server = http.createServer(async (req, res) => { if (!await cart.handle(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); wa.close(); });
  const token = (phone) => new URL(cart.linkFor(wa.member(phone), list)).hash.slice(1);
  const post = (body, who = KITCHEN_A) => fetch(`${base}/whatsapp/cart/api/chat`, { method: 'POST',
    headers: { authorization: `Bearer ${token(who)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messageId: crypto.randomUUID(), expectedList: { id: list.id, revision: list.revision }, ...body }) });
  const exportCart = (who = KITCHEN_A) => fetch(`${base}/whatsapp/cart/api/export`, { headers: { authorization: `Bearer ${token(who)}` } });
  return { post, exportCart, chats, exports: () => exports, advance: (ms) => { clock += ms; } };
}

test('#10 korisivun muutoskenttään kirjoitettu "hyväksyn" tai "tilaa" ei tee tilausta; vain vahvistuspainike vahvistaa', async (t) => {
  const f = await cartRoute(t);
  for (const text of ['hyväksyn', 'Hyväksy', 'tilaa', 'TILAA', 'joo tilaa', 'vahvistan', 'ok vahvista']) {
    const response = await f.post({ text });
    assert.equal(response.status, 400, text);
    assert.match((await response.json()).error, /SIIRRY MAKSAMAAN/, text);
  }
  assert.equal(f.chats.length, 0); // ei tilausmoottoriin eikä mallikutsuja
  // Painike lähettää vain vahvistuksen; muu teksti tai väärän tyyppinen lippu hylätään.
  assert.equal((await f.post({ text: 'näytä', confirm: true })).status, 400);
  assert.equal((await f.post({ text: 'TILAA', confirm: 'true' })).status, 400);
  assert.equal(f.chats.length, 0);
  // Tavallinen muutos ja tarkistus kulkevat ennallaan, painikkeen vahvistus menee tilausmoottorille.
  assert.equal((await f.post({ text: 'voita 6 kg' })).status, 200);
  assert.equal((await f.post({ text: 'näytä' })).status, 200);
  assert.equal((await f.post({ text: 'TILAA', confirm: true })).status, 200);
  assert.deepEqual(f.chats.map((c) => c.messages[0].content), ['voita 6 kg', 'näytä', 'TILAA']);
});

test('#23 hintojen vientireitillä on asiakaskohtainen nopeusraja', async (t) => {
  const f = await cartRoute(t);
  for (let i = 0; i < EXPORT_PER_MINUTE; i += 1) assert.equal((await f.exportCart()).status, 200);
  const limited = await f.exportCart();
  assert.equal(limited.status, 429); assert.match((await limited.json()).error, /Liian monta hintatarkistusta/);
  assert.equal(f.exports(), EXPORT_PER_MINUTE);
  assert.equal((await f.exportCart(KITCHEN_B)).status, 200); // toinen asiakas ei kärsi
  f.advance(61_000);
  assert.equal((await f.exportCart()).status, 200);
});

test('#23 hintojen viennin välimuisti pitää useamman korin ja yhdistää samanaikaiset haut', async () => {
  let clock = NOW; let calls = 0;
  const cached = createExportCache({ now: () => clock, slots: 2, ttl: 30_000 });
  const compute = (value, expiresAt = clock + 900_000) => async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return { value, expiresAt }; };
  // Kaksi vuorotellen haettua koria: kumpikin lasketaan kerran (ennen yksi paikka: joka haku uusi tarjous).
  for (let i = 0; i < 4; i += 1) { assert.equal(await cached('A', compute('a')), 'a'); assert.equal(await cached('B', compute('b')), 'b'); }
  assert.equal(calls, 2);
  // Saman korin samanaikaiset haut odottavat yhtä tarjousta.
  const parallel = await Promise.all([1, 2, 3].map(() => cached('C', compute('c'))));
  assert.deepEqual(parallel, ['c', 'c', 'c']); assert.equal(calls, 3);
  // Paikkoja on rajattu määrä: vanhin (A) poistuu.
  assert.equal(await cached('A', compute('a2')), 'a2'); assert.equal(calls, 4);
  // Tarjouksen voimassaolo lyhentää välimuistia, ja vanhentunut lasketaan uudelleen.
  assert.equal(await cached('D', compute('d', clock + 1000)), 'd');
  clock += 1001; assert.equal(await cached('D', compute('d2')), 'd2');
  clock += 30_001; assert.equal(await cached('D', compute('d3')), 'd3');
  assert.equal(calls, 7);
});
