# Aimo-malli: Aimon oma kielikerros

Vapaa ostopyyntö suomeksi tai englanniksi → rakenteinen pyyntö → oikeat tuotteet Aimon katalogista → valmis kutsu portille (`request_quote`).

```
npm run aimo -- "I need 1,000 litres of lactose-free milk by Monday"
npm run aimo:eval        # tarkkuustesti, 26 pyyntöä
```

## Mikä tämä on ja mikä ei

"Oma kielimalli" ei tarkoita itse koulutettua neuroverkkoa. DM Champ ja Zalando Assistant eivät kumpikaan kouluta omaa malliaan: molemmat käyttävät valmista kielimallia (DM Champin Pro-taso Claudea, Zalando OpenAI:n malleja), ja oma osuus on data, rajat ja rakenne mallin ympärillä. Aimo-malli on sama rakenne Aimon datalla:

| Kerros | Tiedosto | Mitä tekee | Kielimalli |
|---|---|---|---|
| Sanasto | `server/aimo/lexicon.mjs` | Louhii katalogista (17 546 tuotetta) sanan → tuoteryhmän, antaa 349 nimettömälle kategoriakoodille luettavan nimen, tunnistaa 931 merkkiä | ei |
| Ymmärrys | `server/aimo/understand.mjs` | Määrä, yksikkö, päivä, väittämät, allergeenit, merkki, rasvapitoisuus, pakkauskoko; ilmoittaa itse varmuutensa | ei |
| Kohdistus | `server/aimo/resolve.mjs` | Rajaa ehdokkaat luokitteluilla (ei nimihaulla), näyttää rajauksen vaiheet, tekee tarkennusnapit | ei |
| Varapolku | `server/aimo/model.mjs` | Claude Haiku + datasta generoitu toimialakortti + tulosskeema; tulos tarkistetaan sanastoa vasten | vain kun varmuus < 0,6 |

Yksi sisäänkäynti: `interpret(text)` tiedostossa `server/aimo/index.mjs`.

## Mitä lainattiin ja mistä

**Zalando Assistant** (lähteet: corporate.zalando.com, OpenAI:n asiakastarina, jobs.zalando.com)

- Kielimalli tuottaa vain hakuehtoja; tuotteet tulevat omasta hausta. Zalandolla malli keksi aluksi tuotekoodeja, ja korjaus oli antaa sille lupa sanoa "ei löydy". → Täällä tuotekoodi voi tulla vain katalogista, ja tyhjä tulos on `NO_MATCH` syineen.
- Tarkennukset klikattavina vaihtoehtoina, ei avoimina kysymyksinä (40 % keskusteluista alkaa ehdotetusta napista). → `chips`: vain rajaukset, jotka oikeasti jakavat ehdokasjoukon, jokainen valmis rakenteinen muutos.
- Poissulkevat ehdot ensiluokkaisina ("no synthetics"). → `excludeAllergens`, "nut-free", "ilman soijaa".
- Arviointi rakennettiin ennen mallin vaihtoa, osa kerrallaan. → `npm run aimo:eval`.

**DM Champ** (lähde: help.dmchamp.com; REA:lla tutkittiin julkinen sivusto, itse agentin logiikka on palvelimella eikä näy ulos)

- Kuusiosainen ohjerakenne: rooli ja tavoite, yritystieto, säännöt, kulku, "ohjaa ihmiselle kun", "valmis kun". Faktat pidetään tietopohjassa, ei ohjeessa. → `domainCard()` noudattaa samaa runkoa, ja valikoimaosa generoidaan datasta.
- Tyypitetyt kentät, joihin kelpaamaton arvo ei mene läpi. → määrä, yksikkö ja päivä validoidaan; puuttuva määrä on `QUANTITY_MISSING`, ei arvaus.
- Botti pysähtyy ja ohjaa ihmiselle, eikä lupaa mitä ei voi pitää. → `handoff: NEEDS_HUMAN`, kun pyyntöä ei ymmärretä.

## Rajat ja oletukset

- Tarkkuusluku 26/26 on omasta testisetistä, jota vasten jäsennin on myös viritetty. Ennen näkemättömillä lauseilla tulos on heikompi; setti kannattaa kasvattaa mentorien oikeilla pyynnöillä.
- Kielimallin varapolkua ei ole ajettu oikeaa rajapintaa vasten, koska `ANTHROPIC_API_KEY` puuttuu `.env`-tiedostosta.
- Palvelimessa: `POST /api/aimo/interpret` (`{text, patches?}`) ja `GET /api/aimo/lexicon`. Käyttöliittymässä tarkennusnappeja ei vielä näytetä.
- Kuratoidut tuotetyypit (maito, kerma, voi, kananmunat) luetaan portin sopimuksesta (`server/gateway/contract.mjs`). Muissa 345 ryhmässä rajaus on louhittu datasta, ja monitulkintainen sana (esim. "lohi" usealla hyllyllä) kirjataan oletukseksi.
- Hintaa, saatavuutta ja litrojen muuntoa myyntiyksiköiksi ei tehdä täällä: ne kuuluvat portille.
