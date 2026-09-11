/**
 * SNS Furniture Worker.
 *
 * Static assets (the whole storefront) are served by the ASSETS binding BEFORE
 * this script runs. The script only ever sees /api/checkout/* requests.
 */
import { errorResponse, HttpError } from "./lib/security.js";
import { handleSession } from "./routes/session.js";
import { handleTaxQuote } from "./routes/taxQuote.js";
import { handleCreateToken } from "./routes/createToken.js";
import { handleConfirm } from "./routes/confirm.js";
import { handleCancel } from "./routes/cancel.js";
import { handleWebhook } from "./routes/webhook.js";

const ROUTES = [
  ["GET", "/api/checkout/session", handleSession],
  ["POST", "/api/checkout/tax-quote", handleTaxQuote],
  ["POST", "/api/checkout/create-token", handleCreateToken],
  ["GET", "/api/checkout/confirm", handleConfirm],
  ["POST", "/api/checkout/cancel", handleCancel],
  ["POST", "/api/checkout/webhook", handleWebhook],
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    }

    const route = ROUTES.find(
      ([method, path]) => method === request.method && path === url.pathname,
    );
    if (!route) {
      const pathExists = ROUTES.some(([, path]) => path === url.pathname);
      return errorResponse(pathExists ? "method_not_allowed" : "not_found", pathExists ? 405 : 404);
    }

    try {
      return await route[2](request, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResponse(err.code, err.status, err.extra);
      }
      // Never leak internals (and never any secret) to the client.
      console.error("checkout_error", err && err.stack ? err.stack : String(err));
      return errorResponse("server_error", 500);
    }
  },
};
