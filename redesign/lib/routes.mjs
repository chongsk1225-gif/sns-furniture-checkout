// The single place that knows every URL of the redesigned site. serve.mjs answers requests
// from it on demand; build.mjs writes the same output to disk. Hidden products have no route.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REDESIGN_ROOT, SITE, catalogIndex, esc, listPages, readPage, renderPage, finalize, openingMarkup } from "./includes.mjs";
import "./markers.mjs";
import { collectionData, collectionsIndexData, ROOM_BY_SLUG } from "./collections.mjs";
import { catalogCardsData } from "./cards.mjs";
import { renderProductPage, visibleSkus, collectionsWithPages } from "./product-view.mjs";
import { renderCollectionPage, collectionSlugs } from "./collection-pages.mjs";
import { CUSTOM_ROOMS, CUSTOM_SLUGS, processHtml } from "./custom.mjs";
import { skuSlug, productPath, collectionPath, assertUnique } from "./slug.mjs";

/* ---------- owned imagery as <picture> (AVIF / WebP derivatives, original fallback) ---------- */
function ownedPicture(src, w, h, alt, lazy = true, sizes = "(max-width: 900px) 100vw, 50vw") {
  const stem = src.replace(/\.webp$/, "");
  const set = (ext) => `${stem}-480.${ext} 480w, ${stem}-800.${ext} 800w, ${stem}.${ext} ${w}w`;
  return `<picture><source type="image/avif" srcset="${set("avif")}" sizes="${sizes}"><source type="image/webp" srcset="${set("webp")}" sizes="${sizes}"><img src="${src}" width="${w}" height="${h}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ""} decoding="async"></picture>`;
}

/* ---------- custom furniture room pages ---------- */
function customPage(slug, commerce) {
  const c = CUSTOM_ROOMS[slug];
  if (!c) return null;
  const copy = { eyebrow: "Custom Furniture", h1: c.h1, lede: c.lede, primary: ["Request a Design Consultation", "#consultation"], secondary: ["How it works", "#process"] };
  const hero = c.opening
    ? openingMarkup(c.opening, copy)
    : `<section class="lx-chero lx-dark" aria-labelledby="open-h1"><div class="lx-chero__inner"><p class="lx-eyebrow">Custom Furniture</p><h1 id="open-h1">${esc(c.h1)}</h1><p class="lx-lede">${esc(c.lede)}</p><a class="lx-btn lx-btn--light" href="#consultation">Request a Design Consultation</a></div></section>`;
  const topics = c.topics.map(([t, p], i) => `<div class="lx-topic lx-reveal" style="--d:${i * 80}ms"><h3>${esc(t)}</h3><p>${esc(p)}</p></div>`).join("");
  const coll = (sku) => { const r = catalogIndex().find((x) => x.sku === sku); return r && r.collection && collectionsWithPages().has(r.collection) ? r.collection : null; };
  const figures = `<div class="lx-gallery2${c.figures.length === 1 ? " lx-gallery2--one" : ""}">${c.figures.map((f, i) => {
    const media = f.owned ? ownedPicture(f.src, f.w, f.h, f.alt, true, c.figures.length === 1 ? "(max-width: 1100px) 100vw, 1000px" : undefined) : `<img src="${esc(f.src)}" width="${f.w}" height="${f.h}" alt="${esc(f.alt)}" loading="lazy" decoding="async">`;
    const cn = f.sku ? coll(f.sku) : null;
    const note = f.sku ? `<span class="lx-gallery2__note">Inspiration imagery shows pieces from our stock collections.${cn ? ` <a class="lx-textlink" href="${collectionPath(cn)}">View the ${esc(cn)} collection</a>` : ""}</span>` : "";
    return `<figure class="lx-reveal" style="--d:${i * 120}ms">${media}<figcaption>${esc(f.cap)}${note}</figcaption></figure>`;
  }).join("")}</div>`;
  const related = c.related.map(([s, t]) => `<a class="lx-textlink" href="${s}.html">${esc(t)}</a>`).join("");
  const fill = { title: esc(c.title), description: esc(c.description), slug, h1: esc(c.h1), statement: esc(c.statement), topics, figures, process: processHtml(esc), related, hero, form: c.form, ogalt: esc(c.figures[0].alt), bodyclass: "lx-overlay-header" };
  const html = readFileSync(join(REDESIGN_ROOT, "templates", "custom-room.html"), "utf8");
  const out = html.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => fill[k] ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? "");
  return finalize(renderPage(out, 0, commerce));
}

/* ---------- lookups ---------- */
let _skuBySlug = null, _collBySlug = null;
const skuForSlug = (slug) => {
  if (!_skuBySlug) { const skus = visibleSkus(); assertUnique(skus, skuSlug, "product"); _skuBySlug = new Map(skus.map((s) => [skuSlug(s), s])); }
  return _skuBySlug.get(slug);
};
export const pageNames = () => [...new Set([...listPages(), ...CUSTOM_SLUGS.map((s) => s + ".html")])].sort();

/** HTML for a request path (no query string), or null. */
export function renderRoute(path, commerce) {
  let m;
  if ((m = path.match(/^\/product\/([a-z0-9-]+)\/?(?:index\.html)?$/))) { const sku = skuForSlug(m[1]); return sku ? renderProductPage(sku, commerce) : null; }
  if ((m = path.match(/^\/collection\/([a-z0-9-]+)\/?(?:index\.html)?$/))) return renderCollectionPage(m[1], commerce);
  const name = path === "/" ? "index.html" : path.slice(1);
  if (!/^[\w-]+\.html$/.test(name)) return null;
  const slug = name.replace(/\.html$/, "");
  if (CUSTOM_ROOMS[slug]) return customPage(slug, commerce);
  return readPage(name);
}

/** JSON for the derived data files, or null. (Built once per process: the data never changes while serving.) */
const dataCache = new Map();
export function renderData(path) {
  if (dataCache.has(path)) return dataCache.get(path);
  const out = buildData(path);
  if (out) dataCache.set(path, out);
  return out;
}
function buildData(path) {
  let m;
  if ((m = path.match(/^\/data\/collection-([\w-]+)\.json$/)) && ROOM_BY_SLUG[m[1]]) return JSON.stringify(collectionData(m[1]));
  if (path === "/data/collections-index.json") return JSON.stringify(collectionsIndexData());
  if (path === "/data/catalog-cards.json") return JSON.stringify(catalogCardsData());
  return null;
}

/** Every file the build writes: [relativePath, content]. */
export function* allOutputs(commerce) {
  for (const f of pageNames()) { const html = renderRoute("/" + f, commerce); if (html) yield [f, html]; }
  for (const sku of visibleSkus()) { const html = renderProductPage(sku, commerce); if (html) yield [`product/${skuSlug(sku)}/index.html`, html]; }
  for (const slug of collectionSlugs()) yield [`collection/${slug}/index.html`, renderCollectionPage(slug, commerce)];
  for (const slug of Object.keys(ROOM_BY_SLUG)) { const d = renderData(`/data/collection-${slug}.json`); if (d) yield [`data/collection-${slug}.json`, d]; }
  yield ["data/collections-index.json", renderData("/data/collections-index.json")];
  yield ["data/catalog-cards.json", renderData("/data/catalog-cards.json")];
}
export { productPath, collectionPath };
