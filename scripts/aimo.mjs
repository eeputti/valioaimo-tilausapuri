// Kokeile Aimo-mallia komentoriviltä:  npm run aimo -- "I need 1,000 litres of lactose-free milk by Monday"
import { interpret } from '../server/aimo/index.mjs';

const text = process.argv.slice(2).join(' ');
if (!text) { console.error('Käyttö: npm run aimo -- "<ostopyyntö suomeksi tai englanniksi>"'); process.exit(1); }
await interpret('lämmitys'); // sanaston lataus pois mittauksesta
const r = await interpret(text);
console.log(`\n${r.summary}`);
console.log(`tulkinta: ${r.trace.via}, varmuus ${r.trace.confidence}, ${r.trace.llmCalls} mallikutsua, ${r.trace.ms} ms`);
for (const a of r.understood.assumptions) console.log(`  oletus: ${a.fi}`);
if (r.handoff) console.log(`  → ${r.handoff.fi}`);
r.cards.forEach((c, i) => {
  const it = r.understood.items[i];
  console.log(`\nRivi ${i + 1}: ${it.productTerm}${it.quantity ? `, ${it.quantity.value} ${it.quantity.unit}` : ''}${it.claims.length ? `, ${it.claims.join(', ')}` : ''}`);
  console.log(`  rajaus: ${c.funnel.map((f) => `${f.filter} → ${f.remaining}`).join(', ')}`);
  for (const p of c.top) console.log(`  ${p.id}  ${p.name}`);
  if (c.chips.length) console.log(`  napit: ${c.chips.map((x) => `[${x.label}]`).join(' ')}`);
});
if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
else if (r.gateway.requestQuote) console.log(`\nPortille (request_quote): ${JSON.stringify({ ...r.gateway.requestQuote, needs: r.gateway.requestQuote.needs.map((n) => ({ ...n, candidates: `${n.candidates.length} tuotekoodia` })) })}`);
