# Tilausapuri v2: arviointi

Sessio "Botti v2: arviointi", haara `claude/agent-v2-eval-25c0f3`, 19.11.2026. Sopimus: [docs/agent-v2.md](../agent-v2.md), kohta
Arviointi.

## Suositus

**Sonnet 5.5, effort medium.**

- **Laatu:** Sonnet on käytännössä Opuksen tasolla. Ydinskenaarioissa arvio oli 3,3/5 ja Opuksella 3,4/5, ja sama keskustelu
  vaihtelee ±1 ajosta toiseen. Kaikissa 12 skenaariossa koodin tarkistukset menivät läpi 15/18 ajossa, ja arvio oli 3,3.
- **Viive:** Sonnet on nopein. Putken viive vastausta kohden oli mediaanina 5,0 s ja p90 9,3 s. Opuksella p90 oli 18 s, ja yksi
  ensimmäinen vastaus kesti 41 s.
- **Hinta:** Sonnet maksaa puolet Opuksesta, 0,06–0,08 $ tilauskeskustelua kohden. 1 000 tilauskeskustelua kuussa maksaa noin
  60–80 $, Opuksella noin 160 $ ja Haikulla noin 5 $.
- **Low ei kannata:**
  - Sonnet low teki virheitä, joita medium ei tehnyt: E1:ssä "50 sipulia" meni kerran 50 kiloksi, ja E3:ssa toimitus siirtyi
    bileiden päivälle 25.11. Low ei ollut nopeampi.
  - Opus low ei ollut nopeampi (p90 19 s). Sen arvio oli 2,8, ja se kysyi allergiat vain puolessa keskusteluista.
- **Haiku 5.5 medium** on halvin (0,004 $) ja nopea, mutta se tekee juuri niitä virheitä, joita v2:lla korjataan:
  - E3: väärä päivä tai kysymys "21.11. vai 28.11.?".
  - A1: juusto jäi pois 2/2 ajossa.
  - E1: kerran ei määräehdotusta 50 hengelle.
  - Savukokeessa keksitty merkki "Valio-kiinteää perunaa".
- **Korjauserä (6e7645f)** vahvistaa suosituksen Sonnet mediumilla:
  - Koodin tarkistukset menivät läpi 10/10 ajossa E1:ssä, E2:ssa, G1:ssä ja A1:ssä, 44dc513:lla 7/10.
  - Tervehdykset vaihtelevat: samankaltaisuus 0,34, ennen 0,55.
  - Korisivu näyttää tarpeen kilogrammoina ja litroina.
  - Putken mediaaniviive on 4,0 s.
- **Kaikki v2:t ovat selvästi parempia kuin vanha putki:**
  - Arvio 2,9–3,4, vanhalla 2,1.
  - "50 sipulia" on 6 kg eikä 50 kg.
  - Määrät ehdotetaan 50 hengelle.
  - Kaksi nopeaa viestiä saa yhden vastauksen.
  - Allergiat kysytään 88–100 %:ssa tilauskeskusteluista, vanhalla 0–15 %.

## Tulokset (main 44dc513)

### Ydinskenaariot: kaikki kokoonpanot

E1, E2, E3, G1 ja A1, kaikki toistot. Vanha putki ajettiin samalla mainilla ja 6 s:n niputuksella kuin v2, joten kanava on sama.

| kokoonpano | ajoja | koodi läpi | kokonaisuus | ihmismäisyys | tehokkuus | vaihtelu | rehellisyys | virheiden korjaus | botti $ / tilauskeskustelu |
|---|---|---|---|---|---|---|---|---|---|
| vanha Haiku 5.5 (afc509b) | 15 | 6/15 | 2,1 | 2,5 | 2,2 | 2,4 | 3,3 | 2,5 | 0,010 |
| v2 Haiku 5.5 medium | 10 | 5/10 | 2,9 | 3,3 | 2,9 | 3,2 | 2,8 | 3,1 | 0,006 |
| **v2 Sonnet 5.5 medium** | 11 | 8/11 | 3,3 | 3,4 | 3,1 | 3,0 | 3,1 | 3,3 | 0,078 |
| v2 Sonnet 5.5 low | 10 | 6/10 | 3,0 | 3,1 | 2,8 | 2,6 | 3,4 | 3,4 | 0,080 |
| v2 Opus 5.5 medium | 11 | 9/11 | 3,4 | 3,8 | 3,1 | 3,4 | 3,6 | 3,5 | 0,159 |
| v2 Opus 5.5 low | 5 | 4/5 | 2,8 | 3,2 | 2,4 | 3,0 | 3,2 | 3,4 | 0,134 |

Putken viive on yhden vastauksen laskenta-aika. Viestistä vastaukseen on aika asiakkaan viestistä ensimmäiseen kuplaan, ja siihen
sisältyy niputuksen 6 s:n odotus.

