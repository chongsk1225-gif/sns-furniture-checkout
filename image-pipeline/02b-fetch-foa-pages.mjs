// Phase 02b — FOA Milestone 2: scrape each FOA product page for its real image
// gallery (the CDN-upgrade seed only ever captured the single catalog thumbnail).
//   node 02b-fetch-foa-pages.mjs [--limit N] [--sku SKU] [--force]
//
// FOA product pages are Magento pages that also show "related products" for
// OTHER SKUs — this only keeps image URLs whose filename actually carries the
// current product's SKU token (via the same skuTokenInUrl() check 01-seed and
// 03-verify use), so a neighbouring SKU's photo is never pulled in as this
// product's gallery. Kept URLs are seeded as new 'pending' candidate_images
// rows (origin=foa_page_gallery) for the normal 02-fetch.mjs to fetch+hash and
// 03-verify.mjs to verify/dedupe — this script never marks an image verified
// itself. The scraped page's own foa_page row is marked rejected/
// page_scraped_not_image (or error/broken_url) so it isn't reprocessed.
//
// Same concurrency model as 02-fetch.mjs: single OS lock, bounded network
// concurrency, one serialized writer flushing batched transactions.
import { openDb, startRun, finishRun, installShutdown, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { sha1, nowIso, parseArgs } from "./lib/util.mjs";
import { classifyHost, skuTokenInUrl, foaVariants } from "./lib/sources.mjs";

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION", e && e.stack ? e.stack : e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT", e && e.stack ? e.stack : e));

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(8, args.concurrency ? Number(args.concurrency) : 4));
const FLUSH_EVERY = 40;
const FLUSH_MS = 4000;

