// Hintavälimuistin luku yhdellä kyselyllä (docs/agent-v2/agentti.md, kohta Viive, ehdotus 6). Pilvessä (Turso) jokainen kysely on
// oma verkkokierroksensa, joten fetchQuotes ei saa lukea välimuistia tuotteittain. Vastaukset pysyvät samoina.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Ajetut SQL-lauseet tekstin mukaan (db.mjs avaa kannan tuonnin yhteydessä, joten laskuri asennetaan ensin).
const executed = [];
const prepare = DatabaseSync.prototype.prepare;
const sqlOf = new WeakMap();
DatabaseSync.prototype.prepare = function (sql) {
  const st = prepare.call(this, sql); sqlOf.set(st, String(sql));
  const proto = Object.getPrototypeOf(st);
  if (!proto.__batchCounted) {
    for (const name of ['get', 'all', 'run']) { const fn = proto[name]; proto[name] = function (...args) { executed.push(sqlOf.get(this) || ''); return fn.apply(this, args); }; }
    proto.__batchCounted = true;
  }
  return st;
};
const selectsBy = (pattern) => executed.filter((sql) => /SELECT/i.test(sql) && /FROM api_cache/i.test(sql) && pattern.test(sql)).length;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-cache-batch-'));
let up = true; let hits = 0;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    hits += 1;
    if (!up) { res.writeHead(503); res.end('down'); return; }
    const { products } = JSON.parse(body);
    const rows = products.map((productId) => (req.url === '/api/price'
      ? { productId, catalogPrice: { value: '3.00', valueWithTax: '3.41' }, tax: { taxRate: '13.5' } }
      : { productId, closingTime: '2026-11-25T12:00:00+0200', logisticModel: 'Stock', scheduleLines: [{ availableAmount: 50, availableDate: '2026-11-27', salesUnit: 'ST' }] }));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ products: rows }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { AIMO_DB: path.join(dir, 'cache.db'), VALIO_API_KEY: 'test-key', VALIO_API_BASE: `http://127.0.0.1:${server.address().port}` });
delete process.env.VALIO_FALLBACK;
const { apiCache } = await import('../server/db.mjs');
const { fetchQuotes, resetApiBreaker } = await import('../server/valioApi.mjs');
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const DATE = '2026-11-27';
const avail = (id) => ({ status: 'ok', amount: 10 + Number(id), date: DATE, closingTime: '2026-11-25T12:00:00+0200', model: 'Stock', source: 'live', fetchedAt: 1 });
const price = (id) => ({ net: Number(id), gross: Number(id) * 1.135, vatRate: 13.5, source: 'live', fetchedAt: 1 });

test('cached prices and availability are read with one query for all products, without asking the API', async () => {
  for (const id of ['11', '12', '13']) { apiCache.set(`live:avail:${DATE}:${id}`, avail(id)); apiCache.set(`live:price:${DATE}:${id}`, price(id)); }
  executed.length = 0; hits = 0;
  const out = await fetchQuotes(['11', '12', '13', '12'], DATE);
  assert.deepEqual([...out.keys()], ['11', '12', '13']);
  assert.equal(out.get('12').avail.amount, 22); assert.equal(out.get('13').price.net, 13);
  assert.equal(hits, 0);
  assert.equal(selectsBy(/WHERE key IN \(/), 1);
  assert.equal(selectsBy(/WHERE key = \?/), 0);
});

test('products missing from the cache are looked up once in the batch and then fetched from the API', async () => {
  executed.length = 0; hits = 0;
  const out = await fetchQuotes(['21', '22'], DATE);
  assert.equal(out.get('21').price.net, 3); assert.equal(out.get('22').avail.status, 'ok');
  assert.equal(hits, 2); // yksi saatavuus- ja yksi hintakutsu
  assert.equal(selectsBy(/WHERE key IN \(/), 1);
  assert.equal(selectsBy(/WHERE key = \?/), 0);
  executed.length = 0;
  await fetchQuotes(['21', '22'], DATE); // nyt muistissa: ei kyselyä eikä rajapintakutsua
  assert.equal(selectsBy(/api_cache/), 0); assert.equal(hits, 2);
});

test('when the API is down, old cached values are served from the same batch read and marked stale', async () => {
  const id = '31';
  apiCache.set(`live:avail:${DATE}:${id}`, avail(id)); apiCache.set(`live:price:${DATE}:${id}`, price(id));
  // Rivit ovat vanhoja (TTL ylitetty) eivätkä muistissa: uusi prosessi lukee ne kannasta.
  new DatabaseSync(process.env.AIMO_DB).prepare("UPDATE api_cache SET fetched_at=? WHERE key LIKE '%:31'").run(Date.now() - 3 * 3600_000);
  up = false; resetApiBreaker(); executed.length = 0;
  const out = await fetchQuotes([id], DATE);
  assert.equal(out.get(id).avail.stale, true); assert.equal(out.get(id).price.stale, true); assert.equal(out.get(id).price.net, 31);
  assert.equal(selectsBy(/WHERE key IN \(/), 1);
  assert.equal(selectsBy(/WHERE key = \?/), 0);
  up = true;
});

test('a large batch is split into queries of at most 500 keys', async () => {
  const ids = Array.from({ length: 300 }, (_, i) => String(1000 + i)); // 600 avainta
  for (const id of ids) { apiCache.set(`live:avail:${DATE}:${id}`, avail(id)); apiCache.set(`live:price:${DATE}:${id}`, price(id)); }
  executed.length = 0; hits = 0;
  const out = await fetchQuotes(ids, DATE);
  assert.equal(out.size, 300); assert.equal(out.get('1299').price.net, 1299);
  assert.equal(selectsBy(/WHERE key IN \(/), 2); assert.equal(hits, 0);
});