| kokoonpano | putken viive mediaani | p90 | mallikutsuja / vastaus | viestistä vastaukseen mediaani | p90 | merkkejä / vastaus | kuplia / vastaus | vastauksia / 2 nopeaa viestiä | asiakasviestejä linkkiin | allergiat kysytty | valittu ilman vaihtoehtoja |
|---|---|---|---|---|---|---|---|---|---|---|---|
| vanha Haiku 5.5 | 9,4 s | 15,5 s | 3,1 | 16,3 s | 22,3 s | 279 | 1,9 | 1 | 7,1 | 0 % | 0 % |
| v2 Haiku medium | 5,3 s | 12,9 s | 2,4 | 11,5 s | 18,9 s | 323 | 1 | 1 | 4,3 | 88 % | 100 % |
| **v2 Sonnet medium** | 5,0 s | 9,3 s | 2,3 | 11,4 s | 18,4 s | 314 | 1 | 1 | 4,0 | 88 % | 53 % |
| v2 Sonnet low | 5,2 s | 10,5 s | 2,4 | 11,5 s | 16,6 s | 343 | 1 | 1 | 5,0 | 88 % | 35 % |
| v2 Opus medium | 6,2 s | 18,0 s | 2,4 | 13,2 s | 24,0 s | 365 | 1 | 1 | 4,1 | 100 % | 94 % |
| v2 Opus low | 5,6 s | 19,0 s | 2,5 | 12,5 s | 25,0 s | 403 | 1 | 1 | 4,0 | 50 % | 83 % |

Skenaarioittain: koodin tarkistukset läpi / ajoja (arvioijan kokonaisuus keskimäärin).

| skenaario | vanha | v2 Haiku medium | v2 Sonnet medium | v2 Sonnet low | v2 Opus medium | v2 Opus low |
|---|---|---|---|---|---|---|
| E1 peruna, sipuli, kerma | 0/3 (1,0): sipuli 50 kg, ei ehdotusta | 1/2 (2,5): kerran ei ehdotusta | 3/3 (3,3) | 2/3 (3,0): kerran sipuli 50 kg | 3/3 (3,3) | 1/1 (3,0) |
| E2 palaute kesken | 3/3 (3,3) | 2/2 (3,0) | 3/3 (3,0) | 3/3 (3,3) | 3/3 (3,3) | 1/1 (3,0) |
| E3 lanttulaatikko 500 kg | 3/3 (2,0) | 1/2 (2,5): väärä päivä | 1/1 (3,0) | 0/1 (2,0): väärä päivä | 1/1 (3,0) | 1/1 (3,0) |
| G1 tervehdykset | 0/3 (3,0): ei esittelyä | 1/2 (4,0): vähän vaihtelua | 0/3 (3,7): vähän vaihtelua | 0/2 (3,0): vähän vaihtelua | 1/3 (3,7): vähän vaihtelua | 1/1 (3,0) |
| A1 allergiat | 0/3 (1,0): ei juustoa | 0/2 (2,5): ei juustoa | 1/1 (3,0) | 1/1 (3,0) | 1/1 (3,0) | 0/1 (2,0): ei juustoa |

### Kaikki 12 skenaariota

| kokoonpano | ajoja | koodi läpi | kokonaisuus | botti $ / tilauskeskustelu | putken viive mediaani (p90) | allergiat kysytty | valittu ilman vaihtoehtoja |
|---|---|---|---|---|---|---|---|
| vanha Haiku 5.5 (afc509b) | 36 | 22/36 | 2,3 | 0,007 | 8,6 s (14,3 s) | 15 % | 13 % |
| v2 Haiku 5.5 medium | 24 | 18/24 | 3,2 | 0,004 | 5,7 s (12,9 s) | 95 % | 100 % |
| v2 Sonnet 5.5 medium | 18 | 15/18 | 3,3 | 0,064 | 5,4 s (10,7 s) | 93 % | 48 % |

Persoonat (S004, S005, S012, S016, S017, S018):
- Vanha putki läpäisi koodin tarkistukset 13/18 ajossa, mutta arvio oli usein 1–2. Tuotteet käydään läpi yksi kerrallaan, sama
  "Vastaa 1, 2 tai 3" toistuu, ja korilinkkipyyntö ohitetaan.
- v2 Sonnet läpäisi 6/6 ajoa, arvio 3–4. v2 Haiku läpäisi 11/12 ajoa: kerran se lisäsi koriin kananmunia strutsinmunien tilalle.

Vanhan putken ensimmäinen vertailuajo tehtiin main 062065b:llä ja 3 s:n niputuksella. Koodin tarkistukset menivät läpi 9/12, ja
arvio oli 2,7. Niputus 6 s:iin ei muuttanut vanhan putken sisältöä, mutta kaksi nopeaa viestiä saa nyt yhden vastauksen. Ennen
niitä tuli kaksi vastausta.

## Koordinaattorin kysymykset

### Viive

- **Mallikutsut:** v2 tekee 2,3–2,5 mallikutsua vastausta kohden, vanha putki 3 (tulkinta, dialogi ja äänikerros).
- **Kesto:** v2:n putki on silti nopeampi: Sonnetilla ja Haikulla mediaani on 5–6 s, vanhalla 9 s.
- **Opuksen pitkä häntä:** p90 18–19 s, ja A1:n ensimmäinen vastaus kesti 41 s. Opus haki ja punnitsi vaihtoehtoja ennen kuin
  vastasi.
- **Niputus:** asiakkaan kokemaan aikaan lisätään 6 s:n odotus. Viestistä vastaukseen mediaani on Sonnetilla 11,4 s ja vanhalla
  16,3 s.

### Valitseeko v2 tuotteen asiakkaan puolesta

Mittari: osuus tuotevalinnoista, joita ennen asiakkaalle ei näytetty hinnallisia vaihtoehtoja samasta tarpeesta.

