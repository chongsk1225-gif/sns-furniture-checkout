// Source/URL helpers: host → rights class, SKU-token detection, ACME image "kind",
// FOA thumbnail → full-resolution transform.
import { hostOf, normSku, skuVariants } from "./util.mjs";

const OFFICIAL_HOSTS = new Set([
  "www.acmecorp.com",
  "acmecorp.com",
  "cdn.foagroup.com",
  "www.foagroup.com",
  "foagroup.com",
  "cdn.furnitureofamerica.com",
]);

const MARKETPLACE_HOSTS = [
  "amazon.", "ebay.", "facebook.", "fbcdn.", "marketplace.", "craigslist.", "walmart.",
  "wayfair", "overstock", "aliexpress",
];

/** rights class from the image host alone (rule 1 of the 10-point check). */
export function classifyHost(url) {
  const h = hostOf(url);
  if (!h) return { rights_class: "rejected", reason: "bad_url" };
  if (MARKETPLACE_HOSTS.some((m) => h.includes(m))) {
    return { rights_class: "rejected", reason: "marketplace_host" };
  }
  if (OFFICIAL_HOSTS.has(h)) return { rights_class: "official_manufacturer", reason: null };
  // any other retailer host: usable only to *discover* a manufacturer URL, never auto-published
  return { rights_class: "retailer_owned_permission_required", reason: "non_manufacturer_host" };
}

/** Does the SKU (or a documented harmless variant) appear in the URL path/filename? */
export function skuTokenInUrl(sku, url) {
  const path = decodeURIComponent(String(url || "")).toLowerCase();
  const file = path.split("/").pop() || "";
  const norm = (s) => s.replace(/[\s._/-]+/g, "");
  const nf = norm(file);
  for (const v of skuVariants(sku)) {
    const nv = norm(v).toLowerCase();
    if (nv.length >= 4 && (nf.includes(nv) || norm(path).includes(nv))) return true;
  }
  return false;
}

/**
 * ACME feed filenames encode the image kind by suffix.
 *   04166.jpg / 04166_5.jpg      → product shots (primary / alt)
 *   60737_60742_60743.jpg        → combo (multi-SKU set photo)
 *   *_life.jpg                    → manufacturer lifestyle scene
 *   *_dim.jpg *_draw.jpg *_feat.jpg *_spec.jpg *_cc.jpg → diagram / callout
 */
export function acmeKind(url, sku) {
  const file = (url.split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/i, "");
  if (/_life$/.test(file)) return "lifestyle";
  if (/_(dim|draw|feat|spec|cc|detail|open|measure)$/.test(file)) return "diagram";
  const base = normSku(sku).toLowerCase();
  const parts = file.split(/[_-]/).filter(Boolean);
  const skuLike = parts.filter((p) => /^\d{3,}$/.test(p) || /^[a-z]{1,3}\d{3,}/.test(p));
  if (skuLike.length >= 2 && !file.startsWith(base)) return "combo";
  if (/_\d{1,2}$/.test(file)) return "alt";
  return "primary";
}

const KIND_RANK = { primary: 0, alt: 1, lifestyle: 2, combo: 3, diagram: 4, unknown: 5 };
export const kindRank = (k) => (k in KIND_RANK ? KIND_RANK[k] : 5);

/**
 * FOA CDN thumbnail → candidate URLs, largest first.
 * Existing form: .../product/cache/1/small_image/223x223/<hash>/<a>/<b>/<file>.jpg
 * Full-res     : .../product/<a>/<b>/<file>.jpg     (verified working)
 * Card (retina): .../product/cache/1/small_image/465x465/<hash>/<a>/<b>/<file>.jpg
 */
export function foaVariants(url) {
  const m = String(url || "").match(
    /^(https?:\/\/[^/]+\/media\/catalog\/product)\/cache\/\d+\/[a-z_]+\/[0-9a-z]+x?[0-9a-z]*\/([0-9a-f]{16,})\/(.+\.(?:jpe?g|png))$/i,
  );
  if (!m) {
    // maybe already a base URL
    const b = String(url || "").match(/^(https?:\/\/[^/]+\/media\/catalog\/product)\/(.+\.(?:jpe?g|png))$/i);
    if (b) return { full: url, card: url, tail: b[2] };
    return { full: url, card: url, tail: null };
  }
  const [, base, hash, tail] = m;
  return {
    full: `${base}/${tail}`,
    card: `${base}/cache/1/small_image/465x465/${hash}/${tail}`,
    tail,
    hash,
  };
}

export function foaModelToken(url) {
  // .../a/m/am-sl109-t-1-z.jpg  ->  am-sl109-t   (strip trailing -N / -z / -1-z)
  const file = (String(url).split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/i, "");
  return file.replace(/-\d+(-z)?$/i, "").replace(/-z$/i, "");
}
