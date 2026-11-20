// Tuotteen kappaleet ja tilattavat myyntipakkaukset ovat eri suureita.
// Lukumäärä luetaan ilmoitetusta pakkaustiedosta, ei tuotteen painosta.
const positiveInteger = (n) => Number.isSafeInteger(n) && n > 0;
// Kananmuna: myös "Vapaan kanan muna M10" ja munaosasto (10590), muuten Vapaan kanan munia ei koskaan ehdotettu munamäärälle
// (katselmus 15.11. #22). Munakoiso, munkki ja muut muna-alkuiset sanat eivät ole munia.
const EGG_CATEGORY = '10590';
const egg = (p) => /kananmun|kanan\s+mun(a|at|ia|ien)?\b|\beggs?\b/i.test(p.productTerm || p.name || '') || p.productType === 'eggs' || p.category === EGG_CATEGORY;
export const isEggItem = (p) => egg(p);
// Myyntierä, joka on itse yksi kappale (kappale, paketti, pussi, rasia, purkki, pullo, kanisteri, nippu): "10 kpl" on 10 myyntierää.
const SINGLE_UNITS = new Set(['ST', 'PAK', 'BAG', 'RAS', 'PRK', 'BOT', 'KAN', 'NIP']);
// Laatikon tai kotelon sisällä laskettava perusyksikkö (Valion tuotetieto baseUnit + perSales: KI/ST 30 = 30 kappaletta laatikossa).
const COUNTABLE_BASE = new Set(['ST', 'PAK', 'BAG', 'RAS', 'PRK', 'BOT', 'KAN', 'NIP', 'SK', 'KRT']);
// Nimen monipakkaus ristiintarkistukseksi: "6 x Saarioinen …", "70xFazer …", "Leivos 30x60g", "12x500ml".
const leadingCount = (name) => {
  const m = name.match(/^\s*(\d{1,4})\s*[x×]\s*\S/i) || name.match(/(?<![\d,.])(\d{1,4})\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:g|kg|ml|cl|dl|l)\b/i);
  return m ? Number(m[1]) : null;
};
/** Munakenno on 30 munaa (6 × 5). Kenno on kananmunien määrän sana, ei myyntipakkaus. */
export const EGGS_PER_TRAY = 30;

export function itemsPerSalesUnit(p) {
  if (!p || p.salesUnit === 'KG') return null;
  if (positiveInteger(p.itemsPerSalesUnit)) return { value: p.itemsPerSalesUnit, source: 'product-data' };
  const name = p.name || '';
  const multi = name.match(/\b(\d+)\s*[x×]\s*(\d+)\s*(?:kpl|pcs|kappaletta|pieces)\b/i);
  const single = name.match(/\b(\d+)\s*(?:kpl|pcs|kappaletta|pieces)\b/i);
  // Kananmunien tuotenimissä M6/M10/M90 tarkoittaa kokoluokkaa ja ilmoitettua lukumäärää.
  const eggPack = egg(p) && !/keitet|kuorit|massa|valkuai|keltuai|jauhe|pasta/i.test(name)
    ? name.match(/\b(?:XS|XL|[SML])(?:\s*\/\s*(?:XS|XL|[SML]))?\s*(\d{1,3})\b/i) : null;
  const namedCount = multi ? Number(multi[1]) * Number(multi[2]) : Number(single?.[1] || eggPack?.[1]);
  const factor = p.baseUnit && p.salesUnit && p.baseUnit !== p.salesUnit ? p.perSales : 1;
  if (positiveInteger(namedCount)) {
    // Nimen monipakkaus ja erillinen yksikkömuunnos voivat kuvata samaa kertolaskua. Epäselvää tietoa ei kerrota kahdesti.
    if (!positiveInteger(factor) || (multi && factor !== 1)) return null;
    const count = namedCount * factor;
    return positiveInteger(count) ? { value: count, source: factor === 1 ? 'product-name' : 'product-name-and-unit-conversion' } : null;
  }
  // Kananmunien määrä luetaan vain ilmoitetusta munamäärästä: painosta tai pakkauksesta ei arvata.
  if (egg(p)) return null;
  // Muut tuotteet: "10 kpl" leivoksia on 10 leivosta, ei 10 laatikkoa (selainkokeilu 17.11.). Laatikon kappaleet tulevat
  // Valion yksikkömuunnoksesta (KI/ST perSales 30), ja nimen monipakkaus ("30x60g") saa vain vahvistaa sen.
  const lead = leadingCount(name);
  if (factor !== 1) {
    if (!positiveInteger(factor) || !COUNTABLE_BASE.has(p.baseUnit)) return null;
    if (lead && lead !== factor) return null; // nimi ja muunnos ristiriidassa: ei arvata
    return { value: factor, source: 'unit-conversion' };
  }
  if (SINGLE_UNITS.has(p.salesUnit)) return { value: 1, source: 'sales-unit' };
  if (p.salesUnit === 'DZ') return { value: 12, source: 'sales-unit' };
  // Laatikko tai kotelo ilman yksikkömuunnosta: vain nimen monipakkaus kelpaa ("Munkkimiehet Lihapasteija 60x90g" KI/KI).
  return positiveInteger(lead) ? { value: lead, source: 'product-name' } : null;
}

// Kappalemäärä vai myyntierät: "10 kpl" ja "10 leivosta" laskevat tuotteita (items), "2 laatikkoa", "3 pakettia" ja
// "5 rasiaa" myyntieriä (sales). Ennen 17.11. kappaleiksi luettiin vain kananmunat, ja "10 kpl" leivoksia oli 10 laatikkoa.
export const PIECE_WORD = /^(?:kpl|kappale\w*|pcs|pc|pieces?)$/i;
export function quantityBasisFor(item, unitWord) {
  if (item.quantity?.unit !== 'PCS') return undefined;
  if (item.quantity.basis === 'sales' || item.quantity.basis === 'items') return item.quantity.basis;
  if (item.attributes?.pack) return 'sales';
  return !unitWord || PIECE_WORD.test(unitWord) ? 'items' : 'sales';
}

export function explainItemQuantity(p, quantity, salesUnits) {
  if (quantity?.unit !== 'PCS' || quantity.basis !== 'items') return null;
  const count = itemsPerSalesUnit(p);
  if (!count || !(salesUnits > 0)) return null;
  const providedItems = salesUnits * count.value;
  const fmt = (n) => Number(n).toLocaleString('fi-FI', { maximumFractionDigits: 3 });
  const noun = egg(p) ? 'munaa' : 'kpl';
  return {
    itemsPerSalesUnit: count.value, requestedItems: quantity.value, providedItems,
    excessItems: +(providedItems - quantity.value).toFixed(6), salesUnits, source: count.source,
    text: `${fmt(salesUnits)} ${p.salesUnit === 'RAS' ? 'rasiaa' : p.salesUnit === 'KI' ? 'laatikkoa' : p.salesUnit === 'ST' ? 'kpl' : 'pakkausta'} × ${fmt(count.value)} ${noun} = ${fmt(providedItems)} ${noun}${providedItems > quantity.value ? ` (tarve ${fmt(quantity.value)})` : ''}`,
  };
}
