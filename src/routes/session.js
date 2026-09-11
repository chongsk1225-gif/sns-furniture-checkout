import { json, issueCsrf } from "../lib/security.js";

/** GET /api/checkout/session → issues a signed double-submit CSRF token. */
export async function handleSession(request, env) {
  const { token, setCookie } = await issueCsrf(env);
  return json({ csrfToken: token }, 200, { "set-cookie": setCookie });
}
