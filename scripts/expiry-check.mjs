// Tarkistaa vanhenevat avaimet ja demon hinnat. Ajo: npm run expiry:check (pilven kannat .env.cloud-tiedostolla).
// Verkko: Metan debug_token (token lähtee vain Metalle) ja AIMO_DB:n luku. Mitään ei kirjoiteta, salaisuuksia ei tulosteta.
// Poistumiskoodi 1, jos jokin on vanhentunut tai vanhenee WARN_DAYS päivän sisällä.
import { assessExpiry, jwtExpiry, metaTokenExpiry, priceExpiry, fmt, WARN_DAYS } from '../server/expiry.mjs';

const env = process.env;
const whatsapp = await (async () => {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const version = env.WHATSAPP_API_VERSION || 'v25.0';
    const url = `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (!res.ok) return { expiresAt: null, error: json?.error?.message || `HTTP ${res.status}` };
    return metaTokenExpiry(json.data);
  } catch (err) { return { expiresAt: null, error: err.message }; }
})();
const turso = env.TURSO_AUTH_TOKEN ? { expiresAt: jwtExpiry(env.TURSO_AUTH_TOKEN) } : null;
const prices = await (async () => {
  if ((env.VALIO_FALLBACK || '').trim() !== 'last-known') return null;
  const { apiCache } = await import('../server/db.mjs');
  const { fallbackPriceMaxAgeMs } = await import('../server/valioApi.mjs');
  const latest = [...apiCache.latestAll('live:price').values()].filter((r) => !r.value?.error).map((r) => r.fetchedAt);
  return priceExpiry(latest, fallbackPriceMaxAgeMs());
})();

const rows = assessExpiry({ whatsapp, turso, prices, demoNow: (env.DEMO_NOW || '').trim() || null });
const mark = { ok: 'OK  ', warn: 'HUOM', expired: 'VANH', unknown: '??  ' };
console.log(`Kanta: ${env.AIMO_DB || 'data/aimo.db (paikallinen)'}`);
for (const r of rows) console.log(`${mark[r.status]} ${r.label}: ${fmt(r.expiresAt)}${r.note ? ` — ${r.note}` : ''}`);
const bad = rows.filter((r) => r.status !== 'ok');
if (bad.length) { console.log(`\n${bad.length} kohtaa vaatii toimia (raja ${WARN_DAYS} päivää).`); process.exitCode = 1; }
else console.log('\nKaikki kunnossa.');
