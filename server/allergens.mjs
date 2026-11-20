// GS1-allergeenikoodien hierarkia ja kiellon tarkistus. Yksi paikka kaikille allergeenikielloille:
// mandaatti, portin haku, tuotetyökalut, korvaajat ja WhatsAppin vaihtoehtolista.
//
// Valion datassa noin 120 tuotteella on vain mantelin, hasselpähkinän tai muun pähkinän alakoodi ilman yleiskoodia AN,
// ja noin 320:lla vain vehnän, ohran tai muun viljan koodi ilman AW:tä (katselmus 15.11. #2). Pelkkä täsmällinen koodivertailu
// päästi pähkinäkiellolla läpi mantelijuoman. Siksi kielto katsoo myös koodin ylä- ja alakoodit.

/** Alakoodi → yleiskoodi. AN = pähkinät, AW = gluteenia sisältävät viljat, AM = maito. */
export const ALLERGEN_PARENT = Object.freeze({
  SA: 'AN', SC: 'AN', SH: 'AN', SM: 'AN', SP: 'AN', SQ: 'AN', SR: 'AN', ST: 'AN', SW: 'AN', // manteli, cashew, hasselpähkinä, macadamia, pekaani, queensland, para, pistaasi, saksanpähkinä
  UW: 'AW', GB: 'AW', GO: 'AW', GK: 'AW', GS: 'AW', NR: 'AW', // vehnä, ohra, kaura, kamut, speltti, ruis
  ML: 'AM', // laktoosi on maidon ainesosa
});
const CHILDREN = Object.freeze(Object.entries(ALLERGEN_PARENT).reduce((m, [child, parent]) => ({ ...m, [parent]: [...(m[parent] || []), child] }), {}));

/** Koodit, joihin kielto ulottuu: koodi itse ja sen alakoodit (AN → AN, SA, SC, …). */
export const allergenFamily = (code) => [code, ...(CHILDREN[code] || [])];

/**
 * Mitkä kielletyistä koodeista osuvat tuotteen koodilistaan?
 * - täsmällinen koodi tai sen alakoodi: pähkinäkielto (AN) osuu mantelin (SA) koodiin
 * - alakoodin kielto osuu yleiskoodiin, jos tuote ei tarkenna, mikä ryhmän allergeeni on: mantelikielto (SA) osuu
 *   tuotteeseen, jolla on vain AN, mutta ei tuotteeseen, jonka pähkinäksi on merkitty hasselpähkinä (AN + SH)
 * - laktoosikielto (ML) osuu maitoon (AM) vain, jos tuotetta ei ole merkitty laktoosittomaksi
 * @param {string[]} banned kielletyt GS1-koodit
 * @param {string[]} codes tuotteen contains- tai mayContain-lista
 * @param {{labels?: string[]}} [product]
 */
export function bannedHits(banned, codes, product = {}) {
  const have = new Set(codes || []);
  if (!have.size) return [];
  return [...new Set(banned || [])].filter((b) => {
    if (allergenFamily(b).some((c) => have.has(c))) return true;
    const parent = ALLERGEN_PARENT[b];
    if (!parent || !have.has(parent)) return false;
    if (b === 'ML') return !(product.labels || []).includes('FREE_FROM_LACTOSE');
    return !(CHILDREN[parent] || []).some((c) => have.has(c));
  });
}

/**
 * Tuotteen allergeenitilanne kieltoja vasten.
 * contains = kielletty allergeeni on tuotteessa (este), mayContain = "voi sisältää" (ihminen päättää),
 * unknown = tuotteelta puuttuu allergeenitieto kokonaan eikä sopivuutta voi todentaa (ihminen päättää).
 */
export function allergenStatus(banned, product) {
  const list = [...new Set(banned || [])];
  if (!list.length) return { contains: [], mayContain: [], unknown: false };
  if (!product) return { contains: [], mayContain: [], unknown: true };
  const contains = bannedHits(list, product.contains, product);
  const mayContain = bannedHits(list.filter((b) => !contains.includes(b)), product.mayContain, product);
  return { contains, mayContain, unknown: !product.hasAllergenData };
}

/** Sisältääkö tuote kiellettyä allergeenia (hierarkia huomioiden)? */
export const containsBanned = (banned, product) => bannedHits(banned, product?.contains, product).length > 0;
/** Sisältääkö tai voiko tuote sisältää kiellettyä allergeenia? Puuttuva tieto ei ole osuma. */
export const touchesBanned = (banned, product) => containsBanned(banned, product) || bannedHits(banned, product?.mayContain, product).length > 0;
/** Tiukka tarkistus: tuote on todennetusti vapaa kielletyistä. Puuttuva tieto ei ole todiste sopivuudesta. */
export const verifiedFree = (banned, product) => !(banned || []).length || (!!product?.hasAllergenData && !touchesBanned(banned, product));
