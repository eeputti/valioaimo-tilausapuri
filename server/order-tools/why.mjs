// Miksi juuri nämä vaihtoehdot näytettiin. suggest() laskee syyn jokaiselle näytetylle vaihtoehdolle, ja se tallentuu
// luonnoksen mukana (draft.offered), jotta agentin jälki voi kertoa sen kokille ja Valiolle. Pelkkää kirjanpitoa:
// tämä ei muuta järjestystä, valintaa eikä sitä, mitä WhatsAppissa näytetään.
//
// pick.codes:
//   REQUESTED       pyydettyä tuotetta (haun requested tai nimen sana)
//   NEAREST         lähin tilattava vaihtoehto, kun yksikään vaihtoehto ei ole pyydettyä tuotetta
//   OTHER_PRODUCT   haku tietää, ettei tämä ole pyydettyä tuotetta, vaikka muut ovat (kuratoidulla tuotetyypillä haku ei
//                   erottele, eikä nimen sanavertailu riitä väitteeksi: "kanan muna" on kananmunaa, joten silloin ei koodia)
//   CHEAPEST        halvin tarpeen kattava parhaan tuotetyypin tavallisista; on aina ensimmäisellä sivulla
//   CHEAPEST_ADDED  nostettiin ensimmäiselle sivulle halvimpana, vaikka järjestys olisi jättänyt sen pois
//   OTHER_TYPE      valmiste tai muu tuote: järjestetty pyydetyn tuotteen jälkeen
//   SPECIAL         maustettu, erikoinen tai yli kaksi kertaa tavallista kalliimpi: tavallisten jälkeen
//   PRICEY_LAST     yli kaksi kertaa halvimman hintainen: näytettyjen viimeisenä
//   OVERSIZE        moninkertaisesti tarvetta suurempi erä
//   SIZE_UNKNOWN    määrää ei tiedetä pyydetyssä yksikössä (esim. nippu kilotarpeeseen)
//   NEXT_PAGE       "Näytä lisää" -sivulta: seuraavat järjestyksessä, jo näytetyt pois
//   SUBSTITUTE      korvaava tuote, koska pyydettyä ei ollut tilattavissa
//   SIMILAR_KNOWN   pyydetyn tuotteen saatavuutta ei saatu: vastaava tuote, jonka saatavuus tunnetaan (suggestin oma haara)
// pick.place: sija kaikkien sopivien järjestyksessä (1 = paras).
// pool: koko rivin luvut. orderable = toimituspäivälle tilattavat hakuosumat, suitable = ruokavalion ja ehtojen jälkeen,
//   requested = niistä pyydettyä tuotetta, shown = näytetty nyt, more = tälle päivälle on vielä näyttämättömiä.
export const PICK_CODES = ['REQUESTED', 'NEAREST', 'OTHER_PRODUCT', 'CHEAPEST', 'CHEAPEST_ADDED', 'OTHER_TYPE', 'SPECIAL', 'PRICEY_LAST', 'OVERSIZE', 'SIZE_UNKNOWN', 'NEXT_PAGE', 'SUBSTITUTE', 'SIMILAR_KNOWN'];

/**
 * @param {object} s suggestin omat välitulokset: found (haun tilattavat), fit (sopivat järjestyksessä), scored (scoreOptions),
 *   first (ensimmäisen sivun ehdokkaat ennen halvimman nostoa), top (näytetyt), cheapest, seen (jo näytetyt id:t),
 *   onTerm (onko pyydettyä tuotetta), pricey (yli 2 × halvin), more, size (sivun koko).
 * @returns funktio, joka antaa näytetylle vaihtoehdolle { place, codes }, ja sen kentän pool.
 */
export function explainPicks({ found, fit, scored, first, top, cheapest, seen, onTerm, pricey, more, size }) {
  const rows = new Map(scored.map((x, i) => [x.o, { ...x, place: i + 1 }]));
  const best = scored.length ? Math.min(...scored.map((x) => x.group)) : 0;
  const nextPage = seen.size > 0;
  const anyRequested = fit.some(onTerm);
  // Ensimmäinen sivu ennen halvimman nostoa: jos halvin ei ollut näissä, se nostettiin mukaan.
  const firstPage = new Set(first.slice(0, size).map((x) => x.o));
  const pick = (o) => {
    const x = rows.get(o) || {};
    const codes = [];
    if (o.substituteFor) codes.push('SUBSTITUTE');
    if (onTerm(o)) codes.push('REQUESTED');
    else if (!anyRequested) codes.push('NEAREST');
    else if (o.requested === false) codes.push('OTHER_PRODUCT');
    if (nextPage) codes.push('NEXT_PAGE');
    else if (o === cheapest) codes.push('CHEAPEST', ...(firstPage.has(o) ? [] : ['CHEAPEST_ADDED']));
    if (x.group > best) codes.push('OTHER_TYPE');
    else if (x.regular === false) codes.push('SPECIAL');
    if (pricey(o)) codes.push('PRICEY_LAST');
    if (x.oversize) codes.push('OVERSIZE');
    if (x.known === false) codes.push('SIZE_UNKNOWN');
    return { place: x.place ?? null, codes };
  };
  pick.pool = { orderable: found.length, suitable: fit.length, requested: fit.filter(onTerm).length, shown: top.length, more: Boolean(more), nextPage };
  return pick;
}
