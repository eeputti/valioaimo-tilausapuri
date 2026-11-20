// Synthetic customers. The customer model may vary wording, never these goals.
export const SELFPLAY_CASES = [
  { id: 'eggs', first: 'moi! tarvittais 50 kananmunaa maanantaiks, ihan tavallisii',
    brief: 'Tarvitset 50 tavallista kananmunaa maanantaiksi 16.11.2026. Ei muita tuotteita tai ruokavaatimuksia. Valitse ensimmäinen sopiva tavallinen vaihtoehto ja pyydä sitten korilinkki. Jos apuri kysyy kananmunista laktoosittomuutta tai gluteenittomuutta, huomauta että kysymys on outo. Älä muuta tilausta sen vuoksi.',
    expected: { kananmuna: { value: 50, unit: 'PCS' } }, noIrrelevantDiet: true, date: '2026-11-16', maxTurns: 5 },
  { id: 'mixed', first: 'maitoo 50 litraa, kananmunii ja kermaa maanantaille',
    brief: 'Kokoa maito, kananmunat ja kerma maanantaille 16.11.2026. Täydennä kysyttäessä kananmunat 50 kappaleeksi ja kerma 5 desilitraksi. Korjaa myöhemmin maidon määrä 30 litraan (ensimmäinen oli 50). Tavallinen maito käy, ei erityisruokavalioita. Valitse ensimmäiset sopivat tuotteet ja pyydä ostoskori, kun määrät ovat oikein. Kaikki kolme tuotetta on säilytettävä.',
    expected: { maito: { value: 30, unit: 'L' }, kananmuna: { value: 50, unit: 'PCS' }, kerma: { value: 0.5, unit: 'L' } }, date: '2026-11-16', maxTurns: 7 },
  { id: 'correction', first: '20 l maitoa ja 5 l kermaa maanantaiksi, molemmat laktoosittomina',
    brief: 'Tarvitset laktoositonta maitoa ja kermaa maanantaille 16.11.2026. Ensimmäisessä pyynnössä maitoa oli 20 l ja kermaa 5 l. Korjaa kerman määrä seuraavassa omassa viestissäsi 5 desilitraksi. Kysy myös, miksi tuotevaihtoehtoja pitää valita. Sen jälkeen valitse sopivat vaihtoehdot ja pyydä kori. Maitoa ei saa muuttaa tai poistaa.',
    expected: { maito: { value: 20, unit: 'L' }, kerma: { value: 0.5, unit: 'L' } }, requiredClaim: 'FREE_FROM_LACTOSE', date: '2026-11-16', maxTurns: 6 },
  { id: 'remove', first: '5 kg voita ja 10 l maitoa maanantaiks',
    brief: 'Aluksi pyydät 5 kg voita ja 10 l maitoa maanantaille 16.11.2026. Seuraavassa viestissä poista maito ja muuta voi 3 kiloksi. Tavallinen suolattu voi käy, ei muita rajoitteita. Voin pitää jäädä samalle päivälle. Valitse sopiva vaihtoehto ja pyydä kori. Voit ihmetellä turhia lisäkysymyksiä.',
    expected: { voi: { value: 3, unit: 'KG' } }, absent: ['maito'], date: '2026-11-16', maxTurns: 5 },
  { id: 'advice', first: 'moi, mikä kerma sopis lohikeittoon?',
    brief: 'Kysyt ensin vain vinkkiä lohikeiton kermaan. Älä tilaa vielä ensimmäisessä kysymyksessä. Kun olet saanut vastauksen, pyydä 2 l sopivaa ruokakermaa maanantaiksi 16.11.2026; laktoositon käy. Valitse sopiva ruokakerma ja pyydä kori. Älä lisää muita lohikeiton aineksia, vaikka apuri ehdottaisi.',
    expected: { kerma: { value: 2, unit: 'L' } }, adviceFirst: true, date: '2026-11-16', maxTurns: 6 },
];

export function inspectConversation(scenario, turns, list) {
  const failures = [];
  if (scenario.noIrrelevantDiet && turns.some((t) => /(?:laktoosi|gluteeni|pähkinä)/iu.test(t.assistant))) failures.push('irrelevant_diet_question');
  if (scenario.adviceFirst && turns[0]?.list?.lines?.length) failures.push('advice_added_item_without_request');
  for (const [term, wanted] of Object.entries(scenario.expected)) {
    const line = list?.lines?.find((l) => l.productTerm.toLowerCase().includes(term));
    if (!line) failures.push(`missing:${term}`);
    else if (line.quantity?.value !== wanted.value || line.quantity?.unit !== wanted.unit) failures.push(`quantity:${term}`);
    if (line && scenario.requiredClaim && !line.claims.includes(scenario.requiredClaim) && !list.diet.claims.includes(scenario.requiredClaim)) failures.push(`claim:${term}`);
  }
  for (const term of scenario.absent || []) if (list?.lines?.some((l) => l.productTerm.toLowerCase().includes(term))) failures.push(`unremoved:${term}`);
  if (list?.deliveryDate !== scenario.date) failures.push('delivery_date');
  if (!turns.some((t) => t.assistant.includes('[ostoskorilinkki]'))) failures.push('cart_link_missing');
  const allowed = Object.keys(scenario.expected);
  for (const line of list?.lines || []) if (!allowed.some((term) => line.productTerm.toLowerCase().includes(term))) failures.push(`unexpected:${line.productTerm}`);
  return [...new Set(failures)];
}
