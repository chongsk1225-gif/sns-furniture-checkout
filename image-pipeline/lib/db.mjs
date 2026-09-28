// Checkpoint store — node:sqlite (zero external deps). Resumable across kills.
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, openSync, closeSync, writeSync, readFileSync, unlinkSync } from "node:fs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Override for read-only work against a point-in-time copy (e.g. a dataset
// rebuild) while another phase is actively writing pipeline.db — avoids lock
// contention with a live writer instead of trying to out-wait it.
export const DB_PATH = process.env.PIPELINE_DB_PATH || join(ROOT, "pipeline.db");
export const LOCK_PATH = process.env.PIPELINE_DB_PATH
  ? `${process.env.PIPELINE_DB_PATH}.lock`
  : join(ROOT, ".pipeline.lock");

let _openHandles = [];

export function openDb() {
  const fresh = !existsSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  // Rollback journal (not WAL) + NORMAL sync: robust against process SIGKILL,
  // and no multi-connection WAL races. Writers batch in explicit transactions.
  db.exec("PRAGMA journal_mode = TRUNCATE");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 20000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  _openHandles.push(db);
  return db;
}

/** True if a process with this pid is currently alive. */
function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; } // exists but not signallable
}

/**
 * Single-writer guard. Only ONE mutating pipeline phase (02-fetch / 03-verify)
 * may touch pipeline.db at a time — concurrent writers are what corrupted the
 * B-tree previously. Returns a release() fn; auto-releases on process exit.
 * Pass { force:true } to steal the lock (also happens automatically if the
 * recorded pid is dead => stale lock).
 */
export function acquireLock({ force = false, label = "" } = {}) {
  if (force) { try { unlinkSync(LOCK_PATH); } catch {} }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, "wx"); // fails if it already exists
      writeSync(fd, JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() }));
      closeSync(fd);
      const release = () => { try { unlinkSync(LOCK_PATH); } catch {} };
      process.once("exit", release);
      return release;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let info = {};
      try { info = JSON.parse(readFileSync(LOCK_PATH, "utf8")); } catch {}
      if (!pidAlive(Number(info.pid))) {
        // stale lock from a dead process — reclaim it
        try { unlinkSync(LOCK_PATH); } catch {}
        continue;
      }
      throw new Error(
        `pipeline.db is locked by another running phase (pid ${info.pid}, ${info.label || "?"}, since ${info.at || "?"}).\n` +
        `Wait for it to finish, or re-run with --force if you are certain it is dead.`,
      );
    }
  }
  throw new Error("could not acquire pipeline lock");
}

/** Synchronous sleep (keeps the single-writer model simple inside retry loops). */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* SAB unavailable */ }
}

/** Run a write fn, retrying transient SQLITE_BUSY / "database is locked". */
export function withWriteRetry(fn, { tries = 6, baseMs = 150 } = {}) {
  for (let i = 0; ; i++) {
    try { return fn(); }
    catch (e) {
      const msg = String((e && e.message) || e);
      if (i < tries && /SQLITE_BUSY|database is locked|database table is locked/i.test(msg)) {
        sleepSync(baseMs * 2 ** i);
        continue;
      }
      throw e;
    }
  }
}

/** Verify the DB isn't corrupt. Returns true if OK. */
export function integrityOk(db) {
  try {
    const r = db.prepare("PRAGMA integrity_check").get();
    return r && (r.integrity_check === "ok" || Object.values(r)[0] === "ok");
  } catch {
    return false;
  }
}

/**
 * Register clean shutdown so an interrupted run leaves a consistent file.
 * `onBeforeClose` (optional) runs first — use it to flush a pending write
 * batch and finalize the run row before the handle closes.
 */
