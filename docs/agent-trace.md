# Katso, mitä agentti näki

Demomaksun onnistuttua maksusivulle tulee painike **Katso, mitä agentti näki**. Se avaa Workerin sivun `/agentti.html#TILAUS.LINKKI`, jossa näkyy yhden tilauksen koko polku:

1. **Keskustelu:** kokin WhatsApp-viestit, apurin vastaukset (myös osissa lähetetyt), ostoskorisivun toiminnot ja korin versio jokaisen viestin jälkeen.
2. **Mitä agentti ymmärsi:** tuote, määrä, ruokavalio ja toimituspäivä rakenteisena tarpeena sekä valittu tuote.
3. **Vaihtoehdot:** viimeksi näytetyt tilattavat tuotteet hintoineen, hiilijalanjälki, toimitusvarmuus ja kokin valinta.
4. **Portti tarkisti:** tilausportin päätösketjun rivit: tarjouspyynnöt, allekirjoitetut tarjoukset, allekirjoitusten ja hintojen uusintatarkistus, ostovaltuus, vahti ja vahvistus. Aiemmat tarjouskierrokset ovat taitettuina.
5. **Lopullinen tilaus** ja **koko data JSON-muodossa**.

Sivun yläosassa on viiden vaiheen lyhyt selitys siitä, miten tilausapuri toimii. Ilman linkkiä sivu näyttää vain sen.

## Tiedon kulku

```
Mac / WhatsApp-palvelin                         Cloudflare Worker (aimo-order-demo)
  whatsapp.db, whatsapp-drafts.db, gateway.db
        │ vain luku
  publish-orders.mjs --agent-traces ──POST /api/agent-traces──▶ D1 agent_traces
                                                                     │
  maksusivu (demo-payment.html#TILAUS.LINKKI) ──▶ agentti.html ──GET /api/agent-traces/TILAUS
                                                  (Bearer = saman tilauksen demomaksun linkki)
```

- `deploy/cloudflare/trace-reader.mjs` kokoaa jäljen: tilauksen luonnos löytyy tilauksen `buyerReference`-kentästä, viestit luonnoksen viestituloksista ja samasta numerosta samalta ajalta (enintään kaksi tervehdystä ennen ensimmäistä tilausviestiä), portin rivit tilauksesta ja luonnoksen aikana pyydetyistä tarjouksista.
- Julkaisija lähettää jäljen kerran, kun tilaus on ollut tallessa 10 sekuntia (ostoskorisivun vahvistusviesti ehtii kantaan). Vain WhatsApp-tilaukset, jotka ovat jo julkaisun sallitussa joukossa (`WHATSAPP_DEMO_PHONE`). Tarvitsee `WHATSAPP_DRAFT_DB`:n samasta `.env.whatsapp`:sta kuin palvelin.
- Worker lukee jäljen vain saman tilauksen demomaksun linkillä. Ilman maksuriviä ei ole jälkeäkään.

## Mitä ei julkaista

Puhelinnumerot, jäsensidokset, nimet, asiakas- ja luonnostunnisteet, idempotenssiavaimet, tarjousten allekirjoitukset (vain tieto, että tarjous on allekirjoitettu) ja korilinkit. Julkaisija peittää vapaasta tekstistä linkit, sähköpostit ja puhelinnumerot (`[linkki]`, `[sähköposti]`, `[numero]`). Worker hylkää jäljen, jossa on silti linkki, puhelinnumeron näköinen luku viestissä tai yksityinen kenttänimi.

Jälki aukeaa vain tilauksen omalla linkillä (sama kuin maksusivun). Julkista tilauslistaa ei ole.

## Julkaisu

Pilvibotti julkaisee jäljet Workeriin minuutin ajastimen kutsussa (`server/cloud.mjs`, `publishOrders`). Taulu `agent_traces` on `deploy/cloudflare/schema.sql`:ssä.
