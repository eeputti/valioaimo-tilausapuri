# WhatsApp-kanava: asennus ja toiminta

Tilaustilassa (`WHATSAPP_ORDERING_ENABLED=true`) apuri kerää tarpeet, kysyy ensin puuttuvan toimituspäivän ja tarjoaa käyttäjän valittavat tuotteet. Yhteenvedon kuittaus avaa yksityisen korilinkin; lopullinen vahvistus tehdään selaimen korissa saman gatewayn kautta. WhatsApp ja kori käyttävät samaa palvelimen luonnosta. Oikeaa Valio-tilausta tai maksua ei tehdä.

Tuotannon pilvibotti (Vercel, ks. [vercel.md](vercel.md)) toimii aina tilaustilassa. Jos asetus puuttuu, botti vastaa vain, ettei tilaaminen ole käytössä; numeron yhdistäminen ja tukiviesti toimivat silti.

**Kuka asiakas on:** asiakkaiden tunnistus ja ostovaltuudet kuuluvat Valiolle. Tämän repon numerorekisteri ja kutsukoodit vain jäljittelevät tunnistusta eristetylle testiasiakkaalle, eikä niitä ole kytketty Valion asiakasrekisteriin tai tunnistusrajapintaan.

## 1. Metan sovellus ja testinumero

