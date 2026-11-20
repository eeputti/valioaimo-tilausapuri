// Prompt-välimuisti: kasvava keskustelu omina lohkoinaan ja välimuistiin kirjoituksen hinta kustannusarviossa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { userContent } from '../server/aimoAgent.mjs';
import { costUsd } from '../scripts/whatsapp-selfplay-batch.mjs';

test('ilman vuoroja käyttäjän sisältö kulkee sellaisenaan', () => {
  assert.equal(userContent('moi'), 'moi');
  assert.equal(userContent('moi', []), 'moi');
  const blocks = [{ type: 'text', text: 'kuva' }];
  assert.equal(userContent(blocks), blocks);
});

test('vuorot ovat omia lohkojaan ja vain viimeinen merkitään välimuistiin', () => {
  const content = userContent('{"turn":3}', ['tavoite', 'vuoro 1', 'vuoro 2']);
  assert.deepEqual(content.map((b) => b.text), ['tavoite', 'vuoro 1', 'vuoro 2', '{"turn":3}']);
  assert.deepEqual(content.map((b) => Boolean(b.cache_control)), [false, false, true, false]);
  assert.deepEqual(content[2].cache_control, { type: 'ephemeral' });
});

test('seuraavan kutsun alku on edellisen kutsun merkittyyn lohkoon asti sama', () => {
  const first = userContent('{"turn":2}', ['tavoite', 'vuoro 1']);
  const second = userContent('{"turn":3}', ['tavoite', 'vuoro 1', 'vuoro 2']);
  const strip = ({ cache_control: _, ...rest }) => rest;
  const marked = first.findIndex((b) => b.cache_control);
  assert.deepEqual(second.slice(0, marked + 1).map(strip), first.slice(0, marked + 1).map(strip));
});

test('tyhjä loppu jätetään pois, eikä kutsujan lohkoja muuteta', () => {
  const turn = { type: 'text', text: 'vuoro' };
  const content = userContent('', [turn]);
  assert.equal(content.length, 1);
  assert.equal(turn.cache_control, undefined);
});

test('kustannusarvio hinnoittelee välimuistiin kirjoituksen 1,25-kertaisena', () => {
  const tokens = { input: 3000, cacheRead: 1000, cacheWrite: 1000, output: 0 };
  const expected = (1000 * 0.1 + 1000 * 0.1 * 1.25 + 1000 * 0.01) / 1e6;
  assert.ok(Math.abs(costUsd(tokens, 'claude-haiku-5-5') - expected) < 1e-15);
  assert.ok(Math.abs(costUsd({ input: 2000, cacheRead: 0, output: 0 }, 'claude-haiku-5-5') - 2000 * 0.1 / 1e6) < 1e-15);
});
