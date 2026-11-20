// Valio Aimo Junction 2026 -rajapinnan asiakas: saatavuus + hinta.
// Periaatteet (challengen ohjeesta): kysytään vain rajatulle tuotejoukolle, eräajona (max 1000 / kutsu), ja tulokset välimuistiin.
// Ilman VALIO_API_KEY:tä vastaukset SIMULOIDAAN deterministisesti ja jokaiseen tulokseen jää merkintä source: 'sim'.
import { config, apiMode } from './config.mjs';
import { apiCache, kv, wipeApiCache } from './db.mjs';
import { loadCatalog } from './catalog.mjs';

const TTL = { avail: 5 * 60_000, price: 30 * 60_000 };
const mem = new Map(); // key -> {at, value}
export const apiStats = { calls: 0, ids: 0, cacheHits: 0, errors: 0, lastMs: null, lastError: null, staleServed: 0, lastKnownServed: 0 };

const cacheKey = (kind, date, id) => `${apiMode()}:${kind}:${date}:${id}`;

// checked: avaimet, jotka prefetch jo haki kannasta. Niitä ei kysytä uudelleen yksitellen.
function cacheRead(kind, date, id, { allowStale = false, forceStale = false, checked = null } = {}) {
  const key = cacheKey(kind, date, id);
  let hit = mem.get(key);
  if (!hit && !checked?.has(key)) {
    const row = apiCache.get(key);
    if (row) { hit = { at: row.fetchedAt, value: row.value }; mem.set(key, hit); }
  }
  if (!hit) return null;
  const fresh = Date.now() - hit.at < TTL[kind];
  if (fresh && !forceStale) return hit.value;
  // Rajapintavirheessä palautettava vanha arvo kertoo hakuhetkensä, jotta käyttäjä voi rajata sen iän (describePriceSource).
  return allowStale ? { ...hit.value, stale: true, fetchedAt: hit.at } : null;
}
// Välimuistin rivit yhdellä kyselyllä niille avaimille, joita muistissa ei ole. Pilvessä (Turso) jokainen kysely on oma
// verkkokierroksensa: päivän ensimmäinen haku luki ennen satoja rivejä yksitellen (docs/agent-v2/agentti.md, kohta Viive).
function prefetch(keys) {
  const missing = keys.filter((key) => !mem.has(key));
  if (missing.length) for (const [key, row] of apiCache.getMany(missing)) mem.set(key, { at: row.fetchedAt, value: row.value });
  return new Set(missing);
}
function cacheWrite(kind, date, id, value) {
  const key = cacheKey(kind, date, id);
  mem.set(key, { at: Date.now(), value });
  apiCache.set(key, value);
}

