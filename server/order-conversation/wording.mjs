// Tuoterivit selkokielellä WhatsAppin tilausluonnokseen ja vaihtoehtoihin (Eelis 17.11.: "haluun et tä botti on fiksu").
// Vain esitystapa: nimi, määrät, hinnat ja vertailuhinta tulevat Valion datasta ja tarjouksesta sellaisinaan. Mitään ei
// arvata: tuntematon pakkauskoko jätetään sanomatta, ja pyydetty määrä näytetään vain, kun se on samassa yksikössä.

// Myyntierän sana lukumäärän kanssa ("1 laatikko", "3 laatikkoa"). Avaimet ovat catalog.mjs:n UNIT_LABEL-arvoja.
export const PACK = { ras: ['rasia', 'rasiaa'], ltk: ['laatikko', 'laatikkoa'], pkt: ['paketti', 'pakettia'], pss: ['pussi', 'pussia'], prk: ['purkki', 'purkkia'],
  pl: ['pullo', 'pulloa'], krt: ['kartonki', 'kartonkia'], kan: ['kanisteri', 'kanisteria'], sk: ['säkki', 'säkkiä'], kää: ['kääre', 'käärettä'],
  lava: ['lava', 'lavaa'], nippu: ['nippu', 'nippua'], kpl: ['kpl', 'kpl'] };
export const packWord = (n, label) => { const w = PACK[label]; return w ? (Number(n) === 1 ? w[0] : w[1]) : label; };

const UNIT = { L: 'l', KG: 'kg', PCS: 'kpl' };
const num = (n) => String(+Number(n).toFixed(3)).replace('.', ',');
const eur = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
const VOWEL = /[aeiouyåäö]/i;
// Lyhenteet, jotka pysyvät isoina (vokaalittomat kuten PP, RST ja B&J pysyvät joka tapauksessa).
const KEEP_UPPER = new Set(['UHT', 'ESL', 'MSC', 'ASC', 'EU', 'GMO', 'BBQ', 'XL', 'XXL']);
const SIZE = /^(\d+(?:[,.]\d+)?)(KG|G|L|DL|CL|ML|MM|CM)$/;

/**
 * Isoin kirjaimin kirjoitettu tukkunimi luettavaksi: "PP PERUNA 1KG ANNABELLE" → "PP peruna 1 kg annabelle".
 * Nimi, jossa on jo pieniä kirjaimia, on toimittajan oma esitys ja jää ennalleen.
 */
export function readableName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text || /[a-zåäö]/.test(text) || !/[A-ZÅÄÖ]/.test(text)) return text;
  const words = text.split(' ').map((word) => {
    const size = SIZE.exec(word);
    if (size) return `${size[1]} ${size[2].toLowerCase()}`;
    // Pelkät vokaalittomat kirjaimet (PP, RST, B&J) ovat lyhenteitä; numeroita sisältävä sana pienennetään.
    if (KEEP_UPPER.has(word) || (/^[A-ZÅÄÖ&+]{1,4}$/.test(word) && !VOWEL.test(word))) return word;
    return word.toLocaleLowerCase('fi-FI');
  });
  const out = words.join(' ');
  return out.charAt(0).toLocaleUpperCase('fi-FI') + out.slice(1);
}

/**
 * Määrä ostajan ymmärtämänä: montako myyntierää, mitä yksi on ja paljonko yhteensä.
 *   2 kpl, yhteensä 2 kg          (nimi kertoo jo pakkauksen koon)
 *   3 säkkiä à 2 kg, yhteensä 6 kg (pyysit 5 kg)
 *   5 rasiaa à 10 munaa, yhteensä 50 munaa
 *   12 kg                          (myydään kiloittain)
 * @param {{salesUnits: number, salesUnitLabel?: string, covers?: {value: number, unit: 'L'|'KG'|'PCS'}|null, name?: string}} line
 * @param {{requested?: {value: number, unit: string, basis?: string}, itemNoun?: string}} [o] itemNoun: kappaleiden sana (esim. "munaa")
 */