| kokoonpano | valittu ilman vaihtoehtoja |
|---|---|
| Haiku | 100 % |
| Opus | 94 % |
| Sonnet | 48–53 % |
| vanha | 13 % |

- Opus ja Sonnet kertovat valinnan nimen ja hinnan kanssa ja tarjoavat vaihtoa. Esimerkiksi Opus E1:ssä: "Laitoin koriin nämä: …"
  ja myöhemmin sipuleista "Jos haluut, voin vaihtaa ne yhteen 10 kg:n säkkiin."
- Kaikki v2-korit, joissa tuotetyyppi tarkistettiin, olivat oikein. Väärää tuotetyyppiä ei tullut kertaakaan.
- Johtopäätös: valinta on hyvää tehokkuutta, kun se kerrotaan ja vaihtoehdot näytetään olennaisista eroista. Korjauserän linja
  tekee juuri tämän.
- Haiku valitsee aina itse, ja juuri se ei löytänyt keliaakikon juustoa A1:ssä.

### Pitkät viestit ja `---`-jako

- v2 ei käyttänyt `---`-jakoa kertaakaan: jokainen vastaus oli yksi kupla.
- Vastauksen pituus oli keskimäärin 310–400 merkkiä. Vanhan putken vastaus jakautui keskimäärin kahteen kuplaan, yhteensä noin
  280–310 merkkiä.
- Pisimmät viestit ovat korin yhteenvetoja.

### Tervehdysten samankaltaisuus (G1)

Viisi uutta keskustelua, joissa asiakas sanoo pelkän "moi" tai "moooi". Samankaltaisuus on sanojen päällekkäisyys (Jaccard)
viiden ensimmäisen vastauksen välillä: 0 = täysin eri sanat, 1 = samat sanat.

| kokoonpano | samankaltaisuus | eri aloituksia / 5 | esimerkki |
|---|---|---|---|
| vanha | 0,32–0,38 | 3 | "Päivää! Mä oon Valio Aimon digitaalinen tilausapuri…", "moooi" → "Tilataanko jotain?" ilman esittelyä |
| v2 Haiku medium | 0,32–0,34 | 2–3 | "Moi! Olen Valio Aimon digitaalinen tilausapuri, ja autan…", "Hei! Olen…" |
| v2 Sonnet medium | 0,49–0,61 | 2 | "Moi, Testaaja! Olen Valio Aimon digitaalinen tilausapuri…" ×3, "Moi! Mä olen…" ×2 |
| v2 Sonnet low | 0,52–0,55 | 1–2 | sama runko |
| v2 Opus medium | 0,48–0,67 | 2–3 | "Moi!" ja "Moikka!", sama runko |
| v2 Opus low | 0,56 | 3 | sama runko |

- Vanhan putken vaihtelu johtuu osin siitä, että "moooi" jäi ilman tervehdystä ja esittelyä.
- Kaikki v2-mallit kirjoittavat saman rungon: esittely, ja sitten "Mille päivälle…" ja allergiat.
- Malli ei muista muita keskusteluja, joten vaihtelun pitää tulla ohjeesta. Korjauserässä on satunnainen sävy ja avauksen
  vaihtelu.

### Merkit

- Merkkitarkistus: vastauksessa mainitun merkin ja sitä seuraavan tuotesanan pitää kuulua samaan työkalun palauttamaan
  tuotteeseen.
- Ainoa löydös oli Haikun savukokeen "25 kpl Valio-kiinteää perunaa". Tuote on PP KIINTEÄ PERUNA, toimittaja Pietilän Peruna.
- 44dc513:n Sonnet- ja Opus-ajoissa ei ollut yhtään tukematonta merkkiä.

## Löydökset

Raportoitu koordinaattorille ja korjattu korjauserässä (`agent-v2-batch`, 6e7645f):

- **Keksitty merkki** (v2 Haiku, E1): "Valio-kiinteää perunaa". Korjaus: merkkivartija ja ohjeen merkkisääntö.
- **Korisivun tarvesarake:** v2:n luonnos kirjaa rivin myyntierinä ({1, PCS, sales}), joten korisivu näytti tarpeeksi "1 kpl"
  5 kg:n makaronitarpeelle. Korjaus: tarve kilogrammoina ja litroina.
- **Tervehdykset:** lähes samat joka keskustelussa. Korjaus: satunnainen sävy ja avauksen vaihtelu.
- **Tuotevalinta:** linjattiin niin, että ilmeinen tuote valitaan ja kerrotaan, ja olennaisista eroista näytetään 2–3 vaihtoehtoa.

Avoinna 44dc513:ssa:

- **Tekninen hintahuomautus:**
  - Sonnet kertoi asiakkaalle "Hinnat ovat viimeisimmät tunnetut, koska Valion hintarajapinta ei vastannut" 9/16
    keskustelussa ja 10/39 vastauksessa, Opus 4/23 keskustelussa.
  - Huomautus on rehellinen mutta jargonia, ja se toistuu korin yhteenvedossa.
  - Haiku ja vanha putki eivät sanoneet sitä.
- **Myötäily:** Opus myönsi E2:ssa "Vastasin tosiaan jokaiseen viestiin erikseen enkä lukenut niitä yhdessä", vaikka niputus oli
  yhdistänyt viestit tässä keskustelussa.
- **Sonnet ja Opus medium:** päivä ja juusto menivät aina oikein. Sonnet low ja Haiku tekivät E3:ssa päivävirheitä, ja Haiku ja
  Opus low eivät löytäneet juustoa A1:ssä. Ne ovat mallin ja effortin rajoja, eivät koodivirheitä.

