# Niputus ja vanhentuneen vastauksen esto (v2, sessio niputus)

19.11.2026. Suunnitelma: [docs/agent-v2.md](../agent-v2.md), kohta Niputus. Eeliksen palaute WhatsAppissa klo 8.45:
botti vastaa jokaiseen viestiin erikseen, vaikka sen pitäisi lukea uudet viestit ennen kuin se on ehtinyt vastata
aiempaan. Viestit klo 8.43.32 ja 8.43.38 saivat kaksi erillistä, keskenään ristiriitaista vastausta.

Toteutus on mainissa commitissa 00d9f3a (haara 4d5b595). Katselmuksen korjaukset ovat haarassa
`claude/agent-v2-gather-redo-gate` (kohta Katselmuksen korjaukset).

## Muutokset

- **Pidempi odotus** (`gatherSettings`, `server/whatsapp/channel.mjs`): `WHATSAPP_GATHER_MS` oletus 6000 (ennen 3000) ja
  `WHATSAPP_GATHER_MAX_MS` oletus 20000 (ennen 10000). Ympäristömuuttujat ohittavat oletukset kuten ennen, ylärajat (15 s ja
  30 s) ovat ennallaan, ja 0 poistaa sekä niputuksen että uusinnan. Kanavan oma oletus `gatherMs: 0` pitää testien ja
  itsepelien vanhan käytöksen. Niputus koskee molempia putkia.
- **Vanhentuneen vastauksen esto** (`processNext`), vain kun chat tukee uusintaa (`redo`, eli v2-agentti, päätös 6): kun
  `chat` on palauttanut vastauksen, kanava tarkistaa ennen tallennusta ja lähetystä, onko samalta numerolta tullut uusia
  tekstiviestejä. Jos on, vastausta ei lähetetä. Uudet viestit liitetään samaan työhön (`store.absorb`, tila `merged`), ja
  `chat` kutsutaan uudelleen:
  - `messageId` on `${job.id}:r1`, sitten `:r2`
  - `discardedReply` on hylätyn vastauksen teksti
  - uusintoja on enintään 2 (`maxRedos`), minkä jälkeen viimeisin vastaus lähtee ja myöhemmät viestit saavat oman vuoronsa.

  Ilman tukea vastaus lähtee kuten ennen, ja uudet viestit saavat oman vuoronsa.
- **`incoming`**: `chat` saa kentän `incoming: [{ text, at, round }]`, jossa ovat tämän vastauksen kaikki asiakasviestit
  erikseen:
  - `at` on asiakkaan lähetysaika millisekunteina (Metan aikaleima, sama lähde kuin `receivedAt`)
  - `round` on kierros, jolla viesti tuli mukaan (0 = ensimmäinen kutsu). Uusinnassa uudet viestit ovat ne, joiden `round`
    on sama kuin viimeisen alkion
  - `discardedReply` annetaan vain uusinnassa.
- **`messages`**: ensimmäisellä kierroksella ennallaan (historia ja koko niputettu teksti viimeisenä käyttäjävuorona).
  Uusinnassa historia, jo luetut viestit omana käyttäjävuoronaan ja viimeisenä vain uudet viestit (päätös 1).
- **Vuoron tila** tallentuu uuteen tauluun `inbox_turns` (`server/whatsapp/store.mjs`): viestit erikseen, kierros ja
  hylätty vastaus. Rivi syntyy vasta, kun vuoroon liitetään toinen viesti. Uusintayritys (`job.attempts > 1`) jatkaa
  samasta kierroksesta samalla `messageId`:llä. Rivit poistuvat prunessa inbox-rivien mukana (7 vrk) ja numeron
  peruutuksessa. Taulu luodaan `CREATE TABLE IF NOT EXISTS`, joten Turso ei tarvitse migraatiota.
