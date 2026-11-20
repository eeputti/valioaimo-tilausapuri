# Workers-sivusto: välilehdet, selainkeskustelu ja ostoskori

Sivuston yläpalkissa on kuusi välilehteä kaikilla sivuilla (`public/site.css`): **Etusivu** (landing ja WhatsApp-kokeilun pyyntö), **Keskustele**, **Ostoskori**, **Näin se toimii**, **Tilaukset** ja **Minusta**. Koko demokierros onnistuu yhdellä sivustolla: keskustelu → ostoskori → demotilaus → demomaksu → Katso, mitä agentti näki.

## Keskustele

`/keskustele` on WhatsAppin näköinen keskustelu samalla tilausapurilla kuin WhatsAppissa.

```
selain ──/api/chat──▶ Worker ──/webchat/api/chat (Bearer WEBCHAT_SECRET)──▶ botin palvelin (server/whatsapp/web-chat.mjs)
        eväste aimo_chat        D1 web_chat_usage (rajat)                     sama korilinkki-chat kuin WhatsAppissa
```

- Worker antaa selaimelle oman istunnon (HttpOnly-eväste `aimo_chat`, 7 vrk). Botin palvelin johtaa istunnosta oman testiasiakkaan (`3580000` + 8 numeroa, ei koskaan oikea numero) ja oman ostoskorin, joten kokeilijat eivät näe toistensa koreja. Kierrä-kuvake aloittaa alusta uudella korilla.
- Rajat ennen mallikutsua: 30 viestiä selainta kohden ja 300 viestiä koko sivustolla vuorokaudessa (Worker), lisäksi 600 viestiä vuorokaudessa botin palvelimella. Rajan täytyttyä sivu ohjaa pyytämään WhatsApp-kokeilua.
- Viestit tallentuvat botin jonokantaan kuten WhatsApp-viestit, joten historia, korilinkki ja agentin jälki toimivat samalla tavalla. Sivu muistuttaa, ettei henkilötietoja kirjoiteta: keskustelu voi näkyä demon tilausnäkymässä ja jäljessä.
- Botin osoite on D1-asetus `landing_settings.bot_backend_url` (HTTPS-alkuperä). Kun botti siirtyy (tunneli vaihtuu tai pilvisiirto), vaihda vain se:

```bash
npm exec -- cf d1 query fd216575-282d-48a4-a2f9-d01f528aab19 --sql "INSERT OR REPLACE INTO landing_settings VALUES('bot_backend_url','https://uusi-osoite')"
```

Jos botti ei vastaa, sivu kertoo sen eikä yritä uudelleen itsestään.

## Ostoskori

`/ostoskori` kysyy Workerilta tämän selaimen keskustelun korilinkin ja avaa saman korin (`/whatsapp/cart#…`). Worker välittää korisivun, sen tiedostot ja API:n botin palvelimelta samaan alkuperään ja lisää sivun yläreunaan välilehdet. Korin CSP säilyy; API-kutsuissa Worker vaihtaa Origin-otsakkeen botin omaksi, ja vain saman sivuston POST-pyynnöt välitetään. Kun keskustelussa tulee korilinkki, se näkyy painikkeena **Avaa ostoskori**.

## Näin se toimii ja esimerkkijälki

`/miten` selittää viisi vaihetta ja linkittää esimerkkiin `/agentti#esimerkki`. Esimerkkinä näytetään ilman maksulinkkiä vain D1-asetuksen `example_trace_order` tilaus (nyt AGW-20261115-0008, Eeliksen oma demokeskustelu).

## Julkaisijan liput

Selainkeskustelun tilaukset (kanava `browser-demo`) ja niiden jäljet välitetään Workeriin lipulla `--include-web-chat`:

```bash
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env --env-file-if-exists=.env.whatsapp --env-file=deploy/cloudflare/.env.publisher deploy/cloudflare/publish-orders.mjs --watch --order-events --agent-traces --include-web-chat
```

## Käyttöönotto

1. D1: `schema.sql` (taulut `web_chat_usage` ja `landing_settings`) ja asetukset `bot_backend_url`, `example_trace_order`.
2. Sama satunnainen `WEBCHAT_SECRET` (vähintään 32 merkkiä) botin `.env.whatsapp`:iin ja Workerin salaisuudeksi (`cf workers secrets update WEBCHAT_SECRET --worker aimo-order-demo`), sitten `npm run deploy`.
3. Botin palvelimen uudelleenkäynnistys koodilla, jossa `server/whatsapp/web-chat.mjs` on mukana. Ennen sitä keskustelusivu näyttää, että botti on tauolla.

Testit: `npm --prefix deploy/cloudflare test` (`test/web-chat.test.mjs`) ja `node --test test/whatsapp-web-chat.test.mjs`.
