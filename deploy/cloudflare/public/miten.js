// Näin se toimii: esimerkkitilauksen agenttiajo koodina. Sama data kuin /agentti#esimerkki.
import { mountTraceCode } from './agent-code.js';
const $ = (id) => document.getElementById(id);

async function load() {
  try {
    const response = await fetch('/api/agent-traces/esimerkki', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.trace) throw new Error(data.error || 'Esimerkkiä ei voitu avata.');
    mountTraceCode({ figure: $('code'), file: $('code-file'), list: $('code-lines'), state: $('code-state'), replay: $('code-replay') }, data.trace);
    $('status').hidden = true;
  } catch (error) {
    $('status').textContent = error.name === 'TimeoutError' ? 'Esimerkki ei latautunut ajoissa. Kokeile itse Keskustele-sivulla.' : `${error.message} Kokeile itse Keskustele-sivulla.`;
  }
}
void load();
