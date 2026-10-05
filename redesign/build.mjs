// Build the complete redesigned site into a plain static folder, ready to be copied over a copy
// of public/ when (and only when) the redesign is approved.
//   node redesign/build.mjs [outDir]          default: redesign/dist
//   LUXE_COMMERCE=0 node redesign/build.mjs   catalog-only variant (no cart link, no add-to-cart)
//
// Writes ONLY inside outDir. Never touches public/, never deploys. Output:
//   <page>.html                   home, custom furniture hub + 4 room pages, design services,
//                                 room inspiration, stock hub, rooms, collections, catalog, cart,
//                                 checkout, order states, contact, about, policies, 404
//   product/<sku-slug>/index.html one real HTML page per visible product (9,181)
//   collection/<slug>/index.html  one real HTML page per collection with 2+ pieces
//   luxe/                         design system, scripts, fonts, owned images (AVIF/WebP/original)
//   data/                         derived data (rooms, collections, search cards, media manifest)
//   sitemap.xml robots.txt llms.txt ai.txt
//   _feeds/google-merchant.tsv    merchant feed (generated only; listed in .assetsignore)
// Hidden products have no page, no sitemap entry and no feed row.
import { mkdirSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REDESIGN_ROOT, COMMERCE } from "./lib/includes.mjs";
import { allOutputs } from "./lib/routes.mjs";
import { buildSitemap } from "./lib/sitemap.mjs";
import { buildFeed } from "./lib/feed.mjs";

const out = resolve(process.argv[2] || join(REDESIGN_ROOT, "dist"));
const write = (rel, body) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };

let files = 0, products = 0, collections = 0;
for (const [rel, body] of allOutputs(COMMERCE)) {
  write(rel, body); files++;
  if (rel.startsWith("product/")) products++;
  if (rel.startsWith("collection/")) collections++;
}
cpSync(join(REDESIGN_ROOT, "luxe"), join(out, "luxe"), { recursive: true });
for (const f of ["luxe-media.json", "luxe-custom.json"]) cpSync(join(REDESIGN_ROOT, "data", f), join(out, "data", f));
for (const f of ["robots.txt", "llms.txt", "ai.txt"]) cpSync(join(REDESIGN_ROOT, "seo", f), join(out, f));
const sm = buildSitemap();
write("sitemap.xml", sm.xml);
const feed = buildFeed();
write("_feeds/google-merchant.tsv", feed.tsv);
write(".assetsignore", "_feeds\n");

console.log(`built ${files} pages (${products} product, ${collections} collection) -> ${out}  (commerce ${COMMERCE ? "on" : "off"}; sitemap ${sm.count} URLs; merchant feed ${feed.count} rows, not deployable)`);
