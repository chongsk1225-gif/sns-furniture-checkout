import {
  json,
  errorResponse,
  readJson,
  assertAllowedOrigin,
  enforceRateLimit,
  clientIp,
} from "../lib/security.js";
import { getOrder, setStatus } from "../lib/orders.js";

/**
 * POST /api/checkout/cancel   Body: { ref }
 * Marks a still-pending order "canceled" (e.g. the shopper backed out of the
 * hosted payment form). Never touches a paid/failed order. Low-risk state change
 * on an unpaid order, so it does not require the CSRF token (the shopper may be
 * arriving via a cross-site redirect from Authorize.Net where the Strict cookie
 * is withheld on the top-level navigation); origin + rate limiting still apply.
 */
export async function handleCancel(request, env) {
  assertAllowedOrigin(request, env);
  await enforceRateLimit(env, `${clientIp(request)}|cancel`, 20, 60_000);

  const body = await readJson(request);
  const ref = String(body.ref || "");
  const order = await getOrder(env, ref);
  if (!order) return errorResponse("not_found", 404);

  const changed = await setStatus(env, ref, "canceled", ["pending"]);
  return json({ orderNumber: ref, status: changed ? "canceled" : order.status });
}
