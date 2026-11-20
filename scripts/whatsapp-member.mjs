// Ylläpitäjän komento WhatsApp-jäsenille. Ajetaan koneella, joka pääsee WhatsApp-kantaan: julkista
// ilmoittautumis- tai ylläpitoreittiä ei ole.
// Tuotannon kanta: ks. docs/demo-onboarding.md (deploy/vercel/.env.cloud viimeisenä env-tiedostona).
import { openWhatsAppStore, codeHash, phoneNumber } from '../server/whatsapp/store.mjs';
import { whatsappDbPath } from '../server/whatsapp/runtime.mjs';
import { isRemoteDatabase } from '../server/sqlite.mjs';
import { WEB_CHAT_PHONE } from '../server/whatsapp/web-chat.mjs';
import { WEB_DEMO_PHONE } from '../server/whatsapp/web-demo.mjs';

const USAGE = [
  'Käyttö: npm run whatsapp:member -- invite --phone +358401234567 --company "Ravintola A" --person "Anna"',
  '       npm run whatsapp:member -- link --phone +358401234567 --company "Ravintola A" --person "Anna"',
  '       npm run whatsapp:member -- revoke --phone +358401234567',
  '       npm run whatsapp:member -- list',
].join('\n');
const PERSON_FLAGS = ['--phone', '--company', '--person'];
const FLAGS = { invite: PERSON_FLAGS, link: PERSON_FLAGS, revoke: ['--phone'], list: [] };
const META_NOTE = 'Botti vastaa vain numeroihin, jotka on vahvistettu Metan vastaanottajalistalla';

// Numero näkyy listassa vain alusta ja lopusta, jotta lista ei vuoda numeroita näytönjaossa.
const maskPhone = (phone) => `+${String(phone).slice(0, 3)}…${String(phone).slice(-4)}`;

function target(filename) {
  if (!isRemoteDatabase(filename)) return `paikallinen tiedosto ${filename}`;
  try { return `etäkanta ${new URL(filename).host}`; } catch { return 'etäkanta'; }
}

// Komento ja sen valinnat pareittain. Tuntematon, toistuva tai puuttuva valinta tulostaa käyttöohjeen.
function parseCommand(argv) {
  const [command, ...rest] = argv;
  const allowed = Object.hasOwn(FLAGS, command) ? FLAGS[command] : null;
  if (!allowed || rest.length % 2 !== 0) throw new Error(USAGE);
  const options = {};
  while (rest.length) {
    const [flag, value] = rest.splice(0, 2);
    if (!allowed.includes(flag) || Object.hasOwn(options, flag)) throw new Error(USAGE);
    options[flag] = value;
  }
  if (!allowed.every((flag) => Object.hasOwn(options, flag))) throw new Error(USAGE);
  return { command, options };
}

const actions = {
  invite(store, options) {
    const { code } = store.invite(options['--phone'], options['--company'], options['--person']);
    console.log('Anna koodi vain kutsutulle henkilölle luotettavaa kanavaa pitkin. Voimassa 10 minuuttia.');
    console.log(`Lähetä agentin WhatsApp-numeroon: YHDISTA ${code}`);
  },
  link(store, options) {
    // Suora yhdistäminen ilman koodia, kun ylläpitäjä on jo varmistanut numeron omistajan (demossa Metan
    // testivastaanottajan vahvistuskoodi). Sama kuin YHDISTA-viesti: uusi yhteys, aiempi keskustelu alkaa alusta.
    const phone = phoneNumber(options['--phone']);
    const hadLink = Boolean(store.member(phone));
    const invitation = store.invite(phone, options['--company'], options['--person']);
    const paired = store.pair(phone, codeHash(invitation.code));
    if (!paired) throw new Error('Yhdistäminen epäonnistui: numerolta on tullut liian monta yhdistämisyritystä. Odota 15 minuuttia.');
    console.log(`Yhdistetty: ${maskPhone(phone)}, ${paired.person}, ${paired.company}. Numero voi nyt viestiä botille.`);
    if (hadLink) console.log('Numerolla oli jo yhteys. Keskustelu ja ostoskori alkavat alusta.');
    console.log(`${META_NOTE}.`);
  },
  revoke(store, options) {
    store.revoke(options['--phone']);
    console.log('Numeron yhteys, kutsu ja odottavat vastaukset poistettu.');
  },
  list(store) {
    // Selainkeskustelun asiakkaat ovat synteettisiä numeroita (web-chat.mjs, web-demo.mjs): ne eivät ole WhatsApp-numeroita
    // eivätkä vie Metan vastaanottajapaikkoja, joten ne vain lasketaan.
    const browser = (phone) => WEB_CHAT_PHONE.test(phone) || phone === WEB_DEMO_PHONE;
    const all = store.db.prepare(`SELECT m.phone, m.person, m.company, COALESCE(s.source, 'admin') source
      FROM members m LEFT JOIN member_sources s ON s.binding = m.binding ORDER BY m.company, m.person`).all();
    const members = all.filter((m) => !browser(m.phone));
    const invites = store.db.prepare('SELECT phone, person, expires FROM invites WHERE expires > ? ORDER BY expires').all(Date.now())
      .filter((i) => !browser(i.phone));
    console.log(`WhatsApp-numeroita: ${members.length}`);
    for (const m of members) console.log(`- ${maskPhone(m.phone)}  ${m.person}, ${m.company}${m.source === 'admin' ? '' : ` (${m.source})`}`);
    console.log(`Selainkeskustelun testiasiakkaita: ${all.length - members.length} (eivät ole WhatsApp-numeroita)`);
    if (invites.length) {
      console.log(`Voimassa olevia kutsuja: ${invites.length}`);
      for (const i of invites) console.log(`- ${maskPhone(i.phone)}  ${i.person}, voimassa vielä ${Math.max(1, Math.round((i.expires - Date.now()) / 60_000))} min`);
    }
    console.log(`${META_NOTE} (enintään viisi).`);
  },
};

let store = null;
try {
  const { command, options } = parseCommand(process.argv.slice(2));
  const filename = whatsappDbPath();
  // Kerrotaan aina, mihin kantaan komento menee: väärä env-tiedosto vie kutsun Macin paikalliseen kantaan.
  console.log(`Kanta: ${target(filename)}`);
  store = openWhatsAppStore(filename);
  actions[command](store, options);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (store) store.close();
}
