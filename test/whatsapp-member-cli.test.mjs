// Ylläpitäjän jäsenkomento: link yhdistää demonumeron heti ilman YHDISTA-koodia, list näyttää yhteydet
// numerot peitettyinä, ja kanta kerrotaan aina (väärä env-tiedosto ei saa viedä kutsua huomaamatta toiseen kantaan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWhatsAppStore, codeHash } from '../server/whatsapp/store.mjs';

const script = fileURLToPath(new URL('../scripts/whatsapp-member.mjs', import.meta.url));

function run(db, ...args) {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...args],
    { env: { PATH: process.env.PATH, WHATSAPP_DB: db }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('link yhdistää numeron heti, list peittää numerot ja revoke poistaa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-member-'));
  const db = path.join(dir, 'whatsapp.db');
  try {
    const linked = run(db, 'link', '--phone', '+358401234567', '--company', 'Ravintola A', '--person', 'Anna');
    assert.equal(linked.code, 0, linked.err);
    assert.match(linked.out, /^Kanta: paikallinen tiedosto /m);
    assert.match(linked.out, /Yhdistetty: \+358…4567, Anna, Ravintola A\./);
    assert.doesNotMatch(linked.out, /401234567|YHDISTA/);

    let store = openWhatsAppStore(db);
    const first = store.member('358401234567');
    assert.equal(first.person, 'Anna');
    assert.equal(first.company, 'Ravintola A');
    assert.equal(store.db.prepare('SELECT count(*) n FROM invites').get().n, 0, 'kutsu ei jää voimaan');
    store.close();

    // Uudelleen yhdistäminen antaa uuden yhteyden, joten keskustelu ja kori alkavat alusta.
    const again = run(db, 'link', '--phone', '+358401234567', '--company', 'Ravintola A', '--person', 'Anna');
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /alkavat alusta/);
    store = openWhatsAppStore(db);
    assert.notEqual(store.member('358401234567').binding, first.binding);
    store.close();

    assert.equal(run(db, 'link', '--phone', '+358409999999', '--company', 'Kahvila B', '--person', 'Pekka').code, 0);
    const invited = run(db, 'invite', '--phone', '+358405555555', '--company', 'Bistro C', '--person', 'Liisa');
    assert.match(invited.out, /YHDISTA \S+/);
    // Selainkeskustelun synteettinen asiakas lasketaan erikseen eikä näy WhatsApp-numeroiden listassa.
    store = openWhatsAppStore(db);
    store.pair('358000012345678', codeHash(store.invite('358000012345678', 'Testikeittiö (selain)', 'Kokeilija').code));
    store.close();

    const listed = run(db, 'list');
    assert.equal(listed.code, 0, listed.err);
    assert.match(listed.out, /WhatsApp-numeroita: 2\n/);
    assert.match(listed.out, /Selainkeskustelun testiasiakkaita: 1 /);
    assert.doesNotMatch(listed.out, /Kokeilija/);
    assert.match(listed.out, /\+358…4567 {2}Anna, Ravintola A/);
    assert.match(listed.out, /\+358…9999 {2}Pekka, Kahvila B/);
    assert.match(listed.out, /Voimassa olevia kutsuja: 1\n- \+358…5555 {2}Liisa, voimassa vielä 10 min/);
    assert.doesNotMatch(listed.out, /401234567|409999999|405555555/, 'täydet numerot eivät näy listassa');

    assert.equal(run(db, 'revoke', '--phone', '+358401234567').code, 0);
    store = openWhatsAppStore(db);
    assert.equal(store.member('358401234567'), undefined);
    assert.ok(store.member('358409999999'), 'muut yhteydet säilyvät');
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('puuttuva tai tuntematon valinta ei muuta kantaa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-member-'));
  const db = path.join(dir, 'whatsapp.db');
  try {
    for (const args of [['link', '--phone', '+358401234567', '--company', 'Ravintola A'], ['link', '--phone', '+358401234567',
      '--company', 'Ravintola A', '--person', 'Anna', '--admin', 'x'], ['list', '--phone', '+358401234567'], ['remove']]) {
      const result = run(db, ...args);
      assert.equal(result.code, 1, args.join(' '));
      assert.match(result.err, /Käyttö:/);
    }
    assert.equal(run(db, 'link', '--phone', '0401234567', '--company', 'Ravintola A', '--person', 'Anna').code, 1, 'numero ilman maatunnusta');
    assert.equal(fs.existsSync(db) ? (() => { const s = openWhatsAppStore(db); const n = s.db.prepare('SELECT count(*) n FROM members').get().n; s.close(); return n; })() : 0, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
