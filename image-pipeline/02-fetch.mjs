// Phase 02 — resumable, rate-limited fetch of candidate images. Re-run to continue.
//   node 02-fetch.mjs --brand acme [--limit N] [--sku SKU] [--origin acme_feed] [--retry-errors]
// Processes candidate_images with status in ('pending') (+ 'error' with --retry-errors).
// FOA page scraping is handled by 02-fetch-foa-pages.mjs (Milestone 2), not here.
import { openDb, startRun, finishRun, installShutdown, integrityOk } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { imageMeta } from "./lib/imagemeta.mjs";
import { nowIso, parseArgs } from "./lib/util.mjs";

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION", e && e.stack ? e.stack : e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT", e && e.stack ? e.stack : e));

const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 6;
const db = openDb();
installShutdown(db);
if (!integrityOk(db)) { console.error("FATAL: pipeline.db failed integrity_check — rebuild with 01-seed"); process.exit(2); }
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

console.log(`to fetch: ${rows.length}  (concurrency ${CONCURRENCY})`);

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

await pool(rows, CONCURRENCY, async (row) => {
 try {
  const url = row.resolved_url || row.original_url;
  const r = await politeFetch(url, { timeoutMs: 30000 });
  const rec = {
    id: row.id, resolved_url: r.finalUrl || url,
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

  upd.run(rec);
  done++;
  if (done % 200 === 0) {
    const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
    console.log(`  ${done}/${rows.length}  ok=${ok} broken=${broken} notimg=${notimg} err=${errored}  ${rate}/s`);
  }
 } catch (err) {
  console.error("WORKER_ERR", row.id, String(err && err.message ? err.message : err));
  try { db.prepare("UPDATE candidate_images SET status='error', last_error=?, attempts=attempts+1 WHERE id=?").run(String(err).slice(0, 300), row.id); } catch {}
 }
});

const counts = { attempted: done, fetched_ok: ok, broken_url: broken, not_image: notimg, errors: errored,
  remaining_pending: db.prepare("SELECT COUNT(*) n FROM candidate_images WHERE status='pending' AND origin!='foa_page'").get().n };
finishRun(db, runId, counts);
console.log(JSON.stringify(counts, null, 2));
db.close();
