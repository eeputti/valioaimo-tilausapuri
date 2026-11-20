// Kiertävä demokello (DEMO_NOW_LOOP_MINUTES): jäädytetyn testirajapinnan tilausaikaraja (su 15.11. klo 17.00) ei koskaan ylity.
// Kello luetaan moduulin latautuessa, joten jokainen tapaus lataa moduulin uudelleen omilla asetuksillaan ja kiinnitetyllä Date.now:lla.
import test from 'node:test';
import assert from 'node:assert/strict';

const realNow = Date.now;
let fake = 0, n = 0;
async function loadClock(env) {
  const saved = { DEMO_NOW: process.env.DEMO_NOW, DEMO_NOW_LOOP_MINUTES: process.env.DEMO_NOW_LOOP_MINUTES };
  for (const [k, v] of Object.entries(env)) if (v == null) delete process.env[k]; else process.env[k] = v;
  Date.now = () => fake;
  try { return await import(`../server/gateway/clock.mjs?case=${++n}`); }
  finally { for (const [k, v] of Object.entries(saved)) if (v == null) delete process.env[k]; else process.env[k] = v; }
}
const iso = (d) => d.toISOString();
test.after(() => { Date.now = realNow; });

test('kiertävä kello pysyy DEMO_NOW:n ja kierron välillä eikä ylitä tilausaikarajaa', async () => {
  fake = Date.parse('2026-11-16T20:00:00+02:00'); // oikea kello on jo rajan jälkeen
  const { clock, cutoffPassed } = await loadClock({ DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_LOOP_MINUTES: '420' });
  assert.equal(clock.simulated, true); assert.equal(clock.looping, true);
  assert.equal(iso(clock.now()), '2026-11-15T07:00:00.000Z');
  fake += 6.5 * 3600_000; assert.equal(iso(clock.now()), '2026-11-15T13:30:00.000Z'); // su 15.30
  fake += 1 * 3600_000; assert.equal(iso(clock.now()), '2026-11-15T07:30:00.000Z'); // kierto: su 9.30
  for (let h = 0; h < 72; h += 1) {
    fake += 3600_000 + 17 * 60_000;
    const t = clock.now().getTime();
    assert.ok(t >= Date.parse('2026-11-15T09:00:00+02:00') && t < Date.parse('2026-11-15T16:00:00+02:00'), iso(clock.now()));
    assert.equal(cutoffPassed('2026-11-15T17:00:00+0200'), false);
    assert.equal(clock.today(), '2026-11-15');
  }
  assert.equal(clock.info().loopMinutes, 420);
});

test('ilman kiertoa DEMO_NOW kulkee eteenpäin kuten ennen, ja ilman DEMO_NOW:ia kello on oikea', async () => {
  fake = Date.parse('2026-11-16T20:00:00+02:00');
  const plain = await loadClock({ DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_LOOP_MINUTES: null });
  assert.equal(plain.clock.looping, false);
  fake += 9 * 3600_000; assert.equal(iso(plain.clock.now()), '2026-11-15T16:00:00.000Z'); // su 18.00, raja mennyt
  assert.equal(plain.cutoffPassed('2026-11-15T17:00:00+0200'), true);
  const real = await loadClock({ DEMO_NOW: null, DEMO_NOW_LOOP_MINUTES: '420' }); // kierto ilman DEMO_NOW:ia ei tee mitään
  assert.equal(real.clock.simulated, false); assert.equal(real.clock.looping, false);
  assert.equal(real.clock.now().getTime(), fake);
});

test('virheellinen kiertoarvo ohitetaan', async () => {
  fake = Date.parse('2026-11-15T08:00:00+02:00');
  for (const bad of ['0', '-5', 'abc', '7h']) {
    const { clock } = await loadClock({ DEMO_NOW: '2026-11-15T09:00:00+02:00', DEMO_NOW_LOOP_MINUTES: bad });
    assert.equal(clock.looping, false, bad);
  }
});