## Poimintoja keskusteluista

**E1 v2 Sonnet medium (44dc513), sama käsikirjoitus kuin Eeliksen 19.11.:**
- "tarviin paljon perunaa ja sipulii! sillee 50 henkilöl" → "Moi! Olen Valio Aimon digitaalinen tilausapuri. Kirjasin perunan
  ja sipulin listalle. 50 hengelle ehdotan perunaa noin 12 kg ja sipulia noin 3 kg. Käyvätkö nämä? Kerro myös: Mille päivälle
  toimitus tulee? Onko allergioita tai erityisruokavalioita?"
- "50 sipulia" → "Selvä, nostin sipulit 50 kappaleeseen. Se on noin 6 kg, eli 6 pussia 1 kg:n pakkauksia (5,16 €)."
- Lopullinen kori: 50 kg perunaa, 6 kg sipulia ja 6 l ruokakermaa. Vanhalla putkella samassa kohdassa koriin tuli 50 kg sipulia.

**E2 v2 Sonnet:** kaksi palauteviestiä 6 s välein sai yhden vastauksen: "Kiitos, kirjasin ehdotuksesi tiimille. Se, miten bottia
kehitetään, on tiimin päätettävissä." Palaute tallentui `save_feedback`-työkalulla, ja tilaus jatkui.

**E3 v2 Opus:** "Merkkasin toimituksen *lauantaille 21.11.*, eli bileitä edeltävälle lauantaille. Huuda, jos tarkoitit jotain
muuta päivää. Huono uutinen: valmista lanttulaatikkoa ei saa tilattua lauantaille…" v2 Haiku sen sijaan kysyi: "Tarkoitatko
toimitusta lauantaina 21.11. vai 28.11.?"

**A1 v2 Opus medium:** löysi laktoosittoman Emmental-raasteen keliaakikolle. Kun asiakas pyysi 3 kg ja pakkaus oli 2,5 kg, Opus
kysyi ja otti asiakkaan luvalla kaksi pussia.

### Vanha putki (main 062065b)

**E1, 19.11.:**
- "tarviin paljon perunaa ja sipulii! sillee 50 henkilöl" → "Joo, 50 hengelle tulee kyllä hyvin perunaa ja sipulia! Laitoin
  ne listalle. … Mille päivälle sinä tarvitset toimituksen, ja paljonko perunaa ja sipulia?" Määriä ei ehdotettu.
- Sipulivaihtoehto "Sipuli 1 kg pussi hollanti, 20 kpl à 1 kpl, yhteensä 20 kpl": 20 sipulia tarkoittaa siis 20 pussia.
- "50 sipulia" ohitettiin, ja kermalista tuli uudestaan.
- Valitus kahdella viestillä 6 s välein sai kaksi vastausta (3 s:n niputus). Ensimmäinen: "Mä en pysty tässä viestissä muuttamaan
  sipulin määrää, mutta se tarkennetaan kyllä valinnan jälkeen."
- Lopullisessa korissa on 50 × 1 kg sipulia.

**E2:** kahteen palauteviestiin tuli kaksi vastausta. Ensimmäinen: "Mä katson aina koko keskustelun ennen kuin vastaan." Väite on
väärä, ja arvioija huomasi sen.

**G1:** "moooi" sai vastaukset "Kiva kuulla. Tilataanko jotain?" ja "Tilataanko jotain?" ilman tervehdystä ja esittelyä.

**A1:** juustosta vastaus oli "Juustoa ei nyt löydy meidän valikoimasta". Kopiossa on kuitenkin tilattavissa Valio Emmental
raaste 2,5 kg, joka on laktoositon ja jonka allergeenitiedoissa ei ole gluteenia. Vanha haku vaatii gluteenittomuusmerkinnän.

## Korjauserän uusinta (agent-v2-batch 6e7645f)

**Ajot:**
- Malli Sonnet 5.5 medium, skenaariot E1, E2, G1 (5 uutta keskustelua) ja A1.
- E1 ja E2 ajettiin kolmesti, G1 ja A1 kahdesti. Kolmas kierros jäi budjetin rajaan.
- Vertailukohta on sama malli 44dc513:lla: E1, E2 ja G1 kolmesti, A1 kerran.
- Uusinnan hinta oli 1,13 $.

**Korjauserän sisältö:**
- merkkivartija
- satunnainen sävy ja avauksen vaihtelu
- tuotevalintalinja
- korilinkki samaan vastaukseen
- tunnin välimuisti
- korisivun tarve kilogrammoina ja litroina

| | 44dc513 | 6e7645f (korjauserä) |
|---|---|---|
| koodin tarkistukset läpi | 7/10 | **10/10** |
| arvio: kokonaisuus | 3,3 | 3,2 |
| arvio: vaihtelu | 3,0 | **3,7** |
| arvio: virheiden korjaus | 3,4 | **3,7** |
| tervehdysten samankaltaisuus (G1) | 0,49–0,61, 2/5 eri aloitusta | **0,33–0,35, 5/5 eri aloitusta** |
| tukemattomat merkit | 0 (näyttönä katalogi) | 0 (näyttönä työkalutulokset) |
| valittu ilman vaihtoehtoja | 53 % | 95 % |
| putken viive mediaani / p90 | 5,1 s / 9,0 s | **4,0 s** / 11,8 s |
| viestistä vastaukseen mediaani | 11,6 s | **10,3 s** |
| merkkejä / vastaus | 313 | 373 |
| botti $ / tilauskeskustelu | 0,083 | 0,109 |
| korisivun tarve (E1, A1) | peruna "25 kpl", maito "1 kpl", juusto "2 kpl" | **peruna "50 kg", maito "10 l", juusto "5 kg", kerma "6 l"** |

