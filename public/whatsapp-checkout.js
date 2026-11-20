// A confirmed order opens its own demo payment. Rendering never submits a payment.
export function showDemoCheckout(result, { container, document: doc = globalThis.document } = {}) {
  let url;
  try {
    url = new URL(result?.checkout?.url);
    if (result?.status !== 'confirmed' || result.checkout.mode !== 'demo'
        || !/^AGW-\d{8}-\d{4,12}$/.test(result.orderId || '')
        || url.protocol !== 'https:' || url.username || url.password || url.search
        || url.pathname !== '/demo-payment.html' || !new RegExp(`^#${result.orderId}\\.[A-Za-z0-9_-]{43}$`).test(url.hash)) return false;
  } catch { return false; }
  container ||= doc.getElementById('demo-checkout');
  if (!container) {
    container = doc.createElement('section'); container.id = 'demo-checkout';
    const anchor = doc.getElementById('review-panel') || doc.getElementById('basket');
    (anchor?.parentNode || doc.body).append(container);
  }
  if (!doc.getElementById('demo-checkout-style')) {
    const style = doc.createElement('link'); style.id = 'demo-checkout-style'; style.rel = 'stylesheet'; style.href = '/whatsapp/checkout.css';
    doc.head.append(style);
  }
  const note = doc.createElement('p'); note.textContent = `Tilaus ${result.orderId}. Jatka demomaksuun. Rahaa ei veloiteta.`;
  const link = doc.createElement('a'); link.href = url.href; link.textContent = 'Siirry demomaksuun';
  link.className = 'demo-checkout-link'; link.referrerPolicy = 'no-referrer';
  container.replaceChildren(note, link); container.hidden = false;
  return true;
}

globalThis.addEventListener?.('aimo:order-result', event => showDemoCheckout(event.detail));
