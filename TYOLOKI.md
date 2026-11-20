# Työloki ja työn jatkaminen

Tämä tiedosto välittää toteutuksen tilan ja päätökset sessioiden välillä. Lisää uusin työvaihe ylimmäksi. Älä kirjaa
salaisuuksia tai koko keskusteluhistoriaa.

## 20.11.2026 — LICENSEen tausta aimo-aista (Claude Code)

- **Eeliksen pyyntö:** lisenssiin maininta, että aimo-ai oli tiimin yhteinen idea ja pohja, jota Eelis jatkojalosti, ja että tämän repon koodi on uutta.
- **Muutos:** LICENSEn loppuun Tausta-kappale: aimo-ai oli Eeliksen ja Junction-tiimin yhteinen idea ja ensimmäinen prototyyppi, Eelis jatkokehitti sitä ensin aimo-aissa ja 17.11. alkaen tässä repossa, ja muiden tiimiläisten koodi on poistettu tai kirjoitettu uudelleen 20.11.
- **Päätös:** WhatsAppia ja pilviajoa ei mainita tämän repon uusina, koska ne olivat jo aimo-aissa (WhatsApp-kanavan ensimmäinen commit oli Danielin 14.11., ja Vercel-ajo oli aimo-aissa ennen 17.11.). Myöskään "täysin uusi koodi" ei pidä sellaisenaan paikkaansa, koska osa Eeliksen omasta koodista on kirjoitettu alun perin aimo-aihin. Lisenssiin kirjattiin vain git-historian tukemat väitteet.
- **README (Eelis: "Korjaa README"):** Tausta kertoo nyt, että kehitys jatkui ensin aimo-aissa ja 17.11. alkaen täällä. Esimerkkeinä tämän repon työstä Claude-agentti, viestien niputus ja maksun jälkeinen kiitosviesti, jotka kaikki tehtiin täällä. Prototyyppi mainitaan yhä vain kerran.
- **Eeliksen oma muokkaus GitHubissa (17aa725):** viimeinen virke on nyt "Tämän repon koodi on kuitenkin täysin Eelis Puron kirjoittamaa." Maininta tiimiläisten koodin uudelleenkirjoituksesta poistui.
- **Eeliksen tarkennus:** Tausta kirjoitettu hänen sanoillaan: idea syntyi hackathonissa, apuria ei saatu siellä kunnolla toimimaan, Eelis sai sen toimimaan aimo-aissa ja on työstänyt tätä repoa 17.11. alkaen.
- **Tarkistukset:** vain LICENSE ja tämä loki muuttuivat. `git diff --check` läpi.

## 20.11.2026 — pienet siistimiset juuren asetustiedostoihin (Claude Code)

- **Eeliksen pyyntö:** pieni muutos tiedostoihin `.gitignore`, `.vercelignore`, `vercel.json` ja `package-lock.json`, jotta GitHubin tiedostolistassa näkyy uusi commit-viesti.
- **Muutos:**
  - `.gitignore`: `*.log` ja `.claude/worktrees/`.
  - `.vercelignore`: `**/.DS_Store` ja `**/*.log`.
  - `package.json` ja `package-lock.json`: `"license": "UNLICENSED"`, joka vastaa LICENSEn "kaikki oikeudet pidätetään" -ehtoa.
  - `vercel.json`: vain muotoilu (`regions` omille riveilleen), sisältö ennallaan.
- **Tarkistukset:** `npm test` 670/670, `git diff --check` läpi. Julkaisua ei tarvita.

## 20.11.2026 — aimo-ain lisenssi pois, kopioidut testipohjat uusiksi ja historia aiheittain (Claude Code)

- **Eeliksen pyynnöt:** GitHubin tiedostolistaan kuvaavampi viesti jokaisen tiedoston viereen ("Yes, topical commits"). Lisäksi kysymys, tarvitaanko `LICENSE-aimo-ai`-tiedostoa enää ("Rewrite, then remove").
- **Uusi tarkistus löysi kopioitua koodia, jonka aiempi tarkistus ohitti.** Sama tapa kuin ennen (aimo-ain `git blame` HEADissä, muiden kuin Eeliksen vähintään 25 merkin rivit), mutta rivejä haettiin kaikista tiedostoista eikä vain saman nimisestä. Danielin `shopping-list-handoff`-testin pohja oli sellaisenaan tiedostoissa `test/whatsapp-cart-link.test.mjs` (47 riviä) ja `test/whatsapp-abuse.test.mjs` (24 riviä). Myös `test/audit-fixes-c.test.mjs`:ssä oli 10 riviä samaa. Aiempi tarkistus ei löytänyt niitä, koska tiedostojen nimet eroavat.
- **Kirjoitettu uusiksi:** uusi yhteinen apu `test/helpers/demo-ordering.mjs` (synteettinen tuotelista, testikeittiöt, tilausmoottorin testityökalut, luonnosvarastoon perustuva tilausyhteys, testipalvelin ja Metan webhook-viesti). Kolmen testin pohjat käyttävät sitä. Testit ja niiden tarkistukset ovat ennallaan: 9, 20 ja 7 testiä kuten ennen.
- **Jäljellä 73 yksittäistä riviä**, kuten Noden HTTP-rungon luku, `res.writeHead(404); res.end();`, testin siivous, puhelinnumerovakiot, `BEGIN IMMEDIATE` ja `@vercel/functions`-riippuvuus. Ne ovat yleisiä tapoja kirjoittaa sama asia, eikä niissä ole yhtenäistä tiimiläisen kirjoittamaa kokonaisuutta.
- **Lisenssi:** `LICENSE-aimo-ai` ja LICENSEn viimeinen kappale poistettu. READMEn Tausta kertoo yhä yhdellä virkkeellä, että tilausapuri sai alkunsa hackathonin prototyypistä.
- **Historia:** `main` rakennettiin uudelleen aiheittaisiksi commiteiksi samasta lopputilasta, joten GitHub näyttää jokaisen tiedoston vieressä sen aiheen (esim. TYOLOKIn vieressä "Työohjeet ja työloki"). Mukana on myös toisen session e100e96 ("Tidy root config files"). Muistihaara `claude/agent-v2-memory-3fd408` poistettiin GitHubista, koska sen historiassa on tiimiläisten koodia. Haara on tallessa paikallisesti ja bundlessa.
- **Varmuuskopiot:** `backup/historia-20261120` (vanha historia), `backup/main-ce34c9f-e100e96` (yhden commitin versio) ja `data/historia-20261120.bundle`, jotka kaikki ovat vain paikallisia.
- **Tarkistukset:** `npm test` 670/670, Worker 55/55, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58, `git diff --check` läpi.

## 20.11.2026 — mainin historia yhdeksi commitiksi (Claude Code)

- **Eeliksen päätös:** "Yes, one commit". GitHubin tiedostolistassa ja historiassa näkyi vanhoja tuontiviestejä, ja Valio näkee repon nyt ensimmäistä kertaa.
- **Muutos:** `main` on nyt yksi commit "Tilausapurin ensimmäinen julkinen versio", jonka sisältö on tavulleen sama kuin vanhan mainin kärjessä (6c31452 ja tämä merkintä). Ensimmäisen version viesti oli "Valio Aimo -tilausapuri". Eelis piti sitä hämmentävänä, koska GitHub näyttää viestin lähes jokaisen tiedoston vieressä, joten commit tehtiin uudelleen. Eelis hyväksyi pakotetun pushin (`--force-with-lease`) tämän kerran, vaikka AGENTS.md muuten kieltää sen.
- **Vanha historia tallessa paikallisesti:** haara `backup/historia-20261120` ja `data/historia-20261120.bundle` (Gitin ohittama). Tämän lokin vanhat commit-tunnisteet löytyvät sieltä. Varmuuskopiota ei pushata.
- **Muut haarat (Eelis: "Delete, keep memory"):** GitHubista poistettiin 14 vanhaa sivuhaaraa. Jäljellä on vain `main` ja muistihaara `claude/agent-v2-memory-3fd408`, joka on yhä vanhalla historialla. Kolmessa poistetussa haarassa oli commiteja, joita ei ollut mainissa (korilista ja tilausaika, Opus/Sonnet-vertailun jälki ja niputuksen vanha versio). Ne ovat käytännössä jo mainissa toisessa muodossa, ja ne on tallessa paikallisissa haaroissa `backup/agent-v2-cart-list`, `backup/agent-v2-eval-25c0f3` ja `backup/agent-v2-gather-0b353c` sekä bundlessa. Haaran saa uuden mainin päälle näin: `git rebase --onto main $(git merge-base <haara> backup/historia-20261120) <haara>`. Tavallinen merge ei toimi, koska historioilla ei ole yhteistä committia.
- **Muut sessiot:** jos paikallinen `main` on vanhalla historialla, `git fetch origin` ja `git checkout -B main origin/main` (vain kun työpuu on puhdas). `git pull` ei toimi.

## 20.11.2026 — README: tausta yhdellä maininnalla (Claude Code)

- **Eeliksen palaute:** Valio näkee repon ensimmäistä kertaa, ja hackathon-prototyypin toistuvat maininnat näyttävät siltä kuin koodi olisi kopioitu. "Ensivaikutelma on just se mikä ratkasee."
- **README:** Tausta on nyt kaksi virkettä, ja hackathon-prototyyppi mainitaan kerran nimeltä. Tekijät-kohdasta poistettiin "Pohjana …" ja MIT-virke, koska LICENSE kertoo saman. LICENSEen ja LICENSE-aimo-aihin ei koskettu.
- **Avoinna, Eeliksen päätös:** GitHubin tiedostolistassa näkyy yhä vanhoja commit-viestejä (`api`, `.gitignore`, `vercel.json` ym.), samoin commit-historiassa.

## 20.11.2026 — READMEn Tausta-osio uusiksi (Claude Code)

- **Eeliksen pyyntö:** Tausta-osio hänen ehdotuksensa mukaan. Kehitys jatkui Eeliksen omana työnä, ja hän kertoi tiimille avoimesti jatkavansa omassa repossaan. Aimo-ai on yhä tiimin yhteinen projekti MIT-lisenssillä, ja tiimiläisten osat on poistettu tai kirjoitettu uusiksi 20.11.
- Linkki aimo-aihin säilyi. Toistoa karsittiin: "jatkan kehitystä itse" on nyt vain kerran.
- Vain README ja tämä loki. Ei testejä, koska mikään testi ei lue READMEa. `git diff --check` läpi.

## 20.11.2026 — repo jaettu Valiolle, ja repo on julkinen (Claude Code)

- **Eelis lähettää Valiolle** puhelun jälkeen viestin: repon linkki Tommille ja muille sekä slidet (artifact, näkyy kaikille, joilla on linkki). Viestissä Eelis antaa luvan tutkia ja testata koodia sisäisesti. Tämä on kirjallinen lupa arviointiin, jota lisenssimerkinnässä suositeltiin.
- **Repo on julkinen** GitHubissa (`visibility: public`), vaikka 17.11. merkinnässä lukee "yksityinen". Eelis vahvisti: "Public is fine". AGENTS.md päivitetty: lokiin ja dokumentteihin ei kirjata mitään, mitä ei saa näyttää muille.
- **Tarkistus ennen lähetystä:** seurattuja tiedostoja ja historiaa haettiin API-avainten ja tokenien malleilla, eikä mitään löytynyt. Ainoa oikea puhelinnumero on Eeliksen oma numero sivustolla, ja se on siellä tarkoituksella. Kaikki muut ovat esimerkkinumeroita.
- Ei koodimuutoksia eikä testejä.

## 20.11.2026 — turha koodi pois, sähköpostivahvistus pois ja README ajan tasalle (Claude Code)

- **Eeliksen pyyntö:** mahdollisimman vähän turhaa koodia ja README täsmälleen sellaiseksi kuin apuri nyt toimii. Tilausvahvistus tulee WhatsAppiin eikä sähköpostiin, joten sähköpostipohja ja Resend pois. Arkkitehtuurikuva uusiksi, koska agenttina on Claude Opus.
- **Sähköposti poistettu:**
  - Worker: `src/email.ts`, Resend- ja `EMAIL`-lähetys, uusinnat ja tilat (`sender_missing`, `sent` …) sekä `email`-kenttä tilaustapahtumasta ja maksureiteiltä. Maksusivulta poistui sähköpostin tilarivi ja "Lähetä vahvistus uudelleen" -painike.
  - Pohja `public/emails/order-confirmation.html` ja kuva `docs/kuvat/sahkoposti.webp`.
  - Julkaisija (`publish-orders.mjs`, `server/cloud.mjs`): ei `ORDER_EMAIL_TO`- eikä nimiasetusta. Tilaus merkitään välitetyksi heti, kun Worker kuittaa sen.
  - Botin kiitosviesti ei enää mainitse sähköpostia. Se on tilausvahvistus.
  - D1: `order_events` on nyt `order_id, received_at, json`. Lisäävät migraatiot (`agent-trace.sql`, `demo-payment.sql`, `web-chat.sql`, `landing-settings.sql`) yhdistetty `schema.sql`:ään. Uusi `drop-email.sql` poistaa tuotannosta sähköpostisarakkeet ja vanhan `signups`-taulun.
- **Muu käyttämätön koodi poistettu** (selvitys tuontigraafista ja haaroista):
  - Docker-ajo omalle palvelimelle: `deploy/whatsapp/`, `scripts/whatsapp-preflight.mjs` testeineen ja `docs/whatsapp-deploy.md`. Tuotanto on Vercelissä, ja `npm run whatsapp` toimii paikallisesti ennallaan.
  - Vanha yksinkertainen korisivu `public/whatsapp-cart.*` ja `WHATSAPP_CART_VIEW=simple`. Korisivu on aina kaupan näköinen sivu.
  - `npm run eval`, `scripts/eval.mjs`, `eval/cases.mjs` ja `server/gateway/buyerAgent.mjs`: ne kutsuivat suljettua testirajapintaa.
  - `server/static-assets.mjs` (vain testi käytti) ja neljä vientiä, joita mikään ei käyttänyt.
  - `docs/ordering-demo.md` (kuvasi numerovalintoja, joita agentti ei enää käytä).
- **Päätös: vanhaa putkea ei poistettu.** Korisivun tekstimuutokset, "näytä" ja TILAA kulkevat yhä vanhan dialogin ja tilausytimen kautta myös v2:ssa, ja vain se tekee tilauksen. Pelkästään vanhalle putkelle kuuluvaa koodia on noin 600 riviä (linkkineuvot ja korilinkin vanha haara), mutta sen poisto vaatisi korisivun siirtämisen agentille. Siitä erillinen päätös.
- **README kirjoitettu uusiksi:** agentin tarkistuslista ja työkalut, kulku korilinkistä maksuun ja WhatsApp-vahvistukseen, mallit (Opus 5.5 nopealla tilalla agenttina, Sonnet 5.5 oikoluku, Haiku 5.5 kuvat, linkit ja korisivun muutokset), Groq Whisper, viimeisimmät tunnetut hinnat noin 900 tuotteelle ja uusi arkkitehtuurikuva. Vanhentuneet keskustelukuvat (numeroidut vaihtoehdot) poistettu, ja maksun onnistumisnäkymä kuvattu uudelleen paikallisesti keksityllä demotilauksella.
- **Myös:** `docs/order-events.md` kirjoitettu nykyiselle kululle, `docs/agent-trace.md`, `docs/web-chat.md`, `docs/aimo-malli.md`, `docs/cloudflare.md` ja AGENTS.md päivitetty. Näin se toimii -sivu ei enää väitä MCP-rajapintaa tuotannon ominaisuudeksi.
- **Tarkistukset:** `npm test` 670/670, Worker 55/55 (sähköpostitestit poistettu) ja typecheck, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58, `git diff --check` läpi. Ei mallikutsuja, ei Metaa, ei tuotannon muutoksia.
- **Julkaisu kesken (sessio E, Eeliksen luvalla):**
  1. Botti (Vercel). Vanha Worker toimii uuden botin kanssa.
  2. Worker (Cloudflare) ja heti perään `drop-email.sql` ([docs/cloudflare.md](docs/cloudflare.md)). Siihen asti uuden tilauksen tallennus epäonnistuu, ja julkaisija yrittää uudelleen minuutin välein.
- **Jäljellä:** Keskustele-sivun koodinäkymä (`agent-code.js`) ja demon esimerkkijälki näyttävät yhä vanhan putken numerovalinnat.
- **Julkaistu (sessio E, 20.11. klo 14.49–14.52):** Eelis hyväksyi session E:ssä. Mukana myös 2e75436 ja 6f1c79c, joita sessio "Sote-hackathon tiimihakemus" pyysi.
  - Botti mainista 3022ae3: aimo-whatsapp-3e9t190z5 (dpl_55DwVVXaT1PkTfb8KrMSyLjfLaPK). Asetukset ennallaan (Opus 5.5 high, v2, nopea tila, rinnakkaisuus 8).
  - Worker heti perään: versio 85699ab9-0aea-4c25-b8f6-77256d0fb3df.
  - Heti Workerin jälkeen `drop-email.sql` D1-kantaan aimo-order-demo. Tämän `cf`-version komento on `cf d1 query <tietokanta-id> --sql`, ei `cf d1 execute`.
    - `order_events`-taulussa on nyt vain sarakkeet order_id, received_at ja json, ja kaikki 19 tapahtumaa säilyivät.
    - `signups`-taulu poistettu, se oli tyhjä.
    - Ennen poistoa yhdessäkään tapahtumassa ei ollut sähköpostiosoitetta.
  - Ennen julkaisua `npm test` 670/670, Worker 55/55 ja typecheck, eval 26/26, spoken 58/58, tuoteajo 611/0.
  - Julkaisun jälkeen:
    - healthz `host: cloud`, verify ja tick 200, `/webchat/api/order-paid` ilman avainta 401.
    - Workerin sivut 200, `/demo-payment.html` ohjaa sivulle `/demo-payment` (200), `/api/sync` ilman avainta 401.
    - Korisivu ja sen tiedostot (`/whatsapp/cart/shop.js` ym.) 200. Vanhaa `/whatsapp/cart.js`-tiedostoa ei enää ole eikä sitä käytetä.
    - Selainkeskustelun "tuki" sai kiinteän vastauksen ilman mallikutsua.
  - Oikeaa WhatsApp-viestiä, korilinkkiä ja kiitosviestiä ei kokeiltu, koska Eelis ei halua käyttää testeihin rahaa.

## 20.11.2026 — lisenssin lopullinen teksti, ja tarkistus uudelleenkirjoituksen jälkeen (Claude Code)

- **Eeliksen pyyntö:** lisenssiksi hänen oma tekstinsä ("haluun et lisenssi on just näin, jos tää asianajajan mielestä on ok"). Yksi lisäys Eeliksen luvalla ("Sun korjauksella"): muokkauslupauksen loppuun "ja siitä sovitaan erikseen", jottei lause ole ehdoton lupaus ilmaisesta työstä.
- **LICENSE nyt:**
  - "Copyright (c) 2026 Eelis Puro. Kaikki oikeudet pidätetään."
  - Suunniteltu Valiolle. Toistaiseksi kukaan muu ei saa käyttää, kopioida tai jakaa sitä ilman Eelis Puron lupaa, ja Valion kanssa sovitaan käytöstä erikseen. Luvaton käyttö voi johtaa sakkoihin.
  - "Eelis Puro muokkaa ohjelmistoa vielä mielellään Valion mieltymysten mukaisesti, ja siitä sovitaan erikseen! :-)"
  - Aimo-aista peräisin olevat osat ovat MIT-lisenssillä, ks. `LICENSE-aimo-ai`.
  - Takuurivi ja korvausvelvollisuuden maininta jäivät pois Eeliksen tekstin mukaisesti. Aiemmat versiot ovat commiteissa 22702ec ja 51ea671.
- **Tarkistus uudelleenkirjoituksen (2e75436) jälkeen:** sama vertailu kuin ennen (aimo-ain `git blame`, muiden kuin Eeliksen vähintään 25 merkin rivit, jotka löytyvät sellaisenaan saman nimisestä tiedostosta). Tulos 76 riviä, ennen 1 060. Kaikki ovat importteja, moduulien ja funktioiden nimiä, taulun sarakemäärittely tai muita yleisiä yksittäisiä rivejä. Luovaa sisältöä ei ole. Uudelleenkirjoitussession oma laskenta antoi 47, koska se rajasi rivit eri tavalla.
- **`LICENSE-aimo-ai` jää:** Eeliksen hyväksymä teksti viittaa siihen, ja vanhoissa commiteissa on yhä tiimiläisten koodia. Ylemmän lisenssimerkinnän kesken-kohta on näin ratkaistu.
- **Tarkistukset:** vain LICENSE ja tämä loki muuttuivat. `git diff --check` läpi.

## 20.11.2026 — aimo-aista tulleet tiimiläisten rivit kirjoitettu uusiksi, MCP-lukuohje poistettu (Claude Code)

- **Eeliksen pyyntö:** "Kirjoita kaikki uusiksi": nykyisessä koodissa ei saa olla tiimiläisten kirjoittamaa koodia.
- **Kartoitus:** aimo-ain `git blame` (rivit, joiden tekijä ei ole Eelis) verrattiin tämän repon tiedostoihin. Tulos oli 1 060 riviä 32 tiedostossa. Lähes kaikki olivat Danielin: WhatsApp-kanava, viestijono, tilaus- ja ostoslistamoduulit, mallikutsut ja niiden testit. Aleksin rivejä oli noin 70 (selaindemo).
- **Poistettu:** vain lukeva MCP-apuri (`server/assistant.mjs`, `chatWithMcp`, `ASSISTANT_MCP_*`-asetukset, preflightin haara ja testi). Se käytti Danielin ylläpitämää tuotepalvelinta, eikä tuotanto käyttänyt sitä, koska `push-env` pakottaa tilaustilan. Kun tilaustila on pois, botti vastaa "Tilausapuri ei ole nyt käytössä." ja preflight varoittaa `ORDERING_OFF` (ennen `READ_ONLY_AGENT_NOT_READY`).
- **Kirjoitettu uusiksi samalla toiminnalla:**
  - palvelin: `server/whatsapp/` (channel, store, runtime, ordering, demo-buyer, shopping-list, web-demo, cart-link), `server/whatsapp-server.mjs`, `server/aimoAgent.mjs`, `server/shopping-list/index.mjs`, `server/order-conversation/runtime.mjs`, `server/storefront-whatsapp-sync.mjs`, `server/local-shop.mjs`, `scripts/whatsapp-member.mjs` ja `public/whatsapp-demo.html`. Lisäksi yksittäiset rivit tiedostoissa `server/storefront.mjs`, `server/catalog.mjs`, `scripts/whatsapp-preflight.mjs` ja `deploy/vercel/push-env.mjs`, sekä `.env.example` ja `docs/whatsapp.md`.
  - testit: `whatsapp`, `whatsapp-http`, `whatsapp-preflight`, `shopping-list-handoff`, `whatsapp-kahvila-aalto`, `storefront-whatsapp-sync` ja `whatsapp-web-demo`. Uudet testit kattavat kaiken, mitä vanhat tarkistivat, ja osin enemmän.
  - Rajapinnat, reitit, tilakoodit, asiakkaalle näkyvät tekstit ja kannan rakenne ovat ennallaan. Tuoreen kannan taulut, sarakkeet ja indeksit tarkistettiin samoiksi kuin ennen. Myös kutsukoodin tiiviste ja puhelinnumeron käsittely tuottavat saman tuloksen.
  - Pienet sisäiset erot, joita testit eivät huomaa:
    - Viestin runko luetaan virran omalla virheellä ilman `aborted`-kuuntelijaa.
    - Käyttäjän ja vastauksen historiavuoroilla on sama aikaleima.
    - Palvelin sammuu kerran, vaikka saisi sekä SIGINTin että SIGTERMin.
    - Kanava ja kiitosviesti käyttävät samaa Meta-lähettäjää.
    - `ensureBuyer` ei hae kantaa uudelleen, kun ostaja on jo olemassa.
- **Jäljellä 47 riviä:** importit, viedyt funktio- ja reittinimet, yksi taulun sarakemäärittely, `BEGIN IMMEDIATE`, `@vercel/functions`-riippuvuusrivi ja yleinen CSS-mediakysely. Ne ovat pakollisia rajapintoja eivätkä luovaa sisältöä. Lisäksi tehtiin polusta riippumaton haku kaikista riveistä, jotka tiimiläiset ovat koskaan lisänneet aimo-aihin. Se löysi vain yleisiä rivejä, kuten `await f.channel.processNext();`, sekä yhden kopioidun testiasetusrivin tiedostosta `test/whatsapp-voice.test.mjs`. Se kirjoitettiin uusiksi.
- **Git-historia:** vanhoissa commiteissa (esim. `a28435e`, `6cb0fe1` ja `86d7b7a`) näkyy yhä tiimiläisten koodi. Siksi `LICENSE-aimo-ai` jää. Jos koodi annetaan Valiolle, sen voi antaa uutena repona ilman tätä historiaa.
- **README:** uusi Tausta-osio kertoo, että tilausapuri sai alkunsa Junctionin aimo-aista ja kehitys siirtyi tänne 17.11.
- **Tarkistukset:**
  - `npm test` 678/678 kahdesti.
  - CI:n kaltainen kopio ilman `data/`-hakemistoa ja fontteja: 585 läpi, 93 ohitettu, 0 virhettä. Kaikki 94 testitiedostoa menevät läpi myös yksin.
  - Worker 60/60. Worker-koodiin ei koskettu, joten typecheckiä ei ajettu.
  - `aimo:eval` 26/26 ja `aimo:eval:spoken` 58/58.
  - Mainin vanhat testiversiot uutta koodia vastaan: 42/43. Ainoa ero on tarkoituksellinen `ORDERING_OFF`.
  - Riippumaton katselmointi ajoi vanhaa (a0f8235) ja uutta koodia rinnakkain. Se ei löytänyt tuotantoon vaikuttavaa eroa MCP-poiston lisäksi. Tarkistetut osat:
    - viestijono: 400 satunnaista 160 operaation sarjaa, joissa tulokset ja kanta olivat samat
    - kanava: 36 skenaariota
    - tilausmoduuli: 20 skenaariota
    - webhook oikean HTTP:n yli
  - Katselmoinnin löydöksistä korjattiin kaksi:
    - Liittämättömän numeron viesti teki kanavassa kuusi jäsenhakua yhden sijaan, eli pilvessä turhia Turso-kyselyjä. Nyt haku tehdään vain, kun viestillä on liitos.
    - Korisivun listan lukua edeltävä oikeustarkistus palautettiin. Ilman sitä toisen instanssin tekemä numeron poisto olisi voinut osua kahden kyselyn väliin.
  - Korjausten jälkeen kanavan 36 skenaariota tekevät täsmälleen samat kantakutsut samassa järjestyksessä kuin vanha koodi, ja tilausmoduulin 20 skenaariota toimivat samoin.
  - Mallikutsuja, Meta-viestejä ja tilauksia ei tehty.
