// Huomioita ostoskorista WhatsApp-korisivulle (Eelis 17.11., idea Mankelin S.I.MO:n vahvistussivusta).
// Jokainen huomio lasketaan tarkistetusta tarjouksesta, Valion tuotetiedoista tai ostajan omista tilauksista: ei kielimallia
// eikä arvauksia. Huomiot ovat pelkkää tietoa: Eeliksen päätöksellä niitä ei kuitata erikseen, vaan ostaja näkee korin ja
// hyväksyy sen SIIRRY MAKSAMAAN -painikkeella. Mandaatti ja hyväksyntä toimivat kuten ennen.
import { amountPhrase, packWord, readableName } from './order-conversation/wording.mjs';

// OLETUS: demon kynnykset. Määrää verrataan saman tuotteen tavalliseen (mediaani) määrään vähintään kahdessa
// vahvistetussa tilauksessa, kuten portin vahdissa (watch.mjs). Huomio tulee jo kaksinkertaisesta, hyväksyntä vasta kolminkertaisesta.
export const NOTES = { minHistory: 2, quantityFactor: 2, roundingShare: 0.1, history: 50 };

const CLAIM = { FREE_FROM_LACTOSE: 'laktoositon', LOW_LACTOSE: 'vähälaktoosinen', FREE_FROM_GLUTEN: 'gluteeniton', VEGAN: 'vegaaninen', VEGETARIAN: 'kasvis', EU_ORGANIC_FARMING: 'luomu' };
const UNIT = { L: 'l', KG: 'kg', PCS: 'kpl' };
const num = (n) => String(+Number(n).toFixed(3)).replace('.', ',');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const day = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : '');
const units = (n, label) => `${num(n)} ${packWord(n, label || 'kpl')}`;
const names = (lines) => lines.map((l) => readableName(l.name)).join(', ');
function fetchedLabel(iso) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return ` (haettu ${parts.day}.${parts.month}. klo ${parts.hour}.${parts.minute})`;
}

/**
 * @param {{list: object, quote: object, orders?: object[], product?: (id: string) => object|null, cycle?: number|null}} input
 *   list: shoppingListView, quote: order-tools quote (valmis, ei issueita), orders: ostajan gateway-tilaukset uusin ensin,
 *   cycle: kiertävän demokellon kierros (null, kun kello ei kierrä).
 * @returns {Array<{key: string, kind: string, productId: string|null, title: string, text: string}>}
 */
