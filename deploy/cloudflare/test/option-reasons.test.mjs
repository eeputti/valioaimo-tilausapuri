// Agentin jäljen osio 2: miksi juuri nämä vaihtoehdot näytettiin. Selaimen selitys (agent-options.js) ja julkaisijan
// kentät (trace-reader.mjs) ilman DOMia ja ilman kantoja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainGroup } from '../public/agent-options.js';
import { option, pool } from '../trace-reader.mjs';
import { parseAgentTrace } from '../src/agent-trace.ts';

const kg2 = { value: 2, unit: 'KG' };
const potato = (productId, name, salesUnits, lineNet, extra = {}) => ({ productId, name, salesUnits, salesUnitLabel: 'kpl', covers: { value: 2, unit: 'KG' }, unitPriceNet: lineNet / salesUnits,
  lineNet, labels: [], co2PerKg: 0.21, deliveryReliability: null, warning: null, pick: null, selected: false, ...extra });
const texts = (card) => card.reasons.map(([text]) => text);

test('vanha jälki ilman tallennettua syytä: kattavuus, hinta ja kokin valinta näytettyjen omista luvuista', () => {
  // Eeliksen kuvakaappauksen rivi: kaksi 2 kg:n pussia samaan hintaan ja 2 × 1 kg kalliimpana; kokki valitsi kolmannen.
  const group = { ref: 'L1', term: 'peruna', seen: null, shown: [
    potato('1', 'PP KIINTEÄ PERUNA 2KG PUSSI PESTY', 1, 1.33),
    potato('2', 'PP JAUHOINEN PERUNA 2KG PUSSI PESTY', 1, 1.33),
    potato('3', 'PP PERUNA 1KG ANNABELLE', 2, 1.52, { selected: true }),
  ] };
  const why = explainGroup(group, { quantity: kg2 }, '2026-11-16');
  assert.deepEqual(why.funnel, [], 'hakumääriä ei ole tallessa, joten niitä ei keksitä');
  assert.deepEqual(why.cards.map(texts), [
    ['Tasan 2 kg', 'Halvin näytetyistä'],
    ['Tasan 2 kg', 'Sama hinta kuin halvin'],
    ['Tasan 2 kg', `+${new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(0.19)} halvimpaan`],
  ]);
  assert.match(why.sentences.join(' '), /Kaikki 3 kattavat 2 kg ja ovat halvimmasta kalleimpaan\./);
  assert.match(why.sentences.join(' '), /Kokki valitsi vaihtoehdon 3, 0,19\s€ halvinta kalliimman\./);
});

test('uusi jälki: hakusuppilo, syykoodit, sija ja Näytä lisää -vihje', () => {
  const pick = (place, codes) => ({ place, codes });
  const group = { ref: 'L1', term: 'peruna', seen: null, pool: { orderable: 54, suitable: 50, requested: 15, shown: 3, more: true, nextPage: false }, shown: [
    potato('1', 'PUIKULA', 1, 2.26, { pick: pick(1, ['REQUESTED']) }),
    potato('2', 'ROSAMUNDA', 1, 2.42, { pick: pick(2, ['REQUESTED']), selected: true }),
    potato('3', 'SÄKKI', 1, 2.0, { covers: { value: 25, unit: 'KG' }, pick: pick(7, ['REQUESTED', 'CHEAPEST', 'CHEAPEST_ADDED', 'OVERSIZE']) }),
  ] };
  const why = explainGroup(group, { quantity: kg2 }, '2026-11-16');
  assert.deepEqual(why.funnel.map(([n]) => n), [54, 50, 15, 3]);
  assert.deepEqual(why.cards.map(texts), [
    ['Tasan 2 kg', '+0,26 € halvimpaan'],
    ['Tasan 2 kg', '+0,42 € halvimpaan'],
    ['+23 kg yli tarpeen', 'Halvin tarpeen kattava', 'Nostettu mukaan halvimpana', 'Pakkaus moninkertainen tarpeeseen', 'Sija 7/50 järjestyksessä'],
  ].map((row) => row.map((t) => t.replace(' €', '\u00a0€'))));
  const text = why.sentences.join(' ');
  assert.match(text, /Järjestys ei ole pelkkä hintajärjestys/);
  assert.match(text, /Loput 47 sopivaa olisi saanut vastaamalla 4, Näytä lisää\./);
  assert.match(text, /Kokki valitsi vaihtoehdon 2/);
});

