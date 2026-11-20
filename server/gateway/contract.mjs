// YKSI SOPIMUS, kaksi sovitinta. Tässä tiedostossa määritellään portin operaatiot ja niiden JSON Schemat kerran;
// REST (rest.mjs), MCP (mcp.mjs) ja OpenAPI-dokumentti (/openapi.json) generoidaan kaikki näistä.
export const GATEWAY = { name: 'aimo-agent-gateway', title: 'Aimo Agent Gateway', version: '0.3.0' };

// Agentin työohje. MCP-liittymä antaa tämän initialize-vastauksessa, joten jokainen porttiin liittyvä malli saa saman ohjeen.
// Pohjana Daniel Turkkisen valio-aimo-agent-palvelimen ohje; lisätty tarjous, tilaus, hyväksyntä ja päätösketju.
export const AGENT_INSTRUCTIONS = `Olet Valio Aimo -tukkupalvelun ostoagentti. Autat ammattikeittiöitä ja myymälöitä kokoamaan ja tekemään tilauksen. Vastaa käyttäjän kielellä.

Työnkulku:
1. Selvitä toimituspäivä (YYYY-MM-DD) ja jokaisen tuotteen määrä. Jos käyttäjä ei kerro niitä, kysy. Tarkista omat rajasi get_mandate-kutsulla.
2. Hae jokainen tuote search_products-työkalulla lyhyillä hakusanoilla (esim. "rasvaton maito", "kaurajuoma"). Lue interpretedAs: se kertoo, miten haku tulkittiin ja mitä oletettiin. Jos useita yhtä hyviä tuotteita, kerro vaihtoehdot lyhyesti.
3. Pyydä hinta ja saatavuus request_quote-kutsulla vain rajatulle ehdokasjoukolle, kaikki rivit samassa kutsussa. Älä hinnoittele koko hakutulosta.
4. Tarjous on sitova ja allekirjoitettu. Lue rivien tarkistukset ja varoitukset: jos tuote ei ole tilattavissa tai toimitus siirtyy, kerro syy ja ehdota korvaavaa. Älä laske hintoja tai määriä itse, käytä tarjouksen lukuja.
5. Esitä käyttäjälle taulukko: tuote, tuotekoodi, määrä ja myyntierä, veroton hinta, toimituspäivä, toimitusvarmuus ja hiilijalanjälki kun tiedossa, sekä kokonaissumma.
6. Tilaa place_order-kutsulla tarjouksen tunnisteella vasta, kun käyttäjä on pyytänyt tilausta. Jos tila on pending_approval, tilaus odottaa ihmisen hyväksyntää: kerro se äläkä yritä kiertää sitä pilkkomalla tilausta tai tilaamalla uudelleen.
7. Tilauksen tila: get_order. Perustelut ja tehdyt tarkistukset: get_audit_trail.

Jos käyttäjä painottaa vastuullisuutta tai toimitusvarmuutta, käytä search_products-suodattimia maxCo2PerKg ja minDeliveryReliability (0–1).`;

const quantity = {
  type: 'object', additionalProperties: false, required: ['value', 'unit'],
  description: 'Tarve ostajan omassa yksikössä. Portti muuntaa sen myyntiyksiköiksi (laatikko, tölkki, säkki) tuotedatan ja vertailuhinnan perusteella ja pyöristää ylöspäin myyntierään.',
  properties: { value: { type: 'number', exclusiveMinimum: 0 }, unit: { type: 'string', enum: ['L', 'KG', 'PCS'], description: 'L = litraa, KG = kiloa, PCS = kappaleita basis-kentän mukaan' }, basis: { type: 'string', enum: ['items', 'sales'], description: 'Vain PCS: items = yksittäiset tuotteet, sales = myyntiyksiköt (oletus). Pakkauskoon on oltava tiedossa items-muunnosta varten.' } },
};

