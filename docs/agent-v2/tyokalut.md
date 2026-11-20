# v2-agentin työkalut (sessio "Botti v2: agentin työkalut ja tarkistuslista", 19.11.2026)

Työkalukerros docs/agent-v2.md:n kohdan Työkalusopimus mukaan. Tiedostot: `server/agent/tools.mjs`, `server/agent/cart.mjs`,
`test/agent-tools.test.mjs`. Haarat: `claude/agent-v2-tools-60d2fc` (työkalut, mainissa dbba2de) ja
`claude/agent-v2-feedback-60d2fc` (`save_feedback` ja tallentamattoman luonnoksen tunniste, mainissa 3872ae7) ja
`claude/agent-v2-need-60d2fc` (asiakkaan tarve säilyy myyntierävalinnassa) ja `claude/agent-v2-need2-60d2fc`
(muuntumaton kappaletarve pakkausten painona, hintahuomio pois mallin tuloksesta).

## Mitä tehtiin

- `createAgentTools({ store, orderingTools, catalog, gatewayOrders, now, readPage, db })` palauttaa
  `{ definitions, run, snapshot, prune }`.
  - `definitions`: 13 työkalua, kuvaukset suomeksi, kaikilla `strict: true`.
  - `run(name, input, ctx)` palauttaa tuloksen, jossa on aina `checklist`. Virhe on muotoa `{ error, message, ..., checklist }`.
  - `snapshot(ctx)` on synkroninen ja palauttaa vuoron kontekstilohkoon tämän päivän, korin, summat, tarkistuslistan ja
    edellisen tilauksen. Kun luonnosta ei ole tallennettu, `draftId` ja `revision` ovat null (ennen uusi satunnainen tunniste
    joka kutsulla).
  - `prune()` poistaa yli 30 päivää vanhan palautteen.
- Työkalut: `set_delivery_date`, `set_diet`, `add_items`, `search_products`, `update_item`, `remove_item`, `get_cart`,
  `product_details`, `previous_orders`, `start_new_order`, `send_cart_link`, `save_feedback` ja `read_link`.
- `save_feedback({ text, kind })` tallentaa asiakkaan palautteen botista tiimille tauluun `agent_feedback` luonnoskannassa
  (id, customer_id, binding, conversation, kind, text, channel, message_id, draft_id, created). `kind` on bug, idea, praise tai
  other. Työkalu ei muuta koria eikä revisiota. Sama palaute samassa vuorossa (`ctx.messageId`) tallentuu kerran. Säilytys on
  30 päivää kuten suljetuilla luonnoksilla, ja vanhat rivit poistetaan jokaisen tallennuksen yhteydessä. Yhteys tulee
  `db`-riippuvuutena (`openSqlite(draftDb)`, sama kuin transkriptilla). Ilman sitä tulee `FEEDBACK_UNAVAILABLE`, jottei malli
  väitä palautetta kirjatuksi. Syy: 19.11. vanha botti sanoi "palaute menee eteenpäin", vaikka mitään ei tallennettu.
- Luonnos on täsmälleen vanhan ytimen JSON (`server/order-conversation/index.mjs`). Agentin omat tiedot ovat `agent`-kentässä:
  asiakkaan oma tarve, viimeisin tarkistus ja purettu valinta syineen. Siksi korisivu (`getStorefrontCart`), tarjous, maksu ja
  vanhan ytimen "näytä"- ja "TILAA"-polku toimivat työkalujen luonnoksella sellaisinaan.
- Tuotteet, hinnat, saatavuus ja pakkauskoot tulevat nykyisestä koodista: haku on order-toolsin `suggest`, tarkistus
  order-toolsin `quote` (gatewayn allekirjoitettu tarjous), koot ja muunnokset gatewayn `unitSizeFor` ja katalogin `roundToStep`,
  korin huomiot `cart-notes.mjs` ja tavallinen tilaus `usualOrder`. Uutta hinta- tai saatavuuslogiikkaa ei ole.

## Päätökset ja syyt