- **Pilven aikaraja**: `drain(budgetMs, { reserveMs })` antaa rajan `processNext`:lle. Niputus ei odota rajan yli, uutta
  työtä ei oteta eikä uusintaa aloiteta, kun aikaa on alle `reserveMs` (pilvessä 90 s, kohta Pilven ajoaika).
- **Loki** (vain pilvessä, ei tekstiä, numeroa eikä tunnuksia): uusi `reply_discarded` `{ round, count }`.
  `messages_gathered` kertoo vuoron viestien määrän kuten ennen.

## Katselmuksen korjaukset (19.11., haara `claude/agent-v2-gather-redo-gate`)

Riippumaton katselmus löysi mainista 00d9f3a kaksi korjattavaa.

1. **Keskitaso, vanhan putken regressio:** uusinta tehtiin myös vanhalle putkelle. Vanha ydin käsittelee uusinnassa vain
   uusimman viestin ja kirjaa jokaisen vastauksensa lähetetyksi (`wa_dialogue`n historia, `lastOrder`, näytetty lista), joten
   hylätty vastaus ei mennyt koskaan perille. Esimerkki: "ok" muodostaa korilinkin, käsittelyn aikana tulee "kiitos", ja
   kierros r1 vastaa "Ole hyvä…" ilman linkkiä.
   - **Korjaus:** kanavan uusi asetus `redo` (totuusarvo tai async-funktio), oletus pois. `runtime.mjs` kytkee sen
     `redoWhenAgent(ordering)`-funktiolla, joka on tosi vain, kun `ordering.usesAgent()` on tosi, eli kun `WHATSAPP_AGENT=v2`
     ja agentti on käytössä. Pelkkä ympäristömuuttuja ei riitä, koska v2-asetus ilman API-avainta käyttää vanhaa putkea
     (`server/agent/index.mjs`).
   - Vanhalle putkelle jää 6 s niputus, ja sen vastaus lähtee aina. Virhe tuen tarkistuksessa ei kaada valmista vastausta.
     Tuki tarkistetaan ennen kantakutsuja, joten vanha putki ei tee uusinnan takia yhtään ylimääräistä kantakutsua.
2. **Matala, pilven aikaraja:** drain saattoi ottaa uuden työn juuri ennen 240 s:n rajaa. v2-vuoro voi kestää yli minuutin,
   jolloin Vercelin 300 s:n raja katkaisi sen, ja työ odotti 6 minuutin käsittelyvarauksen.
   - **Korjaus:** `drain(budgetMs, { reserveMs })`, ja `server/cloud.mjs` antaa `TURN_RESERVE_MS = 90_000`. Uutta työtä ei
     oteta eikä uusintaa aloiteta, kun drainin aikaa on alle 90 s. Webhookin drain (240 s) ottaa siis uutta työtä 150 s
     ajan ja tick (120 s) 30 s ajan.
   - Uusi työ ehtii aina niputtaa (enintään 20 s) ja aloittaa mallikutsun vähintään 70 s ennen drainin rajaa, eli
     vähintään 130 s ennen katkaisua. Vuoron oman ylärajan pitää v2-agentti.

## Päätökset ja syyt

1. **Uusinnan viimeinen käyttäjävuoro on vain uudet viestit, ei koko teksti.** Tilallinen putki on jo kirjannut ensimmäisen
   viestin, joten koko tekstin uudelleenluku kirjaisi sen toiseen kertaan. Katselmuksen jälkeen uusinta koskee vain
   v2-agenttia, joka lukee `incoming`-kentän ja jättää jo kirjatut viestit pois (`freshIncoming`). `messages`-muoto on
   varalla muille lukijoille: malli, joka lukee koko historian, näkee molemmat käyttäjävuorot, ja Messages
   API yhdistää peräkkäiset käyttäjävuorot yhdeksi.
