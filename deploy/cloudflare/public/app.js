const $ = id => document.getElementById(id);
const currency = value => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(value);
const date = value => value ? new Intl.DateTimeFormat('fi-FI', { dateStyle: 'short', timeZone: 'Europe/Helsinki' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : 'Ei toimituspäivää';
const time = value => new Intl.DateTimeFormat('fi-FI', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Helsinki' }).format(new Date(value));
const labels = { confirmed: 'Vahvistettu', pending_approval: 'Odottaa hyväksyntää', rejected: 'Hylätty' };
let data, filter = 'all', lastRendered, serverOffset = 0, failed = false, loading = false;
const element = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function connection() {
  const age = data?.receivedAt ? Date.now() + serverOffset - data.receivedAt : Infinity;
  const live = !failed && age < 30000;
  $('connection-dot').className = `dot${live ? ' live' : ' stale'}`;
  $('connection-title').textContent = live ? 'Tilausyhteys toimii' : failed ? 'Päivitys ei juuri nyt onnistu' : data?.receivedAt ? 'Julkaisuyhteys on tauolla' : 'Odotetaan tilausyhteyttä';
  $('connection-detail').textContent = data?.receivedAt ? `Viimeksi päivitetty ${time(data.receivedAt)}. ${live ? 'Uudet tilaukset näkyvät automaattisesti.' : 'Näytetään viimeisin vastaanotettu tilanne.'}` : 'Ensimmäinen tilannekuva tulee, kun demon julkaisija on käynnissä.';
}
function render() {
  if (!data) return;
  const key = JSON.stringify([data.orders, data.totalOrders, filter]);
  if (key === lastRendered) return;
  lastRendered = key;
  $('order-count').textContent = `${data.totalOrders} ${data.totalOrders === 1 ? 'oma tilaus' : 'omaa tilausta'} tässä selaimessa`;
  const orders = data.orders.filter(order => filter === 'all' || order.channel === filter);
  $('orders').replaceChildren();
  if (!orders.length) {
    const empty = element('div', undefined, 'empty');
    empty.append(element('div', '↘', 'empty-icon'), element('h3', 'Tässä selaimessa ei ole vielä tilauksia'), element('p', 'Tilaukset näkyvät vain tilaajalle. Vahvista tilaus ostoskorissa ja avaa Siirry demomaksuun: tilaus tallentuu tähän selaimeen.'));
    $('orders').append(empty); return;
  }
  for (const order of orders) {
    const article = element('article', undefined, 'order'), head = element('div', undefined, 'order-head'), info = element('div');
    article.id = order.orderId;
    const payment = order.demoPayment?.mode === 'demo' && ['pending', 'paid'].includes(order.demoPayment.status) ? order.demoPayment : null;
    const heading = element('div', undefined, 'order-heading');
    heading.append(element('h3', order.orderId), element('span', order.channel === 'whatsapp' ? 'WhatsApp' : 'Selaindemo', `channel${order.channel === 'browser-demo' ? ' browser' : ''}`));
    info.append(heading, element('p', `Vastaanotettu ${time(order.createdAt)}, toimitus ${date(order.deliveryDate)}`, 'order-meta'));
    head.append(info, element('span', payment ? payment.status === 'paid' ? 'Demomaksu hyväksytty' : 'Odottaa demomaksua' : labels[order.status], `status ${payment ? payment.status === 'paid' ? 'confirmed' : 'pending_approval' : order.status}`));
    const body = element('div', undefined, 'order-body'), table = element('table'), thead = element('thead'), header = element('tr'), tbody = element('tbody');
    for (const title of ['Tuote', 'Määrä', 'Veroton summa']) header.append(element('th', title));
    thead.append(header);
    for (const line of order.lines) {
      const row = element('tr'), product = element('td', line.name);
      product.append(element('span', line.productId, 'product-id'));
      row.append(product, element('td', `${new Intl.NumberFormat('fi-FI').format(line.quantity)} ${line.unit}`, 'quantity'), element('td', currency(line.net)));
      tbody.append(row);
    }
    table.append(thead, tbody); body.append(table);
    if (order.lineCount > order.lines.length) body.append(element('p', `Näytetään ${order.lines.length} / ${order.lineCount} tuoteriviä.`, 'truncated'));
    const total = element('div', 'Yhteensä alv 0 %', 'total'); total.append(element('strong', order.net === null ? '–' : currency(order.net))); body.append(total);
    if (payment) {
      const detail = element('div', undefined, 'payment-detail');
      detail.append(element('p', payment.status === 'paid' ? 'Demomaksu on hyväksytty. Rahaa ei veloitettu.' : 'Tilaus odottaa demomaksua.'));
      try {
        const url = new URL(payment.url, location.origin);
        if (url.origin === location.origin && url.pathname === '/demo-payment.html' && /^#AGW-\d{8}-\d{4,12}\.[A-Za-z0-9_-]{43}$/.test(url.hash)) {
          const link = element('a', payment.status === 'paid' ? 'Näytä maksuvahvistus' : 'Avaa demomaksu', 'payment-link');
          link.href = url.href; detail.append(link);
        }
      } catch { /* Invalid payment metadata never creates an external payment link. */ }
      body.append(detail);
    }
    article.append(head, body); $('orders').append(article);
  }
}
// Vain tämän selaimen omat tilaukset: maksusivu tallentaa avatun tilauslinkin (numero ja tunniste) tähän selaimeen.
const ownLinks = () => { try { return JSON.parse(localStorage.getItem('aimo.ownOrders.v1') || '[]').filter(l => l && /^AGW-\d{8}-\d{4,12}$/.test(l.orderId) && /^[A-Za-z0-9_-]{43}$/.test(l.token)).slice(0, 50); } catch { return []; } };
async function refresh() {
  if (loading || document.hidden) return;
  loading = true;
  try {
    const response = await fetch('/api/my-orders', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ links: ownLinks() }) });
    if (!response.ok) throw new Error('Päivitys epäonnistui');
    const next = await response.json();
    if (!Array.isArray(next.orders) || !Number.isFinite(next.serverTime)) throw new Error('Virheellinen vastaus');
    data = { ...next, totalOrders: next.orders.length }; serverOffset = next.serverTime - Date.now(); failed = false; render();
  } catch { failed = true; if (!data) $('order-count').textContent = 'Tilausyhteyttä valmistellaan'; }
  finally { loading = false; connection(); }
}
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  for (const item of document.querySelectorAll('[data-filter]')) item.setAttribute('aria-pressed', String(item === button));
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
await refresh();
setInterval(refresh, 5000);