- **Kappaleet muunnetaan vain ilmoitetulla kappalemäärällä.** "50 sipulia" ja SIPULI 10KG SÄKKI (myyntiyksikkö kpl):
  `itemsPerSalesUnit` olettaa kpl-myyntiyksikön yhdeksi kappaleeksi, ja gateway laskisi 50 säkkiä. Siksi `update_item` palauttaa
  `UNIT_NOT_CONVERTIBLE` pakkaustietoineen (1 kpl = 10 kg), ja malli muuntaa itse. Kappaleet kelpaavat, kun määrä on
  tuotetiedoissa: tuotteen nimessä ("6 x"), munissa ("M10") tai laatikon yksikkömuunnoksessa. Yksikkö `pakkaus` tarkoittaa
  myyntieriä.
- **Haku samalla määrällä kuin tarjous.** Kilot ja litrat haetaan pyydetyllä määrällä, jolloin order-toolsin myyntierät ja
  rivihinta ovat samat kuin tarjouksessa (katalogitesti vertaa). Kappalehaku tehdään yhdellä myyntierällä (munia lukuun
  ottamatta), jottei haku arvaa 50 sipulia 50 säkiksi.
- **Valittu rivi on aina tarkistettu nykyiselle päivälle ja määrälle.** `update_item`, `set_delivery_date`, muuttuneen määrän
  `add_items` ja `send_cart_link` tarkistavat rivit gatewayn tarjouksella. Valinta, joka ei käy (ei saatavilla, toimitus vasta
  myöhemmin, allergeeni, yksikkö), puretaan, ja tulos kertoo syyn ja aikaisimman päivän. Rivi ja määrä säilyvät. Jos tarkistus ei
  onnistu (gateway alhaalla), mitään ei muuteta.
- **review ⇔ ready.** `shoppingListView` ei tiedä ruokavaliosta. Kun sitä ei ole selvitetty, luonnoksella on avoin tarkennus
  `pending = { kind: 'preference', refs: [kaikki rivit], claim: null, reason: 'diet' }`, jolloin tila on `needs_details`.
  Mennyt toimituspäivä tyhjennetään ja menneen tilausajan valinnat puretaan jokaisessa `run`- ja `snapshot`-kutsussa (kuten vanha
  ydin vuoron alussa). Testi tarkistaa yhtäpitävyyden jokaisen askeleen jälkeen.
- **Asetusmuotoisuus.**
  - `add_items` tunnistaa saman tuotesanan ja vertaa asiakkaan omaan tarpeeseen, ei muunnettuun määrään. Sama "50 kpl sipulia"
    uudelleen ei siis kumoa mallin 6 kg:n muunnosta.
  - `set_diet` korvaa koko rajauksen.
  - Sama päivä tai sama valinta uudelleen ei tee uutta tarjousta eikä kasvata revisiota.
  - Jo poistetun rivin poisto ei ole virhe.
- **Revisio** kasvaa samoista sisältömuutoksista kuin vanhassa ytimessä. Lisäksi se kasvaa, kun ruokavalion selvitys tai
  luonnoksen tila muuttuu, koska ne muuttavat korisivun tilaa.
- **Ei mallikutsuja.** Order-toolsin haku kutsuisi mallipohjaista lähivalitsijaa (`nearby.mjs`), kun pyydetyn tuotteen
  saatavuutta ei saada. Työkalu ohittaa sen antamalla `suggest`ille `exclude`-avaimen. Silloin tulos kertoo, ettei hintaa ole
  (`unavailable.reason: 'unknown'` ja syy), ja agentti päättää itse, mitä hakee tilalle.
- **Strict-skeemat API:n rajoissa.** Structured outputs sallii pyyntöä kohden enintään 20 strict-työkalua, 24 valinnaista
  kenttää ja 16 unionikenttää. Työkaluja on 13, unionikenttiä 9 ja valinnaisia 0. Numero- ja pituusrajoja ei tueta, joten
  rajat tarkistetaan koodissa. Testi valvoo rajat.
