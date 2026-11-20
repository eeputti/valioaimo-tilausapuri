// Kopioi botin korisivun (/whatsapp/cart) Toimitustukun tyylit ja ikonit Workers-sivustolle public/kori/-kansioon,
// jotta Ostoskori-välilehti näyttää saman kaupan korin myös tyhjänä ja botin ollessa tauolla.
// Aja, kun public/storefront*.css tai whatsapp-storefront-cart.css muuttuu: node deploy/cloudflare/sync-cart-shell.mjs
// Fontit ovat sivustolla jo /fonts/-kansiossa, joten niitä ei kopioida.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../public/', import.meta.url));
const OUT = fileURLToPath(new URL('./public/kori/', import.meta.url));
// Samat nimet kuin botin korisivulla (server/whatsapp/storefront-cart.mjs).
const STYLES = [['storefront.css', 'storefront.css'], ['storefront-cart.css', 'storefront-cart.css'], ['whatsapp-storefront-cart.css', 'shop.css']];
const FONTS = new Set(['Matter-Regular.otf', 'Matter-Bold.otf', 'National2Compressed-Bold.otf']);
const ASSET = /^(?:logo\.svg|icons\/[a-z0-9-]{1,40}\.svg)$/;

export function rewrite(css, used = new Set()) {
  return css.replace(/\/storefront-assets\/([A-Za-z0-9._/-]+)/g, (match, name) => {
    if (FONTS.has(name)) return `/fonts/${name}`;
    if (!ASSET.test(name)) throw new Error(`Tuntematon kaupan tiedosto tyylissä: ${name}`);
    used.add(name);
    return `/kori/${name}`;
  });
}

export function sync({ from = ROOT, to = OUT } = {}) {
  const used = new Set();
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.join(to, 'icons'), { recursive: true });
  for (const [source, target] of STYLES) {
    const css = rewrite(fs.readFileSync(path.join(from, source), 'utf8'), used);
    fs.writeFileSync(path.join(to, target), `/* Generoitu: deploy/cloudflare/sync-cart-shell.mjs kopioi public/${source}. Älä muokkaa käsin. */\n${css}`);
  }
  // Korikuoren oma HTML käyttää logoa ja otsakkeen ikoneita suoraan.
  for (const name of ['logo.svg', 'icons/shopping-cart.svg', 'icons/calendar-blank.svg']) used.add(name);
  for (const name of [...used].sort()) fs.copyFileSync(path.join(from, 'storefront-assets', name), path.join(to, name));
  return [...STYLES.map(([, target]) => target), ...[...used].sort()];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = sync();
  console.log(`Kopioitu ${files.length} tiedostoa: ${path.relative(process.cwd(), OUT)}`);
}
