// Local human approval of the existing gateway order. All decisions stay server-side.
const id = new URL(location.href).searchParams.get('order');
const $ = (name) => document.getElementById(name);
const euro = (value) => Number.isFinite(value) ? new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(value) : '–';
let busy = false;
function disable() { $('approve').disabled = true; $('reject').disabled = true; }
async function request(action) {
  const response = await fetch(`/console/orders/${encodeURIComponent(id)}${action ? `/${action}` : ''}`, {
    ...(action ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'Paikallinen hyväksyjä' }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Tilauksen käsittely epäonnistui.');
  return result;
}
function render(order) {
  const labels = { pending_approval: 'Tilaus odottaa hyväksyntää.', confirmed: 'Demotilaus on vahvistettu.', rejected: 'Demotilaus on hylätty.', expired: 'Hyväksyntä on vanhentunut.' };
  $('status').textContent = labels[order.status] || `Tilauksen tila: ${order.status}`;
  $('number').textContent = order.orderId;
  $('delivery').textContent = `Toimituspäivä: ${order.deliveryDate || '–'}`;
  $('lines').replaceChildren(...(order.lines || []).map((line) => {
    const item = document.createElement('li');
    item.textContent = `${line.name || line.productId}: ${line.quantity} ${line.salesUnitLabel || 'myyntiyksikköä'}, ${euro(line.lineNet)} (alv 0 %)`;
    return item;
  }));
  $('total').textContent = `Yhteensä (alv 0 %): ${euro(order.totals?.net)}`;
  $('reasons').replaceChildren(...(order.reasons?.length ? order.reasons : [{ message: 'Ei lisähuomioita.' }]).map((reason) => {
    const item = document.createElement('li'); item.textContent = reason.text || reason.message || reason.code; return item;
  }));
  $('order').hidden = false;
  $('approve').disabled = busy || order.status !== 'pending_approval';
  $('reject').disabled = busy || order.status !== 'pending_approval';
}
async function load(action) {
  if (busy) return;
  busy = true; disable(); $('error').textContent = '';
  try {
    if (!/^AGW-\d{8}-\d{4,12}$/.test(id || '')) throw new Error('Tilauksen tunniste puuttuu tai on virheellinen.');
    const order = await request(action); busy = false; render(order);
  } catch (error) { $('error').textContent = error.message; disable(); }
  finally { busy = false; }
}
$('approve').addEventListener('click', () => load('approve'));
$('reject').addEventListener('click', () => load('reject'));
$('refresh').addEventListener('click', () => load());
load();
