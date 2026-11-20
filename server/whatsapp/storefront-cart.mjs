// Toimitustukun näköinen sivu WhatsAppin korilinkille. Tämä moduuli tarjoilee vain staattiset
// tiedostot: korin tiedot ja muutokset kulkevat edelleen cart-link.mjs:n rajatun, allekirjoitetun
// API:n kautta samaan palvelimen luonnokseen. Koko kauppaa tai sen reittejä ei avata tunneliin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValioAsset, isValioProductImage } from '../image-cache.mjs';

const PAGE = '/whatsapp/cart';
const ASSETS = `${PAGE}/assets/`;
const IMAGES = `${PAGE}/img/`;
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const DATA_IMAGES = fileURLToPath(new URL('../../data/img/', import.meta.url));
// Kaupan tyylit viittaavat /storefront-assets/-polkuun, jota tunneli ei päästä läpi.
const rewrite = (css) => css.replaceAll('/storefront-assets/', ASSETS);
const files = new Map([
  [PAGE, ['whatsapp-storefront-cart.html', 'text/html; charset=utf-8']],
  [`${PAGE}/shop.js`, ['whatsapp-storefront-cart.js', 'text/javascript; charset=utf-8']],
  [`${PAGE}/shop.css`, ['whatsapp-storefront-cart.css', 'text/css; charset=utf-8', rewrite]],
  [`${PAGE}/storefront.css`, ['storefront.css', 'text/css; charset=utf-8', rewrite]],
  [`${PAGE}/storefront-cart.css`, ['storefront-cart.css', 'text/css; charset=utf-8', rewrite]],
]);
const fonts = new Set(['Matter-Regular.otf', 'Matter-Bold.otf', 'National2Compressed-Bold.otf']);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const headers = {
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

export function createStorefrontCartPage({ publicDir = PUBLIC, imageDir = DATA_IMAGES } = {}) {
  const assetsDir = path.join(publicDir, 'storefront-assets');
  let references; let meta = {}; let stamp = null;
  // Kuvat vain levyltä: tunnelin kautta tuleva pyyntö ei käynnistä ulkoisia kuvahakuja.
  function image(id) {
    if (!/^\w{1,20}$/.test(id)) return null;
    if (!references) {
      references = new Map();
      try {
        for (const a of JSON.parse(fs.readFileSync(path.join(assetsDir, 'sources.json'), 'utf8')).assets || []) {
          const productId = (a.derivedFrom || a.file).match(/^(\w+)\.(?:jpg|png|webp)$/)?.[1];
          if (productId && imageTypes.has(a.mime) && isValioAsset(a) && (!references.has(productId) || a.derivedFrom)) references.set(productId, { dir: assetsDir, file: a.file, type: a.mime });
        }
      } catch { /* no reference images in this installation */ }
    }
    try {
      const s = fs.statSync(path.join(imageDir, '_meta.json')); const next = `${s.ino}:${s.mtimeMs}:${s.size}`;
      if (next !== stamp) { meta = JSON.parse(fs.readFileSync(path.join(imageDir, '_meta.json'), 'utf8')); stamp = next; }
    } catch { /* empty cache */ }
    const hit = meta[id];
    // Vain Valion oma kuva samasta tuotteesta. Toisen tuotteen tai Open Food Factsin kuvan tilalla näkyy paikkamerkki.
    const found = references.get(id) || (isValioProductImage(hit) && { dir: imageDir, file: hit.file, type: hit.type });
    if (!found || !/^(?:optimized\/)?\w[\w.-]{0,80}$/.test(found.file) || found.file.includes('..') || !imageTypes.has(found.type)) return null;
    const file = path.join(found.dir, found.file);
    return fs.existsSync(file) ? { file, type: found.type } : null;
  }
  function asset(name) {
    if (fonts.has(name)) return { file: path.join(assetsDir, name), type: 'font/otf' };
    if (name === 'logo.svg' || /^icons\/[a-z0-9-]{1,40}\.svg$/.test(name)) return { file: path.join(assetsDir, name), type: 'image/svg+xml' };
    return null;
  }
  return {
    handle(req, res, url) {
      const page = files.get(url.pathname);
      const target = page ? null : url.pathname.startsWith(ASSETS) ? asset(url.pathname.slice(ASSETS.length))
        : url.pathname.startsWith(IMAGES) ? image(url.pathname.slice(IMAGES.length)) || 'missing' : undefined;
      if (!page && target === undefined) return false;
      if (req.method !== 'GET') { res.writeHead(405, { ...headers, allow: 'GET' }); res.end(); return true; }
      if (page) {
        const [file, type, transform] = page;
        const raw = fs.readFileSync(path.join(publicDir, file), transform ? 'utf8' : undefined);
        res.writeHead(200, { ...headers, 'content-type': type, 'cache-control': 'no-store' });
        res.end(transform ? transform(raw) : raw); return true;
      }
      if (!target || target === 'missing' || !fs.existsSync(target.file)) {
        res.writeHead(404, { ...headers, 'cache-control': 'no-store' }); res.end(); return true;
      }
      res.writeHead(200, { ...headers, 'content-type': target.type, 'cache-control': 'public, max-age=3600' });
      res.end(fs.readFileSync(target.file)); return true;
    },
  };
}
