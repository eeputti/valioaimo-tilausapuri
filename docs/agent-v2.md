# Tilausapuri v2: Claude-agentti työkaluilla

Suunnitelma ja sopimus rinnakkaisille sessioille 19.11.2026. Koordinaattori on sessio "Valio Aimo bot intelligence
improvements". Lue tämä kokonaan ennen omaa osuuttasi. Kun sopimus muuttuu, päivitä tämä tiedosto ja kerro siitä
koordinaattorille.

## Miksi botti on tyhmä (juurisyyt koodista)

Eeliksen WhatsApp-keskustelu 19.11. klo 8.38–8.49 (peruna, sipuli ja kerma 50 hengelle) näyttää ongelmat:

1. **Kielimalli ei keskustele, se luokittelee.** `server/order-conversation/index.mjs` on noin 960 rivin tilakone.
   Haiku (`DEEP_MODEL=claude-haiku-5-5`, `.env.whatsapp`) muuttaa viestin rakenteisiksi operaatioiksi
   (`interpret.mjs`). Vastaukset kootaan pohjateksteistä (`wording.mjs`, `cart-presentation.mjs`) ja säännöillä
   korjaillusta "äänikerroksesta" (`voice.mjs`, `persona.mjs`). Malli ei näe kokonaisuutta eikä saa päättää, mitä sanoo.
2. **"50 sipulia" muuttui 50 säkiksi.** Kun valitun tuotteen pakkauksen kappalemäärää ei tiedetä, ydin kysyy "montako
   säkkiä" ja merkitsee rivin `askPacks`. Seuraavan viestin luku tulkitaan säkeiksi, vaikka asiakas sanoi "sipulia"
   (`index.mjs:179`). Tilakoneessa ei ole tilaa "50 kappaletta sipulia ≈ 6 kg", joten jokainen valitus toisti saman
   luonnoksen. Claude olisi muuntanut kappaleet kiloiksi itse ja kysynyt, käykö yksi 10 kg:n säkki.
3. **Jokaiseen viestiin vastataan erikseen.** Niputus odottaa vain 3 s (`gatherSettings`, `channel.mjs`). Eeliksen kaksi
   viestiä 6 s välein saivat kaksi eri vastausta. Jos asiakas kirjoittaa lisää vastauksen valmistuessa, vanha vastaus
   lähtee silti.
4. **Annoksia ei arvioida.** Määräarvio (`whatsapp_quantity_estimate`) käynnistyy vain, jos jollain rivillä on jo määrä.
   "50 hengelle" ilman määriä ei tuottanut ehdotusta.
5. **Tervehdykset toistuvat.** Ne tulevat pohjista ja säännöistä ("Iltaa! Tilataanko jotain?"), joten ne eivät vaihtele.

Jan (Eeliksen koneella) on avoimen lähdekoodin chat-sovellus, joka ajaa Gemma 4 26B -mallia paikallisesti. Se tuntuu
fiksulta, koska malli näkee koko keskustelun ja vastaa vapaasti. v2 tekee saman Clauden ja työkalujen kanssa.

## Periaatteet (Eeliksen linjaus 19.11.)

- **Ainoa kovakoodi on tarkistuslista.** Ostoskorilinkki annetaan vasta, kun koodi toteaa nämä valmiiksi:
  1. **Toimituspäivä** on asetettu ja tuleva.
  2. **Allergiat ja erityisruokavaliot** on selvitetty: asiakas on kertonut ne tai vahvistanut, ettei niitä ole.
  3. **Tuotteet** on päätetty: jokaisella asiakkaan mainitsemalla tarpeella on valittu tuote. Asiakas voi muuttaa ja lisätä
     milloin tahansa, ja kaikki mainitut otetaan mukaan, ellei hän poista niitä.
  4. **Määrät** on asetettu jokaiselle riville.
  5. **Ostoskori** on viimeinen tarkistus: asiakas näkee korin ja vahvistaa tilauksen korisivulla (ennallaan).

  Järjestys on vapaa. Suositus mallille: toimituspäivä ensin, koska se rajaa tilattavat tuotteet, ja allergiat aikaisin,
  koska ne rajaavat haun.
