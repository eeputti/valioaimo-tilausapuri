// Portin ainoa kello. Kaikki aikavertailut (tilausaikaraja, tarjouksen voimassaolo, päiväkatto) kulkevat tämän kautta.
// DEMO_NOW=2026-11-14T10:00:00+02:00 kiinnittää kellon alkamaan annetusta hetkestä, ja jokainen vastaus kertoo ajan olevan simuloitu.
// Syy: mock-rajapinnan Stock-tuotteiden tilausaika umpeutuu su 15.11. klo 17.00, minkä jälkeen mikään ei olisi tilattavissa oikealla kellolla.
// DEMO_NOW_LOOP_MINUTES=420 kierrättää demokellon: se kulkee DEMO_NOW:sta eteenpäin ja palaa alkuun annetun ajan välein.
// Syy: testirajapinta on jäädytetty (toimitus aina ma 16.11., raja su 15.11. klo 17.00), joten jatkuvasti päällä oleva demo
// ei saa koskaan ylittää rajaa. Esim. DEMO_NOW=2026-11-15T09:00:00+02:00 ja 420 min pitää kellon su klo 9–16 välillä.
// DEMO_NOW_ANCHOR (oikea aika, esim. 2026-11-15T18:00:00Z) kiinnittää kellon lähtöhetken. Pilvessä on monta lyhytikäistä
// prosessia: ilman ankkuria jokainen aloittaisi kellon omasta käynnistyksestään ja ne näyttäisivät eri aikaa.
const anchorRaw = (process.env.DEMO_NOW_ANCHOR || '').trim();
const anchor = anchorRaw ? Date.parse(anchorRaw) : NaN;
if (anchorRaw && Number.isNaN(anchor)) console.warn(`[clock] DEMO_NOW_ANCHOR="${anchorRaw}" ei ole kelvollinen aika, käytetään käynnistyshetkeä`);
const bootReal = Number.isNaN(anchor) ? Date.now() : anchor;
const demoRaw = (process.env.DEMO_NOW || '').trim();
const demoStart = demoRaw ? parseApiTime(demoRaw)?.getTime() : null;
if (demoRaw && !demoStart) console.warn(`[clock] DEMO_NOW="${demoRaw}" ei ole kelvollinen aika, käytetään oikeaa kelloa`);
const loopRaw = (process.env.DEMO_NOW_LOOP_MINUTES || '').trim();
const loopMs = demoStart != null && /^\d+(?:\.\d+)?$/.test(loopRaw) && Number(loopRaw) > 0 ? Math.round(Number(loopRaw) * 60000) : 0;
if (loopRaw && !loopMs) console.warn(`[clock] DEMO_NOW_LOOP_MINUTES="${loopRaw}" ei ole käytössä (vaatii kelvollisen DEMO_NOW:n ja positiivisen minuuttimäärän)`);

function helsinkiOffset(date) {
  // Europe/Helsinki-offset (+02:00 talvella, +03:00 kesällä) ilman kirjastoja.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Rajapinnan aikaleimat ovat muotoa 2026-11-15T17:00:00+0200. Ilman offsetia aika tulkitaan Helsingin ajaksi. */
export function parseApiTime(value) {
  if (!value) return null;
  let s = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const guess = new Date(`${s}Z`);
    if (Number.isNaN(guess.getTime())) return null;
    return new Date(guess.getTime() - helsinkiOffset(guess) * 60000);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const clock = {
  simulated: demoStart != null,
  /** Kiertääkö demokello. Silloin vuorokaudenajan (esim. tervehdyksen) kannattaa tulla oikeasta kellosta. */
  looping: loopMs > 0,
  now() {
    if (demoStart == null) return new Date(Date.now());
    const elapsed = Math.max(0, Date.now() - bootReal);
    return new Date(demoStart + (loopMs ? elapsed % loopMs : elapsed));
  },
  /**
   * Kiertävän demokellon kierroksen numero oikeasta ajasta (0 ilman kiertoa). Demoaika palaa joka kierroksella alkuun, joten
   * aikaleimasta ei voi päätellä kierrosta: päiväraja ja tarjousten voimassaolo sidotaan tähän (katselmus 15.11. #16).
   */
  cycle() { return loopMs ? Math.floor(Math.max(0, Date.now() - bootReal) / loopMs) : 0; },
  /** Päivämäärä Helsingin ajassa muodossa YYYY-MM-DD. */
  today() { return helsinkiDate(this.now()); },
  info() { return { now: this.now().toISOString(), simulated: this.simulated, ...(loopMs ? { loopMinutes: loopMs / 60000 } : {}), timezone: 'Europe/Helsinki', note: this.simulated ? `DEMO_NOW on asetettu: portin kello on simuloitu${loopMs ? ' ja kiertää' : ''}` : undefined }; },
};

export function helsinkiDate(date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
/**
 * Tämä päivä ja seuraavat päivät viikonpäivineen Helsingin ajassa, esim. "2026-11-18 keskiviikko huomenna".
 * Kielimalli lukee päivät tästä eikä laske viikonpäiviä itse: pelkästä päivämäärästä se päätteli "perjantaiksi" väärin.
 */
export function helsinkiCalendar(now = clock.now(), days = 14) {
  const start = helsinkiDate(now instanceof Date ? now : new Date(now));
  const relative = ['tänään', 'huomenna', 'ylihuomenna'];
  return Array.from({ length: days }, (_, i) => {
    const t = new Date(`${start}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + i);
    const weekday = new Intl.DateTimeFormat('fi-FI', { timeZone: 'UTC', weekday: 'long' }).format(t);
    return [t.toISOString().slice(0, 10), weekday, relative[i]].filter(Boolean).join(' ');
  });
}
export function helsinkiLabel(value) {
  const d = value instanceof Date ? value : parseApiTime(value);
  if (!d) return null;
  return new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
/** Onko tilausaikaraja jo mennyt portin kellon mukaan? null = rajaa ei tiedetä. */
export function cutoffPassed(closingTime) {
  const t = parseApiTime(closingTime);
  return t ? t.getTime() <= clock.now().getTime() : null;
}
