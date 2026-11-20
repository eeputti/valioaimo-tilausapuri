// Agentin jäljen osio "Vaihtoehdot, joista valittiin": näytetyt tuotteet ja syy, miksi juuri ne näytettiin.
// Syy tulee tilauksen omasta datasta. Uusissa tilauksissa tilausmoottori tallentaa sen (server/order-tools/why.mjs:
// pick ja pool), vanhoissa lasketaan vain näytettyjen vaihtoehtojen omista luvuista (kattavuus ja hinta). Ei arvailua.
// Kaikki teksti textContentilla.
import { nf, money, day, quantity, UNIT, el, cap } from './agent-code.js';

// Järjestys, jolla tilausmoottori asettaa vaihtoehdot (server/order-tools/index.mjs: scoreOptions ja suggest).
export const RULE = [
  ['Pyydetty tuote', 'ennen valmisteita ja muita tuotteita'],
  ['Tavallinen', 'ennen maustettua tai erikoista'],
  ['Sopiva pakkaus', 'ennen ylisuurta tai kymmeniä pikkupakkauksia'],
  ['Halvin ensin', 'halvin tarpeen kattava on aina mukana'],
];
const CODE = {
  NEAREST: ['Lähin vaihtoehto: pyydettyä ei tilattavissa', 'warn'],
  OTHER_PRODUCT: ['Ei pyydettyä tuotetta', 'warn'],
  CHEAPEST_ADDED: ['Nostettu mukaan halvimpana', 'good'],
  OTHER_TYPE: ['Valmiste tai muu tuote', 'warn'],
  SPECIAL: ['Maustettu tai erikoinen', 'warn'],
  PRICEY_LAST: ['Yli 2 × halvimman hinta', 'warn'],
  OVERSIZE: ['Pakkaus moninkertainen tarpeeseen', 'warn'],
  NEXT_PAGE: ['Näytä lisää -sivulta', 'blue'],
  SUBSTITUTE: ['Korvaava tuote', 'warn'],
  SIMILAR_KNOWN: ['Vastaava tuote, saatavuus tunnetaan', 'warn'],
};
const UNIT_AS = { L: 'litroina', KG: 'kiloina', PCS: 'kappaleina' };
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Kattaako vaihtoehto tarpeen samassa yksikössä: tasan, yli vai ei tiedossa.
function coverage(covers, need) {
  if (!need || !Number.isFinite(need.value)) return null;
  if (!covers || !Number.isFinite(covers.value) || covers.unit !== need.unit) {
    return ['L', 'KG'].includes(need.unit) ? [`Määrää ei tiedetä ${UNIT_AS[need.unit]}`, 'warn'] : null;
  }
  const diff = covers.value - need.value;
  if (near(diff, 0)) return [`Tasan ${quantity(need)}`, 'blue'];
  const unit = UNIT[need.unit] || need.unit.toLowerCase();
  if (diff > 0) return [`+${nf(diff, 2)} ${unit} yli tarpeen`, diff / need.value > 0.1 ? 'warn' : 'blue'];
  return [`${nf(-diff, 2)} ${unit} alle tarpeen`, 'warn'];
}

/**
 * Syyt yhdelle tuoteriville ilman DOMia (testattava Nodessa).
 * @returns {{ funnel: Array<[number, string]>, sentences: string[], cards: Array<{ reasons: Array<[string, string]> }> }}
 */