- **Julkaisu:** ei julkaistu. Seuraava botin julkaisu (sessio E, Eeliksen luvalla) sisältää uudelleenkirjoitetun WhatsApp-ytimen. Julkaisun jälkeen kokeillaan oikea WhatsApp-viesti, korilinkki, selainkeskustelu ja maksun jälkeinen kiitosviesti.

## 20.11.2026 — lisenssi: kaikki oikeudet pidätetään, käyttöön vain Valiolle (Claude Code)

- **Eeliksen pyyntö:** MIT:n tilalle "kaikki oikeudet pidätetään". Käyttö vain Eeliksen luvalla, ja käytöstä sovitaan Valion kanssa. Eelis ei myy apuria muille kuin Valiolle.
- **LICENSE (lyhyt versio, Eeliksen jatkopyyntö "ei tarvii isoo lisenssii"):**
  - "Copyright (c) 2026 Eelis Puro. Kaikki oikeudet pidätetään."
  - Suunniteltu Valiolle. Toistaiseksi kukaan muu ei saa käyttää, kopioida tai jakaa sitä ilman Eelis Puron lupaa, ja Valion kanssa sovitaan käytöstä erikseen.
  - Luvaton käyttö voi johtaa sakkoon ja korvausvelvollisuuteen tekijänoikeuslain mukaan. Sakon määrää tuomioistuin; lisenssi ei voi itse asettaa sakkoa.
  - Ei takuuta.
  - Ensimmäinen, pidempi versio oli commitissa 22702ec.
- **Uusi LICENSE-aimo-ai:** alkuperäinen MIT-teksti ja merkintä "Copyright (c) 2026 Aimo Agent Gateway contributors" niille osille, jotka ovat peräisin aimo-aista. MIT vaatii säilyttämään ne.
- **README:** Tekijät-kohta kertoo saman, ja aimo-ain osat ovat MIT-lisenssillä.
- **Aimo-ai pysyy MIT:nä:** siinä on koko tiimin koodia, eikä jo annettua lisenssiä voi perua. Uusi lisenssi koskee Junctionin jälkeen tässä repossa tehtyä työtä.
- **Kun koodi annetaan Valiolle:** luovutusviestiin kirjallinen lupa arviointiin. Varsinaiset ehdot kirjoitetaan sopimukseen (asianajaja).
- **Tarkistukset:** vain lisenssi- ja dokumenttimuutos, eikä mikään testi lue LICENSE- tai README-tiedostoa. `git diff --check` läpi.
- **Kesken, Eeliksen päätös "Uudelleenkirjoituksen jälkeen":** kun muiden koodin uudelleenkirjoitus (haara `claude/own-rewrite`) on mainissa, tarkistetaan, ettei muiden rivejä ole jäljellä. Tapa: aimo-ain `git blame` HEADissä, muiden kuin Eeliksen vähintään 25 merkin rivit, jotka löytyvät sellaisenaan saman nimisestä valioaimon tiedostosta. 20.11. tulos ennen uudelleenkirjoitusta: Danielin noin 390 lähdekoodiriviä, 480 testiriviä ja 50 dokumenttiriviä sekä Aleksin noin 70 riviä. Kun tulos on 0, poistetaan `LICENSE-aimo-ai`, LICENSEn viimeinen kappale ja READMEn MIT-maininta, ja jäljelle jää yksi lisenssi.

## 20.11.2026 — paikalliset mallit pois, ja oikaisu: koodin omistuksesta ei ole sopimusta (Claude Code)

- **Eeliksen oikaisu:** tiimin kanssa ei ole sovittu mitään koodin omistuksesta, siirrosta tai myynnistä. 17.11. merkinnät kirjallisesta sopimuksesta ja siitä, että Danielin kanssa olisi sovittu koodin siirrosta, eivät pidä paikkaansa, ja ne on oikaistu.
- **Päätös:** Eeliksen mukaan Valio on kiinnostunut apurista ja pyysi, ettei sitä myydä eteenpäin muille. Toimitaan sen mukaan.
- **Poistettu:** itse ajettavan mallin polku, joka tuli aimo-aista 15.–17.11. Siinä olivat Ollama-sovitin, mallivalinta, selfhost-demo ja Ollama-Compose sekä niiden skriptit, testit, GPU-, hosting-, hienosäätö- ja white label -suunnitelmat ja arviointiraportit. Eeliksen mukaan paikalliset mallit olivat heikkoja eikä niitä käytetty. Tuotanto käyttää vain Anthropicia (`config.llmProvider` on nyt aina `anthropic`). Tuotannon toiminta ei muutu.
- **Jäljellä aimo-ain koodia:** esim. `scripts/whatsapp-member.mjs`, `server/whatsapp/demo-buyer.mjs`, `server/whatsapp/shopping-list.mjs` ja `public/whatsapp-demo.html`. Ne aloitettiin aimo-aissa muiden tiimiläisten committeina, ja ne ovat käytössä. Lisäksi yhteisissä tiedostoissa voi olla muiden rivejä. Siksi LICENSE mainitsee nyt myös aimo-ain tekijät: "Portions Copyright (c) 2026 Aimo Agent Gateway contributors (aimo-ai)". MIT vaatii pitämään merkinnän. (Myöhemmin samana päivänä nämä tiedostot kirjoitettiin uusiksi, ja aimo-ain MIT-merkintä siirtyi tiedostoon `LICENSE-aimo-ai`, ks. ylemmät merkinnät.)
- **README:** pohjana Junction-tiimin aimo-ai (MIT), ja tämän repon version on jatkokehittänyt Eelis Puro.
- **Tarkistukset:** `npm test` 668/668 (19 Ollama- ja selfhost-testiä poistettu tiedostojen mukana), Worker 60/60, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. `git grep` ei löydä Ollama- eikä selfhost-viittauksia muualta kuin tästä lokista.
- **Julkaisu:** ei tarvita heti. Botin seuraava julkaisu (sessio E) ottaa muutoksen mukaan.

## 20.11.2026 — vanhan repon maininnat poistettu (Claude Code)

- **Eeliksen pyyntö:** poista repon tiedostoista kaikki maininnat vanhasta reposta.
- **Muutos:** maininnat poistettu tai kirjoitettu yleisiksi tiedostoista AGENTS.md, TYOLOKI.md, `docs/agent-v2.md`, `docs/agent-v2/arviointi.md`, `docs/cloudflare.md` ja `docs/evaluations/whatsapp-chaos-20261117.md`. Cloudflare-account mainitaan nyt pelkällä ID:llä.
  - Tilausvahvistussähköpostin logo (`deploy/cloudflare/src/email.ts`) haettiin vanhan repon GitHubista. Nyt se haetaan Workerin omasta osoitteesta `/aimo-logo.png` (sama kuva, vastaa 200).
  - Sähköpostin mallitiedoston (`public/emails/order-confirmation.html`) kuvat osoittavat nyt saman repon tiedostoihin suhteellisilla poluilla.
- **Tarkistukset:** `git grep` ei löydä mainintoja. `npm test` 687/687, Worker 60/60.
- **Historia ennallaan:** vanhat commitit ja 7 commit-viestiä mainitsevat aimo-ain yhä. Historian uudelleenkirjoitus tehtiin ja tarkistettiin erillisessä kopiossa, mutta Eelis perui sen ennen pushia ("Peru, lisää README"): maininnat saavat jäädä. Mitään ei pushattu, ja kopio poistettiin.
- **README:** uusi rivi kertoo, että repo on jatkojalostettu tiimin yhteisestä aimo-ai-reposta.
- **Julkaisu:** sähköpostin logo muuttuu tuotannossa vasta Worker-julkaisussa (sessio E, Eeliksen luvalla). Sähköposteja ei nyt lähetetä demossa, joten kiirettä ei ole.

## 20.11.2026 — Näin se toimii -sivu ajan tasalle (Claude Code)

- **Eeliksen pyyntö:** päivitä sivu https://aimo-order-demo.aimo-demo-41cfac.workers.dev/miten ajan tasalle.
- **Vanhentunutta oli:**
  - ymmärtäjänä Haiku, ja malli ei muka valitse tuotteita
  - kokki valitsee numerolla
  - hinnat kysytään Valiolta jokaiselle tuotteelle
  - apuri pyörii Eeliksen koneella Cloudflare-tunnelin takana
- **Muutos (`deploy/cloudflare/public/miten.html`, vain teksti):** kymmenen vaihetta kuvaavat nyt nykyistä toimintaa:
  - viestien niputus (6 s / 20 s) ja ääni, kuva ja linkki vain WhatsAppissa
  - v2-agentti: Claude Opus 5.5 nopealla tilalla, tarkistuslista, 13 työkalua, hintavartija ja Sonnet 5.5 -oikoluku
  - apuri valitsee sopivimman tuotteen, jonka voi vaihtaa, ja erityistuotteen vain tarpeeseen
  - viimeisimmät tunnetut Valion hinnat noin 900 tuotteelle, koska testirajapinta suljettiin
  - kiitosviesti WhatsAppiin maksun jälkeen
  - Vercel (Frankfurt), Turso ja minuutin ajastin
  - Koodinäkymän selitteistä kolme päivitetty samaan. Koodinäkymää (`agent-code.js`) ei muutettu.
- **Tarkistukset:** Worker-testit 60/60. Sivu katsottu paikallisesti selaimessa.
- **Julkaisu:** Worker-julkaisu tarvitaan (sessio E, Eeliksen luvalla).
- **Julkaistu (sessio E, 20.11.):**
  - Worker mainista 6867e48: versio 5daab028-debb-4be3-a430-e67e3a3546f0. Botti ennallaan.
  - Ennen julkaisua Worker 60/60.
  - Julkaisun jälkeen `/miten` 200, sivu on tavulleen sama kuin repossa ja sisältää otsikon "Claude-agentti hoitaa keskustelun". Muut sivut 200.

## 20.11.2026 — maksun jälkeen kiitosviesti WhatsAppiin (Claude Code)

- **Eeliksen pyyntö:** kun tilaus on tehty ja maksettu, botti lähettää WhatsAppiin kiitosviestin: toimituspäivä, jolloin tuotteiden pitäisi saapua, "tilaa multa milloin vain uudestaan" ja maininta sähköpostin tilausvahvistuksesta.
- **Toteutus:**
  - Worker (`deploy/cloudflare/src/order-paid.ts`, `demo-payment.ts`, `index.ts`): hyväksytty demomaksu kutsuu taustalla botin reittiä `POST /webchat/api/order-paid` jaetulla `WEBCHAT_SECRET`illa, ja maksusivun vastaus ei odota sitä. Yksi uusinta 5xx-vastauksen tai aikakatkaisun jälkeen.
  - Botti (`server/whatsapp/order-paid.mjs`, kytketty `runtime.mjs`:ään): etsii tilaajan numeron gatewayn tilauksesta ja lähettää viestin kerran tilausta kohden (uusi taulu `order_notices` WhatsApp-kantaan). Selainkeskustelun asiakkaille ja uudelleen liitetyille numeroille ei lähetetä mitään.
  - Viesti: "Kiitos tilauksestasi! Maksu on hyväksytty ja tilaus AGW-… on vahvistettu." / "Toimitus on ti 24.11., joten tuotteiden pitäisi saapua silloin." / "Tilaa multa milloin vain uudestaan!"
- **Päätös, sähköposti:** tuotannon D1-kannassa kaikki 16 tilausta ovat sähköpostin osalta tilassa `not_requested` (luettu 20.11.). `ORDER_EMAIL_TO` puuttuu, eikä asiakkaan sähköpostiosoitetta kysytä, joten vahvistussähköpostia ei lähde kenellekään. Rivi "Tilausvahvistus on myös sähköpostissasi." tulee siksi vain, kun Worker kertoo sähköpostin lähteneen (`sent`), eli ei nyt demossa. Oikea sähköposti vaatisi osoitteen kysymisen asiakkaalta sekä lähettäjän (Resend tai Cloudflare Email) asetukset.
- **Rajat:** Meta ottaa vapaan viestin vastaan vain 24 tunnin sisällä asiakkaan viimeisestä viestistä. Myöhemmin maksettu tilaus jää ilman kiitosviestiä (lokissa `order_paid_notice` `send_failed`). Viestiä ei lisätä mallin keskusteluhistoriaan.
- **Tarkistukset:** uusi `test/whatsapp-order-paid.test.mjs` 4/4 ja `deploy/cloudflare/test/order-paid.test.mjs` 2/2. `npm test` 687/687, Worker 60/60 ja typecheck, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Oikeaa WhatsApp-viestiä ei lähetetty eikä mallikutsuja tehty.
- **Julkaisu kesken:** sekä botti (Vercel) että Worker (Cloudflare) tarvitsevat julkaisun sessio E:ltä Eeliksen luvalla, botti ensin. Jos Worker julkaistaan ensin, botti hylkää kutsun (4xx), ja vain kiitosviesti jää tulematta.
- **Julkaistu (sessio E, 20.11.):**
  - Botti klo 8.05: main d7fb9d4, aimo-whatsapp-e49kcdmq5 (dpl_HcoMSmi72nrWRvaDYxHbdgNE6Ytk).
  - Worker heti perään: versio 1f76353a-1d13-4a8e-ba3f-a0936edd12e8.
  - Asetukset ennallaan (Opus 5.5 high, v2, nopea tila, rinnakkaisuus 8).
  - Ennen julkaisua `npm test` 687/687, Worker 60/60 ja typecheck, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen:
    - healthz `host: cloud`, verify ja tick 200.
    - `POST /webchat/api/order-paid` ilman avainta 401.
    - Workerin sivut 200, `/api/chat` available, `/api/sync` ilman avainta 401.
  - Oikeaa kiitosviestiä ei kokeiltu, koska se vaatii demotilauksen ja maksun.

## 20.11.2026 — kolmen viestin kokeilu peruttu: takaisin da561df:n ohjeeseen, ja hinta aina korin riveille (Claude Code, sessio "WhatsApp testinumerot ja tilaukset")

