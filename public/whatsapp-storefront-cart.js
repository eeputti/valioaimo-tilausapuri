// Toimitustukun näköinen WhatsApp-kori. Ainoa totuus on palvelimen luonnos: sivu lukee sen
// korilinkin rajatusta API:sta eikä kopioi riviä selaimen omaan ostoskoriin.
const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1);
// Sama avain kuin aiemmalla korisivulla: kesken jäänyt pyyntö säilyy myös sivun vaihtuessa.
const storageKey = `aimo.whatsapp-cart.pending.${token.slice(-24)}`;
const doneKey = `aimo.whatsapp-cart.done.${token.slice(-24)}`;
let list = null; let priced = null; let busy = false; let pending = null; let done = null; let rows = [];
// SIIRRY MAKSAMAAN käynnissä: painike pyörii latauksen merkkinä, kunnes maksusivu aukeaa (Eelis 18.11.).
let paying = false;
try { pending = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* read-only browsing still works */ }
// Huomiot ostoskorista (cart-notes.mjs): pelkkää tietoa ostajalle. Eelis 17.11.: niitä ei kuitata erikseen, vaan ostaja
// näkee korin sisällön ja huomiot ja hyväksyy tilauksen SIIRRY MAKSAMAAN -painikkeella.
const notes = () => (priced?.state === 'ready' && Array.isArray(priced.notes) ? priced.notes : []);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Luvut ja päivät päätyvät innerHTML:ään: muunnetaan aina luvuksi tai escapoidaan, vaikka palvelin ne jo tarkistaa.
const money = (n) => n == null ? 'Hinta tarkistetaan' : `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const num = (n) => Number(n).toLocaleString('fi-FI', { maximumFractionDigits: 3 });
const dateLabel = (iso) => esc(String(iso).split('-').reverse().join('.'));
const round = (n) => Math.round(n * 100) / 100;
const claims = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu' };
const allergens = { AM: 'maidoton', AW: 'ei gluteeniviljoja', AE: 'munaton', AN: 'pähkinätön', AP: 'ei maapähkinää', AF: 'kalaton', AY: 'soijaton' };
const diet = (v) => [...(v?.claims || []).map((c) => claims[c] || c), ...(v?.excludeAllergens || []).map((c) => allergens[c] || c)].join(', ');
const unitLabel = (q) => q.unit === 'L' ? 'l' : q.unit === 'KG' ? 'kg' : q.basis === 'sales' ? 'pakkausta' : 'kpl';
const coverLabel = (c) => c && Number.isFinite(c.value) ? `${num(c.value)} ${c.unit === 'L' ? 'l' : c.unit === 'KG' ? 'kg' : 'kpl'}` : '';
const icon = (name) => `<span class="icon i-${name}" aria-hidden="true"></span>`;
let statusTimer;
function tell(text) { clearTimeout(statusTimer); const s = $('wa-status'); s.textContent = text; s.hidden = false; statusTimer = setTimeout(() => { s.hidden = true; }, 4000); }

async function request(path = '', input) {
  const response = await fetch(`/whatsapp/cart/api${path}`, {
    headers: { authorization: `Bearer ${token}`, ...(input ? { 'content-type': 'application/json' } : {}) },
    ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}), cache: 'no-store',
  });
  let data = {};
  try { data = await response.json(); } catch { /* an empty error body keeps the generic message */ }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Ostoskoria ei voitu avata.'), { status: response.status });
  return data;
}
// Verkkokatko tai palvelimen virhe: vastaus jäi saamatta. Sama viesti-id tekee uusinnasta turvallisen (palvelin palauttaa
// saman tuloksen), joten sivu yrittää itse uudelleen eikä erillistä "yritä uudelleen" -painiketta tarvita.
const lost = (error) => !error.status || error.status >= 500;
async function post(input) {
  for (let attempt = 0; ; attempt++) {
    try { return await request('/chat', input); }
    catch (error) {
      if (!lost(error) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
}
// Hinnat ja myyntipakkaukset tulevat samasta luonnoksesta tarkistetusta tarjouksesta, vain valmiille korille.
async function prices(value) {
  if (!value || value.status !== 'review') return null;
  const key = `${value.id}:${value.revision}`;
  if (priced?.key === key) return priced;
  try {
    const data = await request('/export');
    if (data.state === 'ready' && data.id === value.id && data.revision === value.revision && Array.isArray(data.lines)) {
      return { key, state: 'ready', lines: data.lines, notes: Array.isArray(data.notes) ? data.notes.filter((n) => n && typeof n.key === 'string') : [] };
    }
    return { key, state: data.state === 'waiting' ? 'waiting' : 'none', message: data.message };
  } catch { return { key, state: 'none' }; } // Rivit näkyvät ilman hintoja, jos tarkistus ei onnistu.
}

function lines() {
  if (priced?.lines) return priced.lines.map((l) => {
    const source = list.lines.find((x) => x.selectedProductId === l.id);
    const net = Number.isFinite(l.price) ? round(l.price * l.qty) : null;
    // Vertailuhinta Valion hintarajapinnasta sellaisenaan; ilman sitä ei näytetä itse laskettua arvoa.
    const per = l.comparison && Number.isFinite(l.comparison.value) ? { value: l.comparison.value, unit: { L: 'l', KG: 'kg', PCS: 'kpl' }[l.comparison.unit] || '' } : null;
    return { id: l.id, name: l.name, term: source?.productTerm || l.name, qty: l.qty, unit: l.unit || 'kpl', price: l.price, vat: l.vat, taxUnknown: l.taxUnknown || l.vat == null,
      net, per, covers: coverLabel(l.requested), note: diet(source) };
  });
  return list.lines.map((l) => ({ id: l.selectedProductId, name: l.selectedName || l.productTerm, term: l.productTerm,
    qty: l.quantity?.value ?? null, unit: l.quantity ? unitLabel(l.quantity) : '', price: null, net: null, note: diet(l),
    needsProduct: !l.selectedProductId, needsQty: !l.quantity }));
}
// Yksi huomio keltaisena tietorivinä.
const check = (n) => `<div class="wa-check" data-kind="${esc(n.kind)}">${icon('warning')}<p><strong>${esc(n.title)}</strong> ${esc(n.text)}</p></div>`;
function picture(p) {
  return `<div class="cart-picture${p.id ? '' : ' wa-noimg'}">${p.id ? `<img src="/whatsapp/cart/img/${encodeURIComponent(p.id)}" alt="" loading="lazy">` : ''}</div>`;
}
function row(p) {
  const qty = p.qty == null ? '<span class="wa-qty-missing">Määrä?</span>' : `<span class="wa-qty-value">${esc(num(p.qty))}</span><span class="wa-unit">${esc(p.unit)}</span>`;
  const gross = p.net == null || p.taxUnknown ? null : round(p.net * (1 + p.vat / 100));
  const problems = [];
  if (p.needsProduct) problems.push(`Valitse tarkka tuote: ${esc(p.term)}`);
  if (p.needsQty) problems.push(`Kerro määrä: ${esc(p.term)}`);
  const checks = p.id ? notes().filter((n) => n.productId != null && String(n.productId) === String(p.id)) : [];
  return `<tbody data-term="${esc(p.term)}"${checks.length ? ' class="wa-flagged"' : ''}>
    <tr>
      <td><div class="cart-product">${picture(p)}<div><span class="cart-product-name">${esc(p.name)}</span><span class="cart-product-code">${p.id ? esc(p.id) : 'Tuote valitaan'}${p.note ? `<span class="wa-diet">${esc(p.note)}</span>` : ''}</span></div></div></td>
      <td><div class="cart-unit-price"><span class="cart-price"><strong>${money(p.price)}</strong>${p.price == null ? '' : ` / ${esc(p.unit)}`}</span></div></td>
      <td>${p.per ? `<span class="cart-price">${money(p.per.value)} / ${p.per.unit}</span>` : ''}</td>
      <td><button type="button" class="cart-quantity wa-qty" data-prefill="${esc(p.term)} " aria-label="Muuta määrää: ${esc(p.name)}">${qty}${icon('edit')}</button></td>
      <td>${esc(p.covers || '')}</td>
      <td class="cart-line-total"><strong>${p.net == null ? '–' : money(p.net)}</strong>${p.net == null ? '' : gross == null ? '<small>Alv tarkistetaan</small>' : `<small>${money(gross)} (alv ${esc(num(p.vat))} %)</small>`}</td>
      <td><button type="button" class="cart-remove" data-prefill="poista ${esc(p.term)}" aria-label="Poista tuote ostoskorista: ${esc(p.name)}">${icon('trash')}</button></td>
    </tr>
    ${problems.length ? `<tr class="cart-problem wa-note"><td colspan="7"><div class="cart-move-line">${icon('warning')}${problems.join('. ')}. <button type="button" data-prefill="${esc(p.term)} ">Täydennä</button></div></td></tr>` : ''}
    ${checks.length ? `<tr class="wa-check-row"><td colspan="7">${checks.map(check).join('')}</td></tr>` : ''}
  </tbody>`;
}
function totals() {
  const known = rows.length && rows.every((p) => p.net != null);
  const net = known ? round(rows.reduce((s, p) => s + p.net, 0)) : null;
  const vat = {}; let taxUnknown = !known;
  if (known) for (const p of rows) { if (p.taxUnknown) taxUnknown = true; else vat[p.vat] = round((vat[p.vat] || 0) + p.net * p.vat / 100); }
  const gross = known && !taxUnknown ? round(net + Object.values(vat).reduce((s, v) => s + v, 0)) : null;
  return { net, vat, gross, known, taxUnknown };
}
function controls() {
  const locked = busy || paying || !list || !!pending || !!done;
  for (const el of document.querySelectorAll('#wa-edit-form input, #wa-edit-form button, [data-prefill]')) el.disabled = locked;
  // SIIRRY MAKSAMAAN vain valmiille korille (päivä, tuotteet ja määrät kunnossa); puutteet näkyvät keltaisessa huomiossa.
  // Kesken jäänyt maksuun siirtyminen jatkuu samasta painikkeesta samalla viesti-id:llä.
  const pay = $('wa-review');
  const canResume = pending?.pay === true && !busy && !paying;
  pay.disabled = !canResume && (locked || list.status !== 'review');
  pay.hidden = !!done && !paying;
  pay.setAttribute('aria-busy', paying ? 'true' : 'false');
  pay.innerHTML = paying ? '<span class="wa-spinner" aria-hidden="true"></span>SIIRRYTÄÄN MAKSUUN' : 'SIIRRY MAKSAMAAN';
}
function render() {
  if (!list) {
    rows = [];
    $('wa-days').replaceChildren(); $('wa-selected-day').textContent = '';
    for (const id of ['wa-company', 'wa-site', 'wa-diet']) $(id).textContent = '–';
    $('wa-head-count').textContent = '0'; $('wa-head-total').textContent = '0,00 €'; $('wa-head-date-label').textContent = '–';
    $('wa-totals').replaceChildren(); $('wa-checks').hidden = true;
    controls(); return;
  }
  rows = lines();
  const t = totals();
  const date = list.deliveryDate;
  $('wa-days').innerHTML = `<button type="button" class="cart-day" role="tab" aria-selected="true" aria-controls="wa-lines">${date ? dateLabel(date) : 'Päivä puuttuu'}<span class="cart-count">${rows.length}</span></button>`;
  $('wa-selected-day').textContent = date ? `Valittu toimitus ${dateLabel(date)}` : 'Toimituspäivä puuttuu';
  $('wa-head-date-label').textContent = date ? dateLabel(date) : 'Valitse';
  $('wa-head-count').textContent = String(rows.length);
  $('wa-head-total').textContent = t.gross != null ? money(t.gross) : t.net != null ? money(t.net) : 'Tarkistetaan';
  $('wa-head-cart').setAttribute('aria-label', `Ostoskori: ${rows.length} tuotetta`);
  $('wa-company').textContent = list.companyName || 'WhatsApp-asiakas';
  $('wa-account-company').textContent = list.companyName || 'WhatsApp-asiakas';
  $('wa-site').textContent = list.deliverySiteId ? 'Testikeittiö' : 'Kerro toimitusosoite apurille';
  $('wa-diet').textContent = diet(list.diet) || 'Ei ilmoitettuja yhteisiä vaatimuksia';
  $('wa-lines').innerHTML = rows.length
    ? `<table class="cart-table" aria-label="Ostoskorin tuotteet"><colgroup>${'<col>'.repeat(7)}</colgroup><thead><tr><th scope="col">Tuote</th><th scope="col">Yksikköhinta<span>(alv 0 %)</span></th><th scope="col">Vertailuhinta<span>(alv 0 %)</span></th><th scope="col">Määrä</th><th scope="col">Sis.</th><th scope="col">Hinta yhteensä<span>(alv 0 % / sis. alv)</span></th><th scope="col"><span class="sr-only">Poista</span></th></tr></thead>${rows.map(row).join('')}</table>`
    : '<div class="cart-empty"><p>Ostoskori on tyhjä. Kirjoita tuotteet yllä olevaan kenttään tai WhatsAppiin.</p></div>';
  // Koko tilausta koskevat huomiot (esim. saldo) korin yläpuolella; tuotekohtaiset näkyvät oman rivinsä alla.
  const all = done ? [] : notes(); const general = all.filter((n) => n.productId == null);
  $('wa-checks').hidden = !all.length;
  const onRows = all.length - general.length;
  $('wa-checks-list').innerHTML = `${general.map(check).join('')}${onRows ? `<p class="wa-checks-rows">${onRows === 1 ? '1 huomio on' : `${onRows} huomiota on`} tuoterivien alla.</p>` : ''}`;
  const missing = [];
  if (!date) missing.push('toimituspäivä');
  if (rows.some((p) => p.needsProduct)) missing.push('tarkka tuotevalinta');
  if (rows.some((p) => p.needsQty)) missing.push('määrä');
  const alert = done ? '' : missing.length ? `Täydennä vielä: ${missing.join(', ')}. Kirjoita tieto yllä olevaan kenttään tai WhatsAppiin.`
    : priced?.state === 'waiting' ? (priced.message || 'Tuotteen saatavuus pitää tarkistaa ennen tilaamista.') : '';
  $('wa-alert').hidden = !alert; $('wa-alert-text').textContent = alert;
  const vatRows = Object.entries(t.vat).map(([rate, amount]) => `<div><dt>Alv ${esc(num(rate))} %</dt><dd>${money(amount)}</dd></div>`).join('');
  $('wa-totals').innerHTML = `<div><dt>Ostokset (alv 0 %)</dt><dd>${t.known ? money(t.net) : 'Tarkistetaan'}</dd></div><div><dt>Toimitusmaksu (alv 0 %)</dt><dd>Ei tiedossa</dd></div><div><dt>Yhteensä (alv 0 %)</dt><dd>${t.known ? money(t.net) : 'Tarkistetaan'}</dd></div>${vatRows}<div class="cart-final"><dt>Yhteensä (sis. alv)</dt><dd>${t.gross != null ? money(t.gross) : 'Tarkistetaan'}</dd></div>`;
  controls();
}
async function load({ keepReview = false } = {}) {
  const before = list && `${list.id}:${list.revision}`;
  const data = await request(); const next = data.shoppingList || null;
  const p = await prices(next);
  if (!keepReview || before !== (next && `${next.id}:${next.revision}`)) $('wa-review-panel').hidden = true;
  list = next; priced = p; render();
}
// Apurin teksti neuvoo vastaamaan TILAA; korisivulla tilataan SIIRRY MAKSAMAAN -painikkeella.
const tidy = (text) => text.replace(/(?:Vahvista(?: valmis)?(?: tilaus)? vastaamalla|vastaa)\s+\*?TILAA\*?(?:,\s*kun haluat tilata)?[.!]?/giu,
  'Paina SIIRRY MAKSAMAAN, kun haluat tilata.');
const formatted = (text) => esc(text).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
// confirm = SIIRRY MAKSAMAAN -painikkeen vahvistus. Palvelin hylkää muutoskenttään kirjoitetun vahvistuksen ("hyväksyn", "tilaa").
// pay = pyyntö kuuluu SIIRRY MAKSAMAAN -polkuun: valmis yhteenveto ei avaa vastauspaneelia, koska tilaus jatkuu heti.
async function send(text, review = false, confirm = false, pay = false) {
  if (busy || done || (!list && !pending)) return null;
  if (!pending) {
    pending = { text, messageId: crypto.randomUUID(), expectedList: { id: list.id, revision: list.revision }, review, ...(confirm ? { confirm: true } : {}), ...(pay ? { pay: true } : {}) };
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); }
    catch { pending = null; tell('Salli selaimen istuntotallennus ennen tilauksen muuttamista tai vahvistamista.'); return null; }
  }
  const forPay = pending.pay === true;
  busy = true; controls(); if (!forPay) tell('Päivitetään ostoskoria…'); // Maksuun siirtyessä painike pyörii.
  try {
    const { text: message, messageId, expectedList, confirm: confirmed } = pending;
    const data = await post({ text: message, messageId, expectedList, ...(confirmed ? { confirm: true } : {}), ...(forPay ? { pay: true } : {}) });
    pending = null; sessionStorage.removeItem(storageKey);
    if (['confirmed', 'pending_approval'].includes(data.status)) {
      done = { status: data.status, text: data.text || '', ...(data.checkout ? { checkout: data.checkout } : {}), orderId: data.orderId };
      try { sessionStorage.setItem(doneKey, JSON.stringify(done)); } catch { /* the receipt is also in WhatsApp */ }
      showDone({ go: true }); render(); if (!(done.status === 'confirmed' && done.checkout?.url)) tell($('wa-done-title').textContent);
      window.dispatchEvent(new CustomEvent('aimo:order-result', { detail: data })); return data;
    }
    const next = data.shoppingList || null; const p = await prices(next);
    list = next; priced = p;
    render();
    if (!(forPay && data.status === 'ready')) showReply(data, forPay);
    return data;
  } catch (error) {
    // Muutoksen vastaus jäi saamatta uusinnoistakin huolimatta: odottava muutos unohdetaan ja kori luetaan palvelimelta.
    // Jos muutos ehti perille, se näkyy korissa; uusi muutos tehdään nykyiseen versioon, joten mikään ei mene kahdesti.
    const gone = lost(error) && !forPay;
    if ([400, 403, 409, 410, 413, 415].includes(error.status) || gone) {
      pending = null; sessionStorage.removeItem(storageKey);
      if (error.status === 409) {
        $('wa-review-panel').hidden = true;
        try { await load(); error.message = 'Ostoskori muuttui WhatsAppissa ja on nyt päivitetty. Tarkista ostoskori ja paina SIIRRY MAKSAMAAN uudelleen.'; }
        catch { list = null; render(); }
      } else if ([403, 410].includes(error.status)) { list = null; render(); showProblem(error.message); }
      else if (gone) { try { await load({ keepReview: true }); } catch { /* the message below still applies */ } error.message = 'Muutos ei mennyt perille. Tarkista ostoskori ja kirjoita muutos tarvittaessa uudelleen.'; }
    } else if (lost(error)) error.message = 'Maksuun siirtyminen keskeytyi. Paina SIIRRY MAKSAMAAN, niin jatketaan samasta kohdasta.';
    tell(error.message);
    return null;
  } finally { busy = false; controls(); }
}
// SIIRRY MAKSAMAAN: palvelin vahvistaa vain tarjouksen, joka on tehty samasta luonnoksen versiosta, joten nappi pyytää
// ensin yhteenvedon (tuore tarjous) ja vahvistaa sen heti perään. Vahvistettu tilaus avaa demomaksun, jonka
// Hyväksy demomaksu -painike on viimeinen vaihe. Jos yhteenveto ei ole valmis, apurin vastaus kertoo syyn.
async function pay() {
  if (paying || busy) return;
  paying = true; controls();
  // Maksulinkin moduuli latautuu samalla, kun tilaus tehdään: vahvistuksen jälkeen maksusivulle siirrytään heti.
  void checkoutModule();
  try {
    // Kesken jäänyt vahvistus uusitaan samalla tunnisteella: palvelin palauttaa saman tuloksen, vaikka kori olisi jo suljettu.
    if (pending?.pay && pending.confirm) { await send('TILAA', false, true, true); return; }
    const review = await send('näytä', true, false, true);
    if (review?.status !== 'ready' || done) return;
    if (list?.status === 'review') await send('TILAA', false, true, true);
    else showReply(review, true);
  } finally {
    // Vahvistettu tilaus siirtyy maksusivulle: painike pyörii siihen asti. Muuten painike palaa ennalleen.
    if (!(done?.status === 'confirmed' && done.checkout?.url)) { paying = false; controls(); }
  }
}
let checkoutLoad = null;
const checkoutModule = () => (checkoutLoad ||= import('/whatsapp/checkout.js').catch(() => { checkoutLoad = null; return null; }));
function showReply(data, paying) {
  $('wa-reply').innerHTML = formatted(data.status === 'ready' ? tidy(data.text || '') : data.text || '');
  $('wa-review-panel').hidden = false;
  tell(paying ? 'Tilausta ei tehty. Katso apurin vastaus.' : 'Ostoskori päivitetty.');
  if (!paying) $('wa-message').value = '';
  $('wa-review-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function showDone({ go = false } = {}) {
  $('wa-review-panel').hidden = true; $('wa-edit-form').hidden = true;
  $('wa-done-title').textContent = done.status === 'confirmed' ? 'Demotilaus vahvistettu' : 'Tilaus odottaa hyväksyntää';
  $('wa-done-text').innerHTML = formatted(done.text); $('wa-done').hidden = false;
  // Demomaksun linkki tulee maksupolun omasta moduulista vain vahvistetulle tilaukselle, jolla on checkout-tieto. Juuri tehty
  // tilaus siirtyy suoraan maksuun; linkki jää näkyviin takaisin palatessa tai jos siirtymä ei onnistu.
  if (done.status === 'confirmed' && done.checkout?.url) {
    checkoutModule().then((m) => {
      if (m?.showDemoCheckout?.(done, { container: $('demo-checkout'), document }) && go) location.assign(done.checkout.url);
      else if (go) { paying = false; controls(); } // Linkki ei kelvannut: painike ei jää pyörimään.
    });
  }
}
function showProblem(text) {
  $('wa-lines').innerHTML = `<div class="cart-empty wa-problem"><p>${esc(text)}</p></div>`;
  $('wa-alert').hidden = false; $('wa-alert-text').textContent = text;
}
function prefill(text) {
  const input = $('wa-message'); if (input.disabled) return;
  input.value = text; input.focus(); input.setSelectionRange(text.length, text.length);
  input.closest('form').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.prefill != null) { prefill(b.dataset.prefill); return; }
  if (b.dataset.action === 'print') window.print();
  if (b.dataset.action === 'reload' && !busy && !paying && !pending) load({ keepReview: true }).then(() => tell('Ostoskori on ajan tasalla.')).catch((e) => tell(e.message));
});
// Puuttuva tuotekuva näyttää pakkauskuvakkeen kuten kaupan haussa.
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (img instanceof HTMLImageElement && img.closest('.cart-picture')) { img.hidden = true; img.closest('.cart-picture').classList.add('wa-noimg'); }
}, true);
$('wa-review').addEventListener('click', () => { void pay(); });
// Kesken jäänyt pyyntö (esim. sivu ladattiin uudelleen ennen vastausta) jatkuu itsestään samalla viesti-id:llä.
function resume() { if (pending?.pay) void pay(); else if (pending) void send(pending.text, pending.review, pending.confirm === true); }
$('wa-edit-form').addEventListener('submit', (ev) => { ev.preventDefault(); const text = $('wa-message').value.trim(); if (text && !pending) void send(text); });
// Sivun sisäiset linkit (yläpalkin Ostoskori ja Toimituspäivä, ohituslinkki) vierittävät kohteeseen vaihtamatta
// fragmenttia: siinä on korilinkin tunniste, ja sen katoaminen avasi "Korilinkki on vanhentunut" (katselmus #9).
const keepToken = () => { if (token && location.hash.slice(1) !== token) history.replaceState(history.state, '', `${location.pathname}${location.search}#${token}`); };
function jumpTo(id) {
  const target = id && document.getElementById(id); if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (!target.matches('a, button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true }); return true;
}
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href^="#"]'); if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault(); jumpTo(decodeURIComponent(a.getAttribute('href').slice(1)));
});
// Uusi korilinkki samassa välilehdessä vaihtaa vain fragmentin: ladataan sivu uuden linkin oikeuksilla. Sivun oman
// elementin tunniste (ei korilinkki) palauttaa nykyisen linkin osoiteriville ja vierittää kohteeseen ilman uudelleenlatausta.
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next === token) return;
  if (token && (!next || !next.includes('.') || document.getElementById(decodeURIComponent(next)))) { const id = decodeURIComponent(next); keepToken(); jumpTo(id); return; }
  location.reload();
});
// WhatsAppista palatessa kori päivitetään. Hyväksyntä säilyy vain, jos luonnos ei muuttunut.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token && !busy && !paying && !pending && !done) load({ keepReview: true }).catch(() => {});
});
if (token) {
  load().then(() => { if (pending) resume(); })
    .catch((error) => {
      list = null;
      // Vahvistettu kori suljetaan palvelimella; samassa välilehdessä näytetään sen kuittaus uudelleen.
      try { done = !pending && [403, 410].includes(error.status) && JSON.parse(sessionStorage.getItem(doneKey)); } catch { done = null; }
      render();
      if (done) { showDone(); showProblem('Tilaus on jo vahvistettu tällä linkillä. Kuittaus on myös WhatsAppissa.'); $('wa-alert').hidden = true; return; }
      // Vahvistettu kori on suljettu, mutta saman pyynnön uusinta palauttaa tilauksen ja maksulinkin.
      if (pending) { resume(); return; }
      showProblem(error.message);
    });
} else { render(); showProblem('Avaa ostoskori WhatsApp-apurin lähettämästä linkistä.'); }
