// Second-tier fallback for the FOA products where 08-foa-cache-url-upgrade.mjs
// couldn't reach the original file (CDN 403s on the bare path). Same no-SKU-
// gate approach: try the 465x465 cache render instead of staying on 223x223.
// Still no SKU verification — resolution/state/current_image untouched.
//
// Scope: exactly the FOA products with resolution='unresolved', current_image
// on the small_image cache pattern, and no final_image set yet (28 of them —
// the ones 08-foa-cache-url-upgrade.mjs already tried and fell back on).
//   node 10-foa-465-fallback.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { imageMeta } from "./lib/imagemeta.mjs";
import { foaVariants } from "./lib/sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROPOSED_DATA = join(HERE, "proposed", "data");

const releaseLock = acquireLock({ label: `10-foa-465-fallback pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — not touching anything.");
  process.exit(2);
}
const runId = startRun(db, "10-foa-465-fallback", {});

const targets = db
  .prepare(`
    SELECT sku, current_image FROM products
    WHERE brand_key='foa' AND resolution='unresolved'
      AND (final_image IS NULL OR final_image='')
      AND current_image LIKE '%/small_image/%'
  `)
  .all()
  .map((p) => ({ sku: p.sku, smallImageUrl: p.current_image, cardUrl: foaVariants(p.current_image).card }))
  .filter((t) => t.cardUrl && t.cardUrl !== t.smallImageUrl);

console.log(`Products still on 223x223, trying 465x465 instead: ${targets.length}`);

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

const results = [];
await pool(targets, 4, async (t) => {
  const check = await fetchesAsRealImage(t.cardUrl);
  results.push({ ok: check.ok, sku: t.sku, smallImageUrl: t.smallImageUrl, cardUrl: t.cardUrl, check });
});

const toWrite = results.filter((r) => r.ok);
withWriteRetry(() => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of toWrite) {
      upd.run({
        sku: r.sku,
        final_image: r.cardUrl,
        final_card_image: r.cardUrl,
        notes: "unresolved_465_fallback_upgrade_no_sku_check", // resolution/state left untouched, as before
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
});

const counts = {
  attempted: results.length, upgraded_to_465: toWrite.length,
  still_stuck_on_223: results.length - toWrite.length,
};
finishRun(db, runId, counts);
console.log(`\npipeline.db: ${toWrite.length} product(s) upgraded to the 465x465 render. Everything else (resolution, state, current_image, all other products) untouched.`);

// ---- patch proposed/data/ directly for just the upgraded SKUs -------------
const bySku = new Map(toWrite.map((r) => [r.sku, r.cardUrl]));
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
    rec.image_verification = { ...(rec.image_verification || {}), status: "unresolved", url_upgraded: true, note: "465x465 cache render confirmed to fetch+decode (original 403s); not SKU-verified" };
    touched = true;
    detailChanged++;
  }
  if (touched) writeFileSync(path, JSON.stringify(arr));
}
console.log(`proposed/data/: catalog-index rows updated: ${idxChanged}, detail records updated: ${detailChanged}`);
console.log(JSON.stringify(counts, null, 2));

if (results.some((r) => !r.ok)) {
  console.log("\nStill stuck on 223x223 small_image (465x465 also failed) for:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.sku}: status=${r.check.status} ${r.check.reason || r.check.error || ""}`);
}

try { releaseLock(); } catch {}
db.close();
