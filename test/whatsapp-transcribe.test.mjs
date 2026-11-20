// Ääniviestin litteroinnin ääkköset ja kehotteen toiston esto (17.11.2026 WhatsApp-koe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { VOCABULARY, cleanTranscript, echoesVocabulary, createHttpTranscriber, createCommandTranscriber } from '../server/whatsapp/transcribe.mjs';

const OGG = Buffer.from('OggS fake');

test('sanastossa on ääkkösiä, jotta Whisper kirjoittaa ä:n ja ö:n eikä a:ta ja o:ta', () => {
  assert.match(VOCABULARY, /ä/);
  assert.match(VOCABULARY, /ö/);
  for (const word of ['jäätelöä', 'kermaviiliä', 'täysmaitoa', 'säilykkeitä', 'öljyä']) assert.ok(VOCABULARY.includes(word), word);
});

test('hajotetut ääkköset (NFD) yhdistetään yhdeksi merkiksi, jotta haku tunnistaa sanan', () => {
  const nfd = 'jäätelöä viisi kiloa';
  assert.equal(cleanTranscript(nfd), 'jäätelöä viisi kiloa');
  assert.equal(cleanTranscript(nfd).length, 'jäätelöä viisi kiloa'.length);
  assert.equal(cleanTranscript('  kymmenen\n litraa   maitoa '), 'kymmenen litraa maitoa');
});

test('kehotteen toisto ei ole asiakkaan puhetta: tyhjä tulos, ei keksittyjä tuotteita', () => {
  assert.equal(echoesVocabulary(VOCABULARY), true);
  assert.equal(echoesVocabulary('Keittiön ääniviesti, jäätelöä.'), true);
  assert.equal(echoesVocabulary('jäätelöä, kermaviiliä, täysmaitoa, laktoositonta kevytmaitoa, ruokakermaa'), true);
  assert.equal(cleanTranscript('Keittiön ääniviesti: jäätelöä, kermaviiliä'), '');
  // Tavallinen tilaus, jossa on samoja tuotesanoja, menee läpi.
  for (const said of ['Tarvitsen huomiseksi kymmenen litraa täysmaitoa ja neljä kiloa voita', 'jäätelöä ja kermaviiliä perjantaiksi', 'viisi kiloa voita', 'Moi, tarvitsisin perjantaiksi 2 kiloa jäätelöä, 3 litraa kermaviiliä']) {
    assert.equal(echoesVocabulary(said), false, said);
    assert.equal(cleanTranscript(said), said);
  }
});

test('HTTP- ja paikallinen litterointi palauttavat siivotun tekstin, sanasto lähtee kehotteena', async () => {
  let form;
  const http = createHttpTranscriber({ name: 'groq', url: 'https://api.example/x', apiKey: 'k', model: 'm', fetchImpl: async (url, opts) => {
    form = Object.fromEntries([...opts.body.entries()].filter(([, v]) => typeof v === 'string'));
    return Response.json({ text: ' jäätelöä  kaksi kiloa ' });
  } });
  assert.equal(await http.transcribe({ buffer: OGG, mime: 'audio/ogg' }), 'jäätelöä kaksi kiloa');
  assert.equal(form.prompt, VOCABULARY);
  assert.equal(form.language, 'fi');
  const echo = createHttpTranscriber({ name: 'groq', url: 'https://api.example/x', apiKey: 'k', model: 'm', fetchImpl: async () => Response.json({ text: VOCABULARY }) });
  assert.equal(await echo.transcribe({ buffer: OGG, mime: 'audio/ogg' }), '');
  const local = createCommandTranscriber({ command: '/usr/local/bin/aimo-whisper', run: (cmd, args, opts, cb) => cb(null, ' söljyä 2 litraa \n') });
  assert.equal(await local.transcribe({ buffer: OGG, mime: 'audio/ogg' }), 'söljyä 2 litraa');
});
