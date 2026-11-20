// Allekirjoitetut tarjoukset: JWS (compact), alg EdDSA / Ed25519, julkinen avain osoitteessa /.well-known/jwks.json.
// Ostoagentti voi todentaa, että tarjous on portin antama eikä sitä ole muokattu; portti hylkää muokatun tarjouksen tilausvaiheessa.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../catalog.mjs';

const KEY_FILE = path.join(ROOT, 'data', 'gateway-ed25519.pem');
let keys;
function load() {
  if (keys) return keys;
  let privateKey;
  if (process.env.GATEWAY_PRIVATE_KEY_PEM) privateKey = crypto.createPrivateKey(process.env.GATEWAY_PRIVATE_KEY_PEM.replace(/\\n/g, '\n'));
  else if (fs.existsSync(KEY_FILE)) privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_FILE, 'utf8'));
  else {
    privateKey = crypto.generateKeyPairSync('ed25519').privateKey;
    fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest('base64url').slice(0, 16);
  keys = { privateKey, publicKey, jwk: { ...jwk, kid, use: 'sig', alg: 'EdDSA' }, kid };
  return keys;
}

const b64 = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');

export function signOffer(payload) {
  const { privateKey, kid } = load();
  const input = `${b64({ alg: 'EdDSA', typ: 'aimo-offer+jws', kid })}.${b64(payload)}`;
  return `${input}.${crypto.sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

/** @returns {{ok: true, payload: object} | {ok: false, code: string, detail: string}} */
export function verifyOffer(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) return { ok: false, code: 'OFFER_MALFORMED', detail: 'Tarjous ei ole JWS compact -muodossa' };
  let header; let payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return { ok: false, code: 'OFFER_MALFORMED', detail: 'Tarjouksen sisältöä ei voi lukea' }; }
  const { publicKey, kid } = load();
  if (header.alg !== 'EdDSA' || header.kid !== kid) return { ok: false, code: 'OFFER_INVALID_SIGNATURE', detail: 'Tuntematon avain tai algoritmi' };
  const valid = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
  if (!valid) return { ok: false, code: 'OFFER_INVALID_SIGNATURE', detail: 'Allekirjoitus ei täsmää: tarjousta on muokattu tai se ei ole tämän portin antama' };
  return { ok: true, payload };
}

export const jwks = () => ({ keys: [load().jwk] });