export function explainGroup(group, line, deliveryDate) {
  const shown = group.shown || [];
  const need = line?.quantity || null;
  const pool = group.pool || null;
  const hasPick = shown.some((o) => o.pick);
  const codes = (o) => o.pick?.codes || [];
  const priced = shown.filter((o) => Number.isFinite(o.lineNet));
  const min = priced.length ? Math.min(...priced.map((o) => o.lineNet)) : null;
  const firstMin = priced.find((o) => near(o.lineNet, min));
  // Osa näytetyistä ei ole pyydettyä tuotetta: silloin pyydetyt merkitään erikseen.
  const mixed = hasPick && shown.some((o) => codes(o).includes('OTHER_PRODUCT')) && shown.some((o) => codes(o).includes('REQUESTED'));

  const cards = shown.map((o, i) => {
    const reasons = [];
    const fit = coverage(o.covers, need);
    if (fit) reasons.push(fit);
    if (min !== null && Number.isFinite(o.lineNet)) {
      if (codes(o).includes('CHEAPEST')) reasons.push(['Halvin tarpeen kattava', 'good']);
      else if (o === firstMin) reasons.push(['Halvin näytetyistä', 'good']);
      else if (near(o.lineNet, min)) reasons.push(['Sama hinta kuin halvin', 'good']);
      else reasons.push([`+${money(o.lineNet - min)} halvimpaan`, '']);
    }
    if (mixed && codes(o).includes('REQUESTED')) reasons.push(['Pyydettyä tuotetta', 'good']);
    for (const c of codes(o)) if (CODE[c]) reasons.push(CODE[c]);
    // Tilausmoottorin oma lause (esim. "Korvaa tuotteen X") sellaisenaan.
    if (o.why) reasons.push([o.why, 'ghost']);
    // Kattavuus kertoi jo, ettei määrää tiedetä: sama asia vain kerran.
    if (codes(o).includes('SIZE_UNKNOWN') && !reasons.some(([t]) => t.startsWith('Määrää ei tiedetä'))) reasons.push(['Määrää ei tiedetä pyydetyssä yksikössä', 'warn']);
    if (o.pick?.place && o.pick.place !== i + 1) reasons.push([`Sija ${nf(o.pick.place)}${pool?.suitable ? `/${nf(pool.suitable)}` : ''} järjestyksessä`, 'ghost']);
    return { reasons };
  });

  const funnel = [];
  if (pool && Number.isFinite(pool.orderable)) {
    funnel.push([pool.orderable, `tilattavissa ${day(deliveryDate)}`]);
    if (Number.isFinite(pool.suitable) && pool.suitable < pool.orderable) funnel.push([pool.suitable, 'sopi ruokavalioon ja ehtoihin']);
    if (Number.isFinite(pool.requested) && pool.requested > 0 && pool.requested < (pool.suitable ?? pool.orderable)) funnel.push([pool.requested, 'pyydettyä tuotetta']);
    funnel.push([shown.length, 'näytetty']);
  }

  const sentences = [];
  if (shown.length) {
    const all = (f) => shown.every(f);
    const ascending = priced.length === shown.length && shown.every((o, i) => !i || o.lineNet >= shown[i - 1].lineNet - 1e-6);
    const covered = need && all((o) => o.covers?.unit === need.unit && o.covers.value >= need.value - 1e-6);
    const requested = hasPick && all((o) => codes(o).includes('REQUESTED'));
    const n = shown.length === 1 ? 'Vaihtoehto' : `Kaikki ${nf(shown.length)}`;
    if (hasPick && all((o) => codes(o).includes('SIMILAR_KNOWN'))) sentences.push('Pyydetyn tuotteen saatavuutta ei saatu tarkistettua, joten nämä ovat vastaavia tuotteita, joiden saatavuus tunnetaan. Kokki valitsee itse.');
    if (hasPick && all((o) => codes(o).includes('NEAREST'))) sentences.push(`Pyydettyä tuotetta ei ollut tilattavissa ${day(deliveryDate)}, joten nämä ovat lähimmät tilattavat.`);
    if (covered && ascending) sentences.push(requested ? `${n} ovat pyydettyä tuotetta ja kattavat ${quantity(need)}, joten järjestyksen ratkaisi hinta: halvin ensin.`
      : `${n} kattavat ${quantity(need)} ja ovat halvimmasta kalleimpaan.`);
    else if (!ascending && priced.length === shown.length) sentences.push('Järjestys ei ole pelkkä hintajärjestys: tuotetyyppi, maku ja pakkauskoko ratkaisevat ennen hintaa.');
    if (pool?.nextPage) sentences.push('Nämä tulivat, kun kokki pyysi lisää vaihtoehtoja.');
    else if (pool && pool.more && Number.isFinite(pool.suitable)) sentences.push(`Loput ${nf(Math.max(0, pool.suitable - shown.length))} sopivaa olisi saanut vastaamalla 4, Näytä lisää.`);
    else if (pool && !pool.more) sentences.push('Muita sopivia ei ollut tälle päivälle.');
    const chosen = shown.findIndex((o) => o.selected);
    if (chosen >= 0 && min !== null && Number.isFinite(shown[chosen].lineNet)) {
      const extra = shown[chosen].lineNet - min;
      sentences.push(near(extra, 0) ? `Kokki valitsi vaihtoehdon ${chosen + 1}, halvimman.` : `Kokki valitsi vaihtoehdon ${chosen + 1}, ${money(extra)} halvinta kalliimman.`);
    }
  }
  return { funnel, sentences, cards };
}

