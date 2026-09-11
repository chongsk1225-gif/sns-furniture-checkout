// Phase 02 — resumable, rate-limited fetch of candidate images. Re-run to continue.
//   node 02-fetch.mjs --brand acme [--limit N] [--sku SKU] [--origin acme_feed]
//                     [--concurrency N] [--retry-errors] [--force]
// Processes candidate_images with status 'pending' (+ 'error' with --retry-errors).
// FOA product-page scraping is a separate script (Milestone 2), not here.
//
// Concurrency model (post-corruption hardening):
//   * a single OS lock file (.pipeline.lock) => only ONE mutating phase at a time
//   * bounded network concurrency (default 6) via pool()
//   * ONE serialized writer: workers append results to an in-memory buffer;
//     flush() drains it inside a single BEGIN/COMMIT every FLUSH_EVERY rows or
//     FLUSH_MS ms, with SQLITE_BUSY retry. No worker ever writes directly.
//   * clean shutdown flushes the buffer and finalizes the run row.
import { openDb, startRun, finishRun, installShutdown, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { imageMeta } from "./lib/imagemeta.mjs";
import { nowIso, parseArgs } from "./lib/util.mjs";
import { foaVariants } from "./lib/sources.mjs";

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION", e && e.stack ? e.stack : e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT", e && e.stack ? e.stack : e));

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(12, args.concurrency ? Number(args.concurrency) : 6));
const FLUSH_EVERY = 100;   // rows
const FLUSH_MS = 4000;     // ms

const releaseLock = acquireLock({ force: !!args.force, label: `02-fetch ${args.brand || ""} pid${process.pid}` });

const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — rebuild with 01-seed + salvage before fetching.");
  process.exit(2);
}
const runId = startRun(db, "02-fetch", args);

let where = "status = 'pending'";
if (args["retry-errors"]) where = "status IN ('pending','error')";
const params = [];
if (args.brand) { where += " AND sku IN (SELECT sku FROM products WHERE brand_key = ?)"; params.push(args.brand); }
if (args.sku) { where += " AND sku = ?"; params.push(args.sku); }
if (args.origin) { where += " AND origin = ?"; params.push(args.origin); }
else where += " AND origin != 'foa_page'"; // page scrape is a separate script

const rows = db
  .prepare(`SELECT id, sku, origin, original_url, resolved_url, attempts FROM candidate_images WHERE ${where} ORDER BY sku LIMIT ?`)
  .all(...params, Number.isFinite(LIMIT) ? LIMIT : -1);

console.log(`to fetch: ${rows.length}  (net concurrency ${CONCURRENCY}, flush ${FLUSH_EVERY}/${FLUSH_MS}ms)`);

const upd = db.prepare(`
  UPDATE candidate_images SET
    resolved_url=@resolved_url, http_status=@http_status, content_type=@content_type, bytes=@bytes,
    width=@width, height=@height, sha256=@sha256, phash=@phash,
    status=@status, reject_reason=COALESCE(@reject_reason, reject_reason),
    attempts=attempts+1, last_error=@last_error, fetched_at=@fetched_at
  WHERE id=@id
`);

let done = 0, ok = 0, broken = 0, notimg = 0, errored = 0;
const t0 = Date.now();

// ---- serialized single writer -------------------------------------------
let buf = [];
let lastFlush = Date.now();
let flushing = false;

function flush(finalize = false) {
  if (flushing) return;           // reentrancy guard (single-threaded, but be safe)
  if (buf.length === 0) return;
  flushing = true;
  const batch = buf;
  buf = [];
  try {
    withWriteRetry(() => {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const rec of batch) upd.run(rec);
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
    });
  } catch (e) {
    // put the batch back so a later flush / shutdown retries it
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
  attempted: done, fetched_ok: ok, broken_url: broken, not_image: notimg, errors: errored,
  remaining_pending: db.prepare(
    "SELECT COUNT(*) n FROM candidate_images WHERE status='pending' AND origin!='foa_page'",
  ).get().n,
});

installShutdown(db, () => {
  try { flush(true); } catch {}
  try { finishRun(db, runId, { ...counts(), interrupted: true }); } catch {}
  try { releaseLock(); } catch {}
});

await pool(rows, CONCURRENCY, async (row) => {
  try {
    const url = row.resolved_url || row.original_url;
    let r = await politeFetch(url, { timeoutMs: 30000 });
    // Some FOA CDN "original" (un-cached) paths permanently 403 even though the
    // manufacturer's own cache-transformed image at the same hash exists and
    // works fine — fall back to the 465x465 cache render (still clears the
    // 400px MIN_SIDE floor) rather than losing the image entirely.
    let usedUrl = url;
    if (r.status === 403 && row.origin === "foa_cdn_upgrade") {
      const card = foaVariants(row.original_url).card;
      if (card && card !== url) {
        const r2 = await politeFetch(card, { timeoutMs: 30000 });
        if (r2.ok && r2.buffer) { r = r2; usedUrl = card; }
      }
    }
    const rec = {
      id: row.id, resolved_url: r.finalUrl || usedUrl,
      http_status: r.status || null, content_type: null, bytes: null,
      width: null, height: null, sha256: null, phash: null,
      status: "error", reject_reason: null, last_error: r.error || null, fetched_at: nowIso(),
    };

    if (r.error === "not_found" || r.status === 404 || r.status === 410) {
      rec.status = "rejected"; rec.reject_reason = "broken_url"; broken++;
    } else if (!r.ok || !r.buffer) {
      rec.status = "error"; errored++;
    } else {
      rec.content_type = r.contentType || null;
      rec.bytes = r.buffer.length;
      const isImg = /^image\//i.test(r.contentType || "") || /\.(jpe?g|png|webp)(\?|$)/i.test(url);
      if (!isImg && /text\/html/i.test(r.contentType || "")) {
        rec.status = "rejected"; rec.reject_reason = "not_an_image"; notimg++;
      } else {
        try {
          const m = await imageMeta(r.buffer);
          rec.width = m.width; rec.height = m.height; rec.sha256 = m.sha256; rec.phash = m.phash;
          if (!m.width || !m.height) {
            rec.status = "rejected"; rec.reject_reason = "undecodable"; notimg++;
          } else {
            rec.status = "fetched"; ok++;
          }
          if (m.decodeError) rec.last_error = m.decodeError;
        } catch (e) {
          rec.status = "error"; rec.last_error = "meta:" + (e.message || e); errored++;
        }
      }
    }

    buf.push(rec);
    done++;
    maybeFlush();
    if (done % 200 === 0) {
      const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log(`  ${done}/${rows.length}  ok=${ok} broken=${broken} notimg=${notimg} err=${errored}  ${rate}/s  buf=${buf.length}`);
    }
  } catch (err) {
    console.error("WORKER_ERR", row.id, String(err && err.message ? err.message : err));
    buf.push({
      id: row.id, resolved_url: row.resolved_url || row.original_url,
      http_status: null, content_type: null, bytes: null, width: null, height: null,
      sha256: null, phash: null, status: "error", reject_reason: null,
      last_error: String(err).slice(0, 300), fetched_at: nowIso(),
    });
    done++;
    errored++;
    maybeFlush();
  }
});

// drain anything left, with a couple of forced retries
for (let i = 0; i < 5 && buf.length; i++) {
  try { flush(true); } catch { await new Promise((r) => setTimeout(r, 500)); }
}

const final = counts();
finishRun(db, runId, final);
console.log(JSON.stringify(final, null, 2));
try { releaseLock(); } catch {}
db.close();
