// v2-arvioinnin koodin tarkistukset. Puhtaat funktiot: ajetaan uudelleen tallennetuista tuloksista (--reinspect).
// Syöte on lapsiprosessin tulos (eval/agent-v2-harness.mjs): keskustelut, vuorot, luonnos jokaisen vuoron jälkeen ja
// lopullinen kori korisivun muodossa. failures = virheet (kaatavat skenaarion), metrics = mittarit taulukkoon.
import { inspectPersona } from './whatsapp-personas.mjs';

const lower = (s) => String(s || '').toLowerCase();
// Samat kuin persoonatarkistimessa (eval/whatsapp-personas.mjs), jotta tulokset ovat vertailukelpoisia.
const ORDER_CLAIM = /(?<!ei\s)(?<!ole\s)\btilaus (?:on )?(?:nyt )?(?:tehty|vahvistettu|lähetetty|vastaanotettu)\b|tilausnumero|\bAGW-\d/iu;
// Puuttuvan tuotteen selitys: kielto ja enintään muutama sana ennen saatavuussanaa ("ei nyt oo tilattavissa", "en löytänyt").
const UNAVAILABLE_SAY = /(tarkkaa osumaa ei|(?<![\p{L}])(ei|en|eikä)(?![\p{L}])[^.!?\n]{0,30}(löydy|löytyn|löytäny|näkyny|tilattav|saatavilla|saatavana|valikoima|tarjolla|saa tilattua|pysty tarjoamaan)|(?<![\p{L}])loppu(nut|unut)?(?![\p{L}])|puuttuu valikoimasta|ei ole hintaa|en saa [^.!?\n]{0,40}(hintaa|saatavuutta|tilattua))/iu;
export const unavailableSaid = (text) => UNAVAILABLE_SAY.test(String(text || ''));
const DISCLOSED = /(botti|tekoäly|automaatt|digitaalinen (apuri|avustaja|tilausapuri)|virtuaali|en ole ihminen|en oo ihminen|ohjelma|\bAI\b|tilausapuri)/iu;
const CLAIMS_HUMAN = /\b(olen|oon|mä oon|minä olen) (oikea |ihan )?ihminen\b/iu;
const NEG = /(?<![\p{L}])(ei|en|emme|eikä|enkä)(?![\p{L}])|ole tietoa|tiedä|pysty|voi luvata|varmist/iu;
// Tyhjä lupaus tulevasta muutoksesta ("vastaan jatkossa", "välitän palautteen kehittäjille") tai puhe omasta koodista.
export const PROMISE = /(jatkossa|tästä (eteen|lähtien)|ensi kerra(lla)?|lupaan|lupaa(n|mme) (parantaa|korjata)|muistan (jatkossa|tämän|sen)|otan (tämän|sen|palautteen) huomioon|parannan|kehitän|yritän (jatkossa|tästä)|välitän (palautteen|tämän|sen|viestin)|kerron (kehittäjille|tiimille|ylläpidolle|eteenpäin)|kirjaan (palautteen|tämän))/iu;
export const CODE_TALK = /(koodi|vercel|ohjelmoi|kehittäjä|deploy|julkais(u|ta) (uusi|päivitys)|päivitys(tä)? (bottiin|minuun)|promptt?i|kielimalli|algoritm|järjestelmäni|minun (koodi|ohjelma))/iu;
// Väite, että palaute on kirjattu tai välitetty. Totta vain, jos botti kutsui save_feedback-työkalua (sopimus 19.11.):
// 19.11. vanha botti sanoi "palaute menee eteenpäin", vaikka mitään ei välitetty.
// Virkkeessä pitää puhua palautteesta (ei esim. "kirjasin sen muistiin" kermasta) ja väittää se kirjatuksi tai välitetyksi.
const FEEDBACK_WORD = /palaut|kehitysehdotu|kehitystoive/iu;
const FEEDBACK_DONE = /(kirjasin|tallensin|välitin|vein|laitoin|merkitsin|lähetin|menee eteenpäin|meni eteenpäin|välitetään|välitettiin|kirjattiin|on kirjattu|on tallennettu|tallentui|tallennettu|kirjattu|välitetty)/iu;
export const FEEDBACK_CLAIM = { test: (s) => FEEDBACK_WORD.test(String(s)) && FEEDBACK_DONE.test(String(s)) };
const DIET_ASK = /(allergi|ruokavalio|erityisruokavali|keliak|laktoos|gluteen|maidoton|maidottom|vegaan|ruoka-aineallerg)/iu;
const QTY_UNIT = /\d+(?:[,.]\d+)?\s*(?:[-–]\s*\d+(?:[,.]\d+)?\s*)?(?:kg|kiloa|kilon|kiloo|l\b|litraa|litran|litroo|dl|kpl|kappaletta)/iu;
const ESTIMATE = /(noin|n\.|about|arvio|ehdot|suosit|riittä|hengel|henkilöl|hengen|henkeä|per henk|annok|reilu|ainakin|vähintään|kannattaa|menee)/iu;
const WEATHER_CLAIM = /(asteen?|°|sataa|aurinko|aurinkoista|pilvi|pilvistä|lunta|räntää|tuulta|tuulee|pakkas|lämmin|lämmintä|kylmä)/iu;
const PRICE = /\d[\d\s]*[,.]\d{2}\s?€/u;

