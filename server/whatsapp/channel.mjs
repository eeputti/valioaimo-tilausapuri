import crypto from 'node:crypto';
import { phoneNumber } from './store.mjs';
import { messageLinks } from './link-reader.mjs';
import { mediaMessage } from './media.mjs';

// Metan 24 tunnin vastausikkunasta jätetään tunnin varmuusvara: tätä vanhempaan viestiin ei enää vastata.
const ANSWER_WINDOW_MS = 23 * 3600_000;
// Viestin aikaleima saa olla enintään viisi minuuttia palvelimen kelloa edellä.
const CLOCK_AHEAD_MS = 300_000;
const BODY_LIMIT = 256_000;
const TEXT_LIMIT = 4000;
const WEBHOOK_PATH = '/webhooks/whatsapp';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
// Salaisuuksien vertailu vakioajassa. Tiivisteet ovat aina yhtä pitkiä, joten vertailu ei paljasta arvon pituutta.
const sameSecret = (left, right) => crypto.timingSafeEqual(sha256(left), sha256(right));
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
// Webhookin runko tavuina. Yli rajan menevää runkoa ei kerätä muistiin, mutta pyyntö luetaan loppuun ennen 413:a.
// Katkennut pyyntö päättää lukemisen virheeseen (virta tuhoutuu kesken).
async function readBody(req) {
  const kept = []; let total = 0;
  for await (const piece of req) {
    total += piece.length;
    if (total <= BODY_LIMIT) kept.push(piece);
  }
  if (total > BODY_LIMIT) throw Object.assign(new Error('Body limit'), { status: 413 });
  return Buffer.concat(kept);
}
const SIGNATURE = /^sha256=([a-f0-9]{64})$/;
// Metan X-Hub-Signature-256: sovelluksen salaisuudella laskettu HMAC koko rungosta.
export function validSignature(body, header, appSecret) {
  const given = typeof header === 'string' ? SIGNATURE.exec(header)?.[1] : undefined;
  if (!given) return false;
  return sameSecret(given, crypto.createHmac('sha256', appSecret).update(body).digest('hex'));
}

// Webhookin muutokset, jotka koskevat tämän numeron saapuneita viestejä. Tilapäivitykset ja muut numerot ohitetaan.
function* inboundBatches(entries, phoneId) {
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (change?.field === 'messages' && value?.metadata?.phone_number_id === phoneId && Array.isArray(value.messages)) yield value.messages;
    }
  }
}
function writtenContent(m) {
  const body = m.type === 'text' ? m.text?.body : undefined;
  if (typeof body !== 'string' || body.length > TEXT_LIMIT || !body.trim()) return { kind: 'unsupported', text: '' };
  return { kind: 'text', text: body.trim() };
}
// Yksi saapunut viesti jonon muotoon, tai null, jos tunniste tai aikaleima ei kelpaa. Virheellinen lähettäjä heittää.
function inboundMessage(m, now) {
  const phone = phoneNumber(m.from);
  const sentAt = Number(m.timestamp) * 1000;
  const idOk = typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 250;
  const inWindow = Number.isFinite(sentAt) && sentAt <= now + CLOCK_AHEAD_MS && sentAt >= now - ANSWER_WINDOW_MS;
  if (!idOk || !inWindow) return null;
  // Kuva ja ääniviesti jonoon tunnisteena; tiedosto haetaan Metalta vasta käsittelyssä (media.mjs).
  return { id: m.id, phone, sentAt, ...(mediaMessage(m) || writtenContent(m)) };
}
export function extractMessages(payload, ownNumberId, at = Date.now()) {
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return [];
  const found = [];
  for (const batch of inboundBatches(payload.entry, ownNumberId)) {
    for (const m of batch) {
      let item = null;
      try { item = inboundMessage(m, at); } catch { /* lähettäjä tai viestin rakenne ei kelpaa */ }
      if (item) found.push(item);
    }
  }
  return found;
}
// Markdownin **lihavointi** WhatsAppin *lihavoinniksi*.
const whatsappBold = (value) => String(value || '').replace(/\*\*([^*]+)\*\*/g, '*$1*').trim();
export function formatReply(text) {
  const body = whatsappBold(text);
  if (body.length <= 3800) return body;
  return `${body.slice(0, 3700)}\n\nVastaus lyhennetty. Pyydä lisätiedot yhdestä tuotteesta kerrallaan.`;
}

