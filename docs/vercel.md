# WhatsApp-palvelin pilvessä: Vercel + Turso

Tavoite: botti vastaa, korilinkit aukeavat ja ilmoittautumiset liitetään ilman, että kenenkään Mac on päällä.
Kaikki osat ovat ilmaistasoilla.

```text
WhatsApp → Meta → Vercel (api/index.mjs → server/cloud.mjs) ⇄ Turso (5 SQLite-kantaa)
                     ↑ kerran minuutissa: Cloudflare cron (deploy/vercel/tick) → POST /internal/tick
                     → Cloudflare Worker (landing, tilausnäkymä, demomaksu) kuten ennen
```

| Osa | Missä | Huom |
|---|---|---|
| WhatsApp-palvelin, korisivu, gateway | Vercel Hobby, `fra1` | Yksi Node-funktio, enintään 300 s ja 2 Gt per kutsu |
| Kannat | Turso Free | Samat viisi kantaa ja SQL kuin Macilla |
| Ajastus | Cloudflare Worker `aimo-whatsapp-tick` | Vercelin ilmaistaso sallii vain päivittäisen cronin |
| Korisivun kuvat | `data/img` julkaisussa | Vain Valion omat tuotekuvat näytetään |
| Landing, tilausnäkymä, maksu | Cloudflare Worker `aimo-order-demo` | Ennallaan |

## Miten sama koodi toimii pilvessä

- `server/sqlite.mjs`: tiedostopolku avautuu node:sqlite-kannaksi kuten ennen, `libsql://`-osoite Turso-kannaksi
  samalla synkronisella rajapinnalla. Kutsut kulkevat taustasäikeen kautta (`server/sqlite-remote-worker.mjs`),
  joten olemassa olevat 113 kantakutsua toimivat muuttamatta. `BEGIN IMMEDIATE … COMMIT` on Turson kirjoitustransaktio.
- WhatsApp-jonon varaus on atominen, ja käsittelyllä on 6 minuutin aikaraja (`PROCESSING_LEASE_MS`). Usea pilvi-instanssi
  ei siis käsittele samaa viestiä kahdesti, ja keskeytynyt käsittely palaa jonoon tickissä (`recoverStale`).
- Webhook kuitataan heti, ja jono käsitellään samassa kutsussa vastauksen jälkeen (`waitUntil`).
- Tick: keskeytyneet käsittelyt takaisin jonoon, epäonnistuneiden lähetysten uusinta, landingin ilmoittautumisten
  liittäminen, vahvistetut tilaukset ja agentin jäljet Workeriin sekä siivous 15 minuutin välein.
- Korisivun vahvistuksen jälkeen tilaus välitetään heti tilausnäkymään, jotta maksusivu löytää sen.
- Demokello: `DEMO_NOW_ANCHOR` kiinnittää kiertävän kellon lähtöhetken, jotta kaikki instanssit näyttävät saman ajan.
- Ulos näkyvät vain WhatsAppin reitit. `/demo`, `/mcp`, `/v1/*`, `/openapi.json`, `/approve.html` ja
  `/api/assistant/*` palauttavat 404.

## Käyttöönotto

Tehty 16.11.2026: projekti `eeputtis-projects/aimo-whatsapp`,
osoite https://aimo-whatsapp.vercel.app, kannat Turso `aimo-*` (Frankfurt), ajastin `aimo-whatsapp-tick`.

### Uusi versio (botin "restart")

Julkaise tämän repon puhtaasta tilannevedoksesta, ei työpuusta. Katalogi, tuotekuvat ja kaupalliset fontit
(`*.otf`) ovat Gitin ohittamia, joten ne kopioidaan tilannevedokseen koneen työpuusta
(`/Users/eeputti/developer/valioaimo-tilausapuri`). Ilman fontteja korisivu näkyy järjestelmäfontilla.

```bash
REPO=/Users/eeputti/developer/valioaimo-tilausapuri
cd $REPO && git fetch -q origin
SHA=$(git rev-parse --short origin/main); SNAP=/private/tmp/aimo-vercel-$SHA
mkdir -p $SNAP/data && git archive origin/main | tar -x -C $SNAP
cp $REPO/data/catalog.json $SNAP/data/ && cp -R $REPO/data/img $SNAP/data/img
(cd $REPO && find public deploy/cloudflare/public -name '*.otf') | while read f; do cp "$REPO/$f" "$SNAP/$f"; done
cp -R <edellinen tilannevedos>/.vercel $SNAP/   # tai: cd $SNAP && vercel link --yes --project aimo-whatsapp
cd $SNAP && npx vercel@latest deploy --prod --yes
```

