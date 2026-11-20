# Demon testiasiakkaat WhatsAppiin

Näin uusi kokeilija pääsee juttelemaan tuotannon botin kanssa omasta WhatsAppistaan. Lopuksi kerrotaan, miten hänet poistetaan
kokeilun jälkeen. Botti pyörii Vercelissä (`aimo-whatsapp.vercel.app`), ja jäsenet ovat Turso-kannassa `aimo-whatsapp`.
Taustatiedot: [docs/vercel.md](vercel.md) ja [docs/whatsapp.md](whatsapp.md).

## 1. Metan testivastaanottaja (Eelis tekee itse Metassa)

Botti käyttää Metan testinumeroa. Se lähettää vastauksia vain numeroihin, jotka on lisätty ja vahvistettu sen
vastaanottajalistalle.

1. Avaa Meta for Developers → sovellus Valio Aimo Tilausapuri → WhatsApp → API Setup → To-kenttä → Manage phone number list.
2. **Tarkista vapaat paikat.** Listalla voi olla enintään viisi numeroa, ja Eeliksen oma numero vie yhden. Neljä kokeilijaa
   täyttää siis listan. Poista ensin numerot, joita ei enää tarvita.
3. Lisää kokeilijan numero maatunnuksineen (+358…). Meta lähettää hänelle WhatsAppiin vahvistuskoodin. Kokeilija kertoo
   koodin, ja se syötetään Metaan. Numero kelpaa vasta, kun se näkyy listalla vahvistettuna.

Jos numero puuttuu Metan listalta, kokeilijan viesti voi kyllä tulla perille, mutta botin vastaus ei lähde.

## 2. Yhdistä numero tuotannon kantaan

Aja valioaimo-tilausapurin kansiossa Macilla. `npm run whatsapp:member:cloud` lukee `deploy/vercel/.env.cloud`-tiedoston
viimeisenä, joten `WHATSAPP_DB` ja `TURSO_AUTH_TOKEN` osoittavat tuotannon Turso-kantaan. Komento kertoo aina ensimmäisellä
rivillä, mihin kantaan se menee (`Kanta: etäkanta …`). Jos rivillä lukee `paikallinen tiedosto`, kutsu ei mene tuotantoon.

**Suositus demoon: yhdistä suoraan ilman koodia.** Kun numero on vahvistettu Metassa (kohta 1), ylläpitäjä tietää jo, että
numero on kokeilijan. Numeron voi silloin yhdistää heti ja vaikka edellisenä päivänä:

```bash
npm run whatsapp:member:cloud -- link --phone +358401234567 --company "Ravintola A" --person "Anna"
```

- Kokeilija voi heti kirjoittaa botille omin sanoin. Hänen ei tarvitse lähettää YHDISTA-viestiä.
- Botti puhuttelee häntä `--person`-nimellä, joten käytä oikeaa etunimeä. Yritys näkyy ostoskorissa.
- Sama komento uudelleen samalle numerolle aloittaa keskustelun ja ostoskorin alusta. Sillä voi nollata demon ennen
  esitystä.

Tarkista lopuksi, mitkä numerot ovat yhteydessä (numerot näkyvät peitettyinä):

```bash
npm run whatsapp:member:cloud -- list
```

**Vaihtoehto: kutsukoodi.** Jos numeroa ei ole itse vahvistettu, anna kokeilijalle kertakoodi:

```bash
npm run whatsapp:member:cloud -- invite --phone +358401234567 --company "Ravintola A" --person "Anna"
```

- **Älä käytä komentoa `npm run whatsapp:member`.** Se lukee vain `.env`- ja `.env.whatsapp`-tiedostot, joten kutsu menisi
  Macin paikalliseen kantaan eikä tuotantoon.
- Komento tulostaa rivin `YHDISTA <koodi>`. Anna koodi vain kokeilijalle itselleen, esimerkiksi suoraan viestinä. Älä
  kirjaa sitä mihinkään.
- Koodi on voimassa 10 minuuttia. Uusi kutsu samalle numerolle korvaa vanhan koodin.
- Yritys ja henkilö näkyvät botin kuittauksessa, joten käytä oikeita nimiä tai selviä testinimiä.

## 3. Kutsukoodilla: kokeilija yhdistää numeronsa

