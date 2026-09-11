/**
 * Server-side catalog price authority.
 *
 * The Worker trusts ONLY public/data/catalog-pricing.json (built from the same
 * catalog-index.json the storefront renders). The browser may send nothing but
 * { sku, qty } per line — names, prices, totals, taxes and quantities from the
 * client are never read.
 */
import { HttpError } from "./security.js";

const PRICING_PATH = "https://assets.internal/data/catalog-pricing.json";

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 25;
const MAX_TOTAL_QTY = 100;
const MAX_SUBTOTAL_CENTS = 100_000_00; // $100,000 sanity ceiling

let _cache = null;

async function loadPriceMap(env) {
  if (_cache) return _cache;
  const res = await env.ASSETS.fetch(PRICING_PATH);
  if (!res.ok) throw new Error(`pricing index unavailable (${res.status})`);
  _cache = await res.json();
  return _cache;
}

/** For tests / long-lived isolates that redeploy assets. */
export function _resetPriceCache() {
  _cache = null;
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
  const items = [];
  let subtotalCents = 0;
  let totalQty = 0;
  let lineNo = 0;

  for (const [sku, qty] of merged) {
    const entry = priceMap[sku];
    if (!entry) throw new HttpError("invalid_sku", 422, { sku });
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
