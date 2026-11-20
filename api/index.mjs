// Vercel-funktio: kaikki pyynnöt ohjataan tänne (vercel.json). Toteutus on server/cloud.mjs:ssä.
import { waitUntil } from '@vercel/functions';
import { handle } from '../server/cloud.mjs';

export default async function handler(req, res) {
  // vercel.json kirjoittaa alkuperäisen polun ?path=-parametriin; palautetaan se ennen reititystä.
  try {
    const url = new URL(req.url, 'https://aimo.invalid');
    const original = url.searchParams.get('__path');
    if (url.pathname.startsWith('/api/index') && original != null) {
      url.searchParams.delete('__path');
      req.url = `/${original.replace(/^\/+/, '')}${url.search}`;
    }
    await handle(req, res, { waitUntil });
  } catch (err) {
    console.error('[cloud]', err);
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"Palvelinvirhe"}'); }
    else res.end();
  }
}
