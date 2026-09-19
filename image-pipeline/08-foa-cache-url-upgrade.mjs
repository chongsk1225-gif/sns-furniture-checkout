// URL-only resolution upgrade for FOA "unresolved" products still showing the
// small_image/223x223 cache path — NO SKU verification involved, deliberately.
//
// Scope: exactly the FOA products where resolution='unresolved' AND
// current_image matches …/cache/<id>/small_image/<size>/<hash>/… (1,132 of
// them, per the 3-SKU pilot's same logic run at full scale). Products already
// on a different cache size (e.g. 700x700 "image" cache — 3 such SKUs exist)
// are out of scope; they don't match the described bug pattern.
//
// Fix: drop the cache/<id>/small_image/<size>/<hash>/ segment, load the
// original file. Fallback: if the original doesn't fetch+decode as a real
// image, keep the small_image URL — same check as 07-test-foa-original-url.mjs
// (HTTP status is not enough; the CDN returns 200 with an undecodable body
// for some bad paths).
//
// Deliberately does NOT touch: resolution, state, current_image,
// current_image_count, or anything SKU-verification-related. `final_image`
// gets set only when the upgrade succeeds (05-build-dataset.mjs already
// treats an unresolved product's final_image as "bigger version of the same
// photo", not as a verification result — see its unresolved-branch: `image:
// p.final_image || rec.image`). A product this script upgrades still reports
// as `unresolved` / `verified official image count: 0` everywhere else.
//
//   node 08-foa-cache-url-upgrade.mjs [--limit N] [--concurrency N]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, installShutdown, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { imageMeta } from "./lib/imagemeta.mjs";
import { nowIso, parseArgs } from "./lib/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROPOSED_DATA = join(HERE, "proposed", "data");
const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(8, args.concurrency ? Number(args.concurrency) : 6));

const releaseLock = acquireLock({ force: !!args.force, label: `08-foa-cache-url-upgrade pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — not touching anything.");
  process.exit(2);
}
const runId = startRun(db, "08-foa-cache-url-upgrade", args);

const CACHE_RE = /^(https?:\/\/[^/]+\/media\/catalog\/product)\/cache\/\d+\/small_image\/[0-9a-z]+x?[0-9a-z]*\/[0-9a-f]{16,}\/(.+\.(?:jpe?g|png))$/i;
function toOriginalUrl(smallImageUrl) {
  const m = String(smallImageUrl).match(CACHE_RE);
  return m ? `${m[1]}/${m[2]}` : null;
}

let targets = db
  .prepare("SELECT sku, current_image FROM products WHERE brand_key='foa' AND resolution='unresolved'")
  .all()
  .map((p) => ({ sku: p.sku, smallImageUrl: p.current_image, originalUrl: toOriginalUrl(p.current_image) }))
  .filter((t) => t.originalUrl); // only the small_image-cache-pattern ones — the 1,132

if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);
console.log(`FOA unresolved products with a small_image URL to upgrade: ${targets.length} (concurrency ${CONCURRENCY})`);

async function fetchesAsRealImage(url) {
  const r = await politeFetch(url, { timeoutMs: 30000 });
  if (!r.ok || !r.buffer) return { ok: false, status: r.status || 0, error: r.error };
  const meta = await imageMeta(r.buffer);
  if (!meta.width || !meta.height) return { ok: false, status: r.status, reason: "undecodable" };
  return { ok: true, status: r.status, width: meta.width, height: meta.height, bytes: r.buffer.length };
}

const upd = db.prepare(`
  UPDATE products SET final_image=@final_image, final_card_image=@final_card_image, notes=@notes
  WHERE sku=@sku
`);

let done = 0, upgraded = 0, fellBack = 0;
const results = [];
const t0 = Date.now();

await pool(targets, CONCURRENCY, async (t) => {
  const check = await fetchesAsRealImage(t.originalUrl);
  const rec = { ok: check.ok, sku: t.sku, smallImageUrl: t.smallImageUrl, originalUrl: t.originalUrl, check };
  results.push(rec);
  done++;
  if (check.ok) upgraded++; else fellBack++;
  if (done % 100 === 0) {
    const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
    console.log(`  ${done}/${targets.length}  upgraded=${upgraded} fellBack=${fellBack}  ${rate}/s`);
  }
});

// ---- single batched write: only the ones that actually upgraded ----------
const toWrite = results.filter((r) => r.ok);
withWriteRetry(() => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of toWrite) {
      upd.run({
        sku: r.sku,
        final_image: r.originalUrl,
        final_card_image: r.originalUrl,
        notes: "unresolved_original_url_upgrade_no_sku_check", // resolution/state left untouched
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
});

const counts = {
  attempted: results.length, upgraded: toWrite.length, fell_back: results.length - toWrite.length,
  remaining_still_small_image: db.prepare(
    "SELECT COUNT(*) n FROM products WHERE brand_key='foa' AND resolution='unresolved' AND (final_image IS NULL OR final_image='')",
  ).get().n,
};
finishRun(db, runId, counts);
console.log(`\npipeline.db: ${toWrite.length} product(s) upgraded to their original URL. All other fields (resolution, state, current_image) and all other products untouched.`);

// ---- patch proposed/data/ directly for just the upgraded SKUs -------------
const upgradedSkus = new Set(toWrite.map((r) => r.sku));
const bySku = new Map(toWrite.map((r) => [r.sku, r.originalUrl]));

const idx = JSON.parse(readFileSync(join(PROPOSED_DATA, "catalog-index.json"), "utf8"));
let idxChanged = 0;
for (const row of idx) {
  const url = bySku.get(String(row.sku));
  if (url && row.image !== url) { row.image = url; idxChanged++; }
}
writeFileSync(join(PROPOSED_DATA, "catalog-index.json"), JSON.stringify(idx));

let detailChanged = 0;
for (const f of readdirSync(join(PROPOSED_DATA, "details"))) {
  if (!f.endsWith(".json")) continue;
  const path = join(PROPOSED_DATA, "details", f);
  const arr = JSON.parse(readFileSync(path, "utf8"));
  let touched = false;
  for (const rec of arr) {
    const url = bySku.get(String(rec.sku));
    if (!url) continue;
    rec.image = url;
    rec.gallery = [url];
    // resolution status is intentionally left as "unresolved" — this is a
    // resolution/size upgrade of the SAME photo, not a SKU-match result.
    rec.image_verification = { ...(rec.image_verification || {}), status: "unresolved", url_upgraded: true, note: "original-file URL confirmed to fetch+decode; not SKU-verified" };
    touched = true;
    detailChanged++;
  }
  if (touched) writeFileSync(path, JSON.stringify(arr));
}

console.log(`proposed/data/: catalog-index rows updated: ${idxChanged}, detail records updated: ${detailChanged}`);
console.log(JSON.stringify(counts, null, 2));

if (results.some((r) => !r.ok)) {
  console.log("\nFell back to small_image (original didn't fetch/decode) for:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.sku}: status=${r.check.status} ${r.check.reason || r.check.error || ""}`);
}

try { releaseLock(); } catch {}
db.close();