Kokeilija lähettää 10 minuutin sisällä botin numeroon viestin, jossa on vain:

```text
YHDISTA <koodi>
```

Botti vastaa: `Testiyhteys yhdistetty: Anna, Ravintola A. Kerro tuotteet ja määrät, niin kokoan demotilausluonnoksen. Oikeaa
Valio-tilausta ei lähetetä.` ja asiakaspalvelun yhteystiedon. Tämän jälkeen hän voi tilata omin sanoin. Tilaus vahvistetaan
vain korisivulla, ja maksu on demomaksu.

Kutsu toimii vain siitä numerosta, jolle se tehtiin. Yritysrajat ovat seuraavat:

| Raja | Arvo |
| --- | --- |
| Väärä, vanhentunut tai käytetty koodi | Botti vastaa, että koodi ei kelpaa |
| Yhdistämisyrityksiä numerolta | Enintään 5 / 15 min |

Kun raja tulee täyteen, odota 15 minuuttia ja tee uusi kutsu.

## 4. Mitä liittämätön numero saa

Jos numerolla ei ole voimassa olevaa yhdistämistä, botti ei kutsu mallia. Se vastaa vain:

```text
Numeroasi ei ole yhdistetty asiakastiliin. Pyydä yrityksesi ylläpitäjältä yhdistämiskoodi ja lähetä: YHDISTA koodi
Asiakaspalvelu: <tukiyhteys>
```

Vastaus lähtee vain, jos numero on Metan vastaanottajalistalla (kohta 1).

## 5. Poisto kokeilun jälkeen

```bash
npm run whatsapp:member:cloud -- revoke --phone +358401234567
```

Poisto koskee WhatsApp-kantaa:

- **Poistuu:** jäsenyys, kutsu ja keskusteluhistoria, ja odottavat vastaukset perutaan.
- **Säilyy:** vahvistetut demotilaukset. Myös luonnoskannan tiedot jäävät, ja tavallinen siivous poistaa ne ajallaan:
  - keskeneräinen luonnos 7 päivän kuluttua
  - suljettu luonnos 30 päivän kuluttua
  - v2-agentin keskustelutallenne 14 päivän kuluttua

Poista numero lopuksi myös Metan vastaanottajalistalta, jotta paikka vapautuu.

## Monta käyttäjää yhtä aikaa

Tarkistettu 19.11.2026:

- **Vercel:** Fluid compute on päällä (projektin `resourceConfig.fluid`), joten yksi instanssi voi palvella useaa kutsua
  samaan aikaan. Funktion aikaraja on 300 s (`vercel.json` `maxDuration`), alue fra1. Vercel skaalaa instanssit
  automaattisesti, eikä se ilmoita Hobby-tasolle tarkkaa rinnakkaisuusrajaa.
- **Botti:**
  - Yksi instanssi käsittelee enintään `WHATSAPP_CONCURRENCY` eri asiakasta kerralla. Arvo on Vercelissä 8 (Eeliksen
    päätös 19.11. ennen demoa, julkaisu aimo-whatsapp-4etjlnz1y). Ilman asetusta oletus on 4.
  - Saman numeron viestit käsitellään järjestyksessä.
  - Viestin varaus on atominen, joten kaksi instanssia ei käsittele samaa viestiä.
  - Viisi samanaikaista asiakasta käsitellään rinnakkain, vaikka kaikki osuisivat samaan instanssiin. Vasta yhdeksäs alkaa
    jonosta, kun ensimmäinen valmistuu (v2:n vastausajan mediaani noin 5 s, p90 noin 9 s). Myös minuutin ajastin käsittelee
    jonoon jääneet.
- **Asiakaskohtaiset rajat** (kustannussuoja):

  | Aikaväli | Enintään viestejä numerolta |
  | --- | --- |
  | Minuutti | 10 |
  | Tunti | 120 |
  | Vuorokausi | 400 |

- **Selainkeskustelu** (Keskustele-sivu) vastaa jokaiseen viestiin omassa kutsussaan, ei WhatsAppin jonossa.

Rinnakkaisuuden vaihto: muuta `WHATSAPP_CONCURRENCY` Vercelissä (production) ja julkaise uudelleen. Tämä on session E:n
tehtävä, ja siihen tarvitaan Eeliksen lupa.
