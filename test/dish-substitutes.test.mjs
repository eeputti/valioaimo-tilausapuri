// Valmisruoan korvaaja on sama ruoka (WhatsApp 18.11.: lanttulaatikon tilalle tarjottiin maksalaatikkoa ja
// nakki-perunasoselaatikkoa, koska nimissä oli yhteinen "laatikko"). Ei mallikutsuja eikä verkkoa: hinnat ja saatavuus
// simuloidaan (VALIO_API_KEY tyhjä), kanta on väliaikainen.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'data/catalog.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimo-dish-subs-'));
Object.assign(process.env, { VALIO_API_KEY: '', ANTHROPIC_API_KEY: '', DEMO_NOW: '2026-11-15T09:00:00+02:00', AIMO_DB: path.join(dir, 'k.db') });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { sameDish, dishesOf, findSubstitutes } = await import('../server/substitutes.mjs');

const p = (name) => ({ name });

test('eri laatikot, keitot ja kastikkeet ovat eri ruokia, sama ruoka toisen valmistajan nimellä on sama', () => {
  assert.equal(sameDish(p('Saarioinen Lanttulaatikko 2,8kg'), p('Saarioinen Maksalaatikko laktoositon 2,7kg')), false);
  assert.equal(sameDish(p('Saarioinen Lanttulaatikko 2,8kg'), p('Feelia F Nakki-perunasoselaatikko 2,5kg')), false);
  assert.equal(sameDish(p('Saarioinen Porkkanalaatikko 2,8kg'), p('Feelia F Perunasose 2,5kg')), false, 'perunasose ei ole laatikkoruoka');
  assert.equal(sameDish(p('Saarioinen Lohikeitto 2kg'), p('Hernekeitto 3kg')), false);
  assert.equal(sameDish(p('Saarioinen Lanttulaatikko 2,8kg'), p('Kymppi Lanttulaatikko 2 kg raakapakaste')), true);
  assert.equal(sameDish(p('Saarioinen Lanttulaatikko 2,8kg'), p('HK Paistovalmis Lanttulaatikkomassa pakaste 4x 2,5 kg')), true);
  assert.equal(sameDish(p('Pro Lihakaalilaatikko 3000g'), p('Mestari Forsman Kermainen Liha-kaalilaatikko 3kg')), true);
  assert.equal(sameDish(p('Valio kevytmaito 1 l'), p('Arla kevytmaito 1 l')), true, 'raaka-aineisiin sääntö ei koske');
  assert.equal(sameDish(p('PP PERUNA PESTY'), p('Saarioinen Perunalaatikko 2,8kg')), false, 'perunan tilalle ei perunalaatikkoa');
  assert.deepEqual(dishesOf(p('Valio keittokerma 2 l')), [], 'keittokerma ei ole keitto');
  assert.deepEqual(dishesOf(p('Saarioinen Lanttulaatikko 6 laatikkoa')).map((d) => d.base), ['lanttu'], 'pelkkä "laatikko" on myyntierä');
});

test('lanttulaatikon korvaajat ovat lanttulaatikkoa, eivät muita saman tuoteryhmän laatikoita', { skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }, async () => {
  const { loadCatalog } = await import('../server/catalog.mjs');
  const cat = loadCatalog();
  const original = cat.get('462447'); // Saarioinen Lanttulaatikko 2,8kg
  assert.match(original.name, /Lanttulaatikko/);
  const r = await findSubstitutes(original, 186, '2026-11-25', { subSameAllergens: true, bannedAllergens: [], subMaxPriceIncreasePct: 10 }, { limit: 8 });
  for (const o of r.options) assert.match(o.name, /lanttulaatikko/i, `${o.name} ei ole lanttulaatikkoa`);
  const kaali = await findSubstitutes(cat.get('470314'), 10, '2026-11-25', { subSameAllergens: false, bannedAllergens: [], subMaxPriceIncreasePct: 50 }, { limit: 8 });
  for (const o of kaali.options) assert.match(o.name, /kaalilaatikko/i, `${o.name} ei ole kaalilaatikkoa`);
});
