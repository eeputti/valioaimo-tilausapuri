// Agentin ajo koodina: yhteinen osa agentin jäljelle (/agentti), Näin se toimii -sivun esimerkille ja
// Keskustele-sivun live-näkymälle. Kaikki teksti textContentilla.

export const nf = (n, digits = 0) => new Intl.NumberFormat('fi-FI', { maximumFractionDigits: digits }).format(n);
export const money = (n) => (typeof n === 'number' ? new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(n) : 'Hinta ei tiedossa');
export const time = (iso) => new Intl.DateTimeFormat('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' }).format(new Date(iso));
export const day = (date) => {
  if (!date) return 'päivä puuttuu';
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('fi-FI', { weekday: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  return `${weekday} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
};
export const UNIT = { L: 'l', KG: 'kg', PCS: 'kpl', G: 'g' };
export const quantity = (q) => (q ? `${nf(q.value, 2)} ${UNIT[q.unit] || q.unit.toLowerCase()}` : 'määrä puuttuu');
export const CLAIM = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', FREE_FROM_MILK: 'maidoton', VEGAN: 'vegaaninen',
  VEGETARIAN: 'kasvis', ORGANIC: 'luomu', GOODS_FROM_FINLAND_BLUE_SWAN: 'Hyvää Suomesta', KEYHOLE: 'sydänmerkki' };
export const ALLERGEN = { AM: 'maito', AW: 'gluteeni', AE: 'kananmuna', AF: 'kala', AC: 'äyriäiset', AN: 'pähkinät', AP: 'maapähkinä', AS: 'seesami', AY: 'soija',
  AU: 'sulfiitit', BC: 'selleri', BM: 'sinappi', ML: 'lupiini', UM: 'nilviäiset' };
export const STATUS = { collecting: 'Kerää tietoja', choosing: 'Valitaan tuotetta', ready: 'Valmis vahvistettavaksi', confirmed: 'Vahvistettu',
  pending_approval: 'Odottaa hyväksyntää', error: 'Ei käsitelty' };
export const FLAG = { STOCK_UNKNOWN: 'saldo ei tiedossa', DELIVERY_DATE_SHIFT: 'toimituspäivä siirtyy', SUBSTITUTE: 'korvaava tuote', PRICE_CHANGED: 'hinta muuttui' };
export const EXCLUDED = { UNIT_NOT_CONVERTIBLE: 'yksikköä ei voi muuntaa', NOT_AVAILABLE: 'ei saatavilla', PAST_CUTOFF: 'tilausaika umpeutunut', ALLERGEN: 'allergeeni', LATE_DELIVERY: 'liian myöhäinen toimitus' };

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
export const cap = (text) => (text ? text.charAt(0).toLocaleUpperCase('fi-FI') + text.slice(1) : '');

// The agent's run as one short script: the real paths, fields and answers of this order, nothing invented.
// Lines are { i, code } (highlighted), { i, res, note, tone } (an answer) or {} (empty line).
export const lit = (value) => JSON.stringify(value);
export const short = (text, max = 72) => { const t = String(text).replace(/\s+/gu, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
export function ident(term, used) {
  const base = String(term || 'tuote').toLocaleLowerCase('fi-FI').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/gu, '') || 'tuote';
  const id = /^\p{N}/u.test(base) ? `_${base}` : base;
  let out = id;
  for (let n = 2; used.has(out); n++) out = `${id}${n}`;
  used.add(out); return out;
}
export const PRICE_SOURCE = { live: 'suoraan Valion rajapinnasta', 'last-known': 'viimeisin tunnettu Valion hinta (rajapinta ei vastannut)', simulated: 'simuloitu' };
export const CART_CALL = { confirmed: 'vahvista', pending_approval: 'lähetäHyväksyttäväksi', ready: 'tarkista' };

export function codeLines(trace) {
  const out = [];
  const code = (text, i = 0) => out.push({ i, code: text });
  const res = (text, opts = {}) => out.push({ i: opts.i ?? 1, res: text, note: opts.note || '', tone: opts.tone || '' });
  const gap = () => out.push({});
  const u = trace.understood, events = trace.ledger.events, final = trace.quotes.final;

  code('import { whatsapp, tulkki, tuotteet, valio, portti, ostoskori } from "aimo"');
  gap();

  // 1. WhatsApp messages, with the cart version each one produced.
  const messages = trace.turns.filter((t) => t.source === 'whatsapp' && t.customer);
  if (messages.length) {
    code('const viestit = await whatsapp.vastaanota()   // Meta → POST /webhooks/whatsapp');
    const shown = messages.length > 8 ? [...messages.slice(0, 4), null, ...messages.slice(-3)] : messages;
    for (const m of shown) {
      if (!m) res(`… ${nf(messages.length - 7)} viestiä lisää`, { tone: 'muted' });
      else res(lit(short(m.customer)), { note: m.revision ? `kori v${m.revision}` : '' });
    }
    gap();
  }

  // 2. What the agent understood.
  code('const tarve = await tulkki.ymmärrä(viestit)   // kielimalli + tilausmoottorin säännöt');
  for (const line of u.lines) {
    const extra = [...line.claims.map((c) => CLAIM[c] || c), ...line.excludeAllergens.map((a) => `ei ${ALLERGEN[a] || a}`)];
    res(`${line.term} ${quantity(line.quantity)}${extra.length ? `, ${extra.join(', ')}` : ''}`);
  }
  const orderDiet = [...u.diet.claims.map((c) => CLAIM[c] || c), ...u.diet.excludeAllergens.map((a) => `ei ${ALLERGEN[a] || a}`)];
  if (orderDiet.length) res(`koko tilaus: ${orderDiet.join(', ')}`);
  res(`toimitus ${day(u.deliveryDate)}`);
  gap();

  // 3. Product search per need and the shopper's pick.
  const used = new Set();
  for (const line of u.lines) {
    const group = trace.options.find((g) => g.ref === line.ref);
    const args = [`toimitus: ${lit(u.deliveryDate || '')}`];
    if (line.claims.length) args.push(`vaatimus: [${line.claims.map((c) => lit(CLAIM[c] || c)).join(', ')}]`);
    if (line.excludeAllergens.length) args.push(`ilman: [${line.excludeAllergens.map((a) => lit(ALLERGEN[a] || a)).join(', ')}]`);
    code(`const ${ident(line.term, used)} = await tuotteet.hae(${lit(line.term || '')}, { ${args.join(', ')} })`);
    const shownCount = group?.shown.length || 0;
    const pick = group ? group.shown.findIndex((o) => o.selected) : -1;
    if (shownCount) {
      const seen = group.seen && group.seen > shownCount ? `, ${nf(group.seen)} käyty läpi` : '';
      res(`${nf(shownCount)} tilattavaa vaihtoehtoa${seen}${pick >= 0 ? `, kokki valitsi ${pick + 1}` : ''}`);
    }
    if (pick >= 0) {
      const o = group.shown[pick];
      res(`${o.name}${o.unitPriceNet != null ? `, ${money(o.unitPriceNet)} / ${o.salesUnitLabel || 'kpl'}` : ''}`, { tone: 'good' });
    } else if (line.selectedName) res(`${line.selectedName} (valittu aiemmin)`, { tone: 'good' });
    else res('tuotetta ei valittu', { tone: 'warn' });
  }
  gap();

  // 4. Valio API: price and availability for the chosen products.
  const offerLines = final ? final.needs.flatMap((n) => n.options[0]?.lines || []) : [];
  if (final && offerLines.length) {
    const ids = [...new Set(offerLines.map((l) => l.productId))];
    const source = [...events].reverse().find((e) => e.type === 'QUOTE_REQUESTED')?.detail?.priceSource || offerLines[0].priceSource;
    code(`const products = [${ids.map(lit).join(', ')}]`);
    code(`await valio.post("/api/price", { requestedDate: ${lit(final.deliveryDate)}, products })`);
    res(`${nf(ids.length)} hintaa, ${PRICE_SOURCE[source] || source || 'lähde ei tiedossa'}`);
    code(`await valio.post("/api/availability", { requestedDate: ${lit(final.deliveryDate)}, products })`);
    for (const l of offerLines.slice(0, 8)) {
      res(`${short(l.name, 44)}: ${l.availableDate ? `saatavilla ${day(l.availableDate)}` : 'saatavuus ei tiedossa'}${l.stockKnown ? '' : ', saldo ei tiedossa'}`);
    }
    const cutoff = final.needs.map((n) => n.options[0]?.cutoffLabel).find(Boolean);
    if (cutoff) res(`tilattava viimeistään ${cutoff}`);
    gap();

    // 5. Gateway quote with the request's real fields.
    if (trace.quotes.count > 1) code(`// ${nf(trace.quotes.count)} tarjouskierrosta: kori muuttui välissä, viimeisin alla`);
    code('const tarjous = await portti.post("/v1/quotes", {');
    code(`deliveryDate: ${lit(final.deliveryDate)},`, 1);
    code('needs: [', 1);
    for (const n of final.needs) {
      const q = n.quantity ? `{ value: ${n.quantity.value}, unit: ${lit(n.quantity.unit)}${n.quantity.basis ? `, basis: ${lit(n.quantity.basis)}` : ''} }` : 'null';
      code(`{ ref: ${lit(n.ref)}, candidates: [${(n.options[0]?.lines || []).map((l) => lit(l.productId)).join(', ')}], quantity: ${q} },`, 2);
    }
    code('],', 1);
    code('})');
    for (const n of final.needs) {
      const o = n.options[0];
      if (!o) { res(`${n.ref}: ei tarjousta`, { tone: 'warn' }); continue; }
      const term = u.lines.find((l) => l.ref === n.ref)?.term || n.ref;
      const flags = o.flags.map((f) => FLAG[f] || f.toLowerCase());
      res(`${n.ref} ${term}: ${money(o.net)}${o.signed ? ', allekirjoitettu' : ''}${flags.length ? `, ${flags.join(', ')}` : ''}`);
    }
    const net = final.needs.reduce((sum, n) => sum + (n.options[0]?.net || 0), 0);
    res(`yhteensä ${money(net)} alv 0 %`);
    gap();
  }

  // 6. What the shopper did on the cart page.
  const cart = trace.turns.filter((t) => t.source === 'cart');
  for (const t of cart) {
    code(`await ostoskori.${CART_CALL[t.status] || 'muuta'}()   // kokki ostoskorisivulla`);
    const what = STATUS[t.status] || t.action;
    res(t.revision ? `kori v${t.revision}, ${what.charAt(0).toLocaleLowerCase('fi-FI')}${what.slice(1)}` : what);
  }
  if (cart.length) gap();

  // 7. The order and every check the gateway made, from its decision ledger.
  const received = events.map((e) => e.type).lastIndexOf('ORDER_RECEIVED');
  code('const tilaus = await portti.post("/v1/orders", { offers: tarjous.offers, idempotencyKey })');
  for (const e of received >= 0 ? events.slice(received + 1) : []) {
    const d = e.detail || {};
    if (e.type === 'OFFER_VERIFIED') res(`allekirjoitukset: ${nf(d.offers || 0)} ok, ${nf(d.failures || 0)} virhettä (${d.algorithm || 'JWS'})`);
    else if (e.type === 'LIVE_RECHECK') res(`hinta ja saatavuus uudelleen: ${d.changed ? `${nf(d.changed)} muutosta` : 'ei muutoksia'}, ${nf(d.products || 0)} tuotetta`);
    else if (e.type === 'MANDATE_EVALUATED') res(d.outcome === 'confirmed' ? 'ostovaltuus: mahtuu, ihmisen hyväksyntää ei tarvita' : `ostovaltuus: vaatii hyväksynnän${d.reasons?.length ? ` (${d.reasons.join(', ')})` : ''}`, { tone: d.outcome === 'confirmed' ? '' : 'warn' });
    else if (e.type === 'WATCH_EVALUATED') res(d.findings ? `vahti: ${nf(d.findings)} havaintoa` : `vahti: ei poikkeamia ${nf(d.historyOrders || 0)} aiempaan tilaukseen`);
    else if (e.type === 'ORDER_CONFIRMED') res(`${trace.orderId} vahvistettu, ${money(d.net)} alv 0 %`, { tone: 'good' });
    else if (e.type === 'ORDER_PENDING_APPROVAL') res(`${trace.orderId} odottaa ihmisen hyväksyntää`, { tone: 'warn' });
  }
  if (!events.some((e) => e.type === 'ORDER_CONFIRMED' || e.type === 'ORDER_PENDING_APPROVAL')) res(`${trace.orderId}: ${STATUS[trace.order.status] || trace.order.status}`);
  if (trace.order.simulated) code('// demo: oikeaa Valio-tilausta ei lähetetty');
  return out;
}

// Light syntax colours: comment, string, keyword, number, call, object, property.
export const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(?<![\p{L}\p{N}_$])(import|from|const|await|for|of)(?![\p{L}\p{N}_$])|(?<![\p{L}\p{N}_$])(\d[\d.]*)(?![\p{L}\p{N}_$])|([\p{L}_$][\p{L}\p{N}_$]*)(?=\()|([\p{L}_$][\p{L}\p{N}_$]*)(?=\.)|([\p{L}_$][\p{L}\p{N}_$]*)(?=:)/gu;
export const KIND = ['com', 'str', 'kw', 'num', 'fn', 'obj', 'prop'];
export function highlight(text, target) {
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) target.append(document.createTextNode(text.slice(last, m.index)));
    target.append(el('span', `t-${KIND[m.slice(1).findIndex((g) => g !== undefined)]}`, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) target.append(document.createTextNode(text.slice(last)));
}

/** Piirtää rivit listaan ja palauttaa li-elementit. */
export function renderCode(list, lines) {
  const items = lines.map((line, n) => {
    const li = el('li', `ln-i${Math.min(line.i || 0, 3)}${line.res ? ` res ${line.tone || ''}` : line.code ? '' : ' blank'}${line.later ? ' later' : ''}`.trim());
    li.append(el('span', 'ln', String(n + 1)));
    const body = el('span', 'lc');
    if (line.res) {
      body.append(el('span', 'arrow', '→ '), el('span', 'res-text', line.res));
      if (line.note) body.append(el('span', 'note', line.note));
    } else if (line.code) highlight(line.code, body);
    li.append(body);
    return li;
  });
  list.replaceChildren(...items);
  return items;
}

/**
 * Kirjoittaa rivit esiin yksi kerrallaan ja näyttää tilan (AJETAAN → done).
 * from: ensimmäinen uusi rivi; sitä aiemmat näytetään heti. onLine: kutsutaan jokaisen rivin jälkeen (vieritys).
 */
export function createPlayer(list, state, { onLine } = {}) {
  let timer = null;
  const cursor = el('span', 'cursor');
  cursor.setAttribute('aria-hidden', 'true');
  const setState = (text, kind = '') => { state.textContent = text; state.className = `code-state ${kind}`.trim(); };
  return {
    setState,
    cursor,
    stop() { clearTimeout(timer); },
    play(items, { from = 0, done = 'VALMIS', doneKind = '' } = {}) {
      clearTimeout(timer);
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      items.forEach((li, n) => li.classList.toggle('pending', n >= from && !reduce));
      const todo = reduce ? [] : items.slice(from);
      if (!todo.length) {
        items.at(-1)?.lastChild.append(cursor);
        setState(done, doneKind); list.removeAttribute('aria-busy'); onLine?.();
        return;
      }
      setState('AJETAAN', 'running');
      list.setAttribute('aria-busy', 'true');
      let n = 0;
      const step = () => {
        const li = todo[n++];
        li.classList.remove('pending'); li.lastChild.append(cursor); onLine?.();
        if (n < todo.length) timer = setTimeout(step, li.classList.contains('res') ? 150 : li.classList.contains('blank') ? 40 : 110);
        else { setState(done, doneKind); list.removeAttribute('aria-busy'); }
      };
      step();
    },
  };
}

/** Yhden tilauksen jälki koodina: rivit piirretään heti piiloon ja kirjoitetaan esiin, kun paneeli tulee näkyviin. */
export function mountTraceCode({ figure, file, list, state, replay }, trace) {
  const items = renderCode(list, codeLines(trace));
  file.textContent = `tilausapuri/${trace.orderId}.js`;
  figure.hidden = false;
  const runner = createPlayer(list, state);
  const play = () => runner.play(items);
  if (replay) replay.onclick = play;
  if (!('IntersectionObserver' in window)) return play();
  items.forEach((li) => li.classList.add('pending'));
  const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); play(); } }, { threshold: 0.15 });
  seen.observe(figure);
}