- **Eeliksen palaute klo 0.00** tuotannon viestistä klo 23.53 (da561df: "Saat. Toimitus on ti 24.11. …", kurkku ja tomaatti kilohintoineen, salaatin korvaaja perusteluineen ja kysymykset): "joo saa lisää kyl kilohinnat sun muut ja korvaajat perusteluinee!! älä ota niitä pois", "sano aina hinnat ja sano aina noi tuotteet tollee kunnolla. tä oli esim tosi hyvä viesti ja itseasias joo annetaa ehkä vaa olla näi".
- **Muutos:** `server/agent/prompt.mjs` ja `test/agent-loop.test.mjs` palautettu da561df:n versioon. Kolmen viestin jako (384e85a) ja "perustelu vain kysyttäessä" (b491c2d) eivät ole enää ohjeessa. Ainoa lisäys: korin rivillä on valitun tuotteen koko nimi ja hinta tai kilohinta.
- **Tarkistukset:** `npm test` 683/683. Ei mallikutsuja (Eelis: ei rahaa testeihin).
- **Julkaisu:** tuotannossa on b491c2d (5eqaq56j9, klo 23.54). Tämä tarvitsee julkaisun sessio E:ltä Eeliksen luvalla.
- **Julkaistu (sessio E, 19.11. klo 23.57):**
  - main d0d519b: aimo-whatsapp-6taiaqp2i (dpl_EX1SFk9S7av68nhAfeMAKQxMxzjv). Asetukset ennallaan (Opus 5.5 high, v2, nopea tila, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 683/683, Worker 58/58, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.
  - Ei testiviestejä.

## 20.11.2026 — korin muuttuessa kolme lyhyttä viestiä: kuittaus, "Ostoskorissasi nyt:" ja kysymys (Claude Code, sessio "WhatsApp testinumerot ja tilaukset")

- **Eeliksen pyyntö (klo 0.10):** "nyt korjaa vaa noi vitun pitkät viestit?!??! eiks tä vois eka sanoo vaa et saat perunaa. Lisään ne toimitukseen. sit uus viesti: Ostoskorissasi nyt: ja sit vika viesti kysymyksiä tms". Lisäksi: "älä käytä rahaa enää testailemiseen".
- **Muutos (`server/agent/prompt.mjs`):** kun tuotteita valitaan tai kori muuttuu, vastaus jaetaan kolmeen viestiin `---`-erottimella (koodi tukee jo enintään kolmea, `splitMessages`):
  1. yksi lyhyt lause tehdystä, esimerkiksi "Saat perunaa. Lisään ne toimitukseen."
  2. "Ostoskorissasi nyt:" ja korin tuotteet viivalistana
  3. seuraava kysymys tai askel, ja puuttuvat tuotteet yhdessä lauseessa
  - Perustelut ja vaihtoehdot jätetään pois, ellei asiakas kysy tai valinta riipu hänen mieltymyksestään. Jos kori ei muuttunut, yksi viesti riittää.
  - "Vastaa yleensä yhdellä viestillä" on nyt "yhdellä vastauksella", jottei se riitele kolmen viestin kanssa.
  - Jatko (koordinaattorin huomio): "Kerro valinta ja peruste lyhyesti" riiteli uuden "perustelut pois" -säännön kanssa. Nyt "Kerro valinta lyhyesti … Perusteen kerrot, jos asiakas kysyy."
- **Tarkistukset:** `npm test` 683/683 ja agent-loopin uudet ohjetarkistukset. Oikealla mallilla ei ajettu Eeliksen pyynnöstä, joten vaikutus nähdään vasta tuotannossa.
- **Julkaisu:** Eelis hyväksyi ("Kyllä, julkaise"), pyydetty sessio E:ltä.
- **Julkaistu (sessio E, 19.11.):** 384e85a klo 23.53 (aimo-whatsapp-7xxxn7ait), sitten b491c2d klo 23.54: aimo-whatsapp-5eqaq56j9 (dpl_2esHij9YarUdnv8TbpZ1uht9PMUT). Asetukset ennallaan (Opus 5.5 high, v2, nopea tila, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 683/683, Worker 58/58, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.

## 19.11.2026 — WhatsApp-testi luovalla tilauksella: botti vastaa lyhyemmin ja etenee vaiheittain (Claude Code, sessio "WhatsApp testinumerot ja tilaukset")

- **Eeliksen pyyntö:** "voiks testaa et whatsapp oikeest toimii kunnol ja sil saa tilauksii … oo luova", "keksi muutaku ku maitoo perunaa sipulii ja kermaa".
- **WhatsApp-testi Eeliksen koneella klo 23.38–23.42**, tuotanto 40gssc7hr (Opus 5.5 high, nopea tila), ei tilausvahvistusta:
  - "tyhjennä ostoskori, aloitetaan iha alusta" tyhjensi korin, mutta vastaus oli "Kerro: – mitä tarvitset … – mille päivälle – onko allergioita" viivalistana.
  - "60 hengen meksikolainen ilta: kanaquesadillat, guacamole, salsa ja churrot" (lauantaiksi 21.11.) toi noin 25 s:ssa yhden ison viestin: 13 rivin lista, josta 10 riviä "ei nyt tilattavissa", korvaajaehdotukset ja kysymykset. Churroista botti sanoi vain "ei nyt tilattavissa".
  - "ei allergioita. sitruunat ja sipulit käy, loput pois" toi valmiin korin (kana, paprika, tomaatti, sitruuna ja sipuli, 72,39 € alv 0 %) ja Avaa ostoskori -painikkeen. Korisivua ja maksua ei käyty läpi, koska työ siirtyi korjaukseen.
  - Ehdotuksessa luki outo hinta: "Sitruuna 1 kg PSS za, 1 pussi (0,86 €/kg ei koske tätä, hinta on 2,73 €/kg)". Ei selvitetty.
  - WhatsAppin taustakirjoitus ei rekisteröidy lähetettäväksi. Viestit lähetettiin koko näytön hallinnalla.
- **Eeliksen palaute:** "tyhmän pitkä ja iso viesti", "tän pitäs olla vaa nopee juttu", "et tää etenis sit vaiheitain", "ei kukaa ihmine lähettäis noi pitkii viestei … kyselis noi eriksee et oliks jotai allergioi". Aloitus ilman luetteloa ("tän ei tarvii näitä kertoo vaa tää kysyy ne kyl sitte"). Churroista: "haluuks valmischurroi vai … churroresepti valion valikoimasta".
- **Muutos (`server/agent/prompt.mjs`):**
  - Yksi kysymys kerrallaan, kuten ihminen kysyisi (ennen "enintään yksi tai kaksi asiaa").
  - Uusi kappale: etene vaiheittain, viestit yleensä muutaman rivin mittaisia. Ison tilauksen tai koko menun kohdalla kootaan tuotteet ja kerrotaan lyhyesti, mitä saatiin valmiiksi. Puuttuvat tuotteet yhdessä lauseessa nimeltä eikä rivi kerrallaan. Kysymykset tavallisina lauseina, ei viiva- tai numerolistana.
  - Valmisruoasta tai leivonnaisesta, jota ei saa sellaisenaan (esim. churrot), kysytään, tekeekö keittiö sen itse, ja silloin ehdotetaan reseptin raaka-aineet valikoimasta.
  - Kori näytetään edelleen viivalistana, kun tuotteet valitaan tai muuttuvat (Eeliksen toive klo 18.40, koordinaattorin muistutus), mutta puuttuvat tuotteet eivät kuulu listaan.
  - Aloitus: asiakkaan tarvitsee kertoa vain, mitä hän tarvitsee, ja botti kysyy päivän ja allergiat myöhemmin. Alusta aloitus kuitataan lyhyesti.
  - Vaihtotarjous, tavallinen tuote oletuksena, järjestelmän sanojen kielto ja add_itemsin vaihtoehdot ennallaan.
- **Arviointiin uusi skenaario** `M1-meksikolainen-ilta` (`eval/agent-v2-scenarios.mjs`).
- **Tarkistukset:**
  - `npm test` 683/683 lopullisella versiolla.
  - Oikea malli (Opus 5.5 high, paikallinen agent-v2-eval, eristetyt kannat, hintavälimuistin kopio, ei tilauksia, 1,13 $): M1 ja E1 menivät koodin tarkistuksista läpi, ja molemmat päätyivät korilinkkiin. M1:n puuttuvat tuotteet tulivat yhdessä lauseessa, ja churroista botti sanoi "jutellaan sitten, kun nämä on koossa". E1 kysyi yhden asian kerrallaan. Tervehdyksissä ei ollut kysymyslistaa (G1:n "greeting_low_variation" johtuu avausten samankaltaisuudesta). Ajo tehtiin ennen viivalistan sovitusta.
  - Ensimmäinen ehdotusviesti 60 hengen menuun oli yhä noin 9 riviä, koska asiakas kysyi, mitä pitäisi tilata. Vastausajat paikallisesti 12–49 s.
- **Kesken:** sama tilaus tuotannossa. Korisivun ja demomaksun läpivienti WhatsAppista testaamatta tänä iltana.
- **Julkaistu (sessio E, 19.11. klo 23.51):**
  - main da561df (koodimuutos 7997143): aimo-whatsapp-nxlkst6y4 (dpl_DoSJSb5XQN3FGpwMu3UEUpDVacsm). Asetukset ennallaan (Opus 5.5 high, v2, nopea tila, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 683/683, Worker 58/58, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.

## 19.11.2026 — nopea tila tarkistettu tuotannossa: monen tuotteen viesti 13–14 s entisen 27–36 s:n sijaan (koordinaattori)

- **Eeliksen päätös:** "Ota käyttöön" kysymykseen "Otetaanko nopea tila käyttöön demossa?". E julkaisi 5c7ac8f:n ja asetti WHATSAPP_AGENT_SPEED=fast (aimo-whatsapp-40gssc7hr, klo 22.18). Samalla Eelis nosti koordinaattorin testibudjetin 50 $:iin ("nosta budjetti vaiks 50 usd krediittejä"). Raja koskee testiajoja. API-tilin saldoa ja kulurajaa koordinaattori ei näe, joten Eeliksen pitää tarkistaa ne Anthropic Consolesta ennen demoa.
- **Tarkistus:** sama kolmen viestin keskustelu kahdesti tuotannon selainchatissa. Ajat viesteittäin (tervehdys | tilaus | allergiat ja voi) verrattuna samaan keskusteluun aiemmin illalla:

  | | Tervehdys | Tilausviesti | Viimeinen |
  |---|---|---|---|
  | Nopea tila | 7,2–7,5 s | 13,3–14,1 s | 5,8–6,8 s |
  | Tavallinen nopeus | 8,6–10,1 s | 26,8–36,4 s | 7,9–12,4 s |

  - Vastauksissa ei ollut järjestelmän sanoja. Tuotteeksi valittiin tavallinen kevytmaito.
  - Molemmissa oli vaihtotarjous, allergiakysymys, kysymys voimäärästä ja korilinkki.
  - WhatsAppissa jokaiseen vastaukseen tulee lisäksi noin 6 s niputusta.
- **Kulut:** noin 1,2 $ tilauskeskustelua kohden. Illan testiajot ovat yhteensä noin 8–10 $ (arvio, ei mitattu).
- **Demon jälkeen:** nopea tila pois (WHATSAPP_AGENT_SPEED tyhjäksi), jos kulut halutaan takaisin tavalliselle tasolle.

## 19.11.2026 — vastausaika: mihin aika kuluu, vaihtoehdot jo lisäyksestä ja nopea tila (oletuksena pois) (koordinaattori)

- **Eeliksen palaute (klo 19.36, kuvakaappaus WhatsAppista):** "toi vastaus kestää kyl liian kauan... mite sitä vois siis nopeuttaa? tä voi kans lähettää monta viestiä sillee kerralla". Kun selvitys oli valmis, Eelis vastasi "Tee se" kierrosten vähentämiseen.
- **Mittaus** (paikallinen eval, Eeliksen aamun 9 viestiä R1-eelis-aamu, eristetyt kannat, hintavälimuistin kopio, ei tilauksia):
  - Aika kuluu tokenien tuottoon. Opus 5.5 tuottaa tavallisella nopeudella noin 70–100 tokenia sekunnissa (ajattelu, työkalukutsut ja teksti), ja jokainen kutsu maksaa lisäksi noin 1–1,5 s.
  - Monen tuotteen viesti on 4–5 kutsua ja noin 2 400–2 600 tokenia eli noin 25 s. Oikoluku lisää noin 1,5–2 s, ja WhatsApp odottaa lisäviestejä 6 s.
  - Opuksen keskitaso ei nopeuttanut uudella ohjeella: mediaani 10,3 s, highilla 8,7 s.
  - Viestin jakaminen osiin ei nopeuta, koska osat valmistuvat yhtä aikaa ja kanava pitää osien välissä kirjoitustauon.
- **Muutos 1, add_items palauttaa vaihtoehdot:** kun toimituspäivä on tiedossa, add_items hakee uusien ja muuttuneiden valitsemattomien rivien vaihtoehdot yhdellä suggest-kutsulla.
  - Muoto on sama kuin search_productsissa (yhteinen optionsFor/searchView), ja näytetyt merkitään nähdyiksi more-hakua varten.
  - Hakuvirhe ei kaada lisäystä. Ohje ja add_itemsin kuvaus kertovat, että erillinen haku tehdään vain, kun tarvitaan muita vaihtoehtoja tai toinen hakusana.
  - Mitattu vaikutus on pieni: pääviestin kutsuja oli 4 tai 5 viiden sijaan, mutta aika pysyi noin 25 sekunnissa, koska kutsut pitenivät.
- **Muutos 2, nopea tila asetuksena:** `WHATSAPP_AGENT_SPEED=fast` lisää jokaiseen kutsuun `speed: "fast"`. Opus 5.5:llä se tuottaa samalla mallilla enintään 2,5 x nopeammin, ja hinta on 8 $ / 40 $ miljoonalta tokenilta eli kaksinkertainen.
  - Kun nopean tilan kapasiteetti loppuu (429/529), sama kutsu tehdään heti tavallisella nopeudella, ja nopea tila on minuutin tauolla. 400 ottaa sen pois prosessilta.
  - Lokin agent_turn kertoo fastCalls-määrän (usage.speed). **Oletus on pois päältä, eikä tuotantoon ole vielä asetettu mitään.**
- **Tarkistukset:**
  - npm test 682/682, ja uusia testejä on add_itemsin vaihtoehdoille, hakuvirheelle, nopean tilan pyynnölle, 429-varalle ja 400-poistolle.
  - Yksi oikea betakutsu botin asetuksilla (fallbacks default, adaptive + block_binding): usage.speed "fast", 336 tokenia 2,4 s:ssa, kun tavallisella nopeudella 340 tokenia kesti 4,9 s.
  - R1 Opus high nopealla tilalla: mediaani 5,8 s (tavallisella 9,9 s), p90 13,0 s (26,8 s), pääviesti noin 11 s (noin 25 s), noin 182 tokenia sekunnissa. Koodin tarkistukset menivät läpi, ja vastaukset olivat samantasoisia.
  - Hinta ajoa kohden noin 1,2 $ nopealla tilalla, kun tavallisella noin 0,55 $.
- **Seuraava askel:** Eelis päättää, otetaanko nopea tila käyttöön demossa. Silloin E asettaa Verceliin WHATSAPP_AGENT_SPEED=fast ja julkaisee tämän commitin.
- **Julkaistu (sessio E, 19.11. klo 22.18):** Eelis vahvisti session E:ssä "Kyllä, nopea tila".
  - Verceliin (production) ja `deploy/vercel/.env.cloud`-tiedostoon lisätty `WHATSAPP_AGENT_SPEED=fast`. Muut ennallaan (Opus 5.5 high, v2, rinnakkaisuus 8).
  - main 5c7ac8f: aimo-whatsapp-40gssc7hr (dpl_YbgboC68N6KXKLS82yyMTxdQxVsS). Worker ennallaan.
  - Ennen julkaisua `npm test` 682/682, Worker 58/58, eval 26/26, spoken 58/58, tuoteajo 611/0.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200. Nopea tila (`fastCalls` > 0) näkyy vasta ensimmäisestä oikeasta vuorosta.
  - Paluu tavalliseen nopeuteen: poista `WHATSAPP_AGENT_SPEED` ja julkaise uudelleen.

## 19.11.2026 — 01b16b4 tarkistettu tuotannossa: ei järjestelmän sanoja, ja vaihtotarjous ja tavallinen tuote pysyvät (koordinaattori)

- **Tarkistus julkaisun 6wdqujc39 (klo 19.31) jälkeen:** sama kolmen viestin keskustelu kahdesti tuotannon selainchatissa.
  - Vastauksissa ei ollut rajaus- tai rivi-sanoja eikä "kirjasin"-sanaa ("merkitsin, ettei allergioita ole"), eikä väitettä asiakkaan omista tilauksista. Laktoositonta UHT-maitoa ei valittu.
  - Toinen ajo valitsi tavallisen kevytmaidon (20,00 €), toinen täysmaidon 10 l:n novoboxeina (23,52 €) keiton täyteläisyyden vuoksi. Novoboxin aikaisempi tilausaika (su 22.11. klo 15.00) kerrottiin kahdesti.
  - Molemmissa oli vaihtotarjous, allergiakysymys ennen linkkiä ja valmis kori linkin kanssa.
  - Pääviesti kesti 27–36 s, muut 8–11 s.
- **Illan testikulut Eeliksen lisäbudjetista (arvio, ei mitattu):** koordinaattorin WhatsApp-testi ja selainchat-ajot, yhteensä noin 31 viestiä, noin 1,5–2 $. Demon valmistelusession arvio oli 1,5–3 $.
- **Jäljellä:** monen tuotteen viestin vastausaika noin 30 s Opus highilla. Asiakaskohtainen muisti tulee demon jälkeen (haara claude/agent-v2-memory-3fd408).

## 19.11.2026 — vaihtaminen ja tavallinen tuote toimivat tuotannossa, ja "rajaus" poistettiin ohjeen omista teksteistä (koordinaattori)

- **89e3caa tarkistettu julkaisun jälkeen (gjvktfqlf, klo 19.26):** tuotannon selainchatissa kahdesti viestit "moooi", tilaus, "pidetää 5 kg, osa menee leivontaa. ei oo allergioita", "voiks näyttää muita maitoja?" ja "otetaan se halvin".
  - Kumpikin ajo valitsi tavallisen kevytmaidon (1 l ESL, 20,00 €) eikä laktoositonta UHT-maitoa ("Valitsin tavallisen kevytmaidon").
  - Tuotteita valitessaan botti kertoi kerran, että minkä tahansa voi vaihtaa ja että se voi näyttää muita vaihtoehtoja.
  - Pyynnöstä se näytti 5–7 maitoa hintoineen 20 litralle ja kertoi myös eri tilausajat. "Otetaan se halvin" vaihtoi rasvattomaan, ja päivitetty kori tuli linkin kanssa.
  - Pääviesti kesti 29–33 s, muut 8–16 s.
- **Jäljellä:** toinen ajo kirjoitti silti "mennäänkö ilman rajauksia?" ja "ilman allergiarajauksia". Syy oli se, että ohje ja set_dietin kuvaukset itse puhuivat koko tilauksen rajaamisesta.
- **Muutos:** ohjeen set_diet-kohdasta, Tehtävä-osiosta, set_dietin kuvauksista, virheilmoituksista ja search_productsin ref-kentästä poistettiin rajata-sanat merkitystä muuttamatta ("koskee koko tilausta", "ei tule allergioita eikä ruokavalioita"). Testi valvoo, ettei ohjeessa ole sanaa muualla kuin järjestelmän sanojen luettelossa.
- **Tarkistukset:** npm test 678/678. Julkaisun jälkeen sama kolmen viestin keskustelu kahdesti tuotannon selainchatissa.
- **Julkaistu (sessio E, 19.11. klo 19.31):**
  - main 01b16b4: aimo-whatsapp-6wdqujc39 (dpl_Hp3GZ82NtQ7FwMcww638APhdFELm). Asetukset ennallaan (Opus 5.5 high, v2, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 678/678, Worker 58/58, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.

## 19.11.2026 — botti tarjoaa tuotteen vaihtoa ja valitsee tavallisen tuotteen, ellei erityisruokavaliota tarvita (koordinaattori)

- **Eeliksen pyyntö:** "eka ehottaa sopivinta tuotetta, mut sitte niit voi kans vaihtaa et tää antaa mahollisuudeks kans vaihtaa näit tai kattoo muit vaihtoehtoi … ja muistaa tietty varmistaa ettei tuote oo laktoositon tai gluteeniton tai jotain vastaavaa".
- **Havainto:** WhatsApp-testissä ja yhdessä selainchatin ajossa allergiattomalle valittiin laktoositon UHT-kevytmaito (31,20 € / 20 l). Perusteluna oli "laktoositon käy kaikille". Tavallinen ESL-kevytmaito olisi maksanut 20,00 €. Laktoositon on haun suosituin tuote, koska demotilauksissa on tilattu paljon laktoositonta maitoa. Lisäksi valmiissa korissa ei kerrottu, että tuotteita voi vaihtaa.
- **0c0eb18 tarkistettu julkaisun jälkeen (4uhx7fwqd):** sama kolmen viestin keskustelu kahdesti selainchatissa. Kummassakaan ei ollut "rajaus"-sanoja eikä väitettä asiakkaan omista tilauksista, ja kori ja linkki tulivat oikein. Pääviesti kesti 29–31 s.
- **Muutos ohjeeseen (Ole aktiivinen asiantuntija):**
  - Botti valitsee sopivimman tuotteen ja kertoo samalla, että minkä tahansa voi vaihtaa ja että se voi näyttää muita vaihtoehtoja. Tästä mainitaan, kun tuotteet valitaan, ei joka viestissä. Pyydettäessä se näyttää muutaman vaihtoehdon hintoineen ja pakkauskokoineen.
  - Laktoositon, gluteeniton tai muu erityistuote valitaan vain, kun asiakas on kertonut tarpeen. Botti tarkistaa tämän tuotteen nimestä ja merkinnöistä, koska haun ensimmäinen tai suosituin tuote voi olla erityistuote.
- **Tarkistukset:** npm test 678/678. Julkaisun jälkeen tuotannon selainchatissa sama tilaus sekä pyyntö näyttää muita maitoja ja vaihtaa.
- **Julkaistu (sessio E, 19.11. klo 19.26):**
  - main 89e3caa: aimo-whatsapp-gjvktfqlf (dpl_8MY4e2rxrhLBmZSFG5shQGwNCzMx). Asetukset ennallaan (Opus 5.5 high, v2, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 678/678, Worker 58/58, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.

## 19.11.2026 — WhatsApp-testi uudella botilla maksulinkkiin asti, ja kaksi sanamuotokorjausta (koordinaattori)

- **Eeliksen pyyntö:** "tää haluu ne tietyt tiedot ja sitku tää on saanu ne ni sitte tää lähettää maksulinkin", ja lupa käyttää hänen konettaan WhatsAppiin.
- **WhatsApp-testi Eeliksen koneella klo 19.05–19.15**, tuotanto mttgqnmgo (Opus 5.5 high, uusi ohje, ei muistia), nollattu numero, ei tilausta:
  - "moooi": neuvova avaus nimellä, ohje viivalistana.
  - "tarviin torstaiks 20 litraa maitoo, 5 kg voita ja 50 sipulii keittoon 50 hengelle": toimitus to 26.11. ja tilausaika ke 25.11. klo 17.00, tuotteet perusteluineen ja sipuli 6 × 1 kg ("pusseilla ei jää ylimääräistä"). Lisäksi kysymys, onko 5 kg voita tarkoituksellinen 50 hengen keittoon, ja allergiakysymys.
  - "pidetää 5 kg, osa menee leivontaa. ei oo allergioita": valmis kori viivalistana, 69,36 € (alv 0 %) ja Avaa ostoskori -painike.
- **Löydökset:**
  - "Tätä teillä on tilattu eniten": search_productsin popular ja orderedCount lasketaan kaikkien asiakkaiden vahvistetuista tilauksista, mutta kuvauksessa luki vain "suosituin". Malli esitti luvut asiakkaan omana historiana, vaikka numero oli juuri nollattu.
  - "allergiat jätin rajaamatta" toisti set_dietin sanaa. Sama keskustelu kahdesti tuotannon selainchatissa ennen korjausta: toisessa "mennäänkö ilman rajauksia?" ja "ilman allergiarajauksia". Molemmissa kori ja linkki tulivat oikein, ja pääviestin vastaus kesti 32–35 s.
- **Korjaukset:**
  - search_productsin kuvaus kertoo, että luvut tulevat kaikkien asiakkaiden tilauksista eivätkä ole asiakkaan omia. Asiakkaan omat tilaukset näkyvät previous_orders-työkalulla.
  - Ohjeen asiakkaan sanoin -periaatteeseen lisättiin allergiat ja virke: työkalujen kuvauksissa ja tuloksissa on järjestelmän sanoja, kuten rivi, kirjata ja rajata, joita asiakas ei käytä.
- **Tarkistukset:** npm test 678/678, uudet testit ohjeelle ja työkalun kuvaukselle. Julkaisun jälkeen sama selainchat-vertailu uudelleen.
- **Huomio:** WhatsAppin taustakirjoitus ei aina rekisteröidy lähetettäväksi (lähetysnappi jää mikrofoniksi). Enter lähetti viestin.
- **Julkaistu (sessio E, 19.11. klo 19.20):**
  - main 0c0eb18: aimo-whatsapp-4uhx7fwqd (dpl_EfGWh6r4DLfyJs7AkHZdC1fBm7Bd). Asetukset ennallaan (Opus 5.5 high, v2, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 678/678, Worker 58/58, eval 26/26, spoken 58/58.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.

## 19.11.2026 — myös storefront-cutoff-testille oma kanta: yksikään testi ei enää tarvitse data/-hakemistoa (Claude Code)

- **Pyyntö:** muisti-sessio pyysi korjaamaan mainin punaiset GitHub-testit (`test/expiry.test.mjs`, "unable to open database file"). Koordinaattori ehti korjata sen ensin (4033157). Tässä tarkistettiin korjaus ja haettiin muita samanlaisia testejä.
- **Löydös:** jokainen testitiedosto ajettiin erikseen puhtaassa kopiossa ilman `data/`-hakemistoa.
  - Myös `test/storefront-cutoff.test.mjs` (9f772d8) kaatui samaan virheeseen. Se lataa `server/storefront.mjs`:n, joka lataa `valioApi.mjs`:n, ja `db.mjs` avaa `data/aimo.db`:n jo ladattaessa.
  - Koko ajossa testi meni läpi vain, koska rinnakkain ajettu `test/images.test.mjs` ehti luoda `data/img`-hakemiston ensin. GitHubin testit olisivat siis voineet kaatua satunnaisesti.
- **Korjaus:** testi asettaa `AIMO_DB`:n väliaikaiseen kantaan ennen kuin lataa storefront.mjs:n, kuten expiry-testi. Tuotantokoodiin ei koskettu.
- **Tarkistukset:**
  - expiry-testi erikseen ilman `data/`-hakemistoa kaatui 3c790a2:lla ja meni läpi 4/4 4033157:llä. storefront-cutoff kaatui ennen korjausta ja menee nyt läpi 2/2.
  - Kaikki 99 testitiedostoa erikseen ilman `data/`-hakemistoa: 584 läpi, 93 ohitettu, 0 virhettä.
  - CI:n kaltainen kopio ilman `data/`-hakemistoa ja fontteja: `npm test` 677 testiä, 584 läpi, 93 ohitettu, 0 virhettä. Worker 58/58.
  - GitHub Actions on ollut vihreä 4033157:stä alkaen.
  - Muistihaaran (26201ed) uudet ja muuttuneet testit menevät myös erikseen läpi ilman `data/`-hakemistoa.

## 19.11.2026 — demon esimerkkitilaukset tuotannossa: reseptikysymys katkesi 60 s:n rajaan, raja nostettu (Claude Code, WhatsApp-demon valmistelu)

- **Eeliksen pyyntö:** varmista, että WhatsApp toimii huomisessa demossa, jossa Valion väki saa kokeilla bottia omasta WhatsAppistaan. Testaa esimerkkitilauksilla ja lisää pitch-puheen loppuun, mitä kannattaa kokeilla.
- **Livetesti klo 18.50–19.05:** tuotannon v2-botti (Opus 5.5 high) Keskustele-chatin `POST /api/chat`:n kautta. Sama agentti, kannat ja hinnat kuin WhatsAppissa. 11 keskustelua omilla evästeillä, 20 viestiä, ei tilausvahvistuksia.
  - Korilinkkiin asti: sipulit 10 kg, maito ja voi, perunat ja porkkanat puhekielellä ("huomiseks" → tilausaika mennyt, ehdotti lauantaita), reseptilinkki (valio.fi lohikeitto 30 annokselle), makaronilaatikko 50 hengelle, keliaakikot ja maitoallerginen, englanniksi (munat ja kaurajuoma).
  - Rehellisesti ilman tuotetta: edam ja jogurtti (ei hintatietoa, tunnettu rajaus). Aiheen ohi kysytty viini: vastasi ja palasi tilaukseen.
  - **Vika 1:** "teen lohikeittoa 40 hengelle ensi keskiviikkona, mitä kaikkea tarvitsen?" uudessa keskustelussa → "Pahoittelut, vastaukseni jäi kesken" 2/2 kertaa (61,2 s ja 63,8 s). Saman viestin uusinta samassa keskustelussa antoi 8 rivin listan 14,7 s:ssa. Allergiatilauksen toinen vuoro vei 58,5 s. Syy: `createAgent`in vuoron raja 60 s ja työkalujen sulku 45 s. Opus high hakee tuotteet ja kirjoittaa pitkän listan hitaammin kuin Sonnet medium, jolla rajat mitoitettiin.
  - **Vika 2:** botti kertoi korilinkin toimivan "noin klo 19.12 asti" tai "until about 19.15 tonight". Se luki `send_cart_link`in `expiresAt`in, joka on tarjouksen noin 15 minuutin voimassaolo. Korilinkki on voimassa 24 h, ja korisivu hakee vahvistuksessa tuoreen tarjouksen.
- **Muutokset:**
  - `server/agent/index.mjs`: tuotannon agentti (`createConfiguredAgent`) saa `TURN_LIMITS`: vuoro 85 s, työkalut suljetaan 60 s:n kohdalla. Kova raja pysyy alle Workerin 90 s:n selainkeskustelun aikakatkaisun. WhatsAppin Vercel-funktion raja on 300 s. `createAgent`in oletukset (60/45 s) ja niiden testit ovat ennallaan.
  - `server/agent/tools.mjs`: `send_cart_link` ei enää palauta mallille tarjouksen `expiresAt`ia. Tieto säilyy luonnoksen `quote`-kentässä.
- **Tarkistukset:** uusi testi `test/agent-loop.test.mjs`: viisi 10 s:n työkalukierrosta ja 15 s:n loppuvastaus katkeavat vanhoilla rajoilla ja menevät läpi uusilla. `agent-tools`-testi tarkistaa, ettei linkin tulos sisällä `expiresAt`ia. `npm test` 678/678 (katalogi ja fontit mukana).
- **Kesken:** julkaisu (sessio E) ja sen jälkeen sama reseptikysymys uudelleen tuotannossa. Ääniviestiä ja kuvaa ei voi testata selainkeskustelun kautta.
- **Julkaistu (sessio E, 19.11. klo 19.06):**
  - main 51e391c: aimo-whatsapp-m04r0vuwp (dpl_DVLhLXfNw5VMZP3bRQvTHk3vzYXn). Asetukset ennallaan (Opus 5.5 high, v2, rinnakkaisuus 8). Worker ennallaan.
  - Ennen julkaisua `npm test` 678/678, Worker 58/58, eval 26/26, spoken 58/58, tuoteajo 611/0.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.
- **Uusinta julkaisun jälkeen (klo 19.08):**
  - "teen lohikeittoa 40 hengelle ensi keskiviikkona, mitä kaikkea tarvitsen?" uudessa keskustelussa → aineslista 40 hengelle 24,0 s:ssa, ei katkeamista.
  - "kanakeittoa 60 hengelle perjantaiksi 27.11, mitä tarvitsen?" → kuusi valittua tuotetta hintoineen ja tilausaika 59,7 s:ssa. Vanhoilla rajoilla tämä olisi katkennut.
  - Lisäksi ennen julkaisua: "moi" sai ohjeen tilaamisesta (6,5 s), ja "vaihda sipulit 20 kiloon ja lisää 5 kg porkkanaa" päivitti korin ja linkin (13,9 s). Korisivun API (`/whatsapp/cart/api`) palautti makaronilaatikon korin kuudella rivillä.
  - Yhteensä 24 viestiä ja 14 keskustelua, ei tilausvahvistuksia eikä Meta-viestejä. Mallikulu arviolta 1,5–3 $ Eeliksen testibudjetista (noin 0,05 $ viestiltä, resepti- ja linkkivuorot enemmän). Tarkkaa summaa ei mitattu.
- **Pitch deck:** viimeisen dian ("Haluatteko kokeilla?") puhujamuistiin lisättiin numeroitu lista siitä, mitä Valion väki voi kokeilla WhatsAppissa: sipulit, maito ja voi, puhekieli, ruokalaji ja henkilömäärä, reseptilinkki, ääniviesti tai kuva, allergiat ja englanti. Lisäksi muistutus, ettei juustoilla, jogurteilla, jäätelöillä, banaaneilla ja omenoilla ole hintaa ja että iso tilaus voi viedä 30–60 s. Selainkeskustelun maininta poistettiin, koska Eelis ei näytä selainta.
- **Ennen demoa (Eelis):**
  - Valion kokeilijoiden numerot Metan vastaanottajalistalle (enintään viisi, Eelis mukaan lukien) ja `npm run whatsapp:member:cloud -- link` (ohje [docs/demo-onboarding.md](docs/demo-onboarding.md)). Nyt yhdistettyjä numeroita on 7, joten osa pitää poistaa Metan listalta.
  - Yksi ääniviesti ja yksi kuva ostoslistasta omalla puhelimella aamulla. Niitä ei voi testata selainkeskustelun kautta, ja ne kulkevat samaan v2-agenttiin tekstinä.

## 19.11.2026 — asiakaskohtainen muisti siirretään demon jälkeen: yhdistäminen peruttu mainista (koordinaattori)

- **Eeliksen päätös muisti-sessiossa:** "viel ei tarttee tehä tätä? tä tehää sit ton demon jälkee jooko? sit vaiks pari päivä pääst".
  - Koordinaattori oli ehtinyt yhdistää muistin mainiin (4956d3f) ja pyytää julkaisun. Julkaisupyyntö peruttiin sessio E:lle, eikä muistia julkaistu.
- **Revert 9ca127c** peruu yhdistämisen. Main on sisällöltään sama kuin 4033157, ja GitHub-testien korjaus säilyy. `npm test` 677/677.
- **Muisti odottaa** haarassa `claude/agent-v2-memory-3fd408` (26201ed, testattu 690/690), raportti `docs/agent-v2/muisti.md` haarassa.
  - **Demon jälkeen:** peru ensin tämä revert (`git revert 9ca127c`) tai yhdistä haara uudelleen niin, että muutokset palaavat, ja julkaise sen jälkeen.
  - Pitch deckiin muistin voi mainita tulevana ominaisuutena.
- **Sessio E: muisti oli tuotannossa noin puolitoista minuuttia.** Julkaisupyyntö 4956d3f:stä tuli ennen peruutusta, eikä peruutusviesti ehtinyt sessio E:lle.
  - 4956d3f julkaistiin klo 18.51.06 (aimo-whatsapp-g82oz2qro). Revert 9ca127c tuli mainiin 18.51.25.
  - Tuotanto palautettiin heti mainiin 9ca127c klo 18.52.35: aimo-whatsapp-mttgqnmgo (dpl_Ah967XFXevw5AJXocMJwsScoZMoV). Sen palvelinkoodi on sama kuin 8848923:ssa, ja asetukset ovat ennallaan (Opus 5.5 high, v2, rinnakkaisuus 8).
  - Muistin aikana ei käsitelty yhtään vuoroa: `agent_memory`-taulua ei syntynyt Turso-kantaan aimo-drafts. Healthz `host: cloud`, verify ja tick 200.
  - **Havainto:** tick julkaisee nyt 7 tilausta (aiemmin 15). Ostajalla, jolla on 8 vahvistettua tilausta, ei ole enää WhatsApp-jäsenyyttä, koska numero on luultavasti liitetty uudelleen (`whatsapp:member:cloud link` tekee uuden sidoksen). Tilaukset ovat tallessa gateway-kannassa, mutta tilausnäkymän julkaisu ottaa vain nykyisten jäsenten tilaukset.

## 19.11.2026 — GitHubin testit taas läpi: expiry-testille oma kanta (koordinaattori)

- **Syy:** 9171b67:n `test/expiry.test.mjs` latasi `server/valioApi.mjs`:n suoraan. Se avaa ladattaessa hintavälimuistin kannan `data/aimo.db`, jota GitHubin testiajossa ei ole. Siksi mainin testit olivat punaisella e4fb35e:stä lähtien ("unable to open database file").
- **Korjaus:** testi asettaa `AIMO_DB`:n väliaikaiseen kantaan ennen kuin lataa valioApi.mjs:n, kuten muut testit tekevät.
- **Tarkistukset:** GitHubin kaltainen ajo ilman `data/`-hakemistoa ja fontteja: 584 läpi, 93 ohitettu, 0 virhettä. Testi erikseen 4/4.

## 19.11.2026 — päätökset: ei ihmiselle siirtoa, botti ei saa jäädä jumiin, epäonnistuneet keskustelut testeiksi demon jälkeen (Claude Code)

- **Taustalla** Eeliksen kysymys, saisiko chatboxin, assistant-ui:n, deep-chatin, GirlfriendGPT:n tai LiveHelperChatin avulla botista fiksumman. Arvio: ei suoraan. Ne ovat käyttöliittymiä, chat-sovellus tai asiakaspalvelujärjestelmä, eikä niissä ole parempaa keskustelulogiikkaa kuin v2-agentissa. LiveHelperChatista ehdotettiin kahta ideaa.
- **Eeliksen päätökset:** "joo tukinumero riittää. ja botti ei sais joo jäädä jumiin. ja tehää tää demon jälkeen. ja joo save feedback ois tosi hyvä eli 2 ois varmaa hyvä".
  - **Ei ihmiselle siirtoa.** Tukinumero (`WHATSAPP_SUPPORT_CONTACT`) riittää. Keskustelua ei siirretä ihmiselle eikä botti hiljene.
  - **Botti ei saa jäädä jumiin.** Kun asiakkaan tarve ei toteudu, botti kertoo suoraan, mitä voi tehdä, eikä arvaa. Esimerkki tuotannosta klo 18.30: perjantaille ei löytynyt maitoa, ja botti arvasi "lauantaita tai maanantaita" eikä kertonut aikaisinta mahdollista päivää. Koordinaattori selvittää tätä.
  - **Demon jälkeen:** oikeista epäonnistuneista keskusteluista ja `save_feedback`-palautteista (taulu `agent_feedback`) tehdään pysyviä testitapauksia, jotta sama virhe ei palaa. Ei aloiteta ennen demoa.
- Ei koodimuutoksia, ei testejä.

## 19.11.2026 — uusi ohje mainiin, ja demoon Opus 5.5 high (koordinaattori)

- **Eeliksen päätös:** "opus on hyvä" huomiseen demoon. Hän epäröi ensin hinnan vuoksi, ja hänelle kerrottiin luvut:
  - demossa 5 käyttäjää: Opus noin 1,5–2,5 $, Sonnet noin 0,5–0,8 $
  - 1 000 tilausta kuussa: Opus noin 450 $, Sonnet 80–160 $
  - Suositus oli Opus demoon ja Sonnet sen jälkeen.
- **Toteutus:** koodin oletus pysyy Sonnet 5.5 medium (`agentSettings`). Demoa varten Verceliin asetetaan `WHATSAPP_AGENT_MODEL=claude-opus-5-5` ja `WHATSAPP_AGENT_EFFORT=high` (sessio E). Palautus Sonnetiin onnistuu poistamalla asetukset ja julkaisemalla uudelleen. Oikoluku pysyy Sonnetilla.
- **Yhdistetty mainiin:** haara `claude/agent-v2-claude-prompt`, sisältää uudelleenkirjoitetun ohjeen, tilausaikakorjauksen 3c39a99 ja asiakkaan kielen säännön.
  - Mainin 4a947a8:n sääntö on mukana: WhatsAppissa ääniviestit, linkit ja kuvat voi mainita, selainkeskustelussa ei.
  - `npm test` 677/677.
- **Kesken:** asiakaskohtainen muisti (sessio "Botti v2: asiakaskohtainen muisti") ja oikean mallin tarkistus WhatsAppissa julkaisun jälkeen.
- **Julkaistu (sessio E, 19.11. klo 18.37):** Eelis vahvisti session E:ssä "Kyllä, Opus ja uusi ohje".
  - Verceliin (production) ja `deploy/vercel/.env.cloud`-tiedostoon lisätty `WHATSAPP_AGENT_MODEL=claude-opus-5-5` ja `WHATSAPP_AGENT_EFFORT=high`. Oikoluku pysyy Sonnetilla.
  - Julkaistu main 8848923 (8d6faee ja työlokin rivit): aimo-whatsapp-m4ocuklb5 (dpl_51kBFWcDJihY5ZwyzdYYoE9nXqKc).
  - Ennen julkaisua `npm test` 677/677, Worker 58/58, eval 26/26, spoken 58/58, tuoteajo 611/0.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.
  - Testiviestejä ei lähetetty, koska mallibudjetti on lähes käytetty. Mallin vaihtumista ei siis ole vielä nähty vuoron tuloksessa.
  - Paluu Sonnetiin: poista molemmat asetukset ja julkaise uudelleen.

## 19.11.2026 — vanhenevat avaimet ja päivämäärät kuntoon, uusi `npm run expiry:check` (Claude Code)

- **Eeliksen pyyntö:** "et tää api ei vanhenis … kaikki tämmöset kuntoo nyt et päivämäärät on kondikses ja apit eivät vanhene".
- **Tilanne 19.11. (tarkistettu, ei muutettu mitään tuotannossa):**
  - WhatsAppin käyttöoikeustoken (system user, `whatsapp_business_messaging`) on voimassa **13.1.2027 klo 22.25** asti. Ei vanhene parissa päivässä, mutta vanhenee 55 päivässä.
  - Turson avaimessa ei ole vanhenemisaikaa. Vercelissä ei ole `DEMO_NOW`-asetusta, joten tuotanto käyttää oikeaa kelloa.
  - Tuotannon hintavälimuistin 1 119 tuotteen hinnat on haettu 14.–15.11. Raja `FALLBACK_PRICE_MAX_AGE_HOURS=720` olisi hylännyt ne (`PRICE_TOO_OLD`) 14.12. klo 9.11 alkaen ja viimeisenkin 15.12. Sen jälkeen botti ei olisi löytänyt yhtään tilattavaa tuotetta.
  - Mitään kahden päivän sisällä vanhenevaa ei löytynyt. Metan API Setup -sivun "tilapäinen token" vanhenee 24 tunnissa, mutta botti ei käytä sitä.
- **Muutokset:**
  - `FALLBACK_PRICE_MAX_AGE_HOURS=none` poistaa viimeisimmän tunnetun hinnan ikärajan (`server/valioApi.mjs`). Hinnat näkyvät yhä merkittyinä viimeisimpinä tunnettuina. Paikallinen `.env.whatsapp` (push-env.mjs:n lähde) on nyt `none`.
  - Uusi `npm run expiry:check` (`scripts/expiry-check.mjs`, `server/expiry.mjs`): WhatsApp-token Metan debug_tokenilla, Turson avaimen exp, demon hintojen ikäraja tuotannon kannasta ja `DEMO_NOW`. Varoittaa 21 päivää ennen ja palauttaa koodin 1. Ei kirjoita mitään eikä tulosta salaisuuksia.
  - `docs/whatsapp.md`: system user -tokenille Token expiration: Never.
- **Tarkistukset:** uusi `test/expiry.test.mjs` 4/4 ja `audit-fixes-b`:hen "none"-tapaus. `npm test` 672/672, myös `DEMO_NOW` 20.12.2026 ja 20.1.2027. Koko kello siirrettynä +30 ja +60 päivää: 671/672. Ainoa kaatuva, `cloud-handler`, johtui testitavasta (lapsiprosessi ei saanut siirrettyä kelloa), ei koodista. Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58.
- **Kesken:**
  - Tuotantoon tarvitaan sessio E (Eeliksen luvalla): `node deploy/vercel/push-env.mjs --only=FALLBACK_PRICE_MAX_AGE_HOURS` ja botin julkaisu tästä commitista. Vanha koodi ei tunne arvoa `none`, joten asetus ja koodi menevät tuotantoon yhdessä.
  - Eelis: uusi WhatsApp-token Meta Business Settingsissä (System users → Generate new token → Token expiration: Never, oikeus `whatsapp_business_messaging`) ennen 13.1.2027. Sen jälkeen `.env`:iin ja `push-env.mjs --only=WHATSAPP_ACCESS_TOKEN` sekä uudelleenjulkaisu.
  - 100 tuotteen hinnan `validTo` on 31.12.2026. Koodi ei käytä kenttää, joten se ei estä mitään.
- **Julkaistu (sessio E, 19.11. klo 18.33):**
  - Tilannevedos commitista e4fb35e: 4a947a8 ja hintojen vanhenemisen esto. Mainin uudelleenkirjoitettu ohje (9408bb8 … ed051d7) ja Opus-asetukset eivät ole tässä julkaisussa.
  - Ensin `push-env.mjs --only=FALLBACK_PRICE_MAX_AGE_HOURS` (none), heti perään `vercel deploy --prod`: aimo-whatsapp-edgl4l5fa (dpl_2ucAffdQZfe5jchTToTXrZGwe7qM).
  - Ennen julkaisua `npm test` 672/672, Worker 58/58, eval 26/26, spoken 58/58, tuoteajo 611/0.
  - Julkaisun jälkeen healthz `host: cloud`, verify ja tick 200. `expiry:check` näyttää tokenin (13.1.2027), Turson avaimen ja demon hinnat (1 119 tuotetta) kunnossa.
  - Selainkeskustelu "tarviin 20 litraa maitoa ensi tiistaiks, ei allergioita" toi kaksi maitovaihtoehtoa hintoineen (0,88 €/l ja 1,56 €/l) tiistaille 24.11. Ei tilausta.

## 19.11.2026 — päätös: WhatsApp on pääkanava, selainkeskustelussa vain tekstikeskustelu (Claude Code)

- **Eeliksen päätös:** "nyt keskitytään vain whatsappiin". Ensin hän ehdotti selainkeskustelun piilottamista, mutta tarkensi heti: "voi selainkeskustelu olla tuolla päällä mut sinne ei tarvii mikkii tai noita muitakaa reseptilinkkei, siel selaimes toimii vaa keskustelu".
  - Selainkeskustelu jää päälle sellaisenaan, eikä sitä piiloteta.
  - Selainkeskusteluun ei lisätä mikrofonia, kuvan lähetystä eikä reseptilinkkejä. Uusi työ tehdään WhatsAppiin.
  - Taustalla Eeliksen kysymys, voisiko uudessa botissa käyttää chatboxia, assistant-ui:ta, deep-chatia, GirlfriendGPT:tä tai LiveHelperChatia. Arvio: ei nyt. Ainoa idea WhatsAppiin on myöhemmin ihmiselle siirto (LiveHelperChatin malliin), demon jälkeen.
- **Muutos:** selain ei enää lupaa reseptilinkkiä.
  - `server/agent/prompt.mjs`: "Selainkeskustelussa viestin voi vain kirjoittaa." (ennen "…kirjoittaa tai lähettää reseptilinkin.").
  - `deploy/cloudflare/public/keskustele.js`: aloituskupla ilman "tai lähetä reseptilinkki".
  - Keskustele-sivun oikean reunan lista kertoi jo, että ääniviestit, reseptilinkit ja kuvat toimivat WhatsAppissa, joten sitä ei muutettu.
  - Selaimeen liitetyn linkin lukua ei estetty. Sitä vain ei enää mainosteta.
- **Tarkistukset:** `test/agent-loop.test.mjs`:n ensimmäisen viestin testi päivitetty ja lisätty tarkistus, ettei selainkeskustelun ohjeessa mainita reseptilinkkiä. `npm test` 575 läpi, 93 ohitettu (kopio ilman `data/`-kansiota, kuten CI), 0 virhettä. Worker 58/58. Mallikutsuja ei tehty.
- **Julkaistu:** sessio E julkaisi 75b958b:n klo 18.26: botti aimo-whatsapp-m1zmrjaun ja Worker 120f3ff1. Varmennettu livenä: Keskustele-sivun keskustele.js on sama kuin repossa, ja "moi" uudella evästeellä sai vastauksen, joka ei lupaa reseptilinkkiä. Tilausta ei tehty.
- **Jatkokorjaus (E:n huomio):** ensimmäisen viestin toinen sääntö salli yhä mainita linkit selaimessa, kun ensimmäinen viesti on suoraan tilaus. Nyt: "WhatsAppissa lyhyt maininta ääniviesteistä, linkeistä ja kuvista sopii, jos se tuntuu luontevalta. Selainkeskustelussa niitä ei mainita." Testiin lisätty tarkistus. `npm test` 575 läpi, 93 ohitettu (ilman `data/`), 0 virhettä. Vaatii botin julkaisun (E).

## 19.11.2026 — oikoluku korjaa myös "mä keräin tilauksen" (sessio E)

- **Löydös:** tuotannossa klo 17.11 vastaus "mä keräin tilauksen valmiiksi koriin" lähti ennen oikoluvun julkaisua (17.18). Kun sama vastaus ajettiin oikoluvun läpi, malli ehdotti korjausta "keräin" → "keräisin", mutta koodi hylkäsi sen, koska kirjaimia lisättiin kaksi ja raja oli yksi.
- **Muutos (`server/agent/proofread.mjs`):**
  - Kun kirjaimia vain lisätään tai poistetaan ja sana on vähintään 5 kirjainta, sallitaan 2 muutosta. Kirjainten vaihto toiseen pysyy ennallaan tiukkana ("kerro" → "kerma" hylätään).
  - Lyhyet sanat eivät saa lisäkirjaimia ("on" → "onko" hylätään).
  - Ohjeeseen lisätty esimerkki "mä keräin tilauksen" → "kerään" ja pyyntö valita korjaus, joka sopii lauseen aikamuotoon.
- **Tarkistukset:**
  - `test/agent-proofread.test.mjs` 4/4 uusine tapauksineen.
  - Oikea malli: "keräin" korjautui 3/3 kertaa ("keräisin" 2, "kerään" 1). Kuuden vastauksen ajossa samat korjaukset kuin aiemmin sekä "kokoon" → "kokoan". Hintoihin ja tuotenimiin ei koskettu.
- **Koko sarja:** `npm test` 668/668, Worker 58/58, eval 26/26, spoken 58/58, tuoteajo 611/0.
- **Julkaisu:** mukana myös mainin 45f0dc4 (v2-ohjeen korjaukset: ei taivutettavaa minä-muotoa, ei toistuvaa allergiakysymystä, puhekieliset kysymykset, kappalemäärät).

## 19.11.2026 — botin ohje kirjoitettu uudelleen Clauden tapaan (koordinaattori)

- **Eeliksen pyyntö:** "miten täst sais yht fiksun ku claude? sä ite tiät mite oot rakennettu ni voit tehä täst vähä niiku ittensä kaltasen?"
- **Syy:** `SYSTEM_PROMPT` oli kasvanut jokaisen livetestin löydöksen myötä noin 60 erillisen säännön pinoksi (Anthropicin kehoteohjeessa "patch accretion").
  - Malli seuraa sellaista sääntö kerrallaan ja kopioi esimerkit. Ohjeen esimerkki "ehdota esimerkiksi yhtä 10 kg:n säkkiä" ohjasi valitsemaan juuri hävikkisäkin.
  - Numerorajat ("1–3 lyhyellä virkkeellä", "2–4 lyhyttä virkettä") ja kieltolistat jäykistivät vastauksia.
- **Uusi ohje** (`server/agent/prompt.mjs`, 9 850 merkkiä, ennen 12 562):
  - Rakenne: kuka botti on (kokenut ja lämmin tukkumyyjä, joka lukee viestit kuin ihminen), tehtävä (neljä selvitettävää asiaa ja korilinkki), miten se keskustelee perusteluineen, faktat, työkalujen viitetiedot, rehellisyys, muotoilu ja turvallisuus.
  - Mukana:
    - korin koko sisältö viivalistana, kun kori muuttuu
    - pakkaus, josta jää vähiten hävikkiä
    - huomautus epätavallisen suuresta määrästä (ei estä tilausta)
    - toimituspäivän ehdotus, kun tuotetta ei saa
  - Kovat rajat ovat ennallaan: faktat vain työkaluista, ei omia linkkejä, korilinkki samassa vastauksessa, demo ei tilaa, osittainen ruokavalio set_diet none: true -muodossa ja rehellisyys siitä, ettei botti ole ihminen.
- **Tarkistukset:**
  - `test/agent-loop.test.mjs`:n 49 ohjetekstin tarkistusta päivitetty uuteen tekstiin, ja uusi testi tarkistaa korilistan ja suuret määrät.
  - Testit varmistavat myös, ettei ohjeessa ole virkerajoja eikä 10 kg:n säkin esimerkkiä.
  - `npm test` 669/669.
  - Oikean mallin koe uudella ohjeella on vielä tekemättä, koska testibudjetti (10 $) on lähes käytetty.
- **Mallivertailu samalla Eeliksen aamun keskustelulla, vanha ohje 6e554cb** (arviointisessio, [docs/agent-v2/arviointi.md](docs/agent-v2/arviointi.md)):

  | | Opus 5.5 high | Sonnet 5.5 high | tuotannon Sonnet medium |
  |---|---|---|---|
  | arvio 1–5 | 4 | 3 | 2 |
  | suomen virheet | 0 | 2 | 1 |
  | allergiakysely | 4/9 viestissä | 6/9 | 9/9 |
  | hinta, 9 viestiä | 0,45 $ | 0,16 $ | noin 0,08 $ |
- **Jatko samaan haaraan (Eeliksen lupa jatkaa tauon jälkeen):**
  - main 75b958b yhdistetty: selainkeskustelussa voi vain kirjoittaa.
  - v2-agentin 3c39a99 otettu mukaan cherry-pickillä: mennyt tilausaika kerrotaan (`cutoff_passed`) aikaisimman päivän kanssa. Ennen haku sanoi vain "Ei tilattavaa tuotetta", ja sessio E:n "perjantaiks"-viesti kesti 24 s.
  - Ohjeeseen lisätty, Eeliksen palautteen "miks toi sanoo kirjasin rivit" mukaan: puhu tuotteista ja ostoslistasta asiakkaan sanoin, koska asiakas näkee listan eikä järjestelmän rivejä.
  - Kun syy on päivä, kerrotaan syy ja ehdotetaan aikaisinta päivää eikä haeta muilla sanoilla. Perussanalla haetaan vain silloin, kun tuotetta ei löydy.
  - `npm test` 673/673.

## 19.11.2026 — Eeliksen aamun keskustelu tuotannossa uudelleen ja ohjeen korjaukset (koordinaattori ja v2-agentti)

- **Livetodiste:** Eeliksen 19.11. aamun WhatsApp-keskustelu ajettiin samoilla viesteillä tuotannon 6e554cb:tä vastaan (selainkeskustelu, uusi asiakas).
  - Parantunut:
    - "50 sipulia" ymmärrettiin heti 50 kappaleeksi (noin 6 kg). Vanha botti teki siitä 50 säkkiä.
    - 50 hengelle botti ehdotti määrät itse.
    - Jokaiseen viestiin tuli yksi vastaus, ja palautteeseen vastattiin ilman tyhjiä lupauksia.
  - Vikoja:
    - Taivutusvirhe ensimmäisessä viestissä ("mä keräin", E:n testissä "keräären").
    - Allergioista kysyttiin viidessä viestissä peräkkäin.
    - "paljo menis 50 henkilöl" luettiin "määrää on paljon" ja peruna tuplattiin.
    - "20 sipulii" oletettiin kiloiksi.
  - WhatsApp-koe Eeliksen koneella klo 17.13: kolme nopeaa viestiä ("Moi! Tarviin torstaiks 20 litraa maitoa", "Ja 5 kg voita", "Ja 50 sipulia") saivat yhden vastauksen, ja sipulit kirjautuivat 50 kappaleena. "Ei oo allergioita" toi valmiin korin viivalistana ja korilinkin.
  - Löydös: 50 sipulille valittiin 10 kg:n säkki. Eeliksen mukaan se on hävikkiä.
- **Yhdistetty 45f0dc4:ssä** haara `claude/agent-v2-demo-fixes` (6ef4762, sessio "Botti v2: Claude-silmukka, ohje ja kytkentä"), vain ohje ja testi:
  - Ensimmäisen viestin kuvauksessa ei ole enää taivutettavaa minä-muotoa.
  - Yleissääntö: virheetöntä suomea myös puhekielessä.
  - Avointa kysymystä ei toisteta joka viestissä. Allergioista kysytään kerran alussa ja uudelleen korin yhteenvedossa.
  - Puhekieliset kysymykset tunnistetaan ilman kysymysmerkkiä, ja ehdotukset pysyvät johdonmukaisina.
  - Laskettavan tuotteen pelkkä luku tarkoittaa kappaleita.
  - Työkalujen sisäistä toimintaa ei kuvailla.
  - Täydentää session E:n oikolukua (7a8e6e1).
- **Tarkistukset:** `npm test` 668/668 yhdistetyssä mainissa. Sessio raportoi CI:n kaltaisen kopion: 571 läpi, 93 ohitettu, 0 virhettä.
- **Kesken:**
  - Korin viivalista aina kun kori muuttuu, huomautus epätavallisen suuresta määrästä ja vähiten hävikkiä tuottava pakkaus (sama sessio).
  - Asiakaskohtainen muisti (sessio "Botti v2: asiakaskohtainen muisti").
  - Sonnet vs Opus -vertailu samalla keskustelulla (arviointisessio).

## 19.11.2026 — v2-agentin vastaukset oikoluetaan ennen lähetystä (sessio E)

- **Eeliksen pyyntö:** botti vastasi klo 17.06 "Moi"-viestiin "…ja minä keräären tilauksen valmiiksi koriin". Eelis: "ei saisi olla kirjotusvirheitä hei??" ja "korjaa se itse heti".
- **Muutos:** uusi `server/agent/proofread.mjs`, kytketty `server/agent/index.mjs`:iin.
  - Valmiin vastauksen saa vielä yksi mallikutsu: oletuksena Sonnet 5.5 ilman ajattelua, effort low, JSON-skeema.
  - Malli palauttaa vain parit väärä sana → oikea sana. Koodi vaihtaa ne.
  - Koodi hylkää parin, jossa on numeroita tai symboleja, joka on tuotenimen sana tai linkin osa, tai joka muuttaa sanaa liikaa (1 muutos alle 8 kirjaimen sanaan, 2 pidempään). Luvut, hinnat, päivät, tuotenimet ja linkit eivät siksi voi muuttua.
  - Virhe, aikakatkaisu, kelvoton vastaus tai alle 3 s jäljellä vuoron aikarajasta: vastaus lähtee sellaisenaan.
  - Ei oikolukua kieltäytymiseen eikä varavastaukseen.
  - Tokenit lasketaan vuoron kulutukseen. Lokiin vain kesto ja korjausten määrä, ei tekstiä.
  - `WHATSAPP_AGENT_PROOFREAD=false` ottaa oikoluvun pois, ja `WHATSAPP_AGENT_PROOFREAD_MODEL` vaihtaa mallin.
- **Oikea malli, kuusi vastausta:**
  - Korjasi "keräären" → "kerään", "tilauksetsa" → "tilauksesta" ja "alergioita" → "allergioita".
  - Ei koskenut hintoihin, tuotenimiin, päiviin eikä useimpiin puhekielen muotoihin. "tänää" → "tänään" korjautui, joten ohjeeseen lisättiin "tänää" ja "nii" esimerkeiksi puhekielestä, jota ei korjata.
  - Kesto 1,7–2,5 s, kerran 5,3 s.
  - Haiku löysi samat virheet, mutta sen kesto vaihteli enemmän (1,4–7 s).
- **Tarkistukset:**
  - Uusi `test/agent-proofread.test.mjs` 4/4. `agentSettings`-testin odotus päivitetty uusilla kentillä.
  - `npm test` 667/667, Worker 58/58, eval 26/26, spoken 58/58, tuoteajo 611/0.

## 19.11.2026 — viisi WhatsApp-asiakasta yhtä aikaa: rinnakkaisuustesti (sessio "Botti v2: viestien niputus ja vanhan vastauksen esto")

- **Pyyntö:** Eelis: "jos eri numerot käyttää tätä samanaikasesti ni tä toimii". Raportti [docs/agent-v2/rinnakkaisuus.md](docs/agent-v2/rinnakkaisuus.md).
- **Uusi `test/agent-v2-concurrency.test.mjs`** (5 testiä, ajetaan myös CI:ssä). Polku: allekirjoitettu webhook → kanava → korilinkki → silta → v2-agentti oikeilla työkaluilla ja luonnosvarastolla, malli käsikirjoitettu.
  - Viisi numeroa yhtä aikaa: vastaukset, luonnokset, transkriptit ja korilinkit eivät sekoitu. Viestit käsitellään kerran ja järjestyksessä. `WHATSAPP_CONCURRENCY=8` käsittelee kaikki viisi rinnakkain.
  - Harvemmat viestit: vuorot ja uusinnat eivät hävitä eivätkä tuplaa mitään.
  - Kaksi pilvi-instanssia samoilla kannoilla: sama numero ei ole koskaan käsittelyssä kahdesti.
  - Jonon varaus toimii kahdella kantayhteydellä.
  - Kutsu → YHDISTA → ensimmäinen viesti: agentti saa kutsun nimen.
- **Tulos:** sovellusvirhettä ei löytynyt eikä sovelluskoodia muutettu. 12 peräkkäistä ajoa ja 20 ajoa neljänä rinnakkaisena prosessina menivät läpi. Neljä tahallista vikaa kaatoivat kukin testit:
  - jono ilman numerokohtaista varausta
  - niputus yli numeroiden
  - väärä korilinkin sidos
  - silta, joka sarjallistaa kaikki
- **Tunnettu riski, ei korjattu ennen demoa:** saman selainistunnon kaksi samanaikaista pyyntöä eri instansseissa voi ajaa kaksi agenttivuoroa päällekkäin.
  - Tilanteet: kaksi välilehteä samalla evästeellä, yli 90 s:n vuoro tai korisivun muutos WhatsApp-vuoron aikana.
  - Seuraus: ristiriitainen vastaus ja mahdollisesti kumoutunut luonnosmuutos samalla asiakkaalla. Tietoja ei vuoda asiakkaiden välillä, eikä tilausta synny ilman korisivun vahvistusta.
  - Sessio ehdotti sidoskohtaista lukkoa WhatsApp-kantaan (`chat_leases`). Koordinaattori päätti, ettei lukkoa lisätä päivää ennen demoa, koska se toisi uuden virhetilan myös WhatsApp-vuoroihin. Lukko tehdään demon jälkeen, jos sitä tarvitaan.
- **Tarkistukset yhdistetyssä mainissa:** `npm test` 663/663. Sessio ajoi lisäksi CI:n kaltaisen kopion: 563 läpi, 93 ohitettu, 0 virhettä.

## 19.11.2026 — set_diet-työkalun kuvaus osittaiselle ruokavaliolle (koordinaattori)

- **Syy:** 79a33cc:n ohje käskee osittaisessa ruokavaliossa (esimerkiksi yksi vegaani 80:stä) kutsumaan `set_diet none: true` ja kirjaamaan tarpeen note-kenttään. Työkalun kuvaus sanoi silti: "true vain, kun asiakas on vahvistanut, ettei allergioita eikä erityisruokavalioita ole". Malli sai siis kaksi ristiriitaista ohjetta, minkä v2-agentti-sessio huomasi.
- **Muutos** (`server/agent/tools.mjs`, vain tekstit): `none: true` tarkoittaa, ettei koko tilausta rajata. Kuvaus mainitsee osittaisen ruokavalion ja note-kentän, ja esimerkkinä on "1 vegaani 80:stä". DIET_CONFLICT- ja DIET_EMPTY-viestit vastaavat samaa. Toiminta ei muuttunut.
- **Tarkistukset:** agenttitestit 69/69 ja `npm test` 658/658. Ei vielä tuotannossa.

## 19.11.2026 — livetestien korjaukset mainiin ja viisi rinnakkaista käyttäjää testattu (koordinaattori)

- **Yhdistetty mainiin** f7c07f8:ssa haara `claude/agent-v2-first-message` (sessio "Botti v2: Claude-silmukka, ohje ja kytkentä"). Taustalla Eeliksen pyynnöt ja viiden kokin livetestin löydökset tuotannosta:
  - 428f127: ensimmäinen viesti neuvoo, miten tilataan. Mitä tahansa Valio Aimon tukusta, toimituspäivä, allergiat ja erityisruokavaliot. WhatsAppissa myös ääniviesti, reseptilinkki ja kuva ostoslistasta. Selainkeskustelussa luvataan vain teksti ja linkit.
  - 07db771: tuote päätellään käytöstä ja valinta perustellaan lyhyesti (esimerkiksi lohikeittoon kiinteä peruna). Vaihtoehtoja näytetään vain, kun käyttö ei ratkaise valintaa tai ero on asiakkaan mieltymys.
  - 79a33cc:
    - Selainkeskustelun paikkanimeä "Kokeilija" ei käytetä puhutteluun.
    - Sävy pysyy asiakkaan oman tyylin sisällä: asiallisen asiakkaan kanssa ei puhekieltä eikä emojeja.
    - Yhden ruokailijan erityisruokavalio ei rajaa koko tilausta.
    - Tuotetta ei sanota puuttuvaksi ennen perussanalla tehtyä hakua.
    - Järjestelmän sisäistä toimintaa ei selitetä.
    - Pyytämättömistä perustarvikkeista kysytään ensin, eikä tarvetta monta kertaa suurempaa pakkausta tilata kysymättä.
- **Live-kuormitustesti** (sessio "Botti v2: arviointi oikealla mallilla", [docs/agent-v2/arviointi.md](docs/agent-v2/arviointi.md)): tuotannon v2-botti selainkeskustelun kautta. Viisi kokkia lähetti kolme viestiä samaan aikaan.
  - 15/15 vastausta HTTP 200, ei aikakatkaisuja.
  - Jokaisella oma kori, eikä tuotteita sekoittunut.
  - Viive mediaani 6,7 s ja p90 13,4 s, sama kuin yksin.
  - Kulu noin 0,5 $.
- **Tarkistukset:** yhdistetyn version `npm test` 658/658 paikallisella katalogilla. GitHubin testit läpi molemmilla yhdistetyillä haaroilla.
- **Ei vielä tuotannossa:** tuotanto ajaa 6c267f2:n koodia ja `WHATSAPP_CONCURRENCY=8` (aimo-whatsapp-4etjlnz1y). Julkaisu tehdään sessio E:n kautta Eeliksen luvalla.
- **Kesken:** WhatsApp-polun rinnakkaisuustesti viidellä numerolla oikean kanavan ja jonon läpi (sessio "Botti v2: viestien niputus ja vanhan vastauksen esto").

## 19.11.2026 — demonumeron suora yhdistäminen ja jäsenlista (koordinaattori)

- **Pyyntö:** Eelis: "sitku tänne liitetää esim 4 eri testiasiakast ni ne varmast toimii". Numerot eivät ole vielä tiedossa, ja kymmenen minuutin YHDISTA-koodi olisi pakottanut tekemään jokaisen liitoksen livenä kokeilijan kanssa.
- **Muutos:**
  - `scripts/whatsapp-member.mjs` sai komennon `link`. Se yhdistää numeron heti ilman koodia samalla `invite`- ja `pair`-polulla kuin `YHDISTA`-viesti ja `bootstrapDemoMember`. Demossa numeron omistajuus on jo varmistettu Metan testivastaanottajan vahvistuksella. Uusi `link` samalle numerolle aloittaa keskustelun ja korin alusta, joten sillä voi nollata demon.
  - Komento `list` näyttää WhatsApp-numerot peitettyinä (`+358…4567`) ja laskee selainkeskustelun synteettiset asiakkaat erikseen.
  - Jokainen komento kertoo ensimmäisellä rivillä, mihin kantaan se menee.
  - Uusi `npm run whatsapp:member:cloud` lukee `deploy/vercel/.env.cloud`-tiedoston viimeisenä, eikä sitä voi ajaa ilman tiedostoa.
  - [docs/demo-onboarding.md](docs/demo-onboarding.md) suosittelee suoraa yhdistämistä demoon, ja kutsukoodi jäi vaihtoehdoksi.
- **Tarkistukset:**
  - Uusi `test/whatsapp-member-cli.test.mjs` 2/2 väliaikaisella kannalla: yhdistäminen, uudelleenyhdistäminen uudella sidoksella, peitetty lista, selainasiakkaiden erottelu, poisto ja virheelliset valinnat.
  - Tuotannon kantaan ajettiin vain `list` (luku). Tulos: 7 WhatsApp-numeroa ja 73 selainkeskustelun testiasiakasta.
- **Huom Eelikselle:** Metan listalle mahtuu viisi numeroa. Ennen demoa sieltä pitää poistaa numerot, joita ei tarvita (esimerkiksi tiimiläisten), jotta neljä kokeilijaa mahtuu Eeliksen lisäksi.

## 19.11.2026 — rinnakkaisuus 8 asiakkaaseen instanssia kohden ennen demoa (sessio E)

- **Eeliksen päätös session E:ssä:** "Kyllä, nosta 8:aan".
- **Vercel (production):** lisätty `WHATSAPP_CONCURRENCY=8`. Sama rivi on myös paikallisessa `deploy/vercel/.env.cloud`-tiedostossa.
- **Julkaisu:** sama koodi kuin 6c267f2:ssa, deployment aimo-whatsapp-4etjlnz1y klo 11.18.
- **Tarkistukset julkaisun jälkeen:** healthz `host: cloud`, verify ja tick 200, Workerin `/whatsapp/cart.js` 200.
- **Ohje:** [docs/demo-onboarding.md](docs/demo-onboarding.md) päivitetty.

## 19.11.2026 — ohje demon testiasiakkaiden liittämisestä (sessio E)

- **Pyyntö:** sessio "Valio Aimo bot intelligence improvements" Eeliksen pyynnöstä valmistella huomisen demo, jossa on noin neljä testiasiakasta ja useampi käyttäjä samaan aikaan. Numerot eivät ole vielä tiedossa, joten kutsuja ei tehty.
- **Uusi [docs/demo-onboarding.md](docs/demo-onboarding.md):**
  - Metan testivastaanottajan lisäys: enintään viisi numeroa, ja Eeliksen oma numero vie yhden.
  - Tuotannon kutsu- ja poistokomennot `.env.cloud`-tiedostolla viimeisenä. Huom: `npm run whatsapp:member` osuisi Macin paikalliseen kantaan.
  - YHDISTA-viesti 10 minuutin sisällä, yritysrajat ja liittämättömän numeron vastaus.
  - Rinnakkaisuus.
- **Tarkistukset (vain luku):**
  - Tuotannon `aimo-whatsapp`-kannassa 7 WhatsApp-jäsentä ja 66 selainkeskustelun testiasiakasta, ei odottavia kutsuja. Metan vastaanottajalistan paikkoja ei voi lukea täältä.
  - Vercelissä Fluid compute päällä, aikaraja 300 s, ei `WHATSAPP_CONCURRENCY`-asetusta (oletus 4 asiakasta instanssia kohden).
  - Vercelin dokumentaatio ei kerro Hobby-tasolle numeerista rinnakkaisuusrajaa.
- **Avoinna:** jos viisi käyttäjää halutaan varmasti rinnakkain samassa instanssissa, `WHATSAPP_CONCURRENCY=8` ja uudelleenjulkaisu (sessio E, Eeliksen luvalla). Pelkkä dokumenttimuutos, ei testiajoa.

## 19.11.2026 — v2 valmis julkaistavaksi: korjauserä, arviointi ja malliksi Sonnet 5.5 (koordinaattori ja neljä sessiota)

- **Eeliksen päätös:** uuden botin malliksi Sonnet 5.5 (effort medium). Arvioinnin perusteella laatu on Opuksen tasoa, se on nopein ja hinta on puolet Opuksesta. Oletus on nyt koodissa `claude-sonnet-5-5`, ja `WHATSAPP_AGENT_MODEL` ohittaa sen.
- **Arviointi** (sessio "Botti v2: arviointi oikealla mallilla", raportti [docs/agent-v2/arviointi.md](docs/agent-v2/arviointi.md)), ydinskenaariot Eeliksen oikeista keskusteluista. Koodin tarkistukset / arvio 1–5 / $ per tilauskeskustelu / vastausaika mediaani ja p90:
  - vanha botti: 6/15, 2,1, 0,010 $, 9,4 s / 15,5 s
  - v2 Haiku 5.5 medium: 5/10, 2,9, 0,006 $, 5,3 s / 12,9 s
  - v2 Sonnet 5.5 medium: 8/11, 3,3, 0,078 $, 5,0 s / 9,3 s
  - v2 Opus 5.5 medium: 9/11, 3,4, 0,159 $, 6,2 s / 18 s
  - low-effort ei nopeuttanut ja heikensi laatua.
  - Kaikilla v2-malleilla kaksi nopeaa viestiä saa yhden vastauksen, ja allergioista kysytään 88–100 %:ssa tilauksista (vanha 0–15 %).
- **Korjauserän uusinta** (Sonnet medium): koodin tarkistukset 7/10 → 10/10, tervehdyksiä viidestä erilaisia 2 → 5, keksittyjä merkkejä 0 ja korisivun tarve oikein. "50 sipulia" sai vastauksen "Tarkoitatko 50 kappaletta? Se olisi noin 5–7 kg…". Kulut yhteensä 8,24 $ / 10 $.
- **Korjauserä** (yhdistetty `agent-v2-batch`-haaran kautta, main fast-forward a09ed5c:hen):
  - **v2-agentti:**
    - Merkkivartija ja ohjeen sääntö. Haiku oli kirjoittanut "Valio-kiinteää perunaa" Pietilän perunasta.
    - Keskustelun satunnainen sävy ja avauksen vaihtelu.
    - Tuotevalintalinja: ilmeinen tuote valitaan ja kerrotaan, olennaisista eroista näytetään 2–3 vaihtoehtoa.
    - `send_cart_link` samaan vastaukseen, tunnin välimuisti ja kestot lokiin.
    - Hintavälimuistin luku yhdellä IN-kyselyllä, mikä nopeuttaa myös vanhaa putkea.
    - Ohjeeseen: supistetut tiedot kerran ja kevyesti ilman teknisiä sanoja, ei myötäilyä, 1–3 virkettä.
  - **Riippumattoman koodikatselmoinnin korjaukset:**
    - Vartijan hylkäämä vastaus ei enää pääse läpi tyhjän korjauskierroksen kautta.
    - 11 euromuotoa tunnistetaan.
    - Ikkunan aiemmat hinnat hyväksytään.
    - Kieltäytyminen ei jää jumiin.
    - Kova vuoron aikaraja.
    - Korilinkki ei tallennu historiaan.
  - **Niputus:** hylätyn vastauksen uusinta vain v2:lle, koska vanha putki olisi hukannut esimerkiksi korilinkin. Pilven drainissa 90 s varmuusvara.
  - **v2-työkalut:**
    - Korisivun tarve kilogrammoina ja litroina ("50 kg", ei "25 kpl").
    - Muuntumaton kappaletarve pakkausten painona ("6 kg", ei "6 kpl").
    - Hintahuomautus ei enää mallin työkalutuloksessa.
- **Katselmointi:** yksikään WhatsApp- tai selainviesti ei voi vahvistaa tilausta eikä muuttaa hintaa. Tilaus syntyy vain korisivulla.
- **Tarkistukset:** `npm test` 651/651. CI:n kaltainen kopio ilman `data/`-hakemistoa ja fontteja: 558 läpi, 93 ohitettu, 0 virhettä.
- **Ei julkaistu.** Julkaisu vaatii Eeliksen luvan. Sessio E asettaa Verceliin `WHATSAPP_AGENT=v2` ja julkaisee. Uudet taulut luodaan automaattisesti: `agent_transcript` ja `agent_feedback` luonnoskantaan, `inbox_turns` WhatsApp-kantaan. Niputuksen oletukset ovat nyt 6 s / 20 s (ellei Vercelissä ole omia `WHATSAPP_GATHER_*`-asetuksia).
- **Seuraavaksi:** julkaisu luvalla, oikea WhatsApp-koe Eeliksen koneella (hänen luvallaan) ja muutokset pitch deck -sessiolle.

## 19.11.2026 — v2: Claude-silmukka, ohje ja kytkentä mainiin, oletuksena pois päältä (v2-agentti-sessio, e809fdc)

- **Muutos (sessio "Botti v2: Claude-silmukka, ohje ja kytkentä", main fast-forward e809fdc:hen):**
  - Uudet `server/agent/index.mjs` (Messages API -silmukka), `prompt.mjs` (jäädytetty suomenkielinen ohje: tarkistuslista, keskustelutapa ja persoona, ei pohjatekstejä), `transcript.mjs` (Claude-viestit tallennetaan vain lisäämällä luonnoskantaan) ja `guard.mjs` (euromäärät tarkistetaan työkalujen dataa vasten, mallin omat linkit kielletty).
  - Kytkentä asetuksen `WHATSAPP_AGENT=v2` taakse: `ordering.mjs` ja `cart-link.mjs` (linkki lisätään vain, kun `send_cart_link` onnistui).
  - `createConfiguredOrdering` palauttaa myös `store`- ja `tools`-instanssit.
  - Korisivun "näytä" ja "TILAA" pysyvät vanhassa varmassa polussa.
  - Malli `WHATSAPP_AGENT_MODEL` (oletus `claude-opus-5-5`), effort `WHATSAPP_AGENT_EFFORT` (oletus `medium`), fallbacks default ja thinking-lohkojen `drop_block`.
  - Raportti: [docs/agent-v2/agentti.md](docs/agent-v2/agentti.md).
- **Savukoe oikealla mallilla** (Opus 5.5 medium, koko WhatsApp-polku, eristetyt kannat, simuloidut hinnat ja Meta, ei tilauksia, noin 0,79 $):
  - Eeliksen peruna, sipuli ja kerma 50 hengelle: malli arvioi määrät itse (peruna noin 12 kg, sipuli 3 kg, kerma 4 l). "50 sipulia" → "50 sipulia on noin 6 kg, joten laitoin koriin 6 kpl 1 kg:n pusseja". Kori valmis ja linkki painikkeena 2–3 vuorossa.
  - Palaute "Vastaat aina tosi pitkästi…" tallentui `save_feedback`illa.
  - Viive 8–27 s vuorossa (keskimäärin 15 s, 3–5 mallikutsua), välimuistiosuma 83–89 %, vartija ei puuttunut, ei virheitä.
  - Arvioitavaa: viestit pitkähköjä, ja malli valitsi kahdesti tuotteen asiakkaan puolesta ennen linkkiä (tarjosi vaihtoa).
- **Tarkistukset:** `npm test` 623/623 mainissa. CI:n kaltainen kopio ilman `data/`-hakemistoa ja fontteja: 530 läpi, 93 ohitettu, 0 virhettä. `aimo:eval` 26/26 ja `aimo:eval:spoken` 58/58 (session ajo).
- **Ei käytössä:** tuotannossa ei ole asetusta `WHATSAPP_AGENT`, joten botti toimii vanhalla putkella. Seuraavaksi arviointi ajaa v2:n kolmella mallilla ja vertaa vanhaan (vertailuajo 9/12, arvio 2,7/5).

## 19.11.2026 — v2-työkaluihin skeemakorjaus, palautetyökalu ja gluteenin sanamuoto (v2-työkalut-sessio, 3872ae7)

- **Skeemakorjaus:** v2-agentin savukoe oikeaa Claude APIa vasten paljasti, että API hylkäsi jokaisen v2-pyynnön (400 "Enum value 'kg' does not match declared type ['string','null']"), koska null-arvoinen yksikkö yhdisti tyyppiunionin ja enumin. Null-enum on nyt `{ enum: [..., null] }` ilman type-kenttää. Uusi verkoton testi käy läpi kaikki työkaluskeemat ja estää virheen paluun. Yksikkötestit eivät olleet huomanneet tätä, koska ne eivät kutsu APIa.
- **`save_feedback`:** tallentaa asiakkaan palautteen botista tauluun `agent_feedback` luonnoskannassa (säilytys 30 pv). Ilman kantayhteyttä työkalu palauttaa `FEEDBACK_UNAVAILABLE`, jottei malli väitä palautetta kirjatuksi. Uusi riippuvuus: `createAgentTools({ ..., db })`.
- **Gluteeniton:** kun merkintä puuttuu mutta allergeenitiedoissa ei ole gluteeniviljoja, työkalu sanoo sen ("Ei gluteeniton-merkintää, mutta allergeenitiedoissa ei ole gluteeniviljoja"). Arvioinnin vertailuajossa vanha botti oli sanonut keliaakikolle, ettei juustoa ole, vaikka Emmental-raaste käy. Laktoositon jää merkinnän varaan. "Maidoton" tarkoittaa maitokieltoa.
- **Tarkistukset:** agent-tools 19/19. Koordinaattori fast-forwardasi mainin 3872ae7:ään ja ajoi `npm test`: 597/597.

## 19.11.2026 — v2: agentin työkalut ja tarkistuslista mainiin (v2-työkalut-sessio, koordinaattori yhdisti)

- **Muutos (sessio "Botti v2: agentin työkalut ja tarkistuslista", haarassa 389ff67, yhdistetty mainiin merge-commitilla):** uudet `server/agent/tools.mjs` ja `server/agent/cart.mjs`.
  - 12 työkalua: `set_delivery_date`, `set_diet`, `add_items`, `search_products`, `update_item`, `remove_item`, `get_cart`, `product_details`, `previous_orders`, `start_new_order`, `send_cart_link` ja `read_link`. `save_feedback` lisättiin myöhemmin (3872ae7, merkintä yllä).
  - Työkalut toimivat nykyisen luonnoksen päällä, joten korisivu, TILAA ja maksu toimivat sellaisinaan.
  - Jokainen tulos sisältää tarkistuslistan. `shoppingListView` on `review` täsmälleen silloin, kun `checklist.ready` on tosi.
  - Pakkaustiedot näkyvät mallille. "50 kpl sipulia" ja 10 kg:n säkki antaa `UNIT_NOT_CONVERTIBLE`, jolloin malli muuntaa itse.
  - Vain oikeat Valion hinnat. Ei mallikutsuja työkaluissa.
  - Raportti: [docs/agent-v2/tyokalut.md](docs/agent-v2/tyokalut.md).
- **Ei vielä käytössä:** työkalut kytketään bottiin v2-agentin haarassa (silmukka, ohje, kytkentä asetuksen `WHATSAPP_AGENT=v2` taakse), joka yhdistetään seuraavaksi. Vanha putki ennallaan.
- **Tarkistukset:** sessio ajoi agent-tools-testit 16/16 (2 oikealla katalogilla) ja CI:n kaltaisen kopion (485 läpi, 93 ohitettu, 0 virhettä). Koordinaattori ajoi yhdistetyn mainin `npm test`: 594/594.
- **Avoimet:** `cart-link.mjs`:n `incompleteNote` sanoo selvittämättömästä ruokavaliosta "tarkennus" (vanha teksti; v2-vuorot ohittavat sen). Monen toimituspaikan asiakkaalle ei ole paikan valintatyökalua (demossa yksi paikka).

## 19.11.2026 — v2: viestien niputus ja vanhentuneen vastauksen uusinta mainiin (niputus-sessio, koordinaattori yhdisti)

- **Eeliksen palaute WhatsAppissa 19.11. klo 8.45:** "vastaat jokasee viestii yksitelle eli pitäs oottaa et jos et oo ehtiny vastaa viel toho aiempaa ni sit lukaset uudet viestit läpi ja mietit kontekstin". Kaksi viestiä 6 s välein oli saanut kaksi ristiriitaista vastausta.
- **Muutos (sessio "Botti v2: viestien niputus ja vanhan vastauksen esto", haarassa 4d5b595, mainissa 00d9f3a):**
  - Niputus odottaa 6 s viimeisestä viestistä, enintään 20 s (ennen 3 s ja 10 s).
  - Jos asiakas kirjoittaa, kun vastaus on valmis mutta lähettämättä, vastaus hylätään ja `chat` kutsutaan uudelleen kaikilla viesteillä (`${id}:r1`, `discardedReply`, enintään 2 uusintaa). Vuorossa syntynyttä tilausta ei koskaan hylätä.
  - `chat` saa kentän `incoming: [{ text, at, round }]`.
  - Vuoron tila tallentuu tauluun `inbox_turns` (uusi taulu WhatsApp-kantaan, luodaan automaattisesti).
  - Pilven drainin aikarajan jälkeen ei aloiteta uusintaa.
  - Toimii vanhalla putkella ja v2:lla. Raportti: [docs/agent-v2/niputus.md](docs/agent-v2/niputus.md).
- **Koordinaattori:** `.env.example`:n ja `runtime.mjs`:n kommenttien vanhat oletukset 3000/10000 päivitetty arvoihin 6000/20000. `docs/agent-v2.md`:hen lisätty `round` ja uusinnan `messages`-muoto.
- **Tarkistukset:** sessio ajoi `npm test` 578/578 ja CI:n kaltaisen kopion ilman katalogia (487 läpi, 91 ohitettu, 0 virhettä). Koordinaattori ajoi yhdistetyn mainin `npm test`: 578/578.
- **Käyttöönotto:** ei vielä julkaistu. Oletusarvot muuttuvat tuotannossa seuraavassa botin julkaisussa, jos Vercelissä ei ole omia `WHATSAPP_GATHER_*`-asetuksia. Tarkistetaan sessio E:n kanssa julkaisun yhteydessä.

## 19.11.2026 — päätös: botista Claude-agentti työkaluilla (v2), ainoa kovakoodi tarkistuslista (Claude Code, koordinaattori)

- **Eeliksen palaute:** botti on "ihan tosi tyhmä", ei vastaa kivasti eikä kuulosta ihmiseltä. Esimerkkinä WhatsApp-keskustelu 19.11. klo 8.38–8.49: "50 sipulia" tilattiin 50 säkkinä, korjaukset toistivat saman luonnoksen, 50 hengelle ei ehdotettu määriä, ja jokaiseen viestiin vastattiin erikseen. Toive: suunnilleen Clauden tai Eeliksen koneen Janin tasoinen keskustelija.
- **Päätökset (Eelis):**
  - Ainoa kovakoodi on tarkistuslista: toimituspäivä, allergiat ja erityisruokavaliot, tuotteet (kaikki mainitut mukaan, muutokset ja lisäykset aina sallittuja), määrät ja viimeisenä ostoskori. Järjestys vapaa, toimituspäivä mieluiten ensin.
  - Malli kirjoittaa kaiken itse: aloitukset vaihtelevat, kori näytetään silloin kun se tuntuu järkevältä, ohjaus omaan tyyliin, ei pohjia.
  - Työ tehdään useassa rinnakkaisessa sessiossa ja vain valioaimo-tilausapuriin.
- **Juurisyyt ja suunnitelma:** [docs/agent-v2.md](docs/agent-v2.md). Lyhyesti: nykyinen putki on tilakone, jossa Haiku vain luokittelee viestit ja vastaukset kootaan pohjista ja säännöistä. v2 on Claude-silmukka omilla työkaluilla (haku, päivä, ruokavalio, rivit, kori, korilinkki). Se käyttää samaa luonnosta, korisivua ja maksua, ja se kytketään päälle asetuksella `WHATSAPP_AGENT=v2` vasta arvioinnin ja Eeliksen hyväksynnän jälkeen.
- **Jan:** avoimen lähdekoodin chat-sovellus, joka ajaa Eeliksen koneella Gemma 4 26B -mallia paikallisesti. Sen siirto pilveen ei auttaisi WhatsApp-bottia (vaatisi GPU-palvelimen). Fiksuus tulee siitä, että malli näkee koko keskustelun ja vastaa vapaasti, ja v2 tekee saman Claudella.
- **Työnjako:** sessiot v2-työkalut, v2-agentti, niputus ja arviointi omissa worktreeissään ja haaroissaan. Koordinaattori yhdistää mainiin ja kokoaa tämän lokin. Oikean mallin budjetti yhteensä enintään noin 6 $.
- **Tarkistukset:** vain suunnitelma, ei koodimuutoksia.

## 19.11.2026 — GitHubin testit taas vihreiksi: kiinteä toimituspäivä pois checkout-testistä (Claude Code, botin älykkyys -sessio)

- **Eeliksen havainto:** GitHubin testit eivät mene läpi (ajot 6e1ac3d ja a3d7524 punaisia 18.11. illasta).
- **Syy:** `test/whatsapp-checkout.test.mjs`:n tilauskokeessa luonnoksen toimituspäivä oli kiinteä 18.11. Päivän vaihduttua ydin tyhjentää menneen päivän luonnoksesta, joten TILAA palautti `error` eikä `confirmed`. Sovelluskoodissa ei ollut vikaa.
- **Muutos:** testin päivä on nyt nykyhetki + 7 päivää.
- **Tarkistukset:** `npm test` 562/562. Lisäksi koko sarja kolmella tulevalla kellolla (`DEMO_NOW` 25.11.2026, 10.12.2026 ja 15.1.2027): 0 kaatuvaa, joten muita lähiaikoina vanhenevia päiviä ei löytynyt.

## 19.11.2026 — esittely aina "Valio Aimon digitaalinen tilausapuri", ei "Mä oon Valio Aimo, tilausapuri" (Claude Code)

- **Eeliksen pyyntö:** "korjaa myös se "Mä oon Valio Aimo, tilausapuri" -esittely". WhatsApp-kokeessa 18.11. (merkintä alla) tyhjään koriin kesken keskustelun tullut "moi" sai vastauksen "Iltaa! Mä oon Valio Aimo, tilausapuri. Tilataanko jotain?".
- **Syy:** äänikerroksen ohjeessa (`voice.mjs`) luki "Nimi on Valio Aimo.", joten malli antoi apurille nimen Valio Aimo. Koodin esittelytarkistus (`withBotDisclosure`) toimii vain ensimmäisessä tervehdyksessä ja kysymykseen botista, joten se ei korjannut esittelyä kesken keskustelun.
- **Muutos:** äänikerroksen ohje: "Olet Valio Aimon digitaalinen tilausapuri. Valio Aimo on palvelu, ei sinun nimesi …". Uusi `withFullIntro` (`persona.mjs`) korjaa jokaisessa viestissä esittelyt "Mä oon Valio Aimo, tilausapuri", "Valio Aimo -tilausapuri", "Valio Aimon tilausapuri", "Aimon apuri" ja pelkän "Mä oon Valio Aimo." muotoon "… Valio Aimon digitaalinen tilausapuri" (englanniksi "I'm Valio Aimo's digital ordering assistant"). Muut Valio Aimo -maininnat ("Tilaus menee Valio Aimon kautta") jäävät ennalleen. Kytkentä `dialogue.mjs`:ssä ennen esittelytarkistusta, ettei ensimmäisessä tervehdyksessä tule kahta esittelyä, ja äänikerroksen jälkeen.
- **Samalla korjattu:** oikean mallin kokeessa toinen "moi" sai "Iltaa! Moi! Tilataanko jotain?". Äänikerros palautti "Joo, moi! Mitä tilataan tänään?", ja koodi poisti tervehdyksen ennen täytesanaa, joten "moi" jäi. Nyt `unlockMessages` poistaa tervehdyksen ja pelkän tervehdyksen täytesanan toistuvasti, missä järjestyksessä tahansa.
- **Tarkistukset:** `test/whatsapp-persona.test.mjs` 15/15. Neljä uutta testiä, joista kolme kaatui vanhalla koodilla ja yksi (ohjeen sanamuoto) vanhalla `voice.mjs`:llä. `npm test` 561/562: ainoa kaatuva `whatsapp-checkout.test.mjs` (order id and approval state) kaatuu samoin muuttamattomalla HEADillä, koska testissä on kiinteä toimituspäivä 18.11., joka on nyt mennyt. Ei korjattu tässä. Oikea Haiku omilla väliaikaisilla kannoilla, simuloitu Meta, ei tilauksia: 18 tervehdyskeskustelua, 76 mallikutsua, 0 virhettä. Kumpikin korjaus mukana viimeisissä 9 keskustelussa (38 kutsua). Esittelykorjauksen jälkeen "Valio Aimo, tilausapuri" ei esiintynyt kertaakaan, äänikerroksen "Joo, moi!" ja "Moi!" poistuivat koodin tervehdyksen perästä, ja "ootko botti?" sai yhä "Olen Valio Aimon digitaalinen tilausapuri enkä ihminen".
- **Huomio, ei korjattu:** äänikerros lisää lähes jokaiseen pätkään "Moi!" ohjeesta huolimatta (koodi poistaa sen), ja kerran se kysyi "Mikä sun keittiön tilanne on", vaikka ohje kieltää kysymästä keittiöstä.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin mainista a3d7524: aimo-whatsapp-kqozw5voc, tuotannossa 19.11. klo 8.57. Worker ennallaan.
- **Livetarkistus 19.11. klo 8.58–8.59:** Keskustele-chat, kaksi uutta selainistuntoa, ei tilausta.
  - "moro" → "No moikka! Mä olen Valio Aimon digitaalinen tilausapuri ja autan keittiöitä tilaamaan. Tilataanko jotain?"
  - Samassa keskustelussa "kiitti", "moi" ja "moi" → "Huomenta! Mitä sulle tänään kuuluu, tilataanko jotain?" ja "Huomenta! Tilataanko jotain tänään?". Ei tuplatervehdystä eikä esittelyä kesken keskustelun.
  - Uusi istunto: "hei" → "Huomenta! Olen Valio Aimon digitaalinen tilausapuri, ja autan mielelläni tilaamisessa. Tilataanko jotain?". "ootko botti?" → "Joo, oon Valio Aimon digitaalinen tilausapuri, eli botti enkä ihminen. …". "moikka" → "No moikka! Tilataanko jotain?".
  - "Valio Aimo, tilausapuri" ei esiintynyt.
- **Avoinna:** `whatsapp-checkout.test.mjs`:n kiinteän päivän korjaus (päivä nykyhetkestä + 7) on valioaimon työpuussa commitoimattomana toisen session muutoksena. Ei otettu tähän commitiin, ja sessio E:ltä on kysytty, viekö se sen GitHubiin.

## 18.11.2026 — tervehdyksen Joo-korjaus varmennettu WhatsAppissa (Claude Code)

- **Eeliksen pyyntö:** "testaa whatsapissa et joo on poissa". Korjaus eb57081 on ollut livenä klo 13.08 alkaen (aimo-whatsapp-3z9jn9il6). Koe ajettiin sessio E:n klo 17.02 julkaisulla 8c7bb47:stä (ff84f3e ei vielä mukana). Koe tehtiin Eeliksen omassa WhatsApp-keskustelussa noin klo 17.05, ei tilausta.
- **Tulos:** ensimmäinen "moi" osui keskeneräiseen korin kysymykseen, koska aiemman kokeen lanttulaatikkokori oli jäänyt kesken: "Iltaa! Edellinen ostoskorisi jäi kesken (toimitus la 21.11.): – lanttulaatikko 500 kg" ja "Jatketaanko siitä vai aloitetaanko uusi tilaus?". Tämä vastaus tulee koodista, ei mallilta. "2" → "Joo, aloitetaan uusi tilaus! Mitä tilattais?" (Joo vastaa valintaan, kuten pitää). Tyhjään koriin uusi "moi" → "Iltaa! Mä oon Valio Aimo, tilausapuri. Tilataanko jotain?" eli ei Joo-alkua.
- **Huomio, ei korjattu:** apuri esitteli itsensä muodossa "Mä oon Valio Aimo, tilausapuri" eikä "Valio Aimon digitaalinen tilausapuri".
- **Sivuvaikutus:** Eeliksen viestikentässä ollut lähettämätön "entä keskiviikoksi 25.11.?" oli kadonnut, kun WhatsApp avattiin uudelleen. Vanha lanttulaatikkokori suljettiin vastaamalla "2"; tilauksia ei poistettu.

## 18.11.2026 — ensimmäinen esittely ilman "en ihminen" ja kaksoistervehdystä (Claude Code)

- **Eeliksen pyyntö:** "korjaa myös se "en ihminen" esittelystä". Livenä "moro" sai vastauksen "No moikka! Mä olen Valio Aimon digitaalinen tilausapuri, eli botti, en ihminen. …", vaikka ohje kieltää sen. Kukaan ei kysynyt, joten se kuulosti puolustelulta.
- **Muutos:** uusi `withPlainIntro` (`server/whatsapp/persona.mjs`) poistaa ensimmäisen tervehdyksen esittelystä pyytämättömät lisäykset ", en ihminen", "enkä ihminen", ", eli botti" ja englannin ", not a human". "En ihminen, mutta autan" muuttuu muotoon "ja autan". Poisto koskee vain ensimmäistä tervehdystä ilman kysymystä botista. Jos poiston jälkeen vastaus ei enää kerro apurin olevan digitaalinen, alkuperäinen teksti jää (avoimuusvelvoite). Kysymykseen "ootko botti?" vastaus pysyy ennallaan ("Joo, mä oon … digitaalinen tilausapuri, en ihminen."). Kytkentä `dialogue.mjs`:ssä ennen äänikerrosta ja sen jälkeen.
- **Samalla korjattu:** kokeessa "moikka" sai vastauksen "No moikka! Moi! Mä oon …": mallin kaksi peräkkäistä tervehdystä jäivät, koska vain ensimmäinen poistettiin. Nyt `withGreeting` ja äänikerroksen `unlockMessages` poistavat kaksi peräkkäistä tervehdystä, ja `LEADING_GREETING` tuntee "No moikka".
- **Tarkistukset:** `test/whatsapp-persona.test.mjs` 11/11 (kolme uutta testiä kaatui vanhalla koodilla), `npm test` 558/558, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Oikea Haiku omilla väliaikaisilla kannoilla, simuloitu Meta, ei tilauksia: 24 tervehdyskeskustelua, 48 mallikutsua, 0 virhettä. Korjauksen jälkeen "moro", "moi", "terve", "morjens", "moikka" ja "hei" saivat esittelyn ilman "en ihminen"-, "eli botti"- tai kaksoistervehdystä (esim. "No moikka! Mä olen Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?"), ja "moi, ootko botti?" sai yhä "en ihminen".
- **Julkaistu:** Eelis hyväksyi ("julkaise myös c72cb17"). Sessio E julkaisi botin mainista fb16076 yhdessä ff84f3e:n kanssa: aimo-whatsapp-hsg210e64, tuotannossa 19.11. klo 0.23. Worker ennallaan (4ac9dd6d).
- **Livetarkistus 19.11. klo 0.25:** Keskustele-chat, uusi selainistunto ilman historiaa, ei tilausta. "moro" → "No moikka! Mä oon Valio Aimon digitaalinen tilausapuri ja autan sua tilaamaan. Tilataanko jotain?", eli ei "en ihminen"- eikä kaksoistervehdystä. Vanhassa istunnossa, jossa oli historiaa, "moro" sai pelkän "No moikka! Tilataanko jotain?" ilman esittelyä, kuten pitääkin.

## 18.11.2026 — lanttulaatikon vastaus ei enää kehota kokeilemaan toista päivää (Claude Code)

- **Eeliksen pyyntö:** "korjaa myös lanttulaatikon 'Kokeile toista päivää'". Vastaus "5 kg lanttulaatikkoa maanantaiks" päättyi "Kokeile toista päivää tai tarkenna tuotetta. Tilausta ei ole tehty.", vaikka toinen päivä ei auta: lanttulaatikkoa ei ole tilattavana, eikä lantulle ole Valion hintaa millekään päivälle.
- **Muutos (ff84f3e):** `order-tools` merkitsee INGREDIENT_UNAVAILABLE-huomioon, puuttuuko raaka-aineelta hinta ja saatavuus kokonaan (`unknown`). `order-conversation` (`daylessIssue`) päättelee rivikohtaisesti, auttaako toinen päivä. Ei auta, kun tuotetta ei ole valikoimassa, tai kun valmisruoalle ei tiedetä myöhempää tilattavaa päivää ja sen raaka-aineelta puuttuu hinta. Kun mikään rivi ei hyödy toisesta päivästä, loppu on nyt `Kirjoita "poista lanttulaatikko" tai kerro, mitä laitetaan tilalle. Tilausta ei ole tehty.` Muuten vihje on ennallaan.
- **Tarkistukset:** `test/dish-ingredient.test.mjs` laajennettu: lanttulaatikko saa uuden lopun, ja kaalilaatikko, jonka raaka-aine on tilattavissa muina päivinä, saa yhä "Kokeile toista päivää". `npm test` 557/557, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Oikea katalogi tuotannon hintavälimuistin kopiolla (last-known, ei mallia): lanttulaatikko ma 23.11. antaa `nextDeliveryDate: null` ja `unknown: true`, joten uusi loppu tulee käyttöön. Ei tilauksia.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin mainista fb16076 (ff84f3e ja c72cb17): aimo-whatsapp-hsg210e64, tuotannossa 19.11. klo 0.23.
- **Livetarkistus 19.11. klo 0.24:** Keskustele-chat, testiasiakas, ei tilausta. "5 kg lanttulaatikkoa maanantaiks" → "Ai, lanttulaatikkoa ei nyt löydy maanantaille 23.11. Lanttu olisi sen tilalla, mutta mä en valitettavasti saa nyt tarkistettua sen hintaa tai saatavuutta. Kirjoita "poista lanttulaatikko" tai kerro, mitä laitetaan tilalle. Tilausta ei ole vielä tehty." Ei "Kokeile toista päivää". Lista tyhjennettiin lopuksi ("aloita alusta").

## 18.11.2026 — valinnan kuittaus ei enää pyydä valitsemaan uudelleen (Claude Code)

- **Eeliksen pyyntö:** "Yes, fix it" livekokeen löydökseen. Porkkanalaatikon tilalle valittu porkkana ("2") sai kuittauksen "Joo, porkkanalaatikkoa ei nyt löydy tilattavana, mutta sopiva tilalle on porkkana. Kerro, mikä vaihtoehto sulle käy, niin mä jatkan.", vaikka valinta oli jo tehty ja tilausluonnos tuli heti perään.
- **Syy:** koodin kuittaus oli oikein ("Selvä, valitaan Porkkana pesty 1 kg PSS suomi."), mutta äänikerros (`voice.mjs`) kirjoitti sen uudelleen edellisen viestin pohjalta. Tarkistus hylkäsi kadonneen kysymyksen ja kadonneen kiellon, mutta ei lisättyä kieltoa tai uutta pyyntöä.
- **Muutos (`server/whatsapp/voice.mjs`):** uusi teksti hylätään, jos siihen tulee kielto (ei, en, et, eikä …), jota alkuperäisessä ei ollut, tai pyyntö kertoa jotain (kerro, ilmoita), kun alkuperäinen ei ollut kysymys eikä pyyntö. Silloin asiakas saa koodin oman kuittauksen. Kysymyksen saa yhä kirjoittaa pyynnöksi ("Kerro vielä, paljonko voita laitetaan?"), ja listan johdannon "Valitse näistä:" saa sanoa.
- **Tarkistukset:** uusi testi `test/whatsapp-voice.test.mjs`:ssä elävän kokeen lauseilla (hylätään instruction, instruction ja negation-added, omin sanoin kirjoitettu kuittaus kelpaa). `npm test` 555/555, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Oikea Haiku samalla historialla viisi kertaa: kaikki kuittaukset uskollisia ("Okei, otetaan Porkkana pesty 1 kg PSS suomi."), eikä elävän kokeen virhettä toistunut.
- **Ei korjattu:** lanttulaatikon vastauksen perään tulee yhä "Kokeile toista päivää tai tarkenna tuotetta." (korjattu myöhemmin ff84f3e:ssä, ks. ylempi merkintä).
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin vedoksesta tarkalleen commitista 8c7bb47, deployment aimo-whatsapp-3k3ekp5qs, livenä klo 17.02. Worker ennallaan (4ac9dd6d).
- **Livetarkistus:** sivuston Keskustele-chatissa testiasiakkaalla, ei tilausta. "5 kg porkkanalaatikkoa maanantaiks" → porkkanan kolme vaihtoehtoa kuten ennen, ja "2" → "Joo, valitaan Porkkana pesty 1 kg PSS suomi, eli 5 pussia ja yhteensä 5 kg." ja tilausluonnos 6,30 €. Kuittaus ei enää pyydä valitsemaan uudelleen. Keskustelu nollattiin lopuksi.

## 18.11.2026 — lauantaikorjaus ja uusi pohja varmennettu livenä (Claude Code)

- **Eeliksen pyyntö:** "testaa whatsapissa et toimii" julkaisun aimo-whatsapp-ndmzin5zu (c2c007b) jälkeen. Botti oli tällöin sessio E:n julkaisu 760a8b1:stä (aimo-whatsapp-ovkenrud0), eli eb57081 ei ollut vielä mukana.
- **WhatsApp, Eeliksen oma keskustelu:** "tyhjennä ostoskori" tyhjensi korin. "tarviin 500 kiloa lanttulaatikkoa isoihin bileisiin, bileet olis viikon päästä keskiviikkona, niin toimitus lauantaina" → toimitus la 21.11. (ennen 28.11.). Lanttulaatikkoa ei ollut tilattavana, ja vastaus ehdotti lanttua (760a8b1:n käytös). Taustakirjoitus WhatsAppiin estyi tämän jälkeen, joten "entä keskiviikoksi 25.11.?" jäi Eeliksen viestikenttään lähettämättä. Vahingossa alkanut ääniviesti poistettiin lähettämättä.
- **Sivuston Keskustele-chat (sama botti), ei tilausta:** "20 l maitoa ja 5 kg voita perjantaiks, tavallinen käy" → vaihtoehtolohko uudessa muodossa (Toimitus, Hinnat alv 0 %, numerot, "Vastaa 1, 2 tai 3.", "Jos haluat muita vaihtoehtoja, vastaa 4."), "2" → "Joo, valitaan Valio rasvaton maito 1 l ESL.", "1" → tilausluonnos Eeliksen pohjan mukaan (Tilausluonnos, Toimitus, yritys, Tuotteet viivoin, Yhteensä, viimeinen tilausaika, ok-ohje kahdella rivillä, muutosesimerkit). "5 kg porkkanalaatikkoa maanantaiks" → "Tilalle käy raaka-aine porkkana", "2" → luonnoksen esimerkit "porkkana 8 kg" ja "poista porkkana", ja "poista porkkana" poisti rivin.
- **Huomio:** samassa selainkeskustelussa klo 12.51 (toisen session koe) valinnan "2" kuittaus pyysi valitsemaan uudelleen ("Kerro, mikä vaihtoehto sulle käy"), vaikka valinta oli tehty. Omassa toistossa kuittaus oli oikein, joten kyse oli kertaluonteisesta äänikerroksen muotoilusta. Ei korjattu.

## 18.11.2026 — pelkkään tervehdykseen ei enää "Päivää! Joo, …" (Claude Code)

- **Eeliksen hyväksyntä:** "Kyllä, korjaa". Live-kokeessa klo 11.37 "moi" sai vastauksen "Päivää! Joo, mä oon Valio Aimon digitaalinen tilausapuri, eli botti. Tilataanko jotain?". Joo ei vastannut mihinkään: persoonan esimerkki "Joo, katsotaan!" sai mallin aloittamaan sillä.
- **Muutos:** `persona.mjs` `withoutFiller` poistaa alusta täytesanan (joo, juu, jep, jees, okei, ok, selvä, kyllä, no niin) ja aloittaa seuraavan sanan isolla. Sitä käytetään vain, kun asiakkaan viesti on pelkkä tervehdys ja koodi lisää tervehdyksen: `dialogue.mjs` (mallin oma vastaus) ja `voice.mjs` `unlockMessages` (äänikerroksen uudelleenkirjoitus, `bare`). Kun tervehdyksen perässä on kysymys ("moi, ootko botti?"), Joo jää, koska se vastaa kysymykseen.
- **Tarkistukset:** kaksi uutta testiä `test/whatsapp-persona.test.mjs`:ssä (8/8). Ne kaatuivat vanhalla koodilla. `npm test` 554/554, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54, `git diff --check`. Oikea Haiku omilla väliaikaisilla kannoilla, simuloidulla Metalla ja ilman tilauksia: kuusi pelkkää tervehdystä (moi, moro, Hyvää huomenta!), yhdessäkään ei Joo-alkua, esim. "Päivää! Mä oon Valio Aimon digitaalinen tilausapuri ja autan sua tilaamaan keittiön tarpeet. Tilataanko jotain?". "moi, ootko botti?" → "Päivää! Joo, mä oon … eli botti eikä ihminen." 18 mallikutsua, 0 virhettä.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin mainista 699cef8 (botin koodi sama kuin eb57081), deployment aimo-whatsapp-3z9jn9il6, livenä klo 13.08. Worker ennallaan (4ac9dd6d).
- **Live-koe:** Keskustele-chat, jokainen viesti uudessa istunnossa (uusi testiasiakas), ei tilausta. "moi" → "Päivää! Mä olen Valio Aimon digitaalinen tilausapuri ja autan keittiöitä tilaamaan. Tilataanko jotain?", "moro" → "No moikka! Mä olen Valio Aimon digitaalinen tilausapuri, eli botti, en ihminen. …", "Hyvää huomenta!" ja toinen "moi" samoin ilman Joo-alkua. "moi, ootko botti?" → "Päivää! Joo, …", kuten tarkoitettu. Esittelyyn tulee vielä toisinaan "en ihminen", vaikka ohje kieltää sen ensimmäisessä tervehdyksessä.

## 18.11.2026 — valmisruoan tilalle pääraaka-aine: porkkanalaatikolle porkkanaa, ei toista laatikkoa (Claude Code)

- **Eeliksen pyyntö:** "tarjoa lanttulaatikon tilalle mieluummin lanttua ja samaa logiikkaa käyttäisit kaikkeen muuhunkin, ok?" (sessio E oli juuri estänyt maksalaatikon lanttulaatikon tilalla, 0886ce6).
- **Päätös:** kun valmisruokaa (laatikko, keitto, kastike, kiusaus, vuoka, pata, muhennos, piirakka, pihvi, pyörykkä, kääryle) ei ole tilattavana, tarjotaan ensin saman ruoan muita valmistajia ja kokoja, sitten ruoan pääraaka-ainetta. Pääraaka-aine on ruoan nimen alkuosa: lanttulaatikko → lanttu, porkkanalaatikko → porkkana, perunalaatikko → peruna, lohikeitto → lohi. Toista ruokaa ei tarjota missään polussa.
- **Muutokset:**
  - `server/storefront.mjs`: uusi `dishIngredient`. Raaka-aineeksi kelpaa vain tuote, joka on itse sitä raaka-ainetta (haun `requested`) eikä valmisruoka, joten porkkanatäysmehu, Piltti ja lanttupihvi eivät käy. Kilot ja litrat siirtyvät raaka-aineelle (5 kg porkkanalaatikkoa → 5 kg porkkanaa). Kappaleina pyydetyn ruoan raaka-aineelle näytetään yhden myyntierän hinta ja määrä kysytään, koska 6 kpl porkkanalaatikkoa ei ole 6 pussia porkkanaa. Tuoreelle kasvikselle (kategoriat 1740x–1743x paitsi kypsät perunavalmisteet 17423) laktoositon-, gluteeniton- ja vegaaninen-vaatimukset eivät vaadi merkintää. Allergeenikiellot pätevät ennallaan.
  - Samassa tiedostossa valmisruoan haun tulokset rajataan samaan ruokaan: perunalaatikolle haku antoi nakki- ja liha-perunasoselaatikkoa. Tuntemattoman saatavuuden polku (`knownAlternatives`) ei kysy valmisruoalle mallilta, vaan tarjoaa vain saman ruoan tuotteita.
  - `server/order-tools/index.mjs`: raaka-ainevaihtoehdon valinta vaihtaa rivin tuotteeksi raaka-aineen (`replaceTerm`), ja syy on "Raaka-aine, josta porkkanalaatikko tehdään". Jos raaka-aine on valikoimassa mutta sitä ei saa tilattua, sanotaan esim. "Lanttulaatikolle kävisi korvaajaksi raaka-aine lanttu, mutta sen hintaa ja saatavuutta en nyt saa tarkistettua."
  - `server/order-conversation/index.mjs`: otsikko "Porkkanalaatikolle ei löytynyt tilattavaa." ja "Tilalle käy raaka-aine porkkana (tarve 5 kg):".
- **Tarkistukset:** uusi `test/dish-ingredient.test.mjs` 4/4, joista kolme vaatii katalogin. Ilman katalogia (CI) 1 läpi ja 3 ohitettu. `npm test` 552/552, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Kokeiltu oikealla katalogilla ja vanhan Macin hintavälimuistin kopiolla (1 119 tuotetta, last-known, ei tilauksia, ei mallikutsuja):
  - porkkanalaatikko 5 kg → porkkana 10 kg säkki, 5 × 1 kg pussi ja violetti porkkana, ja valinta muuttaa rivin muotoon "porkkana 5 kg"
  - perunalaatikko 10 kg → perunat, ei perunasoselaatikoita
  - lanttulaatikko 5 kg → ei tilattavaa, ja lantusta kerrotaan, ettei sille ole hintaa
  - lohikeitto 10 l → lohta ei ole tilattavana sille päivälle
  - maksalaatikko ja lihakaalilaatikko löytyvät kuten ennen
- **Raaka-ainehyllyt ensin:** pelkkä "kaali" löytää tuotenimistä vain salaatteja, joten kaalilaatikon raaka-aine on keräkaali (`INGREDIENT_ALIAS`). Valmisruoat ja -salaatit (kategoria 173xx) eivät ole raaka-ainetta. Raaka-ainehyllyn tuotteet (tuoreet ja pakastetut kasvikset, mausteet sekä raaka liha, kala ja broileri) menevät jalostettujen edelle. Jalostettu tuote kelpaa vain, jos raakaa ei ole: lihamakaronilaatikko → makaroni. Lihakaalilaatikolle raaka-ainetta ei tunnisteta.
- **Rajat:** lanttulaatikon tilalle ei voi nyt tarjota tilattavaa lanttua, koska yhdelläkään lanttutuotteella ei ole Valion oikeaa hintaa (testirajapinta suljettu, Eeliksen päätös 17.11.: vain oikeat hinnat). Pääraaka-aine on aina ruoan nimen alkuosa, ei koko reseptiä.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise" ja "julkaise kaikki mainista"). Sessio E julkaisi botin 760a8b1:stä klo 12.49, deployment aimo-whatsapp-ovkenrud0. 5a23c04, c2c007b ja Worker 49cc0ae olivat jo tuotannossa.
- **Livetarkistus** sivuston Keskustele-chatissa testiasiakkaalla, ei tilausta: "5 kg porkkanalaatikkoa maanantaiks" → "Porkkanalaatikolle ei löytynyt tilattavaa. Tilalle käy raaka-aine porkkana (tarve 5 kg):" ja kolme porkkanaa (10 kg säkki 11,18 €, 5 × 1 kg pussi 6,30 €, violetti porkkana 10,55 €). Vastaus "2" teki tilausluonnokseen rivin "Porkkana pesty 1 kg PSS suomi: 5 pussia, yhteensä 5 kg, 6,30 €". "5 kg lanttulaatikkoa maanantaiks" → "…kävisi korvaajaksi raaka-aine lanttu, mutta sen hintaa ja saatavuutta en nyt pysty tarkistamaan." Keskustelu nollattiin lopuksi.
- **Kömpelöt kohdat, ei korjattu:** valinnan "2" jälkeen kuittaus sanoi "Kerro, mikä vaihtoehto sulle käy, niin mä jatkan.", vaikka valinta oli jo tehty ja luonnos näkyi heti perässä. Lanttulaatikon vastauksen perään tuli vanha "Kokeile toista päivää tai tarkenna tuotetta.".
- **Käyttöönotto:** botin julkaisu session E kautta Eeliksen luvalla. Workeria ei tarvita.

## 18.11.2026 — valitun korvaajan nimi muutosvihjeeseen ja riville (Claude Code)

- **Pyyntö:** sessio E (Eeliksen pyytämän tarkistuksen kolmas kohta): kun lanttulaatikon tilalle valittiin Saarioinen Maksalaatikko, luonnoksen muutosvihje sanoi silti "lanttulaatikko 750 kg" ja "poista lanttulaatikko".
- **Syy:** lähimmät vaihtoehdot ("ei löytynyt osumaa") eivät vaihtaneet rivin tuotesanaa valinnan yhteydessä. Tuntemattoman saatavuuden polku vaihtoi sen jo (replaceTerm).
- **Muutos:** kun valittu vaihtoehto ei ollut pyydetty tuote, rivi saa valitun tuotteen lyhyen sanan (`substituteTerm`, `wording.mjs`): merkki, koot ja ruokavaliosanat jätetään pois, esim. "Saarioinen Maksalaatikko laktoositon 2,7kg" → "maksalaatikko" ja "Kotimaisia viiriäisen munia 10kpl" → "viiriäisen munia". Vihje on nyt "maksalaatikko 750 kg", "poista maksalaatikko" tai "tyhjennä ostoskori". Sääntötulkki löytää poistettavan rivin vihjeen sanasta sellaisenaan, vaikka jäsennin ei tuntisi sanaa.
- **Tarkistukset:** `test/whatsapp-saturday-layout.test.mjs` 8/8 (uusi poistotesti). `npm test` 548/548 ja CI:n kaltainen kopio 460 läpi, 88 ohitettu, 0 virhettä. `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Ei mallikutsuja.
- **Käyttöönotto kesken:** julkaistaan yhdessä 5a23c04:n kanssa (sessio E, Eeliksen luvalla).

## 18.11.2026 — lähin lauantai toimituspäiväksi, selkeämpi vaihtoehtolista ja tilausluonnos Eeliksen pohjan mukaan (Claude Code)

- **Eeliksen havainto (WhatsApp klo 9.39):** ääniviestissä "500 kiloa … bileet olis viikon päästä keskiviikkona, niin toimitus about lauantaina". Apuri vastasi "Bileet keskiviikkona 25.11. ovat ennen lauantain 28.11. toimitusta … Haluatko toimituksen lauantaina 21.11. vai bileisiin keskiviikkona 2.12.?", ja korjauksen "eiku siis viikon päästä keskiviikkona" jälkeen toimitus kirjattiin bileiden päivälle 25.11. Eelis: miksi lauantai 28.11., kun lauantaihin on vain muutama päivä.
- **Syy:** dialogimalli sai vain tämän päivän eikä kalenteria, laski viikonpäivät itse ja keksi ristiriidan. Mallitulkin päivätarkistus valitsi väärän päivän tilalle viestin ensimmäisen päivän, tässä bileiden keskiviikon. Sääntötulkki ei tuntenut ilmausta "viikon päästä", ja englannin etuliite "on" nieli sanan ("juhlat on viikon päästä torstaina" → huominen).
- **Korjaus:** `deliveryDateCue` (`server/aimo/understand.mjs`) erottaa lauseen, jossa on toimitussana, tapahtuman lauseesta (bileet, juhlat, tilaisuus …). Asiakkaan nimeämä toimituspäivä voittaa mallitulkissa (`interpret.mjs`) ja sääntötulkissa. "Viikon päästä X" = ensi viikon X. Dialogimalli saa kalenterin ja ohjeen: toimitus ennen tapahtumaa on tavallista, tapahtuman siirtoa ei ehdoteta.
- **Eeliksen pohja vaihtoehdoille:** "Toimitus: la 21.11.", "Hinnat alv 0 %", puuttuvasta tuotteesta "Lanttulaatikolle ei valitettavasti löytynyt osumaa." ja "Tässä korvaajia (tarve 500 kg):", numeroidut vaihtoehdot, sitten "Vastaa 1 tai 2." ja "Jos haluat muita vaihtoehtoja, vastaa 3." (ei enää riviä "4) Näytä lisää vaihtoehtoja").
- **Toimituspäivän ehdotus poistettu:** "Varmuuden vuoksi voidaan kokeilla toimitusta jo …" on poistettu Eeliksen pyynnöstä ("ei ehottele mitää varmuuden vuoksi"). Samalla poistui sen lause "Tuotteiden pitää siis olla perillä … En tiedä Valion tarkkoja toimitusaikoja".
- **Tilausluonnos:** rivit ovat nyt *Tilausluonnos*, "Toimitus: …" ja yrityksen nimi. Toimituspaikka näkyy vain, jos paikkoja on useampi. Sen jälkeen *Tuotteet* ranskalaisin viivoin, "Yhteensä: … (alv 0 %)" ja "Tilaus pitää tehdä viimeistään …". WhatsAppissa luonnos päättyy riveihin "Vastaa *ok*, niin saat linkin ostoskoriin." ja "Tarkistat ja vahvistat tilauksen siellä.". Muutosesimerkkiin tuli "tyhjennä ostoskori", ja se aloittaa nyt alusta (`isFreshStart`).
- **Äänikerros:** äänikerros jättää vaihtoehtolistan ja luonnoksen "Toimitus:"- tai *Tilausluonnos*-rivistä loppuun sanasta sanaan, jottei malli yhdistä rivejä lauseiksi. Uusi vastausohje ("Vastaa 1, jos tämä käy.") hylätään, jos malli lisää sen kuittaukseen; niin kävi livekokeessa. Unchanged-reply saa lisävaihtoehtojen todellisen numeron, ei aina 4:ää.
- **Tarkistukset:** uusi `test/whatsapp-saturday-layout.test.mjs` 7/7. Vanhojen testien tekstiodotukset päivitetty, `delivery-lead-note.test.mjs` poistettu. `npm test` 547/547 sessio E:n 0886ce6:n päällä, ja CI:n kaltainen kopio ilman katalogia ja fontteja 459 läpi, 88 ohitettu, 0 virhettä. `aimo:eval` 26/26, `aimo:eval:spoken` 58/58.
- **Oikea Haiku omilla kannoilla:** Eeliksen keskustelu kello 18.11. 9.37 → "Lanttulaatikko 500 kiloa lauantaille 21.11. sopii hyvin, koska bileet ovat vasta keskiviikkona 25.11." ja "Toimitus: la 21.11."; valinta → luonnos pohjan mukaan. "6 strutsinmunaa ja 20 l maitoa perjantaiks, juhlat on lauantaina" → toimitus pe 20.11. ja "Strutsinmunille ei valitettavasti löytynyt osumaa." Ajossa simuloidut hinnat, ei Metaa, ei tilauksia.
- **Käyttöönotto kesken:** tarvitsee botin julkaisun (sessio E, Eeliksen luvalla).

## 18.11.2026 — valmisruoan tilalle vain sama ruoka: lanttulaatikon tilalle ei enää maksalaatikkoa (Claude Code, sessio E)

- **Eeliksen pyyntö:** "lue mitä botti vastas viimeseen viestiin" ja sen jälkeen "Kyllä, korjaa" kolmeen keskustelussa näkyneeseen ongelmaan. Tämä merkintä koskee yhtä niistä: tilaukseen "lanttulaatikko 500 kg, ke 25.11." botti vastasi "Tarkkaa osumaa ei löytynyt: lanttulaatikko. Lähimmät tilattavat vaihtoehdot:" ja tarjosi Saarioisen maksalaatikkoa ja Feelian nakki-perunasoselaatikkoa.
- **Syy:** tuotannon hintavälimuistin kopiolla toistettu. Saarioisen lanttulaatikko 2,8 kg on päivälle loppu (`out`), ja muista lanttulaatikoista ei ole tietoa. Korvaajahaku (`server/substitutes.mjs`) piti kaikkia "-laatikko"-ruokia samana tuotteena, koska yhdyssanojen vertailu (`compoundSim`) hyväksyi yhteisen osan "laatikko". Siksi maksalaatikko ja nakki-perunasoselaatikko näkyivät lähimpinä vaihtoehtoina.
- **Muutos:** uudet `dishesOf` ja `sameDish`. Kun tuote on valmisruoka (laatikko, keitto, kastike, kiusaus, vuoka, pata, muhennos, piirakka, pihvi, pyörykkä, kääryle), korvaajan pitää olla sama ruoka: sama yhdyssanan alkuosa, toinen valmistaja tai koko. Lihakaalilaatikko ja kaalilaatikko ovat sama ruoka. Sääntö pätee myös väljässä haussa (sama tuoteryhmä), ja se pätee toiseenkin suuntaan: perunan tilalle ei tarjota perunalaatikkoa. Valion tuotedatassa korvaajaksi merkitty tuote kelpaa yhä. Raaka-aineisiin ja muihin tuotteisiin sääntö ei vaikuta.
- **Tulos samalla välimuistin kopiolla:** "lanttulaatikko 500 kg, ke 25.11." → "Ei tilattavaa tuotetta päivälle ke 25.11.: lanttulaatikko." Sama porkkanalaatikolle, jolle tarjottiin ennen liha-perunasoselaatikkoa, perunasosetta ja lihakaalilaatikkoa. Maksalaatikko, kaalilaatikko ja peruna löytyvät kuten ennen.
- **Tarkistukset:** uusi `test/dish-substitutes.test.mjs` 2/2, ja molemmat kaatuvat edellisellä koodilla. `npm test` 542/542, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58 ja tuoteajo 611 vaihtoehtoa ilman tarjouksen kaatumista. Ei mallikutsuja, ei Metaa eikä tilauksia.
- **Ei muutettu:**
  - Saatavuuden puuttuessa (`unknown`) mallipohjainen valitsija (`order-tools/nearby.mjs`) valitsee yhä saman roolin tuotteita, ja se voi ehdottaa toista laatikkoruokaa. Viesti sanoo silloin, ettei pyydetylle tuotteelle ole tietoa.
  - Ääniviestin päiväsekaannus ("bileet viikon päästä keskiviikkona") on pääsession työpuussa (`fix-saturday`) korjauksessa.
  - Muutosvihjeen "poista lanttulaatikko" korjaus on pyydetty samalta sessiolta, koska se muokkaa samaa `changeHint`-funktiota.
- **Käyttöönotto:** botin Vercel-julkaisu Eeliksen luvalla (sessio E).

## 18.11.2026 — apurille minä-persoona: puhuu kuin mukava ihminen, mutta kertoo olevansa digitaalinen apuri (Claude Code)

- **Eeliksen pyyntö:** "voidaanko kans antaa tälle apurille minä-persoona? eli hän sanois just että joo toimin! ja puhuis itsestään niin kuin minuna eli minä olen tai jotain vastaavaa ja leikkis olevansa mukava ja kiva ihminen".
- **Päätös:** persoona koskee sävyä. Apuri puhuu minä-muodossa, lämpimästi ja iloisesti ("Mä autan mielelläni", "Kirjasin perjantaiksi…"), mutta ei väitä olevansa ihminen eikä keksi itselleen nimeä, ikää, makuja tai kokemuksia. Kysyttäessä se kertoo olevansa Valio Aimon digitaalinen tilausapuri. Syy: EU:n tekoälysäädöksen avoimuusvelvoite (artikla 50, voimassa 2.8.2026 alkaen) edellyttää, että ihminen tietää keskustelevansa tekoälyn kanssa, ja vanha itsepelitarkistus `bot_not_disclosed` vaatii samaa. Uutta nimeä ei annettu.
- **Muutokset:**
  - Uusi `server/whatsapp/persona.mjs`: yhteinen persoonaohje `PERSONA` dialogin, tuoteneuvon, korikuittauksen (`cart-presentation.mjs`), listaa muuttamattoman viestin vastauksen (`unchanged-reply.mjs`, josta poistettiin sana "ihminen") ja äänikerroksen (`voice.mjs`) ohjeisiin. Äänikerros kirjoittaa apurin omat sanat minä-muodossa ("Laitoin listalle: maito 10 l.").
  - `withBotDisclosure`: kun asiakas kysyy, onko vastaaja botti, tekoäly tai ihminen ("ootko botti?", "puhunko oikean ihmisen kanssa", "kuka sä oot", "are you a bot"), tai tervehtii ensimmäistä kertaa, koodi varmistaa, että vastaus kertoo apurin olevan digitaalinen. Jos malli unohti, perään tulee lyhyt esittely asiakkaan rekisterissä. Äänikerroksen uudelleenkirjoitus hylätään (`voice_fallback` syy `disclosure`), jos se pudottaa tämän tiedon.
  - Ensimmäinen tervehdys (`dialogue.mjs`, ei aiempaa keskustelua): apuri esittäytyy, esim. "No moikka! Mä oon Valio Aimon digitaalinen tilausapuri. Tilataanko jotain?". Myöhemmät tervehdykset ennallaan.
  - Kiinteät esittelyt: "Olen Valio Aimon digitaalinen tilausapuri." (`order-conversation/index.mjs`) ja tuki-vastaus (`channel.mjs`).
- **Tarkistukset:** uusi `test/whatsapp-persona.test.mjs` 6/6. Neljän testin tekstiodotukset päivitetty esittelyyn. `npm test` 540/540, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58. Oikea Haiku eristetyillä kannoilla, simuloiduilla hinnoilla, ilman Metaa ja tilauksia, 7 keskustelua ja 41 mallikutsua, 0 virhettä: "ootko botti vai ihminen?" → "Joo, oon botti eli Valio Aimon digitaalinen tilausapuri, en ihminen. Mut autan mielellään tilauksessa.", "onks sulla lempiruokaa?" → "Hah, mulla ei oo lempiruokaa, koska oon digitaalinen tilausapuri enkä syö mitään.", "kiitti, oot kyl tosi kiva!" → "Kiva kuulla, kiitos! Mä autan mielelläni." Ensimmäisessä ajossa malli lupasi ihmistä kysyttäessä "sanon siitä vielä erikseen", joten ohjeeseen lisättiin, että asiakaspalvelun ihmiset auttavat. Uusinnassa lupausta ei tullut.
- **Huomio:** kirjakielinen ensimmäinen tervehdys sai kerran "en ihminen" esittelyyn, vaikka ohje sanoo ilman. Ei haitallista.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin mainista af7d1bd klo 9.55, deployment aimo-whatsapp-10ra6iikz. Persoonan jälkeen mainiin oli tullut vain työlokimuutos. Workeria ei julkaistu.
- **Livetarkistus** sivuston Keskustele-chatissa testiasiakkaalla, ei tilausta: "ootko botti vai ihminen?" → "Oon Valio Aimon digitaalinen tilausapuri, en ihminen. Autan mielelläni tilaamisessa, joten tilataanko jotain?". Uudessa keskustelussa "moro" → "No moikka! Mä oon Valio Aimon digitaalinen tilausapuri, eli en oo ihminen mutta autan sua tilaamaan keittiöön tarvittavat tuotteet. Tilataanko jotain?".
- **Keskustele-sivun aloituskupla:** Eelis hyväksyi ("Kyllä, lisää") sanan lisäämisen ja Workerin julkaisun. `deploy/cloudflare/public/keskustele.js` sanoo nyt "Moi! Olen Valio Aimon digitaalinen tilausapuri. …". Worker-testit 58/58. Sessio E julkaisi Workerin 49cc0ae:sta, versio 4ac9dd6d-cdc7-4e1a-a2dc-9d5807435344 (vain keskustele.js muuttui).
- **Livetarkistus 11.37 uuden ulkoasun kanssa** (botti aimo-whatsapp-ndmzin5zu, 5a23c04 ja c2c007b), testiasiakas, ei tilausta: aloituskupla sanoo "digitaalinen tilausapuri", "moi" → "Päivää! Joo, mä oon Valio Aimon digitaalinen tilausapuri, eli botti. Tilataanko jotain?" ja tilaukseen "Laitoin listalle: maito 20 l ja voi 5 kg." ja "Mä katson sulle vaihtoehdot, tässä tulee." ennen uuden ulkoasun vaihtoehtolistaa. Kömpelö kohta, ei korjattu: tervehdyksen perään tuli "Joo,".

## 18.11.2026 — murresana räätikäsloora on lanttulaatikko (Claude Code)

- **Eeliksen pyyntö:** "voitko kans opettaa sille mitä tarkottaa räätikäsloora".
- **Syy:** sana puuttui synonyymitaulusta. Sääntötulkki pilkkoi sen ja haki loppuosalla "loor", jolloin kärkeen tuli lattiakuivain ja lattiaharjoja.
- **Muutos (`server/aimo/synonyms.mjs`):** Lounais-Suomen murteessa räätikkä on lanttu ja loora laatikko (ruotsin låda). Nyt räätikäsloora, räätikkäloora, räätikkälaatikko ja niiden kirjoitusasut tarkoittavat lanttulaatikkoa, ja räätikkä tarkoittaa lanttua. Sama taulu antaa sanat myös WhatsAppin mallitulkille vihjeinä (`slangOf`).
- **Tarkistukset:** uusi testi `test/haiku-findings-a.test.mjs`:ssä ja neljä uutta hakua `aimo:eval:spoken`:ssa (58/58). `aimo:eval` 26/26, `npm test` 534/534 (työpuussa oli samalla toisen session keskeneräisiä muutoksia, joita ei ole tässä commitissa). Säännöillä "5 kg räätikäslooraa" ja "räätikkälooraa 4 kg" tuovat Saarioisen ja Feelian lanttulaatikot, ja "5 kg räätikkää" tuo lantut. Oikea Haiku kolmella viestillä (ei tilausta, ei Metaa): "5 kg räätikäslooraa sunnuntaiks" → lanttulaatikko 5 kg su 22.11., ja laktoositon toive ja "3 kg räätikkää" luettiin oikein.
- **Ei korjattu:** lanttulaatikon haku näyttää vain 4 tuotetta (ryhmä 17300). Pakasteet ja Valion laktoositon kypsä lanttulaatikko (471247) eivät tule mukaan, ja niin on myös suoralla haulla "lanttulaatikko". Puhekielen translatiivi "räätikäslooraks" ei tunnistu.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin mainin kärjestä af7d1bd klo 9.55 (aimo-whatsapp-10ra6iikz). Mukana myös 3a21fa4 (minä-persoona), jonka julkaisun Eelis valitsi E:n sessiossa.
- **Varmennettu livenä:** sivuston Keskustele-chatissa testiasiakkaalla, ilman tilausta. "5 kg räätikäslooraa sunnuntaiks" → "Laitoin listalle: lanttulaatikko 5 kg." ja toimitus su 22.11. Lopuksi "aloita alusta".
- **Havainto, ei korjattu:** sunnuntaille ei löytynyt yhtään lanttulaatikkoa, jolla on Valion oikea hinta ja saatavuus. Botti sanoi "Tarkkaa osumaa ei löytynyt lanttulaatikolle" ja tarjosi lähimpinä Saarioisen maksalaatikkoa ja Feelian nakki-perunasoselaatikkoa. Syy on hintatiedon puute, ei sana.

## 18.11.2026 — maksusivun odotus pois: tilaus maksusivulle ennen korisivun vastausta (Claude Code)

- **Eeliksen pyyntö:** "nopeuta myös maksusivun odotus".
- **Syy:** maksusivu löytää tilauksen vasta, kun botti on välittänyt sen Workerille (`/api/order-events`, joka luo demomaksun). Pilvi teki välityksen vasta korisivun vastauksen jälkeen (waitUntil), ja silloinkin vasta tilausnäkymän tilannekuvan (`/api/sync`) jälkeen. Maksusivu kysyi 1,5 s välein ja näytti sillä aikaa tekstin "Odotetaan tilauksen siirtymistä maksusivulle…".
- **Muutokset:**
  - `server/whatsapp/checkout.mjs` (`onCheckout`), `runtime.mjs` ja `cloud.mjs`: pilvessä vahvistettu tilaus välitetään Workerille ennen korisivun vastausta, joten maksusivu löytää sen yleensä heti ensimmäisellä haulla. Odotus on rajattu 6 sekuntiin. Virhe tai hitaus ei estä tilausta, koska tavallinen julkaisu vastauksen jälkeen ja minuutin ajastin välittävät tilauksen joka tapauksessa. Macin paikallinen palvelin toimii ennallaan.
  - `cloud.mjs` (`pushEvents`, `publishOrders`): tilaustapahtumat lähetetään ennen tilannekuvaa ja agentin jälkiä.
  - `deploy/cloudflare/public/demo-payment.js`: jos tilaus on vielä matkalla, maksusivu kysyy 0,3 s:n välein ja harventaa enintään 1 s:iin. Kokonaisodotus on noin 12 s (ennen 8 × 1,5 s).
- **Tarkistukset:** `test/whatsapp-cart-pay-speed.test.mjs` 7/7. Kaksi uutta testiä (välitys ennen vastausta aikarajoineen ja virheineen, tapahtumat ennen tilannekuvaa) kaatuvat edellisellä commitilla. `npm test` 533/533, Worker 58/58, Workerin `typecheck` läpi. Selaimessa maksusivun eristetty kopio valerajapinnalla: tilaus "saapui" 0,8 s avaamisen jälkeen, ja sivu näytti sen 0,97 s kohdalla (ennen vähintään 1,5 s). Oikeaa tuotannon tilausta ei tehty.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, molemmat"), ja sessio E julkaisi dbfa118:sta molemmat: botti klo 9.42 (deployment aimo-whatsapp-27v6dkkgc) ja Worker versio f5a0ce8e-3b32-4b6d-a85d-c84a772a6ea3. Tämä oli ensimmäinen Worker-julkaisu tästä reposta: vaihtuivat vain `demo-payment.js` ja `kori/shop.css`, bindingit ja salaisuudet säilyivät. Tästä sessiosta tarkistettu livenä: Workerin `demo-payment.js` ja `kori/shop.css` ovat tavulleen samat kuin repossa, `/`, `/demo-payment`, `/tilaukset` ja `/healthz` vastaavat 200, botin healthz `host: cloud` ja korisivun `shop.js` on sama kuin repossa. Eelis kokeili julkaisun jälkeen puhelimella koko polun ostoskorista maksusivulle: "kokeilin puhelimella, toimii nyt nopeesti".

## 18.11.2026 — ostoskorista maksusivulle nopeammin: painike pyörii, "yritä uudelleen" -painike pois (Claude Code)

- **Eeliksen pyyntö:** "kestää liian kauan tuolt ostoskorist siirtyy tonne maksusivul, se vois hetken pyörii sii lataukse merkiks ja ota siit se koita pyyntöä uudelleen nappi pois ja sit siirtyy tonne maksusivulle".
- **Syyt koodista:** SIIRRY MAKSAMAAN tekee kaksi palvelinpyyntöä peräkkäin (yhteenveto ja vahvistus), ja kummankin vastaus kirjoitettiin äänikerroksella (`voice.mjs`, Haiku, aikaraja 20 s ja yksi uusinta) uudelleen, vaikka yhteenvetoa ei näytetä ja tilaus jatkuu heti maksuun. Pilvi julkaisi tilaukset Workeriin jokaisen korin POST-pyynnön jälkeen, myös turhaan yhteenvedon jälkeen. Turso-kutsut pysäyttävät säikeen, joten julkaisu saattoi hidastaa saman instanssin vahvistusta. Odottaessa näkyi harmaa YRITÄ SAMAA PYYNTÖÄ UUDELLEEN -painike.
- **Muutokset:**
  - `public/whatsapp-storefront-cart.*`: SIIRRY MAKSAMAAN pyörii ("SIIRRYTÄÄN MAKSUUN", oma petrolin värinsä), kunnes maksusivu aukeaa. Uudelleenyrityspainike poistettu. Kadonnut vastaus (verkkokatko tai 5xx) uusitaan itse samalla viesti-id:llä kahdesti. Jos maksuun siirtyminen silti keskeytyy, SIIRRY MAKSAMAAN jatkaa samaa pyyntöä. Kesken jäänyt pyyntö jatkuu sivun latautuessa itsestään. Muutoskentän kadonnut muutos unohdetaan ja kori luetaan palvelimelta, mikä on turvallista luonnoksen versiotarkistuksen vuoksi. Maksulinkin moduuli latautuu jo painalluksesta, joten vahvistuksen jälkeen siirrytään heti.
  - `cart-link.mjs`, `ordering.mjs`, `dialogue.mjs`: korisivu lähettää maksupolun pyynnöissä `pay: true`, ja silloin äänikerros ohitetaan (`plain`). Muut korisivun ja WhatsAppin vastaukset kirjoitetaan edelleen äänikerroksella.
  - `server/cloud.mjs`: korin pyyntö käynnistää julkaisun Workeriin vain, kun tilaus syntyi (`res.orderPlaced`).
  - `deploy/cloudflare/public/kori/shop.css` generoitu uudelleen (`sync-cart-shell.mjs`). Workerin julkaisua ei tarvita, koska muutos koskee vain botin korisivua.
- **Tarkistukset:** uusi `test/whatsapp-cart-pay-speed.test.mjs` 5/5, ja kaikki viisi kaatuvat edellisellä commitilla. `npm test` 531/531, Worker 58/58. Selaimessa eristetty paikallinen korisivu valerajapinnalla (ei kantoja, malleja, Metaa eikä tilauksia): painike pyöri 1280 ja 375 px:n leveydellä ilman vaakaylivuotoa, uudelleenyrityspainiketta ei ollut, ja vahvistuksen jälkeen sivu siirtyi maksulinkkiin itse. Oikean tuotannon siirtymäaikaa ei mitattu, koska se vaatisi oikean demotilauksen.
- **Ei muutettu:** maksusivu odottaa edelleen enintään noin 10 s, että tilaus ehtii Workeriin (1,5 s välein). Sen nopeuttaminen vaatisi Workerin julkaisun.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"), ja sessio E julkaisi botin 490e559:stä klo 8.29, deployment aimo-whatsapp-f9o7sqja2. E:n tarkistukset ennen julkaisua: `npm test` 531/531, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54 ja tuoteajo 611 vaihtoehtoa. Julkaisun jälkeen healthz, verify ja tick 200. Tästä sessiosta tarkistettu livenä: `/whatsapp/cart/shop.js` on tavulleen sama kuin commitissa, korisivun HTML:ssä ei ole `wa-retry`-painiketta, `shop.css` sisältää spinnerin ja `/whatsapp/checkout.js` palauttaa 200. Workeria ei julkaistu. Oikeaa demotilausta ei tehty, joten siirtymäaikaa tuotannossa ei ole mitattu.

## 18.11.2026 — avauskysymys "Tilataanko jotain?" (Claude Code, kaaostestin jatko)

- **Eeliksen pyyntö:** "nyt se sanoo mitä tilattais? ni voisko se olla vaiks et Tilataanko jotain?"
- **Muutos:** tervehdyksen jatko, tervehdyksen varateksti ja yleinen varavastaus kysyvät nyt "Tilataanko jotain?" (`dialogue.mjs`), ja dialogin ja äänikerroksen ohjeet (`voice.mjs`) käyttävät samaa esimerkkiä. "Mitä tilattais?" jäi alusta aloituksen ja uuden tilauksen valinnan jälkeen, koska asiakas on silloin jo sanonut haluavansa tilata.
- **Tarkistukset:** `npm test` 526/526. Oikea Haiku eristetyillä kannoilla: "moi" → "Päivää! Tilataanko jotain?", "joo" → "Joo, mitä tilataan?", "morjes" → "Morjes! Tilataanko jotain?".
- **Käyttöönotto:** sessio E julkaisee yhdessä c3cdc37:n kanssa, Eeliksen luvalla.

## 18.11.2026 — toivottu päivä on perillä-päivä, ja ei-ruokalinkkiin naurahdus (Claude Code, kaaostestin jatko)

- **Eeliksen pyynnöt:** "jos halutaa perjantaiks ni sit tä sanoo et en tiedä valion tarkkoja toimitusaikoja, mutta koitetaanko vaikka keskiviikkona … toimitukse pitäs saapua perjantaille", tarkennuksena "koskee iha kaikkee". Lisäksi: Wikipedian hevosartikkeliin botin pitäisi osata naurahtaa.
- **Toimituspäivä (`order-conversation/index.mjs`, `leadTimeNote`):** kun vaihtoehdot näytetään ensimmäisen kerran, listan alle tulee esimerkiksi "Tuotteiden pitää siis olla perillä perjantaina 20.11. En tiedä Valion tarkkoja toimitusaikoja, ja ne voivat vaihdella. Varmuuden vuoksi voidaan kokeilla toimitusta jo keskiviikkona 18.11.: kirjoita silloin "keskiviikoksi"."
  - Koskee kaikkia päiviä, myös kiireellisiä. Tämän päivän toimitukseen huomiota ei tule.
  - Ehdotus on kaksi arkipäivää aiemmin, tai yksi, jos kaksi ei ehdi. Viikonloppu ohitetaan. Huomista ei ehdoteta, koska sen tilausaika on usein jo mennyt. Jos sopivaa päivää ei ole, tulee vain huomio.
  - Huomio näytetään kerran tilausta kohden (`draft.leadNoted`), jotta ehdotetun päivän valinta ei tuo taas uutta, aiempaa ehdotusta.
- **Ei-ruokalinkki (`whatsapp/link-advice.mjs`):** sivu ilman reseptiä tai tuotetta sai ennen koodin kuivan tekstin ("Sivu aukesi … En löytänyt siitä luotettavasti poimittavaa reseptiä"), joten syy ei ollut Haiku. Lukumalli antaa nyt `reaction`-kentässä yhden leikkisän virkkeen sivun aiheesta. Lupaukset ja linkit pudotetaan (`safeModelText`), ja silloin käytetään vanhaa tekstiä. Perään "Sivulla ei ole reseptiä eikä tilattavaa tuotetta. Lähetä reseptilinkki tai kerro, mitä tilattais."
- **Tarkistukset:** uusi `test/delivery-lead-note.test.mjs` 3/3 ja linkkitestiin naurahdus sekä linkin sisältävän reaktion hylkäys. Viiden testin tekstiodotukset päivitetty uuteen huomioon. `npm test` 526/526, CI:tä vastaava kopio ilman `data/`:aa ja fontteja 440 läpi, 86 ohitettu, 0 virhettä. `aimo:eval` 26/26, `aimo:eval:spoken` 54/54.
- **Oikea Haiku, eristetyt kannat, simuloidut hinnat, ei Metaa eikä tilauksia:** "10 litraa maitoo maanantaiks" → "tavallinen käy" → huomio "perillä maanantaina 23.11. … voidaan kokeilla toimitusta jo torstaina 19.11.", eikä huomiota toistettu päivän vaihdon jälkeen. Oikea fi.wikipedia.org/wiki/Hevonen → "Hevonen on kyllä upea otus, mutta ostoskoriin se ei valitettavasti mahdu, joten jatketaan voin parissa."
- **Huomio:** äänikerros kirjoitti kerran vastaussanan isoin kirjaimin ("Kirjoita silloin TORSTAIKSI."). Päivän tulkinta ei riipu kirjainkoosta, joten sitä ei korjattu.
- **Käyttöönotto kesken:** botin julkaisu (sessio E, Eeliksen luvalla).

## 18.11.2026 — avaus kysyy "Mitä tilattais?" eikä puhu keittiöstä (Claude Code, sessio E)

- **Eeliksen pyyntö:** "tee kans toi alku jotenki sillee et jos sii on et mitä keittiöön tarvitaan ni siin ois et mitä tilattais … unohettais toi keittiö".
- **Muutos:** koodin omat tekstit ja varatekstit kysyvät nyt "Mitä tilattais?" tai "mitä tilataan" eivätkä mainitse keittiötä:
  - `dialogue.mjs`: tervehdys, alusta aloitus, uusi tilaus, nykyisellä listalla jatkaminen ja kiitoksen jälkeinen vastaus.
  - `model-guard.mjs`: `GUARD_FALLBACK`.
  - Dialogin ohje, tervehdyksen tehtäväohje ja äänikerroksen ohje (`voice.mjs`) neuvovat mallia kysymään "Mitä tilattais?" eikä "Mitä keittiöön tarvitaan?".
  - Asiakkaan oma "keittiöön" ymmärretään edelleen (sanalista ennallaan).
- **Tarkistukset:** `test/whatsapp-stale-cart.test.mjs` päivitetty uuteen tekstiin. `npm test` 523/523, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54, `guardModelText` hyväksyy uudet tekstit.
- **Käyttöönotto:** botin Vercel-julkaisu session E kautta Eeliksen luvalla. Worker-julkaisua ei tarvita.

## 18.11.2026 — äänikerros: viestit ja virkkeet alkavat aina isolla kirjaimella (Claude Code)

- **Eeliksen havainto ja pyyntö:** livekokeessa klo 0.42 ensimmäinen vastaus alkoi pienellä ("mikä meno? Kerro vaan, mitä keittiöön tarvitaan."), seuraava isolla. "Voisko tää vastaa isoin alkukirjaimin … ettei tä nyt ainakaa tällee vaihtelis? Korjaa." Malli peilasi pienillä kirjaimilla kirjoittavaa asiakasta, koska ohjeessa luki "lyhyesti pienillä kirjaimilla kirjoittavalle lyhyesti ja rennosti".
- **Muutos** (`voice.mjs`): uusi `sentenceCase` suurentaa jokaisen pätkän, rivin ja virkkeen (`.`, `!`, `?`) ensimmäisen kirjaimen. Lyhenteen (esim., klo, pe …) tai päiväyksen ja luvun (20.11., 12.00) jälkeen kirjainta ei suurenneta. Vastaussanat (`*ok*`), listat ja otsikot eivät muutu. Ohjeesta poistettiin "pienillä kirjaimilla", ja tilalle tuli sääntö: tavalliset isot alkukirjaimet ja välimerkit aina, tyyli peilataan sanoissa eikä kirjoitusasussa.
- **E:n lokitarkistus kokeen jälkeen** (a68ea71, klo 0.41.49–0.42.09): kolme viestiä niputettiin yhdeksi vuoroksi (`messages_gathered` count 3), vastauksia lähti 2, ja yksi uudelleenkirjoitus hylättiin syyllä `product-missing`, jolloin asiakas sai alkuperäisen tekstin. Virheitä tai varoituksia ei ollut. Hylätty vastaus toistettiin kuudesti oikealla Haikulla kolmella eri asiakasviestillä, ja tuotteet säilyivät joka kerta. Syy ei siis selvinnyt. Mahdollinen syy: malli kirjoitti "munia", ja tarkistus vertaa termin "kananmuna" viittä ensimmäistä kirjainta.
- **Tarkistukset:** `test/whatsapp-voice.test.mjs` 13/13 (myös ilman katalogia), `npm test` 523/523, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54.
- **Käyttöönotto:** botin Vercel-julkaisu session E kautta Eeliksen luvalla. Worker-julkaisua ei tarvita.

## 18.11.2026 — äänikerros: tuotehylkäyksen kaksi syytä lokiin (Claude Code)

- **Eeliksen pyyntö:** "Erottele syyt". E:n lokitarkistuksessa (0144838, viimeiset 30 min ennen 060c115:n julkaisua klo 0.21) oli kaksi `voice_fallback`-riviä, molemmat `reason: "product"`. Syy ei kertonut, kumpi tarkistus osui.
- **Muutos** (`voice.mjs`, `voiceProblem`): `product-missing` = pätkän tuote katosi uudesta tekstistä, `product-added` = uuteen tekstiin tuli korin tuote, jota pätkässä ei ollut. Ensimmäinen on mallin virhe. Jälkimmäinen voi olla myös liian tiukka tarkistus (vartalovertailu, vähintään 4 kirjainta). Hylkäys toimii kuten ennenkin: asiakas saa alkuperäisen tekstin.
- **Tarkistukset:** `test/whatsapp-voice.test.mjs` 12/12 (myös ilman katalogia), `npm test` 522/522, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54.
- **Seuraavaksi:** julkaisun jälkeen Vercelin lokista näkee, kumpi syy toistuu. Jos `product-added` on yleisin, tarkistusta kannattaa löysätä.
- **Käyttöönotto:** botin Vercel-julkaisu session E kautta Eeliksen luvalla. Worker-julkaisua ei tarvita.

## 17.11.2026 — äänikerros: lihavoitu otsikko lukitaan listansa osaksi (Claude Code)

- **Eeliksen pyyntö:** "Korjaa se". Livetarkistuksessa (0144838:n sessio) malli kirjoitti vaihtoehtolistan otsikon eteen "Vastaa *Maito 30 l:*", koska otsikko oli pätkän sisällä vastaussanan tapaan lukittu sana ja malli sai kirjoittaa sen ympärille mitä tahansa.
- **Muutos** (`voice.mjs`, `LOCKED_LINE`): lihavoinnilla alkava rivi on lukittu rivi ja kuuluu listaansa. Rivejä on kolmenlaisia: vaihtoehtojen `*Maito 30 l:*`, yhteenvedon `*Tilausluonnos*, toimitus …` ja tuotetietojen `*Tuote* (tuotenro …): …`. Lauseen sisäiset vastaussanat (`*ok*`, `*TILAA*`) ovat edelleen merkkejä pätkässä.
- **Tarkistukset:** `test/whatsapp-voice.test.mjs` 12/12 (myös ilman katalogia), `npm test` 522/522, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54. Oikea Haiku: vaihtoehtolista ja yhteenveto kahdesti kumpikin. Otsikko pysyi listan yläpuolella eikä sen eteen tullut ohjetta.
- **Käyttöönotto:** botin Vercel-julkaisu session E kautta Eeliksen luvalla. Worker-julkaisua ei tarvita.

## 17.11.2026 — WhatsApp-kokeen loput löydökset korjattu (Claude Code)

- **Eeliksen pyyntö:** "korjaa kaikki" (raportin `docs/evaluations/whatsapp-chaos-20261117.md` avoimet löydökset).
- **Muutokset:**
  - Laatikon paino nimestä, kun nimen kappalemäärä on laatikon kappalemäärä (`catalog.mjs`, `boxSize`). 500 kg voita on nyt 25 laatikkoa à 20 kg eikä "à 0,08 kg, yhteensä 2 kg, 3 635 €".
  - Suklaa haetaan leivonta- ja levysuklaan hyllyltä, ja kiloina pyydetylle tuotteelle ei tarjota saman nimisen maun juomaa. Pelkkä "jauhot" on vehnäjauhoa (`synonyms.mjs`, `order-tools`).
  - Suosituimmat: asiakkaidemme vahvistetut tilaukset (tuote kerran tilausta kohden, `popularityCounts`, minuutin välimuisti). Vähintään kahdessa tilauksessa ollut nousee ensimmäiselle sivulle merkinnällä "suosituin", ja "mikä on suosituin?" saa vastauksen. Valion aineistossa ei ole suosittuustietoa, joten muuta lähdettä ei ole.
  - "Sama ku viimeks mut tuplana" (myös x3, puolet) kertoo määrät. Mahdoton päivämäärä ("31.2.") kerrotaan. Hyvin iso määrä (vähintään 1 000 kg tai l) varmistetaan kerran. "Unohda kaikki" ja linkki samassa viestissä nollaa ensin.
  - Malli ei lupaa kysyä asiakaspalvelulta tai "voidaan yrittää", vastaa asiakkaan kielellä, sanoo allergiarajauksen huomioituvan eikä kiistä allergeenitietoja, ja käsittelee hyökkäysviestin oikean tilausosan (`dialogue.mjs`, `model-guard.mjs`).
  - Toistonesto koskee nyt myös tarkennuskysymyksiä. Vertailukysymys ennen vaihtoehtoja saa vastauksen "Kerron sen heti, kun näytän vaihtoehdot", ja lupaavat virkkeet pudotetaan myös mallin omasta vastauksesta (`unchanged-reply.mjs`).
- **Tarkistukset:** uusi `test/whatsapp-chaos-fixes-2.test.mjs` 8/8, odotukset päivitetty (jauho → vehnäjauho). `npm test` 520/520 22474c9:n päällä (ad3c71e:n tyylikerros mukana), CI-kopio ilman katalogia ja kirjasimia 0 virhettä, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54. Oikea Haiku koko ketjussa (omat kannat, simuloidut hinnat, ei Metaa, ei tilauksia): kaikki yllä olevat tapaukset kokeiltu, tulokset raportissa.
- **Ei vielä tehty:** puhelimen ääniviestillä ei ole kokeiltu ääkkösiä. Suosituimmat näkyvät vasta, kun samaa tuotetta on vähintään kahdessa vahvistetussa tilauksessa.
- **Käyttöönotto:** botin Vercel-julkaisu session E kautta Eeliksen luvalla. Worker-julkaisua ei tarvita.

## 17.11.2026 — vastaukset lähettäjän tyyliin, viestien niputus ja toinen lukukerta (Claude Code)

- **Eeliksen pyyntö:** botti ei saa olla jäykkä. Vakiotekstit ("Luonnoksessa nyt:", "Mille päivälle toimitus? Haen sen jälkeen …") kulkevat kielimallin läpi ja mukautuvat lähettäjän tyyliin. Lisäksi ihmismäinen rytmi: lyhyet viestit, pieni viive ja lähekkäin tulleiden viestien niputus. Tulkki ja vastausten kirjoittaja ovat molemmat Haiku. Lähettäjää ei pidä "hylätä": epäselvä viesti luetaan mieluummin toiseen kertaan. Vertailukohtana DM Champin myyntibotin luonteva keskustelu.
- **Äänikerros** (`server/whatsapp/voice.mjs`, kutsu `whatsapp_voice`, tier fast): dialogin valmis vastaus kirjoitetaan uudelleen juuri ennen tallennusta ja lähetystä. Malli kirjoittaa vain tekstinpätkät listojen välissä. Listarivit (`- `, `1)`), hintarivit (€) ja `Asiakaspalvelu:`-rivi pysyvät koodin omina paikoillaan, ja vastaussanat (`*ok*`, `*TILAA*`) ja tilausnumerot korvataan merkeillä. Tervehdys tulee aina koodista (`greetingFor`), ja mallin oma tervehdys poistetaan. Uusi teksti hylätään, ja alkuperäinen lähtee, jos pätkien määrä muuttuu, merkki puuttuu tai vaihtuu, mukana on uusi luku, linkki tai väite (`claimsIn`, uusi vienti `model-guard.mjs`:stä), lupaus (onnistuu, ehtii, saatavilla …), pudonnut kysymys, kielto tai korin tuote, tai teksti kasvaa liikaa. Linkkiviestejä ei kirjoiteta uudelleen. Historiaan tallentuu lähetetty teksti. Päätös: aiempi sanojen kieltolista olisi hylännyt luontevat lauseet, joten tarkistetaan faktat eikä sanoja. Kirjoittaja ei näe hintoja eikä listoja.
- **Niputus** (`channel.mjs`, `store.followers`/`absorb`): saman numeron tekstiviestit, jotka tulevat 3 s sisällä edellisestä (enintään 10 s ensimmäisestä), liitetään yhdeksi vuoroksi. Liitetyt viestit saavat tilan `merged`, ja yhdistetty teksti jää ensimmäisen viestin riville, joten uusintayritys käsittelee saman kokonaisuuden. Kuva, ääniviesti, yhdistämiskoodi ja "tuki" katkaisevat niputuksen. Vastauksen osien välinen tauko kasvaa pituuden mukaan (0,7–2,5 s, `humanPartPause`). Asetukset: `WHATSAPP_GATHER_MS` (oletus 3000, 0 = pois), `WHATSAPP_GATHER_MAX_MS` ja `WHATSAPP_VOICE=false` (vakiotekstit). Oletukset `createWhatsAppChannel`- ja `createOrderingDialogue`-kutsuissa pitävät vanhan käytöksen; tuotannon arvot asetetaan `runtime.mjs`:ssä ja `createConfiguredDialogue`:ssa.
- **Toinen lukukerta** (`interpret.mjs`, `reread: true` vain `runtime.mjs`:ssä): jos tulkki ei löydä viestistä mitään (intent other, ei muutoksia, ei päivää) eikä viesti ole pelkkä tervehdys tai kuittaus, Haiku lukee viestin uudelleen ohjeella puhekielestä, murteesta, emojeista ja vastauksista edelliseen kysymykseen (`whatsapp_order_reread`). Mallikutsun virhe yritetään kerran uudelleen ennen sääntötulkkia.
- **Koe oikealla Haikulla** (vain äänikerros, ei kantoja eikä Valion rajapintaa, 10 tyypillistä vastausta): ensimmäinen versio, jossa malli kirjoitti koko viestin merkkeineen, pudotti listoja ja vaihtoi `*ok*`:n sanaan "kyllä", ja tarkistukset palauttivat 5/8 alkuperäiseen. Pätkämallilla 10/10 meni läpi, ja viive oli 1,2–2,9 s vastausta kohden. Esim. "moro tarviin 20l maitoo ja voita" → "okei, luonnoksessa nyt tällänen:" + lista + "Mille päivälle toimitus olis hyvä? … Paljonko voita tarvitset?".
- **Tarkistukset:** uusi `test/whatsapp-voice.test.mjs` 10/10 (myös ilman katalogia). `npm test` 512/512, Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54.
- **Keskeneräistä:** tyylin mukautus on maltillinen. Haiku muotoilee rennommin, mutta kaikkia kirjakielisiä lauseita se ei kirjoita puhekielelle. Englanniksi kirjoittavalle vastaus jää suomeksi. Tuotenimen taivutus voi muuttua ("Valion kuohukerma 35 % 1 l:lla"). Seuraava askel olisi koe oikealla WhatsAppilla tai selainkeskustelulla ja `voice_fallback`-lokirivien seuranta pilvessä. Julkaisu session E kautta Eeliksen luvalla; Worker-julkaisua ei tarvita.

## 17.11.2026 — hankalien asiakkaiden WhatsApp-koe ja sen avoimet löydökset tähän repoon (Claude Code)

- **Eeliksen pyyntö:** illan koe ("koita saada se solmuun", 13 hankalaa asiakasta Eeliksen WhatsAppissa klo 20.27–21.07) ja sen korjaukset. Raportti ja avoimet löydökset ovat tässä repossa. Raportti: `docs/evaluations/whatsapp-chaos-20261117.md`.
- **Jo tässä repossa ja tuotannossa:** vastaus viestiin, joka ei muuta vaihtoehtolistaa, eikä saman listan toistoa (`server/whatsapp/unchanged-reply.mjs`); mallin ilmoittama valinta tehdään; "ei laktoosittomia" ja "laktoosillinen" eivät muutu laktoosittomuusvaatimukseksi; ihmismäisemmät kuittaukset; ääniviestien ääkköset ja Whisperin kehotteen toiston esto (`server/whatsapp/transcribe.mjs`). Livekoe julkaisun jälkeen Keskustele-sivulla: valitus ja vertailukysymys saivat ihmismäisen vastauksen ilman listan toistoa. Ääkkösiä ei ole kokeiltu oikealla puhelimen ääniviestillä.
- **Avoimet löydökset, tärkein ensin:** voi 4x5 kg näkyy "à 0,08 kg, yhteensä 2 kg, 3 635 €" (katalogin pakkauskoko), pähkinättömälle suklaalle ainoa vaihtoehto suklaakaurajuoma, lohifileepyyntö ei muuta listaa, malli lupaa kysyä asiakaspalvelulta, suosituimmat tuotteet (Valion aineistossa ei suosittuustietoa; vaihtoehto on omien asiakkaiden vahvistetut tilaukset, vaatii Eeliksen päätöksen), "jauhoja" leivontaan → ruis/ohra ensin, "tuplana" ohitetaan, "unohda kaikki" + linkki ei nollaa, suuria määriä ei kyseenalaisteta, "31.2." ohitetaan hiljaa, englanninkieliselle vastataan suomeksi. Puuttuvan tuotteen korvaajat paranivat jo f1b1667:ssä.
- **Tarkistukset:** pelkkä dokumenttimuutos, ei testejä. Varmistettu, että mainitut tiedostot ja testit ovat tämän repon mainissa.

## 17.11.2026 — äänikerros säilyttää puuttuvan tuotteen syyn eikä lisää tuotteita ohjeeseen (Claude Code)

- **Eeliksen pyyntö** ("Kyllä, korjaa"): korjaa livetarkistuksessa löytyneet kaksi äänikerroksen virhettä. Äänikerroksen tekijäsessio hyväksyi muutoksen `server/whatsapp/voice.mjs`:ään ja ehdotti, ettei lyhyitä tuotesanoja ("voi" osuu sanaan "voit") tarkisteta ja että syy tarkistetaan sanan vakaasta osasta.
- **Muutos (`voiceProblem`):**
  - Jos alkuperäinen pätkä mainitsee Valion testirajapinnan, uudenkin pitää mainita se. Uudessa ei saa olla muotoilua "ei löydy meiltä" tai "ei ole valikoimassa", koska syy on supistetut tiedot eikä puuttuva tuote ('reason').
  - Pätkään ei saa lisätä tilauksen tuotetta, jota alkuperäinen ei maininnut ('product'). Tarkistus koskee vähintään 4 kirjaimen vartaloita.
  - Hylätty uudelleenkirjoitus lähettää alkuperäisen tekstin kuten ennen. Ohjeeseen (`VOICE_SYSTEM`) lisätty sama syysääntö.
- **Tarkistukset:** `test/whatsapp-voice.test.mjs` 11/11 (uusi testi: banaanin syy, "ei löydy meiltä", sipulin ohje, taivutettu syy kelpaa, "voit" ei hylkää). `npm test` 521/521, `aimo:eval` 26/26, `aimo:eval:spoken` 54/54.
- **Oikea Haiku:** äänikerros yksinään, ei kantoja eikä Valion rajapintaa. Ennen viimeistä kieltoa 16 kokeilua, joista yhdessä jäi "banaaneja ei nyt löydy meiltä". Kiellon jälkeen 12 kokeilua: kaikki kirjoitettiin uudelleen, syy säilyi kaikissa banaanin ja juuston vastauksissa, eikä sipulin ohjeeseen tullut uutta tuotetta.
- **Huomio, ei korjattu:** yhdessä kokeilussa malli kirjoitti "Vastaa" listan otsikon *Maito 30 l:* eteen. Livenä juuston otsikko *Juusto 3 kg:* siirtyi selitysrivin loppuun. Sama syy: otsikko on pätkän sisällä token. Kerrottu äänikerroksen tekijälle.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin klo 23.50 (aimo-whatsapp-ed9jzvm30, koodi 0144838). Varmennettu livenä viidellä keskustelulla, ei tilauksia. Banaani ja puhekielinen "banskuja" säilyttivät syyn "Valion testirajapinta suljettiin" ilman "ei löydy meiltä" -muotoilua. Juusto säilytti syyn. Juuresten viimeinen ohje oli "Vastaa 1, 2, 3 tai 4." ilman lisättyä tuotetta, ja yhteenveto tuli. Valikoimavastaus säilytti syyn.

## 17.11.2026 — puuttuva tuote kerrotaan syineen, broilerin haku ja valikoimakysymys (Claude Code)

- **Eeliksen pyyntö:** pidetään Haiku. Korjaa näkyvimmät viat, kokeile tavallisia tilauksia ja kerro selvästi ja kevyesti, jos tuotetta ei ole ja miksi ("tietojani on supistettu"). Ehdota demo Valion edustajille. Pitch deck tehdään erillisessä sessiossa.
- **Koe ennen korjausta** (paikallinen botti tuotannon asetuksin: kopio välimuistikannasta, Valion osoite ei ratkea, last-known, Haiku, omat väliaikaiset kannat, selainkeskustelun reitti, ei Metaa eikä tilauksia), 16 tavallista tilausta. Maito, voi, juurekset, kerma, kananmunat, kaurajuoma, riisi, sokeri, pasta ja jauheliha pääsivät yhteenvetoon. Viat:
  - Puuttuvasta tuotteesta tuli tekninen "En saa nyt tarkistettua saatavuutta …" ilman syytä.
  - "8 kg broilerin rintafileetä ja 5 kg pastaa" jumittui: malli antoi tuotesanan partitiivissa ("tuotteelle broilerin rintafileetä"), broilerin haku osui pakastehyllyyn ilman hintoja, vaikka kanan rintafileillä on hinta, ja rivi jäi odottamaan "poista"-viestiä.
  - "Mitä tuotteita teillä on?" sai vain "Kerro vaan, mitä tarvitset".
- **Muutokset:**
  - Uusi `server/data-limits.mjs`: syy ("Tietojani on supistettu: Valion testirajapinta suljettiin, joten minulla on oikea hinta ja saatavuus enää noin 900 tuotteelle 17 500:sta.") ja hyvin katetut tuoteryhmät, laskettu välimuistikannasta (881 tuotetta, joilla hinta ja saatavuus ok).
  - Puuttuva tuote: "Hups, juustolle minulla ei ole nyt hintaa eikä saatavuutta." Syy kerran luonnosta kohden, sitten "Tämä löytyy tilalle:" tai "Näistä voit valita tilalle:".
  - Tuote ilman tietoa ja korvaajaa jätetään pois ("En löytänyt korvaajaa, joten poistin rivin listalta."), ja muut rivit jatkuvat yhteenvetoon. Tyhjälle listalle kerrotaan, mitä on hyvin tarjolla. Aiempi "Toinen päivä ei auta …" -haara poistettu.
  - `order-tools`: broilerin, kananpojan ja kanan tuotteet ovat sama asia, joten tuloksettoman broilerihaun jälkeen haetaan kana-sanalla.
  - `interpret.mjs` (`baseForm`): mallin tuotesanan viimeinen sana perusmuotoon sanastosta, -ton-adjektiivit (maustamatonta → maustamaton).
  - `dialogue.mjs`: kysymys koko valikoimasta saa koodin vastauksen ilman mallia, vain last-known-tilassa.
- **Tarkistukset:** uusi `test/whatsapp-data-limits.test.mjs` 6/6, vanhojen testien tekstiodotukset päivitetty. `npm test` 502/502 (CI:tä vastaava kopio ilman `data/`- ja `*.otf`-tiedostoja: 417 läpi, 85 ohitettu, 0 virhettä), `aimo:eval` 26/26, `aimo:eval:spoken` 54/54. Paikallinen koe korjauksen jälkeen samoilla 16 tilauksella: 12 pääsi korilinkkiin asti. Broileri ja pasta menivät yhteenvetoon, banaani jätettiin pois syineen, ja valikoimakysymys sai uuden vastauksen.
- **Äänikerros 9b32863 tuotannossa klo 23.38** (sessio E, Eeliksen luvalla). Tarkistettu livenä seitsemän keskustelua, ei tilauksia. Juusto, broileri ja pasta, puhekielinen maito ja voi, juurekset sekä kerma ja munat menivät yhteenvetoon tai korilinkkiin asti, ja valikoimavastaus säilyi. Kaksi poikkeamaa äänikerroksen uudelleenkirjoituksessa (`server/whatsapp/voice.mjs`):
  - Banaanin poistosta putosi syy "Valion testirajapinta suljettiin", ja tilalle tuli "Ei hätää, banaaneja ei nyt löydy meiltä".
  - Viimeisen tuotteen (sipuli) ohjeeseen tuli "niin mennään sipuliin", vaikka seuraavaa tuotetta ei ole.
- **Ei korjattu:** "onko teillä laktoositonta maitoa?" vastaa yhden tuotteen tuotetiedoilla eikä listaa vaihtoehtoja. Jauhelihalle, lohelle, kahville ja ruisleivälle on vain yksi vaihtoehto datan vuoksi.
- **Julkaistu:** Eelis hyväksyi ("Kyllä, julkaise"). Sessio E julkaisi botin klo 23.32 (deployment aimo-whatsapp-e74o6uim7, koodi f1b1667). Worker ja asetukset ennallaan, malli Haiku. Varmennettu livenä tuotannon selainkeskustelun reitillä omilla testiasiakkailla, ei tilauksia: "mitä tuotteita teillä on?" sai uuden vastauksen, "3 kg juustoa" vastasi "Hups, juustolle …" ja tarjosi Emmental-raastetta, broileri ja pasta menivät korilinkkiin asti, banaani poistettiin syineen, ja puhekielinen maito- ja voitilaus meni korilinkkiin asti.

## 17.11.2026 — LICENSE: omistajaksi Eelis Puro (Claude Code)

- **Eeliksen pyyntö:** LICENSE-tiedoston tekijänoikeuden haltijaksi Eelis Puro.
- **Muutos:** rivi "Copyright (c) 2026 Aimo Agent Gateway contributors" on nyt "Copyright (c) 2026 Eelis Puro". Lisenssin ehdot ovat ennallaan (MIT).
- **Oikaisu 20.11.:** tähän oli kirjattu, että Danielin kanssa olisi kirjallinen sopimus koodin siirrosta. Sellaista sopimusta ei ole. LICENSE korjattu 20.11. (ks. ylin merkintä).

## 17.11.2026 — kehitys siirtyi tähän repoon (Claude Code)

- **Eeliksen päätös:** kaikki tilausapurin työ tehdään jatkossa vain tässä yksityisessä repossa.
- **Oikaisu 20.11.:** tähän oli kirjattu, että Danielin kanssa olisi sovittu koodin siirtymisestä Eelikselle ja myynnistä.
  Mitään sellaista ei ole sovittu (ks. ylin merkintä).
- **Koodi:** sama kuin tuotannossa 17.11. illalla (WhatsApp-botti, korisivu, gateway, Worker-sivusto, itse ajettavan mallin
  sovitin ja selfhost-demo). Testit 490/490, Worker 58/58, GitHub Actions läpi.
- **Julkaisu:** sessio E julkaisi botin tästä reposta (9cda304, deployment aimo-whatsapp-kqvtw6lol, 17.11. klo 22.07).
  Worker on livenä vielä versiossa 32cc6312, jonka koodi on sama; seuraava Worker-julkaisu tehdään tästä reposta.
- **Paikalliset tiedostot:** asetustiedostot, katalogi, tuotekuvat ja fontit ovat tämän kansion työpuussa (Gitin
  ohittamia). Paikalliset kantapolut osoittavat tämän kansion `data/`-hakemistoon, joten paikallinen palvelin aloittaa
  omilla kannoillaan. Livebotti käyttää pilven Turso-kantoja.
- **Repo:** yksityinen, vain Eeliksellä pääsy. Commit-historia on Eeliksen nimissä.
- **Seuraavaksi:** Worker-julkaisu tästä reposta seuraavan Worker-muutoksen yhteydessä (sessio E).
