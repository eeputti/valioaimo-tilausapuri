// Itsepeli V011 ja V014 (17.11.2026, TYOLOKI): tuotekysymyksen jälkeinen jatko- tai kiitosviesti, jossa on tuotefaktan sana
// ("Eli pakaste, mutta tarkkaa lämpötilaa ei siis ole? Ok, kiitos!", "Sisältää siis maitoa, joten ei käy meille. Kiitos."),
// sai vastauksen "Kerro tuotteen nimi", vaikka tuote oli juuri nimetty. Ei mallia eikä verkkoa: malli korvataan kiinteällä
// vastauksella, tuotteet tulevat oikeasta katalogista.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = fs.existsSync(path.join(ROOT, 'data/catalog.json')) ? false : 'data/catalog.json puuttuu (rajoitettu aineisto)';

async function chat(plans) {
  const { createOrderingDialogue } = await import('../server/whatsapp/dialogue.mjs');
  const { loadCatalog, publicProduct } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE members (binding TEXT PRIMARY KEY); CREATE TABLE turns (binding TEXT)');
  let i = -1;
  const d = createOrderingDialogue({ db, product: (id) => cat.get(String(id)) || null, timeOf: () => Date.parse('2026-11-15T12:00:00+02:00'),
    lookup: async (q) => cat.search(q, { limit: 4 }).map((h) => publicProduct(h.product)),
    ask: async ({ purpose }) => {
      if (purpose === 'whatsapp_dialogue') { i += 1; return { json: { route: 'chat', text: plans[i].text, lookupQuery: plans[i].lookupQuery || '', suggestionTerm: '', openCart: false } }; }
      return { json: { text: '', suggestionTerm: '', addQuestion: '' } };
    } });
  let n = 0;
  return (text) => d.respond({ binding: 'b1', messageId: `m${++n}`, text, runOrder: async () => { throw new Error('ei tilausmoottoria tuotekysymykseen'); }, getShoppingList: () => null });
}

test('V014: jatkokysymys ilman tuotenimeä koskee juuri kysyttyä tuotetta', { skip }, async () => {
  const say = await chat([{ text: '', lookupQuery: 'Vaasan Pizzapohja 60x160g' }, { text: '', lookupQuery: '' }]);
  const first = await say('Missä lämpötilassa Vaasan Pizzapohja 60x160g säilytetään?');
  assert.match(first.text, /Vaasan Pizzapohja 60x160g\*/);
  const next = await say('Joo, selvä. Eli pakaste, mutta tarkkaa lämpötilaa ei siis ole tuotetiedoissa? Ok, kiitos paljon!');
  assert.doesNotMatch(next.text, /Kerro tuotteen nimi/);
  assert.match(next.text, /Vaasan Pizzapohja 60x160g\*/);
  assert.match(next.text, /Lämpötilaluokka: pakaste/);
});

test('V011: kiitosviesti ilman kysymystä ei pyydä tuotteen nimeä eikä toista tuotetietoja', { skip }, async () => {
  const say = await chat([{ text: '', lookupQuery: 'Valio Edam e350 g' }, { text: 'Selvä, hyvä että asia selvisi.', lookupQuery: '' }, { text: '', lookupQuery: '' }]);
  const first = await say('Onko Valio Edam e350 g maidoton? Meillä on maitoallerginen.');
  assert.match(first.text, /Ei, tuote ei ole maidoton: sisältää maitoa\./);
  const thanks = await say('Hei, kiitti tiedosta. Sisältää siis maitoa, joten ei käy meille. Siinä selvä, kiitos paljon.');
  assert.doesNotMatch(thanks.text, /Kerro tuotteen nimi|Valion tuotetiedoista/);
  assert.match(thanks.text, /Selvä, hyvä että asia selvisi\./);
  const bare = await say('Ok, kiitos!');
  assert.doesNotMatch(bare.text, /Kerro tuotteen nimi/);
});

test('kysymyssana ilman kysymysmerkkiä on yhä tuotekysymys, vaikka viestissä on ok', { skip }, async () => {
  const say = await chat([{ text: '', lookupQuery: 'HK Coleslaw 3 kg' }, { text: '', lookupQuery: '' }]);
  await say('Onko HK Coleslaw 3 kg munaton?');
  const next = await say('ok mitä siinä on allergeeneina');
  assert.match(next.text, /HK Coleslaw 3 kg\*/);
  assert.match(next.text, /Allergeenit: kananmuna, sinappi/);
});

test('ilman aiempaa tuotetta tuotteen nimeä kysytään yhä', { skip }, async () => {
  const say = await chat([{ text: '', lookupQuery: '' }]);
  assert.match((await say('Onko se laktoositon?')).text, /Kerro tuotteen nimi/);
});

test('V011: laktoositon mutta maitoa sisältävä tuote maitoallergikolle: ei sovi', { skip }, async () => {
  const { factsReply } = await import('../server/whatsapp/product-facts.mjs');
  const { loadCatalog } = await import('../server/catalog.mjs');
  const edam = loadCatalog().get('473556'); // Valio Edam e350 g: laktoositon, allergeeni maito
  assert.match(await factsReply([edam], ['allergens', 'labels'], 'Tuo laktoositon ja maito allergeeni ei täsmää, onks tuo varmasti oikein? Maitoallergia kuitenkin'),
    /: Laktoositon ei tarkoita maidotonta: tuote sisältää maitoa, joten se ei sovi maitoallergiselle\./);
  assert.match(await factsReply([edam], ['allergens', 'labels'], 'Onko Valio Edam e350 g laktoositon?'), /: Kyllä, tuote on laktoositon/);
});
