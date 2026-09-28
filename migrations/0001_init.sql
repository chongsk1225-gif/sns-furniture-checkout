-- SNS Furniture checkout — initial schema.
-- All monetary values are integer USD cents. No card data beyond brand + last4.

CREATE TABLE IF NOT EXISTS orders (
  order_number     TEXT PRIMARY KEY,          -- SNS-YYYYMMDD-XXXXXX
  status           TEXT NOT NULL,             -- pending | paid | failed | canceled | refund_requested | refunded
  environment      TEXT NOT NULL,             -- sandbox | production
  created_at       TEXT NOT NULL,             -- ISO 8601
  updated_at       TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents   INTEGER NOT NULL,
  tax_cents        INTEGER NOT NULL,
  tax_rate         REAL,                      -- nullable; informational
  tax_source       TEXT,                      -- e.g. ca-district-table
  total_cents      INTEGER NOT NULL,
  fulfillment      TEXT NOT NULL,             -- pickup | delivery_quote
  customer_name    TEXT,
  customer_email   TEXT,
  customer_phone   TEXT,
  delivery_address TEXT,                      -- JSON California delivery address {line1,line2,city,state,zip,country}; also the sales-tax destination
  anet_trans_id    TEXT,
  anet_auth_code   TEXT,
  card_brand       TEXT,                      -- Visa | Mastercard | ... (brand only)
  card_last4       TEXT                       -- last 4 digits only
);

CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_trans   ON orders (anet_trans_id);

CREATE TABLE IF NOT EXISTS order_items (
  order_number     TEXT NOT NULL REFERENCES orders (order_number),
  line_no          INTEGER NOT NULL,
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  brand            TEXT,
  unit_price_cents INTEGER NOT NULL,
  qty              INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  PRIMARY KEY (order_number, line_no)
);

-- Sliding-window rate limiting for the payment-token + tax endpoints.
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket        TEXT PRIMARY KEY,             -- "<ip>|<endpoint>"
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL             -- epoch ms
);

-- Webhook idempotency ledger.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,
  received_at  TEXT NOT NULL
);
