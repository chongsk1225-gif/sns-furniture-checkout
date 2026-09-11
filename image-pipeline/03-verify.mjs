// Phase 03 — verify + classify fetched candidates, dedup, build each product's gallery. No network.
//   node 03-verify.mjs --brand acme [--sku SKU]
import { openDb, startRun, finishRun, installShutdown, integrityOk } from "./lib/db.mjs";
import { hamming, normSku, skuVariants, nowIso, parseArgs } from "./lib/util.mjs";
import { kindRank } from "./lib/sources.mjs";

const args = parseArgs(process.argv.slice(2));
const db = openDb();
installShutdown(db);
if (!integrityOk(db)) { console.error("FATAL: pipeline.db failed integrity_check — rebuild with 01-seed"); process.exit(2); }
const runId = startRun(db, "03-verify", args);

const MIN_SIDE = 400;
const PREFER_SIDE = 800;
const PHASH_DUP = 4;           // near-certain visual duplicate
const PHASH_DUP_SAMEDIM = 10;  // + identical dimensions + near-identical byte size (re-compression)
const PHASH_REVIEW = 10;       // 5..10 without a size match — keep BOTH, flag for human review

let pwhere = "1=1";
const pp = [];
if (args.brand) { pwhere += " AND brand_key = ?"; pp.push(args.brand); }
if (args.sku) { pwhere += " AND sku = ?"; pp.push(args.sku); }
const products = db.prepare(`SELECT * FROM products WHERE ${pwhere} ORDER BY sku`).all(...pp);
console.log(`verifying ${products.length} products`);

const getCands = db.prepare(
  "SELECT * FROM candidate_images WHERE sku = ? AND status IN ('fetched','verified','rejected')",
);
const updCand = db.prepare(`
  UPDATE candidate_images SET status=@status, kind=@kind, rights_class=@rights_class,
    reject_reason=@reject_reason, dup_of=@dup_of, gallery_rank=@gallery_rank,
    sku_token_in_url=@sku_token_in_url, match_json=@match_json, verified_at=@verified_at
  WHERE id=@id
`);
const updProd = db.prepare(`
  UPDATE products SET resolution=@resolution, state=@state, final_image=@final_image,
    final_card_image=@final_card_image, final_gallery_json=@final_gallery_json, notes=@notes
  WHERE sku=@sku
`);

function aspect(w, h) {
  if (!w || !h) return 1;
  return Math.max(w, h) / Math.min(w, h);
}
function baseName(url) {
  return (url.split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/, "");
}
function numSuffix(url) {
  const m = baseName(url).match(/_(\d{1,2})(?:_\d+)?$/);
  return m ? Number(m[1]) : 0;
}
/** "X_1" is Magento's re-save of "X" — treat as a duplicate of the sibling without the trailing _1. */
function isResaveSiblingOf(url, otherUrls) {
  const b = baseName(url);
  const m = b.match(/^(.+)_1$/);
  return m ? otherUrls.has(m[1]) : false;
}
function skuTokensInFile(sku, url) {
  const file = (url.split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/, "");
  const parts = file.split(/[_-]/).filter(Boolean);
  const vs = new Set(skuVariants(sku).map((v) => normSku(v).toLowerCase()));
  return parts.filter((p) => vs.has(normSku(p).toLowerCase()));
}

let stats = { done: 0, official_multi: 0, verified_single_image: 0, unresolved: 0,
  imgs_verified: 0, rej_sku: 0, rej_small: 0, rej_dup_exact: 0, rej_dup_phash: 0, rej_other: 0,
  hit3plus: 0, blurry_kept: 0 };

