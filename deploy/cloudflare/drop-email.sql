-- One-off migration for the live D1 database after the Worker without e-mail is deployed (20.11.2026).
-- Order confirmations go to WhatsApp, so the e-mail columns are no longer read or written.
ALTER TABLE order_events DROP COLUMN email_to;
ALTER TABLE order_events DROP COLUMN email_status;
ALTER TABLE order_events DROP COLUMN email_attempts;
ALTER TABLE order_events DROP COLUMN email_updated_at;
ALTER TABLE order_events DROP COLUMN email_message_id;
DROP TABLE IF EXISTS signups;