export function amountPhrase(line, { requested, itemNoun } = {}) {
  const n = Number(line.salesUnits);
  const label = String(line.salesUnitLabel || 'kpl');
  const covers = line.covers && Number.isFinite(line.covers.value) && line.covers.value > 0 ? line.covers : null;
  const count = `${num(n)} ${packWord(n, label)}`;
  if (!covers || !Number.isFinite(n) || n <= 0) return count;
  const unitWord = covers.unit === 'PCS' ? itemNoun || 'kpl' : UNIT[covers.unit];
  // Kiloittain tai litroittain myytävä: myyntierä on jo ostajan yksikkö.
  if ((label === 'kg' && covers.unit === 'KG') || (covers.unit === 'PCS' && !itemNoun && Math.abs(covers.value - n) < 1e-9)) return count;
  const total = `${num(covers.value)} ${unitWord}`;
  const each = covers.value / n;
  const eachText = `${num(each)} ${unitWord}`;
  // Nimessä jo näkyvää kokoa ("1 kg") ei toisteta.
  const named = new RegExp(`(^|\\s)${num(each).replace(',', '[,.]')}\\s?${unitWord}(\\s|$)`, 'i').test(readableName(line.name || ''));
  const per = Number.isFinite(each) && !named ? ` à ${eachText}` : '';
  const asked = requested && requested.unit === covers.unit && Number.isFinite(requested.value) && covers.value > requested.value + 1e-9
    && !(covers.unit === 'PCS' && requested.basis === 'sales') ? ` (pyysit ${num(requested.value)} ${unitWord})` : '';
  return `${count}${per}, yhteensä ${total}${asked}`;
}

/**
 * Rivin hinta ja Valion vertailuhinta, kun se on samassa yksikössä kuin tilattu määrä: "1,52 € (0,76 €/kg)".
 * Litroina tilatulle maidolle ei näytetä kilohintaa.
 */
export function pricePhrase(line) {
  const code = String(line.comparisonUnit || '').toUpperCase();
  const unit = { KG: 'kg', L: 'l' }[code];
  const compare = Number(line.comparisonPrice);
  const same = !line.covers?.unit || line.covers.unit === code;
  return `${eur(line.lineNet)}${unit && same && Number.isFinite(compare) && compare > 0 && Number(line.salesUnits) > 0 ? ` (${eur(compare)}/${unit})` : ''}`;
}

/** Tilausluonnoksen rivi: "PP peruna 1 kg annabelle: 2 kpl, yhteensä 2 kg, 1,52 € (0,76 €/kg)". */
// Korvaajan lyhyt tuotesana riville, muutosvihjeeseen ja poistoon (WhatsApp 18.11.: lanttulaatikon tilalle valittiin
// Saarioinen Maksalaatikko, mutta vihje sanoi "poista lanttulaatikko"). Merkki, koot ja ruokavaliosanat pois:
// "Saarioinen Maksalaatikko laktoositon 2,7kg" → "maksalaatikko", "Kotimaisia viiriäisen munia 10kpl" → "viiriäisen munia".
const DIET_WORD = /^(?:laktoositon|gluteeniton|maidoton|vegaaninen|luomu|uht|pakaste)$/iu;
const nameWords = (text) => String(text || '').split(/[\s,()/]+/u).filter((w) => /^\p{L}[\p{L}-]{2,}$/u.test(w) && !DIET_WORD.test(w));
export function substituteTerm(option) {
  const name = readableName(option?.name);
  const brand = String(option?.brand || '').trim();
  const rest = brand && name.toLocaleLowerCase('fi-FI').startsWith(`${brand.toLocaleLowerCase('fi-FI')} `) ? name.slice(brand.length + 1) : name;
  // Merkki voi olla koko nimi ilman kokoa ("Kieku Loimaan Luomukananmuna"): silloin nimen viimeinen sana.
  const words = nameWords(rest).length ? nameWords(rest).slice(0, 2) : nameWords(name).slice(-1);
  return (words.join(' ') || name).toLocaleLowerCase('fi-FI').slice(0, 80);
}

export const summaryRow = (line, o = {}) => `${readableName(line.name)}: ${amountPhrase(line, o)}, ${pricePhrase(line)}`;
/** Vaihtoehdon rivi: "PP peruna 1 kg annabelle, 2 kpl, yhteensä 2 kg, 1,52 €". */
export const optionRow = (option, o = {}) => `${readableName(option.name)}, ${amountPhrase(option, o)}, ${eur(option.lineNet)}`;
