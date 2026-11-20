// NÄKYMÄTÖN TEKOÄLY portin ytimessä. Kielimalli tekee kaksi asiaa, joissa harkinta auttaa, eikä yhtään asiaa, jossa pitää olla varma:
//   1) valitsee korvaajan portin JO TARKISTAMISTA vaihtoehdoista käyttötarkoituksen mukaan (ei pelkän hinnan)
//   2) kirjoittaa ihmiselle yhden selkeän lauseen siitä, miksi tilaus pysähtyi ja mitä kannattaa tehdä
// Malli ei näe eikä muuta hintoja, saatavuutta tai mandaattia, eikä voi lisätä tuotteita: vastaus hylätään, jos se viittaa
// vaihtoehtoon jota portti ei tarjonnut. Jos malli on hidas tai pois päältä, portti jatkaa sääntöjen järjestyksellä.
// AVOIMUUS: jokainen mallikutsu kirjataan samaan hash-ketjutettuun lokiin (MODEL_CALL): malli, tarkoitus, syötteen tiiviste,
// vastaus, kesto, tokenit ja se, käyttikö koodi vastausta.
import crypto from 'node:crypto';
import { askAgent, agentEnabled, modelFor } from '../aimoAgent.mjs';
import { ledger } from './store.mjs';

const TIMEOUT_MS = 4000;
export const advisorStats = { calls: 0, used: 0, failed: 0, lastMs: null, inputTokens: 0, outputTokens: 0 };

/** Yksi rakenteinen mallikutsu + lokirivi. Palauttaa {out, log} tai null (pois päältä, virhe, aikakatkaisu). */
async function ask(purpose, system, facts, schema, refs) {
  if (!agentEnabled()) return null;
  const t0 = performance.now();
  const input = JSON.stringify(facts);
  const base = { purpose, model: modelFor('fast'), inputSha256: crypto.createHash('sha256').update(system + input).digest('hex').slice(0, 16) };
  try {
    const r = await askAgent({ purpose, system, user: input, schema, maxTokens: 700, timeoutMs: TIMEOUT_MS, retries: 0 });
    if (r.stopReason !== 'end_turn') throw new Error(`stop_reason ${r.stopReason}`);
    const out = r.json;
    const tokens = { in: r.usage.input, out: r.usage.output };
    const ms = Math.round(performance.now() - t0);
    advisorStats.calls += 1; advisorStats.lastMs = ms; advisorStats.inputTokens += tokens.in; advisorStats.outputTokens += tokens.out;
    return { out, log: (used, note) => { if (used) advisorStats.used += 1; ledger.append('model', 'MODEL_CALL', { ...base, ms, tokens, output: out, usedByCode: used, note }, refs); } };
  } catch (err) {
    advisorStats.failed += 1;
    ledger.append('model', 'MODEL_CALL', { ...base, ms: Math.round(performance.now() - t0), error: String(err.message || err).slice(0, 140), usedByCode: false, note: 'malli ei vastannut ajoissa: jatkettiin säännöillä' }, refs);
    return null;
  }
}

const PICK_SYSTEM = `Olet Valio Aimon tukun ostoasiantuntija. Ammattikeittiön ostaja pyysi tuotetta, jota ei saada koko määrää. Saat alkuperäisen tuotteen, ostajan pyynnön ja listan korvaajavaihtoehtoja, jotka portti on jo tarkistanut: ne ovat saatavilla, hinnoiteltuja, ostajan sääntöjen mukaisia ja samaa allergeeniprofiilia.

Valitse vaihtoehto, joka palvelee ostajan käyttötarkoitusta parhaiten. Painota tässä järjestyksessä: sama tuotetyyppi ja koostumus (esimerkiksi rasvapitoisuus säilyy), sama pakkauskoko keittiön käytössä, toimitusvarmuus, hinta. Halvin ei ole automaattisesti paras, jos se muuttaa tuotetta.

Vastaa: optionId täsmälleen sellaisena kuin se on listassa, ja why: yksi suomenkielinen virke ostajalle, joka kertoo mikä säilyy ja mikä muuttuu. Älä mainitse hintoja tai määriä, joita syötteessä ei ole.`;
const PICK_SCHEMA = { type: 'object', additionalProperties: false, required: ['optionId', 'why'], properties: { optionId: { type: 'string' }, why: { type: 'string' } } };

