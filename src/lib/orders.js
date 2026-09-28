/**
 * Order persistence (Cloudflare D1). Money is always integer cents.
 * No card data beyond brand + last4 is ever written.
 */

const ORDER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (no I L O U)

function randomSuffix(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += ORDER_ALPHABET[bytes[i] % ORDER_ALPHABET.length];
  return out;
}

export function newOrderNumber(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `SNS-${y}${m}${d}-${randomSuffix(6)}`; // 19 chars
}

/**
 * Insert a pending order + its items atomically. Retries once on the (astronomically
 * unlikely) order-number collision.
 */
export async function createPendingOrder(env, data) {
  const nowIso = new Date().toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const orderNumber = newOrderNumber();
    const orderStmt = env.DB.prepare(
      `INSERT INTO orders (
         order_number, status, environment, created_at, updated_at, currency,
         subtotal_cents, tax_cents, tax_rate, tax_source, shipping_cents, total_cents, fulfillment,
         customer_name, customer_email, customer_phone, delivery_address
       ) VALUES (?, 'pending', ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      orderNumber,
      data.environment,
      nowIso,
      nowIso,
      data.subtotalCents,
      data.taxCents,
      data.taxRate,
      data.taxSource,
      data.shippingCents,
      data.totalCents,
      data.fulfillment,
      data.customer.name,
      data.customer.email,
      data.customer.phone,
      JSON.stringify(data.delivery),
    );

    const itemStmts = data.items.map((it) =>
      env.DB.prepare(
        `INSERT INTO order_items
           (order_number, line_no, sku, name, brand, unit_price_cents, qty, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        orderNumber,
        it.lineNo,
        it.sku,
        it.name,
        it.brand,
        it.unitPriceCents,
        it.qty,
        it.lineTotalCents,
      ),
    );

    try {
      await env.DB.batch([orderStmt, ...itemStmts]);
      return orderNumber;
    } catch (err) {
      if (String(err).includes("UNIQUE") && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error("could not allocate an order number");
}

export async function getOrder(env, orderNumber) {
  if (!/^SNS-\d{8}-[0-9A-Z]{6}$/.test(String(orderNumber || ""))) return null;
  const order = await env.DB.prepare(
    "SELECT * FROM orders WHERE order_number = ?",
  )
    .bind(orderNumber)
    .first();
  if (!order) return null;
  const { results: items } = await env.DB.prepare(
    "SELECT line_no, sku, name, brand, unit_price_cents, qty, line_total_cents " +
      "FROM order_items WHERE order_number = ? ORDER BY line_no",
  )
    .bind(orderNumber)
    .all();
  return { ...order, items: items || [] };
}

/** Idempotent transition to paid. Only advances a pending order. */
export async function markPaid(env, orderNumber, info) {
  const nowIso = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE orders
        SET status = 'paid', updated_at = ?,
            anet_trans_id = ?, anet_auth_code = ?, card_brand = ?, card_last4 = ?
      WHERE order_number = ? AND status = 'pending'`,
  )
    .bind(
      nowIso,
      info.transId,
      info.authCode || "",
      info.cardBrand || "",
      info.cardLast4 || "",
      orderNumber,
    )
    .run();
  return res.meta.changes > 0;
}

export async function setStatus(env, orderNumber, next, allowedFrom) {
  const nowIso = new Date().toISOString();
  const placeholders = allowedFrom.map(() => "?").join(",");
  const res = await env.DB.prepare(
    `UPDATE orders SET status = ?, updated_at = ?
      WHERE order_number = ? AND status IN (${placeholders})`,
  )
    .bind(next, nowIso, orderNumber, ...allowedFrom)
    .run();
  return res.meta.changes > 0;
}

/** Returns true if this is the first time we've seen the event id. */
export async function claimWebhookEvent(env, eventId) {
  if (!eventId) return true; // no id → don't block processing, rely on order-state idempotency
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_events (event_id, received_at) VALUES (?, ?)",
  )
    .bind(String(eventId).slice(0, 100), new Date().toISOString())
    .run();
  return res.meta.changes > 0;
}
