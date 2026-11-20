// Public page reader. DNS is checked at every redirect and the HTTPS socket uses that
// exact address, so a second DNS lookup cannot redirect the request into the LAN.
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix);
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6');
const failure = (code) => Object.assign(new Error(code), { code });

export function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function pageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('LINK_URL'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !host.includes('.') && !isIP(host) || /(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/i.test(host)
    || (isIP(host) && !publicAddress(host)) || value.length > 2000) throw failure('LINK_URL');
  url.hash = '';
  return url;
}

export function messageLinks(text) {
  const found = String(text || '').match(/(?:https?:\/\/|www\.)[^\s<>"\u0000-\u001f]+/giu) || [];
  return [...new Set(found.map((s) => s.replace(/[.,!?;:]+$/u, '').replace(/[)\]}]+$/u, ''))
    .map((s) => s.startsWith('www.') ? `https://${s}` : s))];
}

function abortable(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure('LINK_TIMEOUT'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// No cookies, credentials, shared connection pool, JavaScript or automatic redirects.
export function requestPage(url, { address, family, signal, maxBytes }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', agent: false, signal,
      headers: { accept: 'text/html,application/xhtml+xml,text/plain', 'accept-encoding': 'identity', 'user-agent': 'Aimo-LinkReader/1.0' },
      lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family }]) : callback(null, address, family),
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        resolve({ status: res.statusCode, location: res.headers.location }); res.destroy(); return;
      }
      // Bottisuoja tai kirjautuminen (Cloudflaren haaste, 401/403/429): sivua ei yritetä kiertää, asiakkaalta pyydetään kopio.
      if ([401, 403, 429].includes(res.statusCode) || res.headers['cf-mitigated']) { reject(failure('LINK_BLOCKED')); res.destroy(); return; }
      const type = String(res.headers['content-type'] || '');
      if (res.statusCode !== 200 || !/^(?:text\/(?:html|plain)|application\/xhtml\+xml)\b/i.test(type)
        || !['', 'identity'].includes(String(res.headers['content-encoding'] || '').toLowerCase())) {
        reject(failure('LINK_CONTENT')); res.destroy(); return;
      }
      if (Number(res.headers['content-length']) > maxBytes) { reject(failure('LINK_SIZE')); res.destroy(); return; }
      const chunks = []; let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { reject(failure('LINK_SIZE')); res.destroy(); } else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: 200, type, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', aring: 'å', Aring: 'Å', frac12: '1/2', frac14: '1/4', frac34: '3/4' };
export const decodeEntities = (s) => String(s).replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, key) => {
  if (key[0] !== '#') return entities[key] ?? all;
  const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
});
// Linear-time HTML scanning. The former lazy regexes rescanned the rest of the page from every
// unclosed tag, comment or element, so a single 1 MB page could block the event loop for minutes.
// These helpers keep the same matches: the first closing tag after the first `>` of the opener.
const asciiLower = (s) => s.replace(/[A-Z]+/g, (c) => c.toLowerCase()); // Same length, same indexes.

/** Start and end of the first `</name\s*>` for any of `names` at or after `from`, or null. */
function closingTag(lower, names, from) {
  let best = null;
  for (const name of names) {
    const needle = `</${name}`;
    for (let i = lower.indexOf(needle, from); i !== -1 && (!best || i < best[0]); i = lower.indexOf(needle, i + needle.length)) {
      let j = i + needle.length;
      while (j < lower.length && /\s/.test(lower[j])) j++;
      if (lower[j] === '>') { best = [i, j + 1]; break; }
    }
  }
  return best;
}

/** Inner content of the first named element that has a closing tag, or null. */
function firstElement(html, names) {
  const lower = asciiLower(html);
  const opener = new RegExp(`<(?:${names.join('|')})\\b`, 'g');
  const m = opener.exec(lower);
  const tagEnd = m ? lower.indexOf('>', opener.lastIndex) : -1;
  // A later opener ends at or after this `>`, so it cannot have a closing tag either.
  const end = tagEnd === -1 ? null : closingTag(lower, names, tagEnd + 1);
  return end ? html.slice(tagEnd + 1, end[0]) : null;
}

function withoutTags(s) {
  const out = []; let last = 0;
  for (let i = s.indexOf('<'); i !== -1; i = s.indexOf('<', last)) {
    const end = s.indexOf('>', i + 1);
    if (end === -1) break;
    out.push(s.slice(last, i), ' '); last = end + 1;
  }
  out.push(s.slice(last));
  return out.join('');
}

function withoutComments(s) {
  const out = []; let last = 0;
  for (let i = s.indexOf('<!--'); i !== -1; i = s.indexOf('<!--', last)) {
    const end = s.indexOf('-->', i + 4);
    if (end === -1) break;
    out.push(s.slice(last, i), ' '); last = end + 3;
  }
  out.push(s.slice(last));
  return out.join('');
}

