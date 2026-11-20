# Rinnakkaiset asiakkaat (v2, sessio niputus)

19.11.2026. Eeliksen pyyntö: huomenna demossa on noin 4–5 numeroa yhtä aikaa, ja botin pitää toimia varmasti, vaikka moni
käyttää sitä samanaikaisesti. Lähtökohta on main 6c267f2 (`WHATSAPP_AGENT=v2`, Sonnet 5.5).

## Testi `test/agent-v2-concurrency.test.mjs`

**Polku on sama kuin tuotannossa.** Viesti kulkee näin:
1. allekirjoitettu Meta-webhook (`channel.handle`)
2. WhatsApp-kanava (`WHATSAPP_CONCURRENCY`, oletus 4, demossa 8 mainin commitista 41728a2 alkaen)
3. korilinkin kääre (`createCartLink`)
4. silta (`createDemoOrderingChat`, `agentMode: 'v2'`, uusinta `redoWhenAgent`)
5. v2-agentti (`createAgent`), oikeat työkalut (`createAgentTools`) ja luonnosvarasto (`openDraftStore`).

Kannat ovat tiedostoja. Haku ja tarjous ovat injektoidut kuten `test/agent-tools.test.mjs`:ssä.

**Malli on käsikirjoitettu.** Se lukee kontekstilohkosta asiakkaan (yritys ja yhteyshenkilö) ja tekee vuorossa seuraavat asiat:
- kirjaa mainitut tarpeet, toimituspäivän ja ruokavalion
- lukee korin ja valitsee tuotteen
- pyytää valmiille korille linkin ja vastaa "Selvä, ⟨asiakas⟩. Korissa: ⟨tarpeet⟩."

Vastauksesta näkee siis, kenelle se kuuluu ja mitä korissa on. Satunnainen 1–12 ms viive jokaisessa kutsussa lomittaa
asiakkaiden vuorot. Ei verkkoa, katalogia eikä mallikutsuja, joten testi ajetaan myös CI:ssä.

**Asiakkaat:** viisi numeroa, kullakin oma jäsen, nimi, yritys ja tuote (maito, kerma, sipuli, peruna, voi). Jokainen lähettää 2–3
viestiä peräkkäin, ja kaikki asiakkaat kirjoittavat yhtä aikaa.

| Testi | Mitä se näyttää |
|---|---|
| Viisi numeroa yhtä aikaa (`start()`, kuten Mac) | Oletusasetuksella huipussa 4 numeroa ja 4 mallikutsua yhtä aikaa, demon arvolla 8 kaikki 5. 13 viestiä niputettiin viideksi vuoroksi. |
| Viestit harvemmin (niputus 10 ms, tauot 30–90 ms) | Vuorot jakautuvat (noin 13 vuoroa), ja välillä tulee uusinta. Mikään ei katoa eikä tuplaannu. |
| Kaksi pilvi-instanssia samoilla kantatiedostoilla | Saman numeron viestit menevät vuorotellen kumpaankin instanssiin, ja drain ajetaan jokaisen webhookin jälkeen kuten `server/cloud.mjs`:ssä. Kumpikin instanssi käsittelee viestejä (esim. A 6 ja B 6 kutsua, 3 uusintaa). |
| Jonon varaus kahdella kantayhteydellä | `store.next()` ei anna saman numeron seuraavaa viestiä, ennen kuin edellinen on valmis. Toinen numero etenee. |
| Uusi kutsuttu jäsen | Kutsu → "YHDISTA koodi" → "Testiyhteys yhdistetty: Ulla, Ravintola Uusi". Ensimmäinen viesti toimii, ja agentin konteksti on "Ravintola Uusi, yhteyshenkilö Ulla". Koodi kelpaa vain kerran. |

**Tarkistukset jokaiselle asiakkaalle:**
- Vastaukset menevät vain omaan numeroon ja kertovat vain oman nimen ja yrityksen. Toisen asiakkaan nimeä, yritystä tai tuotetta ei
  näy.
- Jokainen viesti on käsitelty tai liitetty (`done` tai `merged`). Jokaiseen käsiteltyyn viestiin vastataan kerran ja samassa
  järjestyksessä kuin viestit tulivat, myös kahdesta instanssista.
- Agentin transkriptissa ovat asiakkaan viestit tasan kerran, lähetysjärjestyksessä, eikä toisen asiakkaan tietoja.
- Luonnoksessa on vain oma tuote ja määrä, sidos on oma, ja toimituspäivä on kirjattu.
- Viimeisen vastauksen korilinkki osoittaa tämän numeron sidokseen ja tämän asiakkaan luonnokseen. Keskustelut ja luonnokset ovat
  kaikilla eri.
- Saman numeron kaksi vuoroa eivät ole koskaan käynnissä yhtä aikaa, kanavassa eivätkä mallikutsuissa.

## Tulokset

- **WhatsApp-polulla ei löytynyt sovellusvirhettä.**
- **Toistetut ajot:** 12 peräkkäistä ajoa ja 20 ajoa neljänä rinnakkaisena prosessina (kuormitettuna). Kaikki menivät läpi.
- **Demon asetus:** ajettu myös `WHATSAPP_CONCURRENCY=8`. Silloin kaikki viisi numeroa ja viisi mallikutsua olivat käynnissä
  yhtä aikaa, ja kaikki testit menivät läpi.
- **Uusin main (3ba23cb):** haara yhdistyy ilman ristiriitoja. Yhdistetyssä puussa uusi testi meni läpi 3/3 kertaa ja agentin
  testit 62/62. Mainin `agentCustomer` piilottaa agentilta paikkanimet ("Testaaja", "Kokeilija"), joten uuden jäsenen testi
  käyttää oikeaa nimeä (Ulla).