test('kaikki pyydettyä tuotetta ja hintajärjestyksessä: syy sanotaan suoraan; lähimmät kerrotaan lähimpinä', () => {
  const pick = (codes) => ({ place: 1, codes });
  const ordered = explainGroup({ ref: 'L1', term: 'maito', pool: { orderable: 53, suitable: 53, requested: 53, shown: 2, more: false, nextPage: false }, shown: [
    { ...potato('1', 'A', 20, 110.6), covers: { value: 20, unit: 'L' }, pick: pick(['REQUESTED', 'CHEAPEST']) },
    { ...potato('2', 'B', 20, 169.8), covers: { value: 20, unit: 'L' }, pick: pick(['REQUESTED']) },
  ] }, { quantity: { value: 20, unit: 'L' } }, '2026-11-16');
  assert.match(ordered.sentences[0], /Kaikki 2 ovat pyydettyä tuotetta ja kattavat 20 l, joten järjestyksen ratkaisi hinta: halvin ensin\./);
  assert.ok(ordered.sentences.includes('Muita sopivia ei ollut tälle päivälle.'));
  assert.deepEqual(ordered.funnel.map(([n]) => n), [53, 2], 'samat luvut näytetään vain kerran');
  const nearest = explainGroup({ ref: 'L1', term: 'strutsinmuna', shown: [{ ...potato('1', 'Viiriäisen munat', 1, 3), covers: null, pick: pick(['NEAREST', 'CHEAPEST']) }] },
    { quantity: { value: 2, unit: 'PCS' } }, '2026-11-16');
  assert.match(nearest.sentences[0], /^Pyydettyä tuotetta ei ollut tilattavissa ma 16\.11\./);
  assert.ok(texts(nearest.cards[0]).includes('Lähin vaihtoehto: pyydettyä ei tilattavissa'));
  const similar = explainGroup({ ref: 'L1', term: 'jäätelö', shown: [{ ...potato('1', 'Vaniljajäätelö', 1, 9), covers: { value: 2, unit: 'L' }, why: 'Sama käyttö: jälkiruoka', pick: { place: 1, codes: ['SIMILAR_KNOWN'] } }] },
    { quantity: { value: 2, unit: 'L' } }, '2026-11-16');
  assert.match(similar.sentences[0], /saatavuutta ei saatu tarkistettua/);
  assert.ok(texts(similar.cards[0]).includes('Vastaava tuote, saatavuus tunnetaan'));
  assert.ok(texts(similar.cards[0]).includes('Sama käyttö: jälkiruoka'));
});

test('julkaisija kopioi vain sallitut syykentät, ja Worker hyväksyy ne', () => {
  const o = option({ productId: '1', name: 'Peruna', salesUnits: 1, lineNet: 2, labels: [], pick: { place: 3, codes: ['REQUESTED', 'CHEAPEST', 'bad code', 'X'.repeat(60)], secret: 'x' } }, '1');
  assert.deepEqual(o.pick, { place: 3, codes: ['REQUESTED', 'CHEAPEST'] });
  assert.equal(option({ productId: '2', name: 'Vanha', labels: [] }, null).pick, null);
  assert.deepEqual(pool({ orderable: 9, suitable: 8, requested: 7, shown: 3, more: true, nextPage: false, phone: '358401234567' }),
    { orderable: 9, suitable: 8, requested: 7, shown: 3, more: true, nextPage: false });
  assert.equal(pool(undefined), null);
  const now = Date.now();
  const trace = { version: 1, orderId: 'AGW-20261117-0001', observedAt: now, order: {}, understood: { lines: [] }, quotes: {}, ledger: { events: [] },
    turns: [{ at: '2026-11-17T10:00:00.000Z', source: 'whatsapp', customer: 'peruna 2 kg', action: null, replies: ['Valitse'], status: null, revision: 1 }],
    options: [{ ref: 'L1', term: 'peruna', seen: null, pool: pool({ orderable: 9, suitable: 8, requested: 7, shown: 1, more: true }), shown: [o] }] };
  assert.deepEqual(parseAgentTrace(trace, now).options[0].shown[0].pick, { place: 3, codes: ['REQUESTED', 'CHEAPEST'] });
});
