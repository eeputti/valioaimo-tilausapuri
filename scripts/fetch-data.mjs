// Lataa challenge-aineiston rajapinnasta kansioon data/raw (tarvitsee VALIO_API_KEY:n). Aja: npm run fetch-data && npm run catalog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const key = (process.env.VALIO_API_KEY || '').trim();
const base = (process.env.VALIO_API_BASE || 'https://junction26.valioaimo.fi').replace(/\/$/, '');
if (!key) { console.error('VALIO_API_KEY puuttuu (.env)'); process.exit(1); }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'raw');
fs.mkdirSync(dir, { recursive: true });
const files = { '/api/products/download': 'product_data.json', '/api/delivery-reliability/download': 'delivery_reliability.csv', '/api/carbon-footprint/download': 'carbon_footprint.csv' };
for (const [route, name] of Object.entries(files)) {
  const res = await fetch(base + route, { headers: { 'X-API-Key': key }, redirect: 'follow' });
  if (!res.ok) { console.error(`${route} → HTTP ${res.status}`); process.exit(1); }
  fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
  console.log(`${name}: ${(fs.statSync(path.join(dir, name)).size / 1e6).toFixed(1)} Mt`);
}
