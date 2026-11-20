// "Katso, mitä agentti näki": draws one order's published trace. All text goes through textContent.
import { nf, money, time, day, quantity, CLAIM, ALLERGEN, STATUS, FLAG, EXCLUDED, el, cap, lit, short, codeLines, renderCode, createPlayer } from './agent-code.js';
import { renderOptions } from './agent-options.js';
const $ = (id) => document.getElementById(id);
const LINK = /^(AGW-\d{8}-\d{4,12})\.([A-Za-z0-9_-]{43})$/;
const match = LINK.exec(location.hash.slice(1));
// #esimerkki opens the example order the Worker serves without a payment link.
const example = location.hash === '#esimerkki';
const SVG = 'http://www.w3.org/2000/svg';


function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG, 'svg'), use = document.createElementNS(SVG, 'use');
  svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', `#i-${name}`);
  svg.append(use); return svg;
}
function chip(text, kind = '') { return el('span', `chip ${kind}`.trim(), text); }
const label = (code) => CLAIM[code] || (/ORGANIC/.test(code) ? 'luomu' : null);
// Product names for ids that the ledger lists by number only.
let names = new Map();
// WhatsApp formatting: *lihavointi* and line breaks, rendered without HTML.
function whatsappText(text) {
  const out = el('p', 'bubble-text');
  String(text).split(/(\*[^*\n]{1,200}\*)/u).forEach((part) => {
    if (/^\*[^*\n]+\*$/u.test(part)) out.append(el('strong', '', part.slice(1, -1)));
    else if (part) out.append(document.createTextNode(part));
  });
  return out;
}

function stats(trace) {
  const customer = trace.turns.filter((t) => t.source === 'whatsapp').length;
  const revisions = Math.max(0, ...trace.turns.map((t) => t.revision || 0));
  const shown = trace.options.reduce((n, o) => n + Math.max(o.shown.length, o.seen || 0), 0);
  const signed = trace.ledger.events.filter((e) => e.type === 'OFFER_ISSUED').length;
  const mandate = trace.ledger.events.find((e) => e.type === 'MANDATE_EVALUATED')?.detail;
  const tiles = [
    ['chat', nf(customer), 'WhatsApp-viestiä', ''],
    ['brain', nf(revisions), 'korin versiota', ''],
    ['search', nf(shown), 'tuotevaihtoehtoa näytetty', ''],
    ['sign', nf(signed), `allekirjoitettua tarjousta, ${nf(trace.quotes.count || 0)} kierrosta`, ''],
    ['shield', mandate?.outcome === 'confirmed' ? 'OK' : mandate ? 'Hyväksyntä' : 'Ei tietoa', 'ostovaltuus', mandate?.outcome === 'confirmed' ? 'good' : 'warn'],
  ];
  $('stats').replaceChildren(...tiles.map(([name, value, label, tone]) => {
    const tile = el('div', `stat ${tone}`.trim());
    tile.append(icon(name), el('strong', '', value), el('span', '', label));
    return tile;
  }));
  $('stats').hidden = false;
}

function chat(trace) {
  const nodes = [];
  trace.turns.forEach((turn, n) => {
    if (turn.source === 'cart') {
      const pill = el('div', 'cart-event');
      pill.dataset.turn = String(n);
      pill.append(icon('cart'), el('span', '', turn.action), el('time', '', time(turn.at)));
      nodes.push(pill);
    } else if (turn.customer) {
      const row = el('div', 'msg customer');
      row.dataset.turn = String(n);
      const bubble = el('div', 'bubble');
      bubble.append(whatsappText(turn.customer), el('time', '', time(turn.at)));
      row.append(bubble); nodes.push(row);
    }
    if (turn.replies.length) {
      const row = el('div', 'msg agent');
      const stack = el('div', 'stack');
      turn.replies.forEach((text) => { const b = el('div', 'bubble'); b.append(whatsappText(text)); stack.append(b); });
      const meta = el('div', 'meta');
      if (turn.revision) meta.append(chip(`Kori v${turn.revision}`, 'blue'));
      if (turn.status) meta.append(chip(STATUS[turn.status] || turn.status, turn.status === 'confirmed' ? 'good' : turn.status === 'ready' ? 'blue' : ''));
      if (!turn.revision && !turn.status) meta.append(chip(turn.source === 'cart' ? 'Ostoskorisivu' : 'Keskustelu, kori ennallaan'));
      stack.append(meta); row.append(stack); nodes.push(row);
    }
  });
  $('chat').replaceChildren(...nodes);
}