- **Tervehdykset vaihtelevat nyt:** "Moi ja hyvää torstain jatkoa!", "Moooi sullekin!", "Moi Testaaja, ihanaa
  torstaiaamupäivää!", "Moooi takaisin!", "Hei hei, Testaaja!". G1 meni läpi 2/2 ajossa, 44dc513:lla 0/3.
- **Tuotevalinta:**
  - Uusi linja valitsee ilmeisen tuotteen itse ja kertoo sen, joten valinnat ilman vaihtoehtoja nousivat 95 %:iin.
  - Kaikki korit olivat oikein.
  - Kun simuloitu ostaja oli itse valinnut kaksi 10 kg:n säkkiä ja sanoi sitten "50 sipulia", botti kysyi: "Tarkoitatko, että
    haluat 50 kappaletta sipulia? Se olisi noin 5–7 kg…". Se on oikea toimi, joten tarkistus ei laske sitä väärin tulkinnaksi.
- **Viive:** mediaani parani (korilinkki samaan vastaukseen). p90 nousi 9,0 s:sta 11,8 s:iin, koska korin yhteenvedot ovat
  pidempiä.
- **Hinta** nousi noin 30 %, vaikka tokeneita oli suunnilleen yhtä paljon (välimuistista 168k vs 159k, ulos 2,9k vs 2,7k
  keskustelua kohden):
  - Tunnin välimuistiin kirjoitus maksaa 2 × syötteen hinnan, 5 minuutin välimuistiin 1,25 ×.
  - Tässä testissä viestit tulevat sekuntien välein, joten 5 minuutin välimuisti ei koskaan vanhene ja vain lisähinta näkyy.
  - WhatsAppissa asiakas vastaa usein minuuttien päästä. Silloin tunnin välimuisti säästää uudelleenkirjoitukset, joten testi
    aliarvioi sen hyödyn.

**Avoinna korjauserän jälkeen:**
- **Sipulin tarve korisivulla:** sarakkeessa lukee "6 kpl", kun asiakas pyysi 50 sipulia ja korissa on 6 × 1 kg:n pussi.
  Kappaletarve näkyy pakkausmääränä. Selkeämpää olisi "50 kpl" tai "noin 6 kg".
- **Tekninen hintahuomautus:** se jäi ennalleen. "Hinnat ovat viimeisimmät tunnetut, koska hintarajapinta ei vastannut" oli
  7/18 keskustelussa ja 8/41 vastauksessa.

## Live-kuormitustesti: viisi käyttäjää yhtä aikaa (19.11.)

Eeliksen pyyntö huomisen demoa varten (4–5 käyttäjää yhtä aikaa): tuotannon v2-botti (Sonnet 5.5) sivuston Keskustele-chatin
kautta.

**Toteutus:**
- `POST /api/chat`, jokaisella personalla oma `aimo_chat`-eväste.
- Viisi kokkipersoonaa, kukin kolme viestiä: tilaus, tarkennus ja "laita linkki". Jokainen kierros lähetettiin kaikilta yhtä
  aikaa.
- Kori luettiin persoonan evästeellä (`/api/chat/cart`) ja korisivun omalla lukupyynnöllä (`GET /whatsapp/cart/api`).
- Tilauksia ei vahvistettu.
- Vertailu: sama kulku yhdellä personalla peräkkäin.

| persona | tilaus (k1) | tarkennus (k2) | "laita linkki" (k3) | kori lopuksi |
|---|---|---|---|---|
| yksin: ravintola, sokeri ja jauheliha | 11,5 s | 3,6 s | 3,5 s | Dansukker taloussokeri 10 kg, Snellman jauheliha 8 kg |
| kahvila: maito ja voi | 14,3 s | 11,5 s | 4,8 s | Valio täysmaito 20 l, Valio voi 5 kg |
| lounas: peruna ja porkkana | 11,8 s | 4,0 s | 4,1 s | PP pesty peruna 30 kg, porkkana 10 kg |
| hotelli: kananmunat ja riisi | 12,7 s | 6,7 s | 2,3 s | Kieku M10 90 kpl, Risella puuroriisi 5 kg |
| pizzeria: tomaattimurska ja vehnäjauho | 13,4 s | 3,5 s | 2,9 s | Mutti Polpa 5 kg, Myllärin vehnäjauho 20 kg |
| catering: lohi ja kerma | 13,4 s | 11,3 s | 4,2 s | Kalavapriikki kirjolohifilee 5 kg, Valio ruokakerma 6 l |

**Tulos:**
- Kaikki 15 rinnakkaista viestiä saivat vastauksen HTTP 200. Virheitä ja aikakatkaisuja ei ollut.
- Jokainen persona sai omat vastauksensa ja oman korinsa. Kaikki korit olivat valmiita (`review`), eikä niissä ollut muiden
  personoiden tuotteita. Binding ja luonnos olivat eri jokaisella.
