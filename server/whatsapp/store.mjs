import { openSqlite, isRemoteDatabase } from '../sqlite.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Viestikatto numeroa kohden webhookin uusille viesteille: 10 minuutissa (60 s), 120 tunnissa ja 400 vuorokaudessa.
export const MESSAGES_PER_HOUR = 120;
export const MESSAGES_PER_DAY = 400;
// Pilven yksi kutsu kestää enintään 300 s; tätä vanhempi käsittelyvaraus on keskeytynyt.
export const PROCESSING_LEASE_MS = 6 * 60_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Kuinka kauan jonon rivit, keskusteluhistoria ja vuorojen tiedot säilyvät.
const KEEP_MS = 7 * DAY;
// Kustannusraja: [ikkuna, enimmäismäärä]. Tavallinen keskustelu ei osu näihin.
const INBOUND_LIMITS = [[MINUTE, 10], [HOUR, MESSAGES_PER_HOUR], [DAY, MESSAGES_PER_DAY]];
// Kutsukoodin voimassaolo ja yhdistämisyritysten raja (myös epäonnistuneet lasketaan).
const INVITE_TTL_MS = 10 * MINUTE;
const PAIR_WINDOW_MS = 15 * MINUTE;
const PAIR_TRIES_ALLOWED = 5;
// Mallille annettava historia ja kantaan jätettävä historia (vuoroja, ei viestipareja).
const HISTORY_SHOWN = 18;
const HISTORY_KEPT = 20;
const NAME_MAX = 120;
const MERGED_TEXT_MAX = 4000;
// Ylläpitäjän antama koodi on koko viesti: "YHDISTA koodi" tai "YHDISTÄ koodi".
const PAIR_COMMAND = /^yhdist[aä]\s+(\S+)\s*$/iu;
// Puhelinnumero ilman plussaa: 7–15 numeroa, ei alkunollaa (E.164).
const E164_DIGITS = /^[1-9]\d{6,14}$/;
// Viesti on vielä kesken: jonossa tai käsittelyssä.
const OPEN_STATE = "state IN ('pending','processing')";

// Kutsukoodi: 12 satunnaista tavua URL-turvallisena tekstinä (16 merkkiä).
const newInviteCode = () => crypto.randomBytes(12).toString('base64url');
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');
// Kantaan tallennetaan vain koodin tiiviste, ei itse koodia.
export function codeHash(code) {
  return sha256Hex(code.trim());
}

// Landing-ilmoittautuminen poistettiin 17.11.2026: käyttäjät lisää ylläpitäjä (invite + YHDISTA-koodi). Vanhaa
// landing_invites-taulua ei enää lueta eikä kirjoiteta; sitä ei pudoteta, ettei pilvikanta tarvitse migraatiota.
export function phoneNumber(input) {
  const digits = String(input || '').replace(/^\+/, '');
  if (E164_DIGITS.test(digits)) return digits;
  throw new Error('Anna puhelinnumero kansainvälisessä muodossa, esimerkiksi +358401234567.');
}