export const OPERATIONS = [
  {
    name: 'search_products', method: 'POST', path: '/v1/products/search',
    summary: 'Hae tuotteita staattisesta katalogista',
    description: 'Haku 17 546 tuotteen staattisesta katalogista suomeksi tai englanniksi. Ei hintaa eikä saatavuutta: ne kysytään operaatiolla request_quote vain rajatulle ehdokasjoukolle. Vastauksen interpretedAs kertoo, miten portti tulkitsi haun (tuotetyyppi, väittämät) ja mitä se oletti.',
    input: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Vapaa hakusana, esim. "lactose-free milk", "kuohukerma" tai "Arla rasvaton maitojuoma". Väittämät (laktoositon, gluten-free, vegan, organic) tunnistetaan ja muutetaan suodattimiksi.' },
        productType: { type: 'string', description: 'Kuratoitu tuotetyyppi, ks. GET /v1/product-types. Rajaa esim. juomamaidon erilleen kahvimaidosta ja maitojauheesta.' },
        claims: { type: 'array', items: { type: 'string' }, description: 'Vaaditut väittämät, esim. FREE_FROM_LACTOSE, FREE_FROM_GLUTEN, VEGAN, EU_ORGANIC_FARMING. Huom: LOW_LACTOSE ei ole FREE_FROM_LACTOSE.' },
        excludeAllergens: { type: 'array', items: { type: 'string' }, description: 'GS1-allergeenikoodit, joita tuote ei saa sisältää (esim. AP maapähkinä, AW gluteeniviljat).' },
        countryOfOrigin: { type: 'string', description: 'ISO 3166-1 alpha-2 pienellä, esim. fi' },
        brand: { type: 'string' },
        minDeliveryReliability: { type: 'number', minimum: 0, maximum: 1, description: 'Toimitusvarmuuden alaraja väliltä 0–1, esim. 0.95. Tuotteet ilman toimitusvarmuustietoa jäävät pois.' },
        maxCo2PerKg: { type: 'number', minimum: 0, description: 'Hiilijalanjäljen yläraja, kg CO2e tuotekiloa kohti. Tuotteet ilman hiilijalanjälkitietoa jäävät pois.' },
        limit: { type: 'integer', minimum: 1, maximum: 60, default: 30 },
      },
    },
  },
  {
    name: 'request_quote', method: 'POST', path: '/v1/quotes',
    summary: 'Pyydä sitova, allekirjoitettu tarjous',
    description: 'Hakee live-hinnan ja -saatavuuden vain annetuille ehdokkaille, valvoo tilausaikarajan portin kellolla ja palauttaa jokaiselle tarpeelle enintään 5 vaihtoehtoa. Jokainen vaihtoehto on Ed25519-allekirjoitettu tarjous (JWS), jolla on voimassaoloaika. Pois jääneet ehdokkaat palautetaan syykoodeineen. Jos yksittäistä tuotetta ei saada koko määrää, portti ehdottaa osatoimitusta + korvaajaa ostajan mandaatin korvaussääntöjen mukaan.',
    input: {
      type: 'object', additionalProperties: false, required: ['needs'],
      properties: {
        deliveryDate: { type: 'string', format: 'date', description: 'Toivottu toimituspäivä. Jos aikaisin mahdollinen toimitus on myöhemmin, vaihtoehto saa lipun DELIVERY_DATE_SHIFT.' },
        needs: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object', additionalProperties: false, required: ['candidates', 'quantity'],
            properties: {
              ref: { type: 'string', description: 'Ostajan oma tunniste tarpeelle' },
              candidates: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string' }, description: 'Tuotekoodit search_products-hausta. Yksi koodi = juuri tämä tuote; useita = mikä tahansa näistä kelpaa.' },
              quantity,
              rank: { type: 'string', enum: ['price', 'reliability', 'co2'], default: 'price' },
              allowSubstitutes: { type: 'boolean', default: true, description: 'Saako portti ehdottaa korvaajaa, jos pyydettyä tuotetta ei saada koko määrää.' },
            },
          },
        },
        maxOptions: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
      },
    },
  },
  {
    name: 'place_order', method: 'POST', path: '/v1/orders',
    summary: 'Sitoudu tarjoukseen',
    description: 'Tilaus viittaa allekirjoitettuihin tarjouksiin. Portti todentaa allekirjoituksen ja voimassaolon, tarkistaa hinnan, saatavuuden ja tilausaikarajan uudelleen ja arvioi tilauksen ostajan mandaattia vasten. Tulos on confirmed, pending_approval (ihmisen hyväksyntä tarvitaan) tai rejected, aina koneluettavin syykoodein. Sama idempotencyKey palauttaa saman tilauksen eikä luo uutta.',
    input: {
      type: 'object', additionalProperties: false, required: ['offers', 'idempotencyKey'],
      properties: {
        offers: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' }, description: 'request_quote-vastauksen offer-kentät (JWS) sellaisenaan.' },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 120 },
        buyerReference: { type: 'string', maxLength: 120, description: 'Ostajan oma viite, esim. ostotilausnumero.' },
        requestedBy: { type: 'string', maxLength: 200, description: 'Alkuperäinen pyyntö tai pyytäjä; näytetään ihmiselle hyväksyntänäkymässä.' },
        excludeAllergens: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[A-Z]{2,3}$' }, description: 'Tämän tilauksen oma allergiakielto GS1-koodeina (esim. AM maito). Voi vain tiukentaa mandaattia: sisältävä tuote hylätään, ja "voi sisältää" tai puuttuva allergeenitieto vie ihmisen hyväksyntään.' },
      },
    },
  },
  {
    name: 'add_to_order', method: 'POST', path: '/v1/orders/{orderId}/lines',
    summary: 'Lisää tuotteita jo tehtyyn tilaukseen',
    description: '"Unohtui kerma": lisää rivejä vahvistettuun tai hyväksyntää odottavaan tilaukseen ennen tilausaikarajaa. Sama ketju kuin tilauksessa: allekirjoitettu tarjous samalle toimituspäivälle, tuore tarkistus ja mandaatti, joka arvioidaan koko tilauksen uudella summalla. Vastauksen addition.status on applied (lisätty, ihminen saa ilmoituksen), pending_approval (lisäys odottaa ihmistä, alkuperäinen tilaus pysyy voimassa) tai rejected.',
    input: {
      type: 'object', additionalProperties: false, required: ['orderId', 'offers', 'idempotencyKey'],
      properties: {
        orderId: { type: 'string' },
        offers: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' }, description: 'request_quote-vastauksen offer-kentät (JWS). Toimituspäivän pitää olla sama kuin tilauksella.' },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 120 },
        requestedBy: { type: 'string', maxLength: 200, description: 'Alkuperäinen pyyntö; näytetään ihmiselle ilmoituksessa.' },
      },
    },
  },
  { name: 'get_order', method: 'GET', path: '/v1/orders/{orderId}', summary: 'Tilauksen tila', description: 'Palauttaa tilauksen, sen tilan ja syykoodit. Hyväksyntää odottava tilaus vanhenee itsestään, kun tilausaikaraja menee.', input: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string' } } } },
  { name: 'get_audit_trail', method: 'GET', path: '/v1/orders/{orderId}/audit', summary: 'Tilauksen päätösketju', description: 'Hash-ketjutettu tapahtumaloki: tarjouspyyntö, annetut tarjoukset, sääntöarvio syykoodeineen, ihmisen päätös. Sama loki näkyy ostajalle ja Aimolle. chain.valid kertoo, onko ketju ehjä.', input: { type: 'object', additionalProperties: false, required: ['orderId'], properties: { orderId: { type: 'string' } } } },
  { name: 'get_mandate', method: 'GET', path: '/v1/mandate', summary: 'Oma valtuutus', description: 'Palauttaa ostajan mandaatin: hyväksyntätaso, eurokatot, vaaditut väittämät, kielletyt allergeenit ja korvaussäännöt. Agentti näkee rajansa etukäteen eikä joudu arvaamaan.', input: { type: 'object', additionalProperties: false, properties: {} } },
];