function understood(trace) {
  const u = trace.understood;
  const delivery = $('delivery');
  delivery.replaceChildren(icon('truck'), el('span', '', 'Toimitus'), el('strong', '', day(u.deliveryDate)));
  if (u.diet.claims.length || u.diet.excludeAllergens.length) {
    delivery.append(el('span', 'sep', 'koko tilaus'));
    u.diet.claims.forEach((c) => delivery.append(chip(CLAIM[c] || c, 'good')));
    u.diet.excludeAllergens.forEach((a) => delivery.append(chip(`ei ${ALLERGEN[a] || a}`, 'bad')));
  }
  $('understood').replaceChildren(...u.lines.map((line) => {
    const card = el('div', 'need');
    const top = el('div', 'need-top');
    top.append(el('span', 'term', cap(line.term)), el('strong', 'qty', quantity(line.quantity)));
    const tags = el('div', 'tags');
    line.claims.forEach((c) => tags.append(chip(CLAIM[c] || c, 'good')));
    line.excludeAllergens.forEach((a) => tags.append(chip(`ei ${ALLERGEN[a] || a}`, 'bad')));
    if (!tags.childNodes.length) tags.append(chip('ei erityisvaatimuksia'));
    const chosen = el('div', `chosen ${line.selectedName ? '' : 'missing'}`.trim());
    chosen.append(icon(line.selectedName ? 'check' : 'x'), el('span', '', line.selectedName || 'Tuotetta ei valittu'));
    card.append(top, tags, chosen);
    return card;
  }));
}

// Vaihtoehdot ja syy, miksi juuri ne näytettiin: agent-options.js.
function options(trace) { $('options').replaceChildren(...renderOptions(trace, { icon, chip, label })); }

function eventText(e) {
  const d = e.detail || {};
  switch (e.type) {
    case 'QUOTE_REQUESTED': return ['search', 'Tarjouspyyntö', `${nf(d.needs?.length || 0)} tarvetta toimitukselle ${day(d.deliveryDate)}, ${nf(d.productsPriced || 0)} tuotteen hinta haettu${d.priceSource === 'live' ? ' suoraan rajapinnasta' : ''}.`];
    case 'CANDIDATES_EXCLUDED': return ['x', 'Rajattiin pois', Object.entries(d.summary || {}).map(([k, v]) => `${EXCLUDED[k] || k.toLowerCase().replace(/_/g, ' ')}: ${v}`).join(', ') || 'Sopimattomia ehdokkaita.'];
    case 'OFFER_ISSUED': return ['sign', 'Allekirjoitettu tarjous', `${(d.lines || []).map((l) => l.replace(/^(\S+) ×/u, (all, id) => (names.has(id) ? `${names.get(id)} ×` : all))).join(', ')}, ${money(d.net)}.`, (d.flags || []).map((f) => FLAG[f] || f)];
    case 'ORDER_RECEIVED': return ['cart', 'Tilaus vastaanotettu', `Ostoskorin vahvistus ${nf(d.offers || 0)} tarjouksella.`];
    case 'OFFER_VERIFIED': return ['shield', 'Allekirjoitukset tarkistettu', `${d.algorithm || 'Allekirjoitus'}: ${nf(d.offers || 0)} tarjousta, ${nf(d.failures || 0)} virhettä.`];
    case 'LIVE_RECHECK': return ['refresh', 'Hinnat ja saatavuus tarkistettu uudelleen', d.changed ? `${nf(d.changed)} muutosta ${nf(d.products || 0)} tuotteessa.` : `Ei muutoksia ${nf(d.products || 0)} tuotteessa.`];
    case 'MANDATE_EVALUATED': return ['shield', 'Ostovaltuus', d.outcome === 'confirmed' ? 'Tilaus mahtuu valtuuteen, ihmisen hyväksyntää ei tarvita.' : `Tilaus vaatii hyväksynnän: ${(d.reasons || []).join(', ') || d.outcome}.`];
    case 'WATCH_EVALUATED': return ['eye', 'Vahti', d.findings ? `${nf(d.findings)} havaintoa.` : `Ei poikkeamia ${nf(d.historyOrders || 0)} aiempaan tilaukseen verrattuna.`];
    case 'ORDER_CONFIRMED': return ['check', 'Tilaus vahvistettu', `${money(d.net)} alv 0 %.`];
    default: return ['check', e.type, ''];
  }
}
function ledger(trace) {
  const events = trace.ledger.events;
  // Each quote starts a group. Earlier quotes are folded: they are the same cart before the shopper's last change.
  const groups = [];
  for (const e of events) {
    if (e.type === 'QUOTE_REQUESTED' || !groups.length) groups.push([]);
    groups[groups.length - 1].push(e);
  }
  const lastQuote = groups.map((g) => g[0]?.type).lastIndexOf('QUOTE_REQUESTED');
  const item = (e) => {
    const [name, title, text, flags = []] = eventText(e);
    const li = el('li', `event ${['ORDER_CONFIRMED', 'OFFER_VERIFIED'].includes(e.type) ? 'good' : e.type === 'CANDIDATES_EXCLUDED' ? 'warn' : ''}`.trim());
    const dot = el('span', 'event-dot'); dot.append(icon(name));
    const body = el('div', 'event-body');
    const head = el('div', 'event-head'); head.append(el('strong', '', title), el('time', '', time(e.at)));
    body.append(head, el('p', '', text));
    const tags = el('div', 'tags'); flags.forEach((f) => tags.append(chip(f, 'warn')));
    tags.append(chip(e.actor === 'agent' ? 'agentti' : e.actor === 'policy' ? 'sääntö' : e.actor === 'watch' ? 'vahti' : 'portti', 'ghost'), chip(`#${e.hash}`, 'mono'));
    body.append(tags); li.append(dot, body);
    return li;
  };
  const nodes = [];
  groups.forEach((group, i) => {
    if (i < lastQuote) {
      const li = el('li', 'event folded');
      const details = el('details');
      details.append(el('summary', '', `Aiempi tarjouskierros ${time(group[0].at)}: kori muuttui vielä tämän jälkeen`));
      const inner = el('ol', 'ledger inner'); group.forEach((e) => inner.append(item(e)));
      details.append(inner); li.append(details); nodes.push(li);
    } else group.forEach((e) => nodes.push(item(e)));
  });
  $('ledger').replaceChildren(...nodes);
  if (trace.ledger.head) {
    const li = el('li', 'event chain');
    const dot = el('span', 'event-dot'); dot.append(icon('check'));
    const body = el('div', 'event-body');
    body.append(el('strong', '', 'Päätösketju ehjä julkaisuhetkellä'), el('p', 'mono', trace.ledger.head));
    li.append(dot, body); $('ledger').append(li);
  }
}

