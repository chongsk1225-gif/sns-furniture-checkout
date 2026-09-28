import {
  json,
  errorResponse,
  readJson,
  assertAllowedOrigin,
  assertCsrf,
  enforceRateLimit,
  clientIp,
} from "../lib/security.js";
import { validateCart } from "../lib/catalog.js";
import { computeTax } from "../lib/tax.js";
import { createPendingOrder, setStatus } from "../lib/orders.js";
import {
  getHostedPaymentPageToken,
  hostedPaymentFormUrl,
  anetEnvironment,
} from "../lib/authorizenet.js";
import { parseLines, parseCustomer, parseDeliveryAddress, FULFILLMENT, SHIPPING_CENTS } from "./_common.js";

/**
 * POST /api/checkout/create-token
 * Body: { lines:[{sku,qty}], customer:{name,email,phone},
 *         delivery:{line1,line2,city,state,zip,country},
 *         acceptTerms:true, acceptRefundPolicy:true }
 * → { orderNumber, token, hostedPaymentUrl, environment, amount }
 *
 * Delivery only. The delivery address is validated and confirmed to be in
 * California by the CDTFA district-rate lookup BEFORE any Authorize.Net token
 * is created. Every price/qty/total/tax value is recomputed server-side. A
 * flat, un-tiered $150 delivery fee (SHIPPING_CENTS) is added to every order
 * and is not itself taxed (separately stated). The customer's BILLING address
 * (incl. billing ZIP, for AVS) is collected by Authorize.Net Accept Hosted —
 * it is not derived from the delivery address and may differ. No full card
 * data is received or stored.
 */
export async function handleCreateToken(request, env) {
  assertAllowedOrigin(request, env);
  await assertCsrf(request, env);
  await enforceRateLimit(env, `${clientIp(request)}|token`, 8, 60_000);

  const body = await readJson(request);
  const customer = parseCustomer(body);
  const delivery = parseDeliveryAddress(body);

  if (body.acceptTerms !== true || body.acceptRefundPolicy !== true) {
    return errorResponse("policies_not_accepted", 422);
  }

  const { items, subtotalCents } = await validateCart(env, parseLines(body));

  // Address + tax authority. Runs BEFORE the payment token is created.
  const tax = await computeTax(env, {
    subtotalCents,
    taxableCents: subtotalCents,
    address: delivery,
  });
  if (!tax.ok) {
    return errorResponse(tax.code, tax.code === "tax_unavailable" ? 409 : 422);
  }

  const totalCents = subtotalCents + tax.taxCents + SHIPPING_CENTS; // merchandise + sales tax + flat delivery

  const orderNumber = await createPendingOrder(env, {
    environment: anetEnvironment(env),
    subtotalCents,
    taxCents: tax.taxCents,
    taxRate: tax.taxRate,
    taxSource: tax.source,
    shippingCents: SHIPPING_CENTS,
    totalCents,
    fulfillment: FULFILLMENT,
    customer,
    delivery,
    items,
  });

  const origin = new URL(request.url).origin;

  let token;
  try {
    ({ token } = await getHostedPaymentPageToken(env, {
      orderNumber,
      amountCents: totalCents,
      items: [
        ...items,
        { sku: "DELIVERY", name: "Delivery", brand: "", unitPriceCents: SHIPPING_CENTS, qty: 1 },
      ],
      customerEmail: customer.email,
      returnUrl: `${origin}/checkout-approved.html?ref=${encodeURIComponent(orderNumber)}`,
      cancelUrl: `${origin}/checkout-cancel.html?ref=${encodeURIComponent(orderNumber)}`,
    }));
  } catch (err) {
    await setStatus(env, orderNumber, "failed", ["pending"]);
    return errorResponse("payment_init_failed", 502);
  }

  return json({
    orderNumber,
    token,
    hostedPaymentUrl: hostedPaymentFormUrl(env),
    environment: anetEnvironment(env),
    amount: { subtotalCents, taxCents: tax.taxCents, shippingCents: SHIPPING_CENTS, totalCents },
  });
}