- **Malli kirjoittaa kaiken itse.** Ei pohjatekstejä, ei säännöillä uudelleenkirjoitettuja vastauksia, ei regex-tunnistusta
  tervehdyksille tai kuittauksille. Tervehdykset, kuittaukset, korin näyttäminen ja ohjaus seuraavaan vaiheeseen tulevat
  mallilta omin sanoin. Malli päättää, milloin kori kannattaa näyttää.
- **Koodi takaa faktat.** Tuotteet, hinnat, saatavuus, pakkauskoot ja laskut tulevat työkaluista. Vastauksen euromäärät
  tarkistetaan työkalujen dataa vasten (kohta Vartija). Malli ei kirjoita linkkejä itse.
- **Tilaus syntyy vain korisivulla** asiakkaan omalla vahvistuksella. WhatsApp-viesti ei tilaa mitään (ennallaan).
- **Vanha putki säilyy** oletuksena. v2 kytketään päälle asetuksella `WHATSAPP_AGENT=v2` vasta, kun arviointi näyttää sen
  paremmaksi ja Eelis hyväksyy. Vanhaa koodia ei poisteta tässä vaiheessa.

## Arkkitehtuuri

```
WhatsApp / selainkeskustelu
  → channel.mjs (niputus, jono, lähetys)
  → cart-link.mjs ja checkout.mjs (korilinkki ja maksu, ennallaan)
  → ordering.mjs createDemoOrderingChat().chatTurn
       WHATSAPP_AGENT=v2 → server/agent/index.mjs respond()
       muuten           → vanha dialogue.respond / links.respond (ennallaan)
  server/agent/index.mjs: Claude-silmukka (Messages API, omat työkalut)
       ↔ server/agent/tools.mjs: työkalut → order-tools (haku, hinnat, saatavuus, tarjous) ja luonnosvarasto
```

- **Ostoskori on nykyinen luonnos** (`server/order-conversation/store.mjs`, sama `conversationId`, sama JSON-muoto). Silloin
  korilinkki, korisivu (`getStorefrontCart`), tarjous, maksu ja selainkeskustelu toimivat ennallaan.
- **Transkripti:** Anthropic-viestit tallennetaan sellaisinaan ja vain lisäämällä (myös `thinking`-, `tool_use`- ja
  `tool_result`-lohkot) omaan tauluun luonnoskantaan. Järjestelmäohje ja työkalulista pysyvät samoina (välimuisti ja
  thinking-lohkojen sidonta). Päivämäärä, kellonaika ja korin tila tulevat jokaisen käyttäjävuoron alkuun omana
  tekstilohkonaan. Lyhennys tehdään vain alusta, käyttäjävuoron rajalta.
- **Malli:** `WHATSAPP_AGENT_MODEL` (oletus `claude-sonnet-5-5`: Eelis valitsi sen 19.11. arvioinnin perusteella, docs/agent-v2/arviointi.md), `WHATSAPP_AGENT_EFFORT` (oletus `medium`). Arviointi vertaa
  Opus 5.5:tä, Sonnet 5.5:tä ja Haiku 5.5:tä, ja Eelis valitsee. Hinnat miljoonalta tokenilta: Opus 4 $ / 20 $, Sonnet 2 $ /
  10 $, Haiku 0,10 $ / 0,50 $.
- **API-käyttö:** projekti käyttää jo Messages APIa (`server/aimoAgent.mjs`), joten silmukka tehdään sillä itse (ei Managed
  Agents). Opus 5.5:llä ajattelu on aina päällä (älä lähetä `disabled`). Mukaan `fallbacks: "default"` betalla
  `server-side-fallback-2026-07-01` ja `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` betalla
  `thinking-binding-controls-2026-08-01`. Tarkista `stop_reason` (`refusal`, `max_tokens`) ennen työkalujen ajoa. Välimuisti:
  `cache_control` järjestelmäohjeeseen ja viimeiseen viestiin. Ei `temperature`-asetusta.
