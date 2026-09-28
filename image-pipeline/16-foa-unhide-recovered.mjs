// Un-hides FOA products that 11-foa-hide-high-risk.mjs hid for having no
// reliable photo match, but that the authorized FOA product-page gallery
// scrape (02b/03-verify) has since resolved with a real, SKU-verified
// manufacturer photo. The reason they were hidden no longer applies.
//   node 16-foa-unhide-recovered.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "reports");
mkdirSync(OUT, { recursive: true });

const releaseLock = acquireLock({ force: !!process.argv.includes("--force"), label: `16-foa-unhide-recovered pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — not touching anything.");
  process.exit(2);
}
const runId = startRun(db, "16-foa-unhide-recovered", {});

const recovered = db
  .prepare(
    `SELECT sku, name, hidden_reason, resolution, json_array_length(final_gallery_json) img_count
       FROM products WHERE brand_key='foa' AND hidden=1 AND resolution IN ('official_multi','verified_single_image')
       ORDER BY sku`,
  )
  .all();

console.log(`FOA products to un-hide (now have a real verified photo): ${recovered.length}`);

const upd = db.prepare("UPDATE products SET hidden=0, hidden_reason=NULL WHERE sku=?");
withWriteRetry(() => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of recovered) upd.run(r.sku);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
});
finishRun(db, runId, { unhidden: recovered.length });
console.log(`pipeline.db: ${recovered.length} product(s) un-hidden. 05-build-dataset.mjs will restore them to proposed/ on its next run.`);

const HEADER = ["sku", "product_name", "previous_hidden_reason", "resolution", "image_count"];
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [HEADER.join(","), ...recovered.map((r) => [r.sku, r.name, r.hidden_reason, r.resolution, r.img_count].map(csvEsc).join(","))].join("\n");
writeFileSync(join(OUT, "FOA-unhidden-recovered.csv"), csv);
console.log(`List written: reports/FOA-unhidden-recovered.csv`);

try { releaseLock(); } catch {}
db.close();
