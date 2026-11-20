# Cloudflare: jaettava WhatsApp-tilausten demonäkymä

Käyttäjän valinta 14.11.2026: ensin ilmainen, julkinen vain katselu -näkymä. Nykyinen WhatsApp-palvelin pysyy käyttäjän koneella. Koko WhatsApp-taustan siirto Workersiin ei kuulu tähän vaiheeseen. Tämä ei ole oikean Valio-verkkokaupan tilausten vastaanottorajapinta.

**Julkaistu sivu:** https://aimo-order-demo.aimo-demo-41cfac.workers.dev, Worker-versio `0757280b-e026-4b61-b15d-6ff63fbaa061`. Oikean accountin Workers plans -näkymästä varmennettu **Free / $0 / Current plan**. Julkinen HTTPS-health ja tilaus-API palauttavat 200. Käyttäjä hyväksyi erikseen nykyisen ja saman testiasiakkaan tulevien demotilausten tarkat julkiset kentät. Tilannekuva julkaistiin ja tilauksen `AGW-20261114-0001` kaikki julkiset kentät sekä lokin tunniste verrattiin takaisin lähteeseen: sama vahvistettu tilaus, yksi tuoterivi, 74,10 €. Se näkyy oikeassa julkisessa selaimessa. Vain lukeva julkaisija käy tämän chatin exec-sessiossa **50658** viiden sekunnin välein; sen tulee pysyä käynnissä uusien tilausten näkymistä varten.

## Rakenne

- `deploy/cloudflare/`: erillinen Workers + Static Assets + D1 -projekti, Worker `aimo-order-demo`, account `41cfacacd7c70bbcf80372ab540dd974`. D1 `fd216575-282d-48a4-a2f9-d01f528aab19` luotu EU-jurisdiktioon, `schema.sql` ajettu ja ID sidottu konfiguraatioon. Uutta maksullista tilausta ei otettu.
- `publish-orders.mjs` avaa nykyisen WhatsAppin gateway- ja jäsenkannan **vain luku** -tilassa. Se valitsee vain `WHATSAPP_DEMO_PHONE`-asetuksella nimetyn, jo liitetyn testiasiakkaan tilaukset ja tarkistaa gatewayn koko päätösketjun. Kanavaa, kutsuja, asiakasliitoksia, kantojen skeemaa tai palvelinta ei käynnistetä eikä muuteta.
- Julkinen sallittujen kenttien projektio sisältää tilausnumeron, kanavan, tilan, toimituspäivän, tuotteen, määrän ja verottoman summan. Ei puhelinnumeroita, henkilö-/yritysnimiä, asiakastunnuksia, viitteitä, keskusteluja, API-avaimia, mandaattia tai raakaa tuoteluetteloa.
- Julkaisija lähettää tuoreen tilannekuvan viiden sekunnin välein, kun se on käynnistetty `--watch`-valinnalla. D1 säilyttää viimeisimmän kuvan ja uusimmat 20 tilausta. Vanhentunut tai toistuva kuva ei voi ohittaa uudempaa. Näkymä näyttää vastaanottoajan ja siirtyy taukotilaan 30 sekunnin jälkeen ilman uutta kuvaa; vanhat tilaukset säilyvät.
- Sivulla ei ole tilausten tekemistä, hyväksyntää, numeron liittämistä, keskustelua tai nollausta. Julkinen API on `GET /api/orders`. Vain salaisella julkaisuavaimella voi käyttää `POST /api/sync`. Julkaisijan tunnusta ei lähetetä selaimelle.
- `--include-browser-demo` julkaisee lisäksi erikseen nimetyn **Selaindemo**-kanavan. Sitä ei esitetä WhatsApp-viestinä. Tämä valinta on oletuksena pois.


## Kehitys ja julkaisu

Julkaisuprojektilla on omat riippuvuudet ja lukitustiedosto. Se sisältää erillisen Node 24.22.0 -kehitystyökalun, koska cf 1.0.0-beta.32 vaatii sitä uudemman Node-version kuin koneen nykyinen 24.14.0. `npm run` käyttää projektin omaa Node-binaaria. Nykyisen WhatsApp-palvelimen Node-asennusta ei vaihdeta.

