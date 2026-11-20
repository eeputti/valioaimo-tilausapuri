CREATE TABLE IF NOT EXISTS demo_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

-- One row per confirmed order pushed by the WhatsApp bot. The order id is the idempotency key.
CREATE TABLE IF NOT EXISTS order_events (
  order_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

-- Demo-only payment state. No real payment or card information is stored.
CREATE TABLE IF NOT EXISTS demo_payments (
  order_id TEXT PRIMARY KEY REFERENCES order_events(order_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  amount_net_cents INTEGER NOT NULL CHECK (amount_net_cents >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER
);

-- "Katso, mitä agentti näki": the published conversation and gateway checks behind one order.
-- Read only with that order's demo payment link; phone numbers and cart links are masked before publishing.
CREATE TABLE IF NOT EXISTS agent_traces (
  order_id TEXT PRIMARY KEY,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

-- Selainkeskustelun päivälaskurit: session '*' on koko sivuston päiväraja. Ei viestien sisältöä.
CREATE TABLE IF NOT EXISTS web_chat_usage (
  day TEXT NOT NULL,
  session TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, session)
);

-- Site settings set by hand on the live database, never in Git: bot_backend_url (browser chat, see docs/web-chat.md)
-- and example_trace_order (the public example trace).
CREATE TABLE IF NOT EXISTS landing_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