// Syykoodit ovat osa sopimusta: agentti voi haarautua niiden perusteella lukematta vapaata tekstiä.
export const REASONS = {
  // tarjousvaihe: miksi ehdokas jäi pois
  UNKNOWN_PRODUCT: { fi: 'Tuotekoodia ei ole katalogissa', en: 'Product code not in catalogue' },
  PRICE_UNAVAILABLE: { fi: 'Hintaa ei saatu rajapinnasta', en: 'No price returned by the pricing API' },
  PRICE_TOO_OLD: { fi: 'Viimeisin tunnettu hinta on liian vanha', en: 'Last known price is too old' },
  AVAILABILITY_UNKNOWN: { fi: 'Saatavuutta ei voitu varmistaa', en: 'Availability could not be confirmed' },
  NOT_DELIVERABLE: { fi: 'Ei toimitettavissa (ei toimitusriviä tai saldo 0)', en: 'Not deliverable (no schedule line or zero stock)' },
  SALES_BLOCK: { fi: 'Myyntiesto', en: 'Sales block' },
  CUTOFF_PASSED: { fi: 'Tilausaika on umpeutunut', en: 'Order cut-off has passed' },
  INSUFFICIENT_STOCK: { fi: 'Saldo ei riitä koko määrään', en: 'Stock does not cover the full quantity' },
  UNIT_NOT_CONVERTIBLE: { fi: 'Määrää ei voi muuntaa tämän tuotteen myyntiyksiköiksi', en: 'Quantity cannot be converted to this product\'s sales units' },
  // mandaatti
  ALLERGEN_BANNED: { fi: 'Sisältää ostajan kieltämän allergeenin', en: 'Contains an allergen banned by the buyer mandate' },
  ALLERGEN_MAY_CONTAIN: { fi: 'Voi sisältää ostajan kieltämää allergeenia: ihminen päättää', en: 'May contain an allergen banned by the buyer mandate: a human decides' },
  ALLERGEN_DATA_MISSING: { fi: 'Tuotteen allergeenitieto puuttuu, eikä kiellon täyttymistä voi todentaa: ihminen päättää', en: 'Allergen data is missing, so the allergen ban cannot be verified: a human decides' },
  REQUIRED_CLAIM_MISSING: { fi: 'Ostajan vaatima väittämä puuttuu', en: 'A claim required by the buyer mandate is missing' },
  CATEGORY_NOT_ALLOWED: { fi: 'Tuoteryhmä ei kuulu mandaattiin', en: 'Category is outside the buyer mandate' },
  APPROVAL_ALWAYS: { fi: 'Mandaatti vaatii ihmisen hyväksynnän jokaiselle tilaukselle', en: 'Mandate requires human approval for every order' },
  SPEND_CAP_ORDER: { fi: 'Tilaus ylittää tilauskohtaisen eurokaton', en: 'Order exceeds the per-order spend cap' },
  SPEND_CAP_DAY: { fi: 'Päivän eurokatto ylittyy', en: 'Daily spend cap would be exceeded' },
  SUBSTITUTION_WITHIN_POLICY: { fi: 'Korvaava tuote, sääntöjen sisällä', en: 'Substitute product, within policy' },
  SUBSTITUTION_OUTSIDE_POLICY: { fi: 'Korvaava tuote ylittää korvaussäännöt', en: 'Substitute product is outside the substitution policy' },
  PARTIAL_FILL_SPLIT: { fi: 'Määrä täytetty usealla tuotteella', en: 'Quantity filled with more than one product' },
  DELIVERY_DATE_SHIFT: { fi: 'Aikaisin toimitus on pyydettyä myöhemmin', en: 'Earliest delivery is later than requested' },
  PRICE_NOT_LIVE: { fi: 'Hinta on viimeisin tunnettu, ei juuri nyt rajapinnasta tarkistettu', en: 'Price is the last known value, not checked live just now' },
  STOCK_UNKNOWN: { fi: 'Tarkkaa saldoa ei tiedetä: rajapinta ei ilmoita määrää (999999)', en: 'Exact quantity unknown: the API reports no real amount (999999)' },
  // taustavahti (watch.mjs): vertaa tilausta ostajan omaan historiaan, voi vain siirtää ihmisen hyväksyntään
  UNUSUAL_QUANTITY: { fi: 'Määrä poikkeaa selvästi ostajan tavallisesta', en: 'Quantity is far above the buyer\'s typical order' },
  ORDER_SPLIT_UNDER_CAP: { fi: 'Sama tuote useassa tilauksessa, jotka yhdessä ylittävät tilauskohtaisen katon', en: 'Same product across several orders that together exceed the per-order cap' },
  // tilausvaihe
  OFFER_MALFORMED: { fi: 'Tarjous on virheellinen', en: 'Offer is malformed' },
  OFFER_INVALID_SIGNATURE: { fi: 'Tarjouksen allekirjoitus ei täsmää', en: 'Offer signature does not verify' },
  OFFER_EXPIRED: { fi: 'Tarjous on vanhentunut', en: 'Offer has expired' },
  OFFER_WRONG_BUYER: { fi: 'Tarjous on annettu toiselle ostajalle', en: 'Offer was issued to a different buyer' },
  OFFER_STALE: { fi: 'Hinta tai saatavuus muuttui tarjouksen jälkeen', en: 'Price or availability changed since the offer' },
  OFFER_ALREADY_USED: { fi: 'Tarjous on jo käytetty toisessa tilauksessa', en: 'Offer was already used in another order' },
  DELIVERY_DATE_MISMATCH: { fi: 'Lisäyksen toimituspäivä ei ole sama kuin tilauksen', en: 'Addition delivery date differs from the order' },
  HUMAN_APPROVED: { fi: 'Ihminen hyväksyi', en: 'Approved by a human' },
  HUMAN_REJECTED: { fi: 'Ihminen hylkäsi', en: 'Rejected by a human' },
  APPROVAL_EXPIRED: { fi: 'Hyväksyntää ei annettu ennen tilausaikarajaa', en: 'No approval before the order cut-off' },
};
export const reason = (code, severity, detail = {}) => ({ code, severity, message: REASONS[code]?.fi || code, messageEn: REASONS[code]?.en || code, detail });

