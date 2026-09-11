import { json } from "../lib/security.js";
import {
  verifyWebhookSignature,
  getTransactionDetails,
  isApproved,
} from "../lib/authorizenet.js";
import { getOrder, markPaid, setStatus, claimWebhookEvent } from "../lib/orders.js";

/**
 * POST /api/checkout/webhook  (called by Authorize.Net, not the browser)
 *
 *  1. Verify X-ANET-Signature (HMAC-SHA512 with the Signature Key).
 *  2. De-duplicate by notification id.
 *  3. Re-fetch the transaction from Authorize.Net (getTransactionDetails) —
 *     the notification body alone is never trusted.
 *  4. Require the settled amount to equal the server-computed order total.
 *  5. Only then move the order pending → paid.
 */
export async function handleWebhook(request, env) {
  const raw = await request.text();
  const valid = await verifyWebhookSignature(
    env.AUTHORIZE_NET_SIGNATURE_KEY,
    raw,
    request.headers.get("x-anet-signature") || "",
  );
  if (!valid) return json({ error: "bad_signature" }, 401);

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const eventType = String(evt.eventType || "");
  const transId = String(evt.payload?.id || "");
  const eventId = String(
    evt.notificationId || evt.webhookId || `${transId}:${eventType}`,
  );

  const relevant =
    /payment\.(authcapture|capture|priorauthcapture)\.created/i.test(eventType) ||
    /payment\.authorization\.created/i.test(eventType);
  if (!relevant || !transId) return json({ ok: true, ignored: true });

  if (!(await claimWebhookEvent(env, eventId))) {
    return json({ ok: true, duplicate: true });
  }

  const details = await getTransactionDetails(env, transId);
  if (!details) return json({ ok: true, unverified: true });

  const orderNumber = details.invoiceNumber || String(evt.payload?.invoiceNumber || "");
  const order = await getOrder(env, orderNumber);
  if (!order) return json({ ok: true, unknown_order: true });

  if (order.status === "paid") return json({ ok: true, already_paid: true });

  if (!isApproved(details)) {
    if (details.responseCode === 2 || details.responseCode === 3) {
      await setStatus(env, orderNumber, "failed", ["pending"]);
    }
    return json({ ok: true, status: "not_approved" });
  }

  if (details.settleAmountCents !== order.total_cents) {
    await setStatus(env, orderNumber, "failed", ["pending"]);
    return json({ ok: true, status: "amount_mismatch" });
  }

  await markPaid(env, orderNumber, {
    transId: details.transId,
    authCode: details.authCode,
    cardBrand: details.cardBrand,
    cardLast4: details.cardLast4,
  });
  return json({ ok: true, status: "paid" });
}