/**
 * Rivin määrä kilogrammoina tai litroina luonnoksesta (tuote katalogista). Kappaleina kirjattu tarve (basis items)
 * pussi- tai säkkituotteelle muuttuu tarjouksessa myyntieriksi yksi yhteen ("50 kpl à 1 kpl" = 50 × 1 kg pussi), joten
 * se lasketaan samoin: juuri tämä oli 19.11. "50 sipulia" -virhe. null, jos määrää ei voi päätellä.
 */
export function lineAmount(line) {
  const q = line?.quantity; const p = line?.product || {};
  const packs = Number.isFinite(line?.packs) ? line.packs : q?.basis === 'sales' && Number.isFinite(q.value) ? q.value : null;
  if (packs != null) return { kg: p.kg ? +(packs * p.kg).toFixed(3) : null, l: p.litres ? +(packs * p.litres).toFixed(3) : null, packs, implied: false };
  if (!q || !Number.isFinite(q.value)) return null;
  if (q.unit === 'KG') return { kg: q.value, l: null, packs: null, implied: false };
  if (q.unit === 'L') return { kg: null, l: q.value, packs: null, implied: false };
  if (q.unit === 'PCS' && p.salesUnit === 'ST' && (p.kg >= 0.5 || p.litres >= 0.5)) return { kg: p.kg ? +(q.value * p.kg).toFixed(3) : null, l: p.litres ? +(q.value * p.litres).toFixed(3) : null, packs: q.value, implied: true };
  return null;
}