```bash
npm --prefix deploy/cloudflare ci
npm --prefix deploy/cloudflare test
npm --prefix deploy/cloudflare run typecheck
npm --prefix deploy/cloudflare run build
```

Worker julkaistaan tämän repon kansiosta `/Users/eeputti/developer/valioaimo-tilausapuri/deploy/cloudflare`, kun työpuu on puhdas ja samassa commitissa kuin `origin/main`. Kaupalliset fontit (`public/fonts/*.otf`) ovat Gitin ohittamia mutta kansiossa levyllä, joten julkaisu ottaa ne mukaan; tarkista ennen julkaisua, että niitä on kolme.

Käytä julkaisuhakemistossa sen paikallista `cf`-CLI:tä, esimerkiksi `npm exec -- cf ...`. Määritä tietokanta D1-bindingiin sen varmennetulla ID:llä, aja `schema.sql` tähän erilliseen tietokantaan ja tarkista `cf deploy --dry-run` ennen julkaisua. Varmista erikseen, että kohteena on käyttäjän oma account (yllä oleva ID) ja Workers Free / D1 Free. Älä käytä tilapäistä claim-accountia, muita Cloudflare-projekteja tai maksullista pakettia tämän pyynnön perusteella.

Julkaisuavaimen voi valmistella ennen ensimmäistä julkaisua komennolla `node deploy/cloudflare/setup-publisher.mjs` (osoite jää silloin tyhjäksi). Kun julkaisun todellinen `workers.dev`-osoite on tiedossa:

```bash
node deploy/cloudflare/setup-publisher.mjs https://aimo-order-demo.aimo-demo-41cfac.workers.dev/
```

Tämä luo vain tämän julkaisun `.env.publisher`- ja `.env.deploy`-tiedostot (0600, Gitin ohittamat). Uusinta käyttää olemassa olevaa samaa julkaisuavainta. `SYNC_TOKEN` lähetetään Workerille paikallisella `cf deploy --secrets-file .env.deploy` -komennolla. Accountin API-avainta, Metan tokenia tai malliavaimia ei tarvita julkisessa Workerissa. Älä tulosta tai tallenna näitä asetuksia Gitiin.

Käynnistä julkaisija projektin juuresta vasta, kun juuri julkaistun Workerin ja D1-skeeman toiminta on varmennettu:

```bash
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env --env-file-if-exists=.env.whatsapp --env-file=deploy/cloudflare/.env.publisher deploy/cloudflare/publish-orders.mjs --watch
```

Pidä tämä prosessi ja nykyinen WhatsApp-palvelin käynnissä. Ctrl+C pysäyttää julkaisijan; se ei pysäytä WhatsApp-palvelinta. Lue julkinen `/api/orders` takaisin ja varmista saman tilausnumeron, rivien, tilan ja summan täsmääminen ennen demoa. Aito WhatsApp → tilaus -varmennus edellyttää, että Metan viestinkuljetus toimii; Workers-julkaisu ei korjaa Metan aiemmin havaittua lähetysestoa.

Hinnoittelulähteet: [Workers Free ja käyttörajat](https://developers.cloudflare.com/workers/platform/pricing/), [D1-hinnoittelu](https://developers.cloudflare.com/d1/platform/pricing/). Ilmaiskiintiöt ovat account-kohtaisia. Tässä toteutuksessa ei oteta maksullista tilausta tai anneta lupausta rajattomasta käytöstä.

## Sähköpostisarakkeiden poisto (20.11.2026)

Vahvistussähköposti poistettiin: tilausvahvistus tulee WhatsAppiin. Julkaise ensin Worker ja aja heti perään kerran
`npm exec -- cf d1 execute aimo-order-demo --remote --file drop-email.sql` hakemistossa `deploy/cloudflare`. Uusi Worker lukee
vanhaa taulua normaalisti, mutta uuden tilauksen tallennus epäonnistuu, kunnes sarakkeet on poistettu. Julkaisija yrittää silloin
uudelleen minuutin ajastimella.
