// Phase 05 — emit a PROPOSED dataset for review. Writes ONLY to image-pipeline/proposed/.
// Never touches public/. No network.
//   node 05-build-dataset.mjs [--brand acme|foa]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, installShutdown, acquireLock } from "./lib/db.mjs";
import { parseArgs } from "./lib/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "public", "data");
const OUT = join(HERE, "proposed");
const OUTD = join(OUT, "data");
const args = parseArgs(process.argv.slice(2));
const brand = args.brand || null;
// NOTE: this rebuild is brand-filtered — running --brand acme then --brand foa
// separately would have the second run overwrite the first's output with
// unfiltered (unfixed) rows for the other brand. Run brand-unfiltered once
// both manufacturers are verified for the combined proposed/ dataset.
const releaseLock = acquireLock({ force: !!args.force, label: `05-build ${brand || "all"} pid${process.pid}` });
const db = openDb();
installShutdown(db, () => { try { releaseLock(); } catch {} });
const runId = startRun(db, "05-build", args);

rmSync(OUTD, { recursive: true, force: true });
mkdirSync(join(OUTD, "details"), { recursive: true });

const index = JSON.parse(readFileSync(join(SRC, "catalog-index.json"), "utf8"));
const details = {};
for (const f of readdirSync(join(SRC, "details"))) {
  if (f.endsWith(".json")) details[f] = JSON.parse(readFileSync(join(SRC, "details", f), "utf8"));
}

const prodRows = db
  .prepare(
    `SELECT * FROM products ${brand ? "WHERE brand_key = ?" : ""}`,
  )
  .all(...(brand ? [brand] : []));
const bySku = new Map(prodRows.map((p) => [p.sku, p]));

const candFor = db.prepare(
  "SELECT resolved_url, width, height, kind, rights_class, bytes, gallery_rank FROM candidate_images WHERE sku = ? AND status='verified' ORDER BY gallery_rank",
);

let changedIndex = 0, changedDetail = 0, singles = 0, unresolved = 0, multi = 0;
const samples = [];

// ---- catalog-index (card image) ------------------------------------
// A hidden product (e.g. 11-foa-hide-high-risk.mjs) is dropped from the
// browsable/sellable listing entirely — its detail record is kept (below),
// just not this array, which is what site.js's catalog grid iterates.
let hiddenFromIndex = 0;
const nextIndex = index
  .filter((row) => {
    const p = bySku.get(String(row.sku));
    if (p && p.hidden) { hiddenFromIndex++; return false; }
    return true;
  })
  .map((row) => {
    const p = bySku.get(String(row.sku));
    if (!p || !p.resolution || p.resolution === "unresolved" && !p.final_image) return row;
    if (p.final_card_image && p.final_card_image !== row.image) {
      changedIndex++;
      return { ...row, image: p.final_card_image };
    }
    return row;
  });
writeFileSync(join(OUTD, "catalog-index.json"), JSON.stringify(nextIndex));

// ---- details (main image + gallery + provenance) ------------------
for (const [fname, arr] of Object.entries(details)) {
  const next = arr.map((rec) => {
    const p = bySku.get(String(rec.sku));
    if (!p || !p.resolution) return rec;
    if (p.hidden) {
      // Kept (not deleted) so a direct/saved link still shows product info +
      // a review notice instead of a raw 404 — but not purchasable: site.js
      // and product-page.js already render "CHECK PRICE / CHECK AVAILABILITY"
      // with no Add-to-Cart button whenever sale is null, so this alone
      // blocks purchase with zero frontend code changes.
      return { ...rec, sale: null, was: null, hidden: true, needs_review: true,
        hidden_reason: p.hidden_reason || "",
        image_verification: { status: p.resolution, hidden: true, wrong_photo_risk: "high", note: p.hidden_reason || "" } };
    }
    const cands = candFor.all(rec.sku);
    if (p.resolution === "unresolved") {
      unresolved++;
      return {
        ...rec,
        image: p.final_image || rec.image,
        gallery: p.final_image ? [p.final_image] : rec.gallery,
        image_verification: { status: "unresolved", note: p.notes || "" },
      };
    }
    const gallery = cands.map((c) => c.resolved_url);
    if (!gallery.length) return rec;
    changedDetail++;
    if (p.resolution === "verified_single_image") singles++;
    if (p.resolution === "official_multi") multi++;
    if (samples.length < 30 && (samples.length % 2 === 0 || p.resolution === "verified_single_image")) {
      samples.push({ sku: rec.sku, name: rec.name, brand: rec.brand, category: rec.category,
        resolution: p.resolution, images: gallery.length });
    }
    return {
      ...rec,
      image: p.final_image || gallery[0],
      gallery,
      verified_single_image: p.resolution === "verified_single_image" || undefined,
      image_verification: {
        status: p.resolution,
        source: "official_manufacturer",
        count: gallery.length,
        provenance: cands.map((c) => ({
          url: c.resolved_url,
          w: c.width,
          h: c.height,
          kind: c.kind,
          rights: c.rights_class,
        })),
      },
    };
  });
  writeFileSync(join(OUTD, "details", fname), JSON.stringify(next));
}

// pass through the small helper files unchanged
for (const f of ["catalog-qa.json", "catalog-pricing.json"]) {
  try {
    writeFileSync(join(OUTD, f), readFileSync(join(SRC, f)));
  } catch {}
}

const diff = `# Proposed dataset — ${brand ? brand.toUpperCase() : "ALL"} — DIFF SUMMARY

_Generated ${new Date().toISOString()}. Files live in \`image-pipeline/proposed/data/\` — **not** in \`public/\`._

- catalog-index rows with a new card image: **${changedIndex}**
- detail records with a rebuilt gallery: **${changedDetail}**
  - \`official_multi\`: ${multi}
  - \`verified_single_image\`: ${singles}
- detail records left \`unresolved\` (image unchanged / blanked per note): ${unresolved}
- products hidden (removed from catalog-index, not purchasable): ${hiddenFromIndex}

Review with:  \`node serve-proposed.mjs\`  → http://127.0.0.1:8799/

## Sample products for visual review
${samples.map((s) => `- [${s.sku}] ${s.name} — ${s.brand} / ${s.category} — ${s.resolution}, ${s.images} img → http://127.0.0.1:8799/product.html?sku=${encodeURIComponent(s.sku)}`).join("\n")}
`;
writeFileSync(join(OUT, "DIFF-SUMMARY.md"), diff);

const counts = { changedIndex, changedDetail, multi, singles, unresolved, hiddenFromIndex };
finishRun(db, runId, counts);
console.log(diff);
try { releaseLock(); } catch {}
db.close();
