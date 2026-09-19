// Fetches FOA product pages for the FOA SKUs currently missing a
// description, extracting structured FACTS only (style/finish/material,
// feature tags, per-piece dimensions, and FOA's own short blurb kept purely
// as a reference) — never the prose itself for republishing. Authorized use
// per user direction (FOA has granted permission for description content;
// this is not the earlier declined image-gallery scrape). Persists to
// pipeline.db (foa_page_facts) so 15-compose-foa-descriptions.mjs can turn
// the facts into ORIGINAL written text. No writes to proposed/ here.
//
//   node 14-fetch-foa-descriptions.mjs [--limit N] [--concurrency N] [--retry-errors]
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun, installShutdown, integrityOk, acquireLock, withWriteRetry } from "./lib/db.mjs";
import { politeFetch, pool } from "./lib/ratelimit.mjs";
import { parseArgs } from "./lib/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA = join(HERE, "..", "public", "data");
const args = parseArgs(process.argv.slice(2));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(4, args.concurrency ? Number(args.concurrency) : 2));

const releaseLock = acquireLock({ force: !!args.force, label: `14-fetch-foa-descriptions pid${process.pid}` });
const db = openDb();
if (!integrityOk(db)) {
  console.error("FATAL: pipeline.db failed integrity_check — not touching anything.");
  process.exit(2);
}
const runId = startRun(db, "14-fetch-foa-descriptions", args);

// ---- build the target list: FOA products with no description yet --------
const details = [];
for (const f of readdirSync(join(PUBLIC_DATA, "details"))) {
  if (f.endsWith(".json")) details.push(...JSON.parse(readFileSync(join(PUBLIC_DATA, "details", f), "utf8")));
}
const missing = details.filter((p) => p.brand === "Furniture of America" && !(p.description && p.description.trim()) && p.sourceUrl);

const already = new Set(
  db.prepare("SELECT sku FROM foa_page_facts WHERE fetch_status='ok' OR fetch_status='no_facts_found'").all().map((r) => r.sku),
);
let targets = missing.filter((p) => !already.has(p.sku));
if (args["retry-errors"]) {
  const errored = new Set(db.prepare("SELECT sku FROM foa_page_facts WHERE fetch_status='error'").all().map((r) => r.sku));
  targets = missing.filter((p) => !already.has(p.sku) || errored.has(p.sku));
}
if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);
console.log(`FOA products missing a description: ${missing.length}. To fetch this run: ${targets.length} (concurrency ${CONCURRENCY}, ~1 req/s to www.foagroup.com).`);

// ---- HTML extraction (facts only) -----------------------------------------
function extractFacts(html) {
  const out = { std: null, details: {}, features: [], dims: [] };

  const stdMatch = html.match(/<div class="std">\s*(?:<h2>[^<]*<\/h2>)?\s*([\s\S]*?)<\/div>/i);
  if (stdMatch) {
    const text = stdMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out.std = text;
  }

  const extraMatch = html.match(/<div class="extra-details[^"]*">[\s\S]*?<ul class="simple">([\s\S]*?)<\/ul>/i);
  if (extraMatch) {
    const items = [...extraMatch[1].matchAll(/<li[^>]*>([^<]*)<\/li>/gi)].map((m) => m[1].trim()).filter(Boolean);
    out.features = [...new Set(items)];
  }

  const dimsFirstMatch = html.match(/<div class="product-dimensions-first">([\s\S]*?)<\/ul>/i);
  if (dimsFirstMatch) {
    const pairs = [...dimsFirstMatch[1].matchAll(/<li>\s*<div>([^<]*)<\/div>\s*<div class="detail">\s*([^<]*)<\/div>\s*<\/li>/gi)];
    for (const [, label, value] of pairs) {
      const l = label.trim(), v = value.replace(/\s+/g, " ").trim();
      if (l && v) out.details[l] = v;
    }
  }

  const dimsMatch = html.match(/<div class="product-dimensions">\s*<h1>Product Dimension<\/h1>\s*<ul>([\s\S]*?)<\/ul>/i);
  if (dimsMatch) {
    const pieces = [...dimsMatch[1].matchAll(/<li>\s*<b>([^<]*)<\/b>\s*([^<]*)<\/li>/gi)];
    for (const [, piece, dims] of pieces) {
      const p = piece.trim(), d = dims.replace(/\s+/g, " ").trim();
      if (d) out.dims.push({ piece: p || null, dims: d });
    }
  }

  return out;
}

const upd = db.prepare(`
  INSERT INTO foa_page_facts (sku, source_url, http_status, fetch_status, last_error, std_text, details_json, features_json, dims_json, fetched_at, attempts)
  VALUES (@sku, @source_url, @http_status, @fetch_status, @last_error, @std_text, @details_json, @features_json, @dims_json, @fetched_at, 1)
  ON CONFLICT(sku) DO UPDATE SET source_url=@source_url, http_status=@http_status, fetch_status=@fetch_status,
    last_error=@last_error, std_text=@std_text, details_json=@details_json, features_json=@features_json,
    dims_json=@dims_json, fetched_at=@fetched_at, attempts=attempts+1
`);

let done = 0, ok = 0, noFacts = 0, errored = 0;
const results = [];
const t0 = Date.now();

await pool(targets, CONCURRENCY, async (p) => {
  const rec = { sku: p.sku, source_url: p.sourceUrl, http_status: null, fetch_status: "error",
    last_error: null, std_text: null, details_json: "{}", features_json: "[]", dims_json: "[]", fetched_at: new Date().toISOString() };
  try {
    const r = await politeFetch(p.sourceUrl, { timeoutMs: 30000 });
    rec.http_status = r.status || null;
    if (!r.ok || !r.buffer) {
      rec.fetch_status = "error"; rec.last_error = r.error || `status_${r.status}`; errored++;
    } else {
      const html = r.buffer.toString("utf8");
      const facts = extractFacts(html);
      rec.std_text = facts.std;
      rec.details_json = JSON.stringify(facts.details);
      rec.features_json = JSON.stringify(facts.features);
      rec.dims_json = JSON.stringify(facts.dims);
      const hasAnything = facts.std || Object.keys(facts.details).length || facts.features.length || facts.dims.length;
      rec.fetch_status = hasAnything ? "ok" : "no_facts_found";
      if (hasAnything) ok++; else noFacts++;
    }
  } catch (e) {
    rec.fetch_status = "error"; rec.last_error = String(e && e.message || e).slice(0, 300); errored++;
  }
  results.push(rec);
  done++;
  if (done % 50 === 0) {
    const rate = (done / ((Date.now() - t0) / 1000)).toFixed(2);
    console.log(`  ${done}/${targets.length}  ok=${ok} noFacts=${noFacts} err=${errored}  ${rate}/s`);
  }
});

withWriteRetry(() => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of results) upd.run(r);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
});

const counts = { attempted: done, ok, no_facts_found: noFacts, errors: errored, remaining: missing.length - already.size - ok - noFacts };
finishRun(db, runId, counts);
console.log(JSON.stringify(counts, null, 2));
try { releaseLock(); } catch {}
db.close();
