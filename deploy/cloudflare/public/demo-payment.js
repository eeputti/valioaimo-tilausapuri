const $ = id => document.getElementById(id);
const linkPattern = /^(AGW-\d{8}-\d{4,12})\.([A-Za-z0-9_-]{43})$/;
let match = linkPattern.exec(location.hash.slice(1));
const money = cents => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const euros = value => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(value);
const day = date => new Intl.DateTimeFormat('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
const delivery = iso => iso ? day(new Date(`${iso}T12:00:00Z`)) : 'Ei tiedossa';
let paid = false, busy = false, order = null, amount = '';
async function request(simulate) {
  const response = await fetch(`/api/demo-payments/${match[1]}`, {
    method: simulate ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${match[2]}`, ...(simulate ? { 'content-type': 'application/json' } : {}) },
    ...(simulate ? { body: JSON.stringify({ simulate }) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Maksusivua ei voitu avata.');
  return data;
}
const METHODS = { card: 'Kortti •••• 4242', invoice: 'Lasku, 14 pv netto' };
const methodKey = () => `aimo.payMethod.${match[1]}`;
const chosen = () => document.querySelector('input[name="method"]:checked')?.value || 'card';
function savedMethod() {
  try { return sessionStorage.getItem(methodKey()); } catch { return null; }
}
function showState(text, error = false) {
  $('state').hidden = false;
  $('state').classList.toggle('is-error', error);
  $('status').textContent = text;
  $('state-home').hidden = !error;
}
function note(text) { $('note').textContent = text; $('note').hidden = !text; }
function setBusy(on) {
  busy = on;
  for (const id of ['pay', 'cancel']) $(id).disabled = on;
  $('pay').classList.toggle('is-busy', on);
  $('pay-label').textContent = on ? 'Käsitellään maksua…' : payLabel();
}
const payLabel = () => chosen() === 'invoice' ? `Hyväksy lasku ${amount}` : `Maksa ${amount}`;
function selectMethod() {
  const method = chosen();
  $('detail-card').hidden = method !== 'card';
  $('detail-invoice').hidden = method !== 'invoice';
  if (!busy) $('pay-label').textContent = payLabel();
}
function completed() {
  paid = true;
  const method = savedMethod();
  $('state').hidden = true; $('checkout').hidden = true; $('done').hidden = false;
  $('done-title').textContent = method === 'invoice' ? 'Tilaus vahvistettu' : 'Maksu onnistui';
  $('done-order').textContent = order.orderId;
  $('done-amount').textContent = amount;
  $('done-delivery').textContent = delivery(order.deliveryDate);
  $('done-method-row').hidden = !METHODS[method];
  $('done-method').textContent = METHODS[method] || '';
  // Sama tunniste avaa tämän tilauksen agentin jäljen; palvelimelta ei tarvita muuta.
  $('trace').href = `/agentti.html#${match[1]}.${match[2]}`;
  $('trace').hidden = false;
  document.title = `${$('done-title').textContent} | Aimo-tilausapuri`;
  $('done-title').focus({ preventScroll: true });
}
// Tämän selaimen omat tilaukset (Tilaukset-sivu). Vain avattujen, voimassa olevien linkkien numero ja tunniste.
const OWN = 'aimo.ownOrders.v1';
function remember(orderId, token) {
  try {
    const list = JSON.parse(localStorage.getItem(OWN) || '[]').filter(l => l && l.orderId !== orderId);
    localStorage.setItem(OWN, JSON.stringify([{ orderId, token }, ...list].slice(0, 50)));
  } catch { /* Tallennus voi olla estetty; maksusivu toimii silti linkistä. */ }
}
async function load() {
  // Juuri vahvistettu tilaus on yleensä täällä jo ennen siirtymää (botti välittää sen ennen korisivun vastausta). Jos se
  // on vielä matkalla, kysytään tiheään (0,3 s, sitten enintään 1 s välein) noin 12 s, ennen kuin linkkiä pidetään virheellisenä.
  let data;
  const until = Date.now() + 12000;
  for (let attempt = 0; ; attempt++) {
    try { data = await request(); break; }
    catch (error) {
      if (Date.now() >= until) throw error;
      showState('Odotetaan tilauksen siirtymistä maksusivulle…');
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, 300 * (attempt + 1))));
    }
  }
  remember(match[1], match[2]);
  order = data.order;
  amount = money(data.payment.amountNetCents);
  $('order-id').textContent = order.orderId;
  $('delivery').textContent = delivery(order.deliveryDate);
  $('amount').textContent = amount;
  $('invoice-ref').textContent = order.orderId;
  $('due-date').textContent = day(new Date(Date.now() + 14 * 864e5));
  $('lines').replaceChildren(...order.lines.map(line => {
    const row = document.createElement('li'), name = document.createElement('span'), quantity = document.createElement('small'), price = document.createElement('strong');
    name.className = 'line-name'; name.textContent = line.name;
    quantity.textContent = `${new Intl.NumberFormat('fi-FI').format(line.quantity)} ${line.unit}`;
    price.textContent = euros(line.net);
    name.append(quantity); row.append(name, price); return row;
  }));
  if (data.payment.status === 'paid') return completed();
  $('state').hidden = true; $('checkout').hidden = false;
  selectMethod();
}
async function act(simulate) {
  if (busy) return;
  note('');
  if (simulate === 'success' && !paid) {
    try { sessionStorage.setItem(methodKey(), chosen()); } catch { /* Maksutapa näkyy vain tällä kertaa. */ }
  }
  setBusy(true);
  try {
    const data = await request(simulate);
    if (data.status === 'paid') completed();
    else note('Maksu peruttiin. Tilaus odottaa maksua, ja voit maksaa sen myöhemmin samasta linkistä.');
  } catch (error) {
    if (paid) { $('done-note').textContent = `${error.message} Maksu on jo hyväksytty.`; $('done-note').hidden = false; }
    else note(`${error.message} Yritä uudelleen.`);
  } finally { setBusy(false); }
}
for (const input of document.querySelectorAll('input[name="method"]')) input.addEventListener('change', selectMethod);
$('pay').addEventListener('click', () => { void act('success'); });
$('cancel').addEventListener('click', () => { void act('cancel'); });
// A second link to this same page can change only the fragment; restart its read
// so the previous order's summary and action handlers cannot remain on screen.
window.addEventListener('hashchange', () => location.reload());
function init() {
  if (match) return load();
  // Pelkällä tilausnumerolla ei avaudu mitään: tilaus näkyy vain sen omasta linkistä.
  showState(/^AGW-\d{8}-\d{4,12}$/.test(location.hash.slice(1))
    ? 'Avaa maksu tilauksen omasta linkistä (ostoskorin Siirry maksamaan -painike).'
    : 'Avaa maksu tilauksen omasta maksulinkistä.', true);
}
void Promise.resolve().then(init).catch(error => { showState(error.message, true); });
