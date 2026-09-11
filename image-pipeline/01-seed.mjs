// Phase 01 — seed products + candidate_images from the catalog and supplied feeds. No network.
//   node 01-seed.mjs [--acme-feed <path>]
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, startRun, finishRun } from "./lib/db.mjs";
import { parseAcmeFeed } from "./lib/acmeFeed.mjs";
import { sha1, brandKey, nowIso, parseArgs } from "./lib/util.mjs";
import { classifyHost, skuTokenInUrl, acmeKind, foaVariants, foaModelToken } from "./lib/sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA = join(HERE, "..", "public", "data");
const args = parseArgs(process.argv.slice(2));
const ACME_FEED =
  args["acme-feed"] ||
  "C:/Users/chong/Downloads/acme_product_image_links_2026_09_08.csv";

const db = openDb();
const runId = startRun(db, "01-seed", args);

// ---- load catalog ---------------------------------------------------------
const index = JSON.parse(readFileSync(join(PUBLIC_DATA, "catalog-index.json"), "utf8"));
const details = [];
for (const f of readdirSync(join(PUBLIC_DATA, "details"))) {
  if (f.endsWith(".json")) details.push(...JSON.parse(readFileSync(join(PUBLIC_DATA, "details", f), "utf8")));
}
const detBySku = new Map(details.map((d) => [String(d.sku), d]));
console.log(`catalog-index: ${index.length}  details: ${details.length}`);

const upsertProduct = db.prepare(`
  INSERT INTO products (sku, brand, brand_key, name, type, category, collection, finish, dimensions,
                        source_url, current_image, current_gallery_json, current_image_count)
  VALUES (@sku,@brand,@brand_key,@name,@type,@category,@collection,@finish,@dimensions,
          @source_url,@current_image,@current_gallery_json,@current_image_count)
  ON CONFLICT(sku) DO UPDATE SET
    brand=@brand, brand_key=@brand_key, name=@name, type=@type, category=@category,
    collection=@collection, finish=@finish, dimensions=@dimensions, source_url=@source_url,
    current_image=@current_image, current_gallery_json=@current_gallery_json,
    current_image_count=@current_image_count
`);

const insCand = db.prepare(`
  INSERT INTO candidate_images (id, sku, origin, source_page, original_url, resolved_url,
                                sku_token_in_url, kind, rights_class, reject_reason, status)
  VALUES (@id,@sku,@origin,@source_page,@original_url,@resolved_url,
          @sku_token_in_url,@kind,@rights_class,@reject_reason,@status)
  ON CONFLICT(id) DO UPDATE SET
    resolved_url=@resolved_url, sku_token_in_url=@sku_token_in_url, kind=@kind,
    rights_class=CASE WHEN candidate_images.status IN ('fetched','verified','rejected')
                      THEN candidate_images.rights_class ELSE @rights_class END,
    reject_reason=CASE WHEN candidate_images.status IN ('fetched','verified','rejected')
                       THEN candidate_images.reject_reason ELSE @reject_reason END
`);

const acmeFeed = existsSync(ACME_FEED) ? parseAcmeFeed(ACME_FEED) : new Map();
console.log(`ACME feed: ${acmeFeed.size} SKUs, ${[...acmeFeed.values()].reduce((n, a) => n + a.length, 0)} URLs  (${ACME_FEED})`);

let nP = 0, nCand = 0, nCandDedup = 0;
const seedProduct = (rec) => {
  const det = detBySku.get(String(rec.sku)) || {};
  const gal = Array.isArray(det.gallery) ? det.gallery.filter(Boolean) : [];
  const bk = brandKey(rec.brand || det.brand);
  upsertProduct.run({
    sku: String(rec.sku),
    brand: rec.brand || det.brand || "",
    brand_key: bk,
    name: rec.name || det.name || "",
    type: rec.type || det.type || "",
    category: rec.category || det.category || "",
    collection: rec.collection || det.collection || "",
    finish: rec.finish || det.finish || "",
    dimensions: det.dimensions || "",
    source_url: det.sourceUrl || det.source_url || "",
    current_image: rec.image || det.image || "",
    current_gallery_json: JSON.stringify([...new Set(gal)]),
    current_image_count: new Set(gal).size || (rec.image || det.image ? 1 : 0),
  });
  nP++;
  return { det, bk };
};

const addCand = (row) => {
  const id = sha1(`${row.sku}|${row.original_url}`);
  const info = insCand.run({ reject_reason: null, status: "pending", ...row, id });
  nCand++;
  if (info.changes === 0) nCandDedup++;
};

db.exec("BEGIN");
for (const rec of index) {
  const { det, bk } = seedProduct(rec);

  if (bk === "acme") {
    const urls = acmeFeed.get(String(rec.sku).toUpperCase()) || [];
    for (const url of urls) {
      const host = classifyHost(url);
      addCand({
        sku: String(rec.sku),
        origin: "acme_feed",
        source_page: "acme_product_image_links_2026_09_08.csv",
        original_url: url,
        resolved_url: url,
        sku_token_in_url: skuTokenInUrl(rec.sku, url) ? 1 : 0,
        kind: acmeKind(url, rec.sku),
        rights_class: host.rights_class,
        reject_reason: host.reason,
      });
    }
    // fall back to whatever the current record already has, if the feed missed it
    if (urls.length === 0) {
      for (const url of [rec.image, ...(det.gallery || [])].filter(Boolean)) {
        const host = classifyHost(url);
        addCand({
          sku: String(rec.sku), origin: "acme_page", source_page: det.sourceUrl || "",
          original_url: url, resolved_url: url,
          sku_token_in_url: skuTokenInUrl(rec.sku, url) ? 1 : 0,
          kind: acmeKind(url, rec.sku),
          rights_class: host.rights_class, reject_reason: host.reason,
        });
      }
    }
  }

  if (bk === "foa") {
    const seen = new Set();
    for (const url of [rec.image, ...(det.gallery || [])].filter(Boolean)) {
      const v = foaVariants(url);
      if (seen.has(v.full)) continue;
      seen.add(v.full);
      const host = classifyHost(v.full);
      const modelTok = foaModelToken(v.full);
      addCand({
        sku: String(rec.sku),
        origin: "foa_cdn_upgrade",
        source_page: det.sourceUrl || det.source_url || "",
        original_url: url,
        resolved_url: v.full,
        sku_token_in_url: skuTokenInUrl(rec.sku, v.full) ? 1 : 0,
        kind: "primary",
        rights_class: host.rights_class,
        reject_reason: host.reason,
      });
    }
    // page scrape candidate (Phase 02 resolves the real gallery)
    const page = det.sourceUrl || det.source_url || "";
    if (page) {
      addCand({
        sku: String(rec.sku), origin: "foa_page", source_page: page,
        original_url: page, resolved_url: page,
        sku_token_in_url: 0, kind: "unknown",
        rights_class: "official_manufacturer", reject_reason: null,
      });
    }
  }
}
db.exec("COMMIT");

const counts = {
  products: nP,
  candidates_written: nCand,
  candidates_existing: nCandDedup,
  by_origin: Object.fromEntries(
    db.prepare("SELECT origin, COUNT(*) n FROM candidate_images GROUP BY origin").all().map((r) => [r.origin, r.n]),
  ),
  products_by_brand: Object.fromEntries(
    db.prepare("SELECT brand_key, COUNT(*) n FROM products GROUP BY brand_key").all().map((r) => [r.brand_key, r.n]),
  ),
};
finishRun(db, runId, counts);
console.log(JSON.stringify(counts, null, 2));
db.close();
