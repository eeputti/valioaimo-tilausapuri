// Eelis 16.11.2026: WhatsApp näyttää rivin alun "- " luettelopallona. Lähtevässä Meta-viestissä rivit alkavat
// ajatusviivalla (–), joka näkyy viivana. Moottori ja tallennettu vastaus käyttävät edelleen "- ".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaSender, plainDashes } from '../server/whatsapp/channel.mjs';

test('vain rivin alun "- " vaihtuu ajatusviivaksi', () => {
  assert.equal(plainDashes('Ostoskorissasi nyt:\n- voi\n- maito 20 l'), 'Ostoskorissasi nyt:\n– voi\n– maito 20 l');
  assert.equal(plainDashes('  - sisennetty'), '  – sisennetty');
  assert.equal(plainDashes('Hinta 5 - 6 €, rasvaton-maito'), 'Hinta 5 - 6 €, rasvaton-maito'); // keskellä riviä ei muutu
  assert.equal(plainDashes('-5 astetta\n- \n*Voi:*\n1) Valio voi'), '-5 astetta\n- \n*Voi:*\n1) Valio voi'); // ei luetteloa
  assert.equal(plainDashes(undefined), '');
});

test('Meta-lähettäjä lähettää ajatusviivat sekä tekstinä että korilinkin painikkeessa', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${bodies.length}` }] }) };
  };
  const send = createMetaSender({ apiVersion: 'v25.0', phoneId: '1', accessToken: 'x' }, fetchImpl, { linkButtons: true });
  assert.equal(await send('358000000000', 'Ostoskorissasi nyt:\n- voi 5 kg\n\nMille päivälle toimitus?'), 'wamid.1');
  assert.equal(bodies[0].text.body, 'Ostoskorissasi nyt:\n– voi 5 kg\n\nMille päivälle toimitus?');
  const link = `https://example.test/whatsapp/cart#abc.${'a'.repeat(43)}`;
  await send('358000000000', `Kori:\n- voi 5 kg\n${link}`);
  assert.equal(bodies[1].type, 'interactive');
  assert.equal(bodies[1].interactive.body.text, 'Kori:\n– voi 5 kg');
  assert.equal(bodies[1].interactive.action.parameters.url, link);
});