async function post(path, body) {
  const t0 = performance.now();
  const res = await fetch(`${config.valioBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': config.valioKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  apiStats.calls += 1;
  apiStats.ids += body.products.length;
  apiStats.lastMs = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`Valio API ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const day = (s) => (s ? String(s).slice(0, 10) : null);

function normAvailability(row, requestedDate) {
  const line = row.scheduleLines?.[0];
  const base = { closingTime: row.closingTime || null, model: row.logisticModel || null, source: 'live', fetchedAt: Date.now() };
  if (row.salesBlock || line?.salesBlock) return { ...base, status: 'blocked', amount: 0, date: null, unit: line?.salesUnit };
  if (!line) return { ...base, status: 'out', amount: 0, date: null }; // ei toimitettavissa millekään päivälle
  const amount = Number(line.availableAmount);
  const date = day(line.availableDate);
  const unknownQty = amount >= 999999; // Terminal-tuote: todellista määrää ei tiedetä
  if (!(amount > 0)) return { ...base, status: 'out', amount: 0, date, unit: line.salesUnit };
  if (date && date > requestedDate) return { ...base, status: 'late', amount: unknownQty ? null : amount, date, unit: line.salesUnit };
  return { ...base, status: 'ok', amount: unknownQty ? null : amount, date: date || requestedDate, unit: line.salesUnit };
}

function normPrice(row) {
  const base = { source: 'live', fetchedAt: Date.now() };
  if (row.error || !row.catalogPrice) return { ...base, error: true };
  const net = Number(row.catalogPrice.value);
  const list = row.listPrice ? Number(row.listPrice.value) : null;
  return {
    ...base,
    net,
    gross: Number(row.priceWithTax?.value ?? row.catalogPrice.valueWithTax),
    vatRate: row.tax ? Number(row.tax.taxRate) : null,
    list: list && list > net + 0.004 ? list : null,
    comparison: row.comparisonPrice ? Number(row.comparisonPrice.value) : null,
    comparisonUnit: row.comparisonUnit || null,
    validTo: row.catalogPrice.validTo || null,
    netPriceFound: !!row.netPriceFound,
  };
}

// ---------- Simulaattori (vain kun API-avainta ei ole) ----------
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
// Demotarinan kiinteät poikkeamat simulaatiotilassa, jotta polku on aina sama. Live-tilassa nämä tulevat oikeasta rajapinnasta.
const SIM_SCENARIO = { '465193': { status: 'out' }, '460131': { status: 'ok', amount: 6 }, '469126': { status: 'out' }, '460137': { status: 'ok', amount: 400 }, '464727': { status: 'ok', amount: 310 }, '464699': { status: 'ok', amount: 84 } };
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function simAvailability(id, date) {
  const r = hash(`a:${id}:${date}`);
  const terminal = hash(`m:${id}`) < 0.22;
  const base = { model: terminal ? 'Terminal' : 'Stock', closingTime: `${addDays(date, terminal ? -2 : -1)}T${terminal ? '10' : '12'}:00:00`, source: 'sim', fetchedAt: Date.now() };
  const forced = SIM_SCENARIO[id];
  if (forced) return { ...base, model: 'Stock', closingTime: `${addDays(date, -1)}T12:00:00`, status: forced.status, amount: forced.status === 'out' ? 0 : forced.amount, date: forced.status === 'out' ? null : date };
  const staple = (kv.get('staples', []) || []).some((s) => s.id === id); // demopolku pysyy samana: vakiotuotteista puuttuvat vain SIM_SCENARIO:n tuotteet
  if (!staple && r < 0.05) return { ...base, status: 'out', amount: 0, date: null };
  if (!staple && r < 0.08) return { ...base, status: 'late', amount: terminal ? null : 40, date: addDays(date, 2 + Math.floor(r * 100) % 4) };
  if (terminal) return { ...base, status: 'ok', amount: null, date };
  return { ...base, status: 'ok', amount: Math.round(30 + hash(`q:${id}:${date}`) * 900), date };
}
function simPrice(id) {
  const p = loadCatalog().get(id);
  const perKg = { ambient: [1.4, 9], chilled: [1.8, 16], frozen: [3, 14] }[p?.temp || 'ambient'];
  let comparison = +(perKg[0] + hash(`p:${p?.category}`) * (perKg[1] - perKg[0]) * (0.75 + hash(`pp:${id}`) * 0.5)).toFixed(2);
  if (/naudan|lohi|pekoni|juusto|emmental|voi /i.test(p?.name || '')) comparison = +(comparison * 1.6).toFixed(2);
  if (/peruna|sipuli|porkkana|jauho|sokeri/i.test(p?.name || '')) comparison = +(0.8 + hash(`v:${id}`) * 1.2).toFixed(2);
  const size = p?.kg || p?.litres || 1;
  const net = +(comparison * size).toFixed(2);
  const vatRate = p?.vat === 'STANDARD' ? 25.5 : p?.vat === 'LOW' ? 10 : 13.5;
  return { net, gross: +(net * (1 + vatRate / 100)).toFixed(2), vatRate, list: null, comparison, comparisonUnit: p?.litres && !p?.kg ? 'L' : 'KG', validTo: null, source: 'sim', fetchedAt: Date.now() };
}

// ---------- Viimeisin tunnettu arvo (VALIO_FALLBACK=last-known) ----------
// Haasteen testirajapinta voi sulkeutua tapahtuman jälkeen. Kaikkien tuotteiden hintoja ei saa hakea etukäteen
// (rajapinnan ohje: kysy vain tarvittavat tuotteet), joten varana käytetään vain niitä oikeita vastauksia,
// jotka botti on jo saanut tavallisessa käytössä. Kun rajapinta ei vastaa:
// - hinta on tuotteen viimeisin oikea hinta mille tahansa päivälle,
// - saatavuus on viimeisin tila, ja tilausaika lasketaan pyydetylle päivälle samalla toimitusajalla kuin viimeksi,
// - tuotteelle, jota ei ole koskaan kysytty, ei keksitä hintaa eikä saatavuutta.
// Arvoja ei kirjoiteta välimuistiin live-arvoina. Epäonnistumisen jälkeen rajapintaa ei kysytä 5 minuuttiin,
// jotta jokainen viesti ei odota aikakatkaisua.
const BREAKER_MS = 5 * 60_000;
let apiDownUntil = 0;
const fallbackOn = () => (process.env.VALIO_FALLBACK || '').trim() === 'last-known';
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
// Aikaleima 2026-11-15T17:00:00+0200 siirretään kokonaisina päivinä; kellonaika ja offset säilyvät.
const shiftStamp = (stamp, days) => (stamp && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? `${addDays(stamp.slice(0, 10), days)}${stamp.slice(10)}` : stamp || null);

export function lastKnownAvailability(id, date) {
  const row = apiCache.latest('live:avail', id);
  if (!row) return null;
  const { stale, ...v } = row.value;
  const askedFor = row.key.split(':')[2];
  const base = { ...v, source: 'last-known', fetchedAt: row.fetchedAt, lastKnownFor: askedFor };
  if (v.status === 'ok') {
    // Toimitetaan pyydettynä päivänä yhtä pitkällä tilausajalla kuin viimeisimmässä oikeassa vastauksessa.
    return { ...base, date, closingTime: shiftStamp(v.closingTime, dayDiff(date, v.date || askedFor)) };
  }
  if (v.status === 'late' && v.date) {
    const date2 = addDays(date, dayDiff(v.date, askedFor));
    return { ...base, date: date2, closingTime: shiftStamp(v.closingTime, dayDiff(date2, v.date)) };
  }
  return base; // out, blocked tai unknown: ei tilattavissa
}

// Tuotteet, joiden viimeisin oikea saatavuusvastaus oli "ok": niille viimeisin tunnettu arvo antaa toimituksen pyydettynä
// päivänä. Käytetään vain ehdokasjoukkona, kun pyydetyn tuotteen saatavuutta ei saada; varsinainen tilattavuus tarkistetaan
// tavallisella fetchQuotes-kutsulla. Lista luetaan yhdellä kyselyllä ja pidetään muistissa 5 minuuttia.
let okIds = { at: 0, ids: null };
export function lastKnownOkIds() {
  if (okIds.ids && Date.now() - okIds.at < 5 * 60_000) return okIds.ids;
  const ids = [];
  for (const [id, row] of apiCache.latestAll('live:avail')) if (row.value?.status === 'ok') ids.push(id);
  okIds = { at: Date.now(), ids };
  return ids;
}

export function lastKnownPrice(id) {
  const row = apiCache.latest('live:price', id);
  if (!row || row.value.error) return null;
  const { stale, ...v } = row.value;
  return { ...v, source: 'last-known', fetchedAt: row.fetchedAt };
}

function serveLastKnown(kind, date, id, note) {
  const v = kind === 'avail' ? lastKnownAvailability(id, date) : lastKnownPrice(id);
  if (v) { apiStats.lastKnownServed += 1; return v; }
  return kind === 'avail' ? { status: 'unknown', source: 'last-known', note: note || 'Tuotteesta ei ole aiempaa saatavuustietoa.' } : { error: true, source: 'last-known' };
}

// ---------- Hinnan alkuperä ja ikä ----------
// live = juuri haettu tai tuore välimuistiarvo, sim = simuloitu, stale = vanha välimuistiarvo rajapintavirheessä,
// last-known = VALIO_FALLBACK=last-known. Vain live ja sim ovat ajantasaisia. Muut kelpaavat tarjoukseen ja tilaukseen
// vain merkittyinä ja enintään FALLBACK_PRICE_MAX_AGE_HOURS tuntia vanhoina (oletus 72 h). Arvo "none" poistaa rajan: Valion
// testirajapinta suljettiin 17.11.2026, joten demon hinnat ovat pysyvästi viimeisimpiä tunnettuja eivätkä saa vanhentua.
export const fallbackPriceMaxAgeMs = () => {
  const raw = String(process.env.FALLBACK_PRICE_MAX_AGE_HOURS || '').trim().toLowerCase();
  if (raw === 'none') return Infinity;
  return (Number(raw) > 0 ? Number(raw) : 72) * 3600_000;
};
export function describePriceSource(price, now = Date.now()) {
  const origin = price?.source === 'sim' ? 'sim' : price?.source === 'last-known' ? 'last-known' : price?.stale ? 'stale' : 'live';
  const fetchedAt = Number.isFinite(price?.fetchedAt) ? price.fetchedAt : null;
  const current = origin === 'live' || origin === 'sim';
  const ageMs = fetchedAt == null ? null : Math.max(0, now - fetchedAt);
  return { origin, current, fetchedAt, ageMs, tooOld: !current && (ageMs == null || ageMs > fallbackPriceMaxAgeMs()) };
}
/** Usean rivin yhteinen alkuperä: heikoin ratkaisee (last-known > stale > sim > live). */
export function combinePriceSources(origins) {
  const set = new Set(origins.filter(Boolean));
  return ['last-known', 'stale', 'sim', 'live'].find((o) => set.has(o)) || null;
}

/** Testejä varten: unohtaa edellisen rajapintavirheen. */
export function resetApiBreaker() { apiDownUntil = 0; }

/**
 * Hakee saatavuuden ja hinnan annetuille tuotteille yhdellä kertaa (2 rinnakkaista kutsua / max 1000 tuotetta).
 * Palauttaa Map(id -> {avail, price}). Virhetilanteessa palautetaan vanha välimuistiarvo merkittynä stale: true
 * tai status 'unknown' — tuntematonta ei koskaan tulkita saatavilla olevaksi. Asetuksella VALIO_FALLBACK=last-known
 * virhetilanteessa käytetään tuotteen viimeisintä tunnettua oikeaa arvoa (ks. yllä).
 */
export async function fetchQuotes(ids, date, { fresh = false } = {}) {
  const unique = [...new Set(ids.map(String))];
  const out = new Map();
  const need = { avail: [], price: [] };
  // Kaikkien tuotteiden välimuistirivit yhdellä kyselyllä vasta tarvittaessa (fresh-tarkistus ohittaa välimuistin, kunnes
  // rajapinta ei vastaa). Sama joukko kelpaa myös virhepolun vanhoille arvoille.
  let checked = null;
  const prefetched = () => (checked ||= prefetch(unique.flatMap((id) => [cacheKey('avail', date, id), cacheKey('price', date, id)])));
  for (const id of unique) {
    const entry = {};
    for (const kind of ['avail', 'price']) {
      const hit = fresh ? null : cacheRead(kind, date, id, { checked: prefetched() });
      if (hit) { entry[kind] = hit; apiStats.cacheHits += 1; } else need[kind].push(id);
    }
    out.set(id, entry);
  }
  if (!need.avail.length && !need.price.length) return out;

  if (apiMode() === 'sim') {
    for (const id of need.avail) { const v = simAvailability(id, date); cacheWrite('avail', date, id, v); out.get(id).avail = v; }
    for (const id of need.price) { const v = simPrice(id); cacheWrite('price', date, id, v); out.get(id).price = v; }
    return out;
  }

  if (fallbackOn() && Date.now() < apiDownUntil) {
    for (const kind of ['avail', 'price']) for (const id of need[kind]) out.get(id)[kind] = serveLastKnown(kind, date, id);
    return out;
  }

  const chunks = (list) => { const res = []; for (let i = 0; i < list.length; i += 1000) res.push(list.slice(i, i + 1000)); return res; };
  const run = async (kind, path, normalize) => {
    await Promise.all(chunks(need[kind]).map(async (chunk) => {
      try {
        const json = await post(path, { customer: config.customer, requestedDate: date, products: chunk });
        const seen = new Set();
        for (const row of json.products || []) {
          const value = normalize(row, date);
          cacheWrite(kind, date, row.productId, value);
          if (out.has(row.productId)) out.get(row.productId)[kind] = value;
          seen.add(row.productId);
        }
        for (const id of chunk) if (!seen.has(id)) out.get(id)[kind] = kind === 'avail' ? { status: 'unknown', source: 'live', note: 'rajapinta ei palauttanut tuotetta' } : { error: true, source: 'live' };
      } catch (err) {
        apiStats.errors += 1;
        apiStats.lastError = String(err.message || err);
        if (fallbackOn()) {
          apiDownUntil = Date.now() + BREAKER_MS;
          for (const id of chunk) out.get(id)[kind] = serveLastKnown(kind, date, id);
          return;
        }
        for (const id of chunk) {
          // fresh=true (tilauksen tuore tarkistus): välimuistiarvo ei ole juuri nyt tarkistettu, vaikka se olisi TTL:n sisällä.
          const stale = cacheRead(kind, date, id, { allowStale: true, forceStale: fresh, checked: prefetched() });
          if (stale) apiStats.staleServed += 1;
          out.get(id)[kind] = stale || (kind === 'avail' ? { status: 'unknown', source: 'live', note: apiStats.lastError } : { error: true, source: 'live' });
        }
      }
    }));
  };
  await Promise.all([run('avail', '/api/availability', normAvailability), run('price', '/api/price', normPrice)]);
  return out;
}

export function clearApiCache() { mem.clear(); wipeApiCache(); }

export async function ping() {
  if (apiMode() === 'sim') return { ok: false, mode: 'sim' };
  try {
    const t0 = performance.now();
    const res = await fetch(`${config.valioBase}/api/ping`, { headers: { 'X-API-Key': config.valioKey }, signal: AbortSignal.timeout(6000) });
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0), mode: 'live' };
  } catch (err) { return { ok: false, mode: 'live', error: String(err.message || err) }; }
}
