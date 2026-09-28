-- Flat delivery fee. Every order (old and new) gets the same $150.00 charge;
-- DEFAULT backfills any pre-existing rows so this is safe to run on a
-- non-empty table.
ALTER TABLE orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 15000;
