// Tilausapuri v2: agentin transkripti luonnoskannassa (docs/agent-v2.md, kohta "Arkkitehtuuri").
// Anthropic-viestit tallennetaan sellaisinaan (myös thinking-, tool_use- ja tool_result-lohkot) ja vain lisäämällä: rivejä ei
// muokata jälkikäteen, joten aiemmat vuorot lähtevät mallille tavu tavulta samoina (välimuisti ja thinking-lohkojen sidonta).
// Koko vuoro ja sen tulos kirjoitetaan yhdessä transaktiossa: keskeytynyt vuoro ei jätä kantaan puolikasta työkalukierrosta,
// ja sama viestitunniste palauttaa tallennetun tuloksen ajamatta mallia uudelleen.
// Tulos menee samaan turn_results-tauluun kuin vanhan putken vuoroilla, joten agentin jälki (deploy/cloudflare/trace-reader.mjs)
// ja korisivun tarkistukset löytävät v2:n vuorot. Lyhennys tehdään vain alusta, käyttäjävuoron rajalta (window).

export const TRANSCRIPT_RETENTION_MS = 14 * 86400_000;

/**
 * @param {object} db openSqlite-kanta (paikallinen tiedosto, :memory: tai Turso-etäkanta)
 * @param {{now?: () => number}} [o] seinäkello aikaleimoille ja säilytykselle (ei demokello)
 */
export function openTranscript(db, { now = Date.now } = {}) {
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS agent_transcript (seq INTEGER PRIMARY KEY AUTOINCREMENT, conversation TEXT NOT NULL, turn TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS agent_transcript_conversation ON agent_transcript(conversation, seq);
    CREATE TABLE IF NOT EXISTS agent_window (conversation TEXT PRIMARY KEY, start_seq INTEGER NOT NULL, input_tokens INTEGER NOT NULL,
      updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS turn_results (message_id TEXT PRIMARY KEY, conversation TEXT NOT NULL, json TEXT NOT NULL, created INTEGER NOT NULL);`);
  const parse = (row) => (row ? JSON.parse(row.json) : null);
  return {
    /** Tallennettu tulos tälle viestitunnisteelle tai null. */
    result(messageId) { return parse(db.prepare('SELECT json FROM turn_results WHERE message_id=?').get(String(messageId))); },
    /**
     * Mallille lähetettävä ikkuna: transkriptin rivit tallennetusta alusta. Kun vuoroja on yli maxTurns tai edellisen kutsun
     * syöte oli yli maxInputTokens, alku siirtyy vanhimman puoliskon yli käyttäjävuoron rajalle. Uusi alku tallennetaan vasta
     * vuoron lopussa (append), joten epäonnistunut vuoro laskee saman ikkunan uudelleen. Alku pysyy paikallaan pitkään, jotta
     * välimuistin etuliite ei muutu joka vuorolla.
     */
    window(conversation, { maxTurns = 30, maxInputTokens = 50_000 } = {}) {
      const state = db.prepare('SELECT start_seq, input_tokens FROM agent_window WHERE conversation=?').get(conversation);
      const from = Number(state?.start_seq || 0);
      const rows = db.prepare('SELECT seq, turn, role, content FROM agent_transcript WHERE conversation=? AND seq>=? ORDER BY seq').all(conversation, from);
      const starts = [];
      rows.forEach((row, i) => { if (i === 0 || rows[i - 1].turn !== row.turn) starts.push(i); });
      const over = starts.length > maxTurns || Number(state?.input_tokens || 0) > maxInputTokens;
      const cut = over && starts.length > 1 ? starts[Math.floor(starts.length / 2)] : 0;
      const kept = rows.slice(cut);
      return {
        messages: kept.map((row) => ({ role: row.role, content: JSON.parse(row.content) })),
        start: kept.length ? Number(kept[0].seq) : from,
        // Seuraavan vuoron ensimmäinen rivi: alku tähän, jos aiempi historia pitää ohittaa kokonaan.
        next: rows.length ? Number(rows.at(-1).seq) + 1 : from,
        trimmed: cut > 0,
        turns: starts.length - starts.filter((i) => i < cut).length,
        // Uusi keskustelu vain, kun historiaa ei ole lainkaan. Siirretty alku (kieltäytyminen tai rikkinäinen historia) ei
        // aloita keskustelua alusta eikä tuo uutta esittelyä.
        first: rows.length === 0 && from === 0,
      };
    },
    /**
     * Lisää vuoron viestit ja tuloksen yhdessä transaktiossa. Jos samalle viestitunnisteelle on jo tulos (rinnakkainen ajo),
     * mitään ei lisätä ja aiempi tulos palautetaan.
     * @returns {object} tallennettu tulos
     */
    append(conversation, messageId, messages, result, { start = 0, inputTokens = 0 } = {}) {
      const at = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = parse(db.prepare('SELECT json FROM turn_results WHERE message_id=?').get(String(messageId)));
        if (existing) { db.exec('ROLLBACK'); return existing; }
        if (messages.length) {
          db.prepare(`INSERT INTO agent_transcript(conversation,turn,role,content,created) VALUES ${messages.map(() => '(?,?,?,?,?)').join(',')}`)
            .run(...messages.flatMap((m) => [conversation, String(messageId), m.role, JSON.stringify(m.content), at]));
        }
        db.prepare('INSERT INTO turn_results(message_id,conversation,json,created) VALUES(?,?,?,?)').run(String(messageId), conversation, JSON.stringify(result), at);
        db.prepare(`INSERT INTO agent_window(conversation,start_seq,input_tokens,updated) VALUES(?,?,?,?)
          ON CONFLICT(conversation) DO UPDATE SET start_seq=MAX(agent_window.start_seq, excluded.start_seq), input_tokens=excluded.input_tokens, updated=excluded.updated`)
          .run(conversation, Math.max(0, Math.trunc(start)), Math.max(0, Math.trunc(inputTokens)), at);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* transaktio ei ehtinyt alkaa */ }
        throw err;
      }
    },
    /** Rajattu säilytys: kokonaiset vuorot (saman vuoron rivit samalla aikaleimalla). turn_results-taulun siivoaa luonnosvarasto. */
    prune(retention = TRANSCRIPT_RETENTION_MS) {
      db.prepare('DELETE FROM agent_transcript WHERE created<?').run(now() - retention);
      db.prepare('DELETE FROM agent_window WHERE updated<?').run(now() - retention);
    },
  };
}