2. **Uusintaa ei tehdä, ja vastaus lähtee kuten ennen**, kun:
   - uusi viesti on kuva, ääniviesti, linkki, "tuki", yhdistämiskoodi tai toisen asiakkuuden viesti
   - vuoron oma viesti on linkki, kuva tai ääniviesti
   - vuorossa syntyi tilaus (`confirmed` tai `pending_approval`), koska siitä pitää aina kertoa asiakkaalle
   - numero peruttiin, aikaa on alle varauksen tai kanava pysähtyy
   - chat ei tue uusintaa (päätös 6).

   Tuki-, kuva-, ääni-, linkki- ja yhdistämispolkujen piti säilyä ennallaan. Linkin vastaus (reseptin ainekset) ja
   linkin odotusviesti ovat asiakkaalle tärkeitä, joten niitä ei hylätä.
3. **Uusintayritys liittää uudet viestit vasta chat-kutsun jälkeen uutena kierroksena.** Edellinen yritys on voinut jo
   ajaa saman kierroksen, ja putki palauttaa silloin saman `messageId`:n tallennetun tuloksen ilman uusia viestejä. Ilman
   uusintatukea viestit saavat oman vuoronsa. Muutos korjaa samalla vanhan virheen: aiemmin uusintayrityksen niputus liitti
   viestit samaan `messageId`:hen, vanha putki palautti tallennetun vastauksen, ja liitetyt viestit jäivät käsittelemättä.