- **Null-enum ilman tyyppiunionia (korjaus 19.11.).** Oikea API hylkäsi jokaisen v2-pyynnön (400 "Enum value 'kg' does not
  match declared type ['string', 'null']"), koska yksikkökentät (`unit`) yhdistivät tyyppiunionin ja enumin. Nyt null-enum on
  `{ enum: [..., null] }` ilman type-kenttää; v2-agentti testasi muodon oikealla API:lla. Verkoton testi käy läpi kaikki
  skeemat: enum ei saa olla tyyppiunionin kanssa, enum-arvojen pitää vastata tyyppiä, anyOf ei saa olla samassa solmussa kuin
  type tai properties, ja jokaisella solmulla on tyyppi tai enum. Vanha muoto kaataa testin.
- **Asiakkaan tarve säilyy myyntierävalinnassa (arvioinnin löydös 19.11.).** Kun malli valitsi tuotteen `packs`-kentällä,
  rivin määrä kirjattiin myyntierinä, ja asiakkaan tarve hävisi luonnoksesta. Korisivun tarvesarake näytti "1 kpl", kun tarve
  oli 5 kg makaronia, ja "9 kpl" 18 kg:n perunatarpeelle. Nyt `packs`, joka on sama kuin rivin oman tarpeen myyntierät tälle
  tuotteelle, pitää määrän asiakkaan yksikössä kuten vanha ydin: KG tai L, tai PCS ja basis items, kun kappaleet muuntuvat.
  Myyntierät tarkistetaan tarjouksella (`quotedQuantity`), joten kori, tarjous ja työkalun tulos täsmäävät aina. Eri määrä
  myyntierinä (10 pussia 9:n sijaan) ja myyntierinä pyydetty ("10 voita") ovat basis sales. Mallin oma muunnos (50 sipulia →
  6 kg) on tarve.
- **Muuntumaton kappaletarve pakkausten painona (arvioinnin uusinta 19.11.).** Kun asiakkaan tarve on kappaleina eikä se
  muunnu tuotteen myyntieriksi (50 sipulia ja 1 kg:n pussit), ja malli valitsee `packs`-määrän, rivin määrä on pakkausten
  kattama paino tai tilavuus (6 × 1 kg = 6 kg). Silloin korisivu näyttää "6 kg" eikä "6 kpl". Määrä hyväksytään vain, jos
  tarjous antaa täsmälleen saman myyntierämäärän. Jos pakkauksen sisältöä ei tiedetä (tillinippu), määrä jää myyntieriksi.
  Asiakkaan oma tarve (50 kpl) säilyy rivin tarpeena.
- **Hintahuomio ei tule mallille.** `update_item`in `notes` ei enää sisällä korisivun huomiota "Valion hintarajapinta ei
  vastannut, joten hinta on viimeisin tunnettu …". Rajapinta on suljettu, joten huomio tuli joka tuotteelle, ja malli toisti
  sitä 7 keskustelussa 18:sta. Korisivu ja `cart-notes.mjs` näyttävät huomion ennallaan.
- **Gluteeniton allergeenitiedoista (arvioinnin löydös A1).** Vanha botti sanoi keliaakikolle, ettei juustoa ole, vaikka
  Emmental-raasteessa (476660) ei ole gluteeniviljoja. Kun gluteeniton-merkintä puuttuu mutta allergeenitiedot ovat olemassa,
  haku ja valinta kertovat nyt "Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja", tai
  "Sisältää gluteeniviljoja (vehnä): ei sovi gluteenittomaan ruokavalioon". Ilman allergeenitietoa varoitus on ennallaan
  ("Ei merkintää: gluteeniton"). Laktoositon jää merkinnän varaan, koska sitä ei voi päätellä allergeeneista. Lisäksi
  "maidoton" tai "pähkinätön" ruokavaliona luetaan allergeenin kielloksi.
- **Kello.** Oletus on gatewayn kello (`clock.now()`, DEMO_NOW), kuten tarjouksilla ja vanhalla ytimellä.

## Sopimuksen tarkennukset (koordinaattori hyväksyi 19.11.)

- `search_products`: `limit` on pakollinen kokonaisluku, ja lisäsin pakollisen kentän `more` (seuraavat vaihtoehdot ilman jo
  näytettyjä).
- Yksiköt ovat kg, g, l, dl, kpl ja pakkaus. kpl tarkoittaa yksittäisiä kappaleita ja pakkaus myyntieriä.
- Ruokavalion selvitys näkyy luonnoksessa pending-tarkennuksena, kuten yllä.
- `store` ja `orderingTools` ovat samat kuin `createConfiguredOrdering`issa. Niiden vienti on v2-agentin haarassa (runtime.mjs).
- Valinnainen `ctx.links`: kun se on annettu, `read_link` avaa vain asiakkaan viestissä olleet linkit. `ctx.messageId` liitetään
  tallennusten tunnisteisiin.
- Täysi kuvaus tuloskentistä: side-session-notes-kansion `v2-tyokalut-sopimus.md`.

## Tarkistukset

- `test/agent-tools.test.mjs` 21/21. Testeistä 19 ajetaan ilman katalogia: oikea order-tools, oikea luonnosvarasto ja
  injektoitu gateway, joka laskee myyntierät samalla `unitSizeFor`-laskulla. Kaksi testiä käyttää oikeaa katalogia,
  simuloituja hintoja ja korisivun runtimea (`createConfiguredOrdering`, samat kantatiedostot):
  - 50 sipulia: haku → `UNIT_NOT_CONVERTIBLE` → 6 kg, `getStorefrontCart` = ready, "näytä" ja "TILAA" vanhan ytimen kautta →
    demotilaus gatewayssa
  - maitoallergia rajaa kerma-, jogurtti- ja voihaut, ja Emmental-raaste saa gluteenittomalle varmistetun huomion
  - haun myyntierät ja rivihinta ovat samat kuin tarjouksen, ja valinta haun myyntierillä pitää tarpeen kiloina
- Korisivun projektio työkalujen luonnokselle: tarve näkyy kiloina, litroina ja kappaleina (5 kg, 18 kg, 3 l, 100 munaa), ja
  myyntierät ovat samat korissa, tarjouksessa ja työkalun tuloksessa. Ilman korjausta testi kaatuu.
- Muuntumaton kappaletarve: 50 sipulia ja 6 × 1 kg:n pussi näkyy korissa 6 kg, tillinippu ilman painoa myyntierinä, ja
  hintahuomio puuttuu työkalun tuloksesta mutta näkyy korisivun huomioissa. Kumpikin korjaus kaataa testin, jos se poistetaan.
- `save_feedback`: tallennus kerran per vuoro, kori ja revisio ennallaan, kind-tarkistus, 30 päivän säilytys ja
  `FEEDBACK_UNAVAILABLE` ilman kantaa.
- Tahalliset rikkomiset kaatoivat testit: ilman pending-tarkennusta 2 testiä, löysempi kappalesääntö 5, mallivalitsijan
  käyttö 1 ja vanha null-enumin muoto 1.
- `npm test` 635/635 worktreessä agent-v2-batch-haaran 6e7645f päällä (katalogi ja fontit linkitetty). CI:tä vastaava kopio
  ilman `data/`-kansiota ja fontteja: 542 läpi, 93 ohitettu, 0 virhettä.
- Worker 58/58, `aimo:eval` 26/26 ja `aimo:eval:spoken` 58/58.
- Ei mallikutsuja, Valio-kutsuja, Meta-viestejä eikä tuotantokantoja.

## Avoimet asiat

- `cart-link.mjs`:n `incompleteNote` näyttää selvittämättömän ruokavalion vanhalla tekstillä "Vielä puuttuu tarkennus: …".
  Tämä koskee vain vanhaa suoran koripyynnön polkua.
- Monen toimituspaikan asiakas: tarkistuslista kertoo puuttuvan paikan (`deliveryDate.siteMissing`, `missing: deliverySite`),
  mutta paikan valintaan ei ole työkalua. Demoasiakkailla on yksi paikka.
- Ilman toimituspäivää `update_item` laskee myyntierät katalogin koolla ilman hintaa. Hinta ja saatavuus tarkistetaan, kun päivä
  asetetaan.
- Haun `pricePer` lasketaan myyntierän sisällöstä, eikä se ole Valion vertailuhinta. Tarjouksen vertailuhinta tallentuu riville
  (`agent.quoted`), ja korisivu näyttää sen kuten ennenkin.
- Jokainen tarkistus on gatewayn tarjous ja kirjautuu sen lokiin kuten vanhan ytimen yhteenvedot. Tallentava työkalukutsu
  kirjoittaa `turn_results`-rivin synteettisellä tunnisteella, ja tarkistukset kirjoittavat `tool_quotes`-rivejä. Kummankin
  rivit poistetaan 7 päivän jälkeen nykyisellä `prune`-kutsulla.
- `TYOLOKI.md`:n merkinnän kirjoittaa koordinaattori.
