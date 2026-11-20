import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseEnv } from 'node:util';

const publisherFile = new URL('./.env.publisher', import.meta.url), deployFile = new URL('./.env.deploy', import.meta.url);
const existing = fs.existsSync(publisherFile) ? parseEnv(fs.readFileSync(publisherFile, 'utf8')) : {};
const target = process.argv[2] || existing.CLOUDFLARE_DEMO_URL;
const url = target ? new URL(target) : null;
if (url && (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')) throw new Error('Anna julkaistun sivuston HTTPS-juuriosoite.');
const token = existing.CLOUDFLARE_DEMO_SYNC_TOKEN || crypto.randomBytes(32).toString('base64url');
if (!/^[a-zA-Z0-9_-]{32,128}$/.test(token)) throw new Error('Olemassa oleva julkaisuavain pitää tarkistaa yksityisesti.');
fs.writeFileSync(publisherFile, `CLOUDFLARE_DEMO_URL=${url?.origin || ''}\nCLOUDFLARE_DEMO_SYNC_TOKEN=${token}\n`, { mode: 0o600 });
fs.writeFileSync(deployFile, `SYNC_TOKEN=${token}\n`, { mode: 0o600 });
fs.chmodSync(publisherFile, 0o600); fs.chmodSync(deployFile, 0o600);
console.log('Julkaisijan ja Workerin salaiset asetukset tallennettu Gitin ohittamiin tiedostoihin (0600). Avainta ei tulostettu.');