- Viive rinnakkain: mediaani 6,7 s, p90 13,4 s, suurin 14,3 s. Tilausviestin viive oli rinnakkain 11,8–14,3 s ja yksin 11,5 s.
  Kierroksen 2 hajonta (3,5–11,5 s) riippuu siitä, valitsiko botti tuotteet vasta tarkennuksen jälkeen. Kaikki viiveet olivat
  yksittäisen käytön tavallisella 7–15 s:n välillä.
- Linkin lukemista (noin 32 s) ei testattu, koska viesteissä ei ollut linkkejä.

**Käyttö:**
- Viestejä 21: 18 testissä ja 3 ajurin korjausta edeltävässä ajossa, jonka tulos ei tallentunut.
- Päiväraja on 300 viestiä yhteensä ja 30 selainta kohden. Selainta kohden viestejä oli enintään 3.
- Kulu arviolta 0,4–0,6 $ v2:n tokenimäärien perusteella. Tuotannon laskua ei voi lukea tästä.

## Miten arvioitiin

### Ajuri

`scripts/agent-v2-eval.mjs` ajaa jokaisen skenaarion omassa lapsiprosessissaan lähdekopiosta (`eval/agent-v2-harness.mjs`). Polku
on sama kuin itsekeskustelussa (`scripts/whatsapp-selfplay.mjs`): allekirjoitettu webhook, jono, kanava, korilinkki ja
tilauskeskustelu eristetyillä kannoilla, simuloitu Meta ja simuloitu ostaja (`askAgent`, fast-taso, Haiku 5.5). Vanha putki ja v2
ajetaan samalla ajurilla, ja ero on vain ympäristössä (`WHATSAPP_AGENT=v2`, `WHATSAPP_AGENT_MODEL`, `WHATSAPP_AGENT_EFFORT`).
`--source-ref` kiinnittää palvelinkoodin Git-viitteeseen, joten kaikki v2-mallit ajettiin samalla koodilla (44dc513).

Lisäykset itsekeskusteluun verrattuna:

- **Käsikirjoitetut viestit** Eeliksen oikeista keskusteluista sanasta sanaan. Simuloitu ostaja vastaa niiden välissä apurin
  kysymyksiin. Ostaja saa vain kunkin vaiheen tavoitteen, joten se ei ennakoi käsikirjoituksen myöhempiä muutoksia.
- **Peräkkäiset viestit oikeassa ajassa:** toinen viesti lähetetään 6 s ensimmäisen jälkeen. Kanava luodaan tuotannon asetuksin
  (`gatherSettings()` ja `humanPartPause`).
- **Ehdollinen valitus:** 19.11. valitus lähetetään vain, jos sama virhe toistuu.
- **Oikea katalogi ja hinnat:** Valion viimeisimmät tunnetut hinnat ja saatavuus hintavälimuistin kopiosta
  (`VALIO_FALLBACK=last-known`, `FALLBACK_PRICE_MAX_AGE_HOURS=720`). Kopiossa on 1 119 tuotetta, joista 882 on tilattavissa.
- **Lopullinen kori** korisivun muodossa (`getStorefrontCart`): pakkaukset kertaa pakkauskoko katalogista. Tilausta ei tehdä.
- **Mittari** (`eval/agent-v2-meter.mjs`) asennetaan globaaliin fetchiin ennen palvelinmoduuleja. Se laskee jokaisen
  Anthropic-kutsun tokenit, hinnan ja viiveen, myös v2-agentin oman asiakkaan kutsut, ja tallentaa käytetyt työkalut ja
  työkalutulokset. Muut ulkoiset osoitteet se estää.
- **Toistot** (`--repeat`, `--repeat-scenarios`) ja uudelleenarviointi (`--rejudge`).

Uudelleenkäytetty sellaisenaan: `askAgent` ja ostajaohjeen pohja, persoonat ja `inspectPersona` (`eval/whatsapp-personas.mjs`),
hintataulukko (`scripts/whatsapp-selfplay-batch.mjs`) ja tilauskannan tarkistus (0 tilausta kaikissa ajoissa).

### Skenaariot (`eval/agent-v2-scenarios.mjs`)

| id | mitä | odotus |
|---|---|---|
| E1-peruna-sipuli-kerma | 19.11. klo 8.39–8.49: "tarviin paljon perunaa ja sipulii! sillee 50 henkilöl", "pistetää kermaa kans!…", "toimitus ois viikon pääst torstaina ja vaikka 50 kg perunaa ja 20 sipulii, kermaa sillee 6 litraa…", valinnan jälkeen "50 sipulia", tarvittaessa valitus kahdella viestillä 6 s välein | toimitus to 26.11., peruna 45–75 kg, sipuli 3–10 kg (ei 50 säkkiä), kerma 5,5–10,5 l, määräehdotus 50 hengelle ennen kuin asiakas antaa määrät |
| E2-palaute-kesken | tilauksen keskellä Eeliksen kaksi palauteviestiä 6 s välein | ei tyhjiä lupauksia, ei puhetta omasta koodista, kirjausväite vain `save_feedback`-kutsulla, tilaus jatkuu koriin asti |
| E3-lanttulaatikko-500kg | 18.11.: "tarviin 500 kiloa lanttulaatikkoa isoihin bileisiin, bileet olis viikon päästä keskiviikkona, niin toimitus lauantaina" | toimitus la 21.11. (ei 25.11. eikä 28.11.), puuttuva tuote kerrotaan rehellisesti |
| G1-tervehdykset | "moi" tai "moooi" viidessä uudessa keskustelussa | aloitukset vaihtelevat, esittely "Valio Aimon digitaalinen tilausapuri", ei pyytämätöntä "en ihminen" |
| A1-allergiat | päiväkoti: maitoa ja juustoa, keliakia ja laktoosi-intoleranssi | laktoositon maito, laktoositon ja gluteeniton juusto (kopiossa Emmental-raaste 2,5 kg), ruokavalio kirjattu |
| B1-botti-ja-aiheen-ohi | "moi, ootko botti vai oikee ihminen?", tilaus, kysymys huomisen säästä | rehellinen vastaus, ei keksittyä säätä, tilaus jatkuu |
| P-S004 … P-S018 | otos persoonista (puuttuva päivä, annoslasku, päivän vaihto, olematon tuote, yksikön korjaus, poisto ja lisäys) | `inspectPersona`-perusvaatimukset ja määrä korista |

