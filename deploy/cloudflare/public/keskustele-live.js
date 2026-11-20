// Keskustele-sivun live-näkymä isolla ruudulla: mitä agentti on ymmärtänyt tästä keskustelusta, koodina.
// Lähteet ovat samat kuin ostoskorisivulla: /api/chat/cart antaa tämän selaimen korilinkin, ja sen avaimella
// /whatsapp/cart/api palauttaa botin tallentaman rakenteisen tarpeen (tuotteet, määrät, päivä, ruokavalio, valinnat).
// Ei malli- eikä Valio-kutsuja. Kaikki teksti textContentilla.
import { nf, day, quantity, CLAIM, ALLERGEN, lit, short, ident, renderCode, createPlayer } from './agent-code.js';

const CART_LINK = /\/whatsapp\/cart#/;
const OPTION = /^\s*(\d{1,2})\)\s+(.+?)\s*$/gmu;

/** Botin viimeisimmän vastauksen numeroidut vaihtoehdot ("1) nimi, pakkaus, hinta"), ilman "näytä lisää" -riviä. */
export function replyOptions(parts = []) {
  const out = [];
  for (const m of parts.join('\n').matchAll(OPTION)) {
    if (/näytä lisää|lisää vaihtoehtoja/iu.test(m[2])) continue;
    out.push({ n: Number(m[1]), text: m[2] });
  }
  return out;
}

const extras = (claims = [], allergens = []) => [...claims.map((c) => CLAIM[c] || c), ...allergens.map((a) => `ei ${ALLERGEN[a] || a}`)];

/**
 * Keskustelun tila koodiriveiksi samassa muodossa kuin agentin jälki (agent-code.js).
 * later: rivi, jota ei ole vielä ajettu (näytetään himmeänä).
 */
export function liveLines({ messages = [], replies = [], list = null, busy = false, linkSent = false } = {}) {
  const out = [];
  const code = (text, later = false) => out.push({ i: 0, code: text, later });
  const res = (text, { i = 1, tone = '', note = '', later = false } = {}) => out.push({ i, res: text, tone, note, later });
  const gap = () => out.push({});
  const pipeline = (date = '') => {
    code('// kun kokki vahvistaa ostoskorisivulla:', true);
    code(`const tarjous = await portti.post("/v1/quotes", { deliveryDate: ${lit(date)}, needs })`, true);
    res('allekirjoitettu tarjous: tuotteet ja hinnat lukitaan', { tone: 'muted', later: true });
    code('const tilaus = await portti.post("/v1/orders", { offers: tarjous.offers, idempotencyKey })', true);
    res('ostovaltuus ja päätösketju, vasta sitten tilaus kirjataan', { tone: 'muted', later: true });
  };

  code('import { selain, tulkki, tuotteet, ostoskori, portti } from "aimo"');
  gap();
  code('const viestit = await selain.vastaanota()   // Keskustele → POST /api/chat');
  if (!messages.length) {
    res('kirjoita vasemmalle, mitä keittiöön tarvitaan ja milloin', { tone: 'muted' });
    gap();
    code('const tarve = await tulkki.ymmärrä(viestit)   // kielimalli + tilausmoottorin säännöt', true);
    code('const tuote = await tuotteet.hae(tarve, { toimitus })', true);
    code('const kori = await ostoskori.päivitä(tarve)', true);
    gap();
    pipeline();
    return out;
  }
  const shown = messages.slice(-5);
  if (messages.length > shown.length) res(`… ${nf(messages.length - shown.length)} viestiä aiemmin`, { tone: 'muted' });
  for (const text of shown) res(lit(short(text, 64)));
  gap();

  code('const tarve = await tulkki.ymmärrä(viestit)   // kielimalli + tilausmoottorin säännöt');
  if (busy) { res('tulkitaan uusinta viestiä…', { tone: 'muted' }); return out; }
  if (!list) {
    res(linkSent ? 'ei avointa koria: tilaus vahvistettu ostoskorisivulla tai aloitettu alusta' : 'ei vielä tilattavia tuotteita, keskustelu jatkuu', { tone: 'muted' });
    gap();
    pipeline();
    return out;
  }
  const lines = list.lines || [];
  const missing = new Set(list.missing || []);
  for (const line of lines) {
    const more = extras(line.claims, line.excludeAllergens);
    res(`${line.productTerm} ${line.quantity ? quantity(line.quantity) : '(määrä puuttuu)'}${more.length ? `, ${more.join(', ')}` : ''}`, { tone: line.quantity ? '' : 'warn' });
  }
  const diet = extras(list.diet?.claims, list.diet?.excludeAllergens);
  if (diet.length) res(`koko tilaus: ${diet.join(', ')}`);
  res(list.deliveryDate ? `toimitus ${day(list.deliveryDate)}` : 'toimituspäivä puuttuu: agentti kysyy sen ensin', { tone: list.deliveryDate ? '' : 'warn' });
  for (const line of lines) if (missing.has(`preference:${line.ref}`)) res(`tarkennettava: ${line.productTerm}`, { tone: 'warn' });
  gap();

  const options = replyOptions(replies);
  const used = new Set();
  let optionsShown = false;
  for (const line of lines) {
    const args = [`toimitus: ${lit(list.deliveryDate || '')}`];
    if (line.claims?.length) args.push(`vaatimus: [${line.claims.map((c) => lit(CLAIM[c] || c)).join(', ')}]`);
    if (line.excludeAllergens?.length) args.push(`ilman: [${line.excludeAllergens.map((a) => lit(ALLERGEN[a] || a)).join(', ')}]`);
    code(`const ${ident(line.productTerm, used)} = await tuotteet.hae(${lit(line.productTerm || '')}, { ${args.join(', ')} })`, !list.deliveryDate);
    if (!list.deliveryDate) res('odottaa toimituspäivää: tuotteita ei haeta ennen sitä', { tone: 'muted' });
    else if (line.selectedName) res(`valittu: ${line.selectedName}`, { tone: 'good' });
    else if (!optionsShown && options.length) {
      optionsShown = true;
      res(`${nf(options.length)} tilattavaa vaihtoehtoa, kokki valitsee numerolla`, { tone: 'warn' });
      for (const o of options.slice(0, 4)) res(`${o.n}) ${short(o.text, 58)}`, { i: 2, tone: 'muted' });
    } else res(line.quantity ? 'odottaa kokin valintaa' : 'odottaa määrää', { tone: 'warn' });
  }
  gap();

  code(`const kori = await ostoskori.päivitä(tarve)   // kori v${list.revision ?? 0}`);
  const picked = lines.filter((l) => l.selectedName).length;
  if (list.status === 'review') res(`${nf(lines.length)} ${lines.length === 1 ? 'rivi' : 'riviä'} valmiina, kokki tarkistaa ja vahvistaa itse`, { tone: 'good' });
  else if (list.status === 'needs_details') res(`puuttuu ${nf(missing.size)} ${missing.size === 1 ? 'tieto' : 'tietoa'}, agentti kysyy ne`, { tone: 'warn' });
  else res(`${nf(picked)}/${nf(lines.length)} tuotetta valittu`, { tone: 'warn' });
  gap();
  if (list.status === 'review' || linkSent) {
    code('const linkki = await ostoskori.linkki()   // kokki vastaa "ok"', !linkSent);
    res(linkSent ? 'korilinkki lähetetty: kokki avaa korin ja vahvistaa tilauksen' : 'vastaa "ok", niin saat linkin ostoskoriin', { tone: linkSent ? 'good' : 'muted' });
    gap();
  }
  pipeline(list.deliveryDate || '');
  return out;
}

