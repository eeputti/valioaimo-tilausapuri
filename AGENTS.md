# Työohjeet: Codex ja Claude Code

Tämä on Eelis Puron repo `eeputti/valioaimo-tilausapuri`. Se on julkinen GitHubissa, joten älä kirjaa tänne mitään,
mitä ei saa näyttää muille. Kaikki WhatsApp-tilausapurin kehitys, korjaukset,
testit, dokumentit ja julkaisut tehdään täällä (`/Users/eeputti/developer/valioaimo-tilausapuri`). Muihin repoihin
tai kansioihin ei tehdä muutoksia, eikä tätä repoa mainita niissä.

## Aloita tästä

- Lue `TYOLOKI.md` ja `README.md`. Tarkista `git status`, nykyinen haara ja viimeisimmät commitit.
- Hae etämuutokset komennolla `git fetch origin` ennen työtä ja ennen pushia. Jos työpuu on puhdas ja jäljessä, päivitä
  komennolla `git pull --ff-only`. Jos työpuussa on muutoksia, selvitä ensin kenen ne ovat.
- Usea sessio voi työskennellä tässä kansiossa yhtä aikaa. Älä peru, ylikirjoita tai ota omiin nimiisi toisen muutoksia.
  Älä käytä `reset --hard`, `clean` tai force pushia. Jos yhteisessä kansiossa on muiden keskeneräistä työtä, tee oma
  työsi erillisessä worktreessä `origin/main`in päällä.

## Tallenna työ GitHubiin

- Tee jokaisesta valmiista työvaiheesta selkeä commit ja push haaraan `main`. Eelis on valtuuttanut tavallisten
  työvaiheiden commitin ja pushin; erillistä vahvistusta ei tarvita joka kerta.
- Kirjaa samaan commitiin `TYOLOKI.md`: mitä muuttui, olennaiset päätökset ja syyt, tarkistukset ja tulokset sekä
  keskeneräiset asiat. Lisää uusin merkintä ylimmäksi. Älä kirjaa salaisuuksia tai koko keskusteluhistoriaa.
- Älä lisää Gitiin `.env`-tiedostoja, avaimia, kantoja, `data/`-kansiota, `node_modules`-hakemistoa tai kaupallisia
  fontteja (`*.otf`). Ne ovat Gitin ohittamia ja ovat vain tämän kansion työpuussa.
- Pushin jälkeen varmista etähaaran commit. Älä ilmoita työtä GitHubissa olevaksi ennen sitä.

## Julkaisut

- Botin (Vercel) ja Worker-sivuston (Cloudflare) julkaisee vain sessio E. Muut sessiot pushaavat ja pyytävät E:tä
  julkaisemaan Eeliksen luvalla.
- Ohjeet: `docs/vercel.md` (tilannevedos tämän repon `origin/main`ista, katalogi, tuotekuvat ja fontit työpuusta) ja
  `docs/cloudflare.md`.

## Tarkistukset

- `npm test`, `npm --prefix deploy/cloudflare test`, `npm run aimo:eval` ja `npm run aimo:eval:spoken`.
- GitHub Actions ajaa testit ilman katalogia ja fontteja. Katalogia lukeva testi tarvitsee ohituksen:
  `{ skip: !fs.existsSync(CATALOG) && 'paikallinen katalogi puuttuu' }`.
- Mallipohjaiset arvioinnit ja itsepelit (`scripts/agent-v2-eval.mjs`, `scripts/whatsapp-*`) vain erikseen sovittuna ja
  eristetyillä kannoilla.
