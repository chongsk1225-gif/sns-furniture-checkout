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
import { parseLines, parseDeliveryAddress, SHIPPING_CENTS } from "./_common.js";

/**
 * POST /api/checkout/tax-quote
 * Body: { lines:[{sku,qty}], delivery:{line1,city,state,zip,country} }
 * → 200 { subtotalCents, taxCents, taxRate, taxSource, shippingCents, totalCents, jurisdiction }
 *   409 tax_unavailable       — no working tax provider
 *   422 ca_delivery_only      — resolved address is outside California
 *   422 address_unverifiable  — the delivery city has no CDTFA rate on file
 */
export async function handleTaxQuote(request, env) {
  assertAllowedOrigin(request, env);
  await assertCsrf(request, env);
  await enforceRateLimit(env, `${clientIp(request)}|tax`, 20, 60_000);

  const body = await readJson(request);
  const { items, subtotalCents } = await validateCart(env, parseLines(body));
  const address = parseDeliveryAddress(body);

  const tax = await computeTax(env, {
    subtotalCents,
    taxableCents: subtotalCents, // merchandise is taxable; no delivery fee is charged here
    address,
  });
  if (!tax.ok) {
    return errorResponse(tax.code, tax.code === "tax_unavailable" ? 409 : 422);
  }

  return json({
    subtotalCents,
    taxableCents: subtotalCents,
    taxCents: tax.taxCents,
    taxRate: tax.taxRate,
    taxSource: tax.source,
    jurisdiction: tax.jurisdiction || null,
    shippingCents: SHIPPING_CENTS,
    totalCents: subtotalCents + tax.taxCents + SHIPPING_CENTS,
    lineCount: items.length,
  });
}