/** Koko osio: järjestyssääntö ja jokainen tuoterivi syineen. helpers = agentti.js:n icon, chip ja label. */
export function renderOptions(trace, { icon, chip, label }) {
  const rule = el('div', 'why-rule');
  const steps = el('ol', 'why-steps');
  RULE.forEach(([title, text], i) => {
    const li = el('li');
    li.append(el('span', 'why-step-num', String(i + 1)), el('strong', '', title), el('small', '', text));
    steps.append(li);
  });
  rule.append(el('p', 'why-rule-title', 'Miten vaihtoehdot valitaan'), steps,
    el('p', 'why-rule-note', 'Mukana vain tuotteet, jotka ehtivät toimituspäiväksi ja sopivat ruokavalioon. WhatsAppissa näytetään kolme ensimmäistä, ja 4 hakee seuraavat.'));

  const groups = trace.options.map((group) => {
    const wrap = el('div', 'option-group');
    const head = el('div', 'option-head');
    const line = trace.understood.lines.find((l) => l.ref === group.ref);
    head.append(el('h3', '', `${cap(group.term)} ${line ? quantity(line.quantity) : ''}`.trim()),
      el('span', 'muted', `${nf(group.shown.length)} näytetty${group.seen && group.seen > group.shown.length ? `, ${nf(group.seen)} käyty läpi` : ''}`));
    const why = explainGroup(group, line, trace.understood.deliveryDate);
    wrap.append(head);
    if (why.funnel.length) {
      const funnel = el('ol', 'why-funnel');
      funnel.setAttribute('aria-label', 'Hausta näytetyiksi');
      why.funnel.forEach(([count, text], i) => {
        const li = el('li', i === why.funnel.length - 1 ? 'last' : '');
        li.append(el('strong', '', nf(count)), el('span', '', text));
        funnel.append(li);
      });
      wrap.append(funnel);
    }
    if (why.sentences.length) wrap.append(el('p', 'why-summary', why.sentences.join(' ')));

    const grid = el('div', 'option-grid');
    if (!group.shown.length) grid.append(el('p', 'muted', 'Vaihtoehtoja ei näytetty: tuote tuli suoraan aiemmasta valinnasta.'));
    group.shown.forEach((o, i) => {
      const card = el('div', `option ${o.selected ? 'selected' : ''}`.trim());
      const top = el('div', 'option-top');
      top.append(el('span', 'option-num', String(i + 1)), o.selected ? chip('Valittu', 'good solid') : el('span'));
      const name = el('p', 'option-name', o.name);
      const pack = el('p', 'option-pack', `${nf(o.salesUnits || 0)} ${o.salesUnitLabel || ''}${o.covers ? ` (${quantity(o.covers)})` : ''}`);
      const price = el('p', 'option-price'); price.append(el('strong', '', money(o.lineNet)), el('small', '', o.unitPriceNet != null ? `${money(o.unitPriceNet)} / ${o.salesUnitLabel || 'kpl'}` : ''));
      const reasons = el('div', 'why-chips');
      reasons.setAttribute('aria-label', 'Miksi tämä näytettiin');
      why.cards[i].reasons.forEach(([text, tone]) => reasons.append(chip(text, tone)));
      const facts = el('div', 'facts');
      if (o.co2PerKg != null) { const f = el('span', 'fact'); f.append(icon('leaf'), document.createTextNode(`${nf(o.co2PerKg, 2)} kg CO₂e/kg`)); facts.append(f); }
      if (o.deliveryReliability != null) { const f = el('span', 'fact'); f.append(icon('truck'), document.createTextNode(`${nf(o.deliveryReliability * 100)} % toimitusvarmuus`)); facts.append(f); }
      const labels = el('div', 'tags');
      [...new Set(o.labels.map(label).filter(Boolean))].slice(0, 3).forEach((l) => labels.append(chip(l)));
      card.append(top, name, pack, price, reasons, facts, labels);
      if (o.warning) card.append(el('p', 'warning', o.warning));
      grid.append(card);
    });
    wrap.append(grid);
    return wrap;
  });
  return [rule, ...groups];
}
