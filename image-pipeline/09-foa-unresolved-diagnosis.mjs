// Diagnostic-only report: WHY each unresolved FOA product's sole candidate
// image was rejected by 03-verify.mjs, in plain, specific terms (not just the
// generic "sku_mismatch" reason code) — so a human can judge wrong-photo risk
// per product. Reads pipeline.db; writes only reports/. No network, no writes
// to pipeline.db, proposed/, or public/.
//   node 09-foa-unresolved-diagnosis.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./lib/db.mjs";
import { normSku } from "./lib/util.mjs";

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

function baseName(url) {
  return (String(url).split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/i, "");
}

/**
 * Find the longest leading run of the SKU's own dash-separated segments that
 * appears (normalized, no separators) as a substring of the image filename.
 * Returns { matchedSegs, unmatchedSegs, matchedText } — unmatchedSegs is the
 * trailing part of the SKU the filename does NOT account for (e.g. the
 * "-TABLE" / "-SECT" piece-type or an unrecognized pack code).
 */
function diagnoseMismatch(sku, file) {
  const segs = String(sku).toUpperCase().split("-").filter(Boolean);
  const nf = normSku(file);
  let bestK = 0;
  for (let k = segs.length; k >= 1; k--) {
    const prefix = normSku(segs.slice(0, k).join("-"));
    if (prefix.length >= 4 && nf.includes(prefix)) { bestK = k; break; }
  }
  if (bestK === 0) return { matched: null, unmatched: segs, kind: "no_relation" };
  if (bestK === segs.length) return { matched: segs, unmatched: [], kind: "full_match" }; // shouldn't happen for a rejected candidate, but be safe
  return { matched: segs.slice(0, bestK), unmatched: segs.slice(bestK), kind: "partial_match" };
}

const PIECE_TYPE_HINTS = /^(TABLE|CHAIR|BED|SECT|BENCH|STOOL|MIRROR|NIGHTSTAND|DRESSER|HEADBOARD|DESK|HUTCH|LOVESEAT|SOFA|OTTOMAN|CONSOLE|SERVER|BUFFET|CHEST|VN|VANITY|RUG|LAMP|WEDGE|ARMLESS|CONSOLE|CT|RT|BT|PT|F|Q|EK|CK|TF)$/i;

const rows = [];
for (const p of products) {
  const cands = candsFor.all(p.sku);
  if (cands.length === 0) {
    rows.push({
      sku: p.sku, product_name: p.name || "", collection: p.collection || "", type: p.type || "",
      current_image_url: p.current_image || "", image_filename: "", failure_kind: "no_candidate_image",
      matched_sku_portion: "", unmatched_sku_suffix: "", likely_piece_type_or_config_suffix: "",
      wrong_photo_risk: "high", reason: "No source image URL was found at all for this SKU (no ACME-style feed entry, no CDN candidate).",
    });
    continue;
  }
  for (const c of cands) {
    const url = c.resolved_url || c.original_url;
    const file = baseName(url);
    if (c.reject_reason === "too_small") {
      rows.push({ sku: p.sku, product_name: p.name || "", collection: p.collection || "", type: p.type || "",
        current_image_url: url, image_filename: file, failure_kind: "too_small",
        matched_sku_portion: "", unmatched_sku_suffix: "", likely_piece_type_or_config_suffix: "",
        wrong_photo_risk: "low", reason: `Image is real but under the 400px floor (${c.width || "?"}x${c.height || "?"}) — same photo, just too small to verify.` });
      continue;
    }
    if (c.reject_reason !== "sku_mismatch") {
      rows.push({ sku: p.sku, product_name: p.name || "", collection: p.collection || "", type: p.type || "",
        current_image_url: url, image_filename: file, failure_kind: c.reject_reason || "unknown",
        matched_sku_portion: "", unmatched_sku_suffix: "", likely_piece_type_or_config_suffix: "",
        wrong_photo_risk: "medium", reason: `Rejected for "${c.reject_reason}" — not a SKU-text mismatch.` });
      continue;
    }
    const diag = diagnoseMismatch(p.sku, file);
    if (diag.kind === "no_relation") {
      const isGeneric = /^image_\d+$/i.test(file) || /^\d+$/.test(file);
      rows.push({
        sku: p.sku, product_name: p.name || "", collection: p.collection || "", type: p.type || "",
        current_image_url: url, image_filename: file, failure_kind: "no_relation",
        matched_sku_portion: "", unmatched_sku_suffix: diag.unmatched.join("-"),
        likely_piece_type_or_config_suffix: "",
        wrong_photo_risk: "high",
        reason: isGeneric
          ? "Filename is a generic catalog placeholder (no SKU/model token at all) — likely a wrong or missing photo, not just a naming mismatch."
          : "No part of this SKU appears in the image filename at all — this looks like a different model's photo, not a suffix/piece-type issue.",
      });
      continue;
    }
    const unmatchedStr = diag.unmatched.join("-");
    const looksLikePieceType = diag.unmatched.some((seg) => PIECE_TYPE_HINTS.test(seg));
    rows.push({
      sku: p.sku, product_name: p.name || "", collection: p.collection || "", type: p.type || "",
      current_image_url: url, image_filename: file, failure_kind: "partial_match",
      matched_sku_portion: diag.matched.join("-"),
      unmatched_sku_suffix: unmatchedStr,
      likely_piece_type_or_config_suffix: looksLikePieceType ? "yes" : "unclear",
      wrong_photo_risk: looksLikePieceType ? "low" : "medium",
      reason: looksLikePieceType
        ? `Image matches this product's base model ("${diag.matched.join("-")}") but not its "-${unmatchedStr}" piece-type/configuration suffix — most likely the correct family/set photo, just not verifiable as this exact piece.`
        : `Image matches this product's base model ("${diag.matched.join("-")}") but not its "-${unmatchedStr}" suffix, and that suffix isn't a recognized piece-type word — could be a set/pack code our matcher doesn't recognize, or a genuinely different variant. Worth a manual look.`,
    });
  }
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

Unresolved FOA products: ${products.length}. Rows in CSV (one per rejected candidate, usually 1:1 with product): ${rows.length}.

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