export function installShutdown(db, onBeforeClose) {
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    try { if (typeof onBeforeClose === "function") onBeforeClose(); } catch (e) { console.error("shutdown flush failed:", e && e.message); }
    try { db.close(); } catch {}
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    try { process.once(sig, () => { close(); process.exit(130); }); } catch {}
  }
  process.once("exit", close);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      sku                   TEXT PRIMARY KEY,
      brand                 TEXT,
      brand_key             TEXT,
      name                  TEXT,
      type                  TEXT,
      category              TEXT,
      collection            TEXT,
      finish                TEXT,
      dimensions            TEXT,
      source_url            TEXT,
      current_image         TEXT,
      current_gallery_json  TEXT,
      current_image_count   INTEGER,
      state                 TEXT DEFAULT 'pending',
      resolution            TEXT,
      final_image           TEXT,
      final_card_image      TEXT,
      final_gallery_json    TEXT,
      notes                 TEXT
    );

    CREATE TABLE IF NOT EXISTS candidate_images (
      id                TEXT PRIMARY KEY,
      sku               TEXT NOT NULL,
      origin            TEXT NOT NULL,
      source_page       TEXT,
      original_url      TEXT NOT NULL,
      resolved_url      TEXT,
      http_status       INTEGER,
      content_type      TEXT,
      bytes             INTEGER,
      width             INTEGER,
      height            INTEGER,
      sha256            TEXT,
      phash             TEXT,
      sku_token_in_url  INTEGER,
      onpage_sku        TEXT,
      kind              TEXT,
      match_json        TEXT,
      dup_of            TEXT,
      rights_class      TEXT,
      reject_reason     TEXT,
      status            TEXT DEFAULT 'pending',
      gallery_rank      INTEGER,
      attempts          INTEGER DEFAULT 0,
      last_error        TEXT,
      fetched_at        TEXT,
      verified_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ci_sku    ON candidate_images (sku);
    CREATE INDEX IF NOT EXISTS idx_ci_status ON candidate_images (status);
    CREATE INDEX IF NOT EXISTS idx_ci_origin ON candidate_images (origin);
    CREATE INDEX IF NOT EXISTS idx_ci_sha    ON candidate_images (sha256);

    CREATE TABLE IF NOT EXISTS runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      phase       TEXT, args TEXT, started_at TEXT, finished_at TEXT, counts_json TEXT
    );

    -- FOA product-page facts for description writing (authorized use of FOA
    -- content, per user direction — fetched to extract FACTS, source blurb
    -- kept only as a reference, never republished verbatim).
    CREATE TABLE IF NOT EXISTS foa_page_facts (
      sku          TEXT PRIMARY KEY,
      source_url   TEXT,
      http_status  INTEGER,
      fetch_status TEXT,      -- ok | error | no_facts_found
      last_error   TEXT,
      std_text     TEXT,      -- FOA's own short-description blurb (reference only)
      details_json TEXT,      -- {Style, "Color/Finish", Material, "Frame Finish", ...}
      features_json TEXT,     -- flat tag list from .extra-details
      dims_json    TEXT,      -- [{piece, dims}] from "Product Dimension"
      fetched_at   TEXT,
      attempts     INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_foa_facts_status ON foa_page_facts (fetch_status);
  `);
  // Added later than the tables above — safe/idempotent column adds so an
  // existing pipeline.db from before this feature picks them up on next open.
  // `hidden` is independent of `resolution`/SKU verification: it means "don't
  // show or sell this on the live site", not "the image failed a check".
  for (const stmt of [
    "ALTER TABLE products ADD COLUMN hidden INTEGER DEFAULT 0",
    "ALTER TABLE products ADD COLUMN hidden_reason TEXT",
  ]) {
    try { db.exec(stmt); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
}

export function startRun(db, phase, args) {
  const info = db
    .prepare("INSERT INTO runs (phase, args, started_at) VALUES (?, ?, ?)")
    .run(phase, JSON.stringify(args || {}), new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function finishRun(db, id, counts) {
  db.prepare("UPDATE runs SET finished_at = ?, counts_json = ? WHERE id = ?").run(
    new Date().toISOString(),
    JSON.stringify(counts || {}),
    id,
  );
}
