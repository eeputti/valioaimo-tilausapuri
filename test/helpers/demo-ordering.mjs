// Testien yhteiset palat WhatsApp-tilausdemolle: synteettinen tuotelista, kaksi yhdistettyä testikeittiötä,
// tilausmoottorin testityökalut, luonnosvarastoon perustuva tilausyhteys, testipalvelin ja Metan webhook-viesti.
// Ei mallikutsuja, ei Valion rajapintaa eikä oikeita tilauksia.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { codeHash } from '../../server/whatsapp/store.mjs';
import { shoppingListView } from '../../server/shopping-list/index.mjs';

export const KITCHEN_A = '358401234567';
export const KITCHEN_B = '358409876543';
export const META_PHONE_ID = '12345';

export const MILK_AND_BUTTER = [
  { id: 'milk-1', name: 'Maito', category: '10400' },
  { id: 'milk-2', name: 'Maito laktoositon', category: '10400' },
  { id: 'butter-1', name: 'Voi', category: '10500' },
  { id: 'butter-2', name: 'Voi suolaton', category: '10500' },
];

// Sääntötulkki lukee tuotelistan ladatessaan, joten tämä kutsutaan ennen understand.mjs:n tuontia.
export function useSyntheticCatalog(label, products = MILK_AND_BUTTER) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-catalog-`));
  process.env.AIMO_CATALOG = path.join(folder, 'catalog.json');
  fs.writeFileSync(process.env.AIMO_CATALOG, JSON.stringify(products));
  after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

export function linkTestKitchens(wa, kitchens = [[KITCHEN_A, 'Keittiö A'], [KITCHEN_B, 'Keittiö B']]) {
  for (const [phone, company] of kitchens) {
    const { code } = wa.invite(phone, company, 'Testaaja');
    wa.pair(phone, codeHash(code));
  }
}

// Yksi vaihtoehto jokaiselle riville ja 10 € rivihinta. Kutsujat voivat kirjata kutsut omiin laskureihinsa.
export function stubOrderTools({ now, total = (draft) => 10 * draft.lines.length, onSuggest, onQuote, submit }) {
  const optionFor = (line) => ({
    productId: `P-${line.ref}`, name: `${line.productTerm} testituote`,
    salesUnits: 1, salesUnitLabel: 'ltk', covers: line.quantity, lineNet: 10,
  });
  const pricedLine = (line) => ({
    ref: line.ref, name: line.selectedName,
    salesUnits: 1, salesUnitLabel: 'ltk', lineNet: 10, covers: line.quantity,
  });
  return {
    async suggest(args) {
      onSuggest?.(args);
      return { issues: [], lines: args.draft.lines.map((line) => ({ ref: line.ref, options: [optionFor(line)] })) };
    },
    async quote(args) {
      onQuote?.(args);
      const { draft } = args;
      return {
        quoteId: `Q-${draft.id}-${draft.revision}`,
        expiresAt: new Date(now() + 60 * 60 * 1000).toISOString(),
        issues: [],
        totals: { net: total(draft) },
        lines: draft.lines.map(pricedLine),
      };
    },
    submit,
  };
}

// Tilausyhteys, joka lukee listan ja vuoron tuloksen luonnosvarastosta. Varasto ja vuorokäsittelijä annetaan
// funktioina, jotta testi voi avata varaston uudelleen kesken testin.
export function ordersFromDrafts({ drafts, turn, dialogue }) {
  return async () => ({
    handleTurn: (args) => turn()(args),
    dialogue: dialogue(),
    getShoppingList: ({ conversationId, customer }) => shoppingListView(drafts().active(conversationId), customer),
    hasTurnResult({ messageId, customer }) {
      const stored = drafts().result(messageId);
      const draft = stored?.draftId ? drafts().get(stored.draftId) : null;
      if (!draft) return false;
      return draft.customerId === customer.customerId && draft.bindingVersion === customer.bindingVersion;
    },
    close() {},
  });
}

// Käynnistää testipalvelimen satunnaiseen porttiin. Reitit kokeillaan järjestyksessä, muuten 404.
export async function serveRoutes(routes) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    for (const route of routes) if (await route(req, res, url)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    server,
    port: server.address().port,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

export const metaSignature = (raw, secret) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

export function metaTextWebhook({ id, from, at, text, phoneId = META_PHONE_ID }) {
  const message = { id, from, timestamp: String(Math.floor(at / 1000)), type: 'text', text: { body: text } };
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, messages: [message] } }] }],
  });
}
