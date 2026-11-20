// One confirmed order pushed by the WhatsApp bot. The order fields are the same allowlist projection as the
// public snapshot. Other fields are ignored.
import { parseSnapshot, type PublicOrder } from "./protocol.ts";

export type OrderEvent = { version: 1; observedAt: number; ledgerHead: string; order: PublicOrder };

export function parseOrderEvent(value: unknown, now = Date.now()): OrderEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Virheellinen tapahtuma.");
  const e = value as Record<string, unknown>;
  if (e.version !== 1) throw new Error("Virheellinen versio.");
  // Reuse the snapshot validator so both routes accept exactly the same order shape.
  const snapshot = parseSnapshot({ version: 1, observedAt: e.observedAt, ledgerHead: e.ledgerHead, totalOrders: 1, orders: [e.order] }, now);
  const order = snapshot.orders[0];
  if (order.status !== "confirmed") throw new Error("Vain vahvistettu tilaus.");
  return { version: 1, observedAt: snapshot.observedAt, ledgerHead: snapshot.ledgerHead, order };
}
