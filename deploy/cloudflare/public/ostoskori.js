// Ostoskori-välilehti: sivu on aina Toimitustukun korin näköinen. Jos tämän selaimen keskustelussa (Keskustele-välilehti)
// on jo kori, avataan se samalla sivustolla (/whatsapp/cart#…). Muuten näkyy tyhjä kori ja ohje tilata WhatsAppissa:
// WhatsAppissa koottu kori aukeaa vain apurin lähettämästä Avaa ostoskori -linkistä, jota tämä sivu ei voi arvata.
const CART = /^\/whatsapp\/cart#[A-Za-z0-9_.-]+$/;

export async function browserChatCart(fetcher = fetch) {
  try {
    const response = await fetcher('/api/chat/cart', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return typeof data.url === 'string' && CART.test(data.url) ? data.url : null;
  } catch { return null; }
}

if (typeof document !== 'undefined') {
  void browserChatCart().then((url) => { if (url) location.replace(url); });
}