db.exec("BEGIN");
for (const p of products) {
  const cands = getCands.all(p.sku);
  const evaluated = [];

  for (const c of cands) {
    const url = c.resolved_url || c.original_url;
    let kind = c.kind || "unknown";
    const w = c.width, h = c.height;
    const long = Math.max(w || 0, h || 0);
    const ar = aspect(w, h);
    if (kind !== "diagram" && kind !== "lifestyle" && ar > 2.2) kind = "diagram"; // dimension strips / banners
    const tokensInFile = skuTokensInFile(p.sku, url);
    const inUrl = c.sku_token_in_url === 1 || tokensInFile.length > 0;
    const isCombo = tokensInFile.length >= 2 || kind === "combo";

    const ev = {
      manufacturer: c.rights_class === "official_manufacturer" ? "official (host)" : c.rights_class,
      exact_sku: inUrl ? "sku token present in filename/URL"
        : isCombo ? "set/combo photo — this SKU is one token"
        : "SKU token NOT in filename",
      name_collection: `${p.name || ""} / ${p.collection || ""} (manufacturer-feed asserted)`,
      color_finish: `${p.finish || "n/a"} (manufacturer-feed asserted)`,
      size_config: `${p.type || ""} (manufacturer-feed asserted)`,
      sectional_orientation: /sectional/i.test(p.type || p.name || "") ? "n/a in feed — flag for manual" : "n/a",
      source_url: url,
      source_page: c.source_page || "",
      dimensions: w && h ? `${w}x${h}` : "unknown",
      watermark: c.rights_class === "official_manufacturer" ? "none (manufacturer host)" : "unchecked",
      perceptual_dup: "checked in dedup pass",
    };

    let status = "verified", reject = null;
    if (c.rights_class === "rejected") { status = "rejected"; reject = c.reject_reason || "rights_rejected"; }
    else if (c.rights_class === "retailer_owned_permission_required") { status = "rejected"; reject = "retailer_owned_held"; }
    else if (!w || !h) { status = "rejected"; reject = "undecodable"; }
    else if (long < MIN_SIDE) { status = "rejected"; reject = "too_small"; stats.rej_small++; }
    else if (!inUrl && !isCombo) { status = "rejected"; reject = "sku_mismatch"; stats.rej_sku++; }

    if (long >= MIN_SIDE && long < PREFER_SIDE && status === "verified") stats.blurry_kept++;

    evaluated.push({ c, url, kind, w, h, long, ar, isCombo, ev, status, reject,
      sortKey: [kindRank(kind), numSuffix(url) || 99, -(c.bytes || 0)] });
  }

  // ---- dedup among the ones still "verified" -----------------------------
  const verifiedUrls = new Set(evaluated.filter((e) => e.status === "verified").map((e) => baseName(e.url)));
  const kept = [];
  evaluated
    .filter((e) => e.status === "verified")
    .sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.sortKey[2] - b.sortKey[2])
    .forEach((e) => {
      // exact bytes
      const exact = kept.find((k) => k.c.sha256 && k.c.sha256 === e.c.sha256);
      if (exact) { e.status = "rejected"; e.reject = "exact_dup"; e.c.dup_of = exact.c.id; stats.rej_dup_exact++; return; }
      // Magento "X_1" re-save of an also-kept "X"
      if (isResaveSiblingOf(e.url, verifiedUrls)) {
        const sib = kept.find((k) => baseName(e.url) === baseName(k.url) + "_1" || baseName(k.url) === baseName(e.url).replace(/_1$/, ""));
        e.status = "rejected"; e.reject = "resave_dup"; if (sib) e.c.dup_of = sib.c.id; stats.rej_dup_phash++; return;
      }
      // perceptual — conservative: only drop when near-certain; otherwise keep both + flag
      let dropForNear = null, reviewNote = null;
      for (const k of kept) {
        if (!e.c.phash || !k.c.phash) continue;
        const hd = hamming(k.c.phash, e.c.phash);
        const sameDim = e.w === k.w && e.h === k.h;
        const byteClose = e.c.bytes && k.c.bytes && Math.abs(e.c.bytes - k.c.bytes) / Math.max(e.c.bytes, k.c.bytes) < 0.08;
        if (hd <= PHASH_DUP || (sameDim && byteClose && hd <= PHASH_DUP_SAMEDIM)) { dropForNear = k; break; }
        if (hd <= PHASH_REVIEW) reviewNote = `near_dup:${k.c.id.slice(0, 8)}:hd${hd}`;
      }
      if (dropForNear) {
        if ((e.c.bytes || 0) > (dropForNear.c.bytes || 0) && (e.long || 0) >= (dropForNear.long || 0)) {
          dropForNear.status = "rejected"; dropForNear.reject = "perceptual_dup"; dropForNear.c.dup_of = e.c.id;
          kept[kept.indexOf(dropForNear)] = e;
        } else {
          e.status = "rejected"; e.reject = "perceptual_dup"; e.c.dup_of = dropForNear.c.id;
        }
        stats.rej_dup_phash++;
        return;
      }
      if (reviewNote) { e.reviewNote = reviewNote; stats.near_dup_review = (stats.near_dup_review || 0) + 1; }
      kept.push(e);
    });

  // ---- rank + resolution ------------------------------------------------
  kept.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.sortKey[2] - b.sortKey[2]);
  kept.forEach((e, i) => (e.rank = i));

  const realPhotos = kept.filter((e) => e.kind === "primary" || e.kind === "alt");
  const galleryUrls = kept.map((e) => e.url);
  let resolution, notes = null, finalImage = "", finalCard = "";

  if (kept.length === 0) {
    resolution = "unresolved";
    const cur = p.current_image || "";
    // keep the current image only if it is an official manufacturer URL carrying this SKU
    const curOk = /acmecorp\.com|foagroup\.com/i.test(cur) &&
      skuVariants(p.sku).some((v) => normSku(cur).toUpperCase().includes(normSku(v).toUpperCase()) && normSku(v).length >= 4);
    finalImage = curOk ? cur : "";
    finalCard = finalImage;
    notes = curOk ? "unresolved_kept_current_official" : "unresolved_no_verified_image";
    stats.unresolved++;
  } else if (kept.length === 1) {
    resolution = "verified_single_image";
    finalImage = galleryUrls[0];
    finalCard = galleryUrls[0];
    stats.verified_single_image++;
  } else {
    resolution = "official_multi";
    finalImage = (realPhotos[0] || kept[0]).url;
    finalCard = finalImage;
    stats.official_multi++;
  }
  if (kept.length >= 3) stats.hit3plus++;
  stats.imgs_verified += kept.length;

  // ---- persist candidates + product ----------------------------------
  for (const e of evaluated) {
    updCand.run({
      id: e.c.id,
      status: e.status,
      kind: e.kind,
      rights_class: e.c.rights_class,
      reject_reason: e.reject,
      dup_of: e.c.dup_of || null,
      gallery_rank: e.status === "verified" ? e.rank : null,
      sku_token_in_url: e.c.sku_token_in_url,
      match_json: JSON.stringify(e.reviewNote ? { ...e.ev, review: e.reviewNote } : e.ev),
      verified_at: nowIso(),
    });
    if (e.status === "rejected" && !["sku_mismatch", "too_small", "exact_dup", "perceptual_dup", "resave_dup", "retailer_owned_held", "broken_url", "not_an_image", "undecodable"].includes(e.reject)) stats.rej_other++;
  }
  updProd.run({
    sku: p.sku,
    resolution,
    state: resolution === "unresolved" ? "exception" : "done",
    final_image: finalImage,
    final_card_image: finalCard,
    final_gallery_json: JSON.stringify(kept.length ? galleryUrls : (finalImage ? [finalImage] : [])),
    notes,
  });
  stats.done++;
}
db.exec("COMMIT");

finishRun(db, runId, stats);
console.log(JSON.stringify(stats, null, 2));
db.close();
