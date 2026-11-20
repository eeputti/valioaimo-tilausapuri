// Tilausluonnoksen ja vaihtoehtojen rivit selkokielellä (server/order-conversation/wording.mjs). Ei mallikutsuja.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readableName, amountPhrase, pricePhrase, summaryRow, optionRow } from '../server/order-conversation/wording.mjs';

test('isoin kirjaimin kirjoitettu tukkunimi muuttuu luettavaksi, toimittajan oma kirjoitusasu säilyy', () => {
  assert.equal(readableName('PP PERUNA 1KG ANNABELLE'), 'PP peruna 1 kg annabelle');
  assert.equal(readableName('PERUNA PESTY 1KG'), 'Peruna pesty 1 kg');
  assert.equal(readableName('GREENS 2,5KG SUIKALEJUURES'), 'Greens 2,5 kg suikalejuures');
  assert.equal(readableName('KORKEA RST KATTILA 10,5L/24CM'), 'Korkea RST kattila 10,5l/24cm');
  assert.equal(readableName('VALIO KEVYTMAITO 1L UHT'), 'Valio kevytmaito 1 l UHT');
  assert.equal(readableName('B&J 470ML CHOCO CARAMEL COOKIEDOUGH'), 'B&J 470 ml choco caramel cookiedough');
  assert.equal(readableName('VOI 500G'), 'Voi 500 g', 'lyhyt suomen sana ei jää isoksi');
  for (const name of ['Valio kevytmaito 1 l laktoositon UHT', 'Forssan Perunasalaatti 400g', '75x JEPO Kypsä Suikaleperuna 6mm 6kg']) assert.equal(readableName(name), name);
  assert.equal(readableName('  '), '');
});

test('määrä kertoo myyntierät, yhden koon ja kokonaismäärän, ja pyöristyksen ylöspäin', () => {
  // Kuvakaappauksen rivi: ennen "2 kpl (2 kg)".
  assert.equal(amountPhrase({ name: 'PP PERUNA 1KG ANNABELLE', salesUnits: 2, salesUnitLabel: 'kpl', covers: { value: 2, unit: 'KG' } }), '2 kpl, yhteensä 2 kg');
  assert.equal(amountPhrase({ name: 'Peruna 2kg säkki', salesUnits: 3, salesUnitLabel: 'sk', covers: { value: 6, unit: 'KG' } }, { requested: { value: 5, unit: 'KG' } }),
    '3 säkkiä, yhteensä 6 kg (pyysit 5 kg)', 'nimessä jo näkyvä koko ei toistu');
  assert.equal(amountPhrase({ name: 'Peruna', salesUnits: 3, salesUnitLabel: 'sk', covers: { value: 6, unit: 'KG' } }, { requested: { value: 6, unit: 'KG' } }), '3 säkkiä à 2 kg, yhteensä 6 kg');
  assert.equal(amountPhrase({ name: 'Maito', salesUnits: 1, salesUnitLabel: 'ltk', covers: { value: 12, unit: 'L' } }), '1 laatikko à 12 l, yhteensä 12 l');
  assert.equal(amountPhrase({ name: 'Kananmunat M10', salesUnits: 5, salesUnitLabel: 'ras', covers: { value: 50, unit: 'PCS' } }, { itemNoun: 'munaa', requested: { value: 48, unit: 'PCS', basis: 'items' } }),
    '5 rasiaa à 10 munaa, yhteensä 50 munaa (pyysit 48 munaa)');
  assert.equal(amountPhrase({ name: 'PP PUIKULA PERUNA PESTY', salesUnits: 12, salesUnitLabel: 'kg', covers: { value: 12, unit: 'KG' } }), '12 kg', 'kiloittain myytävä');
  assert.equal(amountPhrase({ name: 'Mehu', salesUnits: 3, salesUnitLabel: 'ltk', covers: { value: 3, unit: 'PCS' } }, { requested: { value: 3, unit: 'PCS', basis: 'sales' } }), '3 laatikkoa');
  assert.equal(amountPhrase({ name: 'Tuntematon', salesUnits: 2, salesUnitLabel: 'xx', covers: null }), '2 xx', 'tuntematonta kokoa ei arvata');
});

test('hinta saa Valion vertailuhinnan kilolle tai litralle, ei muuta', () => {
  assert.equal(pricePhrase({ lineNet: 1.52, comparisonPrice: 0.76, comparisonUnit: 'KG', salesUnits: 2 }), '1,52 € (0,76 €/kg)');
  assert.equal(pricePhrase({ lineNet: 3.5, comparisonPrice: 1.75, comparisonUnit: 'L', salesUnits: 2 }), '3,50 € (1,75 €/l)');
  assert.equal(pricePhrase({ lineNet: 3.5, comparisonPrice: 1.75, comparisonUnit: 'KPL', salesUnits: 2 }), '3,50 €');
  assert.equal(pricePhrase({ lineNet: 3.5, comparisonPrice: null, comparisonUnit: null, salesUnits: 2 }), '3,50 €');
  assert.equal(pricePhrase({ lineNet: 26.79, comparisonPrice: 8.93, comparisonUnit: 'KG', salesUnits: 6, covers: { value: 30, unit: 'L' } }), '26,79 €', 'litroina tilatulle ei kilohintaa');
  assert.equal(pricePhrase({ lineNet: 1.52, comparisonPrice: 0.76, comparisonUnit: 'KG', salesUnits: 2, covers: { value: 2, unit: 'KG' } }), '1,52 € (0,76 €/kg)');
});

test('kokonainen luonnoksen rivi ja vaihtoehdon rivi', () => {
  const potato = { name: 'PP PERUNA 1KG ANNABELLE', salesUnits: 2, salesUnitLabel: 'kpl', covers: { value: 2, unit: 'KG' }, lineNet: 1.52, comparisonPrice: 0.76, comparisonUnit: 'KG' };
  assert.equal(summaryRow(potato, { requested: { value: 2, unit: 'KG' } }), 'PP peruna 1 kg annabelle: 2 kpl, yhteensä 2 kg, 1,52 € (0,76 €/kg)');
  assert.equal(optionRow(potato), 'PP peruna 1 kg annabelle, 2 kpl, yhteensä 2 kg, 1,52 €');
});

test('oikean katalogin isoin kirjaimin kirjoitetut ruokanimet pysyvät tunnistettavina', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) }, () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const caps = catalog.filter((p) => p.name === p.name.toUpperCase() && /[A-ZÅÄÖ]/.test(p.name));
  assert.ok(caps.length > 1000);
  for (const p of caps) {
    const out = readableName(p.name);
    // Sama sisältö: vain kirjainkoko ja koon välilyönti muuttuvat.
    assert.equal(out.toLocaleUpperCase('fi-FI').replace(/\s+/g, ''), p.name.toLocaleUpperCase('fi-FI').replace(/\s+/g, ''), p.name);
    // Ei enää huutoa: jokainen vähintään viiden kirjaimen sana näkyy pienillä kirjaimilla.
    assert.doesNotMatch(out, /[A-ZÅÄÖ]{5,}/, p.name);
  }
});