// Kuratoidut tuotetyypit. OLETUS: challenge-datassa kategorioilla on vain koodit, ei nimiä, joten tyypit on määritelty käsin
// tälle demolle (kategoriakoodi + poissulkevat sanat). Tuotannossa nämä tulisivat Aimon tuotehierarkiasta.
export const PRODUCT_TYPES = [
  { id: 'milk', fi: 'Juomamaito ja maitojuoma', en: 'Drinking milk and milk drinks', keywords: ['maito', 'maitojuoma', 'milk'], categories: ['10400'], exclude: /kahvi|caf[eéè]|latte|piimä|annos|kaakao|vanilja|kondens|jauhe/i, excludes: 'kahvimaito, piimä, annospakkaukset, maustetut, kondensoitu, jauhe' },
  { id: 'cream', fi: 'Kerma', en: 'Cream', keywords: ['kerma', 'cream'], categories: ['10401'], exclude: /kahvi|coffee/i, excludes: 'kahvikerma' },
  { id: 'butter', fi: 'Voi', en: 'Butter', keywords: ['voi', 'butter'], categories: ['10500'], exclude: /kirkastettu|clarified/i, excludes: 'kirkastettu voi' },
  { id: 'eggs', fi: 'Kananmunat', en: 'Eggs', keywords: ['kananmuna', 'muna', 'egg'], categories: ['10590'], exclude: null, excludes: '' },
];

// Väittämäsanat molemmilla kielillä → luokittelukoodi. Suodatetaan aina luokittelulla, ei nimellä.
export const CLAIM_PHRASES = [
  [/\blactose[- ]?free\b|\blaktoosit\w*/i, 'FREE_FROM_LACTOSE'],
  [/\bgluten[- ]?free\b|\bgluteenit\w*/i, 'FREE_FROM_GLUTEN'],
  [/\bvegan\b|\bvegaani\w*/i, 'VEGAN'],
  [/\borganic\b|\bluomu\w*/i, 'EU_ORGANIC_FARMING'],
];
