// Demomaksu hyväksytty: pyydä bottia lähettämään asiakkaalle kiitosviesti WhatsAppiin (server/whatsapp/order-paid.mjs).
// Ajetaan ctx.waitUntilissa maksusivun vastauksen jälkeen. Botti lähettää viestin kerran tilausta kohden, joten
// uudelleenyritys ja tuplaklikkaus eivät tuplaa viestiä. Virhe ei koske maksua.
import { backend, type WebChatEnv } from "./web-chat.ts";

const ATTEMPTS = 2;
// Kaksi yritystä mahtuu waitUntilin noin 30 sekuntiin.
const TIMEOUT_MS = 12_000;

export async function notifyOrderPaid(env: WebChatEnv, orderId: string, fetchImpl: typeof fetch = fetch) {
  const origin = await backend(env).catch(() => null);
  if (!origin) return "no_backend";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(`${origin}/webchat/api/order-paid`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${env.WEBCHAT_SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
      if (response.ok) return "notified";
      // 4xx: botti hylkäsi pyynnön (esim. tuntematon tilaus); uusinta ei auta.
      if (response.status < 500) break;
    } catch { /* aikakatkaisu tai verkkovirhe: yritä vielä kerran */ }
  }
  // Ei osoitetta, salaisuutta eikä botin vastausta lokiin.
  console.error(JSON.stringify({ event: "order_paid_notice_failed", orderId }));
  return "failed";
}
