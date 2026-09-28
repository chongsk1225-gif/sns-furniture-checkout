import { json, errorResponse } from "../lib/security.js";
import { getOrder } from "../lib/orders.js";

/**
 * GET /api/checkout/confirm?ref=SNS-YYYYMMDD-XXXXXX
 * Returns the server-side order status. "paid" is only ever reported after a
 * signature-verified webhook confirmed the transaction with Authorize.Net.
 * No customer PII, no card data beyond brand + last4, is returned.
 */
export async function handleConfirm(request, env) {
  const ref = new URL(request.url).searchParams.get("ref") || "";
  const order = await getOrder(env, ref);
  if (!order) return errorResponse("not_found", 404);

  const out = {
    orderNumber: order.order_number,
    status: order.status,
    fulfillment: order.fulfillment,
    currency: order.currency,
    subtotalCents: order.subtotal_cents,
    taxCents: order.tax_cents,
    shippingCents: order.shipping_cents,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    items: (order.items || []).map((i) => ({
      sku: i.sku,
      name: i.name,
      brand: i.brand,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.line_total_cents,
    })),
  };

  if (order.status === "paid") {
    out.transactionRef = order.anet_trans_id || null;
    out.authCode = order.anet_auth_code || null;
    out.card = order.card_brand
      ? { brand: order.card_brand, last4: order.card_last4 }
      : null;
  }

  return json(out);
}
