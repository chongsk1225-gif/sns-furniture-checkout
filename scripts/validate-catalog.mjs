/**
 * Catalog integrity validation (shared by build-pricing-index.mjs and usable
 * on its own:  node scripts/validate-catalog.mjs).
 *
 * The catalog of record is public/data/details/*.json (every product, visible
 * or not). catalog-index.json is the *browsable* subset: it intentionally omits
 * the high-wrong-photo-risk Furniture of America products that
 * image-pipeline/11-foa-hide-high-risk.mjs hid. Those hidden detail records are
 * kept (never deleted) but must never be browsable or purchasable.
 *
 * Verifies:
 *   9,369 detail records = 3,708 ACME + 5,661 Furniture of America
 *   25 detail files, zero duplicate SKUs
 *   9,181 visible (catalog-index.json) + 188 intentionally hidden = 9,369
 *   every visible SKU has a matching detail record
 *   no hidden SKU is in the browse index
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public", "data");

export const EXPECTED = {
  total: 9369,
  acme: 3708,
  foa: 5661,
  visible: 9181,
  hidden: 188,
  detailFiles: 25,
};

const ACME = "ACME Furniture";
const FOA = "Furniture of America";

/** A detail record that must never be browsable or payable. */
export function isBlocked(d) {
  return (
    d.hidden === true ||
    d.needs_review === true ||
    (d.image_verification && d.image_verification.hidden === true)
  );
}

export function loadCatalog() {
  const index = JSON.parse(readFileSync(join(DATA, "catalog-index.json"), "utf8"));
  const files = readdirSync(join(DATA, "details")).filter((f) => f.endsWith(".json"));
  const details = [];
  for (const f of files) details.push(...JSON.parse(readFileSync(join(DATA, "details", f), "utf8")));
  return { index, details, detailFiles: files.length };
}

function dupes(list) {
  const seen = new Set();
  const dup = new Set();
  for (const s of list) (seen.has(s) ? dup : seen).add(s);
  return [...dup];
}

/** @returns {{ok:boolean, problems:string[], summary:object, catalog:object}} */
export function validateCatalog() {
  const catalog = loadCatalog();
  const { index, details, detailFiles } = catalog;
  const problems = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) problems.push(`${label}: expected ${wanted}, found ${actual}`);
  };

  if (!Array.isArray(index)) throw new Error("catalog-index.json is not an array");

  const acme = details.filter((d) => d.brand === ACME).length;
  const foa = details.filter((d) => d.brand === FOA).length;
  const hidden = details.filter((d) => d.hidden === true);
  expect("detail records", details.length, EXPECTED.total);
  expect("ACME detail records", acme, EXPECTED.acme);
  expect("Furniture of America detail records", foa, EXPECTED.foa);
  expect("detail files", detailFiles, EXPECTED.detailFiles);
  expect("visible products (catalog-index.json)", index.length, EXPECTED.visible);
  expect("intentionally hidden products", hidden.length, EXPECTED.hidden);
  expect("visible + hidden", index.length + hidden.length, EXPECTED.total);

  const dIdx = dupes(index.map((r) => r.sku));
  const dDet = dupes(details.map((r) => r.sku));
  if (dIdx.length) problems.push(`${dIdx.length} duplicate SKU(s) in catalog-index.json, e.g. ${dIdx.slice(0, 3)}`);
  if (dDet.length) problems.push(`${dDet.length} duplicate SKU(s) in detail files, e.g. ${dDet.slice(0, 3)}`);

  const detSkus = new Set(details.map((d) => d.sku));
  const idxSkus = new Set(index.map((r) => r.sku));
  const noDetail = [...idxSkus].filter((s) => !detSkus.has(s));
  if (noDetail.length) problems.push(`${noDetail.length} visible SKU(s) without a detail record, e.g. ${noDetail.slice(0, 3)}`);

  const hiddenButVisible = hidden.filter((d) => idxSkus.has(d.sku));
  if (hiddenButVisible.length) problems.push(`${hiddenButVisible.length} hidden SKU(s) present in catalog-index.json`);
  const unexplained = [...detSkus].filter((s) => !idxSkus.has(s) && !hidden.some((h) => h.sku === s));
  if (unexplained.length) problems.push(`${unexplained.length} detail SKU(s) neither visible nor hidden, e.g. ${unexplained.slice(0, 3)}`);
  const flaggedVisible = details.filter((d) => idxSkus.has(d.sku) && isBlocked(d));
  if (flaggedVisible.length) problems.push(`${flaggedVisible.length} visible SKU(s) flagged hidden/needs_review`);

  return {
    ok: problems.length === 0,
    problems,
    summary: {
      detailRecords: details.length,
      acme,
      foa,
      detailFiles,
      visible: index.length,
      hidden: hidden.length,
      duplicateSkus: dIdx.length + dDet.length,
      visibleWithoutDetail: noDetail.length,
    },
    catalog,
  };
}

if (process.argv[1] && process.argv[1].endsWith("validate-catalog.mjs")) {
  const r = validateCatalog();
  console.log("catalog validation:", JSON.stringify(r.summary));
  if (!r.ok) {
    for (const p of r.problems) console.error("  FAIL", p);
    process.exit(1);
  }
  console.log("catalog validation: OK");
}