4. **Viimeisellä yrityksellä kaatunut uusinta lähettää vakiovirheviestin** ("Viestin käsittely ei nyt onnistunut … Lähetä
   viesti hetken kuluttua uudelleen"), ei hylättyä vastausta. Hylätty vastaus ei huomioi uusia viestejä, eivätkä ne tule
   enää omana vuoronaan.
5. **Ennen uusintaa ei odoteta.** Uudet viestit luetaan heti, kun vastaus valmistuu. Niputuksen 6 s odotus koskee vain
   ensimmäistä kierrosta.
6. **Uusinta vain v2-agentille** (katselmuksen korjaus 1). Vanha putki ei osaa käyttää hylättyä vastausta, ja se pitää
   jokaista vastaustaan lähetettynä. Sen vastaus lähtee siksi aina.

Eeliksen esimerkki: kun toinen viesti tulee 6 s kohdalla, se ehtii niputukseen molemmissa putkissa. Jos se tulee vasta
odotuksen jälkeen mallikutsun aikana, v2 hylkää vastauksen ja lukee viestin uusinnassa, joten asiakas saa yhden vastauksen.
Vanha putki lähettää ensimmäisen vastauksen ja vastaa uuteen viestiin omana vuoronaan.

## Pilven ajoaika

- Vercelin `maxDuration` on 300 s (`vercel.json`). Webhookin drain saa 240 s (`DRAIN_MS`) ja tick 120 s.
- Uutta työtä ei oteta eikä uusintaa aloiteta, kun drainin aikaa on alle 90 s (`TURN_RESERVE_MS`, `server/cloud.mjs`).
  Niputus ei odota drainin rajan yli. Rajan lähellä vuoro vain viimeistelee käynnissä olevan mallikutsun ja lähettää.
- Käsittelyvaraus `PROCESSING_LEASE_MS` (6 min) riittää pisimpäänkin vuoroon: niputus 20 s, kolme noin 60 s:n mallikutsua
  ja lähetys. `recoverStale` ei siis ota käynnissä olevaa vuoroa toiselle.

## Tarkistukset

- `test/whatsapp-gather.test.mjs` 26/26. Simuloitu kello, chat ja Meta, paitsi kirjoittaa-ilmaisimen testissä oikea kello.
  Testit:
  - kaksi viestiä 6 s välein tuotannon oletuksilla: yksi chat-kutsu ja yksi vastaus
  - chatin aikana tullut viesti: hylätty vastaus, `:r1`, `discardedReply`, molemmat `incoming`-viestit ja yksi vastaus
  - ilman uusintatukea (oletus, `false`, agentti ei vastaa, tarkistus kaatuu): vastaus lähtee ja uusi viesti saa oman
    vuoronsa
  - uusintaraja 2: kolmannen kutsun aikana tullut viesti saa oman vuoronsa
  - kesken uusinnan kaatunut vuoro jatkuu samasta uusinnasta
  - viimeisellä yrityksellä kaatunut uusinta lähettää virheviestin
  - "tuki" heti ilman niputusta, ja chatin aikana tullut "tuki" ei hylkää vastausta
  - kuva, linkki, linkkiviesti ja tilaus eivät käynnistä uusintaa
  - drainin raja ja varaus: niputus, uuden työn ottaminen ja uusinta
  - uusinnan aikana peruttu numero
  - kirjoittaa-ilmaisin jatkuu uusinnan ajan
  - oikea silta (`ordering.mjs`), luonnosmoottori ja vanha dialogi kytkettynä kuten `runtime.mjs`:
    - vanha putki lähettää ensimmäisen vastauksen eikä tee uusintaa, myös v2-asetuksella ilman agenttia
    - v2-agentti saa uusinnan, ja hylätty vastaus ja kaikki viestit kulkevat sillan läpi agentille.
- Uutta käytöstä koskevat testit kaatuivat ennen kumpaakin muutosta. Mutaatiot kaatoivat kukin vähintään yhden testin:
  - ensimmäinen muutos: kymmenen mutaatiota, esimerkiksi kolme uusintaa, koko teksti uusinnassa ja vanha 3 s oletus
  - katselmuksen korjaukset: kuusi mutaatiota, esimerkiksi uusinta oletuksena, tuen ohitus, drain ilman varausta ja
    runtime, joka sallii uusinnan aina.
- Muutetut testit:
  - `test/whatsapp-voice.test.mjs`: `gatherSettings`-oletukset ovat nyt 6000 ja 20000.
  - `test/shopping-list-order-api.test.mjs`: `WHATSAPP_GATHER_MS=0`. Koe käynnistää oikean palvelimen, ja 6 s odotus
    jokaisen viestin jälkeen ylitti sen 30 s aikarajan.
- Katselmuksen korjausten jälkeen:
  - `npm test` 633/633
  - CI:tä vastaava kopio ilman katalogia ja fontteja: 540 läpi, 93 ohitettu, 0 virhettä
  - Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58 ja `git diff --check`
- `server/cloud.mjs`:n 90 s:n varausta ei testata erikseen (asetusarvo). Pilven käsittelijän testi (tick 120 s) menee läpi.
- Ei mallikutsuja, julkaisuja eikä tuotantokantoja. Ei kokeiltu oikealla WhatsAppilla.

## Avoimet asiat

- **Koordinaattorille:** `docs/agent-v2.md`, kohta Niputus, sanoo vielä, että uusinta toimii sekä vanhalla putkella että
  v2:lla. Nyt uusinta koskee vain v2-agenttia (`redo`), ja niputus molempia.
- **v2-agentille:** `freshIncoming` tunnistaa uusinnan `:rN`-päätteestä ja jättää pois aiemmilla kierroksilla kirjatut
  viestit ajan ja tekstin perusteella. Tämä kanava pitää jokaisen viestin `at`-arvon samana kaikilla kierroksilla. `round`
  on ylimääräinen kenttä, ja uudet viestit saa myös suoraan: `incoming.filter((m) => m.round === incoming.at(-1).round)`.
  `receivedAt` on yhä vuoron ensimmäisen viestin aika. Kuvan ja ääniviestin `incoming` on yksi alkio, jonka teksti on
  kuvasta luettu tai litteroitu teksti.
- **Arvioinnille:** jos ajuri käynnistää oikean palvelimen (`runtime.mjs`), niputus odottaa nyt 6 s jokaisen viestin
  jälkeen. `scripts/whatsapp-selfplay*.mjs`-itsepelit luovat kanavan itse ilman niputusta ja ilman uusintaa.
