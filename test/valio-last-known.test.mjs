// VALIO_FALLBACK=last-known: kun testirajapinta lakkaa vastaamasta, käytetään vain jo saatuja oikeita vastauksia.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-last-known-'));
let up = true;
let hits = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    hits += 1;
    if (!up) { res.writeHead(503); res.end('down'); return; }
    const { products } = JSON.parse(body);
    const rows = products.map((productId) => (req.url === '/api/price'
      ? { productId, catalogPrice: { value: productId === '300' ? '7.50' : '2.00', valueWithTax: '2.27' }, tax: { taxRate: '13.5' }, comparisonPrice: { value: '2.00' }, comparisonUnit: 'L' }
      : productId === '200'
        ? { productId, closingTime: '2026-11-15T17:00:00+0200', logisticModel: 'Stock', scheduleLines: [{ availableAmount: 0, availableDate: '2026-11-16', salesUnit: 'ST' }] }
        : { productId, closingTime: productId === '300' ? '2026-11-12T15:00:00+0200' : '2026-11-15T17:00:00+0200', logisticModel: productId === '300' ? 'Terminal' : 'Stock', scheduleLines: [{ availableAmount: 999999, availableDate: '2026-11-16', salesUnit: 'ST' }] }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ products: rows }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.AIMO_DB = path.join(dir, 'cache.db');
process.env.VALIO_API_KEY = 'test-key';
process.env.VALIO_API_BASE = `http://127.0.0.1:${server.address().port}`;
delete process.env.VALIO_FALLBACK;
const { fetchQuotes, resetApiBreaker, apiStats } = await import('../server/valioApi.mjs');
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('oikeat vastaukset tallentuvat ja ilman varaa katkos antaa vain tuntemattoman tai vanhan merkityn arvon', async () => {
  const live = await fetchQuotes(['100', '200', '300'], '2026-11-16');
  assert.equal(live.get('100').avail.status, 'ok');
  assert.equal(live.get('100').price.net, 2);
  assert.equal(live.get('200').avail.status, 'out');
  up = false;
  const down = await fetchQuotes(['100'], '2026-11-20', { fresh: true });
  assert.equal(down.get('100').avail.status, 'unknown');
  assert.equal(down.get('100').price.error, true);
});

test('katkoksessa käytetään viimeisintä oikeaa hintaa ja samaa toimitusaikaa pyydetylle päivälle', async () => {
  process.env.VALIO_FALLBACK = 'last-known';
  resetApiBreaker();
  up = false;
  const r = await fetchQuotes(['100', '300'], '2026-11-20', { fresh: true });
  const milk = r.get('100');
  assert.equal(milk.price.net, 2);
  assert.equal(milk.price.source, 'last-known');
  assert.equal(milk.price.stale, undefined);
  assert.deepEqual([milk.avail.status, milk.avail.date, milk.avail.closingTime, milk.avail.source], ['ok', '2026-11-20', '2026-11-19T17:00:00+0200', 'last-known']);
  assert.equal(milk.avail.lastKnownFor, '2026-11-16');
  // Terminal-tuotteen pidempi toimitusaika säilyy: raja 4 päivää ennen toimitusta.
  assert.equal(r.get('300').avail.closingTime, '2026-11-16T15:00:00+0200');
  assert.equal(r.get('300').price.net, 7.5);
  assert.ok(apiStats.lastKnownServed >= 4);
});

test('loppunut tuote pysyy loppuneena ja koskaan kysymättömälle ei keksitä hintaa tai saatavuutta', async () => {
  process.env.VALIO_FALLBACK = 'last-known';
  resetApiBreaker();
  up = false;
  const r = await fetchQuotes(['200', '999'], '2026-11-21', { fresh: true });
  assert.equal(r.get('200').avail.status, 'out');
  assert.equal(r.get('999').avail.status, 'unknown');
  assert.equal(r.get('999').price.error, true);
});

test('virheen jälkeen rajapintaa ei kysytä viiteen minuuttiin, ja palautuminen käyttää taas oikeaa rajapintaa', async () => {
  process.env.VALIO_FALLBACK = 'last-known';
  resetApiBreaker();
  up = false;
  await fetchQuotes(['100'], '2026-11-22', { fresh: true });
  const before = hits;
  const r = await fetchQuotes(['100'], '2026-11-23', { fresh: true });
  assert.equal(hits, before, 'ei uusia rajapintakutsuja katkoksen aikana');
  assert.equal(r.get('100').price.source, 'last-known');
  resetApiBreaker();
  up = true;
  const back = await fetchQuotes(['100'], '2026-11-23', { fresh: true });
  assert.equal(back.get('100').price.source, 'live');
  assert.equal(back.get('100').avail.source, 'live');
});
