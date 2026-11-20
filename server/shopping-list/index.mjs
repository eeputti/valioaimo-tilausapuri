// Nykyisen luonnoksen rakenteinen näkymä korisivulle ja kaupalle. Näkymä ei tulkitse viestejä uudelleen
// eikä hyväksy tilausta: se vain kertoo, mitä luonnoksessa on ja mitä siitä vielä puuttuu.

function ownedBy(draft, customer) {
  if (!customer || customer.permissions?.readProducts !== true) return false;
  return draft.customerId === customer.customerId && draft.bindingVersion === customer.bindingVersion;
}

function gapsIn(draft) {
  const gaps = [];
  if (!draft.deliveryDate) gaps.push('deliveryDate');
  if (!draft.deliverySiteId) gaps.push('deliverySiteId');
  const pending = draft.pending;
  if (pending?.kind === 'preference') gaps.push(...pending.refs.map((ref) => `preference:${ref}`));
  for (const { ref, quantity } of draft.lines) {
    if (!quantity) gaps.push(`quantity:${ref}`);
  }
  return gaps;
}

function quantityView(quantity) {
  if (!quantity) return null;
  const view = { value: quantity.value, unit: quantity.unit };
  if (quantity.basis) view.basis = quantity.basis;
  return view;
}

const lineView = (line) => ({
  ref: line.ref,
  productTerm: line.productTerm,
  quantity: quantityView(line.quantity),
  claims: Array.from(line.claims),
  excludeAllergens: Array.from(line.excludeAllergens),
  selectedProductId: line.selectedProductId || null,
  selectedName: line.selectedName || null,
});

function statusOf(gaps, lines) {
  if (gaps.length) return 'needs_details';
  return lines.every((line) => line.selectedProductId) ? 'review' : 'needs_product_selection';
}

export function shoppingListView(draft, customer) {
  const usable = draft && draft.state === 'active' && draft.lines?.length > 0;
  if (!usable || !ownedBy(draft, customer)) return null;
  const gaps = gapsIn(draft);
  const diet = draft.diet || {};
  return {
    schemaVersion: 1,
    source: 'whatsapp',
    id: draft.id,
    revision: draft.revision,
    buyerId: customer.buyerId,
    companyName: customer.companyName,
    deliveryDate: draft.deliveryDate || null,
    deliverySiteId: draft.deliverySiteId || null,
    diet: { known: diet.known === true, claims: Array.from(diet.claims || []), excludeAllergens: Array.from(diet.excludeAllergens || []) },
    lines: draft.lines.map(lineView),
    missing: gaps,
    status: statusOf(gaps, draft.lines),
    // Näkymässä ei ole tunnisteita, puhelinnumeroita eikä tarjouksen hyväksyntää. Tilaus vaatii aina erillisen vahvistuksen.
    requiresExplicitConfirmation: true,
  };
}