Tarkista ennen julkaisua, että tilannevedoksessa on kuusi fonttia ja katalogi: `find $SNAP -name '*.otf' | wc -l`
(6) ja `ls -la $SNAP/data/catalog.json`.

Tarkista julkaisun jälkeen: `curl https://aimo-whatsapp.vercel.app/healthz` (`host: cloud`) ja webhookin
GET-vahvistus oikealla `WHATSAPP_VERIFY_TOKEN`illa (200 ja haaste takaisin).

### Asetukset

`node deploy/vercel/push-env.mjs` tilannevedoksesta, `AIMO_ENV_ROOT=/Users/eeputti/developer/valioaimo-tilausapuri`
(Gitin ohittamat asetustiedostot ovat tämän repon työpuussa; Vercelin arvot eivät muutu koodin julkaisussa): lukee Macin
`.env`, `.env.whatsapp`, `deploy/cloudflare/.env.publisher` ja `deploy/vercel/.env.cloud` (Turso-osoitteet, Turso-avain,
`TICK_SECRET`, `WHATSAPP_PUBLIC_URL`). `--only=AVAIN,AVAIN` vie vain nimetyt, `AIMO_CLOUD_ENV` vaihtaa pilven tiedoston
(esim. testikannat). Arvot kulkevat stdinin kautta. Asetus tulee voimaan vasta seuraavassa julkaisussa.
Kerran yksi arvo ei päätynyt Verceliin, vaikka komento ilmoitti onnistuneensa: tarkista vaikutus julkaisun jälkeen.

### Ajastin

`deploy/vercel/tick` julkaistaan `cf`-työkalulla (sama kuin `deploy/cloudflare`; wranglerin kirjautuminen ei kata tiliä):

```bash
T=$(mktemp -d); cp deploy/vercel/tick/{worker.mjs,cloudflare.config.ts,vite.config.ts} deploy/cloudflare/package.json $T/
ln -s "$PWD/deploy/cloudflare/node_modules" $T/node_modules
(umask 077; printf 'TICK_URL=https://aimo-whatsapp.vercel.app/internal/tick\nTICK_SECRET=%s\n' "<.env.cloudin TICK_SECRET>" > $T/secrets)
cd $T && npx cf deploy --secrets-file secrets
```

Uusi cron voi käynnistyä vasta noin 15 minuutin kuluttua. Onnistunut tick ei kirjoita lokiin mitään; sen näkee
tilausnäkymän `/api/orders`-vastauksen `observedAt`-ajasta, joka päivittyy kerran minuutissa.

### Kantojen siirto

`node deploy/vercel/migrate.mjs paikallinen.db=libsql://… …` (`TURSO_AUTH_TOKEN` ympäristössä). Keskeytyy, jos etäkannan
taulussa on rivejä, ja tarkistaa jokaisen taulun sisällön. Lähteeksi johdonmukainen kopio (`VACUUM INTO`) pysäytetyn
palvelimen kannoista.

## Ylläpito Macilta

Hallintakomennot toimivat Macilta suoraan Turso-kantaa vasten, kun `.env.cloud` annetaan viimeisenä:

```bash
node --env-file=.env --env-file=.env.whatsapp --env-file=deploy/vercel/.env.cloud scripts/whatsapp-member.mjs invite --phone +358401234567 --company "Ravintola A" --person "Anna"
```

Uusi versio: `vercel deploy --prod` projektikansiosta. Lokit: Vercelin projektin Logs-näkymä tai `vercel logs`.

## Rajat

- Ilmaistasot: Vercel Hobby on ei-kaupalliseen käyttöön. Turso Free estää kannat, jos jokin kuukausiraja ylittyy.
- Jokainen kantakutsu on verkkokutsu Frankfurtiin. Viestin käsittely hidastuu vähän, mutta mallikutsut ovat silti hitain osa.
- Metan testinumero hyväksyy edelleen vain käsin lisätyt vastaanottajat. Se ei riipu hostauksesta.