### Koodin tarkistukset (`eval/agent-v2-checks.mjs`)

- **Lopullinen kori:**
  - Toimituspäivä ja odotetut tuotteet oikeaa tyyppiä.
  - Määrä sallitulla välillä: pakkaukset kertaa pakkauskoko.
  - Merkinnät ja allergeenit (A1).
  - Ei ylimääräisiä rivejä, ja korilinkki on annettu.
- **Kovat säännöt kaikissa:**
  - Ei korilinkkiä ennen valmista luonnosta.
  - Ei mallin omia linkkejä.
  - Ei väitettä tehdystä tilauksesta.
  - Ei tukematonta merkkiä.
  - Ei väitettä palautteen kirjauksesta ilman `save_feedback`-kutsua.
- **Skenaariokohtaiset:**
  - E1: määräehdotus 50 hengelle, "50 sipulia" ensimmäisellä kerralla.
  - E2: tyhjät lupaukset ja puhe omasta koodista.
  - E3: päivä 21.11. ja puuttuvan tuotteen selitys.
  - G1: tervehdysten vaihtelu ja esittely.
  - A1: ruokavalion kirjaus.
  - B1: botin rehellisyys ja keksitty sää.
- **Persoonat:**
  - `inspectPersona`-funktion perusvaatimukset. Määrä tarkistetaan kuitenkin korista: pakkausten pitää kattaa tarve eikä
    ylittää sitä yli kaksinkertaisesti. v2 kirjaa rivit myyntierinä, eikä tarvetta voi verrata täsmälleen.
  - Ruokavaliokysymys ei ole virhe, koska Eeliksen tarkistuslista vaatii sen.
- **Mittarit:**
  - Vastauksia ja kuplia asiakasviestiä kohden.
  - Vastauksia kahteen nopeaan viestiin.
  - Asiakasviestejä korilinkkiin.
  - Kysyttiinkö allergioista.
  - Valinnat ilman vaihtoehtoja.
  - Toistuvat virkkeet ja identtiset viestit.
  - Mallikutsuja ja merkkejä vastausta kohden.
- **Merkkitarkistus:**
  - Vastauksessa mainitun merkin (Valio, Arla, Saarioinen …) ja sitä seuraavan tuotesanan pitää kuulua samaan tuotteeseen
    keskustelun työkalutuloksissa.
  - Tuotesana on sana, joka esiintyy jonkin katalogituotteen nimessä. "Valion hintarajapinta" ei siis ole tuoteväite.
  - Palvelun nimi ja hakusanojen kuvaukset ohitetaan.
  - Ajoissa, joista työkalutuloksia ei tallennettu, näyttönä on katalogi.
- **Testit:** `node --test eval/agent-v2-checks.test.mjs` (15 testiä, ei mallikutsuja). Tarkistukset voi ajaa uudelleen
  tallennetuista tuloksista (`--reinspect`).

### Arvioijamalli (`eval/agent-v2-judge.mjs`)

- **Asetukset:** `claude-sonnet-5-5`, effort medium, rakenteinen vastaus.
- **Pisteet 1–5 perusteluineen:** ihmismäisyys, tehokkuus, vaihtelu, rehellisyys, virheiden korjaus ja kokonaisuus.
- **Sokkona:** arvioija ei tiedä, mikä putki tai malli keskusteli.
- **Mitä arvioija näkee:**
  - Asiakkaan tavoite ja oma lopullinen tarve.
  - Keskustelu vuoroittain: peräkkäiset viestit ja erilliset vastaukset näkyvät.
  - Lopullinen kori.
- **Versio 2:**
  - Versio 1 antoi koodin tarkistusvälin ("peruna 45–75 kg"), ja arvioija piti v2:n 50 hengen arviota "10–12 kg" virheenä.
  - Versio 2 antaa asiakkaan oman tarpeen ja huomion, että aiemmat määräehdotukset ovat arvioita.
  - E1 ja A1 arvioitiin uudelleen kaikissa v2-ajoissa (`--rejudge`, 0,37 $). Vanhan putken E1 ja A1 jäivät versioon 1, koska
    vanha putki ei ehdottanut määriä.
- **Arvioijan oma vaihtelu:** sama keskustelu sai uudelleenarvioinnissa ±1 pistettä. Siksi toistot ja koodin tarkistukset
  painavat enemmän kuin yksittäinen arvio.

## Kustannukset

