// Phase 02c — ACME Milestone: scrape each ACME dealer product page for its
// real image gallery (the supplied CSV feed already covers most SKUs, but a
// minority are feed-single-image and some pages may carry photos the feed
// export missed). Mirrors 02b-fetch-foa-pages.mjs.
//
//   node 02c-fetch-acme-pages.mjs [--limit N] [--sku SKU] [--only-single] [--force]
//
// --only-single restricts the run to products currently at
// current_image_count<=1 (the fast, high-value subset) instead of all 3,708.
//
// ACME's Magento pages embed the full gallery as JSON inside the
// mage/gallery/gallery widget config — {"thumb","img","full","caption",
// "position","isMain","type","videoUrl"} objects — far more reliable than
// regex-scanning <img> tags. We take "full" (the highest-res cache render)
// and strip the /cache/<hash>/ segment to recover the true original file,
// verified to resolve directly on acmecorp.com. robots.txt allows these
// dealer pages (checked live) but sets Crawl-delay: 10 — honored via an
// explicit local pace gate (below), NOT the shared per-host rate bucket in
// lib/ratelimit.mjs: ACME's actual image files live on this same bare
// "acmecorp.com" host, so a host-keyed bucket slow enough for Crawl-delay
// would also throttle every image download to the same crawl.
//
// Same concurrency/writer model as 02-fetch.mjs / 02b: single OS lock,
// one serialized writer flushing batched transactions. This script never
// marks anything "verified" itself — new URLs are seeded as 'pending'
// candidate_images (origin=acme_page_gallery) for the normal 02-fetch.mjs
// to fetch+hash and 03-verify.mjs to verify/dedupe.
import { openDb, startRun, finishRun, installShutdown, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { sha1, nowIso, parseArgs, sleep } from "./lib/util.mjs";
import { classifyHost, skuTokenInUrl, acmeKind } from "./lib/sources.mjs";

const PAGE_DELAY_MS = Number(process.env.ACME_PAGE_DELAY_MS) || 10000; // robots.txt Crawl-delay: 10
let lastPageFetch = 0;
async function pacedPageFetch(url, opts) {
  const wait = lastPageFetch + PAGE_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastPageFetch = Date.now();
  return politeFetch(url, opts);
}

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION", e && e.stack ? e.stack : e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT", e && e.stack ? e.stack : e));

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = 1; // Crawl-delay:10 is a single-file queue, not a burst budget
const FLUSH_EVERY = 20;
const FLUSH_MS = 4000;

