// Vaihdettava ääniviestien litterointi. Anthropicin rajapinta ei ota ääntä vastaan, joten puhe muutetaan tekstiksi
// erillisellä palvelulla. Oletus on pois päältä: botti pyytää silloin kirjoittamaan. Maksullinen palvelu otetaan käyttöön
// vain asetuksella ja omalla avaimella (WHATSAPP_TRANSCRIBE), ks. docs/parallel/whatsapp-media-reorder.md.
//
//   WHATSAPP_TRANSCRIBE=none     (oletus) ei litterointia
//   WHATSAPP_TRANSCRIBE=openai   OpenAI /v1/audio/transcriptions, OPENAI_API_KEY, malli oletuksena gpt-transcribe
//                                (whisper-1 ja gpt-4o-*-transcribe poistuvat käytöstä 26.2.2027)
//   WHATSAPP_TRANSCRIBE=groq     Groqin OpenAI-yhteensopiva rajapinta, GROQ_API_KEY, malli oletuksena whisper-large-v3-turbo
//   WHATSAPP_TRANSCRIBE=command  paikallinen ohjelma (esim. ffmpeg + whisper.cpp -kääre): WHATSAPP_TRANSCRIBE_COMMAND saa
//                                äänitiedoston polun ainoana argumenttina ja tulostaa litteroinnin.
// WHATSAPP_TRANSCRIBE_MODEL vaihtaa mallin. Kieli on aina suomi.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MediaRejected } from './media.mjs';

// Sanasto auttaa tunnistamaan keittiön tuotesanat ja yksiköt. Ei ohjeita, vain esimerkkisanoja. Whisper jäljittelee kehotteen
// kirjoitusasua: ilman ääkkösiä se kirjoitti "kermaviilia", ääkkösillä "kermaviiliä" (17.11. Groq-koe). Siksi sanastossa on ä- ja
// ö-sanoja. Epäselvästä äänestä Whisper voi myös palauttaa kehotteen sellaisenaan, joten echoesVocabulary hylkää sen.
export const VOCABULARY = 'Keittiön ääniviesti: jäätelöä, kermaviiliä, täysmaitoa, laktoositonta kevytmaitoa, ruokakermaa, voita, juustoa, kananmunia, jogurttia, rahkaa, säilykkeitä, pähkinätöntä, öljyä, kiloa, litraa, laatikkoa, tänään, huomiseksi, perjantaiksi.';

const words = (s) => String(s || '').normalize('NFC').toLocaleLowerCase('fi-FI').match(/\p{L}+/gu) || [];
const PROMPT_WORDS = words(VOCABULARY);
const PROMPT_PAIRS = new Set(PROMPT_WORDS.slice(1).map((w, i) => `${PROMPT_WORDS[i]} ${w}`));

/** Litterointi, joka on lähinnä kehotteen toistoa ("Keittiön ääniviesti: jäätelöä, kermaviiliä…"), ei ole asiakkaan puhetta. */
export function echoesVocabulary(text) {
  const w = words(text);
  if (w[0] === 'keittiön' && w[1] === 'ääniviesti') return true;
  const pairs = w.slice(1).map((x, i) => `${w[i]} ${x}`);
  if (pairs.length < 3) return false;
  return pairs.filter((p) => PROMPT_PAIRS.has(p)).length / pairs.length >= 0.5;
}

/** Litteroinnin teksti yhtenäiseen muotoon: ä ja ö yhtenä merkkinä (NFC), jotta haku ja tulkinta tunnistavat ne. Kehotteen
 *  toisto palautetaan tyhjänä, jolloin median luku vastaa "En saanut ääniviestistä selvää" eikä lisää keksittyjä tuotteita. */
export function cleanTranscript(text) {
  const t = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return echoesVocabulary(t) ? '' : t;
}
const EXTENSION = { 'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const PROVIDERS = {
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', key: 'OPENAI_API_KEY', model: 'gpt-transcribe' },
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: 'GROQ_API_KEY', model: 'whisper-large-v3-turbo' },
};

/** OpenAI-yhteensopiva /audio/transcriptions (OpenAI, Groq). */
export function createHttpTranscriber({ name, url, apiKey, model, fetchImpl = fetch }) {
  return {
    name, model,
    async transcribe({ buffer, mime }) {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mime }), `voice.${EXTENSION[mime] || 'ogg'}`);
      form.append('model', model); form.append('language', 'fi'); form.append('response_format', 'json');
      form.append('prompt', VOCABULARY);
      const res = await fetchImpl(url, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { authorization: `Bearer ${apiKey}` } });
      // Palvelu ei hyväksy tiedostoa: pysyvä virhe. Avain- ja kuormitusvirheet uusitaan jonossa eivätkä näy asiakkaalle.
      if (res.status === 413) throw new MediaRejected('TOO_LARGE');
      if (res.status === 400 || res.status === 415) throw new MediaRejected('TYPE');
      if (!res.ok) throw new Error(`TRANSCRIBE_HTTP_${res.status}`);
      const data = await res.json();
      return cleanTranscript(typeof data.text === 'string' ? data.text : '');
    },
  };
}

/** Paikallinen ohjelma: tiedosto väliaikaiseen hakemistoon, ohjelma ilman komentotulkkia, tulos stdoutista. */
export function createCommandTranscriber({ command, run = execFile, tmpdir = os.tmpdir() }) {
  return {
    name: 'command', model: path.basename(command),
    async transcribe({ buffer, mime }) {
      const dir = await fs.mkdtemp(path.join(tmpdir, 'aimo-voice-'));
      const file = path.join(dir, `voice.${EXTENSION[mime] || 'ogg'}`);
      try {
        await fs.writeFile(file, buffer, { mode: 0o600 });
        return await new Promise((resolve, reject) => {
          run(command, [file], { timeout: 90_000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (err, stdout) => (err ? reject(new Error('TRANSCRIBE_COMMAND_FAILED')) : resolve(cleanTranscript(stdout))));
        });
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    },
  };
}

/** Asetuksista; palauttaa null, kun litterointia ei ole otettu käyttöön. Virheellinen asetus pysäyttää käynnistyksen. */
export function createConfiguredTranscriber(env = process.env, { fetchImpl = fetch, run } = {}) {
  const provider = (env.WHATSAPP_TRANSCRIBE || 'none').trim().toLowerCase();
  if (provider === 'none' || provider === '') return null;
  if (provider === 'command') {
    const command = env.WHATSAPP_TRANSCRIBE_COMMAND?.trim();
    if (!command || !path.isAbsolute(command)) throw new Error('WHATSAPP_TRANSCRIBE=command tarvitsee WHATSAPP_TRANSCRIBE_COMMAND-asetukseen ohjelman absoluuttisen polun.');
    return createCommandTranscriber({ command, ...(run ? { run } : {}) });
  }
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`Tuntematon WHATSAPP_TRANSCRIBE=${provider}. Vaihtoehdot: none, openai, groq, command.`);
  const apiKey = env[spec.key]?.trim();
  if (!apiKey) throw new Error(`WHATSAPP_TRANSCRIBE=${provider} tarvitsee ${spec.key}-avaimen.`);
  return createHttpTranscriber({ name: provider, url: spec.url, apiKey, model: env.WHATSAPP_TRANSCRIBE_MODEL?.trim() || spec.model, fetchImpl });
}
