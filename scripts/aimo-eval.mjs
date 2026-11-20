// Aimo-mallin tarkkuustesti: ajetaan kiinteä pyyntösetti ja verrataan tulkintaa odotettuun.
// Aja: npm run aimo:eval   (kello on kiinnitetty lauantaihin 14.11.2026, jotta päivät ovat toistettavia)
// Pitchiin: "X/N pyynnöstä tulkittu oikein ilman kielimallia ja ilman käsikorjausta."
import { understand } from '../server/aimo/understand.mjs';
import { resolveItem } from '../server/aimo/resolve.mjs';

const now = new Date('2026-11-14T10:00:00+02:00');
const L = (v) => ({ value: v, unit: 'L' }); const KG = (v) => ({ value: v, unit: 'KG' }); const PCS = (v) => ({ value: v, unit: 'PCS' });
// item: {type|cat, q, claims, brand, fat, fi, ex, has: tuotekoodi jonka pitää olla ehdokkaissa, top: sana jonka pitää olla kärkiehdokkaan nimessä}
const CASES = [
  ['I need 1,000 litres of lactose-free milk by Monday.', { date: '2026-11-16', items: [{ type: 'milk', q: L(1000), claims: ['FREE_FROM_LACTOSE'], has: '464306' }] }],
  ['Tarvitsen 1 000 litraa laktoositonta maitoa maanantaiksi', { date: '2026-11-16', items: [{ type: 'milk', q: L(1000), claims: ['FREE_FROM_LACTOSE'], has: '464306' }] }],
  ['Tarvitsen 1000 litraa laktoositonta maitoa maanantaiksi', { date: '2026-11-16', items: [{ type: 'milk', q: L(1000), claims: ['FREE_FROM_LACTOSE'] }] }],
  ['1.000 l laktoositonta maitoa ma', { items: [{ type: 'milk', q: L(1000), claims: ['FREE_FROM_LACTOSE'] }] }],
  ['100 litraa Arlan rasvatonta laktoositonta maitojuomaa sunnuntaiksi', { date: '2026-11-15', items: [{ type: 'milk', q: L(100), claims: ['FREE_FROM_LACTOSE'], brand: 'Arla', fat: 'fat-free', has: '469386' }] }],
  ['20 kg voita ja 50 l kuohukermaa huomiseksi', { date: '2026-11-15', items: [{ type: 'butter', q: KG(20) }, { type: 'cream', q: L(50), top: 'kuohukerma' }] }],
  ['We need 200 x 1 l organic skimmed milk and 30 kg butter for next Friday', { date: '2026-11-20', items: [{ type: 'milk', q: PCS(200), claims: ['EU_ORGANIC_FARMING'], fat: 'fat-free', top: 'rasvaton' }, { type: 'butter', q: KG(30) }] }],
  ['a hundred litres of whole milk tomorrow', { date: '2026-11-15', items: [{ type: 'milk', q: L(100), fat: 'whole', top: 'täysmaito' }] }],
  ['Onko teillä gluteenitonta pastaa?', { intent: 'search', items: [{ cat: '21380', claims: ['FREE_FROM_GLUTEN'], top: 'gluteeniton' }] }],
  ['50 kg lohifileetä perjantaiksi', { date: '2026-11-20', items: [{ cat: '18701', q: KG(50), top: 'lohifilee' }] }],
  ['10 kg kotimaista broilerin rintafileetä 20.11.', { date: '2026-11-20', items: [{ q: KG(10), fi: 'fi', top: 'rintafilee' }] }],
  ['5 ltk Santa Maria tacokastiketta', { items: [{ q: PCS(5), brand: 'Santa Maria' }] }],
  ['30 l whipping cream by Tuesday', { date: '2026-11-17', items: [{ type: 'cream', q: L(30) }] }],
  ['vegan lactose-free butter 5 kg', { items: [{ type: 'butter', q: KG(5), claims: ['FREE_FROM_LACTOSE', 'VEGAN'] }] }],
  ['500 g vähälaktoosista voita', { items: [{ type: 'butter', q: KG(0.5), claims: ['LOW_LACTOSE'] }] }],
  ['25 kg perunoita, 10 kg sipulia ja 5 kg porkkanaa keskiviikoksi', { date: '2026-11-18', items: [{ q: KG(25), top: 'peruna' }, { q: KG(10), top: 'sipuli' }, { q: KG(5), top: 'porkkana' }] }],
  ['Please order 40 boxes of nut-free cookies', { items: [{ q: PCS(40), ex: ['AN'] }] }],
  ['kaksi tusinaa kananmunia', { items: [{ type: 'eggs', q: { ...PCS(24), basis: 'items' } }] }],
  ['12 kg Valio Oltermanni juustoa 2026-11-19', { date: '2026-11-19', items: [{ q: KG(12), brand: 'Valio', top: 'oltermanni' }] }],
  ['60 l kaurajuomaa ja 15 kg kahvia ylihuomiseksi', { date: '2026-11-16', items: [{ cat: '10402', q: L(60) }, { cat: '22300', q: KG(15) }] }],
  ['luomu kevytmaitoa 40 litraa', { items: [{ type: 'milk', q: L(40), claims: ['EU_ORGANIC_FARMING'], fat: 'semi-skimmed' }] }],
  ['2,5 kg basmatiriisiä', { items: [{ cat: '21340', q: KG(2.5), top: 'basmati' }] }],
  ['3 dozen eggs and 10 kg sugar for Thursday', { date: '2026-11-19', items: [{ type: 'eggs', q: { ...PCS(36), basis: 'items' } }, { cat: '22100', q: KG(10) }] }], // kärjessä saa olla myös nestesokeri (Nordic Sugar Neste): se on sokeria
  // Näissä oikea tulos on "en ymmärtänyt": kerroksen pitää tunnistaa se itse eikä arvata.
  ['2 kg unicorn meat', { lowConfidence: true }],
  ['hmm what about the thing we talked about', { lowConfidence: true }],
  ['Laskussa 4471 on virhe, voitteko korjata', { lowConfidence: true }],
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0; let ms = 0;
understand('lämmitys', { now });
for (const [text, exp] of CASES) {
  const r = understand(text, { now });
  ms += r.ms;
  const errs = [];
  if (exp.lowConfidence) { if (r.confidence >= 0.6) errs.push(`varmuus ${r.confidence}, piti olla < 0.6`); }
  else {
    if (r.confidence < 0.6) errs.push(`varmuus vain ${r.confidence} (${r.unparsed.join(', ')})`);
    if (exp.date && r.deliveryDate !== exp.date) errs.push(`päivä ${r.deliveryDate} ≠ ${exp.date}`);
    if (exp.intent && r.intent !== exp.intent) errs.push(`aikomus ${r.intent} ≠ ${exp.intent}`);
    if (r.items.length !== exp.items.length) errs.push(`rivejä ${r.items.length} ≠ ${exp.items.length}`);
    exp.items.forEach((e, i) => {
      const it = r.items[i]; if (!it) return;
      if (e.type && it.productType !== e.type) errs.push(`[${i}] tyyppi ${it.productType} ≠ ${e.type}`);
      if (e.cat && it.category !== e.cat && !it.categories?.includes(e.cat)) errs.push(`[${i}] ryhmä ${it.category} ≠ ${e.cat}`);
      if (e.q && !same(it.quantity, e.q)) errs.push(`[${i}] määrä ${JSON.stringify(it.quantity)} ≠ ${JSON.stringify(e.q)}`);
      if (!same([...it.claims].sort(), [...(e.claims || [])].sort())) errs.push(`[${i}] väittämät ${it.claims} ≠ ${e.claims || []}`);
      if ((e.brand || null) !== (it.brand?.trim() || null)) errs.push(`[${i}] merkki ${it.brand} ≠ ${e.brand || null}`);
      if (e.fat && it.attributes.fat !== e.fat) errs.push(`[${i}] rasva ${it.attributes.fat} ≠ ${e.fat}`);
      if (e.fi && it.countryOfOrigin !== e.fi) errs.push(`[${i}] alkuperä ${it.countryOfOrigin}`);
      if (e.ex && !same(it.excludeAllergens, e.ex)) errs.push(`[${i}] allergeenit ${it.excludeAllergens}`);
      const res = resolveItem(it);
      if (!res.candidates.length) errs.push(`[${i}] ei ehdokkaita`);
      if (e.has && !res.candidates.some((c) => c.id === e.has)) errs.push(`[${i}] tuote ${e.has} ei ehdokkaissa`);
      if (e.top && !res.candidates.slice(0, 5).every((c) => c.name.toLowerCase().includes(e.top))) errs.push(`[${i}] kärjessä muuta kuin "${e.top}": ${res.candidates.slice(0, 5).map((c) => c.name).find((n) => !n.toLowerCase().includes(e.top))}`);
    });
  }
  if (!errs.length) pass += 1;
  console.log(`${errs.length ? 'VIRHE' : 'ok   '} ${text}${errs.length ? `\n        ${errs.join('\n        ')}` : ''}`);
}
console.log(`\n${pass}/${CASES.length} oikein, 0 mallikutsua, keskimäärin ${(ms / CASES.length).toFixed(2)} ms / pyyntö`);
process.exit(pass === CASES.length ? 0 : 1);