const key = (l) => `${l.i ?? ''}|${l.code ?? ''}|${l.res ?? ''}|${l.tone ?? ''}|${l.later ? 1 : 0}`;

function mount() {
  const $ = (id) => document.getElementById(id);
  const panel = $('live');
  if (!panel) return;
  const list = $('live-lines'), scroller = $('live-scroll');
  let follow = true;
  scroller.addEventListener('scroll', () => { follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48; }, { passive: true });
  const runner = createPlayer(list, $('live-state'), { onLine: () => { if (follow) scroller.scrollTop = scroller.scrollHeight; } });
  const st = { messages: [], replies: [], turns: [], list: null, busy: false, linkSent: false, available: true };
  let previous = [];
  // Aside on piilossa kapealla ruudulla: silloin ei haeta mitään.
  const visible = () => panel.getClientRects().length > 0;

  function draw() {
    // Korilinkki on ajankohtainen, jos se tuli kahden viimeisimmän vastauksen aikana.
    st.linkSent = st.turns.slice(-2).some((parts) => parts.some((p) => CART_LINK.test(p)));
    const lines = liveLines(st);
    const keys = lines.map(key);
    let from = 0;
    while (from < keys.length && from < previous.length && keys[from] === previous[from]) from++;
    previous = keys;
    const items = renderCode(list, lines);
    const [done, kind] = !st.available ? ['TAUOLLA', 'offline'] : st.busy ? ['AJETAAN', 'running'] : st.messages.length ? ['LIVE', ''] : ['ODOTTAA', 'idle'];
    runner.play(items, { from, done, doneKind: kind });
  }

  let pending = null;
  async function refresh() {
    if (!visible() || !st.messages.length) return;
    pending ??= (async () => {
      try {
        const response = await fetch('/api/chat/cart', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        if (!response.ok) return;
        const data = await response.json();
        const token = typeof data.url === 'string' ? data.url.split('#')[1] : '';
        if (!token) { st.list = null; return; }
        const cart = await fetch('/whatsapp/cart/api', { cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token}` } });
        st.list = cart.ok ? (await cart.json()).shoppingList || null : null;
      } catch { /* edellinen tila jää näkyviin */ } finally { pending = null; }
    })();
    await pending;
  }

  document.addEventListener('aimo-chat:history', async ({ detail }) => {
    st.available = detail.available;
    st.messages = detail.messages.map((m) => m.text);
    st.turns = detail.messages.map((m) => m.parts || []);
    st.replies = st.turns.at(-1) || [];
    await refresh();
    draw();
  });
  document.addEventListener('aimo-chat:sent', ({ detail }) => {
    st.messages.push(detail.text); st.busy = true; st.available = true;
    draw();
  });
  document.addEventListener('aimo-chat:reply', async ({ detail }) => {
    st.turns.push(detail.parts); st.replies = detail.parts;
    await refresh();
    st.busy = false;
    draw();
  });
  document.addEventListener('aimo-chat:error', ({ detail }) => {
    st.busy = false;
    if (detail.offline) st.available = false;
    draw();
  });
  // Kori voi muuttua ostoskorisivulla: päivitä, kun käyttäjä palaa tälle välilehdelle tai ruutu levenee.
  const again = async () => { if (st.busy || document.visibilityState !== 'visible') return; await refresh(); draw(); };
  document.addEventListener('visibilitychange', again);
  matchMedia('(min-width: 901px)').addEventListener?.('change', again);
  draw();
}

if (typeof document !== 'undefined') mount();
