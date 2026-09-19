// Diagnostic-only report: WHY each unresolved FOA product's image was
// rejected by 03-verify.mjs, in plain, specific terms (not just the generic
// "sku_mismatch" reason code) — so a human can judge wrong-photo risk per
// product. Reads pipeline.db; writes only reports/. No network, no writes to
// pipeline.db, proposed/, or public/.
//
// One row per PRODUCT (not per candidate) — a few products have several
// candidate rows (e.g. multiple size-cache variants of the same source
// image), and classifying at the candidate level double-counts them. Each
// product takes the highest-risk classification among its own candidates.
//   node 09-foa-unresolved-diagnosis.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./lib/db.mjs";
import { classifyProduct } from "./lib/diagnose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "reports");
mkdirSync(OUT, { recursive: true });
const db = openDb();

const products = db
  .prepare("SELECT * FROM products WHERE brand_key = 'foa' AND resolution = 'unresolved' ORDER BY sku")
  .all();

const candsFor = db.prepare(`
  SELECT origin, original_url, resolved_url, reject_reason, width, height
  FROM candidate_images WHERE sku = ? AND origin != 'foa_page' ORDER BY origin
`);

const rows = [];
for (const p of products) {
  const cands = candsFor.all(p.sku);
  const cls = classifyProduct(p.sku, cands);
  rows.push({
    sku: p.sku, product_name: p.name || "", collection: p.collection || "", type: p.type || "",
    current_image_url: cls.current_image_url || p.current_image || "", image_filename: cls.image_filename,
    failure_kind: cls.failure_kind, matched_sku_portion: cls.matched_sku_portion,
    unmatched_sku_suffix: cls.unmatched_sku_suffix,
    likely_piece_type_or_config_suffix: cls.likely_piece_type_or_config_suffix,
    wrong_photo_risk: cls.wrong_photo_risk, reason: cls.reason,
  });
}

const HEADER = [
  "sku", "product_name", "collection", "type", "current_image_url", "image_filename",
  "failure_kind", "matched_sku_portion", "unmatched_sku_suffix",
  "likely_piece_type_or_config_suffix", "wrong_photo_risk", "reason",
];
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => csvEsc(r[h])).join(","))].join("\n");
writeFileSync(join(OUT, "FOA-unresolved-diagnosis.csv"), csv);

const byRisk = { high: 0, medium: 0, low: 0 };
const byKind = {};
for (const r of rows) { byRisk[r.wrong_photo_risk] = (byRisk[r.wrong_photo_risk] || 0) + 1; byKind[r.failure_kind] = (byKind[r.failure_kind] || 0) + 1; }

const summary = `# FOA unresolved products — wrong-photo-risk diagnosis

_Generated ${new Date().toISOString()} from \`image-pipeline/pipeline.db\`._

Unresolved FOA products: ${products.length}. Rows in CSV: ${rows.length} (one per product — must equal the product count above).

## By wrong-photo risk
- **high** (likely wrong/missing photo — recommend reviewing for hiding): **${byRisk.high || 0}**
- **medium** (ambiguous — matcher doesn't recognize the suffix, could go either way): **${byRisk.medium || 0}**
- **low** (almost certainly the right photo, just an unverified piece-type/config suffix — safe to keep showing): **${byRisk.low || 0}**

## By failure kind
${Object.entries(byKind).map(([k, v]) => `- \`${k}\`: ${v}`).join("\n")}

CSV: \`reports/FOA-unresolved-diagnosis.csv\` — columns: sku, product_name, collection, type,
current_image_url, image_filename, failure_kind, matched_sku_portion, unmatched_sku_suffix,
likely_piece_type_or_config_suffix, wrong_photo_risk, reason.
`;
writeFileSync(join(OUT, "FOA-unresolved-diagnosis-SUMMARY.md"), summary);
console.log(summary);
db.close();
