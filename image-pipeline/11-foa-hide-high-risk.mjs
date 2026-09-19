// Marks the "high wrong-photo-risk" unresolved FOA products (per
// lib/diagnose.mjs — same classifier 09's report uses) as hidden/needs-review,
// so they won't display or be purchasable once this data goes live. Does NOT
// touch the 242 medium-risk or 684 low-risk products, or SKU-verification
// state (resolution/state/current_image untouched — this is a display/sale
// decision, independent of the image-matching pipeline).
//
// Durable: sets products.hidden/hidden_reason in pipeline.db (survives a
// future full 05-build-dataset.mjs rebuild, which now checks it). Also
// patches proposed/data/ directly for immediate effect:
//   - catalog-index.json: the SKU is removed from the browsable/sellable
//     listing entirely (site.js iterates this array for the catalog grid).
//   - detail record: KEPT (not deleted, so a direct/saved link still shows
//     product info instead of a raw 404), but sale/was are nulled and a
//     hidden/needs_review flag + reason are added. The existing frontend
//     (site.js, product-page.js) already renders "CHECK PRICE / CHECK
//     AVAILABILITY" with no Add-to-Cart button whenever sale is null — so
//     "not purchasable" holds with zero frontend code changes, verified
//     against public/site.js and public/product-page.js.
//
//   node 11-foa-hide-high-risk.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { classifyProduct } from "./lib/diagnose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "reports");
const PROPOSED_DATA = join(HERE, "proposed", "data");
mkdirSync(OUT, { recursive: true });

const releaseLock = acquireLock({ label: `11-foa-hide-high-risk pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — not touching anything.");
  process.exit(2);
}
const runId = startRun(db, "11-foa-hide-high-risk", {});

const products = db
  .prepare("SELECT * FROM products WHERE brand_key = 'foa' AND resolution = 'unresolved' ORDER BY sku")
  .all();
const candsFor = db.prepare(`
  SELECT origin, original_url, resolved_url, reject_reason, width, height
  FROM candidate_images WHERE sku = ? AND origin != 'foa_page' ORDER BY origin
`);

const highRisk = [];
for (const p of products) {
  const cls = classifyProduct(p.sku, candsFor.all(p.sku));
  if (cls.wrong_photo_risk === "high") highRisk.push({ sku: p.sku, name: p.name || "", reason: cls.reason });
}
console.log(`High wrong-photo-risk FOA products to hide: ${highRisk.length}`);

// ---- durable: pipeline.db --------------------------------------------------
const upd = db.prepare("UPDATE products SET hidden=1, hidden_reason=@reason WHERE sku=@sku");
withWriteRetry(() => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of highRisk) upd.run({ sku: r.sku, reason: r.reason });
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
});
finishRun(db, runId, { hidden: highRisk.length });
console.log(`pipeline.db: ${highRisk.length} product(s) marked hidden=1. Resolution/state/current_image and all other products untouched.`);

// ---- immediate: patch proposed/data/ directly ------------------------------
const hiddenSkus = new Set(highRisk.map((r) => r.sku));
const bySku = new Map(highRisk.map((r) => [r.sku, r.reason]));

const idx = JSON.parse(readFileSync(join(PROPOSED_DATA, "catalog-index.json"), "utf8"));
const beforeLen = idx.length;
const nextIdx = idx.filter((row) => !hiddenSkus.has(String(row.sku)));
writeFileSync(join(PROPOSED_DATA, "catalog-index.json"), JSON.stringify(nextIdx));
console.log(`proposed/data/catalog-index.json: ${beforeLen - nextIdx.length} row(s) removed from the browsable listing (${nextIdx.length} remain).`);

let detailChanged = 0;
for (const f of readdirSync(join(PROPOSED_DATA, "details"))) {
  if (!f.endsWith(".json")) continue;
  const path = join(PROPOSED_DATA, "details", f);
  const arr = JSON.parse(readFileSync(path, "utf8"));
  let touched = false;
  for (const rec of arr) {
    const reason = bySku.get(String(rec.sku));
    if (!reason) continue;
    rec.sale = null;   // existing frontend logic already blocks Add-to-Cart / shows "CHECK PRICE" when sale is null
    rec.was = null;
    rec.hidden = true;
    rec.needs_review = true;
    rec.hidden_reason = reason;
    rec.image_verification = { ...(rec.image_verification || {}), status: "unresolved", hidden: true, wrong_photo_risk: "high", note: reason };
    touched = true;
    detailChanged++;
  }
  if (touched) writeFileSync(path, JSON.stringify(arr));
}
console.log(`proposed/data/details/: ${detailChanged} record(s) marked hidden/needs_review, sale+was nulled (kept, not deleted, so a direct link still shows product info + review notice instead of a 404).`);

// ---- the list the user asked for ------------------------------------------
const HEADER = ["sku", "product_name", "hidden_reason"];
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [HEADER.join(","), ...highRisk.map((r) => [r.sku, r.name, r.reason].map(csvEsc).join(","))].join("\n");
writeFileSync(join(OUT, "FOA-hidden-high-risk.csv"), csv);
console.log(`\nList written: reports/FOA-hidden-high-risk.csv (${highRisk.length} rows: sku, product_name, hidden_reason)`);

try { releaseLock(); } catch {}
db.close();
