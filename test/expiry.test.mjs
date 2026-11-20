import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessExpiry, jwtExpiry, metaTokenExpiry, priceExpiry } from '../server/expiry.mjs';

// valioApi avaa hintavälimuistin kannan heti ladattaessa (db.mjs). Oma väliaikainen kanta, jotta testi toimii myös GitHubin
// testiajossa, jossa data-hakemistoa ei ole.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expiry-test-'));
process.env.AIMO_DB = path.join(dir, 'prices.db');
const { fallbackPriceMaxAgeMs } = await import('../server/valioApi.mjs');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const now = Date.parse('2026-11-19T12:00:00Z');
const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

test('jwtExpiry: exp, ei exp-kenttää ja kelvoton token', () => {
  assert.equal(jwtExpiry(jwt({ exp: 1_800_000_000 })), 1_800_000_000_000);
  assert.equal(jwtExpiry(jwt({ iat: 1 })), Infinity);
  assert.equal(jwtExpiry('ei-jwt'), null);
});

test('metaTokenExpiry: 0 on ikuinen, kelvoton token on vanhentunut', () => {
  assert.deepEqual(metaTokenExpiry({ is_valid: true, expires_at: 0 }), { expiresAt: Infinity, valid: true });
  assert.deepEqual(metaTokenExpiry({ is_valid: true, expires_at: 1_800_000_000 }), { expiresAt: 1_800_000_000_000, valid: true });
  assert.equal(metaTokenExpiry({ is_valid: false }).valid, false);
});

test('FALLBACK_PRICE_MAX_AGE_HOURS: none poistaa rajan, tyhjä on 72 h, luku on tunteja', () => {
  const before = process.env.FALLBACK_PRICE_MAX_AGE_HOURS;
  try {
    process.env.FALLBACK_PRICE_MAX_AGE_HOURS = 'none'; assert.equal(fallbackPriceMaxAgeMs(), Infinity);
    process.env.FALLBACK_PRICE_MAX_AGE_HOURS = ' None '; assert.equal(fallbackPriceMaxAgeMs(), Infinity);
    process.env.FALLBACK_PRICE_MAX_AGE_HOURS = '720'; assert.equal(fallbackPriceMaxAgeMs(), 720 * 3600_000);
    delete process.env.FALLBACK_PRICE_MAX_AGE_HOURS; assert.equal(fallbackPriceMaxAgeMs(), 72 * 3600_000);
  } finally { if (before === undefined) delete process.env.FALLBACK_PRICE_MAX_AGE_HOURS; else process.env.FALLBACK_PRICE_MAX_AGE_HOURS = before; }
});

test('priceExpiry ja raportti: lähestyvä raja varoittaa, ohitettu on vanhentunut, ikuinen on ok', () => {
  const fetched = [now - 25 * DAY, now - 20 * DAY];
  const p = priceExpiry(fetched, 30 * DAY);
  assert.equal(p.first, now + 5 * DAY); assert.equal(p.all, now + 10 * DAY); assert.equal(p.products, 2);
  const rows = assessExpiry({ now, prices: p, whatsapp: { expiresAt: now - 1, valid: true }, turso: { expiresAt: Infinity } });
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [['WHATSAPP_ACCESS_TOKEN', 'expired'], ['TURSO_AUTH_TOKEN', 'ok'], ['FALLBACK_PRICE_MAX_AGE_HOURS', 'warn']]);
  const forever = assessExpiry({ now, prices: priceExpiry(fetched, Infinity), whatsapp: metaTokenExpiry({ is_valid: true, expires_at: 0 }) });
  assert.ok(forever.every((r) => r.status === 'ok'));
  assert.equal(assessExpiry({ now, demoNow: '2026-11-15T09:00:00+02:00' })[0].status, 'warn');
  assert.equal(assessExpiry({ now, prices: priceExpiry([], 1) })[0].status, 'unknown');
});