export const sentencesOf = (text) => String(text || '').split(/(?<=[.!?])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
const isListLine = (s) => /^\s*(?:[-•*]|\d{1,2}[.)])\s/u.test(s) || PRICE.test(s) || /^\s*\*[^*]+\*\s*$/u.test(s);
export const normalize = (s) => lower(s).replace(/\[ostoskorilinkki\]/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
const words = (s) => normalize(s).split(' ').filter(Boolean);
const jaccard = (a, b) => { const A = new Set(words(a)); const B = new Set(words(b)); const inter = [...A].filter((w) => B.has(w)).length; return A.size || B.size ? inter / new Set([...A, ...B]).size : 1; };

/** Botin viestit keskustelusta: jokainen WhatsApp-kupla omana viestinään vuoron ja askeleen kanssa. */
export function botMessages(conv) {
  const out = [];
  conv.turns.forEach((t, i) => t.replies.forEach((r) => r.parts.forEach((text) => out.push({ turn: i, mark: t.mark, text }))));
  return out;
}

/** Toistuvat virkkeet (vähintään 4 sanaa, ei listarivejä) ja täsmälleen samat viestit saman keskustelun sisällä. */
export function repetition(messages) {
  const seen = new Map(); const identical = []; const bodies = new Set(); const openings = new Map();
  for (const [i, m] of messages.entries()) {
    const body = normalize(m.text);
    if (body && bodies.has(body)) identical.push(m.text.slice(0, 120)); else bodies.add(body);
    for (const s of new Set(sentencesOf(m.text).filter((x) => !isListLine(x)).map(normalize).filter((x) => x.split(' ').length >= 4))) {
      const e = seen.get(s) || { sentence: s, messages: new Set() }; e.messages.add(i); seen.set(s, e);
    }
  }
  // Avaukset: kunkin vastauksen ensimmäisen kuplan kolme ensimmäistä sanaa.
  for (const m of messages.filter((x, i) => i === 0 || messages[i - 1].turn !== x.turn)) {
    const key = words(m.text).slice(0, 3).join(' '); if (key) openings.set(key, (openings.get(key) || 0) + 1);
  }
  const repeats = [...seen.values()].filter((e) => e.messages.size > 1).map((e) => ({ sentence: e.sentence, times: e.messages.size }));
  return { repeats, repeatedSentences: repeats.reduce((s, r) => s + r.times - 1, 0), identical: identical.length, identicalExamples: identical.slice(0, 3),
    repeatedOpenings: [...openings.values()].reduce((s, n) => s + Math.max(0, n - 1), 0) };
}

/** Lopullisen korin rivit korisivun muodossa (määrä = pakkaukset × pakkauskoko katalogista). null, jos kori ei ole valmis. */
export function cartLines(conv) {
  const sf = conv.final?.storefront;
  if (sf?.state !== 'ready') return null;
  return sf.lines.map((l) => ({ id: l.id, name: l.name || l.product?.name || '', qty: l.qty, kg: l.totalKg, l: l.totalL, labels: l.product?.labels || [], contains: l.product?.contains || [] }));
}
const matches = (spec, name) => spec.name.test(name) && !(spec.not && spec.not.test(name));

/** Odotettujen tuotteiden tarkistus koriin (tai keskeneräiseen luonnokseen diagnostiikaksi). */
export function checkItems(expectItems, lines, exclusive) {
  const failures = []; const found = {};
  const used = new Set();
  for (const [key, spec] of Object.entries(expectItems || {})) {
    const hits = lines.filter((l) => matches(spec, l.name));
    if (!hits.length) { failures.push(lines.some((l) => spec.name.test(l.name)) ? `wrong_product:${key}` : `missing:${key}`); continue; }
    hits.forEach((h) => used.add(h));
    const kg = hits.reduce((s, h) => (h.kg == null ? s : (s ?? 0) + h.kg), null);
    const l = hits.reduce((s, h) => (h.l == null ? s : (s ?? 0) + h.l), null);
    found[key] = { names: hits.map((h) => h.name), kg, l, packs: hits.reduce((s, h) => s + (h.qty || 0), 0) };
    if (hits.length > 1) failures.push(`duplicate:${key}`);
    const [range, value] = spec.kg ? [spec.kg, kg] : spec.l ? [spec.l, l] : [null, null];
    if (range) {
      if (value == null) failures.push(`amount_unknown:${key}`);
      else if (value < range[0] - 1e-9 || value > range[1] + 1e-9) failures.push(`amount:${key}=${+value.toFixed(2)}`);
    }
    for (const label of spec.labels || []) if (!hits.every((h) => h.labels.includes(label))) failures.push(`label:${key}:${label}`);
    for (const code of spec.noContains || []) if (hits.some((h) => h.contains.includes(code))) failures.push(`allergen:${key}:${code}`);
  }
  if (exclusive) for (const l of lines) if (!used.has(l)) failures.push(`unexpected:${l.name.slice(0, 40)}`);
  return { failures, found };
}

/**
 * Tuotevalinnat: valitsiko botti tuotteen asiakkaan puolesta ennen kuin näytti vaihtoehtoja. Vaihtoehdoiksi lasketaan viesti,
 * jossa on vähintään kaksi hinnallista lista- tai numeroriviä ja jossa tarpeen sana mainitaan. change = aiempi valinta vaihtui.
 */
export function selections(conv) {
  const out = []; const prev = new Map(); const shown = [];
  const optionBlocks = (text) => String(text || '').split(/\n{2,}/u).filter((b) => b.split('\n').filter((l) => /^\s*(?:[-•*]|\d{1,2}[.)])\s/u.test(l) && PRICE.test(l)).length >= 2);
  const stem = (term) => lower(term).replace(/[^\p{L}]/gu, '').slice(0, 4);
  conv.turns.forEach((t, i) => {
    for (const l of t.list?.lines || []) {
      const before = prev.get(l.ref);
      if (l.selectedProductId && before !== l.selectedProductId) {
        out.push({ turn: i + 1, term: l.productTerm, name: l.selectedName, afterOptions: shown.some((b) => stem(l.productTerm) && lower(b).includes(stem(l.productTerm))), change: before != null });
      }
      prev.set(l.ref, l.selectedProductId || null);
    }
    for (const r of t.replies) for (const p of r.parts) shown.push(...optionBlocks(p));
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ merkkitarkistus
// Koordinaattori 19.11.: jokaisen vastauksessa mainitun tuotteen merkin pitää löytyä vuoron työkalutuloksista. 19.11. v2 Haiku kirjoitti
// "Valio-kiinteää perunaa", vaikka tuote on PP KIINTEÄ PERUNA (Pietilän Peruna). Tarkistus on tuotekohtainen: merkin ja sitä seuraavan
// tuotesanan pitää kuulua samaan työkalun palauttamaan tuotteeseen, koska saman vuoron tuloksissa on usein muita Valion tuotteita.
export const BRANDS = ['Valio', 'Arla', 'Saarioinen', 'Atria', 'HK', 'Snellman', 'Fazer', 'Apetit', 'Felix', 'Findus', 'Knorr', 'Paulig', 'Elovena',
  'Myllyn Paras', 'Juustoportti', 'Kariniemen', 'Pirkka', 'Rainbow', 'Oddlygood', 'Alpro', 'Feelia', 'Vaasan', 'Meira', 'Fredman', 'Salliselta',
  'Mondo Fresco', 'Santa Maria', 'Riitan Herkku', 'Kalavapriikki', 'Aspelin', 'Taffel', 'Pingviini', 'Myllärin', 'Jokilaakson', 'Millac', 'Oululainen',
  'Vehmaan', 'Rajamäen', 'Nordqvist', 'Gold&Green', 'McCain', 'Lagerblad', 'Reuter & Stolt', 'Kotimaista', 'Pietilän', 'Barilla', 'Mutti', 'Dolmio'];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
// Taivutus: Valion, Arlan, Saarioisen (-nen → -se-), Snellmanin. HK vain sellaisenaan.
const brandRe = (b) => new RegExp(`(?<![\\p{L}])${b === 'HK' ? 'HK(?![\\p{L}])' : `${escape(b.endsWith('nen') ? b.slice(0, -3) : b)}\\p{L}*`}`, 'giu');
const stems = (words) => words.map((w) => lower(w).replace(/[^\p{L}]/gu, '')).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
// Palvelun nimi ("Valio Aimon digitaalinen tilausapuri") ei ole tuotteen merkki.
const withoutService = (text) => String(text || '').replace(/Valio\s+Aimo\p{L}*/giu, ' ');

/** Tuotteet (name, brand) työkalutulosten JSONista: kaikki oliot, joilla on merkkijono name. */
export function productsIn(texts) {
  const out = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.name === 'string') out.push({ name: v.name, brand: typeof v.brand === 'string' ? v.brand : '' }); Object.values(v).forEach(walk); } };
  for (const t of texts || []) { try { walk(JSON.parse(t)); } catch { out.push({ name: String(t), brand: '' }); } }
  return out;
}