1. Tee [Meta App Dashboardissa](https://developers.facebook.com/apps) uusi sovellus, valitse käyttötavaksi WhatsApp ja liitä se yritysportfolion WhatsApp Business -tiliin.
2. Avaa **API Setup** tai uuden näkymän **Customize → Basic setup → Step 1. Try it out**. Valitse testinumero, lisää omat testivastaanottajat numerolistaan ja vahvista ne Metan lähettämillä koodeilla. Testinumerolta voi lähettää enintään viidelle vahvistetulle vastaanottajalle. Kaikille avoimeen demoon tarvitaan myöhemmin oma yritysnumero, jonka omistus voidaan vahvistaa SMS:llä tai puhelulla. Valitse yhteystestiksi **Hello World**, lähetä se ja vastaa siihen omassa WhatsAppissasi. Apurin viestit kulkevat Metasta palvelimelle; apurilla ei tarvitse olla omaa fyysistä puhelinta.
3. Tallenna **Phone number ID** (tekninen tunniste, ei puhelinnumero) ja käyttöoikeustoken palvelimen salaisiin ympäristöasetuksiin. Testin tilapäinen token vanhenee; pidempään käyttöön luo system user -token tarvittavin `whatsapp_business_messaging`-oikeuksin ja valitse Token expiration: **Never**. Vanhenemiset (token, Turson avain, demon hintojen ikäraja) näkee komennolla `npm run expiry:check`. Tilin/numeron hallinta voi vaatia lisäksi `whatsapp_business_management`-oikeuden.
4. Kopioi sovelluksen **App Secret** asetuksiin. Webhookin verify token on oma satunnainen merkkijonosi, jonka saa vaikkapa komennolla `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Metan omat vaatimukset kehittäjätilille, yritykselle, numerolle ja julkaisulle ovat eri asia kuin se, että käyttäjä liitetään apuriin. Seuraa sitä, mitä oma Meta-sovelluksesi pyytää. Avaimet kuuluvat ympäristöasetuksiin: ne eivät kuulu WhatsApp-keskusteluun eivätkä Gitiin.

## 2. Palvelimen käynnistys

Tarvitset Noden 22.13 tai uudemman; asenna riippuvuudet komennolla `npm ci`. Asetukset menevät `.env`-tiedostoon tai hostingin ympäristömuuttujiin:

```dotenv
WHATSAPP_PHONE_NUMBER_ID=<Phone number ID Metasta>
WHATSAPP_ACCESS_TOKEN=<system user -token>
WHATSAPP_APP_SECRET=<sovelluksen App Secret>
WHATSAPP_VERIFY_TOKEN=<itse arvottu merkkijono>
WHATSAPP_API_VERSION=<Graph API -versio, esim. v23.0>
WHATSAPP_SUPPORT_CONTACT=<ihmisen yhteystieto: puhelin, sähköposti tai osoite>
WHATSAPP_DB=/srv/aimo/whatsapp.db
ANTHROPIC_API_KEY=<valinnainen: Clauden API-avain>
```

Kuusi ensimmäistä ovat pakollisia; ilman niitä palvelin ei käynnisty. `WHATSAPP_DB` saa jäädä pois, jolloin kanta on `data/whatsapp.db`. Sijoita kanta pysyvälle levylle, sillä siinä ovat yhdistetyt numerot, keskustelut ja viestijono, eikä niiden pidä kadota uudelleenjulkaisussa. Esimerkin `/srv/aimo` on vain malli: paikallisesti käytä hakemistoa, joka oikeasti on olemassa.

**Oma palvelinprosessi (helpoin ensimmäiseen kokeiluun):**

```bash
npm run whatsapp
```

Kuunneltava portti on oletuksena 4748. `WHATSAPP_PORT` menee `PORT`-muuttujan edelle, joten hostingissa jätä `WHATSAPP_PORT` pois ja anna palvelun asettaa `PORT`. Osoite `/healthz` kertoo vain, että viestipalvelin on pystyssä; se ei kokeile mallia eikä Metan tokenia.

**Saman palvelimen sisällä kuin paikallinen sivusto:** `WHATSAPP_ENABLED=true` ja tavallinen `npm start`. Muuten sivusto käynnistyy kuten ennenkin, ja koska asetus on oletuksena pois, kukaan ei tarvitse Meta-avaimia pelkkää sivustoa varten.

Yhtä WhatsApp-kantaa saa käsitellä vain yksi prosessi kerrallaan. Valitse siis joko oma palvelin tai sivuston sisäinen kanava, älä molempia saman kannan päälle.

### Tilausdemo

`WHATSAPP_ORDERING_ENABLED=true` vaihtaa `npm run whatsapp` -palvelimen tilauskeskusteluun: luonnos, vaihtoehdot, yhteenveto ja yksityinen korilinkki; demotilaus vahvistetaan erikseen korissa. Oikeaa Valio-tilausta ei lähetetä.

```bash
WHATSAPP_ORDERING_ENABLED=true
GATEWAY_DB=/var/data/whatsapp-gateway.db
AIMO_DB=/var/data/whatsapp-prices.db
WHATSAPP_DRAFT_DB=/var/data/whatsapp-drafts.db
WHATSAPP_QUOTE_DB=/var/data/whatsapp-quotes.db
WHATSAPP_DEMO_PHONE=<valinnainen: yksi Metassa vahvistettu testinumero>
WHATSAPP_DEMO_PERSON=<valinnainen: testaajan nimi>
```

- `GATEWAY_DB` ja `AIMO_DB` ovat pakollisia, eivätkä ne saa osoittaa verkkokaupan `data/gateway.db`- tai `data/aimo.db`-kantaan. Palvelin ei käynnisty muuten. Näin demotilaukset ja hintavälimuisti pysyvät erillään verkkokaupan tilauksista. Suositeltu käynnistys on erillinen `npm run whatsapp` ja omat tietokannat.
- `WHATSAPP_DRAFT_DB` ja `WHATSAPP_QUOTE_DB` ovat valinnaisia; oletukset ovat `data/whatsapp-drafts.db` ja `data/whatsapp-quotes.db`. Pidä ne pysyvällä levyllä, jotta luonnos säilyy uudelleenkäynnistyksessä.
- Tilauspolku tarvitsee paikallisen katalogin (`npm run catalog`).
- `VALIO_API_KEY` tuo oikeat hinnat ja saatavuuden, ilman sitä ne simuloidaan. `ANTHROPIC_API_KEY` ottaa käyttöön mallitulkin vapaalle puhekielelle, ilman sitä viestit tulkitaan säännöillä. Gatewayn allekirjoitusavain luetaan muuttujasta `GATEWAY_PRIVATE_KEY_PEM` tai luodaan `data/`-hakemistoon.
- `WHATSAPP_DEMO_PHONE` yhdistää yhden numeron testiasiakkaaksi käynnistyksessä ilman kutsukoodia. Olemassa oleva yhdistäminen säilyy. Muut numerot yhdistetään kohdan 4 kutsulla. Jokainen yhdistetty numero saa oman demo-ostajan (hyväksyntä vain poikkeuksissa, 6 000 € per tilaus). Tämä on testitunnistus, ei Valion asiakastunnistus.
- Asetukset voi pitää erillisessä `.env.whatsapp`-tiedostossa: `npm run whatsapp` ja `npm run whatsapp:member` lukevat sen `.env`:n jälkeen, ja sen arvot ohittavat `.env`:n arvot. Tiedosto on Gitin ohittama.
- `/healthz` palauttaa tilaksi `ordering-demo`, kun tilausdemo on päällä, muuten `read-only-test`.

**Selaimen varademo:** tilaustilassa palvelin tarjoaa osoitteessa `http://localhost:<portti>/demo` saman tilauskeskustelun selaimessa, omalla testiasiakkaalla ja ilman Metaa. Se toimii vain palvelinkoneen omasta selaimesta; tunnelin kautta pyyntö torjutaan, koska sivu tekee malli- ja hintakutsuja ilman kirjautumista.

Jos viestin käsittely epäonnistuu, sama viesti yritetään uudelleen samalla Metan viestitunnisteella (enintään kolme kertaa, 30 ja 60 sekunnin välein). Tilauskeskustelu palauttaa uusinnalle saman tuloksen, joten uusinta ei tee toista tilausta.

### Kuvat ja ääniviestit (tilaustilassa)

- **Kuva** ostoslistasta, lähetteestä, hyllystä tai reseptistä (JPG, PNG tai WebP, enintään 5 Mt; myös kuvana lähetetty tiedosto) haetaan Metan media-API:sta samalla `WHATSAPP_ACCESS_TOKEN`illa ja luetaan Clauden kuvantulkinnalla (`FAST_MODEL`). Koodi kirjoittaa luetuista tuoteriveistä tavallisen tilausviestin samaan keskusteluun, ja asiakas saa ensin lyhyen viestin siitä, mitä luettiin. Kuvan teksti on dataa: mallin vapaata tekstiä ei näytetä eikä välitetä, ja ohjaussanat (tilaa, peru, tyhjennä, unohda ohjeet) pudotetaan tuoteriveistä. Toimituspäivää ei lueta kuvasta, se kysytään.
- **Ääniviesti** (enintään 1 Mt, noin 5–10 minuuttia) litteroidaan vain, jos `WHATSAPP_TRANSCRIBE` on asetettu (`groq`, `openai` tai paikallinen `command`). Oletuksena botti kiittää ja pyytää kirjoittamaan. Litteroinnin jälkeen asiakas näkee, mitä kuultiin. Pelkkä vahvistus tai peruutus ("tilaa", "peru") ääniviestinä ei tee mitään, vaan pyytää kirjoittamaan sen.
- Metan webhookiin ei tarvita muutoksia: kuvat ja äänet tulevat samassa `messages`-kentässä. Muut liitteet (PDF, tarra, video) saavat vastauksen, joka kertoo tuetut muodot.
- Luettu teksti tallentuu tauluun `wa_media_reads` viestitunnisteella, joten uusinta ei lue kuvaa uudelleen. Rivit poistetaan jonon mukana seitsemän päivän jälkeen tai kun viesti perutaan.

## 3. Webhookin kytkentä

Meta ei näe localhostia, joten palvelin tarvitsee julkisen HTTPS-osoitteen. Kokeiluun riittää pikatunneli, esim. `cloudflared tunnel --url http://localhost:4748`. Tunnelin osoite vaihtuu joka kerta, ja uusi osoite on vaihdettava myös Metaan.

Metan webhook-näkymään:

- osoitteeksi (Callback URL) `https://<palvelin>/webhooks/whatsapp`
- tarkistustunnukseksi (Verify token) sama merkkijono kuin `WHATSAPP_VERIFY_TOKEN`
- tilattavaksi WhatsApp Business -tilin tapahtuma **messages**. Onnistunut osoitteen vahvistus ei vielä tuo viestejä: sovelluksen on myös oltava tilattuna juuri sille Business-tilille, jonka numeroa käytät.

Vahvistuspyyntöön (GET) palvelin vastaa Metan `hub.challenge`-arvolla. Saapuvan viestin (POST) `X-Hub-Signature-256`-allekirjoitus lasketaan App Secretillä raakatavuista ennen kuin JSONia luetaan. Muiden Phone number ID:iden tapahtumat ohitetaan, eivätkä toimitus- ja lukukuittaukset herätä mallia.

## 4. Numeron liittäminen henkilöön

Kutsu tehdään palvelimen komentoriviltä, samalla koneella ja samalla `WHATSAPP_DB`:llä kuin viestipalvelimella:

```bash
npm run whatsapp:member -- invite --phone +358501112233 --company "Bistro Esimerkki" --person "Ville"
```

Tulosteessa on kertakäyttöinen koodi. Se toimii 10 minuuttia ja vain kutsussa annetulla numerolla, joten anna se henkilölle itselleen luotetussa kanavassa. Henkilö lähettää apurin numeroon:

```text
YHDISTA <koodi>
```

Kun apuri on kuitannut yhdistämisen, voi kokeilla esimerkiksi:

```text
Tarvitsisin perjantaiksi 10 kg perunaa ja 5 litraa kermaa.
```

Jatkokysymys samassa keskustelussa käyttää tallennettua historiaa. Tunnistamaton numero saa yhdistämisohjeen; sille ei tehdä mallikutsuja. Tässä versiossa yksi numero kuuluu yhteen henkilöön ja yritykseen. Yhdistäminen ei anna osto-oikeuksia: tilaustilassa käyttäjät voivat vahvistaa vain eristettyjä demotilauksia oman testiasiakkuutensa valtuuksilla. Yritystunniste erottelee keskustelut, mutta ei vielä vaihda Valion asiakaskohtaista hinnoittelua tai anna pääsyä yrityksen tilauksiin.

Demossa numeron voi yhdistää myös heti ilman koodia (`link`), ja `list` näyttää yhdistetyt numerot peitettyinä; ks. [demo-onboarding.md](demo-onboarding.md). Liitoksen purku:

```bash
npm run whatsapp:member -- revoke --phone +358501112233
```

Purku poistaa liitoksen, avoimen kutsun ja henkilön keskusteluhistorian ja peruu jonossa odottavat vastaukset. Metalle jo lähtenyttä viestiä se ei saa takaisin. Ylläpitokomennot toimivat vain komentoriviltä, eikä niille ole verkkoreittiä. Oikeassa käytössä tämän testirekisterin paikalle tulee Valion vahvistama tieto siitä, mikä numero kuuluu millekin asiakkuudelle ja millä oikeuksilla; erillistä omaa asiakaskirjautumista ei ole tarkoitus rakentaa.

## Miten kanava toimii ja missä sen rajat ovat

- Saapuva viesti kirjataan SQLite-jonoon, ja Metalle kuitataan heti, ennen kuin mallia kutsutaan. Jono jatkuu, vaikka prosessi käynnistyisi välillä uudelleen. Eri asiakkaita käsitellään rinnakkain (`WHATSAPP_CONCURRENCY`, oletus 4, enintään 16), mutta yhden numeron viestit vuoro kerrallaan saapumisjärjestyksessä.
- Metan viestitunniste estää käsittelemästä samaa viestiä kahdesti. Numerolta otetaan vastaan enintään 10 viestiä minuutissa, 120 tunnissa ja 400 vuorokaudessa; ylijäämä kuitataan Metalle mutta jätetään vastaamatta. Yhdistämiskoodia saa yrittää viisi kertaa vartissa. Rajat suojaavat demoa väärinkäytöltä, eivätkä ne ole mitoitettu suurelle liikenteelle.
- Lähettäjä tunnistetaan puhelinnumerosta (`messages[].from`). Viestejä, joissa on pelkkä business-scoped user ID (BSUID) ilman numeroa, ei vielä käsitellä; niiden tuki kuuluu Valion tunnistussovittimeen.
- Tekstiviestin enimmäispituus on 4000 merkkiä. Tilaustilassa kuvat ja ääniviestit luetaan (ks. yllä); muuten kaikki muu kuin teksti saa ohjeen kirjoittaa viesti. Yli 3800 merkin vastaus jaetaan useaan viestiin, jotta Metan 4096 merkin raja ei ylity.
- Pelkkä `tuki`, `apua`, `help` tai `asiakaspalvelu` tuo vastaukseksi `WHATSAPP_SUPPORT_CONTACT`-yhteystiedon ilman mallikutsua. Apuri ei väitä luoneensa tukipyyntöä.
- Jos malli tai lähetys pettää, viesti yritetään uudelleen enintään kolmesti, ja kerran tallennettu vastaus lähetetään sellaisenaan. Täysin yhtä toimitusta ei voi luvata: jos vastaus ehti Metalle mutta kuittaus katosi, asiakas voi saada saman viestin kahdesti. Tilauskeskustelu ei uusinnassa tee toista tilausta.
- Vastaukset lähtevät vain viesteihin, jotka ovat alle 23 tuntia vanhoja. Näin Metan 24 tunnin palveluikkunaan jää tunnin pelivara. Ainoa apurin oma-aloitteinen viesti on maksun jälkeinen kiitos, ja sekin menee perille vain Metan 24 tunnin ikkunan sisällä; ajastetut viestit ja viestipohjat vaatisivat erillisen suostumuksen ja template-toteutuksen.
- Kannassa ovat puhelinnumerot, liitokset henkilöihin ja yrityksiin sekä viestit vastauksineen. Kutsukoodista talletetaan, myös viestijonoon, pelkkä SHA-256-tiiviste. Paikallisen kantatiedoston oikeudet ovat 0600; sovellus ei salaa kantaa, joten levyn salaus ja suppeat ylläpito-oikeudet ovat hostingin vastuulla.
- Keskustelusta säilytetään 20 viimeisintä viestiä liitosta kohden. Viikkoa vanhemmat viestit ja jonon rivit siivotaan käynnistyksessä ja sen jälkeen tunnin välein. Numeron ja henkilön liitos pysyy, kunnes ylläpitäjä purkaa sen. Siivous ei ulotu Metan, kielimallipalvelun tai varmuuskopioiden tietoihin.

## Tarkistukset

```bash
npm test
```

Testit eivät kutsu Metaa eivätkä oikeaa kielimallia: Meta ja malli korvataan testeissä käsikirjoitetuilla vastauksilla. Mukana ovat mm. webhookin vastaanotto ja allekirjoitus, yhdistämiskoodit, keskustelujen erottelu, uudelleenkäynnistys, kaksoisviestit, purku ja lähetysvirheet. Oikea puhelintesti vaatii omat Meta-asetukset ja vahvistetun testivastaanottajan.

## Kun jokin ei toimi

- **Metan osoitetarkistus ei mene läpi:** onko osoite HTTPS, onko reitti `/webhooks/whatsapp` ja onko Verify token sama kuin palvelimella? Verify token ja access token ovat kaksi eri asiaa.
- **Tarkistus onnistui, mutta viestejä ei tule:** katso, että `messages` on tilattu, sovellus on tilattu oikealle WhatsApp Business -tilille, vastaanottaja on vahvistettu ja Phone number ID on oikein. Metan oma testitapahtuma ei vielä todista, että oikea numero on kytketty.
- **Viesti jää jonoon eikä vastausta lähde:** onko access token voimassa ja oikeuksiltaan riittävä, ja onko lähettäjä sallittu testivastaanottaja? `inbox`-taulun sarakkeet `state`, `attempts` ja `error` kertovat, missä mennään; terveystarkistus ei näytä niitä.
- **Tuotteita tai hintoja ei löydy:** tarkista katalogi (`npm run catalog`), `VALIO_API_KEY` ja hintavälimuistin kanta (`AIMO_DB`). Virhetilanteessa tilausta ei synny.
- **Vastaukset viipyvät:** nukahtava hosting hidastaa webhookeja. Pidä viestipalvelin hereillä ja tarkista, ettei mallin vastausaika ole kasvanut.

Lisätietoa: Metan [WhatsApp-aloitusohje](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started/), [webhookien vahvistaminen](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/) ja [WhatsAppin liiketoimintakäytännöt](https://business.whatsapp.com/policy).