- **Rajat:** enintään 8 työkalukierrosta vuorossa, aikaraja noin 60 s. Sama `messageId` palauttaa tallennetun tuloksen
  ajamatta mallia uudelleen. Työkalut ovat asetusmuotoisia (aseta, ei lisää), joten uusinta ei tuplaa koria.
- **Asiakkaan teksti ja työkalujen tulokset ovat dataa.** Tuotenimien tai viestien ohjeita ei noudateta.

## Työkalusopimus (`server/agent/tools.mjs`)

```js
createAgentTools({ store, orderingTools, catalog, gatewayOrders, now }) → {
  definitions,                                   // Anthropic-työkalut: name, description (suomeksi), input_schema, strict: true
  async run(name, input, ctx),                   // → JSON-tulos (tool_result). Virhe: { error: 'KOODI', message, ... }
  snapshot(ctx),                                 // → korin ja tarkistuslistan tiivis tila vuoron kontekstilohkoon
}
ctx = { customer, conversationId, now: Date, channel: 'whatsapp' | 'web' }
```

Jokainen tulos sisältää kentän `checklist`:

```js
checklist: {
  deliveryDate: { done, date, weekday, orderBy },   // orderBy = tilausaikaraja, jos tiedossa
  diet: { done, allergens: [], diets: [], none },  // none = asiakas vahvisti, ettei ole
  products: { done, missing: ['sipuli'] },         // tarpeet ilman valittua tuotetta
  quantities: { done, missing: ['kerma'] },
  ready,                                           // kaikki valmiina ja kaikki rivit tilattavissa päivälle
}
```

| Työkalu | Syöte | Tulos |
|---|---|---|
| `set_delivery_date` | `{ date: 'YYYY-MM-DD' }` | Tarkistus (tuleva päivä), viikonpäivä, tilausaikaraja ja valittujen tuotteiden saatavuus päivälle. Malli laskee suhteelliset päivät ("viikon päästä torstaina") itse kontekstin päivämäärästä. |
| `set_diet` | `{ allergens: [], diets: [], none: false, note }` | Allergeenit sanoina tai GS1-koodeina (`server/allergens.mjs`). Rajaa haun. Ilmoittaa, jos valittu tuote on ristiriidassa. |
| `add_items` | `{ items: [{ term, amount, unit, note }] }` | Kirjaa asiakkaan tarpeet riveiksi (`ref`). Määrä on vapaaehtoinen ja asiakkaan yksikössä (kg, g, l, dl, kpl, pakkaus). |
| `search_products` | `{ query, ref, amount, unit, limit }` | Vaihtoehdot: `productId`, nimi, merkki, pakkaus (`salesUnit`, sisältö kg/l/kpl, jos tiedossa), hinta per pakkaus (alv 0), vertailuhinta, saatavuus päivälle (`ok`, `not_on_date`, `unknown`), aikaisin päivä, tilausaikaraja, merkinnät, allergeenit, suosittu. Kun määrä on annettu: tarvittavat pakkaukset, kokonaismäärä ja -hinta. Ilman päivää vain katalogitiedot ja `needsDeliveryDate: true`. |
| `update_item` | `{ ref, productId, packs, amount, unit, term }` | Valitsee tuotteen ja asettaa määrän. `packs` = myyntierät. `amount` + `unit` muunnetaan pakkauksiksi ylöspäin pyöristäen. Palauttaa pakkaukset, kokonaismäärän, rivihinnan ja ylityksen. Jos muunnos ei onnistu (esim. kpl → 10 kg:n säkki), tulee `UNIT_NOT_CONVERTIBLE` pakkaustietoineen, jolloin malli muuntaa itse ja kutsuu uudelleen. Varoitus, jos määrä on epätavallisen suuri. |
| `remove_item` | `{ ref }` | Poistaa rivin. |
| `get_cart` | `{}` | Koko kori: päivä, ruokavalio, rivit (tarve, tuote, pakkaukset, kokonaismäärä, rivihinta, saatavuus), summat (alv 0 ja verollinen), tilausaikaraja, tarkistuslista. |
| `product_details` | `{ productId }` | Allergeenit, ainesosat, alkuperä, säilytys, merkinnät, hiilijalanjälki ja toimitusvarmuus katalogista. |
| `previous_orders` | `{}` | Ostajan viimeisimmät vahvistetut tilaukset riveineen ("sama kuin viimeksi", "se tavallinen"). |
| `start_new_order` | `{}` | Sulkee nykyisen luonnoksen ja aloittaa tyhjän. Vahvistetut tilaukset säilyvät. |
| `send_cart_link` | `{}` | Jos `checklist.ready`: tuore tarjous luonnokselle ja `{ ok: true, draftId, revision }`. Muuten `{ ok: false, missing }`. Linkin URL lisää koodi (kohta Korilinkki). |
| `save_feedback` | `{ text, kind }` | Tallentaa asiakkaan palautteen botista tiimille omaan tauluun (`kind`: `bug`, `idea`, `praise`, `other`). Silloin "kirjasin palautteen" pitää paikkansa. 19.11. vanha botti sanoi "palaute menee eteenpäin", vaikka mitään ei välitetty. |
| `read_link` (valinnainen) | `{ url }` | Reseptisivun otsikko, annosmäärä ja ainekset (`link-reader.mjs`). |