/**
 * Järjestää korvaajavaihtoehdot: mallin valinta ensimmäiseksi SÄÄNTÖJEN SISÄLLÄ olevien joukosta.
 * Sääntöjen ulkopuolista vaihtoehtoa malli ei voi nostaa sisäpuolisen ohi.
 */
export async function pickSubstitute(options, { original, need, buyer, quoteId }) {
  const pool = options.filter((o) => o.substitution?.withinPolicy);
  if (pool.length < 2) return options; // ei valittavaa
  const facts = {
    pyynto: { maara: need.quantity, alkuperainen: original.name },
    vaihtoehdot: pool.map((o) => ({ optionId: o.optionId, korvaaja: o.substitution.byName, hintaero_pct: o.substitution.unitPriceDeltaPct, toimitusvarmuus: o.substitution.deliveryReliability, tarkistukset: o.substitution.checks, huomiot: o.substitution.warnings })),
  };
  const r = await ask('pick_substitute', PICK_SYSTEM, facts, PICK_SCHEMA, { buyerId: buyer.id, quoteId });
  if (!r) return options;
  const chosen = pool.find((o) => o.optionId === r.out.optionId);
  if (!chosen) { r.log(false, 'malli viittasi vaihtoehtoon, jota portti ei tarjonnut: hylätty'); return options; }
  chosen.substitution.modelNote = String(r.out.why).slice(0, 240);
  chosen.substitution.chosenBy = modelFor('fast');
  r.log(true, chosen === options[0] ? 'sama kuin sääntöjen järjestys' : 'malli vaihtoi järjestystä sääntöjen sisällä');
  return [chosen, ...options.filter((o) => o !== chosen)];
}

const EXPLAIN_SYSTEM = `Olet Valio Aimon tilausportin avustaja. Ostajan oma ostoagentti yritti tehdä tilauksen, ja portti pysäytti sen odottamaan ihmisen hyväksyntää. Kirjoitat hyväksyjälle (kiireinen hankinta- tai keittiöpäällikkö, lukee puhelimesta) lyhyen selityksen.

Saat tilauksen rivit, summan ja syyt koneluettavina koodeina lukuineen. Kirjoita suomeksi:
- summary: 1–2 virkettä. Mitä pyydettiin, miksi se pysähtyi (luvut mukaan) ja mitä hyväksyminen käytännössä tarkoittaa.
- suggestion: "approve", "reject" tai "review". approve vain, kun poikkeama on pieni ja selvä (esimerkiksi ylitys alle 5 % katosta tai päivän siirto yhdellä päivällä). review, kun määrä poikkeaa selvästi tavallisesta tai asia vaatii harkintaa.
- suggestionWhy: yksi lyhyt virke suosituksen perusteeksi.

Käytä vain syötteen lukuja ja tuotteita. Päätös on aina ihmisen: älä kirjoita, että tilaus on hyväksytty tai hylätty.`;
const EXPLAIN_SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'suggestion', 'suggestionWhy'], properties: { summary: { type: 'string' }, suggestion: { type: 'string', enum: ['approve', 'reject', 'review'] }, suggestionWhy: { type: 'string' } } };

/** Selitys hyväksyntänäkymään. Palauttaa {text, suggestion, suggestionWhy, model} tai null. */
export async function explainApproval(order, buyer) {
  const facts = {
    ostaja: buyer.name, pyynto: order.requestedBy || null, summa_alv0: order.totals?.net, toimitus: order.deliveryDate, pyydetty_toimitus: order.requestedDeliveryDate,
    rivit: (order.lines || []).map((l) => ({ tuote: l.name, maara: `${l.quantity} ${l.salesUnitLabel}`, summa: l.lineNet, korvaa: l.substituteFor || undefined })),
    syyt: (order.reasons || []).filter((r) => r.severity === 'approval').map((r) => ({ koodi: r.code, selite: r.message, luvut: r.detail })),
  };
  const r = await ask('explain_approval', EXPLAIN_SYSTEM, facts, EXPLAIN_SCHEMA, { buyerId: buyer.id, orderId: order.orderId });
  if (!r) return null;
  r.log(true, 'näytetään hyväksyjälle; päätös on ihmisen');
  return { text: String(r.out.summary).slice(0, 400), suggestion: r.out.suggestion, suggestionWhy: String(r.out.suggestionWhy).slice(0, 200), model: modelFor('fast') };
}
