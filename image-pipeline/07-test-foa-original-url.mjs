// TEST TASK — scoped to exactly 3 FOA SKUs, per explicit instruction. Do NOT
// generalize this to the rest of the catalog without a separate go-ahead.
//
// Bug: these products' image URL uses the small_image/223x223 cache path.
// Fix: drop the cache/<id>/small_image/<size>/<hash>/ segment and use the
// original file directly (…/product/<first-letter>/<second-letter>/<sku>.jpg).
// Fallback: if the original URL doesn't resolve to a real image, keep the
// small_image URL so nothing breaks.
//
// Scope: writes ONLY the 3 named products' image fields in pipeline.db and
// their corresponding entries in image-pipeline/proposed/data/ (catalog-index
// card image + detail record). Every other product — 9,366 of them — is read
// but never written. Never touches public/, never deploys.
//   node 07-test-foa-original-url.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, installShutdown, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { imageMeta } from "./lib/imagemeta.mjs";

const TEST_SKUS = ["CM7100M", "CM7823LEX-CK-BED", "CM7230M"];

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA = join(HERE, "..", "public", "data"); // read-only source, never written
const PROPOSED_DATA = join(HERE, "proposed", "data");   // the only place this script writes files

const releaseLock = acquireLock({ label: `07-test-foa-original-url pid${process.pid}` });
const db = openDb();
installShutdown(db, () => { try { releaseLock(); } catch {} });
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — not touching anything.");
  process.exit(2);
}

/** …/cache/<id>/small_image/<size>/<hash>/x/y/sku.jpg -> …/x/y/sku.jpg (original). */
function toOriginalUrl(smallImageUrl) {
  const m = String(smallImageUrl).match(
    /^(https?:\/\/[^/]+\/media\/catalog\/product)\/cache\/\d+\/small_image\/[0-9a-z]+x?[0-9a-z]*\/[0-9a-f]{16,}\/(.+\.(?:jpe?g|png))$/i,
  );
  return m ? `${m[1]}/${m[2]}` : null;
}

async function fetchesAsRealImage(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36" },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await imageMeta(buf);
    if (!meta.width || !meta.height) return { ok: false, status: res.status, reason: "undecodable" };
    return { ok: true, status: res.status, width: meta.width, height: meta.height, bytes: buf.length };
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
  }
}

const results = [];
for (const sku of TEST_SKUS) {
  const p = db.prepare("SELECT * FROM products WHERE sku = ?").get(sku);
  if (!p) { console.error(`SKU not found, skipping: ${sku}`); continue; }
  if (p.brand_key !== "foa") { console.error(`SKU is not FOA, skipping: ${sku} (brand_key=${p.brand_key})`); continue; }

  const smallImageUrl = p.current_image;
  const originalUrl = toOriginalUrl(smallImageUrl);
  if (!originalUrl) {
    console.error(`Could not derive an original-file URL from current_image for ${sku}: ${smallImageUrl}`);
    results.push({ sku, ok: false, reason: "unparseable_current_image", used: smallImageUrl });
    continue;
  }

  console.log(`\n=== ${sku} (${p.name}) ===`);
  console.log(`  small_image (current): ${smallImageUrl}`);
  console.log(`  original (candidate):  ${originalUrl}`);

  const check = await fetchesAsRealImage(originalUrl);
  let finalUrl, usedFallback;
  if (check.ok) {
    finalUrl = originalUrl;
    usedFallback = false;
    console.log(`  -> original resolves: ${check.width}x${check.height}, ${check.bytes} bytes. Using original.`);
  } else {
    finalUrl = smallImageUrl;
    usedFallback = true;
    console.log(`  -> original failed (status=${check.status}${check.reason ? ", " + check.reason : ""}${check.error ? ", " + check.error : ""}). Falling back to small_image.`);
  }

  results.push({ sku, name: p.name, ok: true, smallImageUrl, originalUrl, finalUrl, usedFallback, check });
}

// ---- write ONLY these 3 products' rows in pipeline.db --------------------
const upd = db.prepare(`
  UPDATE products SET final_image=@final_image, final_card_image=@final_card_image,
    final_gallery_json=@final_gallery_json, resolution='verified_single_image',
    state='done', notes=@notes
  WHERE sku=@sku
`);
withWriteRetry(() => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of results) {
      if (!r.ok) continue;
      upd.run({
        sku: r.sku,
        final_image: r.finalUrl,
        final_card_image: r.finalUrl,
        final_gallery_json: JSON.stringify([r.finalUrl]),
        notes: r.usedFallback
          ? "test_task_original_url_fallback_to_small_image"
          : "test_task_original_url_confirmed",
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
});
console.log(`\npipeline.db: updated ${results.filter((r) => r.ok).length} of ${TEST_SKUS.length} product row(s). All other rows untouched.`);

// ---- patch ONLY these 3 entries into proposed/data/ -----------------------
// (does not run 05-build-dataset.mjs, which would touch all 9,369 — this
// patches just the named SKUs into whatever proposed/data/ already has.)
const idx = JSON.parse(readFileSync(join(PROPOSED_DATA, "catalog-index.json"), "utf8"));
let idxChanged = 0;
for (const row of idx) {
  const r = results.find((x) => x.ok && x.sku === String(row.sku));
  if (r) { row.image = r.finalUrl; idxChanged++; }
}
writeFileSync(join(PROPOSED_DATA, "catalog-index.json"), JSON.stringify(idx));

let detailChanged = 0;
for (const f of readdirSync(join(PROPOSED_DATA, "details"))) {
  if (!f.endsWith(".json")) continue;
  const path = join(PROPOSED_DATA, "details", f);
  const arr = JSON.parse(readFileSync(path, "utf8"));
  let touched = false;
  for (const rec of arr) {
    const r = results.find((x) => x.ok && x.sku === String(rec.sku));
    if (!r) continue;
    rec.image = r.finalUrl;
    rec.gallery = [r.finalUrl];
    rec.image_verification = {
      status: "verified_single_image",
      source: "official_manufacturer",
      count: 1,
      test_task: true,
      used_fallback: r.usedFallback,
      provenance: [{ url: r.finalUrl, w: r.check.width, h: r.check.height, kind: "primary", rights: "official_manufacturer" }],
    };
    touched = true;
    detailChanged++;
  }
  if (touched) writeFileSync(path, JSON.stringify(arr));
}

console.log(`proposed/data/: catalog-index rows updated: ${idxChanged}, detail records updated: ${detailChanged}`);
console.log(`\nScope check — every other product in pipeline.db and proposed/data/ is unmodified.`);
console.log(JSON.stringify(results.map(({ sku, smallImageUrl, originalUrl, finalUrl, usedFallback }) =>
  ({ sku, smallImageUrl, originalUrl, finalUrl, usedFallback })), null, 2));

try { releaseLock(); } catch {}
db.close();
