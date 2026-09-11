// Phase 06 — build the FOA Media Access request package.
// Every FOA product with FEWER THAN 3 verified unique images (not just the
// unresolved ones) goes in this CSV: verified_single_image (1) and the
// 2-image slice of official_multi need more images too. No network, no
// writes to public/ or pipeline.db — reports/ only.
//   node 06-foa-media-request.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./lib/db.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "reports");
mkdirSync(OUT, { recursive: true });
const db = openDb();

const products = db
  .prepare("SELECT * FROM products WHERE brand_key = 'foa' ORDER BY sku")
  .all();

const soleCandReason = db.prepare(`
  SELECT reject_reason FROM candidate_images
  WHERE sku = ? AND status = 'rejected' AND origin != 'foa_page'
  ORDER BY (reject_reason = 'sku_mismatch') DESC LIMIT 1
`);

function verifiedGallery(p) {
  if (p.resolution === "unresolved") return [];
  try { return JSON.parse(p.final_gallery_json || "[]"); } catch { return []; }
}

const REASON_TEXT = {
  sku_mismatch: "the only source image found does not carry this exact SKU/model token — likely wrong photo or an unlisted variant naming pattern",
  too_small: "the only source image found is under the 400px verified-quality floor",
  broken_url: "the source image URL returned a broken/not-found response",
  not_an_image: "the source URL did not return an image file",
  undecodable: "the source image file could not be decoded",
  retailer_owned_held: "only retailer-hosted images were found (held for permission, not usable without a rights grant)",
};

const rows = [];
const counts = { unresolved: 0, verified_1: 0, verified_2: 0, verified_3plus_excluded: 0 };

for (const p of products) {
  const gallery = verifiedGallery(p);
  const verifiedCount = p.resolution === "unresolved" ? 0 : gallery.length;

  let category;
  if (p.resolution === "unresolved") category = "unresolved_current_image_retained";
  else if (verifiedCount <= 1) category = "verified_single_image";
  else if (verifiedCount === 2) category = "verified_two_image";
  else { counts.verified_3plus_excluded++; continue; } // satisfied — not part of the request

  counts[category === "unresolved_current_image_retained" ? "unresolved" : category === "verified_single_image" ? "verified_1" : "verified_2"]++;

  let problem;
  if (category === "unresolved_current_image_retained") {
    const r = soleCandReason.get(p.sku);
    problem = r?.reject_reason && REASON_TEXT[r.reject_reason]
      ? `Unresolved — ${REASON_TEXT[r.reject_reason]}. Current catalog image kept unchanged pending review.`
      : "Unresolved — no source image passed exact-SKU verification. Current catalog image kept unchanged pending review.";
  } else if (category === "verified_single_image") {
    problem = "Only 1 official manufacturer-CDN image exists/verified for this SKU — no alternate angles, lifestyle, or detail shots available.";
  } else {
    problem = "Only 2 official manufacturer-CDN images exist/verified for this SKU — need at least 1 more (alternate angle, detail, or lifestyle) for a 3-image minimum gallery.";
  }

  const currentImageUrl = category === "unresolved_current_image_retained"
    ? (p.current_image || "")
    : (gallery[0] || p.current_image || "");
  const currentImageCount = category === "unresolved_current_image_retained"
    ? (p.current_image_count || 0)
    : verifiedCount;
  const requiredAdditional = Math.max(0, 3 - verifiedCount);

  rows.push({
    sku: p.sku,
    product_name: p.name || "",
    collection: p.collection || "",
    category,
    current_image_count: currentImageCount,
    current_image_url: currentImageUrl,
    verified_official_image_count: verifiedCount,
    required_additional_images: requiredAdditional,
    resolution_problem: problem,
  });
}

const HEADER = [
  "sku", "product_name", "collection", "category", "current_image_count",
  "current_image_url", "verified_official_image_count", "required_additional_images",
  "resolution_problem",
];
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => csvEsc(r[h])).join(","))].join("\n");
writeFileSync(join(OUT, "FOA-media-access-request.csv"), csv);

const total = counts.unresolved + counts.verified_1 + counts.verified_2 + counts.verified_3plus_excluded;
const summary = `# FOA Media Access request package

_Generated ${new Date().toISOString()} from \`image-pipeline/pipeline.db\`._

FOA products audited: ${total} (must equal 5661: ${total === 5661 ? "OK" : "MISMATCH"})

## Products included in the request (verified official image count < 3): ${rows.length}
- Unresolved — current image retained, 0 officially verified: **${counts.unresolved}**
- Verified single-image (1 official image): **${counts.verified_1}**
- Verified two-image (2 official images): **${counts.verified_2}**

## Excluded — already have 3+ verified official images: ${counts.verified_3plus_excluded}

CSV: \`reports/FOA-media-access-request.csv\` — columns: sku, product_name, collection,
category, current_image_count, current_image_url, verified_official_image_count,
required_additional_images, resolution_problem.
`;
writeFileSync(join(OUT, "FOA-media-access-request-SUMMARY.md"), summary);
console.log(summary);
console.log(JSON.stringify({ total_foa: total, requested: rows.length, ...counts }, null, 2));
db.close();