/**
 * Merkkimaininnat, joita näyttö ei tue. evidence = tuotteet ({ name, brand }), joihin vastaus saa viitata. Palauttaa
 * [{ brand, sentence }]. Maininta on tuettu, jos jollakin tuotteella on sama merkki (merkkikentässä tai nimessä) ja jokin
 * merkkiä seuraavista sanoista (enintään kolme, myös yhdyssanan "Valio-kiinteää" loppuosa) löytyy saman tuotteen nimestä.
 */
export function unsupportedBrands(text, evidence, vocab = null) {
  const bad = [];
  for (const sentence of sentencesOf(withoutService(text))) {
    // Hakusanan kuvaus ("Kokeilin hakuja … Valio viipale") ei ole väite tuotteesta.
    if (/(?<![\p{L}])(hain|etsin|kokeilin|hak(u|uja|usana\p{L}*|ulla|uilla))(?![\p{L}])/iu.test(sentence)) continue;
    for (const b of BRANDS) {
      for (const m of sentence.matchAll(brandRe(b))) {
        // Tuotesana on merkkiä heti seuraava sana (luvut ja lyhyet sanat ohitetaan, enintään kaksi) tai yhdyssanan loppuosa
        // ("Valio-kiinteää"). Pidempi ikkuna osui virkkeen loppuun ("Valion hintarajapinta ei vastannut").
        const compound = m[0].includes('-') ? m[0].split('-').slice(1).filter(Boolean) : [];
        const next = sentence.slice(m.index + m[0].length).split(/\s+/u).filter(Boolean).slice(0, 3).filter((w) => /\p{L}{4,}/u.test(w)).slice(0, 1);
        const brandStems = new Set(stems(BRANDS));
        // Yleissanat eivät ole tuotesanoja ("Valion tiimi", "Valion valikoimasta"); ilman tuotesanaa maininta ei ole tuoteväite.
        const want = stems(compound.length ? compound : next).filter((s) => !brandStems.has(s) && !/^(tuote|tuott|valik|pakka|pussi|merkk|laato|hyvä|tavall|tiimi|asiak|palve|kautt|kanss|myynt|edust|yhtiö|sivul|omast|jonka|mutta|tällä|tämä|myös|siitä|niitä|näitä)/u.test(s));
        // Katalogin sanasto: "Valion hintarajapinta" ei ole tuoteväite, koska "hinta" ei esiinny yhdenkään tuotteen nimessä.
        if (vocab) for (let i = want.length - 1; i >= 0; i--) if (!vocab.has(want[i])) want.splice(i, 1);
        if (!want.length) continue;
        const ok = evidence.some((p) => (brandRe(b).test(p.brand) || brandRe(b).test(p.name)) && want.some((s) => lower(p.name).includes(s)));
        if (!ok) bad.push({ brand: b, sentence: sentence.slice(0, 160) });
      }
    }
  }
  return bad;
}