// Kannan rakenne. Tuotannon kannat (Turso) on luotu näillä lauseilla, joten taulujen ja sarakkeiden nimiä, tyyppejä
// ja indeksejä ei muuteta. Kaikki lauseet ovat IF NOT EXISTS -muotoisia, joten olemassa oleva kanta säilyy ennallaan.
const SCHEMA = [
  'PRAGMA journal_mode=WAL',
  'PRAGMA busy_timeout=5000',
  'CREATE TABLE IF NOT EXISTS members (phone TEXT PRIMARY KEY, company TEXT NOT NULL, person TEXT NOT NULL, binding TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS invites (phone TEXT PRIMARY KEY, company TEXT NOT NULL, person TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, phone TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL,
      binding TEXT, received INTEGER NOT NULL, sent_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, reply TEXT, reply_id TEXT, error TEXT)`,
  'CREATE INDEX IF NOT EXISTS inbox_queue ON inbox(state, next_at, received)',
  'CREATE INDEX IF NOT EXISTS inbox_phone ON inbox(phone, received)',
  `CREATE TABLE IF NOT EXISTS reply_parts (message_id TEXT NOT NULL, part INTEGER NOT NULL, text TEXT NOT NULL, reply_id TEXT,
      PRIMARY KEY(message_id,part))`,
  // Niputetun vuoron viestit aikaleimoineen, uusintakierros ja hylätty vastaus (channel.mjs). Rivi syntyy vasta, kun
  // vuoroon liitetään toinen viesti; uusintayritys jatkaa siitä samalla kierroksella.
  'CREATE TABLE IF NOT EXISTS inbox_turns (message_id TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS turns (seq INTEGER PRIMARY KEY, binding TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS turns_binding ON turns(binding, seq)',
  // Käytöstä poistunut ilmoittautumistaulu (ks. yllä). Jätetään paikalleen, jotta vanhat kannat pysyvät yhteensopivina.
  `CREATE TABLE IF NOT EXISTS landing_invites (phone TEXT NOT NULL, hash TEXT NOT NULL, company TEXT NOT NULL, person TEXT NOT NULL,
      expires INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(phone, hash))`,
  // Miten liitos syntyi. Jos riviä ei ole, liitos tehtiin ylläpitäjän kutsulla (tiimin antama YHDISTA-koodi).
  'CREATE TABLE IF NOT EXISTS member_sources (binding TEXT PRIMARY KEY, source TEXT NOT NULL, created INTEGER NOT NULL)',
];

const copyRow = (row) => ({ ...row });
const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');
const tidyName = (value) => (typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : '');
// Vuoro ilman liitettyjä viestejä: vain jonon oma viesti kierroksella 0.
const singleTurn = (job) => ({ round: 0, incoming: [{ text: job.text, at: Number(job.sent_at), round: 0 }] });

/** WhatsApp-jono, liitokset ja keskusteluhistoria. Kanta on erillään demotilausten kannoista.
 *  Paikallinen tiedosto saa vain omistajan oikeudet; Turso-osoite ja :memory: avataan sellaisenaan. */
export function openWhatsAppStore(file, clock = Date.now) {
  const onDisk = file !== ':memory:' && !isRemoteDatabase(file);
  if (onDisk) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqlite(file);
  if (onDisk) fs.chmodSync(file, 0o600);
  db.exec(SCHEMA.join(';\n'));

  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const many = (sql, ...args) => db.prepare(sql).all(...args);
  const write = (sql, ...args) => db.prepare(sql).run(...args);
  // Kirjoitustransaktio: joko kaikki muutokset tai ei yhtään. Palauttaa työn tuloksen.
  const atomically = (work) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const findMember = (phone) => one('SELECT * FROM members WHERE phone=?', phone);
  const storedTurn = (messageId) => {
    const row = one('SELECT json FROM inbox_turns WHERE message_id=?', messageId);
    return row ? JSON.parse(row.json) : null;
  };
  // Vanhan liitoksen keskusteluhistoria ja alkuperätieto eivät siirry uudelle liitokselle.
  const forgetBinding = (binding) => {
    write('DELETE FROM turns WHERE binding=?', binding);
    write('DELETE FROM member_sources WHERE binding=?', binding);
  };
  const forgetDialogue = (binding) => {
    // Tilauskeskustelun taulut syntyvät vasta tilaustilassa (dialogue.mjs), joten niitä ei aina ole.
    if (!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wa_dialogue'")) return;
    write('DELETE FROM wa_dialogue WHERE binding=?', binding);
    write('DELETE FROM wa_dialogue_results WHERE binding=?', binding);
  };
  const countSince = (phone, windowMs) => one('SELECT count(*) n FROM inbox WHERE phone=? AND received>=?', phone, clock() - windowMs).n;

  return {
    db,
    close: () => db.close(),
    member: findMember,
    // Mac: prosessi on voinut kaatua kesken mallikutsun tai lähetyksen. Tallennettu vastaus käytetään uudelleen.
    recover() { db.exec("UPDATE inbox SET state='pending', next_at=0 WHERE state='processing'"); },
    // Pilvessä ei ole yhtä pysyvää prosessia: vain varauksen aikarajan ylittäneet käsittelyt palautetaan jonoon.
    recoverStale() { return write("UPDATE inbox SET state='pending' WHERE state='processing' AND next_at<=?", clock()).changes; },

    invite(rawPhone, company, person) {
      const phone = phoneNumber(rawPhone);
      const names = { company: tidyName(company), person: tidyName(person) };
      if (!names.company || !names.person) throw new Error('Yritys ja henkilö vaaditaan.');
      const code = newInviteCode();
      const expires = clock() + INVITE_TTL_MS;
      write('INSERT OR REPLACE INTO invites (phone, company, person, hash, expires) VALUES (?, ?, ?, ?, ?)',
        phone, names.company, names.person, codeHash(code), expires);
      return { code, expires };
    },

    memberSource(binding) {
      const row = one('SELECT source FROM member_sources WHERE binding=?', binding || '');
      return row?.source || 'admin';
    },

    // Numeron poisto: liitos, kutsu, historia ja keskeneräiset viestit. Valmiit viestit jäävät jonoon siivottaviksi.
    revoke(rawPhone) {
      const phone = phoneNumber(rawPhone);
      const previous = findMember(phone);
      write('DELETE FROM members WHERE phone=?', phone);
      write('DELETE FROM invites WHERE phone=?', phone);
      if (previous) { forgetBinding(previous.binding); forgetDialogue(previous.binding); }
      write(`DELETE FROM reply_parts WHERE message_id IN (SELECT id FROM inbox WHERE phone=? AND ${OPEN_STATE})`, phone);
      write('DELETE FROM inbox_turns WHERE message_id IN (SELECT id FROM inbox WHERE phone=?)', phone);
      write(`UPDATE inbox SET state='cancelled', reply=NULL, text='' WHERE phone=? AND ${OPEN_STATE}`, phone);
    },

    // codeDigest on viestin koodin tiiviste (codeHash) ja messageId yhdistämisviestin oma jonorivi. Koodin pitää vastata
    // juuri tämän numeron kutsua, joten toisesta numerosta kirjoitettu koodi ei yhdistä. Uusi kutsu ei nollaa yritysten määrää.
    pair(phone, codeDigest, messageId) {
      const tries = one("SELECT count(*) n FROM inbox WHERE phone=? AND kind='pair' AND received>=?", phone, clock() - PAIR_WINDOW_MS).n;
      if (tries > PAIR_TRIES_ALLOWED) return null;
      const invitation = one('SELECT * FROM invites WHERE phone=? AND hash=? AND expires>?', phone, codeDigest, clock());
      if (!invitation) return null;
      const fresh = crypto.randomUUID();
      const previous = findMember(phone);
      atomically(() => {
        write('INSERT OR REPLACE INTO members (phone, company, person, binding) VALUES (?, ?, ?, ?)',
          phone, invitation.company, invitation.person, fresh);
        write('DELETE FROM invites WHERE phone=?', phone);
        if (messageId) write('UPDATE inbox SET binding=? WHERE id=?', fresh, messageId);
        if (previous) forgetBinding(previous.binding);
      });
      return findMember(phone);
    },

    // Webhookin viesti jonoon. false = sama viesti on jo jonossa tai numero ylitti viestikaton.
    enqueue(message) {
      if (one('SELECT id FROM inbox WHERE id=?', message.id)) return false;
      if (INBOUND_LIMITS.some(([windowMs, cap]) => countSince(message.phone, windowMs) >= cap)) return false;
      const text = message.text || '';
      // Kuva tai ääniviesti ei ole koskaan yhdistäminen; vain kirjoitettu viesti voi olla koodi.
      const written = !message.kind || message.kind === 'text';
      const code = written ? PAIR_COMMAND.exec(text)?.[1] : undefined;
      write('INSERT INTO inbox (id, phone, kind, text, binding, received, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        message.id, message.phone, code ? 'pair' : message.kind || 'text', code ? codeHash(code) : text,
        findMember(message.phone)?.binding || null, clock(), message.sentAt);
      return true;
    },

    // Seuraava käsiteltävä viesti varataan yhdellä lauseella (audit #12), joten rinnakkaiset käsittelijät (sama tai eri
    // prosessi tai pilvi-instanssi) eivät saa samaa viestiä. Numeron seuraava viesti odottaa, kunnes edellinen on valmis;
    // eri numerot etenevät rinnakkain. next_at on varauksen aikaraja (recoverStale).
    next() {
      const at = clock();
      // Tyhjä jono pysyy pelkkänä lukuna: kirjoitus alkaa vasta, kun jokin viesti odottaa.
      if (!one("SELECT 1 FROM inbox WHERE state='pending' AND next_at<=? LIMIT 1", at)) return null;
      const claimed = one(`UPDATE inbox SET state='processing', attempts=attempts+1, next_at=?
        WHERE id=(
          SELECT cand.id FROM inbox cand
          WHERE cand.state='pending' AND cand.next_at<=?
            AND NOT EXISTS (SELECT 1 FROM inbox earlier WHERE earlier.phone=cand.phone
              AND earlier.${OPEN_STATE} AND earlier.rowid<cand.rowid)
          ORDER BY cand.received, cand.rowid LIMIT 1)
        AND state='pending' RETURNING *`, at + PROCESSING_LEASE_MS, at);
      return claimed ? copyRow(claimed) : null;
    },

    // Saman numeron jonossa odottavat tekstiviestit heti tämän perässä (niputus, channel.mjs). Kuva, ääniviesti,
    // yhdistämiskoodi, toinen liitos tai stop-ehto katkaisee jonon: loput käsitellään omina vuoroinaan.
    followers(job, stop = () => false) {
      const queued = many(`SELECT id, text, kind, binding, received, sent_at FROM inbox
        WHERE phone=? AND state='pending' AND rowid>(SELECT rowid FROM inbox WHERE id=?)
        ORDER BY rowid LIMIT 20`, job.phone, job.id);
      const breakAt = queued.findIndex((row) => row.kind !== 'text' || row.binding !== job.binding || stop(row.text));
      return (breakAt < 0 ? queued : queued.slice(0, breakAt)).map(copyRow);
    },

    // Vuoron asiakasviestit: { round, incoming: [{ text, at, round }], discardedReply }. round on chat-kutsun kierros
    // (0 = ensimmäinen, 1–2 = uusinta hylätyn vastauksen jälkeen).
    turn(job) {
      return storedTurn(job.id) || singleTurn(job);
    },

    // Liittää odottavat viestit tähän vuoroon yhdessä transaktiossa. Yhdistetty teksti jää tämän viestin riville, jotta
    // uusintayritys käsittelee saman kokonaisuuden; liitetyt rivit saavat tilan 'merged'. Palauttaa { text, turn } tai
    // null, jos yksikään viesti ei enää odottanut.
    absorb(job, followers, { round = 0, discardedReply = null } = {}) {
      if (!followers.length) return null;
      return atomically(() => {
        const ids = followers.map((f) => f.id);
        const pendingIds = new Set(many(`SELECT id FROM inbox WHERE state='pending' AND id IN (${placeholders(ids.length)})`, ...ids)
          .map((row) => row.id));
        const joining = followers.filter((f) => pendingIds.has(f.id));
        if (!joining.length) return null;
        const turn = storedTurn(job.id) || singleTurn(job);
        turn.round = round;
        for (const f of joining) turn.incoming.push({ text: f.text, at: Number(f.sent_at), round });
        if (discardedReply !== null) turn.discardedReply = discardedReply;
        const text = [job.text, ...joining.map((f) => f.text)].join('\n').slice(0, MERGED_TEXT_MAX);
        const joinedIds = joining.map((f) => f.id);
        write('UPDATE inbox SET text=? WHERE id=?', text, job.id);
        write(`UPDATE inbox SET state='merged', next_at=0 WHERE state='pending' AND id IN (${placeholders(joinedIds.length)})`, ...joinedIds);
        write('INSERT OR REPLACE INTO inbox_turns (message_id, json, created) VALUES (?, ?, ?)', job.id, JSON.stringify(turn), clock());
        return { text, turn };
      });
    },

    // Tuoreet viestit, jotka odottavat toisen viestin takana: niiden lähettäjä näkee yhä "kirjoittaa".
    waiting(since) {
      return many("SELECT id, phone, sent_at FROM inbox WHERE state='pending' AND received>=? ORDER BY received,rowid LIMIT 50", since).map(copyRow);
    },

    // Mallille annettava historia vanhimmasta uusimpaan.
    history(binding) {
      return many(`SELECT role, content FROM turns WHERE binding=? ORDER BY seq DESC LIMIT ${HISTORY_SHOWN}`, binding).map(copyRow).reverse();
    },

    // Valmis vastaus ja sen osat talteen ennen lähetystä, jotta uusintayritys lähettää täsmälleen saman vastauksen.
    // binding: vuoro lisätään keskusteluhistoriaan (ei yhdistämis- eikä virheviesteille).
    saveReply(job, reply, binding, parts = [reply]) {
      atomically(() => {
        write('UPDATE inbox SET reply=? WHERE id=?', reply, job.id);
        const addPart = db.prepare('INSERT OR IGNORE INTO reply_parts (message_id, part, text) VALUES (?, ?, ?)');
        parts.forEach((text, index) => addPart.run(job.id, index, text));
        if (!binding) return;
        const at = clock();
        const addTurn = db.prepare('INSERT INTO turns (binding, role, content, created) VALUES (?, ?, ?, ?)');
        addTurn.run(binding, 'user', job.text, at);
        addTurn.run(binding, 'assistant', reply, at);
        // Vain uusimmat HISTORY_KEPT vuoroa jäävät: poistetaan kaikki, jotka ovat sitä vanhempia.
        write(`DELETE FROM turns WHERE binding=? AND seq <= (
          SELECT seq FROM turns WHERE binding=? ORDER BY seq DESC LIMIT 1 OFFSET ${HISTORY_KEPT})`, binding, binding);
      });
    },

    // Lähetettävät osat järjestyksessä. Vanha rivi ilman osia saa yhden osan koko vastauksesta.
    replyParts(id, fallback) {
      const load = () => many('SELECT * FROM reply_parts WHERE message_id=? ORDER BY part', id);
      const stored = load();
      if (stored.length) return stored;
      write('INSERT INTO reply_parts (message_id, part, text) VALUES (?, 0, ?)', id, fallback);
      return load();
    },
    saveReplyPart(id, part, replyId) {
      write('UPDATE reply_parts SET reply_id=? WHERE message_id=? AND part=?', replyId, id, part);
    },
    finish(id, state, replyId = null) {
      write('UPDATE inbox SET state=?, reply_id=? WHERE id=?', state, replyId, id);
    },
    // Epäonnistunut käsittely uudelleen jonoon kasvavalla viiveellä; max yrityksen jälkeen 'failed'.
    retry(job, error, max = 3) {
      const gaveUp = job.attempts >= max;
      write('UPDATE inbox SET state=?, next_at=?, error=? WHERE id=?', gaveUp ? 'failed' : 'pending', clock() + job.attempts * 30_000, error, job.id);
    },

    prune() {
      const at = clock();
      write('DELETE FROM invites WHERE expires<=?', at);
      db.exec('DELETE FROM member_sources WHERE binding NOT IN (SELECT binding FROM members)');
      write('DELETE FROM turns WHERE created<?', at - KEEP_MS);
      write('DELETE FROM inbox WHERE received<?', at - KEEP_MS);
      // Osat ja vuorot, joiden viesti on jo poistettu jonosta.
      db.exec('DELETE FROM reply_parts WHERE message_id NOT IN (SELECT id FROM inbox)');
      db.exec('DELETE FROM inbox_turns WHERE message_id NOT IN (SELECT id FROM inbox)');
    },
  };
}
