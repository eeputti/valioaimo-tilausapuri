# v2-agentti: silmukka, transkripti, vartija ja kytkentä (sessio v2-agentti)

19.11.2026. Suunnitelma ja sopimus: [docs/agent-v2.md](../agent-v2.md), kohdat Arkkitehtuuri, Agenttisopimus, Korilinkki,
Vartija ja Ohje. Haara `claude/agent-v2-loop-19da77`.

## Muutokset

- **`server/agent/index.mjs`**: `createAgent({ tools, db, client, model, effort, now })` ja `respond(...)` sopimuksen mukaan.
  Oma työkalusilmukka Messages API:lla (`client.beta.messages.create`, ei striimausta):
  - Vuoron käyttäjäviesti alkaa kontekstilohkolla (aika Europe/Helsinki, 15 päivän kalenteri viikonpäivineen, asiakas, kanava,
    onko korilinkki käytettävissä ja `tools.snapshot(ctx)`). Perään tulee `discardedReply`-huomautus ja jokainen asiakasviesti
    omana lohkonaan aikaleimoineen (`incoming`).
  - `stop_reason` tarkistetaan ennen työkaluja. `refusal`: työkaluja ei ajeta, asiakas saa lyhyen pahoittelun, ja jos
    kieltäytyminen tuli vuoron ensimmäiseen kutsuun, vuoro jätetään transkriptista pois. `max_tokens`: katkennutta vastausta ei
    lähetetä takaisin eikä sen työkaluja ajeta. Malli kirjoittaa kerran uudelleen ilman työkaluja (`tool_choice: none`).
  - Saman vastauksen kaikki `tool_result`-lohkot yhteen käyttäjäviestiin järjestyksessä. Epäonnistunut, tuntematon tai
    poikkeuksen heittänyt työkalu palautuu `is_error`-merkinnällä, ja silmukka jatkuu.
  - Assistentin sisältö menee takaisin muuttamattomana thinking-lohkoineen. Ainoa poikkeus on dokumentoitu fallback-raja: jos
    vastauksessa on `fallback`-lohko, sitä edeltävät thinking- ja tool_use-lohkot jätetään pois. Ilman striimausta API ei
    palauta niitä, joten käytännössä sisältö pysyy aina sellaisenaan.
  - Rajat: enintään 8 työkalukierrosta ja noin 60 s. 45 s:n jälkeen tai kahdeksannen kierroksen jälkeen malli kirjoittaa
    viimeisen vastauksen ilman työkaluja. Kutsukohtainen aikaraja on 15–45 s.
  - Vastaus jaetaan 1–3 viestiin rivillä, jossa on pelkkä `---`.
  - `status` = `ready`, kun `snapshot().checklist.ready`, muuten `collecting`. `draftId` ja `revision` tulevat vuoron lopun
    tilannekuvasta.
  - `requestCartLink` = tässä vuorossa onnistunut `send_cart_link` ilman myöhempää korin muutosta, ja tarkistuslista on yhä
    valmis. Jos korilinkki ei ole kanavassa käytettävissä, kutsua ei ajeta ja malli saa `CART_LINK_UNAVAILABLE`.
  - Pyynnön asetukset: malli `WHATSAPP_AGENT_MODEL` (oletus `claude-opus-5-5`), `output_config.effort` asetuksesta
    `WHATSAPP_AGENT_EFFORT` (oletus `medium`), ajattelu `adaptive` ja `block_binding.prefix_mismatch_behavior: "drop_block"`
    (beta `thinking-binding-controls-2026-08-01`), `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) Opukselle
    ja Sonnetille mutta ei Haikulle. Ei `temperature`-asetusta eikä `disabled`-ajattelua. Välimuisti: järjestelmäohjeessa
    `cache_control` (1 h) ja pyynnön ylätasolla automaattinen merkintä, joka osuu viimeiseen viestiin.
  - Jos betapyyntö hylätään (400), sama pyyntö lähtee kerran ilman beta-ominaisuuksia, ja jos se onnistuu, agentti muistaa
    sen. Jos vuoron ensimmäinen kutsu hylätään molemmilla tavoilla ja historiaa on, aiempi historia ohitetaan kerran, ettei
    rikkinäinen transkripti kaada keskustelua pysyvästi. Rivit jäävät kantaan.
  - Laskurit: samat `agentStats`-kentät kuin `server/aimoAgent.mjs`:ssä, tarkoitus `whatsapp_agent`. Fallback-ajossa
    tokenit lasketaan `usage.iterations`-kentästä.
  - Loki vain pilvessä (`VERCEL`), ilman tekstiä: `agent_turn`, `agent_tool_failed`, `agent_plain_requests`,
    `agent_history_reset` ja `agent_snapshot_failed`.
- **`server/agent/transcript.mjs`**: transkripti luonnoskannan tauluun `agent_transcript`, vain lisäämällä:
  - Anthropic-viestit sellaisinaan (myös thinking-, tool_use- ja tool_result-lohkot).
  - Koko vuoro ja sen tulos kirjoitetaan yhdessä transaktiossa. Tulos menee samaan `turn_results`-tauluun kuin vanhan putken
    vuoroilla, joten agentin jälki (`deploy/cloudflare/trace-reader.mjs`) ja korisivun tarkistukset löytävät v2:n vuorot.
  - Sama `messageId` palauttaa tallennetun tuloksen ilman mallikutsua, myös uuden prosessin jälkeen. Rinnakkaisessa
    tuplavuorossa ensimmäinen tulos jää voimaan.
  - Lyhennys vain alusta ja käyttäjävuoron rajalta (`agent_window`): kun ikkunassa on yli 30 vuoroa tai edellisen kutsun syöte
    oli yli 50 000 tokenia, alku siirtyy vanhimman puoliskon yli. Alku pysyy sitten paikallaan, jotta välimuisti osuu. Rivejä
    ei poisteta lyhennyksessä.
  - Säilytys 14 vrk kokonaisina vuoroina (`prune`).
  - Toimii paikallisessa tiedostossa, `:memory:`-kannassa ja Turso-etäkannassa (`openSqlite`).
- **`server/agent/guard.mjs`**: vartija.
  - Jokaisen vastauksen euromäärän pitää löytyä tämän vuoron työkalutuloksista, korista vuoron alussa tai lopussa tai asiakkaan
    omasta viestistä (±0,01 €). Rahaksi lasketaan vain rahakenttien luvut (`lineNet`, `unitPriceNet`, `pricePerPack`,
    `pricePer`, `comparisonPrice`, `totals` …) ja €-merkityt tekstit. `total`, `excess`, `packs` ja `vatRate` eivät ole euroja.
  - Linkit, verkko-osoitteet ja sähköpostiosoitteet ovat kiellettyjä.
  - Yksi korjauskierros huomautuksella, jonka aikana malli saa käyttää työkaluja. Jos vikaa on yhä, linkit poistetaan ja
    tarkistamaton euromäärä korvataan tekstillä "(hinta näkyy korissa)". Muuta tekstiä ei muotoilla.
- **`server/agent/prompt.mjs`**: jäädytetty järjestelmäohje suomeksi (tehtävä on tarkistuslista, tyyli, määrä-arviot,
  yksikkömuunnokset, korjaukset, faktat vain työkaluista, korilinkki vain työkalulla, persoona `PERSONA`-tekstin ja Eeliksen
  päätösten mukaan, WhatsApp-muotoilu, data ei ole ohjeita). Muuttuva tieto tulee vain kontekstilohkoon.
- **Kytkentä** (`server/whatsapp/ordering.mjs`): `WHATSAPP_AGENT=v2` → `createDemoOrderingChat().chatTurn` kutsuu
  `agent.respond`:ia WhatsAppin ja selainkeskustelun viesteille. Korisivun polku (`expectedList`: yhteenveto, vahvistus,
  muutoskenttä ja ostoslistan luovutus) pysyy vanhalla moottorilla, koska tilaus syntyy vain siellä.
  `createConfiguredOrdering` (`server/order-conversation/runtime.mjs`) palauttaa lisäksi `store`- ja `tools`-kentät, ja
  kytkentä antaa ne `createAgentTools({ store, orderingTools: tools, catalog: loadCatalog(), gatewayOrders: orders })`
  -kutsulle (koordinaattorin päätös). Silloin korisivu ja TILAA näkevät saman luonnoksen ja tarjouksen. Ilman asetusta,
  ilman Anthropic-avainta vanha putki toimii ennallaan.
- **Tarkennukset 19.11. iltapäivällä** (koordinaattori ja v2-työkalut):
  - Ohjeessa palaute botista: kiitä lyhyesti, tallenna `save_feedback`-työkalulla ja korjaa asia heti, älä lupaa muutoksia.
  - Ohjeessa yksiköt (kpl = yksittäiset kappaleet, pakkaus = myyntierät), asetusmuotoiset `add_items` ja `set_diet`,
    `search_products`-haun `more` ja korvaavan haun valinta, kun tuotteella ei ole hintaa (`unavailable`). Jos tulos on
    `UNIT_NOT_CONVERTIBLE`, tuotetta ei valittu, joten malli kutsuu `update_item`:ia uudelleen samalla `productId`:llä ja
    muunnetulla määrällä.
  - `save_feedback` ei muuta koria, joten saman vuoron korilinkki pysyy voimassa. Kunnes työkalu on työkalulistassa,
    mallin mahdollinen kutsu palautuu `UNKNOWN_TOOL`-virheenä (`is_error`).
  - `ctx.links`: `read_link` avaa vain asiakkaan itse lähettämät linkit (tämä vuoro ja aiemmat asiakasviestit ikkunassa),
    ei työkalujen tuloksissa tai sivuilla olevia.
  - `ctx.messageId`: työkalut liittävät sen luonnoksen tallennusten tunnisteisiin.
- **Korilinkki** (`server/whatsapp/cart-link.mjs`): v2:ssa vanha korilinkkilogiikka ohitetaan. Kun tulos sisältää
  `requestCartLink` ja nykyinen luonnos on sama ja valmis (`review`), viimeisen viestin loppuun lisätään linkki uudelle
  riville nykyisellä `issue`-funktiolla. `createMetaSender` näyttää sen painikkeena "Avaa ostoskori". Jos luonnos ehti muuttua,
  linkkiä ei lisätä, ja viestiin tulee sama huomautus kuin vanhassa putkessa ("Ostoskorilinkki ei nyt avaudu …").
- **`.env.example`**: `WHATSAPP_AGENT`, `WHATSAPP_AGENT_MODEL` ja `WHATSAPP_AGENT_EFFORT` sekä niputuksen uudet oletukset
  (6000 ja 20000, niputuksen pyynnöstä).

## Päätökset ja syyt

1. **Tulos `turn_results`-tauluun samassa transaktiossa kuin transkripti.** Idempotenssi on tarkka: jos vuoro on
   transkriptissa, sen tulos on olemassa. Samalla agentin jälkisivu ja `hasTurnResult` toimivat v2:n vuoroilla ilman muutoksia.
2. **Keskeytynyt vuoro ei tallennu.** Jos kutsu kaatuu (verkko, aikaraja), kanava uusii vuoron samalla tunnisteella ja malli
   ajetaan uudelleen. Työkalut ovat asetusmuotoisia, joten kori ei tuplaannu, ja malli näkee korin nykytilan kontekstilohkosta.
   Transkriptiin ei koskaan jää vastaamatonta `tool_use`-lohkoa.
3. **Korisivu pysyy vanhalla moottorilla.** SIIRRY MAKSAMAAN -polku (tuore tarjous ja vahvistus) on ainoa paikka, jossa tilaus
   syntyy, ja se toimii samalla luonnoksella. Korisivun muutoskenttä kulkee myös vanhan moottorin kautta. Agentti näkee
   muutokset seuraavan vuoron kontekstilohkosta.
4. **Välimuistimerkintä pyynnön ylätasolla** eikä viestilohkossa, jotta tallennettu transkripti pysyy tavu tavulta samana.
5. **Vartijan jälkeinen korjaus on minimaalinen.** Yhden korjauskierroksen jälkeen väärää hintaa ei lähetetä, mutta muu teksti
   jää mallin omaksi. Asiakas näkee oikeat hinnat korisivulla.
6. **Kieltäytynyt ensimmäinen kutsu jätetään transkriptista pois**, ettei sama sisältö kaada seuraavia vuoroja. Jos työkaluja
   ehdittiin ajaa, vuoro tallennetaan ja perään kirjataan, mitä asiakas sai.
7. **Niputuksen uusinta (`:r1`) näyttää vain uudet viestit** ja huomautuksen hylätystä vastauksesta. Vanhat viestit tunnistetaan
   aiempien kierrosten tuloksista (aika ja teksti). Kierros, joka ei päätynyt transkriptiin, ei piilota viestejään.

## Tarkistukset

- Uusi `test/agent-loop.test.mjs` (24 testiä, käsikirjoitettu malliasiakas ilman verkkoa, väliaikainen työkaluolio
  sopimuksen mukaan): työkalukierros ja rinnakkaiset tulokset, pyynnön asetukset (myös Haiku ilman fallbackia), epäonnistuneet
  työkalut, `refusal` (myös työkalukierroksen jälkeen), `max_tokens`, idempotenssi uudessakin agentissa, transkriptin
  pysyvyys ja append-only, vartijan korjauskierros ja korjaus, sallitut euromäärät, `discardedReply` ja uusinnan
  viestit, korilinkki vain onnistuneen `send_cart_link`-kutsun jälkeen, kierros- ja aikaraja, ikkunan lyhennys, 400-uusinnat,
  vartijan yksikkötestit, kytkentä (vanha putki ilman asetusta, v2 WhatsAppissa ja selaimessa, korisivu vanhalla
  moottorilla) ja korilinkin lisäys `cart-link.mjs`:ssä.
- Testejä on nyt 26: lisäksi palautetyökalu ja korilinkki samassa vuorossa sekä `read_link`-linkkien rajaus.
- Mainin (niputus 00d9f3a, v2-työkalut dbba2de ja skeemakorjaus 3872ae7, main 696f98f) kanssa yhdistettynä `npm test` 623/623,
  `aimo:eval` 26/26, `aimo:eval:spoken` 58/58 ja `git diff --check` puhdas. Workerin testejä ei ajettu, koska Worker ei muuttunut
  eikä worktreessä ole sen riippuvuuksia.
- Niputus ja agentti yhdessä (väliaikainen kokeilu oikealla kanavalla): mallikutsun aikana tullut viesti → yksi vastaus, ja
  uusinta näki vain uuden viestin ja huomautuksen hylätystä vastauksesta.
- Kytkentä ilman mallikutsuja: oikea runtime, oikeat v2-työkalut, oikea katalogi ja simuloidut hinnat sekä käsikirjoitettu
  malli, joka luki oikeat työkalutulokset. Tulokset:
  - Vartija hyväksyi oikeat summat (`totals.net`).
  - `status` ja tarkistuslista vastasivat korisivun `review`-tilaa, `draftId` ja `revision` olivat samat kuin ostoslistalla.
  - `send_cart_link` → linkki viimeisen viestin loppuun painikkeena.
  - `getStorefrontCart` oli `ready`.
  - 50 kpl sipulia → `UNIT_NOT_CONVERTIBLE` → 6 kg.
- Pysyvä 400-virhe: vuoroa ei tallennettu, ikkuna ei muuttunut, ja sama viesti onnistui, kun API hyväksyi pyynnön.

## Savukoe oikealla mallilla

Asetukset: `claude-opus-5-5`, effort `medium`. Koko WhatsApp-polku: kanava → `cart-link.mjs` → `ordering.mjs` → agentti →
työkalut. Eristetyt väliaikaiset kannat, simuloidut Valion hinnat (`VALIO_API_KEY` tyhjä) ja simuloitu Meta, jossa lähetykset
menevät muistiin. Kello `DEMO_NOW` 19.11. klo 8.38 kuten Eeliksen keskustelussa. Ei tilauksia eikä WhatsApp-viestejä. Ajuri on
väliaikainen skripti, ei repossa (arviointi tekee varsinaisen ajurin). Kulut ovat ylärajoja: kaikki välimuistiin kirjoitukset
on laskettu 1 h:n hinnalla.

1. **Ensimmäinen ajo kaatui heti.** API hylkäsi työkalulistan: 400 "Enum value 'kg' does not match declared type
   ['string', 'null']". Syy oli `nullable(UNIT)` tiedostossa `tools.mjs`. Kokeilin oikealla API:lla kahta muotoa, ja
   v2-työkalut korjasi asian commitissa 3872ae7 (enum ilman type-kenttää). Samalla varmistui, että agentin pyyntö kelpaa
   API:lle: betat, `fallbacks: "default"`, `drop_block` ja välimuistimerkinnät. Kokeilujen kulu noin 0,14 $.
2. **Eeliksen keskustelu (peruna, sipuli ja kerma 50 hengelle), skeemakorjaus tehty ajonaikaisesti:**
   - Ajo A, 2 vuoroa: 22 s ja 16,5 s, 8 mallikutsua, ≤0,25 $. Ensimmäinen vastaus: "Moi Eelis! Mä oon Valio Aimon digitaalinen
     tilausapuri, ja hoidetaan tää tilaus kuntoon." Malli arvioi määrät itse 50 hengelle (peruna noin 12 kg, sipuli noin 3 kg ja
     kerma noin 4 l), antoi vaihtoehdot hintoineen ja kysyi käyttötarkoituksen ja allergiat. Toisessa vuorossa se kirjasi
     allergiattomuuden, kertoi, että tälle päivälle löytyi vain laktoositonta ruokakermaa, näytti korin ja summat
     ("Yhteensä 50,27 € (alv 0 %) eli 57,06 € verollisena") sekä tilausajan ja lähetti korilinkin.
   - Ajo B, 3 vuoroa: 7,9 s, 11,9 s ja 12,6 s, 7 mallikutsua, ≤0,17 $. Kun ehdotus oli näytetty, asiakas kirjoitti "50 sipulia":
     "50 sipulia on noin 6 kg, joten laitoin koriin 6 kpl 1 kg:n pusseja." Kori oli valmis, ja linkki lähti samassa vuorossa.
     Kori: peruna 2 × 5 kg, sipuli 6 × 1 kg ja ruokakerma 4 × 1 l, yhteensä 51,80 € (alv 0 %).
3. **Vahvistus tuotannon polulla** (`createConfiguredAgent`, korjattu `tools.mjs`, ei ajonaikaista muunnosta, ajo C):
   - 2 vuoroa: 26,6 s ja 9 s, 8 mallikutsua, ≤0,23 $. 20 l maitoa ja 5 kg voita maanantaiksi.
   - Palaute "Vastaat aina tosi pitkästi, pitäisikö bottia muuttaa?" → `save_feedback` (kind `idea`) → "Kiitti palautteesta,
     välitin sen tiimille! Pidetään tää lyhyenä:", lyhyt kori, summa ja linkki.

Kaikissa ajoissa:
- Vartija ei puuttunut kertaakaan, koska kaikki euromäärät tulivat työkaluista.
- Ei virheitä eikä beta-ominaisuuksien poistoa.
- Välimuistista luettiin 83–89 % syötteestä.
- Viive 8–27 s vuorossa, keskimäärin noin 15 s.
- Yhteensä noin 0,79 $ (yläraja), budjetti 1,5 $.

Havainnot arvioinnille:
- Aloitukset ja sanamuodot vaihtelivat ajojen välillä, eikä pohjatekstejä ollut. Malli puhutteli asiakasta yhteyshenkilön
  etunimellä ("Moi Eelis!"), koska nimi on kontekstilohkossa.
- Viestit ovat pitkähköjä ja yleensä yksi viesti vuorossa: malli ei käyttänyt `---`-jakoa.
- Kahdesti malli teki valinnan asiakkaan puolesta ja lähetti linkin:
  - Ajo B: "50 sipulia" tulkittiin myös muiden ehdotusten hyväksynnäksi.
  - Ajo C: "laita se linkki" ilman maidon valintaa → halvin maito.
  - Molemmissa malli tarjoutui vaihtamaan, ja asiakas tarkistaa korin korisivulla. Kannattaa arvioida, onko tämä toivottua.
- Opuksella vuoro vie 3–5 mallikutsua. Sonnet ja Haiku olisivat nopeampia, ja arviointi vertaa niitä.

## Viive: mistä 3–5 mallikutsua ja noin 15 s syntyvät (selvitys ilman mallikutsuja, ei toteutettu)

Koordinaattorin pyynnöstä 19.11. Aineisto: savukokeiden A–C seitsemän vuoroa (23 mallikutsua). Työkalukutsut toistettiin
samoilla syötteillä oikeilla v2-työkaluilla ja agentin silmukalla, ja malli oli käsikirjoitettu ja välitön. Kanta oli
paikallinen SQLite, hinnat simuloituja.

**1. Melkein koko viive on mallikutsuja.** Agentin oma työ oli toistossa yhteensä 0,3 s eli 0,3 % vuorojen 106,6 sekunnista
(työkalut, tilannekuvat, transkriptin luku ja kirjoitus). Hitain työkalu oli päivän ensimmäinen haku, 181 ms.

**2. Kutsujen määrä tulee työkalujen riippuvuuksista.** Vuoro = työkalukierrokset + 1, koska vastaus kirjoitetaan vasta, kun
malli on nähnyt tulokset. Malli kutsui jo itsenäiset työkalut samalla kierroksella (esim. kaikki haut kerralla), joten
kierrokset johtuvat riippuvuusketjusta:
- `add_items` antaa rivien ref-tunnukset ennen hakua.
- Haku antaa tuotenumerot ennen valintaa (`update_item`).
- Valinta tekee korista valmiin ennen linkkiä (`send_cart_link`).
- Esimerkki C1 (5 kutsua): päivä, ruokavalio ja rivit → kaksi hakua → kaksi tarkennettua hakua → voin valinta → vastaus.
- Esimerkki A2 (5 kutsua): ruokavalio ja kerman haku → kaksi valintaa ja lisähaku → kerman valinta → linkki → vastaus.
- Kaikissa kolmessa linkin lähettäneessä vuorossa (A2, B3, C2) `send_cart_link` sai oman kierroksensa viimeisen valinnan
  jälkeen.

**3. Yhden kutsun kesto on noin 0,9 s + 7,8 ms jokaista tulostokenia kohden** (noin 128 tokenia/s, pienimmän neliösumman sovitus
lämpimän välimuistin viiteen vuoroon, poikkeama enintään noin 1,6 s). Tulostokeneita oli keskimäärin 366 kutsua kohden:
ajattelu, työkalujen syötteet ja vastausteksti, jonka pituus oli 400–690 merkkiä. Tokenien osuus vuoroajasta oli noin 62 % ja
kutsujen kiinteän osan noin 20 %.

**4. Kylmä välimuisti lisäsi noin 9 s.** Ajojen ensimmäiset vuorot A1 (22 s) ja C1 (27 s) kirjoittivat järjestelmäohjeen ja
työkalut (noin 8 500 tokenia) välimuistiin. Ne olivat kumpikin noin 9,4 s sovitusta hitaampia. Tuotannossa tämä etuliite on
kaikille asiakkaille sama ja 1 h:n välimuistissa, joten se on yleensä lämmin. Keskustelun oma historia on kuitenkin vain 5 min
välimuistissa. Kun asiakas vastaa yli 5 minuutin päästä, vuoron ensimmäinen kutsu lukee koko historian uudelleen ilman
välimuistia (WhatsAppissa tavallista).

**5. Tuotannon kantakierrokset (arvio, mittaamatta pilvessä).** Päivän ensimmäinen haku ajoi paikallisesti 200–400
SQL-lausetta, ja toistossa lauseita oli keskimäärin 216 vuoroa kohden. Valtaosa tuli hintavälimuistista: `api_cache`-taulun
haku ja kirjoitus tuotteittain (434 kumpaakin) ja `kv`-haku (213). `fetchQuotes` lukee välimuistin tuotteittain kaikissa
tiloissa, ja muistissa oleva välimuisti auttaa vain lämpimässä instanssissa. Turso-kannassa (fra1 ja Frankfurt) jokainen
lause on oma verkkokierroksensa. Jos kierros kestää 5–15 ms, kylmän instanssin ensimmäinen haku vie arviolta 1–6 s. Sama koskee
vanhaa putkea, koska haku tehdään samalla `order-tools`-kerroksella. Simuloidussa tilassa lauseita on enemmän kuin tuotannon
last-known-tilassa, joten tämä pitää mitata pilvessä.

Ehdotukset viiveen pienentämiseen, suuruusjärjestyksessä (ei toteutettu, odottavat arviointia ja päätöstä):

1. **Linkki samalla kierroksella kuin viimeinen valinta.** Työkalut ajetaan järjestyksessä, joten `update_item` ja
   `send_cart_link` voivat olla samassa vastauksessa. Jos valinta epäonnistuu, linkkiä ei tule (`ok: false`). Muutos olisi yksi
   rivi ohjeeseen. Säästö noin 1 kutsu (3–5 s) jokaisessa linkin lähettävässä vuorossa.
2. **Haku ilman omaa kierrosta.** `add_items` voisi palauttaa uusille riveille valmiiksi 3 vaihtoehtoa, kun päivä tiedetään.
   Toinen vaihtoehto on parempi ensimmäinen haku, jottei tarkennettua hakua tarvita (C1). Muutos v2-työkaluihin. Säästö noin
   1 kutsu tuotteita lisäävässä vuorossa.
3. **Nopeampi tulostus.** Opus 5.5:n fast mode (`speed: "fast"`) tuottaa tokeneita jopa 2,5 kertaa nopeammin kaksinkertaisella
   tokenihinnalla. Tokenien osuus on noin 62 %, joten vuoro lyhenisi arviolta 35–40 % (15 s → noin 9–10 s) ja hinta nousisi
   noin 0,09 $:sta noin 0,18 $:iin vuorolta (ajojen A–C yläraja 0,65 $ seitsemälle vuorolle). Tämä voisi olla asetus, esim.
   `WHATSAPP_AGENT_SPEED=fast`. Yhteensopivuus `fallbacks`-parametrin kanssa pitää kokeilla. Vaihtoehtona Sonnet 5.5 tai
   Haiku 5.5, joita arviointi vertaa.
4. **Vähemmän tulostokeneita.**
   - Effort `low` vähentää ajattelua kaikilla kierroksilla. Laatu pitää mitata arvioinnissa.
   - Lyhyemmät vastaukset: Eelis antoi saman palautteen kokeessa C ("vastaat aina tosi pitkästi").
   - Kumpikin muutos koskee ohjetta tai asetusta, joten ne odottavat arviointia.
5. **Keskustelun välimuisti 1 h:ksi.** Ylätason `cache_control: { type: 'ephemeral', ttl: '1h' }` pitää historian lämpimänä
   asiakkaan tauon yli. Kirjoitus maksaa 2 × syöte (nyt 1,25 ×), mutta yli 5 minuutin tauon jälkeen koko historiaa ei kirjoiteta
   uudelleen. WhatsAppissa tämä on todennäköisesti sekä nopeampi että halvempi. Pitää mitata `cache_read`- ja
   `cache_creation`-kentistä.
6. **Hintavälimuistin luku yhdellä kyselyllä.** `fetchQuotes` voisi lukea kaikki tuotteet yhdellä `key IN (…)`-kyselyllä
   kumpaakin lajia kohden tuotekohtaisten kyselyjen sijaan. Sama hyöty vanhalle putkelle. Tiedostot `server/valioApi.mjs` ja
   `server/db.mjs` eivät ole minun.
7. **Mittaus pilveen ensin.** `agent_turn`-lokiin mallin ja työkalujen aika erikseen sekä tulostokenit. Silloin kohdat 5 ja 6
   voi päättää tuotannon luvuilla.

Tila 19.11. illalla: koordinaattori valitsi kohdat 1, 5, 6 ja 7 samaan korjauserään merkkikorjauksen kanssa (kohta
Korjauserä). Kohdat 2–4 odottavat arvioinnin mallivertailua, jossa ratkaisevat hinta, viive ja laatu. Mallin valitsee Eelis.

Lukevien työkalujen rinnakkaisajosta ei ole juuri hyötyä, koska työkalut veivät 0,3 % ajasta. Haku myös kirjaa näytetyt
vaihtoehdot luonnokseen (`more`), joten rinnakkaiset haut samaan luonnokseen vaatisivat lisäksi lukituksen.

## Korjauserä 19.11. (valmisteltu haaraan, ei mainissa ennen koordinaattorin pyyntöä)

1. **Keksitty Valio-merkki** (arviointi, Haiku 5.5 medium, E1): korissa luki "25 kpl Valio-kiinteää perunaa 2 kg pusseissa",
   vaikka tuote 471033 on Pietilän Perunan PP KIINTEÄ PERUNA 2KG PUSSI PESTY (merkki null). Työkalu antoi nimen oikein, eli
   "Valio" tuli mallilta.
   - Ohje (`prompt.mjs`, Faktat): "Tuotteiden nimet ja merkit vain täsmälleen työkalun tuloksesta. Älä liitä tuotteeseen
     Valiota tai muuta merkkiä, jota tuloksessa ei ole. Älä myöskään väitä tuotetta Valion tuotteeksi, vaikka palvelu on
     Valio Aimo."
   - Vartija (`guard.mjs`, `brandClaims`) tarkistaa Valio-maininnat tämän vuoron tuotteita vasten ilman merkkilistaa:
     - Katalogin perusteella Valion merkkisillä tuotteilla on aina nimessä "Valio" ja merkkinä Valio.
     - Toimittajaa ei lueta merkiksi, koska "VALIO OY / VALIO AIMO" on monella muullakin tuotteella.
     - Väite hylätään, kun Valion jälkeinen ensimmäinen sisältösana (vähintään 4 kirjainta) löytyy tämän vuoron tuloksista vain
       muiden kuin Valion tuotteiden nimistä.
     - Eivät ole väitteitä: palvelun nimi (Valio Aimo …), "Valion valikoima" ja "Valion hinnat" (sana ei ole tuotenimissä),
       kielteiset lauseet, kun asiakas puhui itse Valiosta, ja "ja"- tai välimerkkirajan takana oleva toinen tuote.
     - Yksi korjauskierros kuten euroille. Jos väite jää, Valio-sana poistetaan ("Valio-kiinteää perunaa" → "kiinteää
       perunaa").
   - Väärät hälytykset tarkistettiin oikealla aineistolla: savukokeiden A–C kaikki vastaukset ja niiden oikeat työkalutulokset
     (toistettu ilman mallia). 14 Valio-mainintaa, 0 väärää hälytystä, ja bugilause liputettiin jokaisen vuoron
     tuoteyhteydessä.
2. **Linkki samalla kierroksella** (viive, ehdotus 1): ohjeeseen "Kun viimeinen valinta tekee korista valmiin, kutsu
   send_cart_link samassa vastauksessa heti viimeisen update_item-kutsun perään: työkalut ajetaan järjestyksessä, ja jos
   jotain vielä puuttuu, linkkiä ei lähetetä."
3. **Keskustelun välimuisti 1 h** (ehdotus 5): pyynnön ylätason merkintä `cache_control: { type: 'ephemeral', ttl: '1h' }`,
   kuten järjestelmäohjeessa.
4. **Hintavälimuistin luku yhdellä kyselyllä** (ehdotus 6). Muutos koskee myös vanhaa putkea, koska haku ja tarjous kulkevat
   saman `fetchQuotes`-funktion kautta.
   - `server/db.mjs`: uusi `apiCache.getMany(keys)`, joka hakee rivit `key IN (…)`-kyselyllä, enintään 500 avainta kyselyä
     kohden.
   - `server/valioApi.mjs`: `fetchQuotes` hakee kaikkien tuotteiden avaimet kerralla (`prefetch`). `cacheRead` ei kysy
     uudelleen avaimia, jotka on jo haettu. Sama joukko kelpaa myös virhepolun vanhoille arvoille.
   - Uusi `test/valio-cache-batch.test.mjs` (4 testiä, kaikki kaatuivat ennen muutosta), muun muassa: välimuistin rivit yhdellä
     kyselyllä ilman rajapintaa, puuttuvat haetaan rajapinnasta, katkoksessa vanhat arvot samasta kyselystä merkittyinä, ja 600
     avainta jakautuu kahteen kyselyyn.
   - Toistossa tuotekohtaiset `api_cache`-haut (434) poistuivat, ja SQL-lauseet vähenivät 1515:stä 1086:een eli 216:sta 155:een
     vuorossa.
   - Jäljelle jäivät:
     - Simulaatiotilan omat kirjoitukset ja `kv`-haut, joita ei ole tuotannossa.
     - Tuotannon last-known-tilassa `serveLastKnown` ajaa yhä tuotekohtaisen `LIKE`-kyselyn kummallekin lajille
       (`apiCache.latest`). Se on seuraava ehdokas, esimerkiksi muistiin tai yhdellä kyselyllä, mutta pitää mitata ensin.
5. **Kestot lokiin** (ehdotus 7): `agent_turn` sisältää nyt kentät `modelMs`, `toolMs`, `rounds` ja `cacheWrite`, ja vuoron
   tulos sisältää kentät `agent.modelMs` ja `agent.toolMs`. Vain kestot ja määrät, ei tekstiä, numeroita eikä tunnisteita
   (testi varmistaa kentät).

6. **Tervehdysten vaihtelu** (arviointi: avausten samankaltaisuus 0,48–0,67, vanhalla putkella 0,32–0,38).
   - Kaikki v2-mallit käyttivät samaa runkoa, koska malli ei näe muita keskusteluja. Vaihtelu tulee siksi syötteestä eikä
     pohjista.
   - Keskustelun ensimmäisen vuoron tietoihin tulee rivi "Sävy tähän keskusteluun: rento. Kirjoita sillä sävyllä omin sanoin,
     älä mainitse sävyä."
   - Sävy arvotaan viidestä (innostunut, rento, lämmin, napakka, leikkisä) keskustelun ja viestin tunnisteesta, joten
     uusittu vuoro saa saman sävyn.
   - Rivi tallentuu transkriptiin, joten sävy pysyy keskustelun ajan. Myöhempiin vuoroihin ei tule uutta sävyä.
   - Ohjeeseen: "Kun keskustelu alkaa, avaa omin sanoin vuoron tietojen sävyllä. Käytä vuorokaudenaikaa, viikonpäivää tai
     asiakkaan omaa tervehdystä. Älä aloita joka keskustelua samalla rungolla (esimerkiksi aina "Moi! Olen …"). Esittely
     Valio Aimon digitaalisena tilausapurina kuuluu ensimmäiseen viestiin." Aika ja viikonpäivä ovat jo vuoron tiedoissa.
7. **Tuotevalinta** (arviointi: Opus valitsi 94 % ja Sonnet 43 % tuotteista näyttämättä vaihtoehtoja). Ohjeeseen: "Kun
   tarpeeseen on yksi ilmeinen tuote, valitse se ja kerro lyhyesti, mitä valitsit ja että sen voi vaihtaa. Kun vaihtoehdoissa
   on asiakkaalle olennaisia eroja (koko, laktoositon, merkki tai selvästi eri hinta), näytä 2–3 vaihtoehtoa ja anna asiakkaan
   valita."

8. **Arvioinnin loppuhavainnot ohjeeseen** (suositus Sonnet 5.5 medium, koordinaattori 19.11.):
   - Supistetut tiedot: Sonnet toisti "Valion hintarajapinta ei vastannut" 9 keskustelussa 16:sta, myös korin yhteenvedossa.
     Työkalu antaa syyn `dataReason`-kentässä (`DATA_REASON`, jota ei muutettu, koska vanha putki käyttää sitä). Ohjeeseen:
     kerro syy kerran ja kevyesti omin sanoin ("tietojani on supistettu"), älä toista sitä äläkä mainitse korin
     yhteenvedossa, ei teknisiä sanoja kuten rajapinta, järjestelmä tai tietokanta.
   - Myötäily: Opus myönsi "Vastasin tosiaan jokaiseen viestiin erikseen", vaikka niputus oli yhdistänyt viestit. Ohjeeseen:
     "Älä myönnä virhettä, jota tässä keskustelussa ei tapahtunut. Jos asiakkaan havainto ei pidä paikkaansa, sano se
     ystävällisesti ja jatka."
   - Pituus: vastaukset olivat keskimäärin 310–400 merkkiä. Ohjeeseen: "Vastaa yleensä 1–3 lyhyellä virkkeellä. Korin
     yhteenveto saa olla pidempi."
   - Ei mallikutsuja. Vaikutus varmistetaan oikean WhatsAppin kokeessa julkaisun jälkeen.

Tarkistukset:
- Agentin testejä on 33 (viimeisin lisäys: kohdan 8 ohjesäännöt).
- Aiempi tila: agentin testejä oli 32. Uusia ovat Valio-vartija, korjauskierros ja poisto, ohjeen säännöt, lokin kentät sekä sävy (vain
  ensimmäisessä vuorossa, tallessa transkriptissa, kaikki viisi sävyä esiintyvät).
- `npm test` 634/634 (kohdan 8 jälkeen). CI:n tapaan ilman katalogia uudet testitiedostot menivät läpi 37/37.
- `aimo:eval` 26/26 ja `aimo:eval:spoken` 58/58.
- `git diff --check` puhdas.
- Ei mallikutsuja.

## Riippumattoman katselmoinnin korjaukset 19.11.

Katselmoija ei löytänyt polkua, jolla chat-viesti vahvistaisi tilauksen tai muuttaisi hintaa. Tilaus- ja rahaturvallisuus,
`tool_result`-parit, lyhennys, idempotenssi ja työkalut todettiin kunnossa oleviksi. Korjatut löydökset, kukin testin kanssa.
Kaikki uudet ja muutetut testit kaatuivat ennen korjausta.

1. **Tyhjä korjausvastaus lähetti hylätyn vastauksen** (keskitaso–korkea). Jos korjauskierros palautti tyhjän tekstin,
   alkuperäinen, vartijan hylkäämä vastaus lähti sellaisenaan, esimerkiksi väärä summa ja linkki "https://evil.example/pay".
   Nyt viimeisin mallin teksti tarkistetaan uudelleen ja korjataan (`repairReply`). Jos tekstiä ei ole, asiakas saa
   `FALLBACK.failed`-viestin.
2. **Euromäärien tunnistus** (keskitaso). Uudet muodot: "20 eurolla", "45 euroon", "100 eurosta" ja muut sijamuodot, "50 snt"
   ja "50 senttiä" sentteinä, "1.234,50 €", "1,234.50 €", "0,125 €", "€ 12,50" ja "12,50 e". Lukujen tulkinta on
   `parseAmount`-funktiossa. Väärät osumat estetty:
   - "Eurooppalainen" ja "e-luokka" eivät ole euroja.
   - Kolme kiloa ei tulkitu euroiksi lauseessa "12,50 € 3 kg:n säkki".
   - Päiväys ja kellonaika eivät ole euroja.
   - Korjaus koskee myös sentti- ja etumerkkimuotoja.
3. **Aiempien vuorojen hinnat** (matala–keskitaso). Vartija hyväksyy nyt myös transkriptin ikkunassa olevien työkalutulosten ja
   vuoron tietojen tilannekuvien summat. Lyhennetystä tuloksesta luetaan rahakentät avain–arvo-pareina. Uusinta ja jatkoviesti
   eivät enää muuta oikeaa hintaa muotoon "(hinta näkyy korissa)".
4. **Kieltäytyminen ja jumiin jäävä historia** (matala–keskitaso). Kieltäytynyt vuoro jätetään nyt aina pois, ja seuraava vuoro
   alkaa uudesta ikkunasta (`start` = historian loppu). Työkalujen muutokset jäävät luonnokseen, ja tilannekuva kertoo ne
   uudelle ikkunalle. Siirretty alku ei ole uusi keskustelu, joten uutta esittelyä tai sävyä ei tule (`first` vaatii
   tyhjän historian ja alun 0).
5. **Kova aikaraja** (matala):
   - Jokainen mallikutsu saa enintään jäljellä olevan ajan (enintään 45 s), myös ilman beta-ominaisuuksia uusittu pyyntö.
   - SDK ei uusi kutsuja itse. Agentti uusii ohimenevän virheen (429, 5xx, yhteys) kerran 0,4 s:n tauon jälkeen, jos aikaa on
     vähintään 5 s.
   - Kutsua ei aloiteta, jos aikaa on alle 1 s. 15 s:n minimi poistui.
   - Jos aika loppuu vasta työkalukierrosten jälkeen, tehty työ tallennetaan ja asiakas saa `FALLBACK.failed`-viestin
     (outcome `timeout`). Ensimmäisen kutsun aikakatkaisu heitetään kanavalle uusittavaksi.
6. **Korilinkki hylätyssä vastauksessa** (matala). `discardedNote` korvaa osoitteet tekstillä "[korilinkki]", joten
   allekirjoitettu linkki ei tallennu transkriptiin eikä mene API:lle. Malli pyytää tarvittaessa uuden linkin
   `send_cart_link`-työkalulla.

Tarkistukset:
- Agentin testejä on 38.
- `npm test` 639/639, ja ilman katalogia uudet testitiedostot 42/42.
- `aimo:eval` 26/26 ja `aimo:eval:spoken` 58/58.
- `git diff --check` puhdas.
- Ei mallikutsuja.

## Ohjeistava ensimmäinen viesti (Eelis 19.11. klo 11, v2 tuotannossa)

Eeliksen sanoin: "toi eka viesti ois just ohjeellistava et voit tilata täältä mitä vain valion tukusta ni mä kerään sulle
tilauksen. kerro vain mitä tarviit, mille päivälle ja mahdollisia allergioita ja erityisruokavaliota tms. voit myös lähettää
ääniviestiä tai suoraan reseptilinkkejä, tai kuva ostoslistasta tms osaan tulkita kaikissa muodoissa sun viestejä".

- Ohjeeseen (`prompt.mjs`, ei pohjatekstinä): jos ensimmäinen viesti on pelkkä tervehdys tai epämääräinen, malli kertoo
  esittelyn lisäksi omin sanoin ja sävyllään:
  - täältä voi tilata mitä tahansa Valio Aimon tukun valikoimasta, ja apuri kerää tilauksen
  - asiakas kertoo, mitä tarvitsee, mille päivälle ja onko allergioita tai erityisruokavalioita
  - WhatsAppissa viestin voi kirjoittaa tai lähettää ääniviestinä, reseptilinkkinä tai kuvana ostoslistasta.
  - Pituus 2–4 lyhyttä virkettä tai lyhyt lista.
- Jos ensimmäinen viesti on jo tilaus, esittely pysyy lyhyenä ja malli siirtyy asiaan. Lyhyt maininta äänestä, linkeistä ja
  kuvista sopii, jos se tuntuu luontevalta.
- Kanavan mukaan: selainkeskustelu ottaa vastaan vain tekstiä (`web-chat.mjs`), joten siellä luvataan vain kirjoitettu viesti
  ja reseptilinkki. Vuoron tiedoissa on jo kanava. WhatsAppissa kuvat ja ääniviestit toimivat, kun `WHATSAPP_MEDIA` ei ole
  `false` ja `WHATSAPP_TRANSCRIBE` on asetettu (tuotannossa näin koordinaattorin mukaan).
- Vuoron tietojen rivi on nyt "Keskustelu alkaa: aiempaa keskustelua ei ole, joten tämä on ensimmäinen viestisi asiakkaalle
  (esittely ja tarvittaessa ohjeet)." Persoonan "esittäydy lyhyesti" on muutettu muotoon "esittäydy", koska pituuden ratkaisee
  nyt yllä oleva sääntö.
- Tarkistukset: uusi verkoton testi ohjeen sisällöstä ja selainkeskustelun vuoron tiedoista. Agentin testejä on 39. `npm test`
  652/652, ilman katalogia 39/39, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58, ei mallikutsuja. Vaikutus näkyy vasta oikean
  WhatsAppin kokeessa julkaisun jälkeen.

## Tuotteen valinta käyttötarkoituksesta (Eelis 19.11.)

Eelis kysyi, pitäisikö botin ehdottelun sijaan aavistaa, millaista perunaa mihinkin tarvitaan. Vastaus on kyllä, ja tämä
tarkentaa korjauserän tuotevalintalinjaa (kohta 7). Ohjeeseen tulivat periaate ja muutama esimerkki. Esimerkkilistaa ei ole
koodissa, vaan malli käyttää omaa ruokaosaamistaan.
- Malli päättelee käyttötarkoituksesta ja ruokalajista sopivan tuotteen ja valitsee sen itse, esimerkiksi:
  - lohikeittoon ja salaattiin kiinteä peruna, muusiin ja soseeseen jauhoinen, uuniperunoiksi isot
  - kakkuun ja vaahdoksi vispikerma, kastikkeeseen ruokakerma, leivontaan voi.
- Valinta kerrotaan lyhyesti perusteluineen ("lohikeittoon valitsin kiinteän perunan") ja kerrotaan, että sen voi vaihtaa.
- Vaihtoehtoja näytetään vain, kun sopivaa ei voi päätellä käytöstä eikä asiakkaan tiedoista, tai kun ero on asiakkaan oma
  mieltymys, jota malli ei tiedä (merkki tai selvä hintaero samalla laadulla). Silloinkin malli ehdottaa yhtä oletusta ja
  mainitsee enintään yhden tai kaksi vaihtoehtoa. Vaihtoehtoja ei listata vain varmuuden vuoksi.
- Jos asiakas kertoo käyttötarkoituksen myöhemmin tai valinta osoittautuu vääräksi, malli vaihtaa tuotteen heti.
- Aiempi sääntö "näytä 2–3 vaihtoehtoa, kun eroilla on merkitystä" poistui. Testi tarkistaa vain, että periaate on ohjeessa.
  `npm test` 652/652, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58, ei mallikutsuja.

## Livetestin löydökset tuotannosta (19.11., v2 tuotannossa)

Koordinaattori välitti tuotannon livetestin löydökset. Kohdat 1–4 korjattu, kohta 5 vain kirjattu.
1. **Paikkanimi nimenä.** Selainkeskustelun synteettinen asiakas (`web-chat.mjs`, henkilö "Kokeilija") sai tervehdyksen
   "Moi Kokeilija".
   - Uusi `agentCustomer` (`server/whatsapp/ordering.mjs`): agentti saa henkilön nimeksi `null` selainkeskustelussa ja koodin
     omilla paikkanimillä. Paikkanimiä ovat "Kokeilija" ja "Testaaja", joka on testiasiakkaan oletus ilman
     `WHATSAPP_DEMO_PERSON`ia.
   - Keskustelutunniste, ostaja ja vanha putki ennallaan.
   - Ohje: nimellä puhutellaan vain, jos vuoron tiedoissa on oikea etunimi. Yrityksen nimi tai yleisnimi ei ole henkilön nimi.
2. **Sävy ohitti asiakkaan tyylin.** Kirjakielellä kirjoittanut koulun keittiö sai "Moikka! … 🎉" ja "Kori on valmis! 🥳".
   - Ohje: vuoron sävy vaikuttaa vain asiakkaan oman tyylin sisällä. Asiallisesti kirjakielellä kirjoittavan kanssa ei
     puhekieltä, rentoja tervehdyksiä eikä emojeja.
   - Emojeja enintään yksi viestissä ja vain rennosti kirjoittavalle.
   - Vuoron tietojen sävyrivi: "…, asiakkaan oman tyylin sisällä".
3. **Yhden ruokailijan ruokavalio rajasi koko tilauksen.** "80 hengelle … Yksi vieras on vegaani." teki koko tilauksesta
   vegaanisen. Lisäksi malli väitti, ettei tavallista raakaa perunaa löydy, ja selitti haun sisäistä toimintaa ("antaa
   tuotteille pelkän varoituksen").
   - Ohje: `set_diet` rajaa koko tilauksen. Kun vain osa ruokailijoista tarvitsee erityisruokavalion, koko tilausta ei rajata,
     ellei asiakas sitä pyydä. Silloin `set_diet` saa `none: true` ja tarpeen note-kenttään ("1 vegaani 80:stä"). Malli kysyy,
     tarvitaanko heille erillisiä tuotteita, ja kirjaa ne omiksi riveikseen.
   - Allergiasta malli kysyy, rajataanko koko tilaus. Tämä on oma lisäykseni: vakavan allergian takia keittiö voi haluta koko
     tilauksen ilman allergeenia, joten malli ei päätä sitä itse.
   - Ohje: tuotetta ei väitetä puuttuvaksi ennen hakua pelkällä perussanalla ("peruna") ja seuraavien vaihtoehtojen katsomista
     `more`-kentällä.
   - Ohje: järjestelmän sisäistä toimintaa ei selitetä asiakkaalle.
4. **Perustarvikkeet.** Ohje: pienistä perustarvikemääristä (jauhot, suola, mausteet, öljy, sokeri), joita asiakas ei itse
   pyytänyt, malli kysyy ensin, onko niitä jo keittiössä. Moninkertaista pakkausta ei tilata kysymättä.
5. **Viive.** Reseptilinkki ja ensimmäinen täysi kori kesti 32 s. Ei korjattu tässä. Mallikutsujen määrä on selvitetty
   kohdassa "Viive".

Tarkistukset:
- Neljä uutta testiä. Nimitesti kaatuu ilman `agentCustomer`-korjausta. Muut tarkistavat, että säännöt ovat ohjeessa.
- Vanhan sävyrivin odotus päivitetty.
- `npm test` 656/656. CI:n kaltainen kopio ilman `data/`-hakemistoa ja fontteja: 563 läpi, 93 ohitettu, 0 virhettä.
- Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58, `git diff --check` puhdas.
- Agentti ei tee tilauksia, joten korisivun tilauksen tilaajan nimi (`requestedBy`) tulee yhä alkuperäisestä asiakkaasta.
- Ei mallikutsuja, joten oikean mallin käytös (tyyli, osittainen ruokavalio, perustarvikkeet) näkyy vasta seuraavassa
  livetestissä tai arvioinnissa.

## Eeliksen aamun keskustelun uusinta (19.11., demo 20.11.)

Eeliksen palaute: "tää ei nyt vaikuta hei lupaavalta et eka viesti oli kirjotusvirhe … onks tää muka oikeest fiksumpi ja
viisaampi ja niiku claudelle juttelis?" Koordinaattori ajoi tuotannossa Eeliksen aamun keskustelun samoilla viesteillä
(Sonnet 5.5) ja välitti viisi löydöstä. Kaikki korjattiin ohjeeseen (`prompt.mjs`), koodiin ei tullut muutoksia.
1. **Kirjoitusvirhe ensimmäisessä viestissä.** Kahdessa ajossa peräkkäin malli kirjoitti "minä keräären" ja "mä keräin".
   - Syy: ohjeessa luki "ja sinä keräät tilauksen", ja malli taivutti sen väärin minä-muotoon.
   - Korjaus: ohjeen sisältö on nyt muodossa "ja tilaus hoituu tässä keskustelussa valmiiksi ostoskoriin". Sen voi käyttää
     sellaisenaan ilman taivutusta.
   - Uusi yleissääntö: virheetöntä suomea myös puhekielessä. Malli tarkistaa taivutukset, erityisesti verbien minä-muodot
     (kerätä: minä kerään, mä kerään; tilata: tilaan). Jos se ei ole varma muodosta, se kirjoittaa lauseen toisin.
2. **Allergiakysymys toistui.** Allergioista kysyttiin lähes joka viestissä, vaikka asiakas ei vastannut. Myös toimituspäivä ja
   käyttötarkoitus kysyttiin moneen kertaan.
   - Allergioista kysytään kerran alussa. Jos asiakas ei vastaa, kysytään uudelleen vasta korin yhteenvedon kohdalla ennen
     korilinkkiä. Tarkistuslistan järjestyksessä lukee nyt "allergiat kerran alussa" ("aikaisin" sijaan).
   - Yleissääntö: avointa kysymystä ei toisteta joka viestissä. Malli jatkaa sillä, mitä asiakas kertoi, ja palaa asiaan, kun
     sitä tarvitaan.
3. **Puhekielinen kysymys luettiin väärin.** "pistetää kermaa kans! ja siis paljo menis 50 henkilöl about" sai vastauksen
   "Koska määrää on paljon", ja peruna tuplattiin 10–12 kg:sta 20 kg:aan ilman syytä.
   - Puhekieliset kysymykset tunnistetaan myös ilman kysymysmerkkiä ("paljo menis 50 henkilöl" = "paljonko menisi 50
     hengelle?").
   - Ehdotukset pysyvät johdonmukaisina: jo ehdotettu määrä muuttuu vain uuden tiedon takia, ja syy kerrotaan.
4. **"20 sipulii" kiloina.** Malli oletti "50 kg perunaa ja 20 sipulii" -viestistä 20 kg sipulia. Nyt laskettavan tuotteen
   (sipuli, sitruuna, kananmuna, paprika) pelkkä luku tarkoittaa kappaleita, vaikka muut tuotteet olisi annettu kiloina:
   20 sipulia on noin 2–3 kg, ja rivi kirjataan yksiköllä kpl. Epäselvässä tapauksessa malli kysyy eikä oleta kiloja.
5. **Työkalujen toimintaa kuvailtiin.** Esimerkiksi "Valkosipulin tilalle ehdotettu tavallinen sipuli ei ole oikea korvike" ja
   "Hain niitä eri sanoilla".
   - Malli ei kuvaile, mitä haku palautti tai ehdotti, millä sanoilla se haki tai miten haku käsittelee merkintöjä. Se kertoo
     vain lopputuloksen asiakkaan kannalta, ja sopimattoman vaihtoehdon voi jättää mainitsematta.
   - Saatavuussääntö sanoo nyt "kerro asiakkaalle, mitä tarjoat tilalle" ("kerro se asiakkaalle" sijaan).

Tarkistukset (ei mallikutsuja):
- Uusi testi kaatuu vanhalla ohjeella ja menee läpi uudella. Kahden aiemman testin odotukset päivitetty uusiin sanamuotoihin.
- `npm test` 664/664. CI:n kaltainen kopio ilman `data/`-hakemistoa ja fontteja: 571 läpi, 93 ohitettu, 0 virhettä.
- Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58, `git diff --check` puhdas.
- Testi tarkistaa vain, että säännöt ovat ohjeessa. Oikean mallin käytös näkyy arviointisession ajossa ja seuraavassa
  livetestissä.

## Avoimet asiat

- Ratkaistu: `set_diet`-työkalun `none`-kenttä kattaa osittaisen ruokavalion. Koordinaattori laajensi kuvauksen 3ba23cb:ssä.
- Arviointi kolmella mallilla on tehty ([arviointi.md](arviointi.md)).
- Pitkien keskustelujen lyhennys (30 vuoroa tai 50 000 tokenia) on testattu vain käsikirjoitetulla mallilla.
- Kieltäytyminen ja `max_tokens` on testattu vain käsikirjoitetulla mallilla. Ne eivät tulleet vastaan oikeissa ajoissa.
- Agentin jälkisivu (`trace-reader.mjs`) lukee v2-vuorojen tulokset `turn_results`-taulusta, mutta sivua ei ole kokeiltu v2:n
  tilauksella.
- Korisivun muutoskenttä kulkee v2:ssakin vanhan moottorin kautta. Jos asiakas muuttaa koria siellä, agentti näkee muutoksen
  seuraavan vuoron kontekstilohkosta, mutta keskustelussa ei ole siitä viestiä.