export function cartNotes({ list, quote, orders = [], product = () => null, cycle = null }) {
  if (!list || !quote?.lines?.length || quote.issues?.length) return [];
  const own = `whatsapp:${list.id}`;
  const history = orders.filter((o) => o.buyerReference !== own).slice(0, NOTES.history);
  const settled = history.filter((o) => o.status === 'confirmed' && o.lines?.length);
  const open = history.filter((o) => ['confirmed', 'pending_approval'].includes(o.status) && o.deliveryDate === list.deliveryDate
    && (cycle == null || (o.clockCycle ?? 0) === cycle));
  const notes = [];
  for (const line of quote.lines) {
    const id = String(line.productId); const source = list.lines.find((l) => l.ref === line.ref) || list.lines.find((l) => l.selectedProductId === id);
    const qty = Number(line.salesUnits); const label = line.salesUnitLabel;

    // 1) Sama tuote on jo tulossa samana toimituspäivänä toisessa tilauksessa: mahdollinen tuplatilaus.
    const already = open.map((o) => ({ o, n: o.lines.filter((l) => String(l.productId) === id).reduce((s, l) => s + Number(l.quantity || 0), 0) })).filter((x) => x.n > 0);
    if (already.length) {
      const what = already.map(({ o, n }) => `${o.orderId} (${units(n, o.lines.find((l) => String(l.productId) === id)?.salesUnitLabel || label)})`).join(', ');
      notes.push({ key: `duplicate:${id}:${already.map((x) => x.o.orderId).join(',')}`, kind: 'duplicate', productId: id, title: 'Sama tuote on jo tilattu',
        text: `${already.length === 1 ? 'Tilauksessa' : 'Tilauksissa'} ${what} on jo tätä tuotetta samalle toimituspäivälle ${day(list.deliveryDate)}` });
    }

    // 2) Määrä poikkeaa selvästi ostajan tavallisesta määrästä samalle tuotteelle (myyntierinä).
    const past = settled.map((o) => o.lines.filter((l) => String(l.productId) === id).reduce((s, l) => s + Number(l.quantity || 0), 0)).filter((n) => n > 0);
    if (past.length >= NOTES.minHistory && qty > 0) {
      const typical = median(past);
      const more = qty > typical * NOTES.quantityFactor; const less = qty < typical / NOTES.quantityFactor;
      if (more || less) {
        notes.push({ key: `quantity:${id}:${qty}:${typical}`, kind: 'quantity', productId: id, title: more ? 'Tavallista enemmän' : 'Tavallista vähemmän',
          text: `Tilaat ${units(qty, label)}, tavallisesti ${units(typical, label)} (vertailu ${past.length} aiempaan tilaukseen).` });
      }
    }

    // 3) Pyöristys ylöspäin kokonaisiin myyntieriin, kun ylijäämä on yli 10 % pyydetystä.
    const asked = source?.quantity; const covers = line.covers;
    if (asked && covers && asked.unit === covers.unit && asked.basis !== 'sales' && Number(asked.value) > 0
        && Number(covers.value) > Number(asked.value) * (1 + NOTES.roundingShare)) {
      notes.push({ key: `rounded:${id}:${qty}:${asked.value}`, kind: 'rounded', productId: id, title: 'Pyöristetty ylöspäin',
        text: `Pyysit ${num(asked.value)} ${UNIT[asked.unit] || ''}. Tuotetta myydään kokonaisina myyntierinä, joten tulee ${amountPhrase(line)}.` });
    }

    // 4) Pyydetty merkintä (esim. laktoositon) puuttuu valitun tuotteen Valion tuotetiedoista.
    const wanted = [...new Set([...(list.diet?.claims || []), ...(source?.claims || [])])];
    const labels = product(id)?.labels || [];
    const missing = wanted.filter((c) => !labels.includes(c));
    if (missing.length) {
      notes.push({ key: `label:${id}:${missing.join(',')}`, kind: 'label', productId: id, title: 'Merkintä puuttuu',
        text: `Valion tuotetiedoissa tällä tuotteella ei ole merkintää, jota pyysit: ${missing.map((c) => CLAIM[c] || c).join(', ')}.` });
    }
  }

  // Koko tilausta koskevat huomiot: yksi kuittaus, ei sama huomio jokaisella rivillä.
  const unknownStock = quote.lines.filter((l) => l.stockKnown === false);
  if (unknownStock.length) {
    notes.push({ key: `stock:${unknownStock.map((l) => l.productId).sort().join(',')}`, kind: 'stock', productId: null, title: 'Saldoa ei vahvistettu',
      text: `Valion rajapinta ei kerro tarkkaa saldoa ${unknownStock.length === 1 ? 'tälle tuotteelle' : 'näille tuotteille'}: ${names(unknownStock)}.` });
  }
  const oldPrice = quote.lines.filter((l) => l.priceCurrent === false);
  if (oldPrice.length) {
    const oldest = oldPrice.map((l) => l.priceFetchedAt).filter(Boolean).sort()[0];
    notes.push({ key: `price:${oldPrice.map((l) => l.productId).sort().join(',')}`, kind: 'price', productId: null, title: 'Hinta ei ole ajantasainen',
      text: `Valion hintarajapinta ei vastannut, joten hinta on viimeisin tunnettu${fetchedLabel(oldest)}: ${names(oldPrice)}.` });
  }
  return notes;
}
