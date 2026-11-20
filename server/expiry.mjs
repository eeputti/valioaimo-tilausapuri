// Vanhenevat asiat yhdellä listalla: WhatsAppin käyttöoikeustoken, Turson avain, demon hintojen ikäraja ja simuloitu kello.
// Funktiot ovat puhtaita, jotta testit voivat ajaa ne ilman verkkoa. Verkkohaut tekee scripts/expiry-check.mjs.

export const WARN_DAYS = 21;
const DAY = 86_400_000;

/** JWT:n vanhenemishetki millisekunteina, Infinity jos exp puuttuu, null jos token ei ole JWT. */
export function jwtExpiry(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object') return null;
    return Number.isFinite(claims.exp) ? claims.exp * 1000 : Infinity;
  } catch { return null; }
}

/** Metan debug_token-vastauksen data → vanhenemishetki (0 = ei vanhene). */
export function metaTokenExpiry(data) {
  if (!data || data.is_valid === false) return { expiresAt: null, valid: false };
  const at = Number(data.expires_at);
  return { expiresAt: at === 0 ? Infinity : Number.isFinite(at) ? at * 1000 : null, valid: true };
}

/**
 * Hetki, jolloin ensimmäinen tuote putoaa hintarajan yli (tuotteen uusimman hinnan mukaan), ja hetki, jolloin kaikki ovat yli.
 * fetchedAts: jokaisen tuotteen uusimman hinnan hakuhetki. maxAgeMs Infinity = ei rajaa.
 */
export function priceExpiry(fetchedAts, maxAgeMs) {
  const list = fetchedAts.filter(Number.isFinite);
  if (!list.length) return { first: null, all: null, products: 0 };
  if (!Number.isFinite(maxAgeMs)) return { first: Infinity, all: Infinity, products: list.length };
  return { first: Math.min(...list) + maxAgeMs, all: Math.max(...list) + maxAgeMs, products: list.length };
}

const status = (expiresAt, now, warnDays) => {
  if (expiresAt == null) return 'unknown';
  if (expiresAt === Infinity) return 'ok';
  if (expiresAt <= now) return 'expired';
  return expiresAt - now <= warnDays * DAY ? 'warn' : 'ok';
};

/**
 * Kokoaa raportin. Jokainen rivi: { key, label, expiresAt (ms, Infinity tai null), status, note }.
 * status: ok, warn (vanhenee warnDays päivän sisällä), expired tai unknown (ei saatu tarkistettua).
 */
export function assessExpiry({ now = Date.now(), warnDays = WARN_DAYS, whatsapp, turso, prices, demoNow } = {}) {
  const rows = [];
  if (whatsapp) {
    const s = whatsapp.valid === false ? 'expired' : status(whatsapp.expiresAt, now, warnDays);
    rows.push({ key: 'WHATSAPP_ACCESS_TOKEN', label: 'WhatsAppin käyttöoikeustoken', expiresAt: whatsapp.expiresAt, status: s,
      note: whatsapp.error ? `Tarkistus epäonnistui: ${whatsapp.error}` : whatsapp.expiresAt === Infinity ? ''
        : 'Uusi token: Meta Business Settings → System users → Generate new token, Token expiration: Never.' });
  }
  if (turso) rows.push({ key: 'TURSO_AUTH_TOKEN', label: 'Turson avain', expiresAt: turso.expiresAt, status: status(turso.expiresAt, now, warnDays),
    note: turso.expiresAt === Infinity ? '' : turso.expiresAt == null ? 'ei JWT-muotoinen' : 'Uusi avain: turso db tokens create (ilman --expiration).' });
  if (prices) {
    const s = prices.products ? status(prices.first, now, warnDays) : 'unknown';
    rows.push({ key: 'FALLBACK_PRICE_MAX_AGE_HOURS', label: `Demon hinnat (${prices.products} tuotetta)`, expiresAt: prices.first, status: s,
      note: !prices.products ? 'Välimuistissa ei ole hintoja.' : prices.first === Infinity ? 'FALLBACK_PRICE_MAX_AGE_HOURS=none'
        : `Hinnat hylätään (PRICE_TOO_OLD) ikärajan jälkeen; viimeinenkin ${fmt(prices.all)}. Aseta FALLBACK_PRICE_MAX_AGE_HOURS=none.` });
  }
  if (demoNow) rows.push({ key: 'DEMO_NOW', label: 'Simuloitu kello', expiresAt: null, status: 'warn', note: `DEMO_NOW=${demoNow}: päivämäärät eivät seuraa oikeaa aikaa.` });
  return rows;
}

export function fmt(ms) {
  if (ms === Infinity) return 'ei vanhene';
  if (!Number.isFinite(ms)) return 'tuntematon';
  return new Date(ms).toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
