// Selainkeskustelu: viestit Workerin /api/chat-reitille, joka välittää ne tilausapurille. Kaikki teksti textContentilla.
const $ = (id) => document.getElementById(id);
const log = $('log');
const CART = /(?:https?:\/\/[^\s/]+)?(\/whatsapp\/cart#[A-Za-z0-9_.-]+)/;
const time = (ms = Date.now()) => new Intl.DateTimeFormat('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' }).format(new Date(ms));
let busy = false;
// Live-näkymä (keskustele-live.js) kuuntelee nämä tapahtumat: lähetetty viesti, vastaus, virhe ja palautettu historia.
const emit = (type, detail = {}) => document.dispatchEvent(new CustomEvent(`aimo-chat:${type}`, { detail }));

function richText(text) {
  const p = document.createElement('p');
  String(text).split(/(\*[^*\n]{1,200}\*)/u).forEach((part) => {
    if (/^\*[^*\n]+\*$/u.test(part)) { const b = document.createElement('strong'); b.textContent = part.slice(1, -1); p.append(b); }
    else if (part) p.append(document.createTextNode(part));
  });
  return p;
}
function cartButton(path) {
  const a = document.createElement('a');
  a.className = 'cart-link'; a.href = path;
  a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 7H6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="9" cy="19.5" r="1.5" fill="currentColor"/><circle cx="17" cy="19.5" r="1.5" fill="currentColor"/></svg>';
  a.append(document.createTextNode('Avaa ostoskori'));
  return a;
}
function bubble(text, mine, at, kind = '') {
  const row = document.createElement('div');
  row.className = `msg ${mine ? 'me' : 'bot'}`;
  const b = document.createElement('div');
  b.className = `bubble ${kind}`.trim();
  const link = !mine && CART.exec(text);
  b.append(richText(link ? text.replace(link[0], '').trim() : text));
  if (link) b.append(cartButton(link[1]));
  const t = document.createElement('time');
  t.textContent = time(at);
  if (mine) { const ticks = document.createElement('span'); ticks.className = 'ticks'; ticks.textContent = '✓✓'; t.append(ticks); }
  b.append(t); row.append(b); log.append(row);
  log.scrollTop = log.scrollHeight;
}
function typing(on) {
  $('presence').textContent = on ? 'kirjoittaa…' : 'verkossa';
  $('typing')?.remove();
  if (!on) return;
  const row = document.createElement('div'); row.className = 'msg bot'; row.id = 'typing';
  const b = document.createElement('div'); b.className = 'bubble typing'; b.setAttribute('aria-label', 'Tilausapuri kirjoittaa');
  b.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  row.append(b); log.append(row); log.scrollTop = log.scrollHeight;
}
function offline(message) {
  const box = $('offline');
  box.replaceChildren(document.createTextNode(`${message} `));
  const a = document.createElement('a'); a.href = '/#whatsapp'; a.textContent = 'Kokeile WhatsAppissa →';
  box.append(a); box.hidden = false;
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true; $('send').disabled = true; $('offline').hidden = true;
  bubble(text, true);
  emit('sent', { text });
  $('text').value = ''; resize();
  typing(true);
  try {
    const response = await fetch('/api/chat', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(100_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, messageId: crypto.randomUUID() }) });
    const data = await response.json().catch(() => ({}));
    typing(false);
    if (!response.ok) {
      if (data.code === 'offline' || data.code === 'limit') offline(data.error);
      else bubble(data.error || 'Viestin käsittely ei onnistunut. Yritä uudelleen.', false, Date.now(), 'error');
      emit('error', { offline: data.code === 'offline' });
      return;
    }
    for (const part of data.parts || []) bubble(part, false);
    emit('reply', { parts: data.parts || [] });
  } catch {
    typing(false);
    bubble('Yhteys katkesi. Luonnos säilyy: lähetä viesti uudelleen.', false, Date.now(), 'error');
    emit('error', {});
  } finally { busy = false; $('send').disabled = false; $('text').focus(); }
}

function resize() { const t = $('text'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 120)}px`; }
$('text').addEventListener('input', resize);
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send($('text').value); } });
$('composer').addEventListener('submit', (e) => { e.preventDefault(); void send($('text').value); });
$('reset').addEventListener('click', async () => {
  if (busy) return;
  await fetch('/api/chat/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  location.reload();
});

async function init() {
  try {
    const response = await fetch('/api/chat', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const data = await response.json();
    if (!data.available) offline('Tilausapurin palvelin on juuri nyt tauolla, joten selainkokeilu ei vastaa.');
    for (const m of data.messages || []) {
      bubble(m.text, true, m.at);
      for (const part of m.parts || []) bubble(part, false, m.at);
    }
    emit('history', { available: data.available !== false, messages: data.messages || [] });
    if (!(data.messages || []).length) bubble('Moi! Olen Valio Aimon digitaalinen tilausapuri. Kerro omin sanoin, mitä keittiöön tarvitaan ja milloin. Kokoan ostoskorin, ja sinä vahvistat sen itse.', false);
  } catch { offline('Tilausapuriin ei saatu yhteyttä.'); emit('history', { available: false, messages: [] }); }
  $('text').focus();
}
// Puhelinkehyksen tilarivin kello (piilossa kapealla näytöllä, jossa oikea puhelin näyttää omansa).
function clock() { $('clock').textContent = time(); }
clock(); setInterval(clock, 30_000);
void init();