export function replyChunks(messages) {
  const chunks = [];
  for (const value of messages) {
    let text = whatsappBold(value);
    while (text.length > 3800) {
      const newline = text.lastIndexOf('\n', 3800);
      let end = newline > 1900 ? newline : 3800;
      if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--; // preserve an emoji split across UTF-16 units
      chunks.push(text.slice(0, end)); text = text.slice(end).trimStart();
    }
    if (text) chunks.push(text);
  }
  return chunks;
}

// Signed links are long. A reply whose last line is one of these links is shown as a labelled button;
// the URL and its fragment token stay behind the button instead of filling the chat.
const LINK_BUTTONS = [
  [/^https:\/\/[^\s/?#]+\/whatsapp\/cart#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/, 'Avaa ostoskori'],
  [/^https:\/\/[^\s/?#]+\/demo-payment\.html#AGW-\d{8}-\d{4,12}$/, 'Siirry maksamaan'],
];
export function linkButton(text) {
  const lines = String(text || '').trimEnd().split('\n');
  const url = lines.pop().trim();
  const label = LINK_BUTTONS.find(([pattern]) => pattern.test(url))?.[1];
  const body = lines.join('\n').trim().replace(/:$/, '.');
  // Meta allows 1024 body characters; any other link stays as ordinary text.
  if (!label || !body || body.length > 1024 || /https?:\/\//i.test(body)) return null;
  return { body, label, url };
}

// WhatsApp shows a line starting with "- " as a bullet point. An en dash (–) stays a visible dash, as Eelis asked
// on 16.11. Only the shown text changes (Meta and the browser chat, web-chat.mjs): the engine and the stored reply keep "- ".
export function plainDashes(text) {
  return String(text ?? '').replace(/^([ \t]*)- (?=\S)/gm, '$1– ');
}

// A bare "tuki" gets the same fixed answer in WhatsApp and in the browser chat, without a model call.
export const SUPPORT_REQUEST = /^(apua|tuki|asiakaspalvelu|help)$/iu;
export function supportReply({ orderingDemo, supportContact }) {
  return `${orderingDemo ? 'Olen Valio Aimon digitaalinen tilausapuri (demo). Kerro tarvitsemasi tuotteet ja määrät, niin kokoan hyväksyttävän luonnoksen.' : 'Olen Aimon digitaalinen tuoteapuri. Voin hakea tuotteita, hintoja ja toimitusaikoja.'} Kiireelliset toimitusongelmat ja tilausmuutokset hoitaa asiakaspalvelu.\nAsiakaspalvelu: ${supportContact}`;
}

// Lähetetyn viestin tunniste Metan vastauksesta. Virheeseen menee vain HTTP-tila: Metan vastausta tai tunnuksia ei
// koskaan kirjata lokiin eikä näytetä asiakkaalle.
async function sentMessageId(response) {
  const id = response.ok ? (await response.json()).messages?.[0]?.id : null;
  if (id) return id;
  throw new Error(response.ok ? 'META_NO_MESSAGE_ID' : `META_HTTP_${response.status}`);
}

export function createMetaSender(settings, fetchImpl = fetch, { linkButtons = process.env.WHATSAPP_LINK_BUTTONS !== 'false' } = {}) {
  const post = (to, message) => fetchImpl(`https://graph.facebook.com/${settings.apiVersion}/${settings.phoneId}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${settings.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }),
  });
  return async (to, reply) => {
    const text = plainDashes(reply);
    const button = linkButtons && linkButton(text);
    if (button) {
      const res = await post(to, { type: 'interactive', interactive: { type: 'cta_url', body: { text: button.body },
        action: { name: 'cta_url', parameters: { display_text: button.label, url: button.url } } } });
      // A rejected button (400) was not delivered: send the same reply with the plain link instead.
      if (res.status !== 400) return sentMessageId(res);
    }
    return sentMessageId(await post(to, { type: 'text', text: { preview_url: false, body: text } }));
  };
}

// A typing update also marks this inbound message as read. It is not an outgoing chat message.
export function createMetaTypingIndicator(settings, fetchImpl = fetch) {
  return async (messageId) => {
    const res = await fetchImpl(`https://graph.facebook.com/${settings.apiVersion}/${settings.phoneId}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { authorization: `Bearer ${settings.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
    });
    if (!res.ok) {
      // Vain Metan virhekoodi lokiin, ei viestin tekstiä tai tunnuksia.
      const code = typeof res.json === 'function' ? await res.json().then((body) => body?.error?.code, () => null) : null;
      throw new Error(`META_TYPING_HTTP_${res.status}${code ? `_${code}` : ''}`);
    }
  };
}

// Montako eri asiakasta käsitellään yhtä aikaa (audit #12). Saman numeron viestit kulkevat aina järjestyksessä.
export function workerCount(env = process.env) {
  const n = Number.parseInt(env.WHATSAPP_CONCURRENCY ?? '', 10);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 16) : 4;
}

// Ihmismäinen rytmi (Eelis 17.11.): lähekkäin tulleet viestit vastataan yhdellä vuorolla, ja vastauksen osien välissä on
// tauko, joka kasvaa osan pituuden mukaan. Eelis 19.11.: kaksi viestiä 6 s välein saivat kaksi vastausta, joten odotus on
// 6 s viimeisestä viestistä ja enintään 20 s ensimmäisestä. Kanavan oletus (gatherMs 0) pitää vanhan käytöksen;
// runtime.mjs asettaa tuotannon arvot.
export function gatherSettings(env = process.env) {
  const read = (value, fallback, max) => { const n = Number.parseInt(String(value ?? '').trim(), 10); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback; };
  return { gatherMs: read(env.WHATSAPP_GATHER_MS, 6000, 15_000), maxGatherMs: read(env.WHATSAPP_GATHER_MAX_MS, 20_000, 30_000) };
}
/** Tauko ennen vastauksen seuraavaa osaa: lyhyt kuittaus nopeasti, pidempi lista hitaammin (0,7–2,5 s). */
export const humanPartPause = (text) => Math.min(2500, 700 + String(text || '').length * 10);

// Niputuksen katkaisee "tuki": se vastataan heti omana vuoronaan. Vanhentuneen vastauksen uusinnan katkaisee lisäksi linkki,
// joka käsitellään omana vuoronaan kuten ennen (odotusviesti ja linkin luku).
const gatherStop = (text) => SUPPORT_REQUEST.test(String(text || '').trim());
const redoStop = (text) => gatherStop(text) || messageLinks(String(text || '')).length > 0;
// Vuorossa syntynyt tilaus kerrotaan aina asiakkaalle: sen vastausta ei hylätä.
const ORDER_PLACED = new Set(['confirmed', 'pending_approval']);

/** Chatin viestit kierrokselle. Ensimmäisellä kierroksella viimeinen käyttäjävuoro on koko niputettu teksti (ennallaan).
 *  Uusinnassa jo luetut viestit ovat omana vuoronaan ja viimeisenä vain uudet: vanha tilausputki lukee vain viimeisen
 *  vuoron ja on jo käsitellyt aiemmat, joten tila etenee kuin peräkkäisillä viesteillä eikä mitään kirjata kahdesti.
 *  Koko historian lukeva malli näkee molemmat; peräkkäiset käyttäjävuorot yhdistyvät sille yhdeksi. */
function turnMessages(history, turn, input) {
  if (!turn.round) return [...history, { role: 'user', content: input }];
  const texts = (keep) => turn.incoming.filter((m) => keep(m.round)).map((m) => m.text).join('\n');
  return [...history, { role: 'user', content: texts((r) => r < turn.round) }, { role: 'user', content: texts((r) => r === turn.round) }];
}

// Onko aikaa uudelle mallikutsulle: drainin rajaan (until) on vähintään reserveMs. Ilman rajaa (Mac, testit) aina on.
const outOfTime = (at, until, reserveMs) => at >= until || until - at < reserveMs;

// redo: tukeeko chat vanhentuneen vastauksen uusintaa (totuusarvo tai funktio, myös async). Vain v2-agentti tukee: se saa
// hylätyn vastauksen (discardedReply) ja vuoron viestit (incoming). Vanha putki kirjaa jokaisen vastauksensa lähetetyksi
// (historia, lastOrder, näytetty lista), joten oletus on pois ja vastaus lähtee aina (katselmus 19.11., runtime.mjs).
export function createWhatsAppChannel({ settings, store, chat, send, typing, media = null, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, onPrune = () => {},
  concurrency = workerCount(), typingRefreshMs = 20_000, diagnostics = Boolean(process.env.VERCEL), gatherMs = 0, maxGatherMs = 20_000, maxRedos = 2, redo = false, partPause = () => 400 }) {
  // Virhe tuen tarkistuksessa ei kaada valmista vastausta: se lähtee kuten ilman tukea.
  const supportsRedo = async () => { try { return typeof redo === 'function' ? Boolean(await redo()) : redo === true; } catch { return false; } };
  // Pilvessä (Vercel) kirjataan myös onnistunut ilmaisin ja vastauksen viive, jotta puhelimen havainnon voi verrata lokiin.
  // Rivit eivät sisällä viestin tekstiä, numeroa tai tunnuksia.
  const diag = (event, fields) => { if (diagnostics) console.info(JSON.stringify({ event, ...fields })); };
  store.db.exec('CREATE TABLE IF NOT EXISTS wa_link_progress (message_id TEXT PRIMARY KEY, created INTEGER NOT NULL)');
  // One slow customer no longer stops the others (audit #12): up to `concurrency` jobs run at once. The store
  // claims one job at a time atomically and never a second job of a number whose earlier job is still open.
  let inFlight = 0; let claims = 0; let stopped = false; let timer;
  const active = new Set(); const activePhones = new Map();
  const typingUpdates = new Map();
  const updateTyping = (id, force = false) => {
    if (!typing || stopped) return Promise.resolve();
    const prior = typingUpdates.get(id);
    if (!force && prior && now() - prior.at < typingRefreshMs) return prior.work;
    let work; const started = now();
    // Ilmaisin on kosmeettinen: virhe ei koskaan estä vastausta, mutta se kirjataan, jotta katkos näkyy lokista.
    const failed = (err) => console.warn(JSON.stringify({ event: 'typing_failed',
      error: err?.name === 'TimeoutError' ? 'TIMEOUT' : String(err?.message || err).slice(0, 120) }));
    try { work = Promise.resolve(typing(id)).then(() => diag('typing_sent', { ms: now() - started, refresh: Boolean(prior) }), failed); } catch (err) { failed(err); work = Promise.resolve(); }
    typingUpdates.set(id, { at: now(), work });
    // Cancelled queued work may never be selected by the worker; keep receipt bookkeeping bounded.
    if (typingUpdates.size > 1000) typingUpdates.delete(typingUpdates.keys().next().value);
    return work;
  };
  let lastPrune = now(); let lastWaiting = 0;
  const supportLine = 'Asiakaspalvelu: ' + settings.supportContact;
  // Vastaus kirjoitetaan valmiiksi ja suljettu viesti ilmoitetaan tällä merkillä (prepareReply ja modelReply).
  const CLOSED = Symbol('closed');
  const closeJob = (job, state, replyId = null) => { store.finish(job.id, state, replyId); return true; };
  const pastWindow = (job) => now() - job.sent_at >= ANSWER_WINDOW_MS;
  // Numero poistettiin tai yhdistettiin uudelleen sen jälkeen, kun viesti tuli: vanhan liitoksen viestiin ja vastaukseen
  // ei enää vastata. Liittämättömän numeron viestillä ei ole liitosta, joten sitä tämä ei koske eikä kantaa kysytä.
  // Jos kutsuja on jo hakenut jäsenen (myös tuloksella undefined), käytetään sitä; muuten haetaan tuore tieto.
  const lostBinding = (job, ...known) => {
    if (!job.binding) return false;
    const current = known.length ? known[0] : store.member(job.phone);
    return current?.binding !== job.binding;
  };
  // A message waiting behind a full worker pool keeps showing "typing" to its sender. A number whose
  // earlier message is being answered already shows it from that job.
  function refreshWaiting() {
    if (!typing || stopped || now() - lastWaiting < Math.min(5000, typingRefreshMs)) return;
    lastWaiting = now();
    const busyPhones = new Set(activePhones.values());
    for (const job of store.waiting(now() - 5 * 60_000)) {
      if (!busyPhones.has(job.phone) && now() - job.sent_at < ANSWER_WINDOW_MS) updateTyping(job.id);
    }
  }

  // Yhdistämisviesti: viesti tulee itse numerosta, joten tämän numeron kutsua vastaava koodi todistaa omistajuuden
  // (audit #14). job.text on koodin tiiviste (store.enqueue).
  function pairingReply(job) {
    const linked = store.pair(job.phone, job.text, job.id);
    if (!linked) return 'Yhdistämiskoodi on virheellinen, käytetty tai vanhentunut, tai yrityksiä on liikaa. Pyydä ylläpitäjältä uusi koodi ja tarvittaessa odota 15 minuuttia.';
    job.binding = linked.binding;
    const nextStep = settings.orderingDemo ? 'Kerro tuotteet ja määrät, niin kokoan demotilausluonnoksen. Oikeaa Valio-tilausta ei lähetetä.' : 'Voit kysyä tuotteita, hintoja ja toimitusaikoja. Tämä testiversio ei tee tilauksia.';
    return `Testiyhteys yhdistetty: ${linked.person}, ${linked.company}. ${nextStep}\n${supportLine}`;
  }
  // Vastaukset, joihin ei tarvita mallia. null = viesti menee tilauskeskusteluun.
  function fixedReply(job, member) {
    if (job.kind === 'pair') return pairingReply(job);
    if (!member || !job.binding) {
      return 'Numeroasi ei ole yhdistetty asiakastiliin. Pyydä yrityksesi ylläpitäjältä yhdistämiskoodi ja lähetä: YHDISTA koodi\n' + supportLine;
    }
    const mediaJob = job.kind === 'image' || job.kind === 'audio';
    if (job.kind === 'unsupported' || (mediaJob && !media)) {
      return media ? `Käsittelen tekstiviestit${media.enabled.audio ? ', ääniviestit' : ''} ja kuvat ostoslistasta tai lähetteestä. Kirjoita tilaus viestinä tai lähetä kuva (enintään 4000 merkkiä tekstiä).`
        : 'Lähetä enintään 4000 merkin tekstiviesti. Tämä testiversio ei käsittele kuvia, ääniviestejä tai liitteitä.';
    }
    if (job.kind === 'text' && SUPPORT_REQUEST.test(job.text)) return supportReply(settings);
    return null;
  }

  // Tilauskeskustelun vastaus: kuvan tai ääniviestin luku, linkin odotusviesti ja chat-kutsu uusintoineen.
  // Palauttaa { reply, parts, binding, text } tai CLOSED, jos numeron liitos vaihtui kesken.
  async function modelReply(job, member, turn, gathering, until, reserveMs) {
    let reply; let parts; let historyBinding; let historyText;
    let input = job.text; let note = ''; let label = job.text;
    try {
      if (job.kind === 'image' || job.kind === 'audio') {
        // Kuvan tai litteroinnin teksti kulkee samaan tilauskeskusteluun kuin kirjoitettu viesti.
        const read = await media.read(job);
        if (read.reply) reply = read.reply; else ({ input, note, history: label } = read);
      }
    } catch (err) {
      if (job.attempts < 3) throw err;
      reply = `${job.kind === 'audio' ? 'Ääniviestin' : 'Kuvan'} lukeminen ei nyt onnistunut. Kirjoita tilaus viestinä tai lähetä ${job.kind === 'audio' ? 'viesti' : 'kuva'} hetken kuluttua uudelleen.\n${supportLine}`;
    }
    if (!reply) try {
      if (settings.orderingDemo && messageLinks(input).length) {
        // Reserve before delivery: a worker retry must not repeat the waiting message.
        // This cosmetic receipt is separate from the durable final reply and its history.
        store.db.prepare('DELETE FROM wa_link_progress WHERE created<?').run(now() - 7 * 86400_000);
        const fresh = store.db.prepare('INSERT OR IGNORE INTO wa_link_progress VALUES(?,?)').run(job.id, now());
        if (fresh.changes && !stopped && !lostBinding(job)) {
          try { await send(job.phone, 'Hetki, avaan linkin ja katson, mitä siihen sopisi Aimon valikoimasta.', job.id); } catch { /* Final answer still proceeds if the waiting receipt fails. */ }
        }
        if (lostBinding(job)) { closeJob(job, 'cancelled'); return CLOSED; }
      }
      const history = store.history(member.binding);
      // Vanhentuneen vastauksen esto koskee tavallista tekstivuoroa. Linkin, kuvan ja ääniviestin vastaus lähtee kuten ennen.
      const redoable = gathering && !messageLinks(input).length;
      turn ||= { round: 0, incoming: [{ text: input, at: Number(job.sent_at), round: 0 }] };
      for (;;) {
        // incoming: tämän vastauksen asiakasviestit erikseen aikaleimoineen (v2-agentti). Vanha putki lukee messages-kentän.
        const result = await chat({ messages: turnMessages(history, turn, input), channel: 'whatsapp', member,
          messageId: turn.round ? `${job.id}:r${turn.round}` : job.id, receivedAt: job.sent_at,
          incoming: turn.incoming.map(({ text, at, round }) => ({ text, at, round })),
          ...(turn.round ? { discardedReply: turn.discardedReply } : {}) });
        parts = replyChunks(Array.isArray(result.messages) && result.messages.length ? result.messages : [result.text]);
        if (!parts.length) throw new Error('EMPTY_REPLY');
        // Ensin oma lyhyt viesti siitä, mitä kuvasta luettiin tai ääniviestistä kuultiin, jotta asiakas voi tarkistaa sen.
        if (note) parts.unshift(note);
        reply = parts.join('\n\n');
        // Vastaus on valmis mutta lähettämättä. Jos chat tukee uusintaa ja asiakas ehti kirjoittaa lisää, vastausta ei
        // lähetetä: uudet viestit liitetään samaan vuoroon ja chat saa ne hylätyn vastauksen kanssa (enintään maxRedos
        // kertaa). Muuten vastaus lähtee, ja uudet viestit saavat oman vuoronsa. Peruttu numero ei saa uutta kierrosta.
        if (!redoable || turn.round >= maxRedos || stopped || outOfTime(now(), until, reserveMs) || ORDER_PLACED.has(result?.status)
          || !(await supportsRedo()) || lostBinding(job)) break;
        const more = store.absorb(job, store.followers(job, redoStop), { round: turn.round + 1, discardedReply: reply });
        if (!more) break;
        job.text = more.text; label = more.text; turn = more.turn;
        diag('reply_discarded', { round: turn.round, count: turn.incoming.filter((m) => m.round === turn.round).length });
      }
      historyBinding = member.binding; historyText = label;
    } catch (err) {
      // Tilausvuoro on idempotentti Metan viestitunnisteen mukaan: sama vuoro yritetään uudelleen sen sijaan, että
      // arvattaisiin, tallentuiko tilaus. Vasta viimeinen yritys vastaa, eikä se väitä tilauksesta mitään.
      if (settings.orderingDemo && job.attempts < 3) throw err;
      parts = undefined; // hylätyn kierroksen osat eivät saa lähteä virheviestin sijaan
      reply = settings.orderingDemo
        ? `Viestin käsittely ei nyt onnistunut. Luonnoksesi säilyy. Lähetä viesti hetken kuluttua uudelleen, niin näet tilanteen ennen kuin vahvistat mitään.\n${supportLine}`
        : `Tuotehaku ei nyt onnistunut. Yritä hetken kuluttua uudelleen. Tilausta ei ole tehty.\n${supportLine}`;
    }
    return { reply, parts, binding: historyBinding, text: historyText };
  }

  // Uusi vastaus jonon viestille: niputus, sääntövastaus tai tilauskeskustelu. Vastaus ja sen osat tallennetaan ennen
  // lähetystä. Palauttaa vastauksen tai CLOSED, jos viesti suljettiin vastaamatta.
  async function prepareReply(job, member, { until, reserveMs }) {
    // Niputus: odotetaan hetki, tuleeko samalta numerolta lisää tekstiä ("20l maitoa" / "ja voita" / "maanantaiks"),
    // ja vastataan kaikkiin kerralla. Jokainen uusi viesti pidentää odotusta gatherMs verran, enintään maxGatherMs.
    // Tässä vaiheessa liitos on jo tarkistettu, joten job.binding riittää kertomaan, että numero on liitetty.
    const gathering = gatherMs > 0 && job.kind === 'text' && Boolean(job.binding) && !SUPPORT_REQUEST.test(job.text);
    // Uusintayritys jatkaa tallennetusta vuorosta ja kierroksesta. Se ei liitä uusia viestejä ennen chat-kutsua, koska
    // edellinen yritys on voinut jo ajaa saman kierroksen: vanha putki palauttaisi silloin tallennetun tuloksen ilman niitä.
    // Ne liitetään vasta kutsun jälkeen uudeksi kierrokseksi.
    let turn = gathering && job.attempts > 1 ? store.turn(job) : null;
    if (gathering && job.attempts <= 1) {
      const first = Number(job.received);
      for (let i = 0; i < 20; i += 1) {
        const latest = Math.max(first, ...store.followers(job, gatherStop).map((f) => Number(f.received)));
        const end = Math.min(latest + gatherMs, first + maxGatherMs, until);
        if (stopped || now() >= end) break;
        await pause(end - now());
      }
      const gathered = store.absorb(job, store.followers(job, gatherStop));
      if (gathered) {
        job.text = gathered.text; turn = gathered.turn;
        diag('messages_gathered', { count: turn.incoming.length });
      }
    }
    // Landing-ilmoittautuminen poistettiin 17.11.2026. Ennen sitä jonoon jäänyt koodiviesti ohitetaan vastaamatta.
    if (job.kind === 'signup') { closeJob(job, 'cancelled'); return CLOSED; }
    const fixed = fixedReply(job, member);
    const answer = fixed === null ? await modelReply(job, member, turn, gathering, until, reserveMs) : { reply: fixed };
    if (answer === CLOSED) return CLOSED;
    // Hidas mallikutsu ehti ehkä ohi liitoksen poiston: poistettu liitos ei saa vastausta.
    if (lostBinding(job)) { closeJob(job, 'cancelled'); return CLOSED; }
    // Historiaan luettu teksti, ei median tunnistetta.
    store.saveReply(answer.text ? { ...job, text: answer.text } : job, answer.reply, answer.binding, answer.parts || replyChunks([answer.reply]));
    return answer.reply;
  }

  // Lähettää tallennetut osat järjestyksessä. Jo lähetetty osa (reply_id) ohitetaan, joten uusinta ei tuplaa viestejä.
  async function deliver(job, reply) {
    let lastId;
    for (const part of store.replyParts(job.id, reply)) {
      if (part.reply_id) { lastId = part.reply_id; continue; }
      if (part.part > 0) {
        await updateTyping(job.id, true);
        await pause(partPause(part.text));
      }
      if (lostBinding(job)) return closeJob(job, 'cancelled');
      lastId = await send(job.phone, part.text, job.id);
      store.saveReplyPart(job.id, part.part, lastId);
    }
    closeJob(job, 'done', lastId);
    diag('reply_sent', { sinceReceiptMs: now() - Number(job.received) });
    return true;
  }

  // Varaa seuraavan viestin ja kirjaa sen käynnissä olevaksi. processNext varaa ennen ensimmäistä awaitia (pump).
  function claimNext() {
    const job = store.next();
    if (!job) return null;
    claims += 1; activePhones.set(job.id, job.phone);
    return job;
  }

  // until: pilven drainin aikaraja (server/cloud.mjs). Niputus ei odota sen yli, eikä uusintaa aloiteta, kun rajaan on alle
  // reserveMs: uusi mallikutsu voi kestää koko varauksen. Muuten vuoro vain viimeistelee käynnissä olevan kutsun ja lähettää.
  async function processNext({ until = Infinity, reserveMs = 0 } = {}) {
    if (stopped || inFlight >= concurrency) return false;
    inFlight += 1;
    let job; let typingTimer; let typingUpdate = Promise.resolve();
    try {
      job = claimNext();
      if (job === null) return false;
      if (pastWindow(job)) return closeJob(job, 'expired');
      const account = store.member(job.phone);
      if (lostBinding(job, account)) return closeJob(job, 'cancelled');
      if (typing) {
        const indicate = () => {
          if (stopped || pastWindow(job) || lostBinding(job)) return;
          // Start before model work, without delaying it. Cosmetic failures never retry an order turn.
          typingUpdate = updateTyping(job.id);
        };
        indicate();
        // Meta clears typing on reply or after 25 seconds. Refresh only while this job is active.
        typingTimer = setInterval(indicate, typingRefreshMs); typingTimer.unref?.();
      }
      // Tallennettu vastaus (keskeytynyt lähetys) lähetetään sellaisenaan; muuten vastaus kirjoitetaan nyt.
      const reply = job.reply || await prepareReply(job, account, { until, reserveMs });
      if (reply === CLOSED) return true;
      // Finish the last status request before replying, so a slow typing update cannot arrive after the answer.
      clearInterval(typingTimer); await typingUpdate;
      if (lostBinding(job)) return closeJob(job, 'cancelled');
      return await deliver(job, reply);
    } catch (err) {
      if (job) {
        store.retry(job, /^META_HTTP_\d+$/.test(err.message) ? err.message : 'PROCESSING_OR_DELIVERY_ERROR');
      }
      return false;
    } finally { clearInterval(typingTimer); if (job) { typingUpdates.delete(job.id); activePhones.delete(job.id); } inFlight -= 1; }
  }
  // Fill the free worker slots. processNext claims its job before its first await, so `claims` tells at once
  // whether there was anything to take. A finished job wakes the pool, so the same number's next message
  // starts without waiting for the timer.
  function pump() {
    while (!stopped && inFlight < concurrency) {
      const before = claims;
      const work = processNext();
      // Nothing to take: that call already returned. Re-waking here would poll the database in a tight loop.
      if (claims === before) break;
      active.add(work);
      work.finally(() => { active.delete(work); if (timer && !stopped) setImmediate(pump); });
    }
  }
  const housekeeping = () => { store.prune(); onPrune(); };
  // Ajastimen kierros puolen sekunnin välein: siivous kerran tunnissa, odottaville "kirjoittaa" ja vapaat paikat työhön.
  function tick() {
    if (now() - lastPrune >= 3600_000) { housekeeping(); lastPrune = now(); }
    refreshWaiting();
    pump();
  }

  // GET: Metan webhookin vahvistus. Vastataan haasteella vain oikealla vahvistustunnuksella.
  function answerVerification(params, res) {
    const subscribing = params.get('hub.mode') === 'subscribe';
    if (!subscribing || !sameSecret(params.get('hub.verify_token') || '', settings.verifyToken)) {
      sendJson(res, 403, { error: 'Verification failed' });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(params.get('hub.challenge') || '');
  }
  // POST: allekirjoitettu webhook. Viestit vain kirjataan jonoon; mallityö ja lähetys tehdään pyynnön ulkopuolella.
  async function acceptWebhook(req, res) {
    const body = await readBody(req);
    if (!validSignature(body, req.headers['x-hub-signature-256'], settings.appSecret)) {
      sendJson(res, 403, { error: 'Invalid signature' });
      return;
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch {
      sendJson(res, 400, { error: 'Invalid JSON' });
      return;
    }
    const queued = extractMessages(payload, settings.phoneId, now()).filter((message) => store.enqueue(message)).map((message) => message.id);
    sendJson(res, 200, { received: true });
    // Uusi lähettäjä näkee "kirjoittaa" heti, vaikka toista keskustelua käsiteltäisiin.
    for (const id of queued) updateTyping(id);
    // Käynnissä oleva käsittelijä herätetään heti eikä vasta seuraavalla 500 ms:n kierroksella.
    if (queued.length && timer) setImmediate(() => { if (!stopped) pump(); });
  }

  return {
    processNext,
    // Pilvi odottaa tätä ennen jonon käsittelyä. Tursoon menevät kantakutsut pysäyttävät säikeen kutsun ajaksi
    // (server/sqlite.mjs), joten muuten kesken jäänyt ilmaisinpyyntö ei etene ja sen 3 s aikaraja umpeutuu ennen lähtöä.
    async typingSettled() { await Promise.all([...typingUpdates.values()].map((v) => v.work)); },
    // Cloud: work the queue in parallel until it is empty or the time is used. Several drains in one instance share the slots.
    // Uutta työtä ei oteta, kun aikaa on alle reserveMs: koko vuoro ehtii ennen kuin pilvi katkaisee kutsun (server/cloud.mjs).
    async drain(budgetMs, { reserveMs = 0 } = {}) {
      const until = now() + budgetMs; let processed = 0;
      const loop = async () => { while (!stopped && !outOfTime(now(), until, reserveMs) && await processNext({ until, reserveMs })) processed += 1; };
      await Promise.all(Array.from({ length: concurrency }, loop));
      return processed;
    },
    // Mac: jatkuva käsittelijä. Kesken jääneet käsittelyt palautetaan jonoon ja vanhat rivit siivotaan heti alussa.
    start() {
      if (timer) return;
      store.recover();
      housekeeping();
      timer = setInterval(tick, 500);
      timer.unref();
    },
    async stop() { stopped = true; clearInterval(timer); await Promise.all([...active]); await Promise.all([...typingUpdates.values()].map((v) => v.work)); typingUpdates.clear(); },
    async handle(req, res, url) {
      const target = url ?? new URL(req.url, 'http://localhost');
      if (target.pathname !== WEBHOOK_PATH) return false;
      try {
        if (req.method === 'GET') answerVerification(target.searchParams, res);
        else if (req.method === 'POST') await acceptWebhook(req, res);
        else sendJson(res, 405, { error: 'Method not allowed' });
      } catch (err) {
        sendJson(res, err.status || 500, { error: 'Webhook processing failed' });
      }
      return true;
    },
  };
}
