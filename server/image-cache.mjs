// Shared disk cache: a running demo must also see images fetched by `npm run images`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Tuotekuva näytetään vain, kun se on Valion oma kuva juuri tästä tuotteesta (Eelis 15.11.: kaikki tuotetieto Valion datasta).
// Kelpaa: tuotenimen täsmäosuma valioaimo.fi:n tukkusivulle tai Valion omalle valio.fi-tuotesivulle. Ei kelpaa: toisen tuotteen
// kuva "lähin vastaava" -haulla eikä Open Food Factsin kuva. Vanhat merkinnät jäävät välimuistiin, mutta niitä ei näytetä.
export const VALIO_IMAGE_SOURCES = new Set(['valioaimo.fi', 'valio.fi']);
export const isValioProductImage = (entry) => !!entry?.file && VALIO_IMAGE_SOURCES.has(entry.source);
// Kopioidun vertailukorin kuvat (public/storefront-assets/sources.json): vain Valion omilta palvelimilta haetut.
const VALIO_ASSET_URL = /^https:\/\/(?:api\.valioaimo\.fi\/|imgfly\.scarabresearch\.com\/w_\d+\/https:\/\/api\.valioaimo\.fi\/|www\.valio\.fi\/|cdn-wp\.valio\.fi\/)/;
export const isValioAsset = (asset) => VALIO_ASSET_URL.test(String(asset?.source || ''));

export function imageCache(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '_meta.json');
  let meta = {}; let stamp = null;
  function refresh() {
    try {
      const s = fs.statSync(file);
      const next = `${s.ino}:${s.mtimeMs}:${s.size}`;
      if (next !== stamp) { meta = JSON.parse(fs.readFileSync(file, 'utf8')); stamp = next; }
    } catch { /* a new cache has no metadata yet */ }
  }
  return {
    get(id) { refresh(); return meta[id]; },
    put(id, value) {
      refresh();
      meta[id] = value;
      const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(meta));
      fs.renameSync(tmp, file);
      stamp = null;
      return value;
    },
  };
}