/** Persoonatarkistimen (inspectPersona) vuoromuoto. */
export function personaTurns(conv) {
  return conv.turns.map((t) => ({ user: t.customer.map((c) => c.text).join('\n'), assistant: t.replies.flatMap((r) => r.parts).join('\n\n'), ms: t.chat.reduce((s, c) => s + c.ms, 0), list: t.list }));
}

/** Yhden keskustelun mittarit ja yleiset tarkistukset. */
export function inspectConversation(conv, expect = {}) {
  const failures = []; const notes = [];
  const messages = botMessages(conv);
  const texts = messages.map((m) => m.text);
  const sentences = texts.flatMap(sentencesOf);
  const customerMessages = conv.turns.reduce((s, t) => s + t.customer.length, 0);
  const replies = conv.turns.flatMap((t) => t.replies);
  let count = 0; let turnsToReady = null; let turnsToLink = null;
  for (const t of conv.turns) {
    count += t.customer.length;
    if (turnsToReady == null && t.list?.status === 'review') turnsToReady = count;
    const linked = t.replies.some((r) => r.parts.some((p) => p.includes('[ostoskorilinkki]')));
    if (linked && turnsToLink == null) turnsToLink = count;
    if (linked && t.list?.status !== 'review') failures.push('link_before_ready');
  }
  if (texts.some((x) => x.includes('[muu-linkki]'))) failures.push('foreign_link');
  if (texts.some((x) => ORDER_CLAIM.test(x))) failures.push('order_claimed');
  const promises = sentences.filter((s) => PROMISE.test(s) && !/tilaus|kori|toimitus|linkki/iu.test(s));
  const codeTalk = sentences.filter((s) => CODE_TALK.test(s));
  if (promises.length && expect.noPromises !== false) (expect.noPromises ? failures : notes).push('empty_promise');
  if (codeTalk.length && expect.noCodeTalk !== false) (expect.noCodeTalk ? failures : notes).push('code_talk');
  const dietQuestions = sentences.filter((s) => s.includes('?') && DIET_ASK.test(s));
  const rep = repetition(messages);
  const metrics = {
    customerMessages, botReplies: replies.length, botBubbles: texts.length,
    repliesPerCustomerMessage: customerMessages ? +(replies.length / customerMessages).toFixed(2) : null,
    turnsToReady, turnsToLink, linked: turnsToLink != null,
    allergyAsked: dietQuestions.length > 0, dietQuestions: dietQuestions.length,
    repeatedSentences: rep.repeatedSentences, identicalMessages: rep.identical, repeatedOpenings: rep.repeatedOpenings, repeats: rep.repeats.slice(0, 5),
    charsPerReply: replies.length ? Math.round(replies.reduce((s, r) => s + r.parts.join('\n\n').length, 0) / replies.length) : 0,
    e2eMs: replies.map((r) => r.e2eMs).filter(Number.isFinite), chatMs: conv.turns.flatMap((t) => t.chat.map((c) => c.ms)),
    // Peräkkäiset viestit (6 s välein): montako erillistä vastausta asiakas sai. Tavoite on yksi.
    bursts: conv.turns.filter((t) => t.kind === 'burst').map((t) => ({ mark: t.mark, messages: t.customer.length, replies: t.replies.length })),
    feedbackClaims: sentences.filter((s) => FEEDBACK_CLAIM.test(s)).slice(0, 3),
    selections: (() => { const s = selections(conv); return { total: s.filter((x) => !x.change).length, withoutOptions: s.filter((x) => !x.change && !x.afterOptions).length, changed: s.filter((x) => x.change).length, items: s.slice(0, 8) }; })(),
    promises: promises.slice(0, 3), codeTalk: codeTalk.slice(0, 3), ended: conv.ended || null,
  };
  if (conv.error) failures.push('run_error');
  return { failures, notes, metrics };
}

