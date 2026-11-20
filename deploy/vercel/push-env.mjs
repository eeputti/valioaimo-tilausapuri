// Vie WhatsApp-palvelimen asetukset Vercel-projektin tuotantoympäristöön salaisina muuttujina.
// Lähteet: Macin .env, .env.whatsapp ja deploy/cloudflare/.env.publisher sekä pilven omat arvot
// deploy/vercel/.env.cloud-tiedostosta (Turso-osoitteet, Turso-avain, tick-salaisuus, julkinen osoite).
// Arvot kulkevat Vercelin komentorivityökalulle stdinin kautta, eivät komentoriville tai lokiin.
// Käyttö linkitetystä kansiosta (vercel link): node deploy/vercel/push-env.mjs [--dry-run] [--only=AVAIN,AVAIN]
// AIMO_ENV_ROOT: kansio, jossa .env-tiedostot ovat (oletus nykyinen). AIMO_CLOUD_ENV: pilven oma tiedosto
// (oletus <AIMO_ENV_ROOT>/deploy/vercel/.env.cloud), esim. testikantojen asetukset. Vercel-komento ajetaan nykyisessä kansiossa.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.env.AIMO_ENV_ROOT || process.cwd();
const cloudFile = process.env.AIMO_CLOUD_ENV || path.join(root, 'deploy/vercel/.env.cloud');
const read = (file) => {
  const values = new Map();
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
};

const values = new Map();
for (const name of ['.env', '.env.whatsapp', 'deploy/cloudflare/.env.publisher']) for (const [k, v] of read(path.join(root, name))) values.set(k, v);
if (!fs.existsSync(cloudFile)) { console.error(`Pilven asetustiedosto puuttuu: ${cloudFile}`); process.exit(1); }
const cloud = read(cloudFile);
for (const [k, v] of cloud) values.set(k, v);
// Paikallisen ajon asetuksia, joilla ei ole merkitystä pilvessä.
for (const key of ['PORT', 'WHATSAPP_PORT', 'WHATSAPP_ENABLED', 'AIMO_CATALOG']) values.delete(key);
values.set('WHATSAPP_ORDERING_ENABLED', 'true');
values.set('AIMO_LEARNED', '/tmp/aimo-learned.json');
values.set('NODEJS_HELPERS', '0');
if (!values.get('DEMO_NOW_ANCHOR') && values.get('DEMO_NOW')) values.set('DEMO_NOW_ANCHOR', new Date().toISOString());

// Ilman näitä pilvibotti ei käynnisty: WhatsApp-kanava ja demonumero, Valion rajapinta, allekirjoitus ja demomaksu,
// Turso-kannat ja malli.
const whatsappKeys = ['ACCESS_TOKEN', 'APP_SECRET', 'VERIFY_TOKEN', 'PHONE_NUMBER_ID', 'API_VERSION', 'SUPPORT_CONTACT', 'DEMO_PHONE', 'PUBLIC_URL'];
const required = [...whatsappKeys.map((suffix) => `WHATSAPP_${suffix}`), 'VALIO_API_KEY', 'VALIO_API_BASE',
  'GATEWAY_PRIVATE_KEY_PEM', 'CLOUDFLARE_DEMO_URL', 'CLOUDFLARE_DEMO_SYNC_TOKEN', 'TURSO_AUTH_TOKEN', 'TICK_SECRET',
  'WHATSAPP_DB', 'WHATSAPP_DRAFT_DB', 'WHATSAPP_QUOTE_DB', 'GATEWAY_DB', 'AIMO_DB', 'ANTHROPIC_API_KEY'];
const missing = required.filter((k) => !values.get(k));
// Julkinen osoite tulee pilven tiedostosta, ei Macin .env.whatsapp-tiedostosta (siellä on pikatunnelin osoite).
if (!/^https:\/\/[a-z0-9.-]+$/i.test(cloud.get('WHATSAPP_PUBLIC_URL') || '') || /trycloudflare\.com$/i.test(cloud.get('WHATSAPP_PUBLIC_URL')))
  missing.push('WHATSAPP_PUBLIC_URL (pilven HTTPS-alkuperä tiedostossa .env.cloud)');
if (missing.length) { console.error(`Puuttuvat asetukset: ${missing.join(', ')}`); process.exit(1); }
const notRemote = ['WHATSAPP_DB', 'WHATSAPP_DRAFT_DB', 'WHATSAPP_QUOTE_DB', 'GATEWAY_DB', 'AIMO_DB'].filter((k) => !/^libsql:\/\//.test(values.get(k)));
if (notRemote.length) { console.error(`Kannan pitää olla Turso-osoite (libsql://): ${notRemote.join(', ')}`); process.exit(1); }
const local = [...values].filter(([, v]) => /\/(Users|private|var\/folders)\//.test(v)).map(([k]) => k);
if (local.length) { console.error(`Macin paikallinen polku jäisi asetukseen: ${local.join(', ')}`); process.exit(1); }

const dryRun = process.argv.includes('--dry-run');
// --only A,B vie vain nimetyt asetukset (esim. uusi avain), muut jäävät Verceliin ennalleen.
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',').filter(Boolean)) : null;
if (only) for (const key of only) if (!values.has(key)) { console.error(`${key}: ei löydy asetustiedostoista.`); process.exit(1); }
for (const [key, value] of values) {
  if (only && !only.has(key)) continue;
  if (dryRun) { console.log(`${key} (${value.length} merkkiä)`); continue; }
  const result = spawnSync('npx', ['--yes', 'vercel@latest', 'env', 'add', key, '--environment', 'production', '--force', '--sensitive', '--yes'],
    { input: value, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
  if (result.status !== 0) { console.error(`${key}: epäonnistui. ${String(result.stderr).split('\n').filter(Boolean).slice(-2).join(' ')}`); process.exit(1); }
  console.log(`${key}: asetettu`);
}
