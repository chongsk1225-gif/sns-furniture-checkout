// Flatten the redesign overlay into a plain static folder, ready to be copied
// over a copy of public/ when (and only when) the redesign is approved.
//   node redesign/build.mjs [outDir]          default: redesign/dist
//   LUXE_COMMERCE=0 node redesign/build.mjs   catalog-only variant (no cart link)
//
// Writes ONLY inside outDir. Never touches public/, never deploys. Output:
//   <page>.html          rendered pages (index, living-room, custom-furniture, product-luxe)
//   luxe/                design system CSS/JS/fonts + hero-media.json
//   data/luxe-*.json     overlay data (media manifest, custom options)
//   data/collection-<room>.json   slim per-room datasets derived from public/data
import { mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { REDESIGN_ROOT, listPages, readPage, COMMERCE } from "./lib/includes.mjs";
import { collectionData, ROOM_BY_SLUG } from "./lib/collections.mjs";

const out = resolve(process.argv[2] || join(REDESIGN_ROOT, "dist"));
mkdirSync(join(out, "data"), { recursive: true });

for (const f of listPages()) writeFileSync(join(out, f), readPage(f));
cpSync(join(REDESIGN_ROOT, "luxe"), join(out, "luxe"), { recursive: true });
for (const f of ["luxe-media.json", "luxe-custom.json"]) cpSync(join(REDESIGN_ROOT, "data", f), join(out, "data", f));
for (const slug of Object.keys(ROOM_BY_SLUG)) {
  const d = collectionData(slug);
  if (d && d.items && d.items.length) writeFileSync(join(out, "data", `collection-${slug}.json`), JSON.stringify(d));
}
console.log(`built ${listPages().length} pages -> ${out}  (commerce ${COMMERCE ? "on" : "off"})`);