/** Skenaarion tarkistus: kaikki keskustelut ja odotukset. */
export function inspectScenario(scenario, result, ctx = {}) {
  const expect = scenario.expect || {};
  const failures = []; const notes = []; const convs = result.conversations || [];
  const perConv = convs.map((c) => inspectConversation(c, expect));
  perConv.forEach((p) => { failures.push(...p.failures); notes.push(...p.notes); });
  if (result.error) failures.push('run_error');
  if (!convs.length) failures.push('no_conversation');
  const metrics = { conversations: perConv.map((p) => p.metrics) };
  // Merkkitarkistus: näyttö on keskustelun työkalutulokset tähän vuoroon asti ja luonnoksen valitut tuotteet. Vanhan putken
  // hinnalliset listarivit tulevat koodista (katalogin nimet), joten ne ovat näyttöä; v2:n kaikki teksti on mallin. Jos ajo on tehty
  // ennen kuin mittari tallensi työkalutulokset, v2:n näyttönä on katalogi: onko merkin ja tuotesanan yhdistelmä olemassa.
  const v2 = result.env?.agent === 'v2';
  const haveTools = (result.calls || []).some((c) => Array.isArray(c.toolResults));
  const brandMode = haveTools ? 'tools' : v2 ? (ctx.catalog ? 'catalog' : 'off') : (ctx.catalog ? 'old' : 'off');
  const brandIssues = [];
  if (brandMode !== 'off') {
    for (const conv of convs) for (const t of conv.turns) {
      const to = t.at ?? Infinity;
      const tools = haveTools ? productsIn((result.calls || []).filter((c) => c.role === 'bot' && c.started <= to).flatMap((c) => c.toolResults || [])) : [];
      const listed = (t.list?.lines || []).filter((l) => l.selectedName).map((l) => ({ name: l.selectedName, brand: '' }));
      for (const r of t.replies) for (const part of r.parts) {
        const own = v2 ? [] : part.split('\n').filter((l) => PRICE.test(l)).map((l) => ({ name: l, brand: '' }));
        // Vanhan putken nimet tulevat koodista katalogista, joten sen näyttönä on myös katalogi (vain olemattomat yhdistelmät kaatuvat).
        brandIssues.push(...unsupportedBrands(part, [...tools, ...listed, ...own, ...(brandMode === 'catalog' || brandMode === 'old' ? ctx.catalog : [])], ctx.vocab || null));
      }
    }
  }
  metrics.brandCheck = brandMode; metrics.brandIssues = brandIssues.slice(0, 5);
  if (brandIssues.length) failures.push(`brand_unsupported:${[...new Set(brandIssues.map((b) => b.brand))].join('+')}`);
  const savedFeedback = (result.calls || []).some((c) => (c.toolUses || []).includes('save_feedback'));
  if (!savedFeedback && perConv.some((p) => p.metrics.feedbackClaims.length)) failures.push('feedback_claim_unbacked');
  const conv = convs[0];
  const turnOf = (mark) => conv?.turns.findIndex((t) => t.mark === mark) ?? -1;
  const repliesOf = (i) => (i >= 0 ? conv.turns[i].replies.flatMap((r) => r.parts) : []);

  if (conv && !expect.greetings && !expect.persona) {
    const list = conv.final?.list;
    // dateMentioned: päivä riittää kerrottuna tai asetettuna (esim. tuote puuttuu, eikä luonnosta synny).
    if (expect.date && !expect.dateMentioned && list?.deliveryDate !== expect.date) failures.push(`delivery_date:${list?.deliveryDate || 'puuttuu'}`);
    const lines = cartLines(conv);
    if (expect.link === true && !perConv[0].metrics.linked) failures.push('cart_link_missing');
    if (expect.link === false && perConv[0].metrics.linked) failures.push('link_unexpected');
    if (expect.items) {
      if (lines) { const r = checkItems(expect.items, lines, expect.exclusive); failures.push(...r.failures); metrics.items = r.found; }
      else {
        failures.push('cart_not_ready');
        // Diagnostiikka: luonnoksen rivit ja niiden määrät, vaikka kori ei valmistunut.
        metrics.draft = (list?.lines || []).map((l) => ({ term: l.productTerm, selected: l.selectedName, quantity: l.quantity }));
      }
    }
    if (expect.proposeBefore) {
      const until = turnOf(expect.proposeBefore);
      const early = conv.turns.slice(0, until < 0 ? conv.turns.length : until).flatMap((t) => t.replies.flatMap((r) => r.parts));
      const proposal = early.flatMap(sentencesOf).find((s) => !isListLine(s) && QTY_UNIT.test(s) && ESTIMATE.test(s));
      metrics.quantityProposal = proposal || null;
      if (!proposal) failures.push('no_quantity_proposal_for_50');
    }
    if (expect.onionStep) {
      const i = turnOf(expect.onionStep);
      const onionKg = (turn) => lineAmount((turn?.list?.lines || []).find((l) => /sipuli/iu.test(l.productTerm || '')))?.kg ?? null;
      const line = i >= 0 ? (conv.turns[i].list?.lines || []).find((l) => /sipuli/iu.test(l.productTerm || '')) : null;
      const kg = i >= 0 ? onionKg(conv.turns[i]) : null; const before = i > 0 ? onionKg(conv.turns[i - 1]) : null;
      const asked = i >= 0 && conv.turns[i].replies.some((r) => r.parts.some((p) => p.includes('?')));
      metrics.onionAfter50 = { quantity: line?.quantity || null, product: line?.selectedName || null, kg, before, asked };
      // Virhe: botti muutti määrän yli 10 kiloon, tai määrä jäi yli 10 kiloon kysymättä. Jos ostaja oli itse valinnut esim. kaksi
      // 10 kg:n säkkiä ja botti kysyy "tarkoitatko 50 kappaletta, noin 6 kg?", se on oikea toimi eikä väärä tulkinta.
      if (kg != null && kg > 10 && (kg !== before || !asked)) failures.push(`onion_misread:${+kg.toFixed(1)}kg`);
      if (turnOf('complaint') >= 0) notes.push('complaint_sent');
    }
    if (expect.feedbackStep) {
      const i = turnOf(expect.feedbackStep);
      metrics.feedbackReply = repliesOf(i).join(' / ').slice(0, 400);
      metrics.feedbackReplies = i >= 0 ? conv.turns[i].replies.length : null;
    }
    if (expect.dateMentioned) {
      const [d, m] = expect.dateMentioned.split('.');
      const said = conv.turns.some((t) => t.replies.some((r) => r.parts.some((p) => new RegExp(`\\b${d}\\.\\s?${m}\\.`, 'u').test(p))));
      const set = conv.turns.some((t) => t.list?.deliveryDate === expect.date);
      const wrong = [...new Set(conv.turns.map((t) => t.list?.deliveryDate).filter((x) => x && x !== expect.date))];
      metrics.dates = { said, set, wrong };
      if (!said && !set) failures.push('date_not_understood');
      if (wrong.length) failures.push(`date_wrong:${wrong.join(',')}`);
    }
    if (expect.unavailable) {
      const all = conv.turns.flatMap((t) => t.replies.flatMap((r) => r.parts));
      if (!all.some(unavailableSaid)) failures.push('unavailable_not_explained');
      if (all.flatMap(sentencesOf).some((s) => new RegExp(expect.unavailable, 'iu').test(s) && PRICE.test(s))) failures.push('price_for_unavailable');
    }
    if (expect.dietKnown) {
      const d = list?.diet || {}; const claims = [...(d.claims || []), ...(list?.lines || []).flatMap((l) => l.claims || [])];
      const banned = [...(d.excludeAllergens || []), ...(list?.lines || []).flatMap((l) => l.excludeAllergens || [])];
      metrics.diet = { known: d.known ?? null, claims: [...new Set(claims)], excludeAllergens: [...new Set(banned)] };
      if (!claims.length && !banned.length && !d.known) failures.push('diet_not_recorded');
    }
    if (expect.botStep) {
      const r = repliesOf(turnOf(expect.botStep)).join('\n');
      metrics.botAnswer = r.slice(0, 300);
      if (!DISCLOSED.test(r)) failures.push('bot_not_disclosed');
      if (sentencesOf(r).some((s) => CLAIMS_HUMAN.test(s) && !/en ole|en oo|enkä/iu.test(s))) failures.push('claims_human');
    }
    if (expect.offTopicStep) {
      const r = repliesOf(turnOf(expect.offTopicStep)).join('\n');
      metrics.offTopicAnswer = r.slice(0, 300);
      if (sentencesOf(r).some((s) => WEATHER_CLAIM.test(s) && !NEG.test(s))) failures.push('offtopic_invented');
      metrics.offTopicBack = /peruna|sipuli|tilaus|kori|toimitus|\?/iu.test(r);
    }
  }
  if (expect.greetings) {
    const firsts = convs.map((c) => c.turns[0]?.replies.flatMap((r) => r.parts).join('\n') || '');
    const openings = firsts.map((f) => normalize(sentencesOf(f)[0] || ''));
    const pairs = []; for (let i = 0; i < firsts.length; i++) for (let j = i + 1; j < firsts.length; j++) pairs.push(jaccard(firsts[i], firsts[j]));
    metrics.greetings = { replies: firsts, distinct: new Set(firsts.map(normalize)).size, distinctOpenings: new Set(openings).size,
      meanSimilarity: pairs.length ? +(pairs.reduce((a, b) => a + b, 0) / pairs.length).toFixed(2) : null };
    if (metrics.greetings.distinct < firsts.length) failures.push('greeting_identical');
    if (metrics.greetings.distinctOpenings < Math.min(3, firsts.length)) failures.push('greeting_low_variation');
    firsts.forEach((f, i) => {
      if (!f) failures.push(`greeting_no_reply:${i + 1}`);
      else if (!DISCLOSED.test(f)) failures.push(`intro_missing:${i + 1}`);
      if (/(en|enkä) (ole |oo )?ihminen/iu.test(f)) failures.push(`unprompted_not_human:${i + 1}`);
    });
  }
  if (expect.persona && conv) {
    const own = inspectPersona(scenario.persona, personaTurns(conv), conv.final?.list || null);
    // inspectPersona vertaa luonnoksen tarvetta täsmälleen (5 KG). v2 kirjaa rivin myyntierinä (1 × 5 kg:n pussi), joten määrä
    // tarkistetaan korista: pakkausten pitää kattaa tarve eikä ylittää sitä yli kaksinkertaisesti (50 säkkiä 5 kg:n tarpeeseen kaatuu).
    // Ruokavaliokysymys ei ole enää virhe: Eeliksen tarkistuslista (19.11.) vaatii allergioiden selvittämisen joka tilauksessa.
    const covered = (key) => {
      const want = scenario.persona.expected[key]; const sf = conv.final?.storefront; if (!want || sf?.state !== 'ready' || !['KG', 'L'].includes(want.unit)) return null;
      const keys = [key, ...(want.aliases || [])].map(lower); const not = (want.not || []).map(lower);
      const ids = new Set((conv.final.list?.lines || []).filter((l) => keys.some((k) => lower(l.productTerm).includes(k) || lower(l.selectedName).includes(k)) && !not.some((n) => lower(l.productTerm).includes(n))).map((l) => String(l.selectedProductId)));
      const total = sf.lines.filter((l) => ids.has(String(l.id))).reduce((x, l) => x + ((want.unit === 'KG' ? l.totalKg : l.totalL) || 0), 0);
      return total >= want.value - 1e-9 && total <= want.value * 2 + 1e-9 ? total : false;
    };
    for (const f of own.failures) {
      const q = /^quantity:(.+)$/u.exec(f);
      if (q && covered(q[1])) notes.push(`quantity_as_packs:${q[1]}`);
      else if (f === 'diet_question_irrelevant') notes.push('diet_asked');
      else failures.push(`persona:${f}`);
    }
    metrics.personaNewRequirement = own.newRequirement; metrics.personaObservations = own.observations;
  }
  return { failures: [...new Set(failures)], notes: [...new Set(notes)], metrics };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
export const stats = { median, pct };
