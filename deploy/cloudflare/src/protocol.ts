// The public projection is deliberately separate from the gateway's private order object.
export const MAX_BODY_BYTES = 262144;
export const MAX_ORDERS = 20;
export const MAX_LINES = 50;
export type PublicLine = { productId: string; name: string; quantity: number; unit: string; net: number };
export type PublicOrder = {
  orderId: string; channel: "whatsapp" | "browser-demo"; status: "confirmed" | "pending_approval" | "rejected";
  createdAt: string; deliveryDate: string | null; net: number | null; lineCount: number; lines: PublicLine[];
};
export type Snapshot = { version: 1; observedAt: number; totalOrders: number; ledgerHead: string; orders: PublicOrder[] };
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Virheellinen tietue.");
  return v as Record<string, unknown>;
};
const text = (v: unknown, max: number) => {
  if (typeof v !== "string" || !v || v.length > max || /[\u0000-\u001f]/u.test(v)) throw new Error("Virheellinen teksti.");
  return v;
};
const number = (v: unknown, min = 0) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw new Error("Virheellinen luku.");
  return v;
};
export function parseSnapshot(value: unknown, now = Date.now()): Snapshot {
  const s = object(value);
  if (s.version !== 1 || !Number.isSafeInteger(s.observedAt)) throw new Error("Virheellinen versio tai aika.");
  const observedAt = number(s.observedAt);
  if (Math.abs(now - observedAt) > 300000) throw new Error("Tilannekuva on liian vanha.");
  const ledgerHead = text(s.ledgerHead, 64);
  if (!/^[0-9a-f]{64}$/.test(ledgerHead)) throw new Error("Virheellinen lokitunniste.");
  if (!Array.isArray(s.orders) || s.orders.length > MAX_ORDERS) throw new Error("Liian monta tilausta.");
  const seen = new Set<string>();
  const orders = s.orders.map((value): PublicOrder => {
    const o = object(value), orderId = text(o.orderId, 64);
    if (!/^AGW-\d{8}-\d{4,12}$/.test(orderId) || seen.has(orderId)) throw new Error("Virheellinen tai toistuva tilaus.");
    seen.add(orderId);
    if (o.channel !== "whatsapp" && o.channel !== "browser-demo") throw new Error("Virheellinen kanava.");
    if (o.status !== "confirmed" && o.status !== "pending_approval" && o.status !== "rejected") throw new Error("Virheellinen tila.");
    const createdAt = text(o.createdAt, 40);
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Virheellinen tilausaika.");
    const deliveryDate = o.deliveryDate === null ? null : text(o.deliveryDate, 10);
    if (deliveryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) throw new Error("Virheellinen toimituspäivä.");
    if (!Array.isArray(o.lines) || o.lines.length > MAX_LINES) throw new Error("Virheelliset tuoterivit.");
    const lines = o.lines.map((value): PublicLine => {
      const l = object(value);
      return { productId: text(l.productId, 64), name: text(l.name, 180), quantity: number(l.quantity), unit: text(l.unit, 24), net: number(l.net) };
    });
    const lineCount = number(o.lineCount);
    if (!Number.isSafeInteger(lineCount) || lineCount < lines.length) throw new Error("Virheellinen rivimäärä.");
    return { orderId, channel: o.channel, status: o.status, createdAt, deliveryDate, net: o.net === null ? null : number(o.net), lineCount, lines };
  });
  const totalOrders = number(s.totalOrders);
  if (!Number.isSafeInteger(totalOrders) || totalOrders < orders.length) throw new Error("Virheellinen tilausmäärä.");
  return { version: 1, observedAt, ledgerHead, totalOrders, orders };
}
