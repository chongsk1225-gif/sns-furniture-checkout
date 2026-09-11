/**
 * Build the server-authoritative pricing index from the deployed catalog.
 *
 *   public/data/catalog-index.json   (9,369 products, display data)
 *        └──────────────►  public/data/catalog-pricing.json
 *                          { "<SKU>": { "p": <unitPriceCents>, "n": "<name>", "b": "<brand>" }, ... }
 *
 * This is the ONLY price source the checkout Worker trusts. It is regenerated
 * from the same catalog file the storefront renders, so the two never diverge.
 * The build FAILS if the catalog is not exactly 9,369 rows, or if any priced
 * row would produce a non-positive / non-integer cent value.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "data", "catalog-index.json");
const OUT = join(ROOT, "public", "data", "catalog-pricing.json");

const EXPECTED_PRODUCTS = 9369;

const catalog = JSON.parse(readFileSync(SRC, "utf8"));
if (!Array.isArray(catalog)) {
  throw new Error(`catalog-index.json is not an array`);
}
if (catalog.length !== EXPECTED_PRODUCTS) {
  throw new Error(
    `catalog integrity check failed: expected ${EXPECTED_PRODUCTS} products, found ${catalog.length}`,
  );
}

const pricing = {};
let priced = 0;
let unpriced = 0;
const problems = [];

for (const row of catalog) {
  const sku = typeof row.sku === "string" ? row.sku.trim() : "";
  if (!sku) {
    problems.push(`row with missing sku: ${JSON.stringify(row).slice(0, 120)}`);
    continue;
  }
  const sale = row.sale;
  if (sale === null || sale === undefined || sale === "") {
    unpriced++;
    continue;
  }
  const cents = Math.round(Number(sale) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || !Number.isInteger(cents)) {
    problems.push(`${sku}: bad sale value ${JSON.stringify(sale)}`);
    continue;
  }
  if (pricing[sku]) {
    problems.push(`duplicate sku ${sku}`);
    continue;
  }
  pricing[sku] = {
    p: cents,
    n: String(row.name ?? "").slice(0, 200),
    b: String(row.brand ?? "").slice(0, 120),
  };
  priced++;
}

if (problems.length) {
  console.error(`build-pricing-index: ${problems.length} problem row(s):`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  throw new Error(`refusing to write pricing index with data problems`);
}

writeFileSync(OUT, JSON.stringify(pricing), "utf8");

const bytes = Buffer.byteLength(JSON.stringify(pricing));
console.log(
  `build-pricing-index: ${EXPECTED_PRODUCTS} products scanned · ${priced} priced · ` +
    `${unpriced} without a price (not purchasable online) · ${(bytes / 1024).toFixed(1)} KiB → ${OUT}`,
);