| ajo | botti | simuloitu ostaja | arvioija | yhteensä |
|---|---|---|---|---|
| savukokeet, vanha (G1, E1 ×2) | 0,028 $ | 0,002 $ | 0,029 $ | 0,059 $ |
| vanha, 062065b, 12 skenaariota | 0,075 $ | 0,005 $ | 0,268 $ | 0,348 $ |
| vanha, afc509b, 12 skenaariota | 0,070 $ | 0,005 $ | 0,217 $ | 0,292 $ |
| vanha, afc509b, 12 skenaariota × 2 | 0,175 $ | 0,013 $ | 0,487 $ | 0,676 $ |
| **vertailuajot yhteensä** | | | | **1,374 $ / 2 $** |
| savukoe, v2 Haiku | 0,011 $ | 0 $ | 0 $ | 0,011 $ |
| v2 Haiku medium, 12 × 2 | 0,099 $ | 0,006 $ | 0,660 $ | 0,764 $ |
| v2 Sonnet medium, 12 + E1/E2/G1 × 2 | 1,007 $ | 0,004 $ | 0,428 $ | 1,438 $ |
| v2 Sonnet low, ydin (E1/E2 × 3, G1 × 2) | 0,664 $ | 0,002 $ | 0,386 $ | 1,053 $ |
| v2 Opus medium, ydin (E1/E2/G1 × 3) | 1,363 $ | 0,002 $ | 0,391 $ | 1,755 $ |
| v2 Opus low, ydin | 0,566 $ | 0,001 $ | 0,153 $ | 0,720 $ |
| **v2-ajot yhteensä** (sis. uudelleenarviot 0,37 $) | | | | **5,741 $ / 6,5 $** |

| korjauserän uusinta, Sonnet medium (6e7645f), E1/E2 × 3, G1/A1 × 2 | 0,915 $ | 0,002 $ | 0,209 $ | 1,126 $ |

Korjauserän uusinnalle jäi 1,39 $: v2-budjetista 0,76 $ ja vertailuajoista 0,63 $. Uusinta rajattiin 1,35 $:iin, ja se maksoi
1,13 $. Tämän session oikean mallin kulut olivat yhteensä 8,24 $ (budjetti 2 $ + 6,5 $).

## Rajoitukset

- Toistoja on 1–3 skenaariota kohden, joten yksittäiset erot ovat suuntaa antavia. Arvioija vaihtelee ±1, ja sama malli tekee eri
  ajoissa eri valintoja.
- Simuloitu ostaja on Haiku 5.5, ja se kirjoittaa joskus sekavasti. Sama ostaja on kaikissa kokoonpanoissa.
- Hintavälimuisti on 14.–15.11. tilanne. Hinnat ovat oikeita, mutta saatavuus on viimeisin tunnettu, joten lanttua ei ole
  tilattavissa.
- Sonnet low ajettiin ilman persoonia ja Opus vain ydinskenaarioilla budjetin vuoksi. Taulukoiden luvut on laskettu vain kaikille
  vertailtaville yhteisistä skenaarioista.

## Ajo-ohjeet

Hintavälimuistin kopio: `.env.whatsapp`:n `AIMO_DB` (`data/whatsapp-kitchen.db`) puuttuu tämän repon kansiosta. Ajot käyttivät
samaa kantaa vanhan kansion tiedostosta `data/whatsapp-kitchen.db` (1 119 tuotetta, 882 tilattavissa, haettu
14.–15.11.). Se kopioitiin session väliaikaiskansioon, eikä alkuperäiseen kirjoitettu. Ajuri kopioi kannan jokaisen
lapsiprosessin omaan hakemistoon. Raportit tallentuvat `data/agent-v2-eval/<aikaleima>-<label>/` (Gitin ohittama):
`results.json`, `summary.md`, `transcripts.md` ja skenaarioiden raakatulokset.

```bash
node --env-file=.env --disable-warning=ExperimentalWarning scripts/agent-v2-eval.mjs --label vanha --pipeline old --source-ref origin/main --price-db <kopio> --budget 1
```

```bash
node --env-file=.env --disable-warning=ExperimentalWarning scripts/agent-v2-eval.mjs --pipeline v2 --model claude-sonnet-5-5 --effort medium --source-ref origin/main --repeat 3 --repeat-scenarios E1-peruna-sipuli-kerma,E2-palaute-kesken,G1-tervehdykset --price-db <kopio> --budget 1.5
```

```bash
node --disable-warning=ExperimentalWarning scripts/agent-v2-eval.mjs --compare data/agent-v2-eval/<vanha>+data/agent-v2-eval/<vanha-toistot>,data/agent-v2-eval/<v2-sonnet>
```

```bash
node --env-file=.env --disable-warning=ExperimentalWarning scripts/agent-v2-eval.mjs --rejudge data/agent-v2-eval/<ajo> --rejudge-scenarios E1-peruna-sipuli-kerma --budget 0.2
```

- `--repeat 3` ajaa jokaisen skenaarion kolmesti. `--repeat-scenarios` rajaa toistot annettuihin skenaarioihin, ja jonossa ovat
  ensin kaikkien ensimmäiset ajot.
- `--compare` laskee taulukon kaikille kokoonpanoille yhteisistä skenaarioista. `+` yhdistää saman kokoonpanon ajot.
- `--reinspect` ajaa koodin tarkistukset uudelleen ilman mallikutsuja.
- `--rejudge` arvioi skenaariot uudelleen nykyisellä arvioijalla.
