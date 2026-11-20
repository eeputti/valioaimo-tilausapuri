// Ajastin Vercelissä pyörivälle WhatsApp-palvelimelle: kerran minuutissa POST /internal/tick.
// Vercelin ilmainen taso sallii vain päivittäisen ajastuksen, Cloudflaren ilmainen cron kerran minuutissa.
// Tick palauttaa keskeytyneet viestit jonoon, uusii epäonnistuneet lähetykset, liittää ilmoittautumiset ja välittää tilaukset.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const response = await fetch(env.TICK_URL, { method: 'POST', headers: { authorization: `Bearer ${env.TICK_SECRET}` }, signal: AbortSignal.timeout(280_000) });
      const body = await response.text();
      if (!response.ok) console.error(JSON.stringify({ event: 'tick_failed', status: response.status }));
      else console.log(JSON.stringify({ event: 'tick', result: body.slice(0, 300) }));
    })());
  },
  async fetch() { return new Response('Not found', { status: 404 }); },
};
