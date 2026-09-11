/**
 * Request-security helpers: JSON I/O, origin allow-listing, signed double-submit
 * CSRF, per-IP rate limiting (D1), constant-time compare, HMAC, field validation.
 * Nothing here logs or returns secret values.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(code, status, extra = {}) {
  return json({ error: code, ...extra }, status);
}

const MAX_BODY_BYTES = 16 * 1024;

export async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new HttpError("unsupported_media_type", 415);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new HttpError("payload_too_large", 413);
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new HttpError("invalid_json", 400);
  }
}

export class HttpError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

/** Origin/Referer must be one of ALLOWED_ORIGINS (comma-separated env var). */
export function assertAllowedOrigin(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin =
    request.headers.get("origin") ||
    originOf(request.headers.get("referer")) ||
    "";
  if (!origin || !allowed.includes(origin)) {
    throw new HttpError("origin_not_allowed", 403);
  }
}

function originOf(url) {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
}

/* ── HMAC / hashing ─────────────────────────────────────────────────────────── */

const enc = new TextEncoder();

export function hexToBytes(hex) {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmac(keyBytesOrString, message, hash = "SHA-256") {
  const keyData =
    typeof keyBytesOrString === "string"
      ? enc.encode(keyBytesOrString)
      : keyBytesOrString;
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const msg = typeof message === "string" ? enc.encode(message) : message;
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  return new Uint8Array(sig);
}

export function timingSafeEqual(a, b) {
  const ab = typeof a === "string" ? enc.encode(a) : a;
  const bb = typeof b === "string" ? enc.encode(b) : b;
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/* ── Signed double-submit CSRF token ────────────────────────────────────────── */

const CSRF_COOKIE = "sns_csrf";
const CSRF_TTL_SECONDS = 1800;

function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns { token, setCookie } — token goes in the JSON body, cookie is HttpOnly. */
export async function issueCsrf(env) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(24));
  const token = bytesToHex(tokenBytes);
  const sig = await hmac(secretOf(env), token, "SHA-256");
  const cookieValue = `${token}.${b64url(sig)}`;
  const setCookie =
    `${CSRF_COOKIE}=${cookieValue}; Path=/; Max-Age=${CSRF_TTL_SECONDS}; ` +
    `HttpOnly; Secure; SameSite=Strict`;
  return { token, setCookie };
}

/** Header X-CSRF-Token must equal the token signed inside the sns_csrf cookie. */
export async function assertCsrf(request, env) {
  const headerToken = request.headers.get("x-csrf-token") || "";
  const cookie = parseCookies(request).get(CSRF_COOKIE) || "";
  const dot = cookie.lastIndexOf(".");
  if (!headerToken || dot < 1) throw new HttpError("csrf_failed", 403);
  const token = cookie.slice(0, dot);
  const providedSig = cookie.slice(dot + 1);
  const expectedSig = b64url(await hmac(secretOf(env), token, "SHA-256"));
  if (!timingSafeEqual(providedSig, expectedSig)) {
    throw new HttpError("csrf_failed", 403);
  }
  if (!timingSafeEqual(headerToken, token)) {
    throw new HttpError("csrf_failed", 403);
  }
}

function secretOf(env) {
  const s = env.CSRF_SIGNING_SECRET;
  if (!s || String(s).length < 8) {
    throw new Error("CSRF_SIGNING_SECRET is not configured");
  }
  return String(s);
}

export function parseCookies(request) {
  const map = new Map();
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return map;
}

/* ── Rate limiting (fixed window in D1) ─────────────────────────────────────── */

export async function enforceRateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const bucket = key;
  const row = await env.DB.prepare(
    "SELECT count, window_start FROM rate_limit WHERE bucket = ?",
  )
    .bind(bucket)
    .first();

  if (!row || now - row.window_start >= windowMs) {
    await env.DB.prepare(
      "INSERT INTO rate_limit (bucket, count, window_start) VALUES (?, 1, ?) " +
        "ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start",
    )
      .bind(bucket, now)
      .run();
    return;
  }
  if (row.count >= limit) {
    const retry = Math.ceil((row.window_start + windowMs - now) / 1000);
    throw new HttpError("rate_limited", 429, { retry_after: retry });
  }
  await env.DB.prepare(
    "UPDATE rate_limit SET count = count + 1 WHERE bucket = ?",
  )
    .bind(bucket)
    .run();
}

/* ── Field validation ──────────────────────────────────────────────────────── */

export function str(value, { min = 0, max = 200, label = "field" } = {}) {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < min || v.length > max) {
    throw new HttpError("invalid_field", 422, { field: label });
  }
  return v;
}

export function optionalStr(value, max = 200) {
  const v = typeof value === "string" ? value.trim() : "";
  return v.slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function email(value) {
  const v = str(value, { min: 5, max: 254, label: "email" });
  if (!EMAIL_RE.test(v)) throw new HttpError("invalid_field", 422, { field: "email" });
  return v;
}

export function phone(value) {
  const v = str(value, { min: 7, max: 32, label: "phone" });
  if (!/^[0-9()+\-.\s]{7,32}$/.test(v)) {
    throw new HttpError("invalid_field", 422, { field: "phone" });
  }
  return v;
}
