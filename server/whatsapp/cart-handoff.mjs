// WhatsApp acknowledgements open the existing cart; they never authorize an order.
const ACK = /^(?:ok|okay|okei|joo|kyllä|juu|jep|jes|selvä|sopii|hyvä|👍)(?:[,\s]+(?:kiitos|sopii|hyvä|mennään|jatketaan))?[.!\s👍]*$/iu;
const OPEN_CART = /^(?:(?:ok|okei|joo|kyllä)[,\s]+)?(?:(?:avaa|näytä)\s+(?:ostos)?kori(?:ni)?|(?:anna|lähetä|laita)\s+(?:se\s+)?linkki(?:\s+(?:ostos)?koriin)?|(?:ostos)?korilinkki|linkki\s+(?:ostos)?koriin|tilaa|vahvista|vahvistan|hyväksy|hyväksyn)(?:[,\s]+kiitos)?[.!\s]*$/iu;
const HINT = 'Vastaa *ok*, niin saat linkin ostoskoriin. Tarkistat ja vahvistat tilauksen siellä.';

/** Suora korin tai linkin pyyntö ("avaa kori", "laita linkki", vanha TILAA). */
export function isDirectCartRequest(text) { return typeof text === 'string' && OPEN_CART.test(text.trim()); }

export function isCartHandoff(text) {
  return typeof text === 'string' && (ACK.test(text.trim()) || OPEN_CART.test(text.trim()));
}

export function withCartHandoffHint(result) {
  if (result.status !== 'ready') return result;
  // Omalla rivillään oleva ohje jaetaan kahdelle riville (tilausluonnoksen pohja, Eelis 18.11.); lauseen keskellä yhtenä.
  const rewrite = (text) => text.replace(/(?:Vahvista(?: valmis)?(?: tilaus)? vastaamalla|vastaa)\s+\*?TILAA\*?(?:,\s*kun haluat tilata)?[.!]?/giu,
    (match, at, whole) => (at === 0 || whole[at - 1] === '\n' ? HINT.replace('. ', '.\n') : HINT))
    .replace(/\s*Muuten luonnos jää odottamaan\./gu, '');
  return { ...result, text: rewrite(result.text),
    ...(result.messages ? { messages: result.messages.map(rewrite) } : {}) };
}

export async function replyWithCartLink({ text, shoppingList, lastOrder, pendingSuggestion, cartHandoff }) {
  if (!cartHandoff || !isCartHandoff(text) || !shoppingList?.lines?.length) return null;
  // An answer to a product suggestion, missing quantity or diet question must keep its meaning.
  const direct = OPEN_CART.test(text.trim());
  // Linkki vain valmiiseen tilaukseen (Eelis 15.11. klo 2.00): päivä, määrät, tuotevalinnat ja tarkennukset selvitetty.
  // Keskeneräisessä listassa keskustelu opastaa loppuun eikä linkkiä anneta, myöskään suoraan pyydettynä.
  if (shoppingList.status !== 'review') return null;
  if (!direct && (pendingSuggestion || lastOrder?.status !== 'ready'
      || lastOrder.draftId !== shoppingList.id || lastOrder.revision !== shoppingList.revision)) return null;
  let url;
  try {
    const link = await cartHandoff({ shoppingList });
    const parsed = new URL(link);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed.href;
  } catch { /* A missing link must never fall through to order submission. */ }
  const message = url
    ? `Tässä linkki ostoskoriisi. Tarkista tuotteet ja vahvista tilaus siellä:\n${url}`
    : 'Ostoskorilinkki ei nyt avaudu. Ostoskorisi on tallessa. Pyydä linkkiä hetken kuluttua uudelleen.';
  return { status: shoppingList.status === 'review' ? 'ready' : 'collecting',
    draftId: shoppingList.id, revision: shoppingList.revision, text: message, messages: [message] };
}