const releaseLock = acquireLock({ force: !!args.force, label: `02c-fetch-acme-pages pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — rebuild with 01-seed + salvage before fetching.");
  process.exit(2);
}
const runId = startRun(db, "02c-fetch-acme-pages", args);

let where = "brand_key = 'acme' AND source_url IS NOT NULL AND source_url != ''";
const params = [];
if (args.sku) { where += " AND sku = ?"; params.push(args.sku); }
if (args["only-single"]) where += " AND current_image_count <= 1";

// Track already-scraped pages in a dedicated marker row per SKU (acme_page origin,
// mirroring foa_page) so this script is resumable/idempotent like 02b.
const insMarker = db.prepare(`
  INSERT OR IGNORE INTO candidate_images (id, sku, origin, source_page, original_url, resolved_url, sku_token_in_url, kind, rights_class, status)
  VALUES (@id, @sku, 'acme_page', @page, @page, @page, 0, 'unknown', 'official_manufacturer', 'pending')
`);
const products = db.prepare(`SELECT sku, source_url FROM products WHERE ${where} ORDER BY sku`).all(...params);
db.exec("BEGIN");
for (const p of products) {
  insMarker.run({ id: sha1(`acme_page|${p.sku}`), sku: p.sku, page: p.source_url });
}
db.exec("COMMIT");

const rows = db
  .prepare(
    `SELECT id, sku, original_url FROM candidate_images WHERE origin='acme_page' AND status='pending'
       AND sku IN (${products.map(() => "?").join(",") || "''"}) ORDER BY sku LIMIT ?`,
  )
  .all(...products.map((p) => p.sku), Number.isFinite(LIMIT) ? LIMIT : -1);

console.log(`ACME pages to scrape: ${rows.length}  (Crawl-delay:10 honored, ~${(rows.length * 10 / 60).toFixed(0)} min)`);

const SKIP_FILE = /logo|placeholder|no[-_]?image|swatch|favicon/i;
// mage/gallery/gallery widget entries, in the exact server-templated key order.
const GALLERY_ENTRY_RE =
  /\{"thumb":"([^"]+)","img":"([^"]+)","full":"([^"]+)","caption":"([^"]*)","position":"(\d+)","isMain":(true|false),"type":"([^"]+)","videoUrl":(null|"[^"]*")\}/g;

/** .../media/catalog/product/cache/<32-hex>/a/b/file.jpg -> .../media/catalog/product/a/b/file.jpg */
function acmeOriginal(url) {
  const m = String(url || "").match(
    /^(https?:\/\/[^/]+\/media\/catalog\/product)\/cache\/[0-9a-f]{16,}\/(.+\.(?:jpe?g|png|webp))$/i,
  );
  return m ? `${m[1]}/${m[2]}` : url;
}

const pageUpd = db.prepare(`
  UPDATE candidate_images SET status=@status, reject_reason=@reject_reason,
    match_json=@match_json, attempts=attempts+1, last_error=@last_error, fetched_at=@fetched_at
  WHERE id=@id
`);
const insCand = db.prepare(`
  INSERT INTO candidate_images (id, sku, origin, source_page, original_url, resolved_url,
                                sku_token_in_url, kind, rights_class, reject_reason, status)
  VALUES (@id,@sku,'acme_page_gallery',@source_page,@original_url,@resolved_url,
          1,@kind,@rights_class,@reject_reason,'pending')
  ON CONFLICT(id) DO NOTHING
`);

let done = 0, pagesOk = 0, pagesBroken = 0, pagesErrored = 0, discovered = 0, keptSameSku = 0;
const t0 = Date.now();

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
  remaining_pages: db.prepare("SELECT COUNT(*) n FROM candidate_images WHERE origin='acme_page' AND status='pending'").get().n,
});
installShutdown(db, () => {
  try { flush(true); } catch {}
  try { finishRun(db, runId, { ...counts(), interrupted: true }); } catch {}
  try { releaseLock(); } catch {}
});

await pool(rows, CONCURRENCY, async (row) => {
  try {
    const r = await pacedPageFetch(row.original_url, { timeoutMs: 30000 });
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
      const entries = [...html.matchAll(GALLERY_ENTRY_RE)];
      const found = entries
        .filter((m) => m[7] === "image") // type
        .map((m) => acmeOriginal(m[3].replace(/\\\//g, "/"))) // "full" URL: un-escape JSON \/ , then de-cache
        .filter((u) => !SKIP_FILE.test(u));
      const uniq = [...new Set(found)];
      discovered += uniq.length;
      const kept = uniq.filter((u) => skuTokenInUrl(row.sku, u));
      keptSameSku += kept.length;
      for (const u of kept) {
        const host = classifyHost(u);
        newCands.push({
          id: sha1(`${row.sku}|${u}`),
          sku: row.sku,
          source_page: row.original_url,
          original_url: u,
          resolved_url: u,
          kind: acmeKind(u, row.sku),
          rights_class: host.rights_class,
          reject_reason: host.reason,
        });
      }
      page.status = "rejected";
      page.reject_reason = "page_scraped_not_image";
      page.match_json = JSON.stringify({ discovered: uniq.length, kept_same_sku: kept.length });
      pagesOk++;
    }

    buf.push({ page, newCands });
    done++;
    maybeFlush();
    if (done % 20 === 0) {
      const rate = (done / ((Date.now() - t0) / 1000)).toFixed(3);
      const etaMin = ((rows.length - done) / Math.max(rate, 0.001) / 60).toFixed(0);
      console.log(`  ${done}/${rows.length}  ok=${pagesOk} broken=${pagesBroken} err=${pagesErrored} newImgs=${keptSameSku}  ${rate}/s  eta~${etaMin}min`);
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