const releaseLock = acquireLock({ force: !!args.force, label: `02b-fetch-foa-pages pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — rebuild with 01-seed + salvage before fetching.");
  process.exit(2);
}
const runId = startRun(db, "02b-fetch-foa-pages", args);

let where = "origin = 'foa_page' AND status = 'pending'";
const params = [];
if (args.sku) { where += " AND sku = ?"; params.push(args.sku); }

const rows = db
  .prepare(`SELECT id, sku, original_url FROM candidate_images WHERE ${where} ORDER BY sku LIMIT ?`)
  .all(...params, Number.isFinite(LIMIT) ? LIMIT : -1);

console.log(`FOA pages to scrape: ${rows.length}  (net concurrency ${CONCURRENCY})`);

const IMG_RE = /https?:\/\/cdn\.foagroup\.com\/media\/catalog\/product\/[^"'()\s\\]+\.(?:jpe?g|png)/gi;
const SKIP_FILE = /logo|placeholder|no[-_]?image|swatch/i;

/** primary (bare SKU token) vs alt (any numbered/zoom suffix after it) */
function foaImgKind(url) {
  const file = (url.split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/, "");
  return /-([0-9]{1,2}|z)$/.test(file) || /-[0-9]{1,2}_/.test(file) ? "alt" : "primary";
}

const pageUpd = db.prepare(`
  UPDATE candidate_images SET status=@status, reject_reason=@reject_reason,
    match_json=@match_json, attempts=attempts+1, last_error=@last_error, fetched_at=@fetched_at
  WHERE id=@id
`);
const insCand = db.prepare(`
  INSERT INTO candidate_images (id, sku, origin, source_page, original_url, resolved_url,
                                sku_token_in_url, kind, rights_class, reject_reason, status)
  VALUES (@id,@sku,'foa_page_gallery',@source_page,@original_url,@resolved_url,
          1,@kind,@rights_class,@reject_reason,'pending')
  ON CONFLICT(id) DO NOTHING
`);

let done = 0, pagesOk = 0, pagesBroken = 0, pagesErrored = 0, discovered = 0, keptSameSku = 0;
const t0 = Date.now();

// ---- serialized single writer (same pattern as 02-fetch.mjs) -----------
let buf = [];
let lastFlush = Date.now();
let flushing = false;
function flush(finalize = false) {
  if (flushing || buf.length === 0) return;
  flushing = true;
  const batch = buf;
  buf = [];
  try {
    withWriteRetry(() => {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const item of batch) {
          pageUpd.run(item.page);
          for (const c of item.newCands) insCand.run(c);
        }
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
    });
  } catch (e) {
    buf = batch.concat(buf);
    console.error("FLUSH_ERROR (will retry):", String(e && e.message || e));
    flushing = false;
    if (!finalize) return;
    throw e;
  }
  lastFlush = Date.now();
  flushing = false;
}
function maybeFlush() {
  if (buf.length >= FLUSH_EVERY || Date.now() - lastFlush >= FLUSH_MS) flush();
}
const counts = () => ({
  pages_attempted: done, pages_ok: pagesOk, pages_broken: pagesBroken, pages_errored: pagesErrored,
  images_discovered: discovered, images_kept_same_sku: keptSameSku,
  remaining_pages: db.prepare("SELECT COUNT(*) n FROM candidate_images WHERE origin='foa_page' AND status='pending'").get().n,
});
installShutdown(db, () => {
  try { flush(true); } catch {}
  try { finishRun(db, runId, { ...counts(), interrupted: true }); } catch {}
  try { releaseLock(); } catch {}
});

await pool(rows, CONCURRENCY, async (row) => {
  try {
    const r = await politeFetch(row.original_url, { timeoutMs: 30000 });
    const page = {
      id: row.id, status: "error", reject_reason: null, match_json: null,
      last_error: r.error || null, fetched_at: nowIso(),
    };
    const newCands = [];

    if (r.error === "not_found" || r.status === 404 || r.status === 410) {
      page.status = "rejected"; page.reject_reason = "broken_url"; pagesBroken++;
    } else if (!r.ok || !r.buffer) {
      page.status = "error"; pagesErrored++;
    } else {
      const html = r.buffer.toString("utf8");
      const found = [...new Set(html.match(IMG_RE) || [])].filter((u) => !SKIP_FILE.test(u));
      discovered += found.length;
      const kept = found.filter((u) => skuTokenInUrl(row.sku, u));
      keptSameSku += kept.length;
      for (const u of kept) {
        const v = foaVariants(u);
        const host = classifyHost(v.full);
        newCands.push({
          id: sha1(`${row.sku}|${u}`),
          sku: row.sku,
          source_page: row.original_url,
          original_url: u,
          resolved_url: v.full,
          kind: foaImgKind(u),
          rights_class: host.rights_class,
          reject_reason: host.reason,
        });
      }
      page.status = "rejected"; // the page itself is never an image
      page.reject_reason = "page_scraped_not_image";
      page.match_json = JSON.stringify({ discovered: found.length, kept_same_sku: kept.length });
      pagesOk++;
    }

    buf.push({ page, newCands });
    done++;
    maybeFlush();
    if (done % 100 === 0) {
      const rate = (done / ((Date.now() - t0) / 1000)).toFixed(2);
      console.log(`  ${done}/${rows.length}  ok=${pagesOk} broken=${pagesBroken} err=${pagesErrored} newImgs=${keptSameSku}  ${rate}/s`);
    }
  } catch (err) {
    console.error("WORKER_ERR", row.id, String(err && err.message ? err.message : err));
    buf.push({ page: { id: row.id, status: "error", reject_reason: null, match_json: null,
      last_error: String(err).slice(0, 300), fetched_at: nowIso() }, newCands: [] });
    done++; pagesErrored++;
    maybeFlush();
  }
});

for (let i = 0; i < 5 && buf.length; i++) {
  try { flush(true); } catch { await new Promise((r) => setTimeout(r, 500)); }
}

const final = counts();
finishRun(db, runId, final);
console.log(JSON.stringify(final, null, 2));
try { releaseLock(); } catch {}
db.close();
