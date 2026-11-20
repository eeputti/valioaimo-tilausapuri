// Korisivulle näytettävä kuva WhatsApp-luonnoksesta ja sen tuoreesta tarjouksesta.
// notes: korisivun "Tarkista nämä ensin" -huomiot (cart-notes.mjs), vain valmiille korille.
const WAITING_MESSAGE = 'Täydennä tuotteen valinta, määrä ja toimitustiedot WhatsAppissa.';
const COMPARISON_UNITS = new Set(['L', 'KG', 'PCS']);

// Vertailuhinta vain Valion hintarajapinnasta (alv 0 %); ilman sitä sarake jää tyhjäksi eikä arvoa lasketa itse.
function comparisonOf(line) {
  if (!(line.comparisonPrice > 0) || !COMPARISON_UNITS.has(line.comparisonUnit)) return null;
  return { value: line.comparisonPrice, unit: line.comparisonUnit };
}

function cartLine(line) {
  const vatKnown = line.vatRate != null;
  return {
    id: line.productId,
    name: line.name,
    qty: line.salesUnits,
    price: line.unitPriceNet,
    vat: vatKnown ? line.vatRate : null,
    taxUnknown: !vatKnown,
    unit: line.salesUnitLabel,
    requested: line.covers,
    image: `/img/${encodeURIComponent(line.productId)}`,
    comparison: comparisonOf(line),
  };
}

export function storefrontCartProjection(list, quote, notes = []) {
  const head = {
    source: `whatsapp:${list.buyerId}`,
    id: list.id,
    revision: list.revision,
    companyName: list.companyName,
    deliveryDate: list.deliveryDate,
  };
  const ready = list.status === 'review' && quote && quote.issues.length === 0;
  if (!ready) return { ...head, state: 'waiting', lines: [], message: WAITING_MESSAGE };
  const shownNotes = notes.map(({ key, kind, productId, title, text }) => ({ key, kind, productId, title, text }));
  return { ...head, state: 'ready', lines: quote.lines.map(cartLine), notes: shownNotes };
}