const NOISE = ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form'];
function withoutNoise(html) {
  html = withoutComments(html);
  const lower = asciiLower(html);
  const opener = new RegExp(`<(${NOISE.join('|')})\\b`, 'g');
  const unclosed = new Set(), out = []; let last = 0;
  for (let m; (m = opener.exec(lower));) {
    if (unclosed.has(m[1])) continue;
    const tagEnd = lower.indexOf('>', opener.lastIndex);
    if (tagEnd === -1) break;
    const end = closingTag(lower, [m[1]], tagEnd + 1);
    if (!end) { unclosed.add(m[1]); continue; } // Kept as text, like the regex did.
    out.push(html.slice(last, m.index), ' ');
    last = opener.lastIndex = end[1];
  }
  out.push(html.slice(last));
  return out.join('');
}

function structuredData(html) {
  const lower = asciiLower(html), blocks = [];
  const opener = /<script\b/g;
  for (let m; (m = opener.exec(lower));) {
    const tagEnd = lower.indexOf('>', opener.lastIndex);
    const end = tagEnd === -1 ? null : closingTag(lower, ['script'], tagEnd + 1);
    if (!end) break;
    if (/type\s*=\s*["']application\/ld\+json["']/.test(lower.slice(m.index, tagEnd))) blocks.push(html.slice(tagEnd + 1, end[0]));
    opener.lastIndex = end[1];
  }
  return blocks;
}

const plain = (s) => decodeEntities(withoutTags(String(s))).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/\s+/gu, ' ').trim();

export function extractPage(body, type = 'text/html') {
  let charset = type.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset).decode(body); } catch { charset = 'utf-8'; html = new TextDecoder(charset).decode(body); }
  if (/^text\/plain\b/i.test(type)) return { title: '', text: plain(html).slice(0, 18000), recipes: [] };
  const title = plain(firstElement(html, ['title']) || '').slice(0, 180);
  const recipes = [];
  const visit = (node, depth = 0) => {
    if (!node || depth > 12 || recipes.length >= 4) return;
    if (Array.isArray(node)) { node.slice(0, 100).forEach((n) => visit(n, depth + 1)); return; }
    if (typeof node !== 'object') return;
    if ([node['@type']].flat().some((t) => /(?:^|\/)Recipe$/.test(t))) {
      recipes.push({ name: plain(node.name || '').slice(0, 180), yield: plain([node.recipeYield].flat().filter((v) => typeof v === 'string' || typeof v === 'number').join(', ')).slice(0, 120),
        ingredients: [node.recipeIngredient].flat().filter((v) => typeof v === 'string').slice(0, 40).map((v) => plain(v).slice(0, 240)) });
    }
    Object.values(node).slice(0, 100).forEach((n) => visit(n, depth + 1));
  };
  for (const block of structuredData(html)) {
    try { visit(JSON.parse(block)); } catch { /* Invalid structured data is ignored. */ }
  }
  const content = withoutNoise(html);
  const main = firstElement(content, ['main', 'article']) || content;
  return { title, text: plain(main).slice(0, 18000), recipes };
}

// Isot reseptisivut (arla.fi noin 1,25 Mt) mahtuvat. Jäsennys on lineaarinen, joten 3 Mt ei jumita palvelinta.
export function createPageReader({ resolve = lookup, request = requestPage, timeoutMs = 12000, maxBytes = 3_000_000 } = {}) {
  return async function readPage(value) {
    const signal = AbortSignal.timeout(timeoutMs);
    let url = pageUrl(value);
    for (let hop = 0; hop <= 3; hop++) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(resolve(host, { all: true, verbatim: true }), signal);
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw failure('LINK_ADDRESS');
      const response = await abortable(request(url, { ...addresses[0], signal, maxBytes }), signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || hop === 3) throw failure('LINK_REDIRECT');
        url = pageUrl(new URL(response.location, url).href); continue;
      }
      if ([401, 403, 429].includes(response.status)) throw failure('LINK_BLOCKED');
      if (response.status !== 200 || !response.body || response.body.length > maxBytes) throw failure('LINK_CONTENT');
      const page = extractPage(response.body, response.type);
      if (page.text.length < 30 && !page.recipes.some((r) => r.ingredients.length)) throw failure('LINK_EMPTY');
      return { url: url.href, ...page };
    }
    throw failure('LINK_REDIRECT');
  };
}

export const readPublicPage = createPageReader();

/** Sivun nimi osoitteesta, kun sivua ei päästä lukemaan: /reseptit/kermainen-kanapasta -> Kermainen kanapasta. */
export function pageNameFromUrl(value) {
  let url; try { url = new URL(value); } catch { return { site: '', name: '' }; }
  const site = url.hostname.replace(/^www\./i, '');
  const segment = url.pathname.split('/').filter(Boolean).at(-1) || '';
  let words = '';
  try { words = decodeURIComponent(segment); } catch { words = segment; }
  words = words.replace(/\.(?:html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  const name = /^[\p{L}][\p{L} ]{2,79}$/u.test(words) ? words[0].toLocaleUpperCase('fi-FI') + words.slice(1) : '';
  return { site, name };
}