Luonnoksen täytyy olla sellainen, että `shoppingListView`-tila on `review` täsmälleen silloin, kun `checklist.ready` on
tosi, ja että nykyinen `getStorefrontCart`, `quote` ja `submit` toimivat työkalujen tekemällä luonnoksella.

### Tarkennukset 19.11. (v2-työkalut ja koordinaattori)

- `createAgentTools({ store, orderingTools, catalog, gatewayOrders, now, readPage })` saa samat `store`- ja `tools`-instanssit
  kuin `createConfiguredOrdering`, joka palauttaa ne nyt myös (v2-agentti lisää). Muuten korisivu ja TILAA eivät näe samaa
  luonnosta ja tarjousta.
- Strict-työkaluissa on pyyntöä kohden enintään 16 null-kenttää, ja työkalut käyttävät niistä 12.
- Yksiköt ovat kg, g, l, dl, kpl ja pakkaus. kpl tarkoittaa yksittäisiä kappaleita ja muuntuu vain, jos pakkauksen
  kappalemäärä on tiedossa: 50 kpl sipulia ja 10 kg:n säkki antaa `UNIT_NOT_CONVERTIBLE`. pakkaus tarkoittaa myyntieriä.
- `search_products`: `limit` (1–5) ja `more` (seuraavat vaihtoehdot) ovat pakollisia. Haussa ei ole mallipohjaista
  lähivalitsijaa, joten agentti päättää itse vaihtoehtoisen haun.
- `add_items` ja `set_diet` ovat asetusmuotoisia: sama tuotesana päivittää rivin, ja `set_diet` korvaa koko rajauksen.
- Kun ruokavaliota ei ole selvitetty, luonnoksella on ruokavalion `pending`-tarkennus, jotta `shoppingListView` on `review`
  täsmälleen silloin, kun `checklist.ready` on tosi.
- Korisivun API-polku ("näytä" ja "TILAA", `expectedList`) pysyy v2:ssakin vanhassa deterministisessä `handleTurn`-polussa.
  WhatsApp- ja selainkeskustelun v2-vuorot ohittavat `cart-link.mjs`:n pohjapolut (ok → linkki, `incompleteNote`,
  `withCartHandoffHint`), ja kääre vain lisää linkin, kun tulos sisältää `requestCartLink`.

## Agenttisopimus (`server/agent/index.mjs`)

