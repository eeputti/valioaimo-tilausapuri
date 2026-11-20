# Vahvistettu tilaus maksusivulle ja kiitosviesti WhatsAppiin

Kun kokki vahvistaa tilauksen korisivulla (**Siirry maksamaan**), gateway merkitsee sen tilaan `confirmed`. Botti välittää tilauksen Cloudflare Workerille, jonka maksusivu näyttää sen. Kun demomaksu hyväksytään, Worker pyytää bottia lähettämään tilaajalle kiitosviestin WhatsAppiin. Se on tilausvahvistus: sähköpostia ei lähetetä.

```
Korisivu: Siirry maksamaan
   │ POST /whatsapp/cart/api (vahvistus gatewayssa)
   ▼
Vercel-botti (server/cloud.mjs: pushEvents ennen korisivun vastausta, minuutin ajastin varmistaa)
   │ POST /api/order-events  (Bearer SYNC_TOKEN, HTTPS)
   ▼
Worker aimo-order-demo → D1 order_events + demo_payments
   │ maksusivu: demomaksu hyväksytty
   │ POST /webchat/api/order-paid  (Bearer WEBCHAT_SECRET, ctx.waitUntil)
   ▼
Vercel-botti (server/whatsapp/order-paid.mjs) → WhatsApp-kiitosviesti tilaajalle
```

## Sopimus: `POST /api/order-events`

```json
{
  "version": 1,
  "observedAt": 1763121600000,
  "ledgerHead": "<gatewayn päätösketjun sha256, 64 heksaa>",
  "order": {
    "orderId": "AGW-20261114-0001", "channel": "whatsapp", "status": "confirmed",
    "createdAt": "2026-11-14T12:00:00.000Z", "deliveryDate": "2026-11-16",
    "net": 74.1, "lineCount": 1,
    "lines": [{ "productId": "1234", "name": "Laktoositon maito", "quantity": 20, "unit": "l", "net": 74.1 }]
  }
}
```

- `order` on sama sallittujen kenttien projektio kuin tilannekuvassa (`deploy/cloudflare/src/protocol.ts`), ja sama validointi. Vain `confirmed` hyväksytään. Muut kentät ohitetaan.
- Tilauksen ilmentymä (numero ja luontiaika) on idempotenssiavain. Sama tapahtuma uudelleen palauttaa `duplicate: true`. Jos nollattu gateway antaa saman numeron uudelle tilaukselle, uudempi korvaa vanhan maksuineen ja jälkineen (#24).
- `observedAt` saa olla enintään 5 min vanha.
- Tilaukselle luodaan demomaksu, kun `DEMO_PAYMENTS_ENABLED=true` ja summa on tiedossa. Ilman summaa tilaus tallentuu ilman maksua, eikä reitti jumitu (#25).

Vastaus: `{ "ok": true, "orderId": "...", "duplicate": false, "replaced": false }`. Julkaisija (`deploy/cloudflare/publish-orders.mjs`) yrittää epäonnistunutta tilausta uudelleen kasvavin välein, ja pysyvää 4xx-hylkäystä se ei toista.

## Demomaksu

- Maksusivu `/demo-payment.html#<tilausnumero>.<tunniste>` aukeaa vain tilauksen omalla linkillä. Botti antaa linkin korisivulle vahvistuksen jälkeen (`server/whatsapp/checkout.mjs`).
- **Maksa** tai **Hyväksy lasku** tekee vain demomerkinnän. Korttitietoja ei kysytä eikä rahaa siirry. Uusinnat ja tuplaklikkaukset säilyttävät ensimmäisen maksuajan.

## Kiitosviesti WhatsAppiin

- Hyväksytty maksu kutsuu taustalla botin reittiä `POST /webchat/api/order-paid` (`deploy/cloudflare/src/order-paid.ts`). Botin osoite on D1-asetus `bot_backend_url`, sama kuin selainkeskustelussa. 5xx-vastauksen tai aikakatkaisun jälkeen yritetään kerran uudelleen.
- Botti etsii gatewayn tilauksesta tilaajan (`buyerId` `whatsapp-demo-<binding>`) ja lähettää yhden viestin: kiitos, tilausnumero, toimituspäivä ja "Tilaa multa milloin vain uudestaan!". Taulu `order_notices` estää tuplaviestit.
- Selainkeskustelun asiakkaille, uudelleen liitetyille numeroille ja tuntemattomille tilauksille ei lähetetä mitään. Meta ottaa vapaan viestin vastaan vain 24 tunnin sisällä asiakkaan viimeisestä viestistä, joten myöhemmin maksettu tilaus jää ilman viestiä (`send_failed` lokissa).

## Tarkistukset

`npm --prefix deploy/cloudflare test` kattaa tallennuksen rinnakkaisissa uusinnoissa, väärän avaimen, muun kuin vahvistetun tilauksen, nollatun gatewayn, maksun linkit ja botin kutsun. `test/whatsapp-order-paid.test.mjs` kattaa kiitosviestin.
