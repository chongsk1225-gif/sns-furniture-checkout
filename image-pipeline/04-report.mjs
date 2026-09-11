// Phase 04 — before/after + exception reports. No network.
//   node 04-report.mjs [--brand acme|foa]
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, installShutdown, acquireLock } from "./lib/db.mjs";
import { parseArgs } from "./lib/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "reports");
mkdirSync(OUT, { recursive: true });
const args = parseArgs(process.argv.slice(2));
const brand = args.brand || null;
const label = brand ? brand.toUpperCase() : "ALL";
const releaseLock = acquireLock({ force: !!args.force, label: `04-report ${brand || "all"} pid${process.pid}` });
const db = openDb();
installShutdown(db, () => { try { releaseLock(); } catch {} });
const runId = startRun(db, "04-report", args);

const pWhere = brand ? "WHERE brand_key = ?" : "";
const pArgs = brand ? [brand] : [];
const prods = db.prepare(`SELECT * FROM products ${pWhere}`).all(...pArgs);

const bucket = (n) => (n >= 5 ? "5+" : String(n));
const dist = (getN) => {
  const d = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
  for (const p of prods) d[bucket(getN(p))]++;
  return d;
};
const before = dist((p) => p.current_image_count || 0);
const afterN = (p) => {
  try {
    return JSON.parse(p.final_gallery_json || "[]").length;
  } catch {
    return 0;
  }
};
const after = dist(afterN);

const candWhere = brand
  ? "WHERE sku IN (SELECT sku FROM products WHERE brand_key = ?)"
  : "";
const rc = (sql) => db.prepare(sql).all(...pArgs);
const one = (sql) => db.prepare(sql).get(...pArgs).n;

const rejByReason = rc(
  `SELECT reject_reason, COUNT(*) n FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} status='rejected' GROUP BY reject_reason ORDER BY n DESC`,
);
const verifiedImgs = one(
  `SELECT COUNT(*) n FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} status='verified'`,
);
const blurryKept = one(
  `SELECT COUNT(*) n FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} status='verified' AND MAX(IFNULL(width,0),IFNULL(height,0)) < 800`,
);
const brokenUrls = one(
  `SELECT COUNT(*) n FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} reject_reason='broken_url'`,
);
const retailerHeld = rc(
  `SELECT sku, original_url, source_page FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} rights_class='retailer_owned_permission_required'`,
);

const byRes = {};
for (const p of prods) byRes[p.resolution || "not_run"] = (byRes[p.resolution || "not_run"] || 0) + 1;
const unresolved = prods.filter((p) => p.resolution === "unresolved");
const singles = prods.filter((p) => p.resolution === "verified_single_image");
const hit3 = prods.filter((p) => afterN(p) >= 3).length;
const thumbsReplaced = prods.filter((p) => {
  const c = p.current_image || "";
  const f = p.final_image || "";
  return (/223x223|\/cache\/\d+\//.test(c)) && f && !/223x223|\/cache\/\d+\/(?!small_image\/465)/.test(f);
}).length;

const unresolvedByBrand = {};
for (const p of unresolved) unresolvedByBrand[p.brand || "?"] = (unresolvedByBrand[p.brand || "?"] || 0) + 1;

// ---- markdown ----------------------------------------------------------
const row = (o) => ["0", "1", "2", "3", "4", "5+"].map((k) => String(o[k]).padStart(6)).join(" |");
const md = `# Image remediation — ${label} before / after

_Generated ${new Date().toISOString()} from \`image-pipeline/pipeline.db\`._

## Products audited: ${prods.length}${brand ? ` (${brand.toUpperCase()})` : ""}

### Images per product

| images |     0 |     1 |     2 |     3 |     4 |    5+ |
|--------|------:|------:|------:|------:|------:|------:|
| before |${row(before)} |
| after  |${row(after)} |

- Products now with **≥ 3 verified unique images**: **${hit3}**
- Products **\`verified_single_image\`**: **${singles.length}**
- Products **unresolved** (no verified exact-SKU image): **${unresolved.length}**

### Image work

| metric | count |
|---|---:|
| Verified images in galleries | ${verifiedImgs} |
| Thumbnail/low-res primaries replaced | ${thumbsReplaced} |
| Verified images still < 800 px (kept, not upscaled) | ${blurryKept} |
| Broken source URLs | ${brokenUrls} |
| Duplicates removed (exact bytes) | ${rejByReason.find((r) => r.reject_reason === "exact_dup")?.n || 0} |
| Duplicates removed (re-save sibling) | ${rejByReason.find((r) => r.reject_reason === "resave_dup")?.n || 0} |
| Duplicates removed (perceptual) | ${rejByReason.find((r) => r.reject_reason === "perceptual_dup")?.n || 0} |
| Rejected — SKU mismatch / not this SKU | ${rejByReason.find((r) => r.reject_reason === "sku_mismatch")?.n || 0} |
| Rejected — too small (< 400 px) | ${rejByReason.find((r) => r.reject_reason === "too_small")?.n || 0} |
| Retailer-owned images held for permission | ${retailerHeld.length} |

### Resolution breakdown
${Object.entries(byRes).map(([k, v]) => `- \`${k}\`: ${v}`).join("\n")}

### All rejection reasons
${rejByReason.map((r) => `- \`${r.reject_reason || "(none)"}\`: ${r.n}`).join("\n")}

### Unresolved by manufacturer
${Object.entries(unresolvedByBrand).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none)"}

## Exception files
- \`reports/${label}-exceptions-sku-mismatch.csv\`
- \`reports/${label}-exceptions-unresolved.csv\`
- \`reports/${label}-retailer-owned-permission-required.csv\`
`;
writeFileSync(join(OUT, `${label}-before-after.md`), md);

// ---- CSVs ------------------------------------------------------------
const csv = (rows, header) =>
  [header.join(","), ...rows.map((r) => header.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");

const mismatch = rc(
  `SELECT sku, resolved_url AS url, source_page, kind, width, height, match_json
     FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} reject_reason='sku_mismatch' ORDER BY sku`,
);
writeFileSync(join(OUT, `${label}-exceptions-sku-mismatch.csv`),
  csv(mismatch, ["sku", "url", "source_page", "kind", "width", "height", "match_json"]));

writeFileSync(join(OUT, `${label}-exceptions-unresolved.csv`),
  csv(unresolved.map((p) => ({ sku: p.sku, brand: p.brand, name: p.name, category: p.category,
    current_image: p.current_image, note: p.notes })),
    ["sku", "brand", "name", "category", "current_image", "note"]));

writeFileSync(join(OUT, `${label}-retailer-owned-permission-required.csv`),
  csv(retailerHeld, ["sku", "original_url", "source_page"]));

const nearDupRows = rc(
  `SELECT sku, resolved_url AS url, width, height, match_json
     FROM candidate_images ${candWhere} ${candWhere ? "AND" : "WHERE"} status='verified' AND match_json LIKE '%"review":"near_dup%' ORDER BY sku`,
);
writeFileSync(join(OUT, `${label}-near-duplicate-review.csv`),
  csv(nearDupRows, ["sku", "url", "width", "height", "match_json"]));

const counts = { products: prods.length, before, after, verifiedImgs, unresolved: unresolved.length,
  verified_single_image: singles.length, hit3plus: hit3, retailer_held: retailerHeld.length };
finishRun(db, runId, counts);
console.log(md);
console.log(`\nwrote reports/ for ${label}`);
try { releaseLock(); } catch {}
db.close();