```js
createAgent({ tools, db, client, model, effort, now }) → {
  async respond({ customer, conversationId, messageId, incoming, discardedReply, channel, cartLinkAvailable })
    → { status, draftId, revision, text, messages, requestCartLink }
}
incoming = [{ text, at }]   // tämän vuoron asiakasviestit aikaleimoineen (niputetut erikseen)
discardedReply              // edellinen vastaus, jota ei lähetetty, koska asiakas kirjoitti lisää (niputus)
```

- `messages` on 1–3 erillistä WhatsApp-viestiä. Malli voi jakaa vastauksen rivillä, jossa on pelkkä `---`.
- `status` on `ready`, kun tarkistuslista on valmis, muuten `collecting`. `draftId` ja `revision` ovat nykyisen luonnoksen.
- `requestCartLink: true`, kun `send_cart_link` onnistui tässä vuorossa.
- `discardedReply` kirjataan uuteen käyttäjävuoroon huomautuksena ("edellistä vastaustasi ei lähetetty, asiakas kirjoitti
  lisää"). Transkriptia ei muokata jälkikäteen.

### Korilinkki

`cart-link.mjs` kääri jo `ordering.chat`-kutsun. Kun tulos sisältää `requestCartLink`, kääre lisää viimeisen viestin
loppuun nykyisellä `issue(member, list)`-funktiolla tehdyn linkin. `createMetaSender` näyttää linkin painikkeena
"Avaa ostoskori". Malli kirjoittaa linkkiä edeltävän tekstin itse.

### Vartija (`server/agent/guard.mjs`)

Ennen palautusta: jokaisen vastauksessa mainitun euromäärän pitää löytyä tämän vuoron työkalutuloksista tai korista
(±0,01 €). Linkkejä ei saa olla mallin tekstissä. Jos tarkistus ei mene läpi, malli saa yhden korjauskierroksen
huomautuksella. Määrä-arvioita ("50 hengelle noin 10 kg") ei tarkisteta, koska ne ovat ehdotuksia.

### Ohje (`server/agent/prompt.mjs`, suomeksi, jäädytetty)

- Tehtävä on vain tarkistuslista: toimituspäivä, allergiat ja ruokavaliot, tuotteet, määrät ja lopuksi kori. Tehokkaasti
  ja nopeasti, ilman jargonia. Saa olla hauska ja lämmin. Peilaa asiakkaan tyyliä (puhekieli tai kirjakieli). Vaihtele
  sanamuotoja, älä toista samaa lausetta.
- Kysy yhdellä viestillä enintään yksi tai kaksi asiaa. Jos asiakas antaa kaiken kerralla, älä kysele turhaan.
- Arvioi määrät itse henkilömäärästä tai käytöstä ja ehdota niitä ("50 hengelle perunaa noin 10–12 kg, käykö?").
- Muunna yksiköt järkevästi pakkaustiedoista. 50 sipulia on noin 5–7 kg, joten ehdota esimerkiksi yhtä 10 kg:n säkkiä
  tai kuutta 1 kg:n pussia ja kerro muunnos. Kysy, jos et ole varma.
- Kun asiakas valittaa tai korjaa, myönnä virhe lyhyesti ja korjaa heti työkalulla. Älä lupaa muutoksia tulevaisuuteen
  äläkä puhu omasta koodistasi.
- Kun asiakas antaa palautetta botista ("vastaat jokaiseen viestiin erikseen", "pitäisikö bottia muuttaa"), kiitä lyhyesti, tallenna palaute `save_feedback`-työkalulla ja korjaa varsinainen asia heti. Älä lupaa muuttavasi toimintaasi jatkossa äläkä puhu koodista.
- Tuotteet, hinnat ja saatavuus vain työkaluista. Jos tuotetta ei ole, sano se ja tarjoa lähin vaihtoehto.
- Kaikki asiakkaan mainitsemat tuotteet pysyvät listalla, kunnes hän poistaa ne.
- Korilinkki vain `send_cart_link`-työkalulla, kun kaikki on valmista. Tilaus vahvistetaan korisivulla. Demo: oikeaa
  Valio-tilausta ei lähetetä. Hinnat ovat alv 0 %.
- Persoona (sessio "Apurin persoonallisuus", Eeliksen päätökset 18.–19.11.): minä-muoto ja mukava sävy, mutta ei väitä
  olevansa ihminen. Esittely on "Valio Aimon digitaalinen tilausapuri" (Valio Aimo on palvelu, ei apurin nimi).
  Ensimmäisessä esittelyssä ei pyytämätöntä "en ihminen" -lisäystä. Kysymykseen "ootko botti?" vastataan aina rehellisesti
  (EU:n tekoälysäädös, artikla 50). Ei keksittyjä henkilötietoja tai kokemuksia. Pohjana voi käyttää
  `server/whatsapp/persona.mjs`:n `PERSONA`-tekstiä.

## Niputus (`server/whatsapp/channel.mjs`)

- Odotus pitenee: `WHATSAPP_GATHER_MS` oletus 6000 (nyt 3000), `WHATSAPP_GATHER_MAX_MS` oletus 20000 (nyt 10000).
- Kun vastaus on valmis mutta samalta numerolta on tullut uusia viestejä, vastausta ei lähetetä. Uudet viestit liitetään
  ja `chat` kutsutaan uudelleen. Uusi `messageId` on muotoa `${job.id}:r1`, ja `discardedReply` sisältää hylätyn
  vastauksen. Uusintoja on enintään 2.
- `chat` saa lisäksi kentän `incoming: [{ text, at, round }]`, jossa ovat vuoron viestit erikseen. `round` on 0 ensimmäisellä
  kierroksella ja 1–2 uusinnoissa. Uusinnassa `messages`-kentän viimeinen käyttäjävuoro sisältää vain uudet viestit, ja jo
  luetut ovat omana vuoronaan, joten vanha putki ei kirjaa rivejä kahdesti. Vuoron tila tallentuu `inbox_turns`-tauluun, ja
  uusintayritys jatkaa samasta kierroksesta. Vanha putki jättää uudet kentät huomiotta. Toteutettu: haarassa 4d5b595, mainissa 00d9f3a.
- Niputus (6 s / 20 s) koskee sekä vanhaa putkea että v2:ta. Hylätyn vastauksen uusinta koskee vain v2-agenttia: kanavan `redo` kytkeytyy päälle vain, kun `ordering.usesAgent()` on tosi. Vanha ydin käsittelee uusinnassa vain uusimman viestin, joten sen hylätty vastaus (esim. korilinkki) olisi kadonnut. Riippumaton katselmointi löysi tämän, ja se korjattiin commitissa 55979d3.
- Pilvessä `drain` jättää vuorolle 90 s varan (`TURN_RESERVE_MS`): uutta työtä ei oteta, kun aikaa on vähemmän.
- Asiakaspalvelu ("tuki") ja kuvat ennallaan.

## Arviointi (`eval/agent-v2-*.mjs`, `scripts/agent-v2-eval.mjs`)

- Skenaariot Eeliksen oikeista keskusteluista: peruna, sipuli ja kerma 50 hengelle ("50 sipulia"), lanttulaatikko 500 kg
  lauantaiksi, tervehdysten vaihtelu (sama "moi" useita kertoja), viestit nopeasti peräkkäin, valitus kesken tilauksen,
  allergiat, "ootko botti?" ja aiheen ohi menevä kysymys. Lisäksi otos nykyisistä personista
  (`eval/whatsapp-personas*.mjs`).
- Tarkistukset koodilla lopullisesta korista (päivä, tuotteet, määrät järkevissä rajoissa, esim. 50 sipulia = 3–10 kg)
  ja keskustelusta (toistuvat lauseet, vuorojen määrä, vastaukset per asiakasviesti). Lisäksi mallin arvio ihmismäisyydestä,
  tehokkuudesta ja vaihtelusta.
- Sama ajuri ajaa vanhan putken (vertailukohta) ja v2:n kolmella mallilla. Raportti kertoo hinnan ja viiveen.
- Eristetyt kannat ja simuloitu Meta (kuten `scripts/whatsapp-selfplay*.mjs`). Ei tilauksia, ei Meta-viestejä, ei
  tuotantokantoja.

## Työnjako ja tiedostot

| Sessio | Omistaa | Valmis, kun |
|---|---|---|
| v2-työkalut | `server/agent/tools.mjs`, `server/agent/cart.mjs`, `test/agent-tools.test.mjs`, `docs/agent-v2/tyokalut.md` | Kaikki työkalut sopimuksen mukaan. Testit oikealla `order-tools`-kerroksella, luonnosvarastolla ja simuloiduilla hinnoilla: tarkistuslista, muunnokset (myös 50 kpl sipulia → `UNIT_NOT_CONVERTIBLE` → kg), korisivun `getStorefrontCart`, `quote` ja `submit` työkalujen luonnoksella. `npm test` läpi. |
| v2-agentti | `server/agent/index.mjs`, `prompt.mjs`, `transcript.mjs`, `guard.mjs`, kytkentä `server/whatsapp/ordering.mjs`:ssä ja `cart-link.mjs`:ssä, `.env.example`, `test/agent-loop.test.mjs`, `docs/agent-v2/agentti.md` | Silmukka, transkripti, vartija ja kytkentä asetuksen takana. Testit käsikirjoitetulla mallilla (ei verkkoa). Kun työkalut ovat valmiit, yhdistetty savukoe oikealla mallilla (enintään 1,5 $). Vanha putki muuttumaton, kun asetus puuttuu. |
| niputus | `server/whatsapp/channel.mjs`, tarvittaessa `server/whatsapp/store.mjs`, `test/whatsapp-gather.test.mjs`, `docs/agent-v2/niputus.md` | Pidempi odotus, hylätyn vastauksen uusinta, `incoming`, testit (myös 6 s välein tulevat kaksi viestiä saavat yhden vastauksen). `npm test` läpi. |
| arviointi | `eval/agent-v2-*.mjs`, `scripts/agent-v2-eval.mjs`, `docs/agent-v2/arviointi.md` | Ajuri, skenaariot ja tarkistukset. Vertailuajo vanhalla putkella heti (enintään 2 $). v2-ajot kolmella mallilla, kun koordinaattori ilmoittaa v2:n olevan mainissa (enintään 6,5 $). Raportti suosituksineen. |
| koordinaattori | `docs/agent-v2.md`, `TYOLOKI.md`, yhdistäminen mainiin | Sopimus ajan tasalla, haarat yhdistetty, kokonaisuus testattu, julkaisupyyntö sessio E:lle Eeliksen luvalla. |

## Pelisäännöt kaikille sessioille

- Työ vain valioaimo-tilausapurissa (`eeputti/valioaimo-tilausapuri`). Ei muihin repoihin.
- Jokainen sessio työskentelee omassa worktreessä ja pushaa oman haaransa GitHubiin. Mainiin yhdistää koordinaattori.
  Älä pushaa mainiin. Älä käytä `reset --hard`- tai `clean`-komentoa äläkä force pushia.
- Kirjoita oma raportti tiedostoon `docs/agent-v2/<oma>.md`: muutokset, päätökset, tarkistukset ja tulokset, avoimet asiat.
  `TYOLOKI.md`:n kokoaa koordinaattori.
- Älä koske toisen session tiedostoihin. Jos sopimusta pitää muuttaa, kerro koordinaattorille ennen muutosta.
- Ei julkaisuja (Vercel, Worker), ei tuotannon asetuksia eikä tuotantokantoja. Julkaisut tekee vain sessio E Eeliksen
  luvalla.
- Oikean mallin ajot vain omalla budjetilla (taulukko). Koko budjetti on 10 $ (Eelis 19.11.). Ei `.env`-tiedostoja, avaimia, kantoja eikä `data/`-hakemistoa
  Gitiin. Katalogia vaativat testit ohitetaan, jos `data/catalog.json` puuttuu (CI:ssä sitä ei ole).
