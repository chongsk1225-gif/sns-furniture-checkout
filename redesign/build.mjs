// Flatten the redesign overlay into a plain static folder, ready to be copied
// over a copy of public/ when (and only when) the redesign is approved.
//   node redesign/build.mjs [outDir]          default: redesign/dist
//   LUXE_COMMERCE=0 node redesign/build.mjs   catalog-only variant (no cart link)
//
// Writes ONLY inside outDir. Never touches public/, never deploys. Output:
//   <page>.html                   every redesigned page (home, custom-design, stock-furniture,
//                                 living/dining/bedroom/mattresses/accent, collections, catalog,
//                                 product, cart, checkout, contact, policies, order status)
//   luxe/                         design system CSS/JS/fonts + hero-media.json
//   data/luxe-*.json              overlay data (media manifest, custom options)
//   data/collection-<room>.json   slim per-room datasets derived from public/data
//   data/collections-index.json   slim collections index derived from public/data
//   sitemap.xml                   the existing sitemap plus the new pages (no URL is removed)
import { mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REDESIGN_ROOT, PUBLIC_ROOT, listPages, readPage, COMMERCE } from "./lib/includes.mjs";
import { collectionData, collectionsIndexData, ROOM_BY_SLUG } from "./lib/collections.mjs";

const out = resolve(process.argv[2] || join(REDESIGN_ROOT, "dist"));
mkdirSync(join(out, "data"), { recursive: true });

const pages = listPages();
for (const f of pages) writeFileSync(join(out, f), readPage(f));
cpSync(join(REDESIGN_ROOT, "luxe"), join(out, "luxe"), { recursive: true });
for (const f of ["luxe-media.json", "luxe-custom.json"]) cpSync(join(REDESIGN_ROOT, "data", f), join(out, "data", f));
for (const slug of Object.keys(ROOM_BY_SLUG)) {
  const d = collectionData(slug);
  if (d && d.items && d.items.length) writeFileSync(join(out, "data", `collection-${slug}.json`), JSON.stringify(d));
}
writeFileSync(join(out, "data", "collections-index.json"), JSON.stringify(collectionsIndexData()));

// sitemap: keep every existing URL, add the new indexable pages
const NEW_URLS = ["custom-design.html", "stock-furniture.html", "collections.html"];
// ...except the 188 intentionally hidden products, which must not be advertised to crawlers
const blocked = new Set(JSON.parse(readFileSync(join(PUBLIC_ROOT, "data", "catalog-blocked.json"), "utf8")));
let dropped = 0;
const old = readFileSync(join(PUBLIC_ROOT, "sitemap.xml"), "utf8").replace(/ *<url><loc>[^<]*product\.html\?sku=([^<]+)<\/loc><\/url>\r?\n?/g, (m, sku) => {
  if (blocked.has(decodeURIComponent(sku))) { dropped++; return ""; }
  return m;
});
const have = new Set([...old.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
const add = NEW_URLS.map((p) => `https://snsfurniture.com/${p}`).filter((u) => !have.has(u));
writeFileSync(join(out, "sitemap.xml"), old.replace("</urlset>", add.map((u) => `  <url><loc>${u}</loc></url>\n`).join("") + "</urlset>"));

console.log(`built ${pages.length} pages -> ${out}  (commerce ${COMMERCE ? "on" : "off"}; sitemap +${add.length} new URLs, -${dropped} hidden-product URLs)`);