function order(trace) {
  const o = trace.order;
  $('order-note').textContent = `${STATUS[o.status] || o.status} ${time(o.createdAt)}, toimitus ${day(o.deliveryDate)}${o.cutoffLabel ? `, tilattava viimeistään ${o.cutoffLabel}` : ''}.`;
  $('order-lines').replaceChildren(...o.lines.map((l) => {
    const li = el('li');
    const name = el('div'); name.append(el('strong', '', l.name), el('small', '', `${nf(l.quantity || 0)} ${l.unit || ''}${l.unitPriceNet != null ? ` × ${money(l.unitPriceNet)}` : ''}`));
    li.append(name, el('span', 'line-net', money(l.net)));
    return li;
  }));
  const totals = $('totals');
  totals.replaceChildren();
  for (const [label, value, strong] of [['Veroton', o.net, true], ['Alv', o.vat], ['Verollinen', o.gross]]) {
    if (value == null) continue;
    const row = el('div', strong ? 'total main' : 'total'); row.append(el('span', '', label), el(strong ? 'strong' : 'span', '', money(value)));
    totals.append(row);
  }
}

// The agent's run beside the chat. The lines type out when the pane comes into view, and the pane
// follows the cursor until the reader scrolls it or picks a message.
let followCode = true;
function codeView(trace) {
  const list = $('code-lines');
  const items = renderCode(list, codeLines(trace));
  $('code-file').textContent = `tilausapuri/${trace.orderId}.js`;
  $('code').hidden = false;
  ['wheel', 'touchstart'].forEach((type) => list.addEventListener(type, () => { followCode = false; }, { passive: true }));
  const onLine = () => {
    const li = followCode && list.querySelector('.cursor')?.closest('li');
    if (!li) return;
    const bottom = li.offsetTop + li.offsetHeight + 24;
    if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };
  const runner = createPlayer(list, $('code-state'), { onLine });
  const play = () => { followCode = !reduceMotion(); list.scrollTop = 0; runner.play(items); };
  $('code-replay').onclick = play;
  if (!('IntersectionObserver' in window)) { play(); return items; }
  items.forEach((li) => li.classList.add('pending'));
  const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); play(); } }, { threshold: 0.15 });
  seen.observe($('code'));
  return items;
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Scrolls a pane so the target is in its middle and briefly marks it. Moves the page only when the pane is off screen.
function reveal(scroller, target, mark) {
  const behavior = reduceMotion() ? 'auto' : 'smooth';
  const box = scroller.getBoundingClientRect();
  if (box.bottom < 80 || box.top > innerHeight - 80) scroller.scrollIntoView({ block: 'nearest', behavior });
  scroller.scrollTo({ top: Math.max(0, target.offsetTop - (scroller.clientHeight - target.offsetHeight) / 2), behavior });
  mark.classList.remove('flash'); void mark.offsetWidth; mark.classList.add('flash');
}

