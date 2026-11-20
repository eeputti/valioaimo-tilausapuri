import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemsPerSalesUnit, explainItemQuantity } from '../server/itemQuantities.mjs';
import { unitSizeFor } from '../server/gateway/quantity.mjs';
import { understand } from '../server/aimo/understand.mjs';
import { loadCatalog } from '../server/catalog.mjs';

test('100 kananmunaa lasketaan munina; myyntipakkausten vanha PCS-merkitys säilyy', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  for (const text of ['100 kananmunaa', '100 kpl kananmunia', 'sata kananmunaa', 'kaksi tusinaa kananmunia']) {
    const r = understand(text); assert.equal(r.items[0].quantity.basis, 'items', text);
    assert.ok(!r.assumptions.some((n) => n.code === 'UNIT_ASSUMED'), text);
  }
  for (const text of ['100 rasiaa kananmunia', '100 pakettia kananmunia', '100 laatikkoa kananmunia', '20 l maitoa']) {
    assert.notEqual(understand(text).items[0].quantity.basis, 'items', text);
  }
  const p = { name: 'Kananmuna M10', salesUnit: 'RAS' };
  assert.equal(unitSizeFor(p, null, 'PCS').value, 1);
  assert.equal(unitSizeFor(p, null, 'PCS', 'sales').value, 1);
  assert.equal(unitSizeFor(p, null, 'PCS', 'items').value, 10);
});

test('6/8/10/12/56/90 munan pakkaukset pyöristetään ylöspäin ja ylijäämä näytetään', () => {
  for (const n of [6, 8, 10, 12, 56, 90]) {
    const p = { name: `Kananmuna M${n} 580g`, salesUnit: 'RAS' };
    const qty = Math.ceil(100 / unitSizeFor(p, null, 'PCS', 'items').value);
    const out = explainItemQuantity(p, { value: 100, unit: 'PCS', basis: 'items' }, qty);
    assert.equal(out.providedItems, qty * n); assert.ok(out.providedItems >= 100);
    assert.equal(out.excessItems, qty * n - 100);
    assert.match(out.text, new RegExp(`${qty} rasiaa × ${n} munaa`));
  }
});

test('pakkauksen painosta ei arvata kappalemäärää ja tuntematon muunnos jää ratkaisematta', () => {
  for (const p of [
    { name: 'Keitetty kananmuna 1,5kg', salesUnit: 'ST' },
    { name: 'Kananmuna 580g', salesUnit: 'RAS' },
    { name: 'Kananmuna M10', salesUnit: 'KG' },
    { name: 'Kananmuna 4 x 6 kpl', salesUnit: 'KI', baseUnit: 'RAS', perSales: 4 },
  ]) assert.equal(itemsPerSalesUnit(p), null);
  assert.equal(itemsPerSalesUnit({ name: 'Kananmuna 12 kpl', salesUnit: 'RAS' }).value, 12);
  assert.equal(itemsPerSalesUnit({ name: 'Kananmuna M6', salesUnit: 'KI', baseUnit: 'RAS', perSales: 20 }).value, 120);
});

test('oikean katalogin Kieku M10/M6/M90 tuottaa 100/102/180 munaa, ei sataa pakkausta', { skip: !fs.existsSync(new URL('../data/catalog.json', import.meta.url)) && 'data/catalog.json puuttuu' }, () => {
  const cat = loadCatalog();
  for (const [id, count, qty, provided] of [['468121', 10, 10, 100], ['472535', 6, 17, 102], ['463883', 90, 2, 180]]) {
    const p = cat.get(id);
    assert.equal(itemsPerSalesUnit(p).value, count);
    assert.equal(Math.ceil(100 / count), qty);
    assert.equal(explainItemQuantity(p, { value: 100, unit: 'PCS', basis: 'items' }, qty).providedItems, provided);
  }
});
