// Checkpoint store — node:sqlite (zero external deps). Resumable across kills.
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = join(ROOT, "pipeline.db");

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

/** Verify the DB isn't corrupt. Returns true if OK. */
export function integrityOk(db) {
  try {
    const r = db.prepare("PRAGMA integrity_check").get();
    return r && (r.integrity_check === "ok" || Object.values(r)[0] === "ok");
  } catch {
    return false;
  }
}

/** Register clean shutdown so an interrupted run leaves a consistent file. */
export function installShutdown(db) {
  const close = () => {
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
  `);
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