- **Mutaatiot:** jokainen kaatoi vähintään yhden testin.
  - jono ilman numerokohtaista varausta (2 testiä)
  - niputus yli numeroiden ja sidosten (3)
  - korilinkki väärälle sidokselle (3)
  - silta sarjallistaa kaikki numerot yhteen jonoon (1). Tulos olisi oikea, mutta viisi demon käyttäjää odottaisi toisiaan,
    joten testi vaatii, että eri asiakkaiden mallikutsut kulkevat rinnakkain.
- **Testin oma virhe korjattu ennen committia:** kahden instanssin lähetykset koottiin ensin instansseittain eikä
  aikajärjestyksessä. Nyt lähtöjono on yhteinen, ja vastausten järjestys tarkistetaan.
- **Muut tarkistukset:**
  - `npm test` 656/656
  - CI:tä vastaava kopio ilman katalogia ja fontteja: 563 läpi, 93 ohitettu, 0 virhettä. Uudet testit ajetaan siellä.
  - Worker 58/58, `aimo:eval` 26/26, `aimo:eval:spoken` 58/58
- **Ei muutoksia sovelluskoodiin.**

## Selainkeskustelun riski (ei korjattu, odottaa kuittausta)

**Polku:** Worker → `/webchat/api/chat` → `web-chat.mjs` `turn()` → `cartLink.chat` → silta → agentti. Jono ohitetaan, ja saman
asiakkaan vuorot sarjallistaa vain muistissa oleva `serial()` (`ordering.mjs`), joka toimii vain yhden instanssin sisällä.

**Milloin pyyntöjä tulee rinnakkain:**
- Saman välilehden toista viestiä ei voi lähettää ennen vastausta (`keskustele.js`, `busy`), joten tavallisessa käytössä
  rinnakkaisia pyyntöjä ei tule.
- Kaksi välilehteä samalla istuntoevästeellä voivat lähettää yhtä aikaa.
- Workerin 90 s aikakatkaisun jälkeen kirjoitettu uusi viesti voi tulla, kun ensimmäinen vuoro on vielä käynnissä.
- Korisivun muutos (`/whatsapp/cart/api/chat`, sama sidos) voi tulla WhatsApp- tai selainvuoron aikana.

Vercel voi ohjata nämä eri instansseihin.

**Koe (ei commitoitu):** kaksi instanssia samoilla kannoilla, ja saman istunnon kaksi pyyntöä samaan aikaan. Kaikissa kuudessa
ajossa saman asiakkaan kaksi agenttivuoroa kutsuivat mallia päällekkäin (6–7 päällekkäistä kutsua).
- Toinen vastaus kertoi vanhan korin ilman linkkiä ("Korissa: maito, voi."), toinen uuden korin linkin kanssa ("maito, voi,
  kerma").
- Rivejä ei kadonnut, koska jokainen työkalukutsu lukee ja tallentaa luonnoksen kerralla. Tallennus ei kuitenkaan tarkista versiota
  (viimeinen voittaa), joten työkalu, joka odottaa hakua tai tarjousta, voi kumota toisen vuoron muutoksen.
- Transkriptiin tuli kaksi vuoroa, jotka eivät nähneet toisiaan.

**Ensimmäisen viestin kilpailu:** `member(session)` luo selainjäsenen (kutsu ja yhdistäminen) ilman lukkoa. Kaksi instanssia yhtä
aikaa voi tuottaa vastauksen "Testiyhteys ei ole voimassa" tai virheen 503. Tämä koskee vain istunnon ensimmäistä viestiä.

**Arvio:** riski on todellinen mutta demossa harvinainen. Se vaatii kaksi välilehteä, yli 90 s vuoron tai korisivun käytön samaan
aikaan. Seuraus koskee vain samaa asiakasta: ristiriitainen vastaus ja mahdollisesti kumoutunut muutos. Asiakkaiden välillä ei
vuoda tietoja, eikä tilausta synny ilman korisivun vahvistusta.

**Ehdotus, kevyt korjaus:** sidoskohtainen lukko WhatsApp-kantaan (Turso, yhteinen kaikille instansseille). Lukko otetaan
`ordering.mjs`:n `serial()`-funktion sisällä vain muuttaville kutsuille (`chat`).
- Taulu `chat_leases (binding TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)`.
- Lukon otto:
  - `INSERT … ON CONFLICT(binding) DO UPDATE SET owner=excluded.owner, expires=excluded.expires WHERE chat_leases.expires<=?`
  - Yksi muutettu rivi tarkoittaa, että lukko saatiin. Muuten uusi yritys 250 ms välein, enintään noin 75 s, koska v2-vuoro kestää
    enintään 60 s. Lukko on voimassa 90 s.
- Vapautus `DELETE … WHERE binding=? AND owner=?` finally-lohkossa.
- Jos lukkoa ei saada: 409 "Edellinen viesti on vielä käsittelyssä. Lähetä hetken päästä uudelleen." Selain näyttää virheen, ja
  korisivu käsittelee 409:n jo nyt.
- Kustannus on kaksi kantakirjoitusta vuorossa. WhatsApp-jonon vuorot eivät kilpaile keskenään, mutta lukko kattaa myös
  korisivun.
- Selainjäsenen luonti kestävämmäksi: jos yhdistäminen epäonnistuu tai sidos vaihtui kesken, jäsen luetaan kerran uudelleen.
- Testi: sama koe kahdella instanssilla. Odotus: saman asiakkaan kutsut eivät ole koskaan päällekkäin.

## Avoimet asiat

- Selainkeskustelun lukko odottaa koordinaattorin kuittausta.
- Ei kokeiltu oikealla WhatsAppilla eikä oikealla mallilla.