// Pairs each chat message with its line in the agent's run: customer messages by their quoted text
// (the run lists at most eight of them), cart-page actions in order.
function link(trace, items) {
  const quoted = items.filter((li) => li.querySelector('.res-text')?.textContent.startsWith('"'));
  const cartCalls = items.filter((li) => li.querySelector('.lc')?.textContent.startsWith('await ostoskori.'));
  let next = 0, cart = 0;
  trace.turns.forEach((turn, n) => {
    const row = $('chat').querySelector(`[data-turn="${n}"]`);
    if (!row) return;
    let line = null;
    if (turn.source === 'cart') line = cartCalls[cart++] || null;
    else if (turn.source === 'whatsapp') {
      const key = lit(short(turn.customer));
      const at = quoted.findIndex((li, i) => i >= next && li.querySelector('.res-text').textContent === key);
      if (at >= 0) { line = quoted[at]; next = at + 1; }
    }
    if (!line) return;
    const pair = [row, line];
    const on = () => pair.forEach((node) => node.classList.add('hl'));
    const off = () => pair.forEach((node) => node.classList.remove('hl'));
    row.classList.add('linked'); line.classList.add('linked');
    row.tabIndex = 0;
    row.title = 'Näytä agentin rivi'; line.title = 'Näytä viesti keskustelussa';
    const toLine = () => { followCode = false; reveal($('code-lines'), line, line); };
    const toRow = () => reveal($('chat'), row, row.querySelector('.bubble') || row);
    for (const node of pair) { node.addEventListener('mouseenter', on); node.addEventListener('mouseleave', off); }
    row.addEventListener('focus', on); row.addEventListener('blur', off);
    row.addEventListener('click', toLine);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toLine(); } });
    line.addEventListener('click', toRow);
  });
}

function render(trace) {
  names = new Map([...trace.options.flatMap((g) => g.shown.map((o) => [o.productId, o.name])), ...trace.order.lines.map((l) => [l.productId, l.name])]);
  $('order-label').textContent = `${example ? 'ESIMERKKITILAUS' : 'TILAUS'} ${trace.orderId}`;
  $('split').hidden = false;
  chat(trace); link(trace, codeView(trace)); stats(trace); understood(trace); options(trace); ledger(trace); order(trace);
  $('raw').textContent = JSON.stringify(trace, null, 2);
  $('trace').hidden = false;
  $('status').hidden = true; $('retry').hidden = true;
  if (!example) {
    $('back').href = `/demo-payment.html#${match[1]}.${match[2]}`;
    $('back').textContent = '← Takaisin maksusivulle';
  }
}

let attempts = 0;
async function load() {
  $('retry').hidden = true;
  $('status').hidden = false;
  try {
    const response = example
      ? await fetch('/api/agent-traces/esimerkki', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      : await fetch(`/api/agent-traces/${match[1]}`, { cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${match[2]}` } });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.trace) return render(data.trace);
    // The publisher pushes the trace a few seconds after the order settles; wait for it a while.
    if (data.code === 'not_published' && attempts++ < 12) {
      $('status').textContent = 'Agentin jälkeä julkaistaan. Odotetaan hetki…';
      setTimeout(load, 5000);
      return;
    }
    throw new Error(data.error || 'Agentin jälkeä ei voitu avata.');
  } catch (error) {
    $('status').textContent = error.name === 'TimeoutError' ? 'Yhteys ei vastannut ajoissa.' : error.message;
    $('retry').hidden = false;
  }
}
$('retry').addEventListener('click', () => { attempts = 0; void load(); });
window.addEventListener('hashchange', () => location.reload());

if (match || example) void load();
else $('status').textContent = 'Avaa agentin jälki tilauksen maksusivulta, kun demomaksu on hyväksytty. Yllä näet lyhyesti, miten tilausapuri toimii.';
