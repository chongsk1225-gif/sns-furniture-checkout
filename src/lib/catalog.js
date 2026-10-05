/**
 * Server-side catalog price authority.
 *
 * The Worker trusts ONLY public/data/catalog-pricing.json (built from the
 * VISIBLE catalog-index.json the storefront renders; hidden, needs-review and
 * unpriced products are never in it) AND refuses every SKU listed in
 * public/data/catalog-blocked.json (the intentionally hidden products), so a
 * hidden SKU can never reach an order or an Authorize.Net token even if a stale
 * or hand-edited pricing file were deployed. If either file is unavailable the
 * request fails closed. The browser may send nothing but
 * { sku, qty } per line — names, prices, totals, taxes and quantities from the
 * client are never read.
 */
import { HttpError } from "./security.js";

const PRICING_PATH = "https://assets.internal/data/catalog-pricing.json";
const BLOCKED_PATH = "https://assets.internal/data/catalog-blocked.json";

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 25;
const MAX_TOTAL_QTY = 100;
const MAX_SUBTOTAL_CENTS = 100_000_00; // $100,000 sanity ceiling

let _cache = null;
let _blocked = null;

async function loadPriceMap(env) {
  if (_cache) return _cache;
  const res = await env.ASSETS.fetch(PRICING_PATH);
  if (!res.ok) throw new Error(`pricing index unavailable (${res.status})`);
  _cache = await res.json();
  return _cache;
}

async function loadBlocked(env) {
  if (_blocked) return _blocked;
  const res = await env.ASSETS.fetch(BLOCKED_PATH);
  if (!res.ok) throw new Error(`blocked-sku list unavailable (${res.status})`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error("blocked-sku list malformed");
  _blocked = new Set(list);
  return _blocked;
}

/** For tests / long-lived isolates that redeploy assets. */
export function _resetPriceCache() {
  _cache = null;
  _blocked = null;
}

/**
 * @param {object} env
 * @param {Array<{sku:string, qty:number}>} rawLines
 * @returns {Promise<{items:Array, subtotalCents:number}>}
 */
export async function validateCart(env, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpError("cart_empty", 422);
  }
  if (rawLines.length > MAX_LINES) {
    throw new HttpError("cart_too_large", 422);
  }

  // Merge duplicate SKUs, validate shapes.
  const merged = new Map();
  for (const line of rawLines) {
    if (!line || typeof line !== "object") {
      throw new HttpError("invalid_line", 422);
    }
    const sku = typeof line.sku === "string" ? line.sku.trim() : "";
    const qty = line.qty;
    if (!sku || sku.length > 64) {
      throw new HttpError("invalid_sku", 422, { sku });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new HttpError("invalid_quantity", 422, { sku });
    }
    merged.set(sku, Math.min(MAX_QTY_PER_LINE, (merged.get(sku) || 0) + qty));
  }

  const priceMap = await loadPriceMap(env);
  const blocked = await loadBlocked(env);
  const items = [];
  let subtotalCents = 0;
  let totalQty = 0;
  let lineNo = 0;

  for (const [sku, qty] of merged) {
    // Own-property check: "__proto__"/"constructor" etc. must not resolve to an entry.
    const entry = Object.prototype.hasOwnProperty.call(priceMap, sku) ? priceMap[sku] : null;
    if (blocked.has(sku) || !entry) throw new HttpError("invalid_sku", 422, { sku });
    const unitPriceCents = entry.p;
    if (!Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
      throw new HttpError("invalid_sku", 422, { sku });
    }
    const lineTotalCents = unitPriceCents * qty;
    subtotalCents += lineTotalCents;
    totalQty += qty;
    items.push({
      lineNo: lineNo++,
      sku,
      name: entry.n || sku,
      brand: entry.b || "",
      unitPriceCents,
      qty,
      lineTotalCents,
    });
  }

  if (totalQty > MAX_TOTAL_QTY) throw new HttpError("cart_too_large", 422);
  if (subtotalCents <= 0 || subtotalCents > MAX_SUBTOTAL_CENTS) {
    throw new HttpError("cart_total_out_of_range", 422);
  }

  return { items, subtotalCents };
}
