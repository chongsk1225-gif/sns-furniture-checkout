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
//   sitemap.xml                   the existing sitemap plus the new pages (hidden products removed)
//   robots.txt llms.txt ai.txt    SEO / AI-search files
//   404.html                      branded not-found page
import { mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { REDESIGN_ROOT, listPages, readPage, COMMERCE } from "./lib/includes.mjs";
import { buildSitemap } from "./lib/sitemap.mjs";
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

// SEO files + 404 page + sitemap (existing URLs kept, hidden products dropped, new pages added)
for (const f of ["robots.txt", "llms.txt", "ai.txt"]) cpSync(join(REDESIGN_ROOT, "seo", f), join(out, f));
const sm = buildSitemap();
writeFileSync(join(out, "sitemap.xml"), sm.xml);
const added = sm.added, dropped = sm.dropped;

console.log(`built ${pages.length} pages -> ${out}  (commerce ${COMMERCE ? "on" : "off"}; sitemap +${added} new URLs, -${dropped} hidden-product URLs)`);
