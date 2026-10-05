/**
 * Build the server-authoritative pricing index from the VISIBLE catalog.
 *
 *   public/data/catalog-index.json   (9,181 visible products, display data)
 *        ├──────────────►  public/data/catalog-pricing.json
 *        │                 { "<SKU>": { "p": <unitPriceCents>, "n": "<name>", "b": "<brand>" }, ... }
 *        └──────────────►  public/data/catalog-blocked.json
 *                          ["<SKU>", ...]  hidden / needs-review SKUs, never payable
 *
 * This is the ONLY price source the checkout Worker trusts. Only products that
 * are in the visible index, are not hidden/needs-review, and have an approved
 * sale price are priced; the 188 intentionally hidden products are NOT priced
 * and are listed in catalog-blocked.json so the Worker can reject them even if
 * a stale pricing file were ever deployed. The build FAILS unless the catalog
 * passes scripts/validate-catalog.mjs (9,369 detail records = 9,181 visible +
 * 188 hidden, 25 detail files, no duplicates) and every priced row produces a
 * positive integer cent value.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateCatalog, isBlocked } from "./validate-catalog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "data", "catalog-index.json");
const OUT = join(ROOT, "public", "data", "catalog-pricing.json");

const validation = validateCatalog();
if (!validation.ok) {
  console.error("build-pricing-index: catalog integrity check failed:");
  for (const p of validation.problems) console.error("  - " + p);
  throw new Error("catalog integrity check failed");
}
const catalog = validation.catalog.index;
const BLOCKED_OUT = join(ROOT, "public", "data", "catalog-blocked.json");
const blocked = validation.catalog.details.filter(isBlocked).map((d) => d.sku).sort();
const blockedSet = new Set(blocked);

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
  if (blockedSet.has(sku)) {
    problems.push(`${sku}: blocked (hidden/needs-review) SKU is present in catalog-index.json`);
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
writeFileSync(BLOCKED_OUT, JSON.stringify(blocked), "utf8");

const bytes = Buffer.byteLength(JSON.stringify(pricing));
console.log(
  `build-pricing-index: ${catalog.length} visible products scanned (${blocked.length} hidden SKUs blocked) · ${priced} priced · ` +
    `${unpriced} without a price (not purchasable online) · ${(bytes / 1024).toFixed(1)} KiB → ${OUT}`,
);
