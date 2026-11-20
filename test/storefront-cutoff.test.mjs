// Tilausaika on mennyt: aikaisin päivä samalla toimitusajalla (storefront.mjs dateAfterCutoff). Last-known-saatavuudessa
// (valioApi.mjs lastKnownAvailability) tilausaika siirtyy kokonaisina päivinä toimituspäivän mukana, joten sama haku
// lasketulle päivälle löytää tilattavaa. Sessio E tuotannossa to 19.11. klo 17.18: perjantain tilausaika oli mennyt klo 17.00,
// mutta tulos ei kertonut syytä eikä aikaisinta päivää.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clock } from '../server/gateway/clock.mjs';

// storefront.mjs lataa valioApi.mjs:n, joka avaa hintavälimuistin kannan heti ladattaessa (db.mjs). Oma väliaikainen kanta,
// jotta testi toimii myös GitHubin testiajossa, jossa data-hakemistoa ei ole.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-cutoff-test-'));
process.env.AIMO_DB = path.join(dir, 'prices.db');
const { dateAfterCutoff } = await import('../server/storefront.mjs');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ago = (ms) => new Date(clock.now().getTime() - ms).toISOString();
const MIN = 60_000; const DAY = 86_400_000;
const avail = (closingTime, over = {}) => ({ status: 'ok', source: 'last-known', date: '2026-11-20', closingTime, ...over });

test('a deadline that passed minutes ago moves the delivery one day, one that passed over a day ago two days', () => {
  assert.equal(dateAfterCutoff(avail(ago(18 * MIN)), '2026-11-20'), '2026-11-21');
  assert.equal(dateAfterCutoff(avail(ago(DAY + 5 * MIN)), '2026-11-20'), '2026-11-22');
  assert.equal(dateAfterCutoff(avail(ago(0)), '2026-11-30'), '2026-12-01'); // raja tasan nyt on jo mennyt (cutoffPassed: <=)
});

test('no earliest day is guessed for an open deadline, a live answer, other statuses or a broken time', () => {
  assert.equal(dateAfterCutoff(avail(ago(-30 * MIN)), '2026-11-20'), null); // raja vasta tulossa
  assert.equal(dateAfterCutoff(avail(ago(18 * MIN), { source: 'live' }), '2026-11-20'), null); // rajapinnan vastausta ei arvata
  assert.equal(dateAfterCutoff(avail(ago(18 * MIN), { status: 'out' }), '2026-11-20'), null);
  assert.equal(dateAfterCutoff(avail(ago(18 * MIN), { stale: true }), '2026-11-20'), null);
  assert.equal(dateAfterCutoff(avail('ei aika'), '2026-11-20'), null);
  assert.equal(dateAfterCutoff(null, '2026-11-20'), null);
});
